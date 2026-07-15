import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { app, dialog } from 'electron';
import type { StudyExportFormat, StudyExportScope } from '@shared/types';
import type { StudyDocument, StudyPlacement, StudyWorkspace } from '@shared/studyOrg';
import { getDb } from '../db/database';
import { getStudyWorkspace } from '../db/studyOrgRepo';
import { escapeHtml, markdownToHtml, markdownToPdf } from './markdownRender';
import { markdownToDocx, markdownToPlainText } from './projectExport';

type DbRow = Record<string, unknown>;

function slug(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'sin-titulo';
}

type StudyLocation = { courseId?: string | null; subjectId?: string | null; topicId?: string | null; folderId?: string | null };

function folderChain(workspace: StudyWorkspace, folderId: string | null | undefined): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  let current = folderId ? workspace.folders.find((item) => item.id === folderId) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    result.unshift(current.name);
    current = current.parentId ? workspace.folders.find((item) => item.id === current?.parentId) : undefined;
  }
  return result;
}

function topicChain(workspace: StudyWorkspace, topicId: string | null | undefined): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  let current = topicId ? workspace.topics.find((item) => item.id === topicId) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    result.unshift(current.name);
    current = current.parentId ? workspace.topics.find((item) => item.id === current?.parentId) : undefined;
  }
  return result;
}

function hierarchyDirectory(workspace: StudyWorkspace, location: StudyLocation): string {
  const topic = location.topicId ? workspace.topics.find((item) => item.id === location.topicId) : undefined;
  const folder = (location.folderId ? workspace.folders.find((item) => item.id === location.folderId) : undefined)
    ?? (topic?.folderId ? workspace.folders.find((item) => item.id === topic.folderId) : undefined);
  const subject = (location.subjectId ? workspace.subjects.find((item) => item.id === location.subjectId) : undefined)
    ?? (topic ? workspace.subjects.find((item) => item.id === topic.subjectId) : undefined)
    ?? (folder?.subjectId ? workspace.subjects.find((item) => item.id === folder.subjectId) : undefined);
  const course = (location.courseId ? workspace.courses.find((item) => item.id === location.courseId) : undefined)
    ?? (subject ? workspace.courses.find((item) => item.id === subject.courseId) : undefined)
    ?? (folder?.courseId ? workspace.courses.find((item) => item.id === folder.courseId) : undefined);
  const parts = [course?.name, subject?.name, ...folderChain(workspace, folder?.id), ...topicChain(workspace, topic?.id)]
    .filter((value): value is string => Boolean(value)).map(slug);
  return parts.length ? parts.join('/') : '_Sin-organizar';
}

function isFolderWithin(workspace: StudyWorkspace, folderId: string | null | undefined, ancestorId: string): boolean {
  const seen = new Set<string>();
  let current = folderId ? workspace.folders.find((item) => item.id === folderId) : undefined;
  while (current && !seen.has(current.id)) {
    if (current.id === ancestorId) return true;
    seen.add(current.id);
    current = current.parentId ? workspace.folders.find((item) => item.id === current?.parentId) : undefined;
  }
  return false;
}

function isTopicWithin(workspace: StudyWorkspace, topicId: string | null | undefined, ancestorId: string): boolean {
  const seen = new Set<string>();
  let current = topicId ? workspace.topics.find((item) => item.id === topicId) : undefined;
  while (current && !seen.has(current.id)) {
    if (current.id === ancestorId) return true;
    seen.add(current.id);
    current = current.parentId ? workspace.topics.find((item) => item.id === current?.parentId) : undefined;
  }
  return false;
}

function locationMatchesScope(workspace: StudyWorkspace, location: StudyLocation, scope: StudyExportScope): boolean {
  if (scope.kind === 'workspace') return true;
  if (!scope.id) return false;
  if (scope.kind === 'course') return location.courseId === scope.id
    || workspace.subjects.some((item) => item.id === location.subjectId && item.courseId === scope.id);
  if (scope.kind === 'subject') return location.subjectId === scope.id
    || workspace.topics.some((item) => item.id === location.topicId && item.subjectId === scope.id)
    || workspace.folders.some((item) => item.id === location.folderId && item.subjectId === scope.id);
  if (scope.kind === 'folder') {
    const topic = location.topicId ? workspace.topics.find((item) => item.id === location.topicId) : undefined;
    return isFolderWithin(workspace, location.folderId ?? topic?.folderId, scope.id);
  }
  if (scope.kind === 'topic') return isTopicWithin(workspace, location.topicId, scope.id);
  return false;
}

function scopeDocuments(workspace: StudyWorkspace, scope: StudyExportScope): StudyDocument[] {
  if (scope.kind === 'workspace') return workspace.documents;
  if (scope.kind === 'document') return workspace.documents.filter((document) => document.id === scope.id);
  const ids = new Set(workspace.placements.filter((placement) => locationMatchesScope(workspace, placement, scope)).map((placement) => placement.documentId));
  return workspace.documents.filter((document) => ids.has(document.id));
}

function scopeTitle(workspace: StudyWorkspace, scope: StudyExportScope): string {
  if (scope.kind === 'workspace') return 'Vault de estudio';
  if (scope.kind === 'document') return workspace.documents.find((item) => item.id === scope.id)?.title ?? 'Documento';
  const list = scope.kind === 'course' ? workspace.courses : scope.kind === 'subject' ? workspace.subjects : scope.kind === 'topic' ? workspace.topics : workspace.folders;
  return list.find((item) => item.id === scope.id)?.name ?? 'Selección de estudio';
}

function locationLabel(workspace: StudyWorkspace, placement: StudyPlacement | undefined): string {
  if (!placement) return '';
  const course = workspace.courses.find((item) => item.id === placement.courseId)?.name;
  const subject = workspace.subjects.find((item) => item.id === placement.subjectId)?.name;
  const topic = workspace.topics.find((item) => item.id === placement.topicId)?.name;
  const folder = workspace.folders.find((item) => item.id === placement.folderId)?.name;
  return [course, subject, topic, folder].filter(Boolean).join(' / ');
}

export function buildStudyExportMarkdown(scope: StudyExportScope): { title: string; markdown: string; documents: StudyDocument[] } {
  const workspace = getStudyWorkspace();
  const documents = scopeDocuments(workspace, scope).sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
  const title = scopeTitle(workspace, scope);
  const parts = [`# ${title}`, '', `Exportado desde Nodus · ${new Date().toISOString()}`, ''];
  for (const document of documents) {
    const placement = workspace.placements.find((item) => item.documentId === document.id);
    parts.push(`## ${document.title}`, '', `Tipo: ${document.kind} · ${document.shortId}`);
    const location = locationLabel(workspace, placement); if (location) parts.push(`Ubicación: ${location}`);
    if (document.description) parts.push('', document.description);
    parts.push('', document.contentMarkdown || '_Documento vacío_', '');
  }
  return { title, markdown: `${parts.join('\n').trim()}\n`, documents };
}

function portableRows(table: string): DbRow[] {
  if (!/^study_[A-Za-z0-9_]+$/.test(table)) throw new Error('Tabla de estudio no válida.');
  return (getDb().prepare(`SELECT * FROM "${table}"`).all() as DbRow[]).map((row) => Object.fromEntries(Object.entries(row).filter(([, value]) => !Buffer.isBuffer(value))));
}

function fileName(row: DbRow, fallback: string): string {
  const original = String(row.file_name ?? '').trim();
  if (original) return slug(original);
  const extension = String(row.extension ?? '').replace(/^\./, '').trim();
  return `${slug(String(row.title ?? fallback))}${extension ? `.${slug(extension)}` : ''}`;
}

function addUniqueFile(zip: AdmZip, usedPaths: Set<string>, directory: string, name: string, bytes: Buffer): void {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  let candidate = `${directory}/${name}`;
  let copy = 2;
  while (usedPaths.has(candidate)) candidate = `${directory}/${base}-${copy++}${extension}`;
  usedPaths.add(candidate);
  zip.addFile(candidate, bytes);
}

/** Read-only local-sharing package: human-readable Markdown keeps the academic
 * hierarchy, while JSON + byte-exact resources retain questions, tests,
 * transcripts, materials and recordings for auditing or a later editable import. */
export function buildStudyBundle(scope: StudyExportScope): Buffer {
  const workspace = getStudyWorkspace();
  const documents = scopeDocuments(workspace, scope);
  const documentIds = new Set(documents.map((document) => document.id));
  const zip = new AdmZip();
  const usedPaths = new Set<string>();
  for (const document of documents) {
    const placements = workspace.placements.filter((item) => item.documentId === document.id && locationMatchesScope(workspace, item, scope));
    for (const placement of placements.length ? placements : [{}]) {
      addUniqueFile(zip, usedPaths, hierarchyDirectory(workspace, placement), `${slug(document.title)}-${document.shortId}.md`, Buffer.from(`${document.contentMarkdown}\n`, 'utf8'));
    }
  }

  const matchesDirectScope = (row: DbRow): boolean => scope.kind === 'document'
    ? String(row.document_id ?? '') === scope.id
    : locationMatchesScope(workspace, { courseId: String(row.course_id ?? '') || null, subjectId: String(row.subject_id ?? '') || null, topicId: String(row.topic_id ?? '') || null, folderId: String(row.folder_id ?? '') || null }, scope);
  const materialRows = portableRows('study_materials');
  const materialPlacements = portableRows('study_material_placements');
  const materialIds = new Set(materialPlacements.filter((row) => documentIds.has(String(row.document_id ?? '')) || matchesDirectScope(row)).map((row) => String(row.material_id)));
  const selectedMaterials = materialRows.filter((row) => scope.kind === 'workspace' || materialIds.has(String(row.id)));
  for (const material of selectedMaterials) {
    const blob = getDb().prepare('SELECT content_blob FROM study_materials WHERE id = ?').get(material.id) as { content_blob: Buffer | null } | undefined;
    if (blob?.content_blob) {
      const placements = materialPlacements.filter((row) => String(row.material_id) === String(material.id) && matchesDirectScope(row));
      for (const placement of placements.length ? placements : [{}]) addUniqueFile(zip, usedPaths, hierarchyDirectory(workspace, { courseId: String(placement.course_id ?? '') || null, subjectId: String(placement.subject_id ?? '') || null, topicId: String(placement.topic_id ?? '') || null, folderId: String(placement.folder_id ?? '') || null }), fileName(material, String(material.id)), blob.content_blob);
    }
  }
  const recordingRows = portableRows('study_recordings').filter((row) => documentIds.has(String(row.document_id ?? '')) || matchesDirectScope(row));
  const recordingIds = new Set(recordingRows.map((row) => String(row.id)));
  for (const recording of recordingRows) {
    const blob = getDb().prepare('SELECT audio_blob FROM study_recordings WHERE id = ?').get(recording.id) as { audio_blob: Buffer | null } | undefined;
    if (blob?.audio_blob) addUniqueFile(zip, usedPaths, hierarchyDirectory(workspace, { courseId: String(recording.course_id ?? '') || null, subjectId: String(recording.subject_id ?? '') || null, topicId: String(recording.topic_id ?? '') || null }), fileName(recording, String(recording.id)), blob.audio_blob);
  }

  const transcripts = portableRows('study_transcripts').filter((row) => recordingIds.has(String(row.recording_id)));
  const transcriptIds = new Set(transcripts.map((row) => String(row.id)));
  const questions = portableRows('study_questions').filter((row) => matchesDirectScope(row) || documentIds.has(String(row.document_id ?? '')) || materialIds.has(String(row.material_id ?? '')) || recordingIds.has(String(row.recording_id ?? '')) || transcriptIds.has(String(row.transcript_id ?? '')));
  const questionIds = new Set(questions.map((row) => String(row.id)));
  const collectionItems = portableRows('study_question_collection_items').filter((row) => questionIds.has(String(row.question_id)));
  const collectionIds = new Set(collectionItems.map((row) => String(row.collection_id)));
  const allAssessmentItems = portableRows('study_assessment_items');
  const assessmentIdsFromQuestions = new Set(allAssessmentItems.filter((row) => questionIds.has(String(row.question_id))).map((row) => String(row.assessment_id)));
  const assessments = portableRows('study_assessments').filter((row) => matchesDirectScope(row) || assessmentIdsFromQuestions.has(String(row.id)));
  const assessmentIds = new Set(assessments.map((row) => String(row.id)));
  const subjectIds = new Set(scope.kind === 'workspace' ? workspace.subjects.map((subject) => subject.id)
    : scope.kind === 'course' ? workspace.subjects.filter((subject) => subject.courseId === scope.id).map((subject) => subject.id)
    : scope.kind === 'subject' && scope.id ? [scope.id]
    : scope.kind === 'topic' ? workspace.topics.filter((topic) => topic.id === scope.id).map((topic) => topic.subjectId)
    : scope.kind === 'folder' ? workspace.folders.filter((folder) => folder.id === scope.id && folder.subjectId).map((folder) => String(folder.subjectId))
    : scope.kind === 'document' ? workspace.placements.filter((placement) => placement.documentId === scope.id && placement.subjectId).map((placement) => String(placement.subjectId)) : []);
  const scopedStudyIdeas = portableRows('study_ideas').filter((row) => subjectIds.has(String(row.subject_id)));
  const scopedStudyIdeaIds = new Set(scopedStudyIdeas.map((row) => String(row.id)));
  const studyIdeaOccurrences = portableRows('study_idea_occurrences').filter((row) => scopedStudyIdeaIds.has(String(row.idea_id))
    && (scope.kind === 'workspace' || (String(row.source_kind) === 'material' ? materialIds.has(String(row.source_id)) : documentIds.has(String(row.source_id)))));
  const studyIdeaIds = new Set(studyIdeaOccurrences.map((row) => String(row.idea_id)));
  const studyIdeas = scopedStudyIdeas.filter((row) => studyIdeaIds.has(String(row.id)));
  const studyOccurrenceIds = new Set(studyIdeaOccurrences.map((row) => String(row.id)));
  const data = {
    documents, placements: workspace.placements.filter((placement) => documentIds.has(placement.documentId)),
    materials: selectedMaterials, materialPlacements: materialPlacements.filter((row) => materialIds.has(String(row.material_id))),
    recordings: recordingRows,
    transcripts, transcriptSegments: portableRows('study_transcript_segments').filter((row) => transcriptIds.has(String(row.transcript_id))),
    questions, questionVersions: portableRows('study_question_versions').filter((row) => questionIds.has(String(row.question_id))),
    questionCollections: portableRows('study_question_collections').filter((row) => collectionIds.has(String(row.id))), collectionItems,
    assessments, assessmentItems: allAssessmentItems.filter((row) => assessmentIds.has(String(row.assessment_id))),
    rubrics: portableRows('study_rubrics').filter((row) => scope.kind === 'workspace' || assessments.some((assessment) => String(assessment.rubric_id ?? '') === String(row.id))),
    flashcards: portableRows('study_flashcards').filter((row) => scope.kind === 'workspace' || questionIds.has(String(row.question_id ?? '')) || documentIds.has(String(row.document_id ?? '')) || matchesDirectScope(row)),
    ideas: studyIdeas,
    ideaOccurrences: studyIdeaOccurrences,
    ideaEvidence: portableRows('study_idea_evidence').filter((row) => studyOccurrenceIds.has(String(row.occurrence_id))),
    ideaEdges: portableRows('study_idea_edges').filter((row) => studyIdeaIds.has(String(row.from_id)) && studyIdeaIds.has(String(row.to_id))),
    knowledgeJobs: portableRows('study_knowledge_jobs').filter((row) => subjectIds.has(String(row.subject_id))
      && (scope.kind === 'workspace' || (String(row.source_kind) === 'material' ? materialIds.has(String(row.source_id)) : documentIds.has(String(row.source_id))))),
  };
  const manifest = { format: 'nodus-study-readonly', formatVersion: 1, exportedAt: new Date().toISOString(), readOnly: true, scope, title: scopeTitle(workspace, scope), documentCount: documents.length, materialCount: selectedMaterials.length, recordingCount: recordingRows.length, ideaCount: studyIdeas.length };
  zip.addFile('_Nodus/manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  zip.addFile('_Nodus/estudio.json', Buffer.from(JSON.stringify(data, null, 2)));
  zip.addFile('LEEME.txt', Buffer.from('Exportación de Nodus organizada por cursos, asignaturas, carpetas y temas. La carpeta _Nodus contiene datos de referencia para conservar el contexto de la exportación.\n'));
  return zip.toBuffer();
}

function extension(format: StudyExportFormat): string {
  return format === 'markdown' ? 'md' : format === 'bundle' ? 'zip' : format;
}

export async function exportStudyScope(scope: StudyExportScope, format: StudyExportFormat): Promise<{ path: string } | null> {
  const built = buildStudyExportMarkdown(scope);
  const ext = extension(format);
  const picked = await dialog.showSaveDialog({
    title: 'Exportar estudio', defaultPath: path.join(app.getPath('documents'), `${slug(built.title)}.${ext}`),
    filters: [{ name: format === 'bundle' ? 'Archivo ZIP' : format.toUpperCase(), extensions: [ext] }],
  });
  if (picked.canceled || !picked.filePath) return null;
  let bytes: Buffer | string;
  if (format === 'markdown') bytes = built.markdown;
  else if (format === 'txt') bytes = markdownToPlainText(built.markdown);
  else if (format === 'html') bytes = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(built.title)}</title><style>body{max-width:900px;margin:48px auto;padding:0 24px;font:16px/1.65 system-ui;color:#1f2937}h1,h2{line-height:1.2}</style></head><body>${markdownToHtml(built.markdown)}</body></html>`;
  else if (format === 'docx') bytes = await markdownToDocx(built.markdown);
  else if (format === 'pdf') bytes = await markdownToPdf(built.markdown, built.title);
  else bytes = buildStudyBundle(scope);
  fs.writeFileSync(picked.filePath, bytes);
  return { path: picked.filePath };
}
