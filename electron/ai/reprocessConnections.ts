import { v4 as uuid } from 'uuid';
import crypto from 'node:crypto';
import type {
  EdgeType,
  ModelRef,
  ReprocessConnectionsOptions,
  ReprocessConnectionsResult,
} from '@shared/types';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import {
  listThemeLabels,
  normalizeThemeLabel,
  pruneOrphanThemes,
  replaceIdeaThemeLinks,
  setWorkThemes,
} from '../db/themesRepo';
import {
  addEdge,
  canonicalEdgeKey,
  currentEmbeddingConfig,
  findSimilarIdeas,
  ideasWithEmbeddings,
  normalizeEdgeType,
} from '../db/ideasRepo';
import { loadCheckpoints, saveCheckpoint, clearCheckpoints } from '../db/scanCheckpointRepo';
import { completeJson } from './aiClient';

const THEME_BATCH = 30;
const RELATION_TOP_K_PER_IDEA = 10;
const RELATION_MAX_CANDIDATES = 1400;
const RELATION_VALIDATION_BATCH = 15;
const STATEMENT_CLIP = 2000;
const REPROC_EDGE_PREFIX = 'reproc:';

const RELATION_TYPES = new Set<EdgeType>([
  'extends',
  'contradicts',
  'applies_to',
  'shares_method',
  'precondition_of',
  'measures_same',
  'supports',
  'refutes',
  'variant_of',
  'refines',
]);

interface IdeaRow {
  global_id: string;
  type: string;
  label: string;
  statement: string;
}

interface ThemeAssignmentResult {
  assignments: { id: string; themes: string[] }[];
}

interface RelationExtractionResult {
  relations: { from: string; to: string; type: string; confidence?: number; rationale?: string }[];
}

interface RelationCandidate {
  fromId: string;
  toId: string;
  fromType: string;
  toType: string;
  fromLabel: string;
  toLabel: string;
  fromStatement: string;
  toStatement: string;
  fromThemes: string[];
  toThemes: string[];
  similarity: number;
}

export interface ReprocessProgress {
  /** Current phase: 'themes' (idea→theme assignment) or 'relations' (idea↔idea). */
  phase: 'themes' | 'relations';
  /** Human-readable label for the current phase. */
  label: string;
  /** Batch index within the current phase (1-based). */
  current: number;
  /** Total batches in the current phase. */
  total: number;
}

function isThemeAssignmentResult(v: unknown): v is ThemeAssignmentResult {
  return typeof v === 'object' && v !== null && Array.isArray((v as ThemeAssignmentResult).assignments);
}

function isRelationExtractionResult(v: unknown): v is RelationExtractionResult {
  return typeof v === 'object' && v !== null && Array.isArray((v as RelationExtractionResult).relations);
}

const THEME_SYSTEM = `Eres el motor de reorganización temática de Nodus. Recibes IDEAS ya extraídas
(afirmaciones, hallazgos, constructos, métodos, marcos) y una lista de TEMAS
principales disponibles. Tu tarea, EXCLUSIVAMENTE en JSON válido, es agrupar cada
idea bajo los temas que mejor la representan.

REGLAS:
- Asigna 0 a 2 temas por idea. Elige los más representativos; no fuerces encajes.
- Cuando un tema de "available_themes" encaje, copia su etiqueta EXACTA (literal).
- No traduzcas etiquetas. No añadas explicaciones ni texto fuera del JSON.

SALIDA: { "assignments": [ { "id": "<id de la idea>", "themes": ["tema", ...] } ] }`;

const THEME_LOCKED_RULE =
  '\n- TEMAS BLOQUEADOS: usa SOLO etiquetas de "available_themes". No inventes temas nuevos. Si una idea no encaja en ninguno, devuelve "themes": [].';
const THEME_OPEN_RULE =
  '\n- Si varias ideas comparten un tema amplio que NO está en la lista, puedes proponer una etiqueta nueva (corta, en minúsculas, reutilizable). Sé MUY conservador: prioriza reutilizar los temas existentes.';

const RELATION_SYSTEM = `Eres el motor de relaciones de Nodus. Recibes PARES de ideas ya
extraídas que el sistema propuso por similitud semántica de embeddings. Tu tarea
es validar, EXCLUSIVAMENTE en JSON válido, si existe una relación conceptual
real entre cada par.

TIPOS válidos: extends, contradicts, applies_to, shares_method, precondition_of,
measures_same, supports, refutes, variant_of, refines.

═══ REGLAS ═══
- Evalúa cada par independientemente. La similitud alta NO basta por sí sola.
- Propón una relación solo si los enunciados la sustentan con claridad razonable.
- La confianza refleja cuán evidente es la relación a partir de los enunciados:
  0.7–1.0 si la relación es clara y directa, 0.4–0.7 si es plausible pero
  requiere inferencia, < 0.4 solo si hay indicios débiles.
- No relaciones una idea consigo misma.
- No inventes relaciones que los enunciados no sustenten.
- Usa los ids tal cual aparecen en la entrada.
- Puedes invertir from/to si el tipo de relación es direccional.
- "rationale": una frase breve en español que explique la validación.

SALIDA: { "relations": [ { "from": "<id>", "to": "<id>", "type": "<tipo>", "confidence": 0.0-1.0, "rationale": "..." } ] }
Si ningún par tiene relación válida: { "relations": [] }`;

function clip(text: string): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > STATEMENT_CLIP ? `${clean.slice(0, STATEMENT_CLIP)}…` : clean;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Re-group already-extracted ideas under the curated/existing main themes using the
 * model — without re-reading any document. Rewrites idea↔theme membership (and the
 * works' theme hubs derived from it). Optionally also re-traces idea↔idea relations
 * as inferred edges. Ideas, evidence and deep-scan edges are otherwise untouched.
 */
export async function reprocessConnections(
  options: ReprocessConnectionsOptions,
  model?: ModelRef | null,
  onProgress?: (p: ReprocessProgress) => void
): Promise<ReprocessConnectionsResult> {
  const db = getDb();
  const locked = getSettings().themesLocked;

  const ideas = db
    .prepare(
      `SELECT i.global_id, i.type, i.label, i.statement
       FROM ideas i
       WHERE EXISTS (
         SELECT 1
         FROM idea_occurrences io
         JOIN works w ON w.nodus_id = io.nodus_id
         WHERE io.global_id = i.global_id
           AND w.archived = 0
           AND w.deep_status = 'done'
       )
       ORDER BY i.global_id`
    )
    .all() as IdeaRow[];

  // idea → works it appears in (non-archived only), and work → its ideas.
  const occRows = db
    .prepare(
      `SELECT io.global_id, io.nodus_id
       FROM idea_occurrences io JOIN works w ON w.nodus_id = io.nodus_id
       WHERE w.archived = 0
         AND w.deep_status = 'done'`
    )
    .all() as { global_id: string; nodus_id: string }[];
  const worksByIdea = new Map<string, string[]>();
  const ideasByWork = new Map<string, string[]>();
  for (const row of occRows) {
    (worksByIdea.get(row.global_id) ?? worksByIdea.set(row.global_id, []).get(row.global_id)!).push(row.nodus_id);
    (ideasByWork.get(row.nodus_id) ?? ideasByWork.set(row.nodus_id, []).get(row.nodus_id)!).push(row.global_id);
  }

  const activeIdeas = ideas.filter((idea) => (worksByIdea.get(idea.global_id)?.length ?? 0) > 0);
  if (activeIdeas.length === 0) {
    return { ideas: 0, themedIdeas: 0, newThemes: 0, relationsAdded: 0 };
  }

  const existingLabels = listThemeLabels();
  const existingNorm = new Map(existingLabels.map((label) => [normalizeThemeLabel(label), label]));
  const system = `${THEME_SYSTEM}${locked ? THEME_LOCKED_RULE : THEME_OPEN_RULE}`;

  // Content hash for checkpoint scoping — changes when the idea set changes.
  const contentHash = crypto
    .createHash('sha1')
    .update(activeIdeas.map((i) => i.global_id).sort().join(','))
    .digest('hex');

  // ── Phase 1: reassign ideas to themes ──────────────────────────────────────
  const themesByIdea = new Map<string, string[]>();
  const newThemeNorms = new Set<string>();
  const themeBatches = chunk(activeIdeas, THEME_BATCH);
  const themeCheckpoints = loadCheckpoints('reprocess', contentHash, 'reproc_theme_batch');
  for (let bi = 0; bi < themeBatches.length; bi++) {
    const batch = themeBatches[bi];
    // Resume from checkpoint if available.
    const saved = themeCheckpoints.get(bi) as ThemeAssignmentResult | undefined;
    if (saved && isThemeAssignmentResult(saved)) {
      const byId = new Map(saved.assignments.map((a) => [a.id, Array.isArray(a.themes) ? a.themes : []]));
      for (const idea of batch) {
        const raw = byId.get(idea.global_id) ?? [];
        const labels: string[] = [];
        const seen = new Set<string>();
        for (const candidate of raw) {
          if (typeof candidate !== 'string' || !candidate.trim()) continue;
          const norm = normalizeThemeLabel(candidate);
          if (!norm || seen.has(norm)) continue;
          const canonical = existingNorm.get(norm);
          if (canonical) { seen.add(norm); labels.push(canonical); }
          else if (!locked) { seen.add(norm); newThemeNorms.add(norm); existingNorm.set(norm, candidate.trim()); labels.push(candidate.trim()); }
          if (labels.length >= 2) break;
        }
        themesByIdea.set(idea.global_id, labels);
      }
      continue;
    }
    onProgress?.({
      phase: 'themes',
      label: 'Agrupando ideas en temas',
      current: bi + 1,
      total: themeBatches.length,
    });
    const input = {
      locked,
      available_themes: existingLabels,
      ideas: batch.map((idea) => ({
        id: idea.global_id,
        type: idea.type,
        label: idea.label,
        statement: clip(idea.statement),
      })),
    };
    const result = await completeJson<ThemeAssignmentResult>(
      { system, user: JSON.stringify(input), temperature: 0.1 },
      isThemeAssignmentResult,
      model
    );
    // Checkpoint this batch result.
    saveCheckpoint('reprocess', contentHash, 'reproc_theme_batch', bi, result);
    const byId = new Map(result.assignments.map((a) => [a.id, Array.isArray(a.themes) ? a.themes : []]));
    for (const idea of batch) {
      const raw = byId.get(idea.global_id) ?? [];
      const labels: string[] = [];
      const seen = new Set<string>();
      for (const candidate of raw) {
        if (typeof candidate !== 'string' || !candidate.trim()) continue;
        const norm = normalizeThemeLabel(candidate);
        if (!norm || seen.has(norm)) continue;
        const canonical = existingNorm.get(norm);
        if (canonical) {
          seen.add(norm);
          labels.push(canonical);
        } else if (!locked) {
          // New theme proposed (only allowed when unlocked).
          seen.add(norm);
          newThemeNorms.add(norm);
          existingNorm.set(norm, candidate.trim());
          labels.push(candidate.trim());
        }
        if (labels.length >= 2) break;
      }
      themesByIdea.set(idea.global_id, labels);
    }
  }

  // Apply idea→theme membership across every occurrence of each idea.
  let themedIdeas = 0;
  const applyThemes = db.transaction(() => {
    for (const idea of activeIdeas) {
      const labels = themesByIdea.get(idea.global_id) ?? [];
      const works = worksByIdea.get(idea.global_id) ?? [];
      replaceIdeaThemeLinks(idea.global_id, works, labels, 0.8, 'explicit');
      if (labels.length > 0) themedIdeas++;
    }
    // Rebuild each analysed work's theme hubs as the union of its ideas' themes (capped).
    for (const [nodusId, ideaIds] of ideasByWork) {
      const counts = new Map<string, { label: string; n: number }>();
      for (const ideaId of ideaIds) {
        for (const label of themesByIdea.get(ideaId) ?? []) {
          const norm = normalizeThemeLabel(label);
          const entry = counts.get(norm) ?? { label, n: 0 };
          entry.n += 1;
          counts.set(norm, entry);
        }
      }
      const topLabels = [...counts.values()]
        .sort((a, b) => b.n - a.n)
        .slice(0, 4)
        .map((c) => c.label);
      setWorkThemes(nodusId, topLabels);
    }
    pruneOrphanThemes();
  });
  applyThemes();
  // Theme phase done — clear its checkpoints.
  clearCheckpoints('reprocess', contentHash, 'reproc_theme_batch');

  let relationsAdded = 0;
  if (options.relations) {
    relationsAdded = await reprocessRelations(activeIdeas, themesByIdea, model, contentHash, onProgress);
  }

  return {
    ideas: activeIdeas.length,
    themedIdeas,
    newThemes: newThemeNorms.size,
    relationsAdded,
  };
}

/**
 * Re-derive idea↔idea relations by first retrieving semantic top-k candidate
 * pairs, then asking the model to validate only those pairs. This avoids the old
 * batch-bound blind spot where two related ideas in different batches were never
 * compared, and it keeps model work bounded by candidate count rather than N².
 */
async function reprocessRelations(
  ideas: IdeaRow[],
  themesByIdea: Map<string, string[]>,
  model?: ModelRef | null,
  contentHash?: string,
  onProgress?: (p: ReprocessProgress) => void
): Promise<number> {
  const db = getDb();
  const ideaById = new Map(ideas.map((idea) => [idea.global_id, idea]));
  const activeIds = new Set(ideas.map((idea) => idea.global_id));
  const embeddedIdeas = ideasWithEmbeddings().filter((idea) => activeIds.has(idea.global_id));
  if (embeddedIdeas.length < 2) return 0;

  const existingPairs = new Set<string>();
  const existingRows = db
    .prepare(`SELECT from_id, to_id FROM edges WHERE id NOT LIKE '${REPROC_EDGE_PREFIX}%'`)
    .all() as { from_id: string; to_id: string }[];
  for (const row of existingRows) {
    existingPairs.add([row.from_id, row.to_id].sort().join('|'));
  }

  const candidates: RelationCandidate[] = [];
  const seenPairs = new Set<string>();
  for (const idea of embeddedIdeas) {
    const similar = findSimilarIdeas(idea.embedding, 0.68, RELATION_TOP_K_PER_IDEA, { excludeIds: [idea.global_id] });
    for (const hit of similar) {
      if (!activeIds.has(hit.global_id)) continue;
      const other = ideaById.get(hit.global_id);
      if (!other) continue;
      const pairKey = [idea.global_id, hit.global_id].sort().join('|');
      if (seenPairs.has(pairKey) || existingPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      candidates.push({
        fromId: idea.global_id,
        toId: hit.global_id,
        fromType: idea.type,
        toType: other.type,
        fromLabel: idea.label,
        toLabel: other.label,
        fromStatement: idea.statement,
        toStatement: other.statement,
        fromThemes: themesByIdea.get(idea.global_id) ?? [],
        toThemes: themesByIdea.get(hit.global_id) ?? [],
        similarity: hit.similarity,
      });
    }
  }

  candidates.sort((a, b) => b.similarity - a.similarity);
  const cappedCandidates = candidates.slice(0, RELATION_MAX_CANDIDATES);
  if (cappedCandidates.length === 0) return 0;

  const batches = chunk(cappedCandidates, RELATION_VALIDATION_BATCH);
  const relationHash = crypto
    .createHash('sha1')
    .update(`${contentHash ?? ''}:${cappedCandidates.map((c) => `${c.fromId}:${c.toId}`).sort().join(',')}`)
    .digest('hex');
  const proposed = new Map<string, { from: string; to: string; type: EdgeType; confidence: number; similarity: number; rationale: string | null }>();
  const candidateByPair = new Map(cappedCandidates.map((c) => [[c.fromId, c.toId].sort().join('|'), c]));
  const relCheckpoints = loadCheckpoints('reprocess', relationHash, 'reproc_relation_batch');

  const acceptRelation = (relation: RelationExtractionResult['relations'][number]) => {
    if (!relation || relation.from === relation.to) return;
    const candidate = candidateByPair.get([relation.from, relation.to].sort().join('|'));
    if (!candidate) return;
    const type = normalizeEdgeType(relation.type);
    if (!type || !RELATION_TYPES.has(type)) return;
    const confidence = Math.max(0.1, Math.min(1, Number(relation.confidence) || 0.5));
    const key = canonicalEdgeKey(relation.from, relation.to, type);
    const existing = proposed.get(key);
    if (!existing || confidence > existing.confidence) {
      proposed.set(key, {
        from: relation.from,
        to: relation.to,
        type,
        confidence,
        similarity: candidate.similarity,
        rationale: typeof relation.rationale === 'string' && relation.rationale.trim() ? relation.rationale.trim() : null,
      });
    }
  };

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const saved = relCheckpoints.get(bi) as RelationExtractionResult | undefined;
    if (saved && isRelationExtractionResult(saved)) {
      for (const relation of saved.relations) acceptRelation(relation);
      continue;
    }
    onProgress?.({
      phase: 'relations',
      label: 'Validando pares semánticos entre ideas',
      current: bi + 1,
      total: batches.length,
    });
    const input = {
      pairs: batch.map((candidate) => ({
        from: {
          id: candidate.fromId,
          type: candidate.fromType,
          label: candidate.fromLabel,
          statement: clip(candidate.fromStatement),
          themes: candidate.fromThemes,
        },
        to: {
          id: candidate.toId,
          type: candidate.toType,
          label: candidate.toLabel,
          statement: clip(candidate.toStatement),
          themes: candidate.toThemes,
        },
        similarity: Number(candidate.similarity.toFixed(3)),
      })),
    };
    let result: RelationExtractionResult;
    try {
      result = await completeJson<RelationExtractionResult>(
        { system: RELATION_SYSTEM, user: JSON.stringify(input), temperature: 0.1, maxTokens: 4000 },
        isRelationExtractionResult,
        model
      );
    } catch {
      // If a single batch fails (e.g. output too large), skip it and continue.
      continue;
    }
    saveCheckpoint('reprocess', relationHash, 'reproc_relation_batch', bi, result);
    for (const relation of result.relations) acceptRelation(relation);
  }

  let added = 0;
  const config = currentEmbeddingConfig();
  const insert = db.transaction(() => {
    // Clear old reproc edges only now — after all batches completed successfully.
    db.prepare(`DELETE FROM edge_traces WHERE edge_id IN (SELECT id FROM edges WHERE id LIKE '${REPROC_EDGE_PREFIX}%')`).run();
    db.prepare(`DELETE FROM edges WHERE id LIKE '${REPROC_EDGE_PREFIX}%'`).run();
    for (const edge of proposed.values()) {
      const id = addEdge({
        id: `${REPROC_EDGE_PREFIX}${uuid()}`,
        from_id: edge.from,
        to_id: edge.to,
        type: edge.type,
        basis: 'inferred',
        confidence: edge.confidence,
        source_work: null,
        trace: {
          method: 'reprocess',
          model,
          embeddingProvider: config.provider,
          embeddingModel: config.model,
          similarity: edge.similarity,
          rationale: edge.rationale,
        },
      });
      if (id) added++;
    }
  });
  insert();
  // Relation phase done — clear its checkpoints.
  clearCheckpoints('reprocess', relationHash, 'reproc_relation_batch');
  return added;
}
