// Archivos y transcripciones del vault de Testimonios (v105).
//
// Las dos promesas del vault viven aquí:
//
//   EL ORIGINAL NUNCA SE CORRIGE. Un maestro entra tal y como se recibió — sin
//   transcodificar, sin normalizar, sin recortar silencios — se le calcula la huella y se
//   marca inmutable. Cualquier procesado crea un DERIVADO que recuerda de dónde viene.
//   En historia oral una pausa puede ser parte del sentido, y un archivo «mejorado» es un
//   archivo distinto del que se grabó.
//
//   LA TRANSCRIPCIÓN AUTOMÁTICA TAMPOCO. Corregir, revisar, aprobar, anonimizar o
//   traducir crea una fila nueva con `source_transcript_id`. El literal es la raíz del
//   linaje y sigue ahí para siempre, porque es la única prueba de qué dijo el modelo
//   frente a qué decidió el investigador.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuid } from 'uuid';
import { getDb } from './database';
import {
  canDeriveTranscript,
  formatShortId,
  isEditableTranscriptKind,
  remapAnnotation,
  type TranscriptKind,
} from '@shared/testimonies';
import type {
  TestimonyMedia,
  TestimonyMediaImportInput,
  TestimonyMediaImportResult,
  TestimonyMediaKind,
  TestimonyMediaRole,
  TestimonyTranscript,
  TestimonyTranscriptSegment,
  TestimonyTranscriptStatus,
} from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${uuid()}`;
}

function nextShort(prefix: 'MED' | 'TRN' | 'SEG', table: string): string {
  const row = getDb()
    .prepare(`SELECT short_id FROM ${table} WHERE short_id LIKE ? ORDER BY LENGTH(short_id) DESC, short_id DESC LIMIT 1`)
    .get(`${prefix}-%`) as { short_id: string } | undefined;
  const last = row ? Number(row.short_id.slice(4)) : 0;
  return formatShortId(prefix, (Number.isFinite(last) ? last : 0) + 1);
}

/**
 * Los formatos que se aceptan como maestro.
 *
 * La lista es ancha a propósito: el trabajo de campo llega en lo que la grabadora
 * escupió, y rechazar un archivo porque no es WAV significa que el investigador lo
 * guardará fuera de Nodus, que es peor. Recomendar formatos abiertos es tarea de la
 * pantalla de depósito, no de la puerta de entrada.
 */
export const TESTIMONY_AUDIO_EXTENSIONS = ['wav', 'mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'webm', 'flac', 'aiff', 'aif', 'wma', 'amr'] as const;
export const TESTIMONY_VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'mkv', 'avi', 'webm'] as const;

const MIME_BY_EXTENSION: Record<string, string> = {
  wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg',
  oga: 'audio/ogg', opus: 'audio/opus', webm: 'audio/webm', flac: 'audio/flac', aiff: 'audio/aiff',
  aif: 'audio/aiff', wma: 'audio/x-ms-wma', amr: 'audio/amr',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
};

/** Formatos con pérdida o propietarios: se avisa, NUNCA se bloquea. */
const LOSSY_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'webm', 'wma', 'amr']);
const PROPRIETARY_EXTENSIONS = new Set(['wma', 'amr', 'm4a', 'aac']);

export function extensionOf(fileName: string): string {
  return path.extname(fileName).slice(1).toLocaleLowerCase();
}

export function mimeForFile(fileName: string): string {
  return MIME_BY_EXTENSION[extensionOf(fileName)] ?? 'application/octet-stream';
}

export function mediaKindForFile(fileName: string): TestimonyMediaKind {
  const ext = extensionOf(fileName);
  if ((TESTIMONY_VIDEO_EXTENSIONS as readonly string[]).includes(ext) && !(TESTIMONY_AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
    return 'video';
  }
  if ((TESTIMONY_AUDIO_EXTENSIONS as readonly string[]).includes(ext)) return 'audio';
  if (['pdf', 'doc', 'docx', 'odt', 'txt', 'md', 'rtf'].includes(ext)) return 'document';
  if (['jpg', 'jpeg', 'png', 'webp', 'heic', 'tif', 'tiff'].includes(ext)) return 'image';
  return 'document';
}

/** Advertencias de preservación de un archivo. Informan; no impiden guardarlo. */
export function preservationWarnings(fileName: string): string[] {
  const ext = extensionOf(fileName);
  const warnings: string[] = [];
  if (LOSSY_EXTENSIONS.has(ext)) warnings.push('formato con pérdida');
  if (PROPRIETARY_EXTENSIONS.has(ext)) warnings.push('formato propietario');
  return warnings;
}

// ── Archivos ─────────────────────────────────────────────────────────────────

interface MediaRow {
  id: string;
  short_id: string;
  session_id: string;
  media_kind: TestimonyMediaKind;
  role: TestimonyMediaRole;
  file_name: string | null;
  mime_type: string | null;
  content_hash: string | null;
  duration_seconds: number | null;
  size_bytes: number | null;
  technical_json: string | null;
  source_media_id: string | null;
  immutable: number;
  created_at: string;
  deleted_at: string | null;
}

function parseTechnical(json: string | null): Record<string, string | number | null> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function rowToMedia(row: MediaRow, transcripts: TestimonyTranscript[] = []): TestimonyMedia {
  return {
    id: row.id,
    shortId: row.short_id,
    sessionId: row.session_id,
    mediaKind: row.media_kind,
    role: row.role,
    fileName: row.file_name,
    mimeType: row.mime_type,
    contentHash: row.content_hash,
    durationSeconds: row.duration_seconds,
    sizeBytes: row.size_bytes,
    technical: parseTechnical(row.technical_json),
    sourceMediaId: row.source_media_id,
    immutable: row.immutable === 1,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    transcripts,
  };
}

/**
 * Guardar un archivo. Devuelve también `duplicateOf` cuando la huella ya existía EN LA
 * MISMA SESIÓN: importar dos veces el mismo archivo es un accidente frecuente y duplicar
 * un maestro de dos horas cuesta el doble de bóveda para nada. Entre sesiones distintas
 * NO se deduplica: el mismo audio en dos sesiones puede ser deliberado.
 */
export function importMedia(input: TestimonyMediaImportInput): TestimonyMediaImportResult {
  const bytes = Buffer.isBuffer(input.bytes)
    ? input.bytes
    : Buffer.from(input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes));
  if (bytes.length === 0) throw new Error('El archivo está vacío.');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const db = getDb();

  const existing = db
    .prepare('SELECT * FROM testimony_media WHERE session_id = ? AND content_hash = ? AND deleted_at IS NULL')
    .get(input.sessionId, hash) as MediaRow | undefined;
  if (existing) {
    return { media: rowToMedia(existing), duplicateOf: existing.id, proposedStatus: null };
  }

  const id = newId('med');
  const role = input.role ?? 'master';
  db.prepare(
    `INSERT INTO testimony_media
      (id, short_id, session_id, media_kind, role, file_name, mime_type, content_blob, content_hash,
       duration_seconds, size_bytes, technical_json, source_media_id, immutable, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    nextShort('MED', 'testimony_media'),
    input.sessionId,
    input.mediaKind ?? mediaKindForFile(input.fileName),
    role,
    input.fileName,
    input.mimeType || mimeForFile(input.fileName),
    bytes,
    hash,
    input.durationSeconds ?? null,
    bytes.length,
    input.technical ? JSON.stringify(input.technical) : null,
    input.sourceMediaId ?? null,
    role === 'master' ? 1 : 0,
    now()
  );
  // Una sesión con un maestro dentro está grabada, aunque nadie lo haya dicho.
  if (role === 'master') {
    db.prepare("UPDATE testimony_sessions SET status = 'recorded', recorded_at = COALESCE(recorded_at, ?), updated_at = ? WHERE id = ? AND status = 'planned'")
      .run(now(), now(), input.sessionId);
  }
  return { media: getMedia(id)!, duplicateOf: null, proposedStatus: null };
}

export function importMediaFile(sessionId: string, filePath: string, role: TestimonyMediaRole = 'master'): TestimonyMediaImportResult {
  const bytes = fs.readFileSync(filePath);
  return importMedia({
    sessionId,
    fileName: path.basename(filePath),
    mimeType: mimeForFile(filePath),
    bytes,
    role,
  });
}

const MEDIA_COLUMNS =
  'id, short_id, session_id, media_kind, role, file_name, mime_type, content_hash, duration_seconds, size_bytes, technical_json, source_media_id, immutable, created_at, deleted_at';

export function getMedia(id: string): TestimonyMedia | null {
  const row = getDb().prepare(`SELECT ${MEDIA_COLUMNS} FROM testimony_media WHERE id = ?`).get(id) as MediaRow | undefined;
  return row ? rowToMedia(row, listTranscripts(id)) : null;
}

/**
 * El blob, aparte y solo cuando alguien lo pide.
 *
 * Nunca viaja con una lista: un maestro de dos horas son cientos de megabytes, y la
 * pantalla de sesiones pinta seis. La misma regla que ya siguen los mapas del vault de
 * worldbuilding con sus imágenes.
 */
export function getMediaBlob(id: string): { bytes: Buffer; mimeType: string; fileName: string } | null {
  const row = getDb()
    .prepare('SELECT content_blob, mime_type, file_name FROM testimony_media WHERE id = ?')
    .get(id) as { content_blob: Buffer | null; mime_type: string | null; file_name: string | null } | undefined;
  if (!row?.content_blob) return null;
  return {
    bytes: row.content_blob,
    mimeType: row.mime_type ?? 'application/octet-stream',
    fileName: row.file_name ?? 'audio',
  };
}

/** Los archivos de varias sesiones a la vez, para no consultar una vez por fila. */
export function listMediaForSessions(sessionIds: string[]): Map<string, TestimonyMedia[]> {
  const out = new Map<string, TestimonyMedia[]>();
  if (sessionIds.length === 0) return out;
  const marks = sessionIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT ${MEDIA_COLUMNS} FROM testimony_media WHERE session_id IN (${marks}) AND deleted_at IS NULL ORDER BY created_at`)
    .all(...sessionIds) as MediaRow[];
  const transcripts = listTranscriptsForMedia(rows.map((row) => row.id));
  for (const row of rows) {
    const list = out.get(row.session_id) ?? [];
    list.push(rowToMedia(row, transcripts.get(row.id) ?? []));
    out.set(row.session_id, list);
  }
  return out;
}

/**
 * Verificar la huella de un archivo contra sus bytes reales.
 *
 * Es lo que convierte «tengo el original» en «tengo el original ÍNTEGRO». Una huella que
 * deja de coincidir es corrupción silenciosa — el fallo que un archivo digital sufre sin
 * avisar — y por eso Inicio la vigila en vez de esperar a que alguien abra el archivo.
 */
export function verifyMediaHash(id: string): { ok: boolean; expected: string | null; actual: string | null } {
  const row = getDb()
    .prepare('SELECT content_blob, content_hash FROM testimony_media WHERE id = ?')
    .get(id) as { content_blob: Buffer | null; content_hash: string | null } | undefined;
  if (!row) return { ok: false, expected: null, actual: null };
  if (!row.content_blob) return { ok: false, expected: row.content_hash, actual: null };
  const actual = crypto.createHash('sha256').update(row.content_blob).digest('hex');
  return { ok: actual === row.content_hash, expected: row.content_hash, actual };
}

/**
 * Soltar los bytes de un archivo conservando su ficha, su huella y sus transcripciones.
 *
 * Existe porque una bóveda con quinientas horas dentro no cabe en cualquier equipo, y la
 * alternativa real no es «no borrar»: es que el investigador saque el audio a mano y
 * pierda el vínculo. La fila se queda para que la entrevista siga sabiendo QUÉ tenía y
 * con qué huella; la interfaz exige exportarlo antes.
 */
export function dropMediaBytes(id: string): TestimonyMedia | null {
  getDb().prepare('UPDATE testimony_media SET content_blob = NULL WHERE id = ?').run(id);
  return getMedia(id);
}

export function deleteMedia(id: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    const transcriptIds = (db.prepare('SELECT id FROM testimony_transcripts WHERE media_id = ?').all(id) as { id: string }[])
      .map((row) => row.id);
    if (transcriptIds.length) {
      const marks = transcriptIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM testimony_transcript_segments WHERE transcript_id IN (${marks})`).run(...transcriptIds);
      const annIds = (db
        .prepare(`SELECT id FROM testimony_annotations WHERE transcript_id IN (${marks})`)
        .all(...transcriptIds) as { id: string }[]).map((row) => row.id);
      if (annIds.length) {
        const aMarks = annIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM testimony_annotation_codes WHERE annotation_id IN (${aMarks})`).run(...annIds);
        db.prepare(`DELETE FROM testimony_contrast_items WHERE annotation_id IN (${aMarks})`).run(...annIds);
        db.prepare(`DELETE FROM testimony_note_links WHERE target_kind = 'testimony_annotation' AND target_id IN (${aMarks})`).run(...annIds);
        db.prepare(`DELETE FROM testimony_annotations WHERE id IN (${aMarks})`).run(...annIds);
      }
      db.prepare(`DELETE FROM testimony_transcripts WHERE id IN (${marks})`).run(...transcriptIds);
    }
    db.prepare('DELETE FROM testimony_media WHERE id = ?').run(id);
  });
  tx();
}

/** El tamaño total que ocupan los medios de la bóveda. */
export function mediaStorageBytes(): number {
  return ((getDb().prepare('SELECT COALESCE(SUM(size_bytes), 0) AS n FROM testimony_media WHERE deleted_at IS NULL').get() as { n: number }).n);
}

// ── Transcripciones ──────────────────────────────────────────────────────────

interface TranscriptRow {
  id: string;
  short_id: string;
  media_id: string;
  kind: TranscriptKind;
  language: string | null;
  content_markdown: string | null;
  status: TestimonyTranscriptStatus;
  version_no: number;
  source_transcript_id: string | null;
  model_provider: string | null;
  model_name: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTranscript(row: TranscriptRow, segmentCount: number): TestimonyTranscript {
  return {
    id: row.id,
    shortId: row.short_id,
    mediaId: row.media_id,
    kind: row.kind,
    language: row.language,
    contentMarkdown: row.content_markdown,
    status: row.status,
    versionNo: row.version_no,
    sourceTranscriptId: row.source_transcript_id,
    modelProvider: row.model_provider,
    modelName: row.model_name,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    segmentCount,
  };
}

const TRANSCRIPT_COLUMNS =
  'id, short_id, media_id, kind, language, content_markdown, status, version_no, source_transcript_id, model_provider, model_name, approved_at, created_at, updated_at';

export function listTranscripts(mediaId: string): TestimonyTranscript[] {
  return listTranscriptsForMedia([mediaId]).get(mediaId) ?? [];
}

export function listTranscriptsForMedia(mediaIds: string[]): Map<string, TestimonyTranscript[]> {
  const out = new Map<string, TestimonyTranscript[]>();
  if (mediaIds.length === 0) return out;
  const marks = mediaIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT ${TRANSCRIPT_COLUMNS} FROM testimony_transcripts WHERE media_id IN (${marks}) ORDER BY created_at`)
    .all(...mediaIds) as TranscriptRow[];
  const counts = new Map<string, number>();
  if (rows.length) {
    const tMarks = rows.map(() => '?').join(',');
    for (const row of getDb()
      .prepare(`SELECT transcript_id, COUNT(*) AS n FROM testimony_transcript_segments WHERE transcript_id IN (${tMarks}) GROUP BY transcript_id`)
      .all(...rows.map((r) => r.id)) as { transcript_id: string; n: number }[]) {
      counts.set(row.transcript_id, row.n);
    }
  }
  for (const row of rows) {
    const list = out.get(row.media_id) ?? [];
    list.push(rowToTranscript(row, counts.get(row.id) ?? 0));
    out.set(row.media_id, list);
  }
  return out;
}

export function getTranscript(id: string): TestimonyTranscript | null {
  const row = getDb().prepare(`SELECT ${TRANSCRIPT_COLUMNS} FROM testimony_transcripts WHERE id = ?`).get(id) as TranscriptRow | undefined;
  if (!row) return null;
  const count = (getDb().prepare('SELECT COUNT(*) AS n FROM testimony_transcript_segments WHERE transcript_id = ?').get(id) as { n: number }).n;
  return rowToTranscript(row, count);
}

export interface CreateTranscriptInput {
  mediaId: string;
  kind: TranscriptKind;
  language?: string | null;
  contentMarkdown?: string | null;
  status?: TestimonyTranscriptStatus;
  sourceTranscriptId?: string | null;
  modelProvider?: string | null;
  modelName?: string | null;
  segments?: { tStart: number; tEnd: number; text: string; speakerLabel?: string | null; speakerPersonId?: string | null; confidence?: number | null; sourceSegmentId?: string | null }[];
}

export function createTranscript(input: CreateTranscriptInput): TestimonyTranscript {
  const db = getDb();
  if (input.sourceTranscriptId) {
    const source = getTranscript(input.sourceTranscriptId);
    if (!source) throw new Error('La versión de origen no existe.');
    if (!canDeriveTranscript(source.kind, input.kind)) {
      throw new Error('No se puede derivar esa versión a partir de esta.');
    }
  }
  const id = newId('trn');
  const ts = now();
  const versionNo = ((db
    .prepare('SELECT COALESCE(MAX(version_no), 0) AS n FROM testimony_transcripts WHERE media_id = ? AND kind = ?')
    .get(input.mediaId, input.kind) as { n: number }).n) + 1;
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO testimony_transcripts
        (id, short_id, media_id, kind, language, content_markdown, status, version_no, source_transcript_id,
         model_provider, model_name, approved_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      nextShort('TRN', 'testimony_transcripts'),
      input.mediaId,
      input.kind,
      input.language ?? null,
      input.contentMarkdown ?? null,
      input.status ?? 'ready',
      versionNo,
      input.sourceTranscriptId ?? null,
      input.modelProvider ?? null,
      input.modelName ?? null,
      input.kind === 'approved' ? ts : null,
      ts,
      ts
    );
    if (input.segments?.length) insertSegments(id, input.segments);
  });
  tx();
  return getTranscript(id)!;
}

/**
 * Derivar una versión copiando los segmentos de su origen.
 *
 * Copiar y no referenciar: la versión corregida tiene que poder cambiar sin tocar el
 * literal, y `source_segment_id` guarda de qué segmento salió cada uno para que el
 * remapeo de fragmentos y la vista de diferencias sepan emparejarlos.
 */
export function deriveTranscript(sourceId: string, kind: TranscriptKind, options: { language?: string | null } = {}): TestimonyTranscript {
  const source = getTranscript(sourceId);
  if (!source) throw new Error('La versión de origen no existe.');
  const segments = listSegments(sourceId);
  return createTranscript({
    mediaId: source.mediaId,
    kind,
    language: options.language ?? source.language,
    contentMarkdown: source.contentMarkdown,
    status: 'ready',
    sourceTranscriptId: sourceId,
    modelProvider: source.modelProvider,
    modelName: source.modelName,
    segments: segments.map((segment) => ({
      tStart: segment.tStart,
      tEnd: segment.tEnd,
      text: segment.text,
      speakerLabel: segment.speakerLabel,
      speakerPersonId: segment.speakerPersonId,
      confidence: segment.confidence,
      sourceSegmentId: segment.id,
    })),
  });
}

export function setTranscriptStatus(id: string, status: TestimonyTranscriptStatus): TestimonyTranscript | null {
  getDb().prepare('UPDATE testimony_transcripts SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
  return getTranscript(id);
}

export function deleteTranscript(id: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    const annIds = (db.prepare('SELECT id FROM testimony_annotations WHERE transcript_id = ?').all(id) as { id: string }[])
      .map((row) => row.id);
    if (annIds.length) {
      const marks = annIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM testimony_annotation_codes WHERE annotation_id IN (${marks})`).run(...annIds);
      db.prepare(`DELETE FROM testimony_contrast_items WHERE annotation_id IN (${marks})`).run(...annIds);
      db.prepare(`DELETE FROM testimony_note_links WHERE target_kind = 'testimony_annotation' AND target_id IN (${marks})`).run(...annIds);
      db.prepare(`DELETE FROM testimony_annotations WHERE id IN (${marks})`).run(...annIds);
    }
    db.prepare('DELETE FROM testimony_transcript_segments WHERE transcript_id = ?').run(id);
    db.prepare('DELETE FROM testimony_transcripts WHERE id = ?').run(id);
  });
  tx();
}

// ── Segmentos ────────────────────────────────────────────────────────────────

interface SegmentRow {
  id: string;
  short_id: string;
  transcript_id: string;
  source_segment_id: string | null;
  t_start: number;
  t_end: number;
  text: string | null;
  speaker_person_id: string | null;
  speaker_label: string | null;
  confidence: number | null;
  position: number;
  created_at: string;
  updated_at: string;
}

function rowToSegment(row: SegmentRow): TestimonyTranscriptSegment {
  return {
    id: row.id,
    shortId: row.short_id,
    transcriptId: row.transcript_id,
    sourceSegmentId: row.source_segment_id,
    tStart: row.t_start,
    tEnd: row.t_end,
    text: row.text ?? '',
    speakerPersonId: row.speaker_person_id,
    speakerLabel: row.speaker_label,
    confidence: row.confidence,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function insertSegments(transcriptId: string, segments: NonNullable<CreateTranscriptInput['segments']>): void {
  const db = getDb();
  const ts = now();
  const insert = db.prepare(
    `INSERT INTO testimony_transcript_segments
      (id, short_id, transcript_id, source_segment_id, t_start, t_end, text, speaker_person_id, speaker_label, confidence, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // El identificador corto se calcula UNA vez y se incrementa en memoria: consultarlo por
  // segmento convierte una transcripción de 4 000 tramos en 4 000 consultas.
  const start = Number(nextShort('SEG', 'testimony_transcript_segments').slice(4));
  segments.forEach((segment, index) => {
    insert.run(
      newId('seg'),
      formatShortId('SEG', start + index),
      transcriptId,
      segment.sourceSegmentId ?? null,
      Math.max(0, segment.tStart),
      Math.max(segment.tStart, segment.tEnd),
      segment.text,
      segment.speakerPersonId ?? null,
      segment.speakerLabel ?? null,
      segment.confidence ?? null,
      index,
      ts,
      ts
    );
  });
}

export function listSegments(transcriptId: string): TestimonyTranscriptSegment[] {
  return (getDb()
    .prepare('SELECT * FROM testimony_transcript_segments WHERE transcript_id = ? ORDER BY position, t_start')
    .all(transcriptId) as SegmentRow[]).map(rowToSegment);
}

/** Añadir tramos a una versión editable (por ejemplo, mientras llega la transcripción). */
export function appendSegments(transcriptId: string, segments: NonNullable<CreateTranscriptInput['segments']>): void {
  const transcript = getTranscript(transcriptId);
  if (!transcript) throw new Error('La transcripción no existe.');
  const offset = (getDb()
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM testimony_transcript_segments WHERE transcript_id = ?')
    .get(transcriptId) as { n: number }).n;
  const db = getDb();
  const ts = now();
  const insert = db.prepare(
    `INSERT INTO testimony_transcript_segments
      (id, short_id, transcript_id, source_segment_id, t_start, t_end, text, speaker_person_id, speaker_label, confidence, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const start = Number(nextShort('SEG', 'testimony_transcript_segments').slice(4));
  segments.forEach((segment, index) => {
    insert.run(
      newId('seg'), formatShortId('SEG', start + index), transcriptId, segment.sourceSegmentId ?? null,
      Math.max(0, segment.tStart), Math.max(segment.tStart, segment.tEnd), segment.text,
      segment.speakerPersonId ?? null, segment.speakerLabel ?? null, segment.confidence ?? null,
      offset + index, ts, ts
    );
  });
}

/**
 * Editar un tramo. La guarda contra el literal y contra una versión aprobada NO está solo
 * en la interfaz: es aquí donde tiene que estar, porque un `UPDATE` que llegue por otra
 * ruta destruiría la única copia de lo que se dijo o rompería un acuerdo de revisión.
 */
export function updateSegment(
  id: string,
  patch: { text?: string; speakerPersonId?: string | null; speakerLabel?: string | null; tStart?: number; tEnd?: number },
): TestimonyTranscriptSegment | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM testimony_transcript_segments WHERE id = ?').get(id) as SegmentRow | undefined;
  if (!row) return null;
  const transcript = getTranscript(row.transcript_id);
  if (transcript && !isEditableTranscriptKind(transcript.kind)) {
    throw new Error('Esta versión no se puede editar. Crea una versión derivada para trabajar sobre ella.');
  }
  const next = {
    text: patch.text ?? row.text ?? '',
    speakerPersonId: patch.speakerPersonId !== undefined ? patch.speakerPersonId : row.speaker_person_id,
    speakerLabel: patch.speakerLabel !== undefined ? patch.speakerLabel : row.speaker_label,
    tStart: patch.tStart ?? row.t_start,
    tEnd: patch.tEnd ?? row.t_end,
  };
  db.prepare(
    'UPDATE testimony_transcript_segments SET text = ?, speaker_person_id = ?, speaker_label = ?, t_start = ?, t_end = ?, updated_at = ? WHERE id = ?'
  ).run(next.text, next.speakerPersonId, next.speakerLabel, next.tStart, Math.max(next.tStart, next.tEnd), now(), id);
  return rowToSegment(db.prepare('SELECT * FROM testimony_transcript_segments WHERE id = ?').get(id) as SegmentRow);
}

/**
 * Atribuir en lote todos los tramos de una etiqueta provisional a una persona.
 *
 * Es la operación real: nadie identifica «Voz 2» tramo a tramo en una entrevista de hora
 * y media. La detección acústica separa las voces y las numera; PONERLES NOMBRE es manual
 * a propósito, porque una atribución automática equivocada pone palabras en la boca de
 * alguien sin dejar rastro.
 */
export function assignSpeaker(transcriptId: string, speakerLabel: string | null, personId: string | null): number {
  const transcript = getTranscript(transcriptId);
  if (transcript && !isEditableTranscriptKind(transcript.kind)) {
    throw new Error('Esta versión no se puede editar. Crea una versión derivada para trabajar sobre ella.');
  }
  const result = getDb()
    .prepare('UPDATE testimony_transcript_segments SET speaker_person_id = ?, updated_at = ? WHERE transcript_id = ? AND speaker_label IS ?')
    .run(personId, now(), transcriptId, speakerLabel);
  return result.changes;
}

/**
 * Escribir de una vez las etiquetas que propuso la detección de hablantes.
 *
 * Va en UNA transacción y sólo sobre los tramos de esa versión, por dos razones que no son
 * de rendimiento: una entrevista de hora y media tiene cientos de tramos, y aplicarlos de
 * uno en uno dejaría la transcripción a medio etiquetar si algo falla por el camino —
 * mitad con voces detectadas y mitad sin ellas, sin saber dónde se cortó.
 *
 * Devuelve cuántos tramos cambiaron de verdad, que es lo que la pantalla enseña. Los
 * tramos que la detección dejó en blanco NO se tocan: borrar una atribución que ya había
 * puesto una persona sería una pérdida silenciosa.
 */
export function applySpeakerLabels(
  transcriptId: string,
  entries: { segmentId: string; label: string | null }[],
): { changed: number; skipped: number } {
  const transcript = getTranscript(transcriptId);
  if (!transcript) throw new Error('Esa versión de la transcripción no existe.');
  if (!isEditableTranscriptKind(transcript.kind)) {
    throw new Error('Esta versión no se puede editar. Crea una versión derivada para trabajar sobre ella.');
  }
  const db = getDb();
  const update = db.prepare(
    'UPDATE testimony_transcript_segments SET speaker_label = ?, updated_at = ? WHERE id = ? AND transcript_id = ?'
  );
  const stamp = now();
  let changed = 0;
  let skipped = 0;
  const run = db.transaction(() => {
    for (const entry of entries) {
      if (entry.label === null) { skipped += 1; continue; }
      changed += update.run(entry.label, stamp, entry.segmentId, transcriptId).changes;
    }
  });
  run();
  return { changed, skipped };
}

/** Las etiquetas de hablante de una versión, con cuántos tramos tiene cada una. */
export function speakerLabels(transcriptId: string): { label: string | null; personId: string | null; segments: number }[] {
  return getDb()
    .prepare(
      `SELECT speaker_label AS label, speaker_person_id AS personId, COUNT(*) AS segments
         FROM testimony_transcript_segments WHERE transcript_id = ?
        GROUP BY speaker_label, speaker_person_id ORDER BY segments DESC`
    )
    .all(transcriptId) as { label: string | null; personId: string | null; segments: number }[];
}

/**
 * Reanclar los fragmentos de una entrevista contra una versión nueva.
 *
 * Se llama al derivar una versión y devuelve cuántas citas quedaron pendientes de
 * revisar. NUNCA mueve una cita en silencio: `remapAnnotation` sólo reancla cuando el
 * texto guardado sigue apareciendo cerca de su tramo original, y en cualquier otro caso
 * marca `needs_review` y lo cuenta. Una cita movida sin avisar es indistinguible de una
 * cita correcta y falsa.
 */
export function remapAnnotationsTo(fromTranscriptId: string, toTranscriptId: string): { remapped: number; needsReview: number } {
  const db = getDb();
  const segments = listSegments(toTranscriptId).map((segment) => ({
    id: segment.id,
    tStart: segment.tStart,
    tEnd: segment.tEnd,
    text: segment.text,
  }));
  const annotations = db
    .prepare('SELECT id, t_start, t_end, quote_snapshot FROM testimony_annotations WHERE transcript_id = ?')
    .all(fromTranscriptId) as { id: string; t_start: number; t_end: number; quote_snapshot: string | null }[];
  let remapped = 0;
  let needsReview = 0;
  const update = db.prepare(
    'UPDATE testimony_annotations SET transcript_id = ?, segment_id = ?, t_start = ?, t_end = ?, link_status = ?, updated_at = ? WHERE id = ?'
  );
  const ts = now();
  const tx = db.transaction(() => {
    for (const annotation of annotations) {
      const result = remapAnnotation(
        { tStart: annotation.t_start, tEnd: annotation.t_end, quoteSnapshot: annotation.quote_snapshot ?? '' },
        segments
      );
      if (result.status === 'valid') remapped += 1;
      else needsReview += 1;
      update.run(toTranscriptId, result.segmentId, result.tStart, result.tEnd, result.status, ts, annotation.id);
    }
  });
  tx();
  return { remapped, needsReview };
}
