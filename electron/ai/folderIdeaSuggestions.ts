// Suggest ideas to integrate into a notes folder. Given the folder's summary
// (a free-text brief of what the folder is meant to hold), match it against the
// whole idea base in three staged passes:
//   1. semantic — embed the summary and pull the most similar ideas (excluding
//      ones already filed in the folder subtree);
//   2. connections — expand one hop through the graph edges of those seeds so
//      conceptually linked ideas surface even when their wording differs;
//   3. AI curation — let the model pick the ones that genuinely belong and
//      justify each, reconciled against the known candidate ids.
import type { FolderIdeaSuggestion, FolderIdeaSuggestionsResult, IdeaType } from '@shared/types';
import { getDb } from '../db/database';
import { getNoteFolder } from '../db/notesRepo';
import * as ideas from '../db/ideasRepo';
import { embed, completeJson } from './aiClient';

// Mirrors MANUAL_IDEA_MARKER / idea-note provenance: idea notes carry the idea's
// global_id in source_json `$.ref`. Those refs are what's "already in the folder".
const SEMANTIC_THRESHOLD = 0.25;
const SEMANTIC_LIMIT = 40;
const SEED_FANOUT = 15; // top seeds whose graph neighbours we expand
const CANDIDATE_CAP = 50; // hard cap on ideas sent to the AI curation step

interface Candidate {
  global_id: string;
  type: IdeaType;
  label: string;
  statement: string;
  similarity: number | null;
  viaConnection: boolean;
}

/** Folder id plus every descendant folder id (recursive). */
function folderSubtreeIds(rootId: string): string[] {
  const rows = getDb()
    .prepare(
      `WITH RECURSIVE sub(id) AS (
         SELECT id FROM note_folders WHERE id = ?
         UNION ALL
         SELECT f.id FROM note_folders f JOIN sub ON f.parent_id = sub.id
       )
       SELECT id FROM sub`
    )
    .all(rootId) as { id: string }[];
  return rows.map((r) => r.id);
}

/** Idea ids already filed (as idea notes) anywhere in the given folders. */
function ideasInFolders(folderIds: string[]): Set<string> {
  if (folderIds.length === 0) return new Set();
  const placeholders = folderIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT json_extract(source_json, '$.ref') AS ref
         FROM notes
        WHERE kind = 'idea'
          AND source_json IS NOT NULL
          AND folder_id IN (${placeholders})`
    )
    .all(...folderIds) as { ref: string | null }[];
  const set = new Set<string>();
  for (const row of rows) if (row.ref) set.add(row.ref);
  return set;
}

/** The "other" endpoint of every edge touching one of `seedIds`. */
function connectionNeighbours(seedIds: string[]): Set<string> {
  const out = new Set<string>();
  if (seedIds.length === 0) return out;
  const placeholders = seedIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT from_id, to_id FROM edges
        WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`
    )
    .all(...seedIds, ...seedIds) as { from_id: string; to_id: string }[];
  const seedSet = new Set(seedIds);
  for (const row of rows) {
    if (!seedSet.has(row.from_id)) out.add(row.from_id);
    if (!seedSet.has(row.to_id)) out.add(row.to_id);
  }
  return out;
}

interface CurationResponse {
  selected: { id: string; reason: string; score: number }[];
}

function isCurationResponse(v: unknown): v is CurationResponse {
  if (typeof v !== 'object' || v === null) return false;
  const sel = (v as CurationResponse).selected;
  return (
    Array.isArray(sel) &&
    sel.every(
      (s) => typeof s === 'object' && s !== null && typeof (s as { id: unknown }).id === 'string'
    )
  );
}

function clamp01(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

export async function suggestFolderIdeas(folderId: string): Promise<FolderIdeaSuggestionsResult> {
  const empty = (message: string | null, ok = false): FolderIdeaSuggestionsResult => ({
    ok,
    message,
    suggestions: [],
    excludedCount: 0,
    consideredCount: 0,
  });

  const folder = getNoteFolder(folderId);
  if (!folder) return empty('La carpeta no existe.');

  const summary = folder.summary.trim();
  if (!summary) {
    return empty('Añade un resumen a la carpeta para describir las ideas que debería integrar.');
  }

  // Ideas already in this folder (and its subfolders) are excluded from the analysis.
  const excluded = ideasInFolders(folderSubtreeIds(folderId));
  const excludedCount = excluded.size;

  let vector: number[] | null;
  try {
    vector = await embed(summary);
  } catch (e) {
    return { ...empty(e instanceof Error ? e.message : String(e)), excludedCount };
  }
  if (!vector) {
    return {
      ...empty('No hay proveedor de embeddings configurado. Configúralo en Ajustes para analizar ideas.'),
      excludedCount,
    };
  }

  if (ideas.embeddedIdeaCount() === 0) {
    return {
      ...empty('Aún no hay ideas indexadas. Indexa las ideas en Ajustes para poder analizarlas.'),
      excludedCount,
    };
  }

  // ── Stage 1: semantic seeds ────────────────────────────────────────────────
  const excludeIds = [...excluded];
  const seeds = ideas.findSimilarIdeas(vector, SEMANTIC_THRESHOLD, SEMANTIC_LIMIT, { excludeIds });

  const byId = new Map<string, Candidate>();
  for (const s of seeds) {
    byId.set(s.global_id, { ...s, similarity: s.similarity, viaConnection: false });
  }

  // ── Stage 2: expand one hop through the graph ──────────────────────────────
  const seedIds = seeds.map((s) => s.global_id).slice(0, SEED_FANOUT);
  const neighbourIds = [...connectionNeighbours(seedIds)].filter(
    (id) => !excluded.has(id) && !byId.has(id)
  );
  if (neighbourIds.length > 0) {
    for (const n of ideas.ideaEmbeddingSimilarities(vector, neighbourIds)) {
      byId.set(n.global_id, { ...n, similarity: n.similarity, viaConnection: true });
    }
  }

  const candidates = [...byId.values()]
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, CANDIDATE_CAP);

  if (candidates.length === 0) {
    return {
      ...empty('No se han encontrado ideas suficientemente afines al resumen de la carpeta.', true),
      excludedCount,
    };
  }

  // ── Stage 3: AI curation + justification ───────────────────────────────────
  const list = candidates
    .map((c, i) => {
      const via = c.viaConnection ? ' [vía conexión]' : '';
      const sim = c.similarity != null ? ` (afinidad ${c.similarity.toFixed(2)})` : '';
      return `${i + 1}. id="${c.global_id}"${via}${sim} · ${c.label}\n   ${c.statement}`;
    })
    .join('\n');

  const system =
    'Eres un documentalista académico. Recibes el RESUMEN de una carpeta de investigación (qué ideas debería integrar) y una lista de IDEAS candidatas. ' +
    'Selecciona únicamente las ideas que encajan de verdad en la carpeta según su resumen, descartando las tangenciales. ' +
    'Para cada idea elegida da una razón breve (1 frase) de por qué pertenece a la carpeta y una puntuación de ajuste entre 0 y 1. ' +
    'Devuelve EXCLUSIVAMENTE un JSON con la forma {"selected": [{"id": "g-0001", "reason": "…", "score": 0.0}]} ' +
    'usando los id EXACTOS proporcionados, sin inventar ni repetir ninguno. Puedes devolver una lista vacía si ninguna encaja.';
  const user = `Resumen de la carpeta «${folder.name}»:\n${summary}\n\nIdeas candidatas:\n${list}\n\nDevuelve {"selected": [...]} con los id exactos.`;

  let curated: CurationResponse;
  try {
    curated = await completeJson<CurationResponse>({ system, user, temperature: 0 }, isCurationResponse);
  } catch {
    // AI step failed: fall back to the semantic ranking so the user still gets value.
    const fallback: FolderIdeaSuggestion[] = candidates.map((c) => ({
      global_id: c.global_id,
      type: c.type,
      label: c.label,
      statement: c.statement,
      similarity: c.similarity,
      viaConnection: c.viaConnection,
      reason: '',
      score: c.similarity ?? 0,
    }));
    return {
      ok: true,
      message: 'No se pudo completar el análisis de IA; se muestran las ideas más afines por similitud.',
      suggestions: fallback,
      excludedCount,
      consideredCount: candidates.length,
    };
  }

  // Reconcile: keep only known candidate ids, once, never already-in-folder.
  const known = new Map(candidates.map((c) => [c.global_id, c]));
  const seen = new Set<string>();
  const suggestions: FolderIdeaSuggestion[] = [];
  for (const sel of curated.selected) {
    const cand = known.get(sel.id);
    if (!cand || seen.has(sel.id) || excluded.has(sel.id)) continue;
    seen.add(sel.id);
    suggestions.push({
      global_id: cand.global_id,
      type: cand.type,
      label: cand.label,
      statement: cand.statement,
      similarity: cand.similarity,
      viaConnection: cand.viaConnection,
      reason: typeof sel.reason === 'string' ? sel.reason.trim() : '',
      score: clamp01(sel.score),
    });
  }
  suggestions.sort((a, b) => b.score - a.score);

  return {
    ok: true,
    message: suggestions.length === 0 ? 'La IA no ha encontrado ideas que encajen con el resumen de la carpeta.' : null,
    suggestions,
    excludedCount,
    consideredCount: candidates.length,
  };
}
