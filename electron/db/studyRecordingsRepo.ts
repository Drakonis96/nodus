import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  StudyAudioMarker,
  StudyAudioMarkerInput,
  StudyRecordingContent,
  StudyRecordingCreateInput,
  StudyRecordingDetail,
  StudyRecordingImportResult,
  StudyRecordingListOptions,
  StudyRecordingStatus,
  StudyRecordingSummary,
  StudyRecordingUpdateInput,
  StudyTranscript,
  StudyTranscriptInput,
  StudyTranscriptKind,
  StudyTranscriptSegment,
  StudyTranscriptSegmentInput,
} from '@shared/studyRecordings';
import type { StudyPlacementInput } from '@shared/studyOrg';
import { STUDY_RECORDING_EXTENSIONS, normalizeStudyTranscriptSegments } from '@shared/studyRecordings';
import { createStudyShortId, normalizeStudyName } from '@shared/studyOrg';
import { getDb } from './database';
import { addStudyPlacement, createStudyDocument } from './studyOrgRepo';

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();
const bool = (value: unknown) => Number(value) === 1;

const MIME_BY_EXTENSION: Record<string, string> = {
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', webm: 'audio/webm',
};

function ids(prefix: string) {
  const id = crypto.randomUUID();
  return { id, shortId: createStudyShortId(prefix, id) };
}

function toRecording(row: Row): StudyRecordingSummary {
  return {
    id: String(row.id), shortId: String(row.short_id), title: String(row.title), fileName: String(row.file_name ?? ''),
    mimeType: String(row.mime_type ?? 'audio/webm'), contentHash: String(row.content_hash ?? ''),
    durationSeconds: Number(row.duration_seconds ?? 0), sizeBytes: Number(row.size_bytes ?? 0), language: String(row.language ?? ''),
    courseId: row.course_id ? String(row.course_id) : null, subjectId: row.subject_id ? String(row.subject_id) : null,
    topicId: row.topic_id ? String(row.topic_id) : null, documentId: row.document_id ? String(row.document_id) : null,
    materialId: row.material_id ? String(row.material_id) : null, sessionLabel: String(row.session_label ?? ''),
    processingStatus: String(row.processing_status ?? 'pending') as StudyRecordingStatus,
    processingProgress: Number(row.processing_progress ?? 0), favorite: bool(row.favorite), position: Number(row.position ?? 0),
    archivedAt: row.archived_at ? String(row.archived_at) : null, deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function toMarker(row: Row): StudyAudioMarker {
  return {
    id: String(row.id), shortId: String(row.short_id), recordingId: String(row.recording_id), tSeconds: Number(row.t_seconds ?? 0),
    label: String(row.label ?? ''), note: String(row.note ?? ''), color: String(row.color ?? '#14b8a6'), position: Number(row.position ?? 0),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function toSegment(row: Row): StudyTranscriptSegment {
  return {
    id: String(row.id), shortId: String(row.short_id), transcriptId: String(row.transcript_id),
    tStart: Number(row.t_start ?? 0), tEnd: Number(row.t_end ?? 0), text: String(row.text ?? ''), speaker: String(row.speaker ?? ''),
    confidence: row.confidence == null ? null : Number(row.confidence), chapter: String(row.chapter ?? ''), position: Number(row.position ?? 0),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function toTranscript(row: Row, segments: StudyTranscriptSegment[] = []): StudyTranscript {
  return {
    id: String(row.id), shortId: String(row.short_id), recordingId: String(row.recording_id),
    kind: String(row.kind ?? 'literal') as StudyTranscriptKind, contentMarkdown: String(row.content_markdown ?? ''),
    language: String(row.language ?? ''), modelProvider: String(row.model_provider ?? ''), modelName: String(row.model_name ?? ''),
    status: String(row.status ?? 'pending') as StudyRecordingStatus, progress: Number(row.progress ?? 0),
    errorMessage: String(row.error_message ?? ''), versionNo: Number(row.version_no ?? 1),
    sourceTranscriptId: row.source_transcript_id ? String(row.source_transcript_id) : null, segments,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function recordingRow(id: string): Row {
  const row = getDb().prepare('SELECT * FROM study_recordings WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new Error('Grabación no encontrada.');
  return row;
}

function extOf(fileName: string): string {
  return path.extname(fileName).slice(1).toLocaleLowerCase();
}

export function supportsStudyRecording(fileName: string): boolean {
  return (STUDY_RECORDING_EXTENSIONS as readonly string[]).includes(extOf(fileName));
}

export function listStudyRecordings(options: StudyRecordingListOptions = {}): StudyRecordingSummary[] {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (!options.includeArchived) clauses.push('archived_at IS NULL');
  if (!options.includeDeleted) clauses.push('deleted_at IS NULL');
  if (options.status && options.status !== 'all') { clauses.push('processing_status = ?'); values.push(options.status); }
  if (options.search?.trim()) {
    const query = `%${options.search.trim()}%`;
    clauses.push(`(title LIKE ? OR file_name LIKE ? OR session_label LIKE ? OR EXISTS (
      SELECT 1 FROM study_transcripts t WHERE t.recording_id = study_recordings.id AND t.content_markdown LIKE ?))`);
    values.push(query, query, query, query);
  }
  for (const [column, value] of [['course_id', options.courseId], ['subject_id', options.subjectId], ['topic_id', options.topicId], ['document_id', options.documentId]] as const) {
    if (value) { clauses.push(`${column} = ?`); values.push(value); }
  }
  return (getDb().prepare(`SELECT * FROM study_recordings ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY favorite DESC, position, updated_at DESC`).all(...values) as Row[]).map(toRecording);
}

export function getStudyRecording(id: string): StudyRecordingDetail {
  const db = getDb();
  const summary = toRecording(recordingRow(id));
  const markers = (db.prepare('SELECT * FROM study_audio_markers WHERE recording_id = ? ORDER BY t_seconds, position').all(id) as Row[]).map(toMarker);
  const rows = db.prepare('SELECT * FROM study_transcripts WHERE recording_id = ? ORDER BY kind, version_no DESC').all(id) as Row[];
  const transcripts = rows.map((row) => {
    const segments = (db.prepare('SELECT * FROM study_transcript_segments WHERE transcript_id = ? ORDER BY t_start, position').all(String(row.id)) as Row[]).map(toSegment);
    return toTranscript(row, segments);
  });
  return { ...summary, markers, transcripts };
}

export function getStudyRecordingContent(id: string): StudyRecordingContent {
  const row = recordingRow(id);
  if (row.audio_blob == null) throw new Error('El audio se eliminó; la transcripción se conserva.');
  const bytes = row.audio_blob instanceof Uint8Array ? row.audio_blob : new Uint8Array(row.audio_blob as ArrayBuffer);
  return { bytes, mimeType: String(row.mime_type ?? 'audio/webm'), fileName: String(row.file_name ?? 'recording.webm') };
}

export function createStudyRecording(input: StudyRecordingCreateInput): StudyRecordingImportResult {
  if (!input.bytes?.byteLength) throw new Error('El audio está vacío.');
  const db = getDb();
  const bytes = Buffer.from(input.bytes);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const duplicate = db.prepare('SELECT * FROM study_recordings WHERE content_hash = ? AND deleted_at IS NULL LIMIT 1').get(hash) as Row | undefined;
  if (duplicate) return { recording: toRecording(duplicate), duplicate: true };
  const key = ids('REC'); const timestamp = now();
  const baseName = path.basename(input.fileName, path.extname(input.fileName));
  const title = normalizeStudyName(input.title?.trim() || baseName || 'Grabación');
  const position = Number((db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS value FROM study_recordings').get() as Row).value);
  db.prepare(`INSERT INTO study_recordings
    (id, short_id, title, file_name, mime_type, audio_blob, content_hash, duration_seconds, size_bytes, language,
     course_id, subject_id, topic_id, document_id, material_id, session_label, processing_status, processing_progress,
     position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`)
    .run(key.id, key.shortId, title, path.basename(input.fileName), input.mimeType || MIME_BY_EXTENSION[extOf(input.fileName)] || 'audio/webm',
      bytes, hash, Math.max(0, input.durationSeconds ?? 0), bytes.length, input.language ?? 'es', input.courseId ?? null,
      input.subjectId ?? null, input.topicId ?? null, input.documentId ?? null, input.materialId ?? null,
      input.sessionLabel?.trim() || null, position, timestamp, timestamp);
  return { recording: toRecording(recordingRow(key.id)), duplicate: false };
}

export function importStudyRecordingFile(filePath: string, scope: Omit<StudyRecordingCreateInput, 'bytes' | 'fileName' | 'mimeType'> = {}): StudyRecordingImportResult {
  if (!supportsStudyRecording(filePath)) throw new Error(`Formato de audio no compatible: .${extOf(filePath) || '?'}`);
  return createStudyRecording({ ...scope, fileName: path.basename(filePath), mimeType: MIME_BY_EXTENSION[extOf(filePath)] ?? 'application/octet-stream', bytes: fs.readFileSync(filePath) });
}

export function updateStudyRecording(id: string, patch: StudyRecordingUpdateInput): StudyRecordingSummary {
  recordingRow(id);
  const allowed: Record<keyof StudyRecordingUpdateInput, string> = {
    title: 'title', durationSeconds: 'duration_seconds', language: 'language', courseId: 'course_id', subjectId: 'subject_id',
    topicId: 'topic_id', documentId: 'document_id', materialId: 'material_id', sessionLabel: 'session_label',
    processingStatus: 'processing_status', processingProgress: 'processing_progress', favorite: 'favorite', position: 'position',
  };
  const entries = Object.entries(patch).filter(([key, value]) => key in allowed && value !== undefined);
  if (!entries.length) return toRecording(recordingRow(id));
  const values = entries.map(([key, value]) => key === 'favorite' ? (value ? 1 : 0) : key === 'title' ? normalizeStudyName(String(value)) : key === 'processingProgress' ? Math.max(0, Math.min(1, Number(value))) : value);
  getDb().prepare(`UPDATE study_recordings SET ${entries.map(([key]) => `${allowed[key as keyof StudyRecordingUpdateInput]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...values, now(), id);
  return toRecording(recordingRow(id));
}

export function createStudyAudioMarker(recordingId: string, input: StudyAudioMarkerInput): StudyAudioMarker {
  recordingRow(recordingId);
  const db = getDb(); const key = ids('MRK'); const timestamp = now();
  const position = Number((db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS value FROM study_audio_markers WHERE recording_id = ?').get(recordingId) as Row).value);
  db.prepare(`INSERT INTO study_audio_markers (id, short_id, recording_id, t_seconds, label, note, color, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, recordingId, Math.max(0, input.tSeconds), normalizeStudyName(input.label), input.note?.trim() || null, input.color ?? '#14b8a6', position, timestamp, timestamp);
  return toMarker(db.prepare('SELECT * FROM study_audio_markers WHERE id = ?').get(key.id) as Row);
}

export function updateStudyAudioMarker(id: string, patch: Partial<StudyAudioMarkerInput>): StudyAudioMarker {
  const db = getDb();
  const row = db.prepare('SELECT * FROM study_audio_markers WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new Error('Marcador no encontrado.');
  const next = { ...toMarker(row), ...patch };
  db.prepare('UPDATE study_audio_markers SET t_seconds = ?, label = ?, note = ?, color = ?, updated_at = ? WHERE id = ?')
    .run(Math.max(0, next.tSeconds), normalizeStudyName(next.label), next.note?.trim() || null, next.color || '#14b8a6', now(), id);
  return toMarker(db.prepare('SELECT * FROM study_audio_markers WHERE id = ?').get(id) as Row);
}

export function deleteStudyAudioMarker(id: string): void {
  getDb().prepare('DELETE FROM study_audio_markers WHERE id = ?').run(id);
}

function insertSegments(transcriptId: string, inputs: StudyTranscriptSegmentInput[]): StudyTranscriptSegment[] {
  const db = getDb(); const timestamp = now();
  const insert = db.prepare(`INSERT INTO study_transcript_segments
    (id, short_id, transcript_id, t_start, t_end, text, speaker, confidence, chapter, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  return inputs.filter((segment) => segment.text.trim()).map((segment, position) => {
    const key = ids('SEG');
    insert.run(key.id, key.shortId, transcriptId, Math.max(0, segment.tStart), Math.max(segment.tStart, segment.tEnd),
      segment.text.trim(), segment.speaker?.trim() || null, segment.confidence ?? null, segment.chapter?.trim() || null, position, timestamp, timestamp);
    return toSegment(db.prepare('SELECT * FROM study_transcript_segments WHERE id = ?').get(key.id) as Row);
  });
}

export function saveStudyTranscript(recordingId: string, input: StudyTranscriptInput): StudyTranscript {
  const recording = toRecording(recordingRow(recordingId)); const db = getDb(); const timestamp = now(); const key = ids('TRN');
  const versionNo = Number((db.prepare('SELECT COALESCE(MAX(version_no), 0) + 1 AS value FROM study_transcripts WHERE recording_id = ? AND kind = ?').get(recordingId, input.kind) as Row).value);
  db.prepare(`INSERT INTO study_transcripts
    (id, short_id, recording_id, kind, content_markdown, language, model_provider, model_name, status, progress, error_message,
     version_no, source_transcript_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, recordingId, input.kind, input.contentMarkdown, input.language ?? recording.language,
      input.modelProvider ?? '', input.modelName ?? '', input.status ?? 'ready', input.progress ?? 1, input.errorMessage ?? '',
      versionNo, input.sourceTranscriptId ?? null, timestamp, timestamp);
  const segments = insertSegments(key.id, input.segments?.length
    ? input.segments
    : normalizeStudyTranscriptSegments(undefined, input.contentMarkdown, recording.durationSeconds));
  if (input.kind === 'literal') updateStudyRecording(recordingId, { processingStatus: input.status ?? 'ready', processingProgress: input.progress ?? 1 });
  return toTranscript(db.prepare('SELECT * FROM study_transcripts WHERE id = ?').get(key.id) as Row, segments);
}

export function updateStudyTranscript(id: string, contentMarkdown: string, segments?: StudyTranscriptSegmentInput[]): StudyTranscript {
  const db = getDb(); const row = db.prepare('SELECT * FROM study_transcripts WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new Error('Transcripción no encontrada.');
  db.transaction(() => {
    db.prepare('UPDATE study_transcripts SET content_markdown = ?, status = ?, progress = 1, error_message = NULL, updated_at = ? WHERE id = ?')
      .run(contentMarkdown, 'ready', now(), id);
    if (segments) { db.prepare('DELETE FROM study_transcript_segments WHERE transcript_id = ?').run(id); insertSegments(id, segments); }
  })();
  return getStudyRecording(String(row.recording_id)).transcripts.find((transcript) => transcript.id === id)!;
}

export function deleteStudyTranscript(id: string): void {
  getDb().prepare('DELETE FROM study_transcripts WHERE id = ?').run(id);
}

export function updateStudyTranscriptSegment(id: string, patch: Partial<StudyTranscriptSegmentInput>): StudyTranscriptSegment {
  const db = getDb(); const row = db.prepare('SELECT * FROM study_transcript_segments WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new Error('Bloque de transcripción no encontrado.');
  const next = { ...toSegment(row), ...patch };
  db.prepare(`UPDATE study_transcript_segments SET t_start = ?, t_end = ?, text = ?, speaker = ?, confidence = ?, chapter = ?, updated_at = ? WHERE id = ?`)
    .run(Math.max(0, next.tStart), Math.max(next.tStart, next.tEnd), next.text.trim(), next.speaker?.trim() || null,
      next.confidence ?? null, next.chapter?.trim() || null, now(), id);
  return toSegment(db.prepare('SELECT * FROM study_transcript_segments WHERE id = ?').get(id) as Row);
}

export function createStudyNoteFromTranscript(recordingId: string, transcriptId: string, placements?: StudyPlacementInput[]): { documentId: string } {
  const recording = getStudyRecording(recordingId);
  const transcript = recording.transcripts.find((entry) => entry.id === transcriptId);
  if (!transcript) throw new Error('Transcripción no encontrada.');
  const link = `nodus://study/recording/${recordingId}?transcript=${transcriptId}`;
  const requestedPlacements = (placements ?? []).filter((placement) => placement.courseId || placement.subjectId || placement.topicId || placement.folderId);
  const fallbackPlacement = recording.courseId || recording.subjectId || recording.topicId
    ? { courseId: recording.courseId, subjectId: recording.subjectId, topicId: recording.topicId }
    : null;
  const document = createStudyDocument({
    title: `${recording.title} — ${transcript.kind === 'notes' ? 'apuntes' : 'transcripción'}`,
    kind: 'apunte',
    contentMarkdown: `${transcript.contentMarkdown}\n\n---\n\n[Escuchar grabación](${link})`,
    placement: requestedPlacements[0] ?? fallbackPlacement ?? undefined,
  });
  for (const placement of requestedPlacements.slice(1)) addStudyPlacement(document.id, placement);
  updateStudyRecording(recordingId, { documentId: document.id });
  return { documentId: document.id };
}

export function deleteStudyRecordingAudio(id: string): StudyRecordingSummary {
  recordingRow(id);
  getDb().prepare(`UPDATE study_recordings SET audio_blob = NULL, size_bytes = 0, file_path = NULL,
    content_hash = ?, updated_at = ? WHERE id = ?`).run(`removed:${id}`, now(), id);
  return toRecording(recordingRow(id));
}

export function setStudyRecordingLifecycle(id: string, action: 'archive' | 'restore' | 'trash' | 'recover' | 'delete'): void {
  const db = getDb(); recordingRow(id);
  if (action === 'delete') { db.prepare('DELETE FROM study_recordings WHERE id = ?').run(id); return; }
  const column = action === 'archive' || action === 'restore' ? 'archived_at' : 'deleted_at';
  const value = action === 'archive' || action === 'trash' ? now() : null;
  db.prepare(`UPDATE study_recordings SET ${column} = ?, updated_at = ? WHERE id = ?`).run(value, now(), id);
}
