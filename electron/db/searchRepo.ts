// Global search across the workspace: ideas, works, gaps, themes, authors and
// notes. Each match is shaped into a GlobalSearchResult that carries enough to
// route the user to the right surface (graph node, reading view, gaps, the note
// editor, …). Plain LIKE queries — cheap, runs only when the user searches.
import type { GapKind, GlobalSearchResult } from '@shared/types';
import { getDb } from './database';

interface IdeaRow {
  global_id: string;
  type: string;
  label: string;
  statement: string;
}
interface WorkRow {
  nodus_id: string;
  title: string;
  authors_json: string | null;
  year: number | null;
  zotero_key: string | null;
}
interface GapRow {
  id: string;
  kind: string;
  statement: string;
}
interface ThemeRow {
  theme_id: string;
  label: string;
}
interface AuthorRow {
  author_id: string;
  name: string;
  affiliation: string | null;
}
interface NoteRow {
  id: string;
  title: string;
  kind: string;
  content: string;
}

function likeParam(query: string): string {
  return `%${query.replace(/[%_]/g, (m) => `\\${m}`)}%`;
}

function snippet(text: string | null | undefined, max = 140): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function parseAuthors(json: string | null): string[] {
  if (!json) return [];
  try {
    const value = JSON.parse(json);
    if (Array.isArray(value)) return value.map((a) => String(a)).filter(Boolean);
  } catch {
    /* ignore malformed author blobs */
  }
  return [];
}

export function globalSearch(query: string, limitPerKind = 8): GlobalSearchResult[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const like = likeParam(q);
  const db = getDb();
  const results: GlobalSearchResult[] = [];

  const ideas = db
    .prepare(
      `SELECT global_id, type, label, statement FROM ideas
        WHERE orphaned_at IS NULL
          AND (label LIKE ? ESCAPE '\\' OR statement LIKE ? ESCAPE '\\')
        ORDER BY length(label) ASC LIMIT ?`
    )
    .all(like, like, limitPerKind) as IdeaRow[];
  for (const r of ideas) {
    results.push({
      kind: 'idea',
      id: r.global_id,
      title: r.label,
      snippet: snippet(r.statement),
      ideaType: r.type,
    });
  }

  const works = db
    .prepare(
      `SELECT nodus_id, title, authors_json, year, zotero_key FROM works
        WHERE archived = 0 AND (title LIKE ? ESCAPE '\\' OR authors_json LIKE ? ESCAPE '\\')
        ORDER BY length(title) ASC LIMIT ?`
    )
    .all(like, like, limitPerKind) as WorkRow[];
  for (const r of works) {
    const authors = parseAuthors(r.authors_json);
    const sub = [authors.slice(0, 3).join('; ') || null, r.year ? String(r.year) : null]
      .filter(Boolean)
      .join(' · ');
    results.push({
      kind: 'work',
      id: r.nodus_id,
      title: r.title || '(sin título)',
      subtitle: sub || null,
      zoteroKey: r.zotero_key,
    });
  }

  const gaps = db
    .prepare(
      `SELECT id, kind, statement FROM gaps
        WHERE statement LIKE ? ESCAPE '\\'
        ORDER BY confidence DESC LIMIT ?`
    )
    .all(like, limitPerKind) as GapRow[];
  for (const r of gaps) {
    results.push({
      kind: 'gap',
      id: r.id,
      title: snippet(r.statement, 120) ?? r.statement,
      gapKind: r.kind as GapKind,
    });
  }

  const themes = db
    .prepare(
      `SELECT theme_id, label FROM themes
        WHERE label LIKE ? ESCAPE '\\'
        ORDER BY length(label) ASC LIMIT ?`
    )
    .all(like, limitPerKind) as ThemeRow[];
  for (const r of themes) {
    results.push({ kind: 'theme', id: r.theme_id, title: r.label, themeLabel: r.label });
  }

  const authors = db
    .prepare(
      `SELECT author_id, name, affiliation FROM authors
        WHERE name LIKE ? ESCAPE '\\'
        ORDER BY length(name) ASC LIMIT ?`
    )
    .all(like, limitPerKind) as AuthorRow[];
  for (const r of authors) {
    results.push({
      kind: 'author',
      id: r.author_id,
      title: r.name,
      subtitle: r.affiliation || null,
    });
  }

  const notes = db
    .prepare(
      `SELECT id, title, kind, content FROM notes
        WHERE title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\'
        ORDER BY updated_at DESC LIMIT ?`
    )
    .all(like, like, limitPerKind) as NoteRow[];
  for (const r of notes) {
    results.push({
      kind: 'note',
      id: r.id,
      title: r.title || '(nota sin título)',
      snippet: snippet(r.content),
    });
  }

  return results;
}
