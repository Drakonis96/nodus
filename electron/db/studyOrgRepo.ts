import crypto from 'node:crypto';
import type {
  CreateStudyCourseInput,
  CreateStudyDocumentInput,
  CreateStudyFolderInput,
  CreateStudySubjectInput,
  CreateStudyTagInput,
  CreateStudyTemplateInput,
  CreateStudyTopicInput,
  StudyCourse,
  StudyDocument,
  StudyDocumentTag,
  StudyEntityKind,
  StudyFolder,
  StudyLifecycleAction,
  StudyPlacement,
  StudyPlacementInput,
  StudySubject,
  StudyTag,
  StudyTemplate,
  StudyTopic,
  StudyWorkspace,
  StudyWorkspaceOptions,
} from '@shared/studyOrg';
import { createStudyShortId, normalizeStudyName, studyPlacementKey } from '@shared/studyOrg';
import { getDb } from './database';

type Row = Record<string, unknown>;

const PREFIX = {
  course: 'CRS',
  subject: 'SUB',
  topic: 'TOP',
  folder: 'FLD',
  document: 'DOC',
  placement: 'PLC',
  tag: 'TAG',
  documentTag: 'DTG',
  template: 'TPL',
} as const;

function ids(kind: keyof typeof PREFIX) {
  const id = crypto.randomUUID();
  return { id, shortId: createStudyShortId(PREFIX[kind], id) };
}

function now(): string {
  return new Date().toISOString();
}

function bool(value: unknown): boolean {
  return Number(value) === 1;
}

function base(row: Row) {
  return {
    id: String(row.id),
    shortId: String(row.short_id),
    position: Number(row.position ?? 0),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function named(row: Row) {
  return {
    ...base(row),
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    color: row.color ? String(row.color) : null,
    icon: row.icon ? String(row.icon) : null,
    favorite: bool(row.favorite),
  };
}

const toCourse = (row: Row): StudyCourse => named(row);
const toSubject = (row: Row): StudySubject => ({ ...named(row), courseId: String(row.course_id) });
const toTopic = (row: Row): StudyTopic => ({
  ...named(row),
  subjectId: String(row.subject_id),
  parentId: row.parent_id ? String(row.parent_id) : null,
});
const toFolder = (row: Row): StudyFolder => ({
  ...named(row),
  parentId: row.parent_id ? String(row.parent_id) : null,
  courseId: row.course_id ? String(row.course_id) : null,
  subjectId: row.subject_id ? String(row.subject_id) : null,
});
const toDocument = (row: Row): StudyDocument => ({
  ...base(row),
  title: String(row.title),
  kind: String(row.kind) as StudyDocument['kind'],
  contentMarkdown: String(row.content_markdown ?? ''),
  description: row.description ? String(row.description) : null,
  color: row.color ? String(row.color) : null,
  icon: row.icon ? String(row.icon) : null,
  favorite: bool(row.favorite),
  pinned: bool(row.pinned),
  locked: bool(row.locked),
  embeddingProvider: row.embedding_provider ? String(row.embedding_provider) : null,
  embeddingModel: row.embedding_model ? String(row.embedding_model) : null,
  embeddingDim: row.embedding_dim == null ? null : Number(row.embedding_dim),
  embeddingTextHash: row.embedding_text_hash ? String(row.embedding_text_hash) : null,
});
const toPlacement = (row: Row): StudyPlacement => ({
  ...base(row),
  documentId: String(row.document_id),
  courseId: row.course_id ? String(row.course_id) : null,
  subjectId: row.subject_id ? String(row.subject_id) : null,
  topicId: row.topic_id ? String(row.topic_id) : null,
  folderId: row.folder_id ? String(row.folder_id) : null,
});
const toTag = (row: Row): StudyTag => named(row);
const toDocumentTag = (row: Row): StudyDocumentTag => ({
  ...base(row),
  documentId: String(row.document_id),
  tagId: String(row.tag_id),
});
const toTemplate = (row: Row): StudyTemplate => ({
  ...named(row),
  kind: String(row.kind) as StudyTemplate['kind'],
  content: JSON.parse(String(row.content_json || '{}')) as StudyTemplate['content'],
});

function lifecycleWhere(options: StudyWorkspaceOptions): string {
  const filters: string[] = [];
  if (!options.includeArchived) filters.push('archived_at IS NULL');
  if (!options.includeDeleted) filters.push('deleted_at IS NULL');
  return filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
}

export function getStudyWorkspace(options: StudyWorkspaceOptions = {}): StudyWorkspace {
  const db = getDb();
  const where = lifecycleWhere(options);
  const list = (table: string) => db.prepare(`SELECT * FROM ${table}${where} ORDER BY position, created_at`).all() as Row[];
  const documents = list('study_docs').map(toDocument);
  const documentIds = new Set(documents.map((document) => document.id));
  const tags = list('study_tags').map(toTag);
  const tagIds = new Set(tags.map((tag) => tag.id));
  return {
    courses: list('study_courses').map(toCourse),
    subjects: list('study_subjects').map(toSubject),
    topics: list('study_topics').map(toTopic),
    folders: list('study_folders').map(toFolder),
    documents,
    placements: list('study_placements').map(toPlacement).filter((placement) => documentIds.has(placement.documentId)),
    tags,
    documentTags: list('study_doc_tags').map(toDocumentTag).filter((link) => documentIds.has(link.documentId) && tagIds.has(link.tagId)),
    templates: list('study_templates').map(toTemplate),
  };
}

function nextPosition(table: string, scopeColumn?: string, scopeValue?: string | null): number {
  const db = getDb();
  if (scopeColumn) {
    const row = db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS value FROM ${table} WHERE ${scopeColumn} IS ?`).get(scopeValue ?? null) as Row;
    return Number(row.value);
  }
  const row = db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS value FROM ${table}`).get() as Row;
  return Number(row.value);
}

export function createStudyCourse(input: CreateStudyCourseInput): StudyCourse {
  const db = getDb();
  const key = ids('course');
  const timestamp = now();
  db.prepare(`INSERT INTO study_courses
    (id, short_id, name, description, color, icon, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, normalizeStudyName(input.name), input.description ?? null, input.color ?? null, input.icon ?? null,
      nextPosition('study_courses'), timestamp, timestamp);
  return toCourse(db.prepare('SELECT * FROM study_courses WHERE id = ?').get(key.id) as Row);
}

export function createStudySubject(input: CreateStudySubjectInput): StudySubject {
  const db = getDb();
  const key = ids('subject');
  const timestamp = now();
  db.prepare(`INSERT INTO study_subjects
    (id, short_id, course_id, name, description, color, icon, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, input.courseId, normalizeStudyName(input.name), input.description ?? null, input.color ?? null,
      input.icon ?? null, nextPosition('study_subjects', 'course_id', input.courseId), timestamp, timestamp);
  return toSubject(db.prepare('SELECT * FROM study_subjects WHERE id = ?').get(key.id) as Row);
}

function assertNoTopicCycle(id: string, parentId: string | null): void {
  if (!parentId) return;
  if (id === parentId) throw new Error('Un tema no puede contenerse a sí mismo.');
  const db = getDb();
  let cursor: string | null = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === id) throw new Error('El movimiento crearía un ciclo de temas.');
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const row = db.prepare('SELECT parent_id FROM study_topics WHERE id = ?').get(cursor) as Row | undefined;
    cursor = row?.parent_id ? String(row.parent_id) : null;
  }
}

export function createStudyTopic(input: CreateStudyTopicInput): StudyTopic {
  const db = getDb();
  const key = ids('topic');
  assertNoTopicCycle(key.id, input.parentId ?? null);
  const timestamp = now();
  db.prepare(`INSERT INTO study_topics
    (id, short_id, subject_id, parent_id, name, description, color, icon, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, input.subjectId, input.parentId ?? null, normalizeStudyName(input.name), input.description ?? null,
      input.color ?? null, input.icon ?? null, nextPosition('study_topics', 'subject_id', input.subjectId), timestamp, timestamp);
  return toTopic(db.prepare('SELECT * FROM study_topics WHERE id = ?').get(key.id) as Row);
}

function assertNoFolderCycle(id: string, parentId: string | null): void {
  if (!parentId) return;
  if (id === parentId) throw new Error('Una carpeta no puede contenerse a sí misma.');
  const db = getDb();
  let cursor: string | null = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === id) throw new Error('El movimiento crearía un ciclo de carpetas.');
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const row = db.prepare('SELECT parent_id FROM study_folders WHERE id = ?').get(cursor) as Row | undefined;
    cursor = row?.parent_id ? String(row.parent_id) : null;
  }
}

export function createStudyFolder(input: CreateStudyFolderInput): StudyFolder {
  const db = getDb();
  const key = ids('folder');
  assertNoFolderCycle(key.id, input.parentId ?? null);
  const timestamp = now();
  db.prepare(`INSERT INTO study_folders
    (id, short_id, parent_id, course_id, subject_id, name, description, color, icon, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, input.parentId ?? null, input.courseId ?? null, input.subjectId ?? null,
      normalizeStudyName(input.name), input.description ?? null, input.color ?? null, input.icon ?? null,
      nextPosition('study_folders', 'parent_id', input.parentId ?? null), timestamp, timestamp);
  return toFolder(db.prepare('SELECT * FROM study_folders WHERE id = ?').get(key.id) as Row);
}

export function createStudyDocument(input: CreateStudyDocumentInput): StudyDocument {
  const db = getDb();
  const create = db.transaction(() => {
    const key = ids('document');
    const timestamp = now();
    db.prepare(`INSERT INTO study_docs
      (id, short_id, title, kind, content_markdown, description, color, icon, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(key.id, key.shortId, normalizeStudyName(input.title), input.kind ?? 'apunte', input.contentMarkdown ?? '',
        input.description ?? null, input.color ?? null, input.icon ?? null, nextPosition('study_docs'), timestamp, timestamp);
    if (input.placement) addStudyPlacement(key.id, input.placement);
    return toDocument(db.prepare('SELECT * FROM study_docs WHERE id = ?').get(key.id) as Row);
  });
  return create();
}

export function addStudyPlacement(documentId: string, input: StudyPlacementInput): StudyPlacement {
  const db = getDb();
  const normalized: StudyPlacementInput = { ...input };
  if (normalized.topicId) {
    const topic = db.prepare('SELECT subject_id FROM study_topics WHERE id = ?').get(normalized.topicId) as Row | undefined;
    if (!topic) throw new Error('El tema de destino no existe.');
    normalized.subjectId ??= String(topic.subject_id);
  }
  if (normalized.subjectId) {
    const subject = db.prepare('SELECT course_id FROM study_subjects WHERE id = ?').get(normalized.subjectId) as Row | undefined;
    if (!subject) throw new Error('La asignatura de destino no existe.');
    normalized.courseId ??= String(subject.course_id);
  }
  if (!normalized.courseId && !normalized.subjectId && !normalized.topicId && !normalized.folderId) throw new Error('La ubicación necesita un destino.');
  const duplicate = db.prepare(`SELECT * FROM study_placements WHERE document_id = ?
    AND IFNULL(course_id, '') = ? AND IFNULL(subject_id, '') = ? AND IFNULL(topic_id, '') = ? AND IFNULL(folder_id, '') = ?`)
    .get(documentId, normalized.courseId ?? '', normalized.subjectId ?? '', normalized.topicId ?? '', normalized.folderId ?? '') as Row | undefined;
  if (duplicate) return toPlacement(duplicate);
  const key = ids('placement');
  const timestamp = now();
  db.prepare(`INSERT INTO study_placements
    (id, short_id, document_id, course_id, subject_id, topic_id, folder_id, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, documentId, normalized.courseId ?? null, normalized.subjectId ?? null, normalized.topicId ?? null,
      normalized.folderId ?? null, normalized.position ?? nextPosition('study_placements', 'document_id', documentId), timestamp, timestamp);
  return toPlacement(db.prepare('SELECT * FROM study_placements WHERE id = ?').get(key.id) as Row);
}

export function setPrimaryStudyPlacement(documentId: string, input: StudyPlacementInput): StudyPlacement {
  const db = getDb();
  return db.transaction(() => {
    db.prepare('DELETE FROM study_placements WHERE document_id = ?').run(documentId);
    return addStudyPlacement(documentId, input);
  })();
}

export function removeStudyPlacement(id: string): void {
  getDb().prepare('DELETE FROM study_placements WHERE id = ?').run(id);
}

const TABLES: Record<StudyEntityKind, string> = {
  course: 'study_courses', subject: 'study_subjects', topic: 'study_topics', folder: 'study_folders', document: 'study_docs',
};

export function updateStudyEntity(kind: StudyEntityKind, id: string, patch: Record<string, unknown>): StudyCourse | StudySubject | StudyTopic | StudyFolder | StudyDocument | null {
  const db = getDb();
  const table = TABLES[kind];
  const allowed = kind === 'document'
    ? new Set(['title', 'kind', 'contentMarkdown', 'description', 'color', 'icon', 'favorite', 'pinned', 'locked', 'position'])
    : new Set(['name', 'description', 'color', 'icon', 'favorite', 'position', 'courseId', 'subjectId', 'parentId']);
  const column = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
  if (!entries.length) return getStudyEntity(kind, id);
  if (kind === 'topic' && Object.hasOwn(patch, 'parentId')) assertNoTopicCycle(id, (patch.parentId as string | null) ?? null);
  if (kind === 'folder' && Object.hasOwn(patch, 'parentId')) assertNoFolderCycle(id, (patch.parentId as string | null) ?? null);
  const values = entries.map(([key, value]) => {
    if (key === 'name' || key === 'title') return normalizeStudyName(String(value ?? ''));
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
  });
  db.prepare(`UPDATE ${table} SET ${entries.map(([key]) => `${column(key)} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...values, now(), id);
  return getStudyEntity(kind, id);
}

export function getStudyEntity(kind: StudyEntityKind, id: string): StudyCourse | StudySubject | StudyTopic | StudyFolder | StudyDocument | null {
  const row = getDb().prepare(`SELECT * FROM ${TABLES[kind]} WHERE id = ?`).get(id) as Row | undefined;
  if (!row) return null;
  if (kind === 'course') return toCourse(row);
  if (kind === 'subject') return toSubject(row);
  if (kind === 'topic') return toTopic(row);
  if (kind === 'folder') return toFolder(row);
  return toDocument(row);
}

function descendantIds(kind: StudyEntityKind, id: string): Record<StudyEntityKind, Set<string>> {
  const db = getDb();
  const result: Record<StudyEntityKind, Set<string>> = {
    course: new Set(), subject: new Set(), topic: new Set(), folder: new Set(), document: new Set(),
  };
  result[kind].add(id);
  if (kind === 'course') {
    for (const row of db.prepare('SELECT id FROM study_subjects WHERE course_id = ?').all(id) as Row[]) result.subject.add(String(row.id));
    for (const row of db.prepare('SELECT id FROM study_folders WHERE course_id = ?').all(id) as Row[]) result.folder.add(String(row.id));
  }
  if (kind === 'subject') {
    for (const row of db.prepare('SELECT id FROM study_folders WHERE subject_id = ?').all(id) as Row[]) result.folder.add(String(row.id));
  }
  if (kind === 'course' || kind === 'subject') {
    let frontier = [...result.folder];
    while (frontier.length) {
      const next: string[] = [];
      for (const parentId of frontier) {
        for (const row of db.prepare('SELECT id FROM study_folders WHERE parent_id = ?').all(parentId) as Row[]) {
          const childId = String(row.id);
          if (!result.folder.has(childId)) { result.folder.add(childId); next.push(childId); }
        }
      }
      frontier = next;
    }
  }
  if (kind === 'course' || kind === 'subject') {
    const subjectIds = [...result.subject, ...(kind === 'subject' ? [id] : [])];
    for (const subjectId of subjectIds) {
      for (const row of db.prepare('SELECT id FROM study_topics WHERE subject_id = ?').all(subjectId) as Row[]) result.topic.add(String(row.id));
    }
  }
  if (kind === 'topic') {
    let frontier = [id];
    while (frontier.length) {
      const next: string[] = [];
      for (const parentId of frontier) {
        for (const row of db.prepare('SELECT id FROM study_topics WHERE parent_id = ?').all(parentId) as Row[]) {
          const childId = String(row.id);
          if (!result.topic.has(childId)) { result.topic.add(childId); next.push(childId); }
        }
      }
      frontier = next;
    }
  }
  if (kind === 'folder') {
    let frontier = [id];
    while (frontier.length) {
      const next: string[] = [];
      for (const parentId of frontier) {
        for (const row of db.prepare('SELECT id FROM study_folders WHERE parent_id = ?').all(parentId) as Row[]) {
          const childId = String(row.id);
          if (!result.folder.has(childId)) { result.folder.add(childId); next.push(childId); }
        }
      }
      frontier = next;
    }
  }
  if (kind !== 'document') {
    const placements = (db.prepare('SELECT * FROM study_placements').all() as Row[]).map(toPlacement);
    const inside = (placement: StudyPlacement) =>
      (placement.courseId != null && result.course.has(placement.courseId)) ||
      (placement.subjectId != null && result.subject.has(placement.subjectId)) ||
      (placement.topicId != null && result.topic.has(placement.topicId)) ||
      (placement.folderId != null && result.folder.has(placement.folderId));
    const candidateIds = new Set(placements.filter(inside).map((placement) => placement.documentId));
    for (const documentId of candidateIds) {
      const documentPlacements = placements.filter((placement) => placement.documentId === documentId);
      if (documentPlacements.length > 0 && documentPlacements.every(inside)) result.document.add(documentId);
    }
  }
  return result;
}

export function setStudyLifecycle(kind: StudyEntityKind, id: string, action: StudyLifecycleAction): void {
  const db = getDb();
  const scope = descendantIds(kind, id);
  const column = action === 'archive' || action === 'restore' ? 'archived_at' : 'deleted_at';
  const value = action === 'archive' || action === 'trash' ? now() : null;
  db.transaction(() => {
    for (const entityKind of Object.keys(scope) as StudyEntityKind[]) {
      const entityIds = [...scope[entityKind]];
      if (!entityIds.length) continue;
      const placeholders = entityIds.map(() => '?').join(',');
      db.prepare(`UPDATE ${TABLES[entityKind]} SET ${column} = ?, updated_at = ? WHERE id IN (${placeholders})`)
        .run(value, now(), ...entityIds);
    }
  })();
}

export function createStudyTag(input: CreateStudyTagInput): StudyTag {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM study_tags WHERE name = ? COLLATE NOCASE').get(normalizeStudyName(input.name)) as Row | undefined;
  if (existing) return toTag(existing);
  const key = ids('tag');
  const timestamp = now();
  db.prepare(`INSERT INTO study_tags
    (id, short_id, name, color, icon, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, normalizeStudyName(input.name), input.color ?? null, input.icon ?? null,
      nextPosition('study_tags'), timestamp, timestamp);
  return toTag(db.prepare('SELECT * FROM study_tags WHERE id = ?').get(key.id) as Row);
}

export function updateStudyTag(id: string, patch: Partial<CreateStudyTagInput> & { favorite?: boolean; position?: number }): StudyTag | null {
  const db = getDb();
  const entries = Object.entries(patch).filter(([key]) => ['name', 'color', 'icon', 'favorite', 'position'].includes(key));
  if (entries.length) {
    const values = entries.map(([key, value]) => key === 'name' ? normalizeStudyName(String(value ?? '')) : typeof value === 'boolean' ? (value ? 1 : 0) : value);
    db.prepare(`UPDATE study_tags SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...values, now(), id);
  }
  const row = db.prepare('SELECT * FROM study_tags WHERE id = ?').get(id) as Row | undefined;
  return row ? toTag(row) : null;
}

export function deleteStudyTag(id: string): void {
  getDb().prepare('DELETE FROM study_tags WHERE id = ?').run(id);
}

export function setStudyDocumentTags(documentId: string, tagIds: string[]): StudyDocumentTag[] {
  const db = getDb();
  const unique = [...new Set(tagIds)];
  db.transaction(() => {
    db.prepare('DELETE FROM study_doc_tags WHERE document_id = ?').run(documentId);
    unique.forEach((tagId, position) => {
      const key = ids('documentTag');
      const timestamp = now();
      db.prepare(`INSERT INTO study_doc_tags
        (id, short_id, document_id, tag_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(key.id, key.shortId, documentId, tagId, position, timestamp, timestamp);
    });
  })();
  return (db.prepare('SELECT * FROM study_doc_tags WHERE document_id = ? ORDER BY position').all(documentId) as Row[]).map(toDocumentTag);
}

export function createStudyTemplate(input: CreateStudyTemplateInput): StudyTemplate {
  const db = getDb();
  const key = ids('template');
  const timestamp = now();
  db.prepare(`INSERT INTO study_templates
    (id, short_id, kind, name, description, content_json, color, icon, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, input.kind, normalizeStudyName(input.name), input.description ?? null, JSON.stringify(input.content),
      input.color ?? null, input.icon ?? null, nextPosition('study_templates'), timestamp, timestamp);
  return toTemplate(db.prepare('SELECT * FROM study_templates WHERE id = ?').get(key.id) as Row);
}

export function updateStudyTemplate(id: string, patch: Partial<CreateStudyTemplateInput> & { favorite?: boolean; position?: number }): StudyTemplate | null {
  const db = getDb();
  const allowed = new Set(['name', 'kind', 'description', 'content', 'color', 'icon', 'favorite', 'position']);
  const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
  const column = (key: string) => key === 'content' ? 'content_json' : key;
  if (entries.length) {
    const values = entries.map(([key, value]) => key === 'name' ? normalizeStudyName(String(value ?? '')) : key === 'content' ? JSON.stringify(value) : typeof value === 'boolean' ? (value ? 1 : 0) : value);
    db.prepare(`UPDATE study_templates SET ${entries.map(([key]) => `${column(key)} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...values, now(), id);
  }
  const row = db.prepare('SELECT * FROM study_templates WHERE id = ?').get(id) as Row | undefined;
  return row ? toTemplate(row) : null;
}

export function deleteStudyTemplate(id: string): void {
  getDb().prepare('DELETE FROM study_templates WHERE id = ?').run(id);
}

export function applyStudyTemplate(id: string, name?: string): StudyCourse | StudySubject | StudyDocument {
  const db = getDb();
  const row = db.prepare('SELECT * FROM study_templates WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new Error('Plantilla no encontrada.');
  const template = toTemplate(row);
  return db.transaction(() => {
    if (template.kind === 'document') {
      const spec = template.content.document ?? {};
      return createStudyDocument({ title: name ?? spec.title ?? template.name, kind: spec.kind, contentMarkdown: spec.contentMarkdown });
    }
    const addTopics = (subjectId: string, topics: NonNullable<StudyTemplate['content']['subject']>['topics'] = [], parentId: string | null = null) => {
      for (const topic of topics ?? []) {
        const created = createStudyTopic({ subjectId, parentId, name: topic.name, description: topic.description });
        addTopics(subjectId, topic.children, created.id);
      }
    };
    if (template.kind === 'subject') {
      const course = createStudyCourse({ name: `${name ?? template.name}` });
      const spec = template.content.subject ?? { name: template.name };
      const subject = createStudySubject({ courseId: course.id, name: name ?? spec.name, description: spec.description });
      addTopics(subject.id, spec.topics);
      return subject;
    }
    const spec = template.content.course ?? {};
    const course = createStudyCourse({ name: name ?? spec.name ?? template.name, description: spec.description });
    for (const subjectSpec of spec.subjects ?? []) {
      const subject = createStudySubject({ courseId: course.id, name: subjectSpec.name, description: subjectSpec.description });
      addTopics(subject.id, subjectSpec.topics);
    }
    return course;
  })();
}

export function duplicateStudyTree(kind: StudyEntityKind, id: string): StudyCourse | StudySubject | StudyTopic | StudyFolder | StudyDocument {
  const db = getDb();
  return db.transaction(() => {
    if (kind === 'document') {
      const original = getStudyEntity('document', id) as StudyDocument | null;
      if (!original) throw new Error('Documento no encontrado.');
      const copy = createStudyDocument({
        title: `${original.title} (copia)`, kind: original.kind, contentMarkdown: original.contentMarkdown,
        description: original.description, color: original.color, icon: original.icon,
      });
      const placements = db.prepare('SELECT * FROM study_placements WHERE document_id = ?').all(id) as Row[];
      for (const placementRow of placements) {
        const placement = toPlacement(placementRow);
        addStudyPlacement(copy.id, placement);
      }
      return copy;
    }

    const scope = descendantIds(kind, id);
    const courseMap = new Map<string, string>();
    const subjectMap = new Map<string, string>();
    const topicMap = new Map<string, string>();
    const folderMap = new Map<string, string>();
    let root: StudyCourse | StudySubject | StudyTopic | StudyFolder | null = null;

    for (const oldId of scope.course) {
      const old = getStudyEntity('course', oldId) as StudyCourse;
      const copy = createStudyCourse({ name: `${old.name}${oldId === id ? ' (copia)' : ''}`, description: old.description, color: old.color, icon: old.icon });
      courseMap.set(oldId, copy.id); if (oldId === id) root = copy;
    }
    for (const oldId of scope.subject) {
      const old = getStudyEntity('subject', oldId) as StudySubject;
      const targetCourse = courseMap.get(old.courseId) ?? old.courseId;
      const copy = createStudySubject({ courseId: targetCourse, name: `${old.name}${oldId === id ? ' (copia)' : ''}`, description: old.description, color: old.color, icon: old.icon });
      subjectMap.set(oldId, copy.id); if (oldId === id) root = copy;
    }
    const pendingTopics = [...scope.topic];
    while (pendingTopics.length) {
      const oldId = pendingTopics.shift()!;
      const old = getStudyEntity('topic', oldId) as StudyTopic;
      if (old.parentId && scope.topic.has(old.parentId) && !topicMap.has(old.parentId)) { pendingTopics.push(oldId); continue; }
      const copy = createStudyTopic({ subjectId: subjectMap.get(old.subjectId) ?? old.subjectId, parentId: old.parentId ? topicMap.get(old.parentId) ?? old.parentId : null,
        name: `${old.name}${oldId === id ? ' (copia)' : ''}`, description: old.description, color: old.color, icon: old.icon });
      topicMap.set(oldId, copy.id); if (oldId === id) root = copy;
    }
    const pendingFolders = [...scope.folder];
    while (pendingFolders.length) {
      const oldId = pendingFolders.shift()!;
      const old = getStudyEntity('folder', oldId) as StudyFolder;
      if (old.parentId && scope.folder.has(old.parentId) && !folderMap.has(old.parentId)) { pendingFolders.push(oldId); continue; }
      const copy = createStudyFolder({ parentId: old.parentId ? folderMap.get(old.parentId) ?? old.parentId : null,
        courseId: old.courseId ? courseMap.get(old.courseId) ?? old.courseId : null,
        subjectId: old.subjectId ? subjectMap.get(old.subjectId) ?? old.subjectId : null,
        name: `${old.name}${oldId === id ? ' (copia)' : ''}`, description: old.description, color: old.color, icon: old.icon });
      folderMap.set(oldId, copy.id); if (oldId === id) root = copy;
    }

    const placements = db.prepare('SELECT * FROM study_placements').all() as Row[];
    const relevant = placements.map(toPlacement).filter((placement) =>
      (placement.courseId && scope.course.has(placement.courseId)) ||
      (placement.subjectId && scope.subject.has(placement.subjectId)) ||
      (placement.topicId && scope.topic.has(placement.topicId)) ||
      (placement.folderId && scope.folder.has(placement.folderId)));
    const docMap = new Map<string, string>();
    for (const placement of relevant) {
      let copyId = docMap.get(placement.documentId);
      if (!copyId) {
        const old = getStudyEntity('document', placement.documentId) as StudyDocument;
        const copy = createStudyDocument({ title: old.title, kind: old.kind, contentMarkdown: old.contentMarkdown,
          description: old.description, color: old.color, icon: old.icon });
        copyId = copy.id; docMap.set(old.id, copy.id);
      }
      const mapped: StudyPlacementInput = {
        courseId: placement.courseId ? courseMap.get(placement.courseId) ?? placement.courseId : null,
        subjectId: placement.subjectId ? subjectMap.get(placement.subjectId) ?? placement.subjectId : null,
        topicId: placement.topicId ? topicMap.get(placement.topicId) ?? placement.topicId : null,
        folderId: placement.folderId ? folderMap.get(placement.folderId) ?? placement.folderId : null,
      };
      if (studyPlacementKey(mapped) !== studyPlacementKey(placement)) addStudyPlacement(copyId, mapped);
    }
    if (!root) throw new Error('Elemento de estudio no encontrado.');
    return root;
  })();
}
