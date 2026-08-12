// Workspace unification (schema v130): Notas, Escritura y Proyectos pasan a ser UNA
// sola sección. Este módulo es la parte que mueve datos, y vive fuera de migrations.ts
// para que el test pueda ejecutarlo dos veces sobre la misma base y comprobar que la
// segunda pasada no duplica ni corrompe nada.
//
// TRES REGLAS QUE NO SE NEGOCIAN:
//
//  1. NADA SE BORRA. Las tablas `projects`, `project_sections`, `project_chapters` y
//     `writing_saved_drafts` siguen intactas después de migrar. La migración solo AÑADE
//     colecciones y notas y anota el enlace en las dos direcciones. Si algo saliera mal
//     en la vista nueva, el contenido original sigue exactamente donde estaba.
//
//  2. ES IDEMPOTENTE POR CONSTRUCCIÓN, no por suerte. Cada objeto migrado deja una
//     marca — `note_folders.source_ref` para las colecciones, `project_chapters.note_id`
//     y `writing_saved_drafts.note_id` para las notas — y esa marca es lo que se consulta
//     antes de crear nada. Un índice único sobre `source_ref` convierte "no duplicar
//     colecciones" en una garantía del motor, no en una promesa del código.
//
//  3. LOS INFORMES DE DEEP RESEARCH NO SE TOCAN. Comparten tabla con los documentos
//     guardados de Escritura (`writing_saved_drafts`), pero tienen su propia galería y su
//     propio ciclo de vida: migrarlos llenaría el Workspace de copias de algo que ya se
//     lee en otro sitio. Se distinguen por `brief.kind === 'deep_research'`.
//
// Los proyectos creados desde la aplicación YA se reflejaban en el árbol de notas (una
// carpeta raíz «Proyecto - X», una subcarpeta por sección y una nota por capítulo), así
// que para la mayoría de bóvedas esto solo confirma y completa lo que ya existe. Lo que
// arregla son los casos torcidos: una carpeta raíz borrada a mano, un capítulo importado
// cuya nota se eliminó, o una sección sin carpeta.

import type Database from 'better-sqlite3';
import crypto from 'node:crypto';

export interface WorkspaceMigrationReport {
  /** Colecciones creadas (proyectos que no tenían carpeta raíz utilizable). */
  collectionsCreated: number;
  /** Colecciones adoptadas: la carpeta del proyecto ya existía y solo se ha marcado. */
  collectionsAdopted: number;
  /** Subcolecciones creadas para secciones de proyecto que no tenían carpeta. */
  sectionCollectionsCreated: number;
  /** Notas creadas a partir de capítulos que habían perdido (o nunca tuvieron) la suya. */
  chapterNotesCreated: number;
  /** Notas creadas a partir de documentos guardados en Escritura. */
  writingNotesCreated: number;
}

interface Row {
  [column: string]: unknown;
}

const nowIso = () => new Date().toISOString();

const text = (value: unknown): string => (value == null ? '' : String(value));

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return value ? (JSON.parse(String(value)) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** El `source_ref` canónico de la colección de un proyecto. */
export function projectCollectionRef(projectId: string): string {
  return `project:${projectId}`;
}

/** El `source_ref` de la colección donde aterrizan los documentos de Escritura. */
export const WRITING_COLLECTION_REF = 'writing';

/** Marca de procedencia que llevan las notas creadas desde un documento de Escritura. */
export const WRITING_NOTE_MARKER = 'writing-draft';

/** Marca de procedencia de las notas creadas desde un capítulo de proyecto. */
export const PROJECT_CHAPTER_NOTE_MARKER = 'project-chapter';

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
  );
}

function nextFolderOrder(db: Database.Database, parentId: string | null): number {
  const row = db
    .prepare(
      parentId === null
        ? 'SELECT COALESCE(MAX(order_idx), -1) AS max FROM note_folders WHERE parent_id IS NULL'
        : 'SELECT COALESCE(MAX(order_idx), -1) AS max FROM note_folders WHERE parent_id = ?'
    )
    .get(...(parentId === null ? [] : [parentId])) as { max: number };
  return row.max + 1;
}

function nextNoteOrder(db: Database.Database, folderId: string | null): number {
  const row = db
    .prepare(
      folderId === null
        ? 'SELECT COALESCE(MAX(order_idx), -1) AS max FROM notes WHERE folder_id IS NULL'
        : 'SELECT COALESCE(MAX(order_idx), -1) AS max FROM notes WHERE folder_id = ?'
    )
    .get(...(folderId === null ? [] : [folderId])) as { max: number };
  return row.max + 1;
}

function folderExists(db: Database.Database, id: string | null): boolean {
  if (!id) return false;
  return Boolean(db.prepare('SELECT 1 FROM note_folders WHERE id = ?').get(id));
}

function noteExists(db: Database.Database, id: string | null): boolean {
  if (!id) return false;
  return Boolean(db.prepare('SELECT 1 FROM notes WHERE id = ?').get(id));
}

function createFolder(
  db: Database.Database,
  input: { name: string; parentId: string | null; summary?: string; sourceRef?: string | null }
): string {
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO note_folders (id, parent_id, name, summary, order_idx, source_ref, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.parentId,
    input.name.trim() || 'Colección sin título',
    input.summary ?? '',
    nextFolderOrder(db, input.parentId),
    input.sourceRef ?? null,
    timestamp,
    timestamp
  );
  return id;
}

function createNote(
  db: Database.Database,
  input: {
    title: string;
    content: string;
    kind: string;
    folderId: string | null;
    source: unknown;
    createdAt?: string;
    updatedAt?: string;
  }
): string {
  const id = crypto.randomUUID();
  const created = input.createdAt ?? nowIso();
  const updated = input.updatedAt ?? created;
  db.prepare(
    `INSERT INTO notes (id, folder_id, title, kind, content, source_json, order_idx, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.folderId,
    input.title.trim() || 'Nota sin título',
    input.kind,
    input.content,
    input.source ? JSON.stringify(input.source) : null,
    nextNoteOrder(db, input.folderId),
    created,
    updated
  );
  return id;
}

/** La colección de un proyecto: la que ya tenía, la que ya se marcó, o una nueva. */
function resolveProjectCollection(
  db: Database.Database,
  project: Row,
  report: WorkspaceMigrationReport
): string {
  const projectId = text(project.id);
  const ref = projectCollectionRef(projectId);

  const marked = db.prepare('SELECT id FROM note_folders WHERE source_ref = ?').get(ref) as Row | undefined;
  if (marked) return text(marked.id);

  const rootId = project.root_folder_id ? text(project.root_folder_id) : null;
  if (folderExists(db, rootId)) {
    // La carpeta del proyecto ya existe en el árbol de notas: se adopta tal cual, con su
    // nombre y su contenido. Marcarla es todo lo que hace falta.
    db.prepare('UPDATE note_folders SET source_ref = ?, updated_at = ? WHERE id = ?')
      .run(ref, nowIso(), rootId);
    report.collectionsAdopted += 1;
    return rootId!;
  }

  const title = text(project.title) || 'Proyecto sin título';
  const created = createFolder(db, {
    name: `Proyecto - ${title}`,
    parentId: null,
    summary: text(project.brief),
    sourceRef: ref,
  });
  db.prepare('UPDATE projects SET root_folder_id = ? WHERE id = ?').run(created, projectId);
  report.collectionsCreated += 1;
  return created;
}

/** Proyectos → colecciones, secciones → subcolecciones, capítulos → notas. */
function migrateProjects(db: Database.Database, report: WorkspaceMigrationReport): void {
  if (!tableExists(db, 'projects')) return;
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at').all() as Row[];

  for (const project of projects) {
    const projectId = text(project.id);
    const collectionId = resolveProjectCollection(db, project, report);
    if (!project.root_folder_id || text(project.root_folder_id) !== collectionId) {
      db.prepare('UPDATE projects SET root_folder_id = ? WHERE id = ?').run(collectionId, projectId);
    }

    const sectionFolder = new Map<string, string>();
    if (tableExists(db, 'project_sections')) {
      const sections = db
        .prepare('SELECT * FROM project_sections WHERE project_id = ? ORDER BY order_idx')
        .all(projectId) as Row[];
      for (const section of sections) {
        const sectionId = text(section.id);
        const existing = section.folder_id ? text(section.folder_id) : null;
        if (folderExists(db, existing)) {
          sectionFolder.set(sectionId, existing!);
          continue;
        }
        const folderId = createFolder(db, {
          name: text(section.title) || 'Sección',
          parentId: collectionId,
        });
        db.prepare('UPDATE project_sections SET folder_id = ? WHERE id = ?').run(folderId, sectionId);
        sectionFolder.set(sectionId, folderId);
        report.sectionCollectionsCreated += 1;
      }
    }

    if (!tableExists(db, 'project_chapters')) continue;
    const chapters = db
      .prepare('SELECT * FROM project_chapters WHERE project_id = ? ORDER BY created_at')
      .all(projectId) as Row[];
    for (const chapter of chapters) {
      const chapterId = text(chapter.id);
      const target = (chapter.section_id ? sectionFolder.get(text(chapter.section_id)) : null) ?? collectionId;
      const noteId = chapter.note_id ? text(chapter.note_id) : null;
      if (noteExists(db, noteId)) {
        // La nota del capítulo ya existe. Solo se la recoloca si estaba SUELTA: una nota
        // que el usuario movió a otra carpeta se queda donde la puso.
        db.prepare('UPDATE notes SET folder_id = ? WHERE id = ? AND folder_id IS NULL')
          .run(target, noteId);
        continue;
      }
      const created = createNote(db, {
        title: text(chapter.title) || 'Capítulo sin título',
        content: text(chapter.current_markdown),
        kind: 'markdown',
        folderId: target,
        source: { origin: 'markdown', ref: projectId, note: PROJECT_CHAPTER_NOTE_MARKER },
        createdAt: text(chapter.created_at) || nowIso(),
        updatedAt: text(chapter.updated_at) || nowIso(),
      });
      db.prepare('UPDATE project_chapters SET note_id = ? WHERE id = ?').run(created, chapterId);
      report.chapterNotesCreated += 1;
    }
  }
}

/** El cuerpo Markdown de un documento guardado de Escritura, con su bibliografía. */
export function writingDraftMarkdown(title: string, draft: Row): string {
  const lines: string[] = [`# ${title}`, ''];
  const abstract = text(draft.abstract).trim();
  if (abstract) lines.push(abstract, '');
  const body = text(draft.draftMarkdown).trim();
  if (body) lines.push(body, '');
  const bibliography = Array.isArray(draft.bibliography) ? (draft.bibliography as unknown[]) : [];
  if (bibliography.length) {
    lines.push('## Bibliografía', '');
    for (const entry of bibliography) lines.push(`- ${text(entry)}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

/** Documentos guardados de Escritura → notas. Los informes de Deep Research se quedan. */
function migrateWritingDrafts(db: Database.Database, report: WorkspaceMigrationReport): void {
  if (!tableExists(db, 'writing_saved_drafts')) return;
  const drafts = db
    .prepare('SELECT * FROM writing_saved_drafts ORDER BY created_at')
    .all() as Row[];

  let collectionId: string | null = null;
  const ensureCollection = (): string => {
    if (collectionId) return collectionId;
    const existing = db
      .prepare('SELECT id FROM note_folders WHERE source_ref = ?')
      .get(WRITING_COLLECTION_REF) as Row | undefined;
    collectionId = existing
      ? text(existing.id)
      : createFolder(db, {
          name: 'Escritura',
          parentId: null,
          summary: 'Documentos guardados en Escritura antes de unificar el espacio de trabajo.',
          sourceRef: WRITING_COLLECTION_REF,
        });
    return collectionId;
  };

  for (const row of drafts) {
    if (noteExists(db, row.note_id ? text(row.note_id) : null)) continue;
    const brief = parseJson<Row>(row.brief_json, {});
    if (text(brief.kind) === 'deep_research') continue;
    const draft = parseJson<Row | null>(row.draft_json, null);
    if (!draft) continue; // Un blob ilegible se deja intacto en su tabla en vez de perderlo.
    const title = text(row.title) || text(draft.title) || 'Documento sin título';
    const noteId = createNote(db, {
      title,
      content: writingDraftMarkdown(title, draft),
      kind: 'writing',
      folderId: ensureCollection(),
      source: { origin: 'writing', ref: text(row.id), note: WRITING_NOTE_MARKER },
      createdAt: text(row.created_at) || nowIso(),
      updatedAt: text(row.updated_at) || nowIso(),
    });
    db.prepare('UPDATE writing_saved_drafts SET note_id = ? WHERE id = ?').run(noteId, text(row.id));
    report.writingNotesCreated += 1;
  }
}

/**
 * Lleva proyectos y documentos de Escritura al árbol de notas que ahora es el Workspace.
 * Se puede ejecutar tantas veces como haga falta: la segunda pasada no cambia nada.
 */
export function migrateWorkspaceContent(db: Database.Database): WorkspaceMigrationReport {
  const report: WorkspaceMigrationReport = {
    collectionsCreated: 0,
    collectionsAdopted: 0,
    sectionCollectionsCreated: 0,
    chapterNotesCreated: 0,
    writingNotesCreated: 0,
  };
  migrateProjects(db, report);
  migrateWritingDrafts(db, report);
  return report;
}
