import { v4 as uuid } from 'uuid';
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
import { normalizeEdgeType } from '../db/ideasRepo';
import { completeJson } from './aiClient';

const THEME_BATCH = 30;
const RELATION_CLUSTER_CAP = 18;
const MAX_RELATION_CLUSTERS = 24;
const STATEMENT_CLIP = 320;
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
  relations: { from: string; to: string; type: string; confidence?: number }[];
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

const RELATION_SYSTEM = `Eres el motor de relaciones de Nodus. Recibes un grupo de IDEAS ya extraídas que
comparten un tema. Propón, EXCLUSIVAMENTE en JSON válido, relaciones entre ellas.

TIPOS válidos: extends, contradicts, applies_to, shares_method, precondition_of,
measures_same, supports, refutes, variant_of, refines.

REGLAS:
- Propón solo relaciones claras y plausibles a partir del enunciado de las ideas.
- No dispones del texto original, así que TODA relación es inferida: confidence ≤ 0.7.
  Ante la duda, omite. Es preferible pocas relaciones sólidas que muchas dudosas.
- No relaciones una idea consigo misma. Máximo ~2 relaciones por idea.
- Usa los ids tal cual aparecen en la entrada.

SALIDA: { "relations": [ { "from": "<id>", "to": "<id>", "type": "<tipo>", "confidence": 0.0-1.0 } ] }`;

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

  // ── Phase 1: reassign ideas to themes ──────────────────────────────────────
  const themesByIdea = new Map<string, string[]>();
  const newThemeNorms = new Set<string>();
  const themeBatches = chunk(activeIdeas, THEME_BATCH);
  for (let bi = 0; bi < themeBatches.length; bi++) {
    const batch = themeBatches[bi];
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
      { system, user: JSON.stringify(input), temperature: 0.1, maxTokens: 2500 },
      isThemeAssignmentResult,
      model
    );
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

  let relationsAdded = 0;
  if (options.relations) {
    relationsAdded = await reprocessRelations(activeIdeas, themesByIdea, model, onProgress);
  }

  return {
    ideas: activeIdeas.length,
    themedIdeas,
    newThemes: newThemeNorms.size,
    relationsAdded,
  };
}

/**
 * Re-derive idea↔idea relations within each theme cluster of already-extracted ideas.
 * These are model-inferred (no source text), so they're stored as 'inferred' edges with
 * a recognisable id prefix and cleared/rebuilt on each run. Deep-scan edges are never
 * touched, and an inferred edge is skipped if a stronger edge for that pair already exists.
 */
async function reprocessRelations(
  ideas: IdeaRow[],
  themesByIdea: Map<string, string[]>,
  model?: ModelRef | null,
  onProgress?: (p: ReprocessProgress) => void
): Promise<number> {
  const db = getDb();
  const ideaById = new Map(ideas.map((idea) => [idea.global_id, idea]));

  // Group ideas by theme; only clusters with ≥2 ideas can carry relations.
  const clusters = new Map<string, string[]>();
  for (const idea of ideas) {
    for (const label of themesByIdea.get(idea.global_id) ?? []) {
      const norm = normalizeThemeLabel(label);
      (clusters.get(norm) ?? clusters.set(norm, []).get(norm)!).push(idea.global_id);
    }
  }
  const candidateClusters = [...clusters.values()]
    .filter((ids) => ids.length >= 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_RELATION_CLUSTERS)
    .map((ids) => ids.slice(0, RELATION_CLUSTER_CAP));

  // Refresh: drop only previously reprocess-added inferred edges.
  db.prepare(`DELETE FROM edges WHERE id LIKE '${REPROC_EDGE_PREFIX}%'`).run();
  if (candidateClusters.length === 0) return 0;

  const proposed = new Map<string, { from: string; to: string; type: EdgeType; confidence: number }>();
  for (let ci = 0; ci < candidateClusters.length; ci++) {
    const cluster = candidateClusters[ci];
    onProgress?.({
      phase: 'relations',
      label: 'Trazando relaciones entre ideas',
      current: ci + 1,
      total: candidateClusters.length,
    });
    const input = {
      ideas: cluster.map((id) => {
        const idea = ideaById.get(id)!;
        return { id, type: idea.type, label: idea.label, statement: clip(idea.statement) };
      }),
    };
    const result = await completeJson<RelationExtractionResult>(
      { system: RELATION_SYSTEM, user: JSON.stringify(input), temperature: 0.1, maxTokens: 1800 },
      isRelationExtractionResult,
      model
    );
    const inCluster = new Set(cluster);
    for (const relation of result.relations) {
      if (!relation || relation.from === relation.to) continue;
      if (!inCluster.has(relation.from) || !inCluster.has(relation.to)) continue;
      const type = normalizeEdgeType(relation.type);
      if (!type || !RELATION_TYPES.has(type)) continue;
      const confidence = Math.max(0.1, Math.min(0.7, Number(relation.confidence) || 0.5));
      const key = `${relation.from}|${relation.to}|${type}`;
      const existing = proposed.get(key);
      if (!existing || confidence > existing.confidence) {
        proposed.set(key, { from: relation.from, to: relation.to, type, confidence });
      }
    }
  }

  let added = 0;
  const insert = db.transaction(() => {
    for (const edge of proposed.values()) {
      // Don't duplicate an edge already established for this exact pair+type.
      const clash = db
        .prepare('SELECT 1 FROM edges WHERE from_id = ? AND to_id = ? AND type = ?')
        .get(edge.from, edge.to, edge.type);
      if (clash) continue;
      db.prepare(
        'INSERT INTO edges (id, from_id, to_id, type, basis, confidence, source_work) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(`${REPROC_EDGE_PREFIX}${uuid()}`, edge.from, edge.to, edge.type, 'inferred', edge.confidence, null);
      added++;
    }
  });
  insert();
  return added;
}
