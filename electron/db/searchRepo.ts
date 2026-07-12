// Global search across the workspace: ideas, works, gaps, themes, authors and
// notes. Each match is shaped into a GlobalSearchResult that carries enough to
// route the user to the right surface (graph node, reading view, gaps, the note
// editor, …). Plain LIKE queries — cheap, runs only when the user searches.
import type { GapKind, GlobalSearchResult, SearchResultDetail, SearchResultKind } from '@shared/types';
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

  // ── Records / genealogy (empty and cheap in academic vaults) ────────────────
  const persons = db
    .prepare(
      `SELECT p.person_id, p.display_name, p.birth_date, p.death_date FROM persons p
        LEFT JOIN person_names n ON n.person_id = p.person_id
        WHERE p.display_name LIKE ? ESCAPE '\\' OR n.name LIKE ? ESCAPE '\\'
        GROUP BY p.person_id ORDER BY length(p.display_name) ASC LIMIT ?`
    )
    .all(like, like, limitPerKind) as { person_id: string; display_name: string; birth_date: string | null; death_date: string | null }[];
  for (const r of persons) {
    const life = [r.birth_date, r.death_date].map((d) => d?.trim()).filter(Boolean).join(' – ');
    results.push({ kind: 'person', id: r.person_id, title: r.display_name, subtitle: life || null });
  }

  const events = db
    .prepare(
      `SELECT e.event_id, e.type, e.label, e.date, pl.name AS place_name FROM events e
        LEFT JOIN places pl ON pl.place_id = e.place_id
        WHERE e.label LIKE ? ESCAPE '\\' OR e.date LIKE ? ESCAPE '\\' OR pl.name LIKE ? ESCAPE '\\'
        ORDER BY (e.date_sort IS NULL), e.date_sort ASC LIMIT ?`
    )
    .all(like, like, like, limitPerKind) as { event_id: string; type: string; label: string | null; date: string | null; place_name: string | null }[];
  for (const r of events) {
    const title = r.label?.trim() || [EVENT_TYPE_LABEL[r.type] ?? r.type, r.date?.trim()].filter(Boolean).join(' · ');
    results.push({ kind: 'event', id: r.event_id, title, subtitle: r.place_name || null });
  }

  const archive = db
    .prepare(
      `SELECT item_id, title, doc_type, extracted_text, description FROM archive_items
        WHERE title LIKE ? ESCAPE '\\' OR extracted_text LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
        ORDER BY updated_at DESC LIMIT ?`
    )
    .all(like, like, like, limitPerKind) as { item_id: string; title: string; doc_type: string | null; extracted_text: string | null; description: string | null }[];
  for (const r of archive) {
    results.push({
      kind: 'archive',
      id: r.item_id,
      title: r.title || '(documento sin título)',
      subtitle: r.doc_type || null,
      snippet: snippet(r.extracted_text ?? r.description),
    });
  }

  return results;
}

// Event-type labels (Spanish source language, like the rest of the records layer).
const EVENT_TYPE_LABEL: Record<string, string> = {
  birth: 'Nacimiento',
  baptism: 'Bautismo',
  marriage: 'Matrimonio',
  death: 'Defunción',
  burial: 'Entierro',
  census: 'Censo',
  residence: 'Residencia',
  migration: 'Migración',
  occupation: 'Ocupación',
  other: 'Evento',
};

function textValue(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function metadata(entries: Array<[string, unknown]>): SearchResultDetail['metadata'] {
  return entries
    .map(([label, value]) => ({ label, value: textValue(value) }))
    .filter((entry): entry is { label: string; value: string } => entry.value !== null);
}

/** Load the richest safe local detail for the shared search-result modal. */
export function getSearchResultDetail(kind: SearchResultKind, id: string): SearchResultDetail | null {
  const db = getDb();
  switch (kind) {
    case 'idea': {
      const row = db
        .prepare('SELECT global_id, type, label, statement, created_at FROM ideas WHERE global_id = ?')
        .get(id) as { global_id: string; type: string; label: string; statement: string; created_at: string } | undefined;
      if (!row) return null;
      const works = db
        .prepare(
          `SELECT w.title, o.role, o.development, o.confidence
           FROM idea_occurrences o JOIN works w ON w.nodus_id = o.nodus_id
           WHERE o.global_id = ? ORDER BY o.confidence DESC`
        )
        .all(id) as Array<{ title: string; role: string; development: string; confidence: number }>;
      const evidence = db
        .prepare('SELECT quote, location, kind FROM evidence WHERE global_id = ? ORDER BY rowid')
        .all(id) as Array<{ quote: string; location: string | null; kind: string }>;
      const themes = db
        .prepare(
          `SELECT DISTINCT t.label FROM idea_theme_links l
           JOIN themes t ON t.theme_id = l.theme_id WHERE l.global_id = ? ORDER BY t.label`
        )
        .all(id) as Array<{ label: string }>;
      return {
        kind,
        id,
        title: row.label,
        subtitle: row.type,
        description: row.statement,
        metadata: metadata([
          ['Tipo', row.type],
          ['Temas', themes.map((theme) => theme.label).join(', ')],
          ['Obras', works.length],
          ['Evidencias', evidence.length],
          ['Creada', row.created_at],
        ]),
        sections: [
          ...works.map((work) => ({
            title: `Obra · ${work.title}`,
            content: [work.role, work.development, `Confianza: ${Math.round((work.confidence ?? 0) * 100)}%`]
              .filter(Boolean)
              .join('\n\n'),
          })),
          ...evidence.map((item) => ({
            title: ['Evidencia', item.location].filter(Boolean).join(' · '),
            content: item.quote,
          })),
        ],
      };
    }
    case 'work': {
      const row = db
        .prepare(
          `SELECT w.nodus_id, w.title, w.authors_json, w.year, w.item_type, w.doi,
                  w.zotero_key, w.notes, w.source_type, s.summary
           FROM works w LEFT JOIN work_summaries s ON s.nodus_id = w.nodus_id
           WHERE w.nodus_id = ?`
        )
        .get(id) as
        | {
            nodus_id: string;
            title: string;
            authors_json: string | null;
            year: number | null;
            item_type: string | null;
            doi: string | null;
            zotero_key: string | null;
            notes: string | null;
            source_type: string | null;
            summary: string | null;
          }
        | undefined;
      if (!row) return null;
      const authors = parseAuthors(row.authors_json);
      const counts = db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM idea_occurrences WHERE nodus_id = ?) AS ideas,
             (SELECT COUNT(*) FROM passages WHERE nodus_id = ?) AS passages,
             (SELECT COUNT(*) FROM gaps WHERE nodus_id = ?) AS gaps`
        )
        .get(id, id, id) as { ideas: number; passages: number; gaps: number };
      return {
        kind,
        id,
        title: row.title || '(sin título)',
        subtitle: authors.join('; ') || null,
        description: row.summary || row.notes,
        metadata: metadata([
          ['Autoría', authors.join('; ')],
          ['Año', row.year],
          ['Tipo de obra', row.item_type],
          ['DOI', row.doi],
          ['Clave de Zotero', row.zotero_key],
          ['Fuente de texto', row.source_type],
          ['Ideas', counts.ideas],
          ['Pasajes', counts.passages],
          ['Huecos', counts.gaps],
        ]),
        sections: row.notes && row.notes !== row.summary ? [{ title: 'Notas', content: row.notes }] : [],
      };
    }
    case 'passage': {
      const row = db
        .prepare(
          `SELECT p.passage_id, p.text, p.page_label, p.chunk_index, p.char_len,
                  p.created_at, w.nodus_id, w.title, w.authors_json, w.year, w.zotero_key
           FROM passages p JOIN works w ON w.nodus_id = p.nodus_id WHERE p.passage_id = ?`
        )
        .get(id) as
        | {
            passage_id: string;
            text: string;
            page_label: string | null;
            chunk_index: number;
            char_len: number;
            created_at: string;
            nodus_id: string;
            title: string;
            authors_json: string | null;
            year: number | null;
            zotero_key: string | null;
          }
        | undefined;
      if (!row) return null;
      return {
        kind,
        id,
        title: row.title,
        subtitle: parseAuthors(row.authors_json).join('; ') || null,
        description: row.text,
        metadata: metadata([
          ['Página', row.page_label],
          ['Año', row.year],
          ['Fragmento', row.chunk_index + 1],
          ['Caracteres', row.char_len],
          ['Clave de Zotero', row.zotero_key],
          ['Indexado', row.created_at],
        ]),
        sections: [],
      };
    }
    case 'gap': {
      const row = db
        .prepare(
          `SELECT g.id, g.kind, g.statement, g.confidence, w.title, w.authors_json,
                  w.year, i.label AS idea_label, e.quote, e.location
           FROM gaps g JOIN works w ON w.nodus_id = g.nodus_id
           LEFT JOIN ideas i ON i.global_id = g.related_idea
           LEFT JOIN evidence e ON e.id = g.evidence_id WHERE g.id = ?`
        )
        .get(id) as
        | {
            id: string;
            kind: string;
            statement: string;
            confidence: number;
            title: string;
            authors_json: string | null;
            year: number | null;
            idea_label: string | null;
            quote: string | null;
            location: string | null;
          }
        | undefined;
      if (!row) return null;
      return {
        kind,
        id,
        title: row.statement,
        subtitle: row.kind,
        description: null,
        metadata: metadata([
          ['Tipo', row.kind],
          ['Confianza', `${Math.round(row.confidence * 100)}%`],
          ['Obra', row.title],
          ['Autoría', parseAuthors(row.authors_json).join('; ')],
          ['Año', row.year],
          ['Idea relacionada', row.idea_label],
        ]),
        sections: row.quote ? [{ title: ['Evidencia', row.location].filter(Boolean).join(' · '), content: row.quote }] : [],
      };
    }
    case 'theme': {
      const row = db.prepare('SELECT theme_id, label, pinned, created_at FROM themes WHERE theme_id = ?').get(id) as
        | { theme_id: string; label: string; pinned: number; created_at: string }
        | undefined;
      if (!row) return null;
      const counts = db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM work_themes WHERE theme_id = ?) AS works,
             (SELECT COUNT(DISTINCT global_id) FROM idea_theme_links WHERE theme_id = ?) AS ideas`
        )
        .get(id, id) as { works: number; ideas: number };
      return {
        kind,
        id,
        title: row.label,
        subtitle: row.pinned ? 'Tema principal' : 'Tema',
        description: null,
        metadata: metadata([
          ['Obras', counts.works],
          ['Ideas', counts.ideas],
          ['Fijado', row.pinned ? 'Sí' : 'No'],
          ['Creado', row.created_at],
        ]),
        sections: [],
      };
    }
    case 'author': {
      const row = db
        .prepare('SELECT author_id, name, affiliation, canonical_key FROM authors WHERE author_id = ?')
        .get(id) as { author_id: string; name: string; affiliation: string | null; canonical_key: string | null } | undefined;
      if (!row) return null;
      const works = db
        .prepare(
          `SELECT w.title, w.year FROM work_authors a JOIN works w ON w.nodus_id = a.nodus_id
           WHERE a.author_id = ? ORDER BY w.year DESC, w.title`
        )
        .all(id) as Array<{ title: string; year: number | null }>;
      const ideaCount = db
        .prepare(
          `SELECT COUNT(DISTINCT o.global_id) AS count FROM work_authors a
           JOIN idea_occurrences o ON o.nodus_id = a.nodus_id WHERE a.author_id = ?`
        )
        .get(id) as { count: number };
      return {
        kind,
        id,
        title: row.name,
        subtitle: row.affiliation,
        description: null,
        metadata: metadata([
          ['Afiliación', row.affiliation],
          ['Identidad canónica', row.canonical_key],
          ['Obras', works.length],
          ['Ideas', ideaCount.count],
        ]),
        sections: works.length
          ? [{ title: 'Obras', content: works.map((work) => `${work.title}${work.year ? ` (${work.year})` : ''}`).join('\n') }]
          : [],
      };
    }
    case 'note': {
      const row = db
        .prepare(
          `SELECT n.id, n.title, n.kind, n.content, n.created_at, n.updated_at, f.name AS folder
           FROM notes n LEFT JOIN note_folders f ON f.id = n.folder_id WHERE n.id = ?`
        )
        .get(id) as
        | { id: string; title: string; kind: string; content: string; created_at: string; updated_at: string; folder: string | null }
        | undefined;
      if (!row) return null;
      return {
        kind,
        id,
        title: row.title || '(nota sin título)',
        subtitle: row.folder,
        description: row.content,
        metadata: metadata([
          ['Tipo', row.kind],
          ['Carpeta', row.folder],
          ['Creada', row.created_at],
          ['Actualizada', row.updated_at],
        ]),
        sections: [],
      };
    }
    // Records kinds (person/event/archive) route straight to their view, not a modal.
    default:
      return null;
  }
}
