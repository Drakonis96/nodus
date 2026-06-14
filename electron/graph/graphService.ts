import { getDb } from '../db/database';
import type {
  GraphData,
  GraphNode,
  GraphEdge,
  IdeaType,
  EdgeDetail,
  ReadingPathEntry,
} from '@shared/types';
import { getEdgeDetail, ideasWithEmbeddings, cosineSimilarity } from '../db/ideasRepo';
import { listGraphThemes, normalizeThemeLabel } from '../db/themesRepo';

// Threshold for attaching an idea to a theme by meaning (cosine to the theme's idea
// cluster centroid). Conservative so unrelated ideas aren't pulled in.
const THEME_SIM_THRESHOLD = 0.72;
const MAX_INFERRED_THEMES_PER_IDEA = 1;

const THEME_KEYWORD_ALIASES: Record<string, string[]> = {
  franquismo: ['franquismo', 'franco', 'franquista', 'franquistas', 'dictadura', 'posguerra'],
  turismo: ['turismo', 'turista', 'turistas', 'turistico', 'turistica', 'tourism', 'tourist', 'tourists'],
  'literatura de viajes': ['literatura viajes', 'relato viaje', 'relatos viaje', 'escritura viajes', 'travel writing', 'travel literature'],
  'escritura de viajes': ['literatura viajes', 'relato viaje', 'relatos viaje', 'travel writing', 'travel literature'],
  género: ['genero', 'gender', 'mujeres', 'femenino', 'feminismo', 'viajeras'],
  'identidad nacional': ['identidad nacional', 'national identity', 'nacion', 'nacionalismo'],
  colonialismo: ['colonialismo', 'colonial', 'colonialism', 'imperialismo', 'imperial'],
};

const STOPWORDS = new Set([
  'a',
  'al',
  'and',
  'ante',
  'by',
  'con',
  'de',
  'del',
  'el',
  'en',
  'for',
  'in',
  'la',
  'las',
  'lo',
  'los',
  'of',
  'on',
  'or',
  'para',
  'por',
  'que',
  'se',
  'the',
  'to',
  'un',
  'una',
  'y',
]);

interface IdeaRow {
  global_id: string;
  type: IdeaType;
  label: string;
  statement: string;
}

interface ThemeMembership {
  edges: GraphEdge[];
  labelsByIdea: Map<string, Set<string>>;
}

/** Build the ideas-lens graph: idea nodes + typed edges, enriched for filtering. */
export function buildIdeaGraph(): GraphData {
  const db = getDb();
  const ideas = db.prepare('SELECT global_id, type, label, statement FROM ideas').all() as IdeaRow[];
  const themeRows = listGraphThemes();
  const memberships = buildThemeMemberships();
  const themeNodeIdsWithEdges = new Set(memberships.edges.map((e) => e.source));

  const ideaNodes: GraphNode[] = ideas.map((idea) => {
    const works = db
      .prepare(
        `SELECT w.nodus_id, w.year, w.authors_json, w.deep_status
         FROM idea_occurrences io JOIN works w ON w.nodus_id = io.nodus_id
         WHERE io.global_id = ?`
      )
      .all(idea.global_id) as { nodus_id: string; year: number | null; authors_json: string; deep_status: string }[];

    const maxConf = db
      .prepare('SELECT MAX(confidence) as c FROM idea_occurrences WHERE global_id = ?')
      .get(idea.global_id) as { c: number | null };

    const authors = new Set<string>();
    const years: number[] = [];
    let read = false;
    for (const w of works) {
      if (w.year != null) years.push(w.year);
      if (w.deep_status === 'done') read = true;
      try {
        for (const a of JSON.parse(w.authors_json || '[]')) authors.add(a);
      } catch {
        /* ignore */
      }
    }

    return {
      id: idea.global_id,
      label: idea.label,
      type: idea.type,
      statement: idea.statement,
      workCount: works.length,
      read,
      themes: Array.from(memberships.labelsByIdea.get(idea.global_id) ?? []).sort(),
      years,
      authors: Array.from(authors),
      maxConfidence: maxConf.c ?? 0,
    };
  });

  const visibleThemeRows = ideas.length === 0 ? themeRows : themeRows.filter((theme) => themeNodeIdsWithEdges.has(`theme:${theme.theme_id}`));
  const themeNodes: GraphNode[] = visibleThemeRows.map((theme) => {
    const works = db
      .prepare(
        `SELECT DISTINCT w.nodus_id, w.year, w.authors_json, w.deep_status
         FROM work_themes wt JOIN works w ON w.nodus_id = wt.nodus_id
         WHERE wt.theme_id = ? AND w.archived = 0`
      )
      .all(theme.theme_id) as { nodus_id: string; year: number | null; authors_json: string; deep_status: string }[];

    const authors = new Set<string>();
    const years: number[] = [];
    let read = false;
    for (const w of works) {
      if (w.year != null) years.push(w.year);
      if (w.deep_status === 'done') read = true;
      try {
        for (const a of JSON.parse(w.authors_json || '[]')) authors.add(a);
      } catch {
        /* ignore */
      }
    }

    return {
      id: `theme:${theme.theme_id}`,
      label: theme.label.toUpperCase(),
      type: 'theme',
      statement: `Familia temática: ${theme.label}`,
      workCount: theme.work_count,
      read,
      themes: [theme.label],
      years,
      authors: Array.from(authors),
      maxConfidence: 1,
    };
  });

  const nodes = [...themeNodes, ...ideaNodes];

  const edgeRows = db.prepare('SELECT * FROM edges').all() as {
    id: string;
    from_id: string;
    to_id: string;
    type: string;
    basis: 'explicit' | 'inferred';
    confidence: number;
  }[];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const ideaEdges: GraphEdge[] = edgeRows
    .filter((e) => nodeIds.has(e.from_id) && nodeIds.has(e.to_id))
    .map((e) => ({
      id: e.id,
      source: e.from_id,
      target: e.to_id,
      type: e.type,
      basis: e.basis,
      confidence: e.confidence,
    }));

  const themeEdges = memberships.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  // Attach ideas that predate their parent theme. Themes only "contain" an idea when
  // the same work carries both, so ideas analysed before a broad theme existed end up
  // orphaned. Here we link an idea to a theme when it's semantically close to that
  // theme's existing idea cluster (centroid of member embeddings), so the backlog of
  // ideas gets folded under the right parent without re-scanning.
  const inferredThemeEdges = buildSemanticThemeEdges(themeEdges, nodeIds);

  const edges = [...themeEdges, ...inferredThemeEdges, ...ideaEdges];

  return { nodes, edges };
}

function buildThemeMemberships(): ThemeMembership {
  const db = getDb();
  const edges = new Map<string, GraphEdge>();
  const labelsByIdea = new Map<string, Set<string>>();

  const add = (
    themeId: string,
    themeLabel: string,
    ideaId: string,
    confidence: number,
    basis: 'explicit' | 'inferred',
    idPrefix: string
  ) => {
    const source = `theme:${themeId}`;
    const key = `${source}|${ideaId}`;
    const existing = edges.get(key);
    if (existing && (existing.basis === 'explicit' || existing.confidence >= confidence)) return;
    edges.set(key, {
      id: `${idPrefix}:${themeId}:${ideaId}`,
      source,
      target: ideaId,
      type: 'contains',
      basis,
      confidence,
    });
    const labels = labelsByIdea.get(ideaId) ?? new Set<string>();
    labels.add(themeLabel);
    labelsByIdea.set(ideaId, labels);
  };

  const explicit = db
    .prepare(
      `SELECT it.theme_id, t.label, it.global_id, MAX(it.confidence) AS confidence
       FROM idea_theme_links it
       JOIN themes t ON t.theme_id = it.theme_id
       JOIN works w ON w.nodus_id = it.nodus_id
       WHERE w.archived = 0
       GROUP BY it.theme_id, it.global_id`
    )
    .all() as { theme_id: string; label: string; global_id: string; confidence: number }[];
  for (const row of explicit) add(row.theme_id, row.label, row.global_id, row.confidence, 'explicit', 'theme-link');

  const fallback = db
    .prepare(
      `SELECT
         wt.nodus_id,
         t.theme_id,
         t.label AS theme_label,
         io.global_id,
         i.label AS idea_label,
         i.statement,
         io.development,
         COALESCE(GROUP_CONCAT(e.quote, ' '), '') AS evidence_text,
         (SELECT COUNT(*) FROM work_themes wt2 WHERE wt2.nodus_id = wt.nodus_id) AS theme_count
       FROM work_themes wt
       JOIN themes t ON t.theme_id = wt.theme_id
       JOIN works w ON w.nodus_id = wt.nodus_id
       JOIN idea_occurrences io ON io.nodus_id = wt.nodus_id
       JOIN ideas i ON i.global_id = io.global_id
       LEFT JOIN evidence e ON e.nodus_id = io.nodus_id AND e.global_id = io.global_id
       WHERE w.archived = 0
         AND NOT EXISTS (
           SELECT 1 FROM idea_theme_links it
           WHERE it.nodus_id = io.nodus_id AND it.global_id = io.global_id
         )
       GROUP BY wt.nodus_id, t.theme_id, io.global_id`
    )
    .all() as {
      nodus_id: string;
      theme_id: string;
      theme_label: string;
      global_id: string;
      idea_label: string;
      statement: string;
      development: string;
      evidence_text: string;
      theme_count: number;
    }[];

  for (const row of fallback) {
    const text = `${row.idea_label}. ${row.statement}. ${row.development}. ${row.evidence_text}`;
    const score = row.theme_count <= 1 ? 0.72 : themeRelevance(row.theme_label, text);
    if (score >= 0.62) add(row.theme_id, row.theme_label, row.global_id, Number(score.toFixed(3)), 'inferred', 'theme-edge');
  }

  return { edges: Array.from(edges.values()), labelsByIdea };
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): Set<string> {
  return new Set(normalizeText(text).split(' ').filter((t) => t.length > 2 && !STOPWORDS.has(t)));
}

function themeRelevance(themeLabel: string, ideaText: string): number {
  const theme = normalizeThemeLabel(themeLabel);
  const normalizedIdea = normalizeText(ideaText);
  const normalizedTheme = normalizeText(theme);
  if (!normalizedTheme) return 0;
  if (normalizedIdea.includes(normalizedTheme)) return 1;

  const themeTokens = Array.from(tokenize(theme));
  const ideaTokens = tokenize(ideaText);
  const direct = themeTokens.length
    ? themeTokens.filter((token) => ideaTokens.has(token)).length / themeTokens.length
    : 0;

  const aliases = THEME_KEYWORD_ALIASES[theme] ?? [];
  const aliasHit = aliases.some((alias) => normalizedIdea.includes(normalizeText(alias)));
  const aliasScore = aliasHit ? (themeTokens.length <= 1 ? 1 : 0.72) : 0;
  const thresholdedDirect = themeTokens.length <= 1 ? (direct >= 1 ? 1 : 0) : direct;

  return Math.max(thresholdedDirect, aliasScore);
}

/** Mean of equal-length vectors; null if there are none. */
function centroid(vectors: number[][]): number[] | null {
  if (vectors.length === 0) return null;
  const dim = vectors[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) sum[i] += v[i] ?? 0;
  for (let i = 0; i < dim; i++) sum[i] /= vectors.length;
  return sum;
}

/**
 * Derive extra theme→idea "contains" edges by meaning. For each theme we average the
 * embeddings of the ideas it already contains, then link any other embedded idea whose
 * cosine to that centroid clears the threshold (capped per idea). Pairs that already
 * have an explicit same-work edge are skipped. No-op when ideas lack embeddings.
 */
function buildSemanticThemeEdges(themeEdges: GraphEdge[], nodeIds: Set<string>): GraphEdge[] {
  const embByIdea = new Map<string, number[]>();
  for (const i of ideasWithEmbeddings()) embByIdea.set(i.global_id, i.embedding);
  if (embByIdea.size === 0) return [];

  // Existing theme→idea membership and per-theme member ideas.
  const connected = new Set<string>();
  const membersByTheme = new Map<string, string[]>();
  for (const e of themeEdges) {
    connected.add(`${e.source}|${e.target}`);
    const list = membersByTheme.get(e.source) ?? [];
    list.push(e.target);
    membersByTheme.set(e.source, list);
  }

  const centroids = new Map<string, number[]>();
  for (const [themeId, members] of membersByTheme) {
    const c = centroid(members.map((m) => embByIdea.get(m)).filter((v): v is number[] => !!v));
    if (c) centroids.set(themeId, c);
  }
  if (centroids.size === 0) return [];

  const out: GraphEdge[] = [];
  for (const [ideaId, emb] of embByIdea) {
    if (!nodeIds.has(ideaId)) continue;
    const scored: { themeId: string; sim: number }[] = [];
    for (const [themeId, c] of centroids) {
      if (connected.has(`${themeId}|${ideaId}`)) continue;
      if (!nodeIds.has(themeId)) continue;
      const sim = cosineSimilarity(emb, c);
      if (sim >= THEME_SIM_THRESHOLD) scored.push({ themeId, sim });
    }
    scored.sort((a, b) => b.sim - a.sim);
    for (const { themeId, sim } of scored.slice(0, MAX_INFERRED_THEMES_PER_IDEA)) {
      out.push({
        id: `theme-sim:${themeId}:${ideaId}`,
        source: themeId,
        target: ideaId,
        type: 'contains',
        basis: 'inferred',
        confidence: Number(sim.toFixed(3)),
      });
    }
  }
  return out;
}

/** Build the authors-lens graph from the derived author_relations table. */
export function buildAuthorGraph(): GraphData {
  const db = getDb();
  const authors = db.prepare('SELECT author_id, name FROM authors').all() as { author_id: string; name: string }[];

  const nodes: GraphNode[] = authors.map((a) => {
    const works = db
      .prepare(
        `SELECT w.year, w.deep_status FROM work_authors wa JOIN works w ON w.nodus_id = wa.nodus_id WHERE wa.author_id = ?`
      )
      .all(a.author_id) as { year: number | null; deep_status: string }[];
    const years = works.map((w) => w.year).filter((y): y is number => y != null);
    const read = works.some((w) => w.deep_status === 'done');
    return {
      id: a.author_id,
      label: a.name,
      type: 'author',
      workCount: works.length,
      read,
      themes: [],
      years,
      authors: [a.name],
      maxConfidence: 1,
    };
  });

  const relRows = db.prepare('SELECT * FROM author_relations').all() as {
    from_author: string;
    to_author: string;
    type: string;
    weight: number;
  }[];
  const edges: GraphEdge[] = relRows.map((r, i) => ({
    id: `ar-${i}`,
    source: r.from_author,
    target: r.to_author,
    type: r.type,
    basis: 'inferred',
    confidence: Math.min(1, r.weight),
  }));

  return { nodes, edges };
}

/** Unresolved contradictions across the corpus (contradicts/refutes edges). */
export function getContradictions(): EdgeDetail[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT id FROM edges WHERE type IN ('contradicts','refutes')")
    .all() as { id: string }[];
  return rows.map((r) => getEdgeDetail(r.id)).filter((x): x is EdgeDetail => x !== null);
}

/**
 * Reading path: seminal works first (most-developed ideas, most cited), then by
 * cluster. Unread works are surfaced — answering "where do I start?".
 */
export function buildReadingPath(): ReadingPathEntry[] {
  const db = getDb();
  const works = db
    .prepare('SELECT nodus_id, title, authors_json, year, deep_status FROM works WHERE archived = 0')
    .all() as { nodus_id: string; title: string; authors_json: string; year: number | null; deep_status: string }[];

  const entries: ReadingPathEntry[] = works.map((w) => {
    const ideaCount = (
      db.prepare('SELECT COUNT(*) as c FROM idea_occurrences WHERE nodus_id = ?').get(w.nodus_id) as { c: number }
    ).c;
    // Rough "seminal" signal: how often other works cite something matching this title/year.
    const firstAuthor = (() => {
      try {
        return (JSON.parse(w.authors_json || '[]')[0] as string | undefined)?.split(',')[0] ?? '';
      } catch {
        return '';
      }
    })();
    const citedBy = firstAuthor
      ? (
          db
            .prepare("SELECT COUNT(*) as c FROM external_refs WHERE cited_work LIKE '%' || ? || '%'")
            .get(firstAuthor) as { c: number }
        ).c
      : 0;
    const themes = (
      db
        .prepare(
          `SELECT t.label FROM work_themes wt JOIN themes t ON t.theme_id = wt.theme_id WHERE wt.nodus_id = ?`
        )
        .all(w.nodus_id) as { label: string }[]
    ).map((t) => t.label);

    const read = w.deep_status === 'done';
    // Seminal = many ideas developed; older + foundational ranked first; unread boosted for visibility.
    const score = ideaCount * 3 + citedBy + (read ? 0 : 2);
    let authors: string[] = [];
    try {
      authors = JSON.parse(w.authors_json || '[]');
    } catch {
      authors = [];
    }
    return {
      nodus_id: w.nodus_id,
      title: w.title,
      authors,
      year: w.year,
      themes,
      read,
      score,
      reason: read
        ? `${ideaCount} ideas desarrolladas`
        : `No leída · ${ideaCount} ideas detectadas en escaneo ligero`,
    };
  });

  return entries.sort((a, b) => b.score - a.score);
}
