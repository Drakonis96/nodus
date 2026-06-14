import { getDb } from '../db/database';
import type {
  GraphData,
  GraphNode,
  GraphEdge,
  IdeaType,
  EdgeDetail,
  ReadingPathEntry,
} from '@shared/types';
import { getEdgeDetail } from '../db/ideasRepo';

interface IdeaRow {
  global_id: string;
  type: IdeaType;
  label: string;
  statement: string;
}

interface ThemeRow {
  theme_id: string;
  label: string;
}

/** Build the ideas-lens graph: idea nodes + typed edges, enriched for filtering. */
export function buildIdeaGraph(): GraphData {
  const db = getDb();
  const ideas = db.prepare('SELECT global_id, type, label, statement FROM ideas').all() as IdeaRow[];
  const themeRows = db.prepare('SELECT theme_id, label FROM themes ORDER BY label').all() as ThemeRow[];

  const ideaNodes: GraphNode[] = ideas.map((idea) => {
    const works = db
      .prepare(
        `SELECT w.nodus_id, w.year, w.authors_json, w.deep_status
         FROM idea_occurrences io JOIN works w ON w.nodus_id = io.nodus_id
         WHERE io.global_id = ?`
      )
      .all(idea.global_id) as { nodus_id: string; year: number | null; authors_json: string; deep_status: string }[];

    const themes = db
      .prepare(
        `SELECT DISTINCT t.label FROM idea_occurrences io
         JOIN work_themes wt ON wt.nodus_id = io.nodus_id
         JOIN themes t ON t.theme_id = wt.theme_id
         WHERE io.global_id = ?`
      )
      .all(idea.global_id) as { label: string }[];

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
      themes: themes.map((t) => t.label),
      years,
      authors: Array.from(authors),
      maxConfidence: maxConf.c ?? 0,
    };
  });

  const themeNodes: GraphNode[] = themeRows.map((theme) => {
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
      workCount: works.length,
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

  const themeEdgeRows = db
    .prepare(
      `SELECT DISTINCT t.theme_id, io.global_id
       FROM work_themes wt
       JOIN themes t ON t.theme_id = wt.theme_id
       JOIN idea_occurrences io ON io.nodus_id = wt.nodus_id`
    )
    .all() as { theme_id: string; global_id: string }[];
  const themeEdges: GraphEdge[] = themeEdgeRows
    .map((r) => ({
      id: `theme-edge:${r.theme_id}:${r.global_id}`,
      source: `theme:${r.theme_id}`,
      target: r.global_id,
      type: 'contains',
      basis: 'inferred' as const,
      confidence: 0.9,
    }))
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  const edges = [...themeEdges, ...ideaEdges];

  return { nodes, edges };
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
