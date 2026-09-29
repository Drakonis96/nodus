import type { ModelRef } from '@shared/types';
import { findRequestedTarget } from '@shared/moleculeInspection';
import {
  disconnectionClasses,
  findStartingSmiles,
  findTargetName,
  isIndexLikePassage,
  isSynthesisEvidenceWork,
  normalizeDisconnections,
  secondLevelTargets,
  synthesisEvidenceQueries,
  type EvidencePassage,
  type SynthesisEvidence,
  type TargetDisconnections,
} from '@shared/synthesisEvidence';
import { capabilityRegistry } from '../capabilities/registry';
import { getDb } from '../db/database';
import { findSimilarPassages, lexicalPassageSearch, type SimilarPassage } from '../db/passagesRepo';
import { reactionIndexService } from '../reactionIndex';
import { embed } from './aiClient';
import { chemistryRunner } from './moleculeInspection';

const CHEMISTRY_CAPABILITY = 'nodus:chemistry';
const DISCONNECT_TOOL = 'propose-disconnections';
/** Proposals kept per molecule, and passages kept in all. */
const PROPOSALS_PER_TARGET = 6;
const MAX_PASSAGES = 6;
/** Passages per query, so one reaction class cannot crowd out the others. */
const PASSAGES_PER_QUERY = 2;
const PASSAGE_CHARS = 1_200;
const PASSAGE_SIMILARITY = 0.3;

interface EvidenceOptions {
  model?: ModelRef | null;
  locale?: string;
  signal?: AbortSignal;
  owner?: string;
}

function disconnectProvider() {
  const provider = capabilityRegistry().providers.get(CHEMISTRY_CAPABILITY);
  return provider && provider.tools.some((tool) => tool.id === DISCONNECT_TOOL) ? provider : null;
}

type Runner = ReturnType<typeof chemistryRunner>['runner'];

/** One `propose-disconnections` call on an open runner. Null when the package has no such tool or
 *  the index is not downloaded; throws on a tool failure. */
export async function invokeDisconnections(runner: Runner, targets: string[], starting: string[], limit = PROPOSALS_PER_TARGET): Promise<TargetDisconnections[] | null> {
  const provider = disconnectProvider();
  if (!provider || !targets.length) return null;
  const indexDir = await reactionIndexService().localDirectory();
  if (!indexDir) return null;
  const result = await runner.invoke({
    provider,
    toolId: DISCONNECT_TOOL,
    input: { indexDir, targets: targets.slice(0, 16), limit, ...(starting.length ? { startingMaterials: starting.slice(0, 16) } : {}) },
  });
  const artifact = (result.artifacts ?? []).find((entry) => entry.artifactType === 'reaction-disconnections');
  return artifact ? normalizeDisconnections(artifact.data, limit) : [];
}

/** One-step disconnections of the target, then of the most promising precursors (one more call),
 *  from the local ORD index. Best-effort: an older package, an index without the retro tables or
 *  a tool failure returns what was found so far. */
async function ordDisconnections(target: string, starting: string[], options: EvidenceOptions): Promise<TargetDisconnections[]> {
  if (!disconnectProvider()) return [];
  const { runner, dispose } = chemistryRunner(options);
  const briefs: TargetDisconnections[] = [];
  try {
    briefs.push(...(await invokeDisconnections(runner, [target], starting)) ?? []);
    options.signal?.throwIfAborted();
    const next = secondLevelTargets(briefs, starting, 3).filter((molecule) => !briefs.some((brief) => brief.target === molecule));
    if (next.length) briefs.push(...((await invokeDisconnections(runner, next, starting)) ?? []).map((brief) => ({ ...brief, proposals: brief.proposals.slice(0, 3) })));
  } catch (error) {
    if (options.signal?.aborted) throw error;
    console.warn('[synthesisEvidence] ORD disconnections unavailable:', error instanceof Error ? error.message : String(error));
  } finally {
    await dispose();
  }
  return briefs.filter((brief) => brief.proposals.length || brief.recordedRoutes.length);
}

/** The works whose passages count as route evidence: synthetic-chemistry texts and works filed
 *  under a chemistry collection. */
export function synthesisEvidenceWorkIds(): string[] {
  const rows = getDb().prepare(
    `SELECT w.nodus_id, w.title,
            (SELECT group_concat(c.name, char(31)) FROM work_collections wc JOIN collections c ON c.collection_key = wc.collection_key
              WHERE wc.nodus_id = w.nodus_id) AS collections
       FROM works w
      WHERE w.archived = 0 AND EXISTS (SELECT 1 FROM passages p WHERE p.nodus_id = w.nodus_id)`
  ).all() as Array<{ nodus_id: string; title: string | null; collections: string | null }>;
  return rows
    .filter((row) => isSynthesisEvidenceWork(row.title ?? '', row.collections ? row.collections.split('\u001f') : []))
    .map((row) => row.nodus_id);
}

/** Passages for each query from the scoped works: the lexical lane (named reactions, reagent
 *  names) and the dense lane, fused by reciprocal rank, a few per query. */
export async function textbookPassages(queries: string[], workIds: string[], signal?: AbortSignal, perQuery = PASSAGES_PER_QUERY): Promise<EvidencePassage[]> {
  if (!queries.length || !workIds.length) return [];
  const chosen = new Map<string, EvidencePassage>();
  for (const query of queries) {
    signal?.throwIfAborted();
    const lanes: SimilarPassage[][] = [];
    try { lanes.push(lexicalPassageSearch(query, 6, { nodusIds: workIds })); } catch { /* FTS is optional */ }
    try {
      const vector = await embed(query);
      if (vector) lanes.push(findSimilarPassages(vector, PASSAGE_SIMILARITY, 6, { nodusIds: workIds }));
    } catch { /* no embedding provider: the lexical lane alone */ }
    const scores = new Map<string, { score: number; hit: SimilarPassage }>();
    for (const lane of lanes) {
      lane.forEach((hit, rank) => {
        const entry = scores.get(hit.passage_id) ?? { score: 0, hit };
        entry.score += 1 / (60 + rank);
        scores.set(hit.passage_id, entry);
      });
    }
    let taken = 0;
    for (const { hit } of [...scores.values()].sort((a, b) => b.score - a.score)) {
      if (taken >= perQuery || chosen.size >= MAX_PASSAGES) break;
      if (chosen.has(hit.passage_id) || isIndexLikePassage(hit.text)) continue;
      const text = hit.text.replace(/\s+/g, ' ').trim();
      chosen.set(hit.passage_id, {
        text: text.length > PASSAGE_CHARS ? `${text.slice(0, PASSAGE_CHARS)}…` : text,
        location: hit.page_label,
        work: { title: hit.title, year: hit.year },
        retrievedFor: query,
        citation: `nodus://passage/${encodeURIComponent(hit.passage_id)}`,
      });
      taken += 1;
    }
    if (chosen.size >= MAX_PASSAGES) break;
  }
  return [...chosen.values()];
}

/** Evidence for a route request, gathered before the model answers: ORD disconnections of the
 *  target and textbook passages for the target and the reaction classes those disconnections
 *  name. Null when the request names no target SMILES. */
export async function gatherSynthesisEvidence(question: string, options: EvidenceOptions = {}): Promise<SynthesisEvidence | null> {
  const target = findRequestedTarget(question);
  if (!target) return null;
  const startingMaterials = findStartingSmiles(question, target);
  const disconnections = await ordDisconnections(target, startingMaterials, options);
  let passages: EvidencePassage[] = [];
  try {
    const queries = synthesisEvidenceQueries(findTargetName(question), disconnectionClasses(disconnections, 4));
    passages = await textbookPassages(queries, synthesisEvidenceWorkIds(), options.signal);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    console.warn('[synthesisEvidence] textbook passages unavailable:', error instanceof Error ? error.message : String(error));
  }
  return { target, startingMaterials, disconnections, passages };
}
