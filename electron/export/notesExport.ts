// Structured export of the notes workspace, designed to be handed to an AI:
// folders and subfolders become a hierarchy, and each idea note carries its
// summary, the works that develop it (with bibliography or Zotero key), its
// anchored evidence and its connections to other ideas. Output is Markdown or
// JSON. All data is read locally — no Zotero network calls.
import fs from 'node:fs';
import path from 'node:path';
import { app, dialog } from 'electron';
import type { Note, NoteFolder, NotesExportOptions } from '@shared/types';
import { getNotesTree } from '../db/notesRepo';
import { getIdeaDetail, getIdeaEdges } from '../db/ideasRepo';

interface ExportNote {
  id: string;
  title: string;
  kind: string;
  createdAt: string;
  updatedAt: string;
  summary?: string;
  body?: string;
  works?: ExportWork[];
  evidence?: { quote: string; location: string | null }[];
  connections?: ExportConnection[];
}

interface ExportWork {
  title: string;
  authors: string[];
  year: number | null;
  itemType?: string | null;
  zoteroKey?: string | null;
  development?: string;
}

interface ExportConnection {
  relation: string;
  direction: 'outgoing' | 'incoming';
  towardsLabel: string;
  ideaId: string;
  confidence: number;
}

interface ExportFolder {
  id: string | null;
  name: string;
  /** The folder's brief (which ideas it should hold); omitted when empty. */
  summary?: string;
  path: string[];
  notes: ExportNote[];
  folders: ExportFolder[];
}

export async function exportNotes(options: NotesExportOptions): Promise<{ path: string } | null> {
  const tree = buildExportTree(options);
  const ext = options.format === 'json' ? 'json' : 'md';
  const baseName = tree.name ? slug(tree.name) : 'notas';
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Exportar notas',
    defaultPath: path.join(app.getPath('documents'), `${baseName}-export.${ext}`),
    filters: [
      options.format === 'json'
        ? { name: 'JSON', extensions: ['json'] }
        : { name: 'Markdown', extensions: ['md'] },
    ],
  });
  if (canceled || !filePath) return null;

  const content =
    options.format === 'json'
      ? JSON.stringify(
          { exportedAt: new Date().toISOString(), options, root: tree },
          null,
          2
        )
      : renderMarkdown(tree, options);
  fs.writeFileSync(filePath, content, 'utf8');
  return { path: filePath };
}

/** Build the folder/note hierarchy starting at the requested root. */
function buildExportTree(options: NotesExportOptions): ExportFolder {
  const { folders, notes } = getNotesTree();
  const byParent = new Map<string | null, NoteFolder[]>();
  for (const f of folders) {
    const list = byParent.get(f.parentId) ?? [];
    list.push(f);
    byParent.set(f.parentId, list);
  }
  const notesByFolder = new Map<string | null, Note[]>();
  for (const n of notes) {
    const list = notesByFolder.get(n.folderId) ?? [];
    list.push(n);
    notesByFolder.set(n.folderId, list);
  }
  for (const list of notesByFolder.values()) list.sort((a, b) => a.orderIdx - b.orderIdx);

  const buildFolder = (folder: NoteFolder, parentPath: string[]): ExportFolder => {
    const here = [...parentPath, folder.name];
    return {
      id: folder.id,
      name: folder.name,
      summary: folder.summary.trim() || undefined,
      path: here,
      notes: (notesByFolder.get(folder.id) ?? []).map((n) => gatherNote(n, options)),
      folders: (byParent.get(folder.id) ?? []).map((child) => buildFolder(child, here)),
    };
  };

  if (options.folderId) {
    const root = folders.find((f) => f.id === options.folderId);
    if (root) return buildFolder(root, []);
  }

  // Whole workspace: a synthetic root holding top-level folders and unfiled notes.
  return {
    id: null,
    name: 'Notas',
    path: [],
    notes: (notesByFolder.get(null) ?? []).map((n) => gatherNote(n, options)),
    folders: (byParent.get(null) ?? []).map((f) => buildFolder(f, [])),
  };
}

/** Collect a note's structured data, expanding idea notes via the graph. */
function gatherNote(note: Note, options: NotesExportOptions): ExportNote {
  const out: ExportNote = {
    id: note.id,
    title: note.title,
    kind: note.kind,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
  if (options.includeContent && note.content.trim()) out.body = note.content;

  const ideaId = note.kind === 'idea' ? note.source?.ref ?? null : null;
  if (!ideaId) return out;

  const detail = getIdeaDetail(ideaId);
  if (!detail) return out;
  if (detail.idea.statement) out.summary = detail.idea.statement;

  if (options.bibliography !== 'none' && detail.occurrences.length > 0) {
    out.works = detail.occurrences.map((o) => {
      const work: ExportWork = { title: o.work.title, authors: o.work.authors, year: o.work.year };
      if (o.development) work.development = o.development;
      if (options.bibliography === 'full') work.itemType = o.work.item_type;
      work.zoteroKey = o.work.zotero_key;
      return work;
    });
  }

  if (options.includeEvidence && detail.evidence.length > 0) {
    out.evidence = detail.evidence.map((e) => ({ quote: e.quote, location: e.location ?? null }));
  }

  if (options.includeRelations) {
    const edges = getIdeaEdges(ideaId);
    if (edges.length > 0) {
      out.connections = edges.map((e) => {
        const outgoing = e.edge.from_id === ideaId;
        return {
          relation: e.edge.type,
          direction: outgoing ? ('outgoing' as const) : ('incoming' as const),
          towardsLabel: outgoing ? e.toLabel : e.fromLabel,
          ideaId: outgoing ? e.edge.to_id : e.edge.from_id,
          confidence: e.edge.confidence,
        };
      });
    }
  }
  return out;
}

// ── Markdown rendering ───────────────────────────────────────────────────────

function renderMarkdown(root: ExportFolder, options: NotesExportOptions): string {
  const lines: string[] = [
    `# ${root.name}`,
    '',
    `> Exportación estructurada de notas — ${new Date().toLocaleString()}`,
    '',
  ];
  // Top-level notes (unfiled / direct children of the root) first.
  for (const note of root.notes) renderNote(lines, note, 2, options);
  for (const folder of root.folders) renderFolder(lines, folder, 2, options);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function renderFolder(lines: string[], folder: ExportFolder, depth: number, options: NotesExportOptions): void {
  const heading = '#'.repeat(Math.min(depth, 6));
  lines.push('', `${heading} ${folder.path.join(' › ') || folder.name}`, '');
  if (folder.summary) lines.push(`**Resumen de la carpeta:** ${folder.summary}`, '');
  for (const note of folder.notes) renderNote(lines, note, depth + 1, options);
  for (const child of folder.folders) renderFolder(lines, child, depth + 1, options);
}

function renderNote(lines: string[], note: ExportNote, depth: number, options: NotesExportOptions): void {
  const heading = '#'.repeat(Math.min(depth, 6));
  const tag = note.kind === 'idea' ? ' _(idea)_' : '';
  lines.push(`${heading} ${note.title}${tag}`, '');
  if (note.summary) lines.push(`**Resumen:** ${note.summary}`, '');

  if (note.works && note.works.length > 0) {
    lines.push('**Obras que la desarrollan:**');
    for (const w of note.works) lines.push(`- ${renderWork(w, options.bibliography)}`);
    lines.push('');
  }

  if (note.evidence && note.evidence.length > 0) {
    lines.push('**Evidencia anclada:**');
    for (const ev of note.evidence) {
      const loc = ev.location ? ` (${ev.location})` : '';
      lines.push(`- "${ev.quote}"${loc}`);
    }
    lines.push('');
  }

  if (note.connections && note.connections.length > 0) {
    lines.push('**Conexiones:**');
    for (const c of note.connections) {
      const arrow = c.direction === 'outgoing' ? '→' : '←';
      lines.push(`- ${c.relation} ${arrow} ${c.towardsLabel} (conf ${c.confidence.toFixed(2)})`);
    }
    lines.push('');
  }

  if (note.body) lines.push(note.body, '');
}

function renderWork(w: ExportWork, bibliography: NotesExportOptions['bibliography']): string {
  const authors = w.authors.length ? w.authors.join('; ') : 'Autoría no disponible';
  const year = w.year ? ` (${w.year})` : '';
  const zot = w.zoteroKey ? ` [zotero:${w.zoteroKey}]` : '';
  let head: string;
  if (bibliography === 'zotero') {
    head = `${w.title}${zot}`;
  } else {
    const type = w.itemType ? `, ${w.itemType}` : '';
    head = `${authors}${year}. *${w.title}*${type}.${zot}`;
  }
  return w.development ? `${head} — _${w.development}_` : head;
}

function slug(value: string): string {
  const clean = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return clean || 'notas';
}
