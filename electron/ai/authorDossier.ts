// Author Dossier ("Ficha de autor") — a per-author study surface for readers
// racing through a large corpus. Everything factual (the author's ideas, their
// evidence, the themes they touch and who they are connected to) is assembled
// live from the graph tables; only the narrated synthesis (central thesis,
// "what to remember", positioning) is an AI pass, and that result is cached in
// author_dossier_synthesis with a fingerprint so it can be flagged as stale when
// the underlying corpus changes.
import { createHash } from 'crypto';
import type {
  Author,
  AuthorDossier,
  AuthorDossierIdea,
  AuthorDossierRelation,
  AuthorDossierSynthesis,
  AuthorDossierWork,
  AuthorSummary,
  Evidence,
  IdeaType,
  ModelRef,
} from '@shared/types';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { completeJson } from './aiClient';

const STATEMENT_CLIP = 220;
const MAX_IDEAS_IN_PROMPT = 60;
const MAX_REMEMBER = 6;
const TOP_THEMES = 4;

const IDEA_TYPE_LABELS: Record<IdeaType, string> = {
  claim: 'afirmación',
  finding: 'hallazgo',
  construct: 'constructo',
  method: 'método',
  framework: 'marco',
};

const RELATION_TYPE_LABELS: Record<string, string> = {
  contradicts: 'contradice a',
  refutes: 'refuta a',
  extends: 'extiende a',
  supports: 'apoya a',
  refines: 'refina a',
  coauthor: 'es coautor de',
};

function clip(value: string, max: number): string {
  const clean = (value || '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}…`;
}

/** Split a stored author name (usually "Surname, Given") into display + sort parts. */
export function splitName(name: string): { firstName: string; lastName: string; fullName: string } {
  const clean = (name || '').replace(/\s+/g, ' ').trim();
  const comma = clean.indexOf(',');
  if (comma >= 0) {
    const lastName = clean.slice(0, comma).trim();
    const firstName = clean.slice(comma + 1).trim();
    return { firstName, lastName, fullName: `${firstName} ${lastName}`.trim() };
  }
  const tokens = clean.split(' ');
  if (tokens.length <= 1) return { firstName: '', lastName: clean, fullName: clean };
  return { firstName: tokens[0], lastName: tokens.slice(1).join(' '), fullName: clean };
}

// ─── Author list (footprint summary) ──────────────────────────────────────────

/** Lightweight list of every author that has at least one live (non-archived) work. */
export function listAuthors(): AuthorSummary[] {
  const db = getDb();
  const authors = db
    .prepare('SELECT author_id, name, affiliation FROM authors')
    .all() as { author_id: string; name: string; affiliation: string | null }[];

  // works per author (drives workCount + read)
  const waRows = db
    .prepare(
      `SELECT wa.author_id, w.read_tag
         FROM work_authors wa JOIN works w ON w.nodus_id = wa.nodus_id
        WHERE w.archived = 0`
    )
    .all() as { author_id: string; read_tag: number }[];
  const works = new Map<string, { total: number; read: number }>();
  for (const r of waRows) {
    const cur = works.get(r.author_id) ?? { total: 0, read: 0 };
    cur.total += 1;
    if (r.read_tag === 1) cur.read += 1;
    works.set(r.author_id, cur);
  }

  // distinct ideas across an author's works
  const ideaRows = db
    .prepare(
      `SELECT wa.author_id AS id, COUNT(DISTINCT io.global_id) AS n
         FROM work_authors wa
         JOIN works w ON w.nodus_id = wa.nodus_id AND w.archived = 0
         JOIN idea_occurrences io ON io.nodus_id = wa.nodus_id
        GROUP BY wa.author_id`
    )
    .all() as { id: string; n: number }[];
  const ideaCount = new Map(ideaRows.map((r) => [r.id, r.n] as const));

  // distinct connected authors (both edge directions)
  const relRows = db
    .prepare(
      `SELECT id, COUNT(DISTINCT other) AS n FROM (
         SELECT from_author AS id, to_author AS other FROM author_relations WHERE from_author <> to_author
         UNION
         SELECT to_author AS id, from_author AS other FROM author_relations WHERE from_author <> to_author
       ) GROUP BY id`
    )
    .all() as { id: string; n: number }[];
  const relationCount = new Map(relRows.map((r) => [r.id, r.n] as const));

  // top themes per author (by idea-theme link volume)
  const themeRows = db
    .prepare(
      `SELECT wa.author_id AS id, t.label AS label, COUNT(*) AS n
         FROM work_authors wa
         JOIN idea_theme_links itl ON itl.nodus_id = wa.nodus_id
         JOIN themes t ON t.theme_id = itl.theme_id
        GROUP BY wa.author_id, t.theme_id
        ORDER BY n DESC`
    )
    .all() as { id: string; label: string; n: number }[];
  const themesByAuthor = new Map<string, string[]>();
  for (const r of themeRows) {
    const list = themesByAuthor.get(r.id) ?? [];
    if (list.length < TOP_THEMES) list.push(r.label);
    themesByAuthor.set(r.id, list);
  }

  const synthRows = db.prepare('SELECT author_id FROM author_dossier_synthesis').all() as { author_id: string }[];
  const hasSynth = new Set(synthRows.map((r) => r.author_id));

  return authors
    .map((a): AuthorSummary => {
      const w = works.get(a.author_id) ?? { total: 0, read: 0 };
      const parts = splitName(a.name);
      return {
        author_id: a.author_id,
        name: a.name,
        firstName: parts.firstName,
        lastName: parts.lastName,
        fullName: parts.fullName,
        affiliation: a.affiliation,
        workCount: w.total,
        ideaCount: ideaCount.get(a.author_id) ?? 0,
        relationCount: relationCount.get(a.author_id) ?? 0,
        topThemes: themesByAuthor.get(a.author_id) ?? [],
        read: w.total > 0 && w.read === w.total,
        hasSynthesis: hasSynth.has(a.author_id),
      };
    })
    .filter((a) => a.workCount > 0)
    .sort((a, b) => b.ideaCount - a.ideaCount || a.name.localeCompare(b.name));
}

// ─── Full dossier assembly (pure DB) ──────────────────────────────────────────

/** Theme labels touched by an author's ideas, keyed by idea global_id. */
function themesByIdeaForAuthor(authorId: string): Map<string, string[]> {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT itl.global_id AS gid, t.label AS label
         FROM work_authors wa
         JOIN idea_theme_links itl ON itl.nodus_id = wa.nodus_id
         JOIN themes t ON t.theme_id = itl.theme_id
        WHERE wa.author_id = ?`
    )
    .all(authorId) as { gid: string; label: string }[];
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const list = map.get(r.gid) ?? [];
    list.push(r.label);
    map.set(r.gid, list);
  }
  return map;
}

/** The distinct set of theme labels an author touches (for shared-theme overlap). */
function authorThemeSet(authorId: string): Set<string> {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT t.label AS label
         FROM work_authors wa
         JOIN idea_theme_links itl ON itl.nodus_id = wa.nodus_id
         JOIN themes t ON t.theme_id = itl.theme_id
        WHERE wa.author_id = ?`
    )
    .all(authorId) as { label: string }[];
  return new Set(rows.map((r) => r.label));
}

function loadIdeas(authorId: string): AuthorDossierIdea[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT io.global_id AS global_id, i.type AS type, i.label AS label, i.statement AS statement,
              io.role AS role, io.development AS development, io.confidence AS confidence,
              io.nodus_id AS workId, w.title AS workTitle, w.year AS year
         FROM work_authors wa
         JOIN works w ON w.nodus_id = wa.nodus_id AND w.archived = 0
         JOIN idea_occurrences io ON io.nodus_id = wa.nodus_id
         JOIN ideas i ON i.global_id = io.global_id
        WHERE wa.author_id = ?
        ORDER BY (io.role = 'principal') DESC, io.confidence DESC`
    )
    .all(authorId) as {
    global_id: string;
    type: IdeaType;
    label: string;
    statement: string;
    role: 'principal' | 'secondary';
    development: string;
    confidence: number;
    workId: string;
    workTitle: string;
    year: number | null;
  }[];

  // evidence for the author's works, grouped by idea+work
  const evRows = db
    .prepare(
      `SELECT ev.id, ev.global_id, ev.nodus_id, ev.quote, ev.location, ev.kind
         FROM evidence ev
         JOIN work_authors wa ON wa.nodus_id = ev.nodus_id
        WHERE wa.author_id = ?`
    )
    .all(authorId) as Evidence[];
  const evByKey = new Map<string, Evidence[]>();
  for (const ev of evRows) {
    const key = `${ev.global_id}::${ev.nodus_id}`;
    const list = evByKey.get(key) ?? [];
    list.push(ev);
    evByKey.set(key, list);
  }

  const themesByIdea = themesByIdeaForAuthor(authorId);

  // keep the strongest occurrence per idea (principal + highest confidence first)
  const seen = new Set<string>();
  const ideas: AuthorDossierIdea[] = [];
  for (const r of rows) {
    if (seen.has(r.global_id)) continue;
    seen.add(r.global_id);
    ideas.push({
      global_id: r.global_id,
      type: r.type,
      label: r.label,
      statement: r.statement,
      development: r.development,
      role: r.role,
      confidence: r.confidence,
      workId: r.workId,
      workTitle: r.workTitle,
      year: r.year,
      themes: themesByIdea.get(r.global_id) ?? [],
      evidence: evByKey.get(`${r.global_id}::${r.workId}`) ?? [],
    });
  }
  return ideas;
}

function loadRelations(authorId: string): AuthorDossierRelation[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT from_author, to_author, type, weight FROM author_relations
        WHERE (from_author = ? OR to_author = ?) AND from_author <> to_author`
    )
    .all(authorId, authorId) as { from_author: string; to_author: string; type: string; weight: number }[];
  if (rows.length === 0) return [];

  const names = new Map(
    (db.prepare('SELECT author_id, name FROM authors').all() as { author_id: string; name: string }[]).map(
      (a) => [a.author_id, a.name] as const
    )
  );
  const mine = authorThemeSet(authorId);
  const themeCache = new Map<string, Set<string>>();

  // aggregate per counterpart + relation type
  const agg = new Map<string, AuthorDossierRelation>();
  for (const r of rows) {
    const other = r.from_author === authorId ? r.to_author : r.from_author;
    if (!themeCache.has(other)) themeCache.set(other, authorThemeSet(other));
    const shared = [...themeCache.get(other)!].filter((t) => mine.has(t));
    const key = `${other}::${r.type}`;
    const cur = agg.get(key) ?? {
      author_id: other,
      name: names.get(other) ?? 'Autor',
      type: r.type,
      weight: 0,
      sharedThemes: shared,
    };
    cur.weight += r.weight;
    agg.set(key, cur);
  }
  return [...agg.values()].sort((a, b) => b.weight - a.weight);
}

function loadWorks(authorId: string): AuthorDossierWork[] {
  return (
    getDb()
      .prepare(
        `SELECT w.nodus_id, w.title, w.year, w.zotero_key AS zoteroKey, w.read_tag AS readTag, wa.role AS role
           FROM work_authors wa JOIN works w ON w.nodus_id = wa.nodus_id
          WHERE wa.author_id = ? AND w.archived = 0
          ORDER BY w.year DESC, w.title`
      )
      .all(authorId) as {
      nodus_id: string;
      title: string;
      year: number | null;
      zoteroKey: string | null;
      readTag: number;
      role: string | null;
    }[]
  ).map((w) => ({
    nodus_id: w.nodus_id,
    title: w.title,
    year: w.year,
    zoteroKey: w.zoteroKey,
    read: w.readTag === 1,
    role: w.role === 'editor' ? ('editor' as const) : ('author' as const),
  }));
}

/** Stable hash of the author's idea + relation set — invalidates a cached synthesis. */
function dossierFingerprint(ideas: AuthorDossierIdea[], relations: AuthorDossierRelation[]): string {
  const ideaPart = ideas
    .map((i) => i.global_id)
    .sort()
    .join(',');
  const relPart = relations
    .map((r) => `${r.author_id}:${r.type}`)
    .sort()
    .join(',');
  return createHash('sha1').update(`${ideaPart}|${relPart}`).digest('hex').slice(0, 16);
}

function readCachedSynthesis(authorId: string, fingerprint: string): AuthorDossierSynthesis | null {
  const row = getDb()
    .prepare(
      `SELECT thesis, remember_json, positioning, model_json, fingerprint, generated_at
         FROM author_dossier_synthesis WHERE author_id = ?`
    )
    .get(authorId) as
    | { thesis: string; remember_json: string; positioning: string; model_json: string | null; fingerprint: string; generated_at: string }
    | undefined;
  if (!row) return null;
  let remember: string[] = [];
  let model: ModelRef | null = null;
  try {
    remember = JSON.parse(row.remember_json);
  } catch {
    remember = [];
  }
  try {
    model = row.model_json ? (JSON.parse(row.model_json) as ModelRef) : null;
  } catch {
    model = null;
  }
  return {
    thesis: row.thesis,
    remember: Array.isArray(remember) ? remember : [],
    positioning: row.positioning,
    model,
    generatedAt: row.generated_at,
    stale: row.fingerprint !== fingerprint,
  };
}

/** Full study card for one author. Pure DB assembly; synthesis is read from cache. */
export function buildAuthorDossier(authorId: string): AuthorDossier | null {
  const db = getDb();
  const author = db
    .prepare('SELECT author_id, name, affiliation FROM authors WHERE author_id = ?')
    .get(authorId) as Author | undefined;
  if (!author) return null;

  const ideas = loadIdeas(authorId);
  const relations = loadRelations(authorId);
  const works = loadWorks(authorId);

  // overall theme list ordered by how many of the author's ideas touch each
  const themeFreq = new Map<string, number>();
  for (const idea of ideas) for (const t of idea.themes) themeFreq.set(t, (themeFreq.get(t) ?? 0) + 1);
  const themes = [...themeFreq.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);

  const fingerprint = dossierFingerprint(ideas, relations);
  const synthesis = readCachedSynthesis(authorId, fingerprint);
  const parts = splitName(author.name);

  return {
    author,
    fullName: parts.fullName,
    firstName: parts.firstName,
    lastName: parts.lastName,
    works,
    ideas,
    relations,
    themes,
    synthesis,
  };
}

// ─── AI synthesis (cached) ────────────────────────────────────────────────────

interface SynthesisResponse {
  thesis: string;
  remember: string[];
  positioning: string;
}

function isSynthesisResponse(v: unknown): v is SynthesisResponse {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.thesis === 'string' &&
    typeof o.positioning === 'string' &&
    Array.isArray(o.remember) &&
    o.remember.every((r) => typeof r === 'string')
  );
}

/** Generate and cache the narrated synthesis for one author. */
export async function synthesizeAuthorDossier(
  authorId: string,
  model?: ModelRef | null
): Promise<AuthorDossierSynthesis> {
  const dossier = buildAuthorDossier(authorId);
  if (!dossier) throw new Error('Autor no encontrado');

  const ideasByType = new Map<IdeaType, AuthorDossierIdea[]>();
  for (const idea of dossier.ideas.slice(0, MAX_IDEAS_IN_PROMPT)) {
    const list = ideasByType.get(idea.type) ?? [];
    list.push(idea);
    ideasByType.set(idea.type, list);
  }
  const ideaBlock = [...ideasByType.entries()]
    .map(([type, list]) => {
      const items = list.map((i) => `  - ${i.label}: ${clip(i.statement, STATEMENT_CLIP)}`).join('\n');
      return `${IDEA_TYPE_LABELS[type] ?? type} (${list.length}):\n${items}`;
    })
    .join('\n\n');

  const relBlock =
    dossier.relations.length > 0
      ? dossier.relations
          .slice(0, 20)
          .map((r) => {
            const rel = RELATION_TYPE_LABELS[r.type] ?? r.type;
            const shared = r.sharedThemes.length ? ` (temas comunes: ${r.sharedThemes.slice(0, 3).join(', ')})` : '';
            return `  - ${rel} ${r.name}${shared}`;
          })
          .join('\n')
      : '  (sin conexiones detectadas con otros autores en el corpus)';

  const themeLine = dossier.themes.length ? dossier.themes.slice(0, 8).join(', ') : '—';

  const system =
    'Eres un asistente de investigación académica. A partir de las ideas extraídas de las obras de UN autor y de sus relaciones con otros autores del corpus, ' +
    'produces una ficha de síntesis para alguien que necesita quedarse con lo esencial rápido. ' +
    'Sé fiel a las ideas proporcionadas: no inventes tesis, datos ni autores que no aparezcan. ' +
    'Devuelve EXCLUSIVAMENTE un JSON con la forma ' +
    '{"thesis": "1-2 frases con la tesis central del autor", "remember": ["punto clave", "…"], "positioning": "un párrafo sobre cómo se relaciona con los autores conectados"}. ' +
    `El campo "remember" debe tener entre 3 y ${MAX_REMEMBER} puntos breves y accionables.`;

  const user =
    `AUTOR: ${dossier.author.name}${dossier.author.affiliation ? ` — ${dossier.author.affiliation}` : ''}\n` +
    `TEMAS QUE TRABAJA: ${themeLine}\n\n` +
    `IDEAS DEL AUTOR:\n${ideaBlock || '  (sin ideas registradas)'}\n\n` +
    `RELACIONES CON OTROS AUTORES:\n${relBlock}\n\n` +
    'Devuelve el JSON de la ficha.';

  const chosen = model ?? getSettings().synthesisModel ?? null;
  const result = await completeJson<SynthesisResponse>({ system, user, temperature: 0.2 }, isSynthesisResponse, chosen);

  const remember = result.remember.map((r) => r.trim()).filter(Boolean).slice(0, MAX_REMEMBER);
  const fingerprint = dossierFingerprint(dossier.ideas, dossier.relations);
  const generatedAt = new Date().toISOString();

  getDb()
    .prepare(
      `INSERT INTO author_dossier_synthesis (author_id, thesis, remember_json, positioning, model_json, fingerprint, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(author_id) DO UPDATE SET
         thesis = excluded.thesis,
         remember_json = excluded.remember_json,
         positioning = excluded.positioning,
         model_json = excluded.model_json,
         fingerprint = excluded.fingerprint,
         generated_at = excluded.generated_at`
    )
    .run(
      authorId,
      result.thesis.trim(),
      JSON.stringify(remember),
      result.positioning.trim(),
      chosen ? JSON.stringify(chosen) : null,
      fingerprint,
      generatedAt
    );

  return {
    thesis: result.thesis.trim(),
    remember,
    positioning: result.positioning.trim(),
    model: chosen,
    generatedAt,
    stale: false,
  };
}
