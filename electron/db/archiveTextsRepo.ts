import { v4 as uuid } from 'uuid';
import type { ArchiveTextSegment, ArchiveTextVersion } from '@shared/archiveTypes';
import type {
  PrimarySourceTextSegmentInput,
  PrimarySourceTextVersionCreateInput,
} from '@shared/primarySourcesTypes';
import { getDb } from './database';
import { recordArchiveAudit } from './archiveAuditRepo';

const now = () => new Date().toISOString();
const parseObject = <T>(value: string | null): T | null => {
  try { return value ? JSON.parse(value) as T : null; } catch { return null; }
};

type TextRow = {
  text_version_id: string; item_id: string; file_id: string | null; parent_version_id: string | null;
  kind: ArchiveTextVersion['kind']; language_code: string | null; content: string;
  status: ArchiveTextVersion['status']; engine: string | null; model: string | null; confidence: number | null;
  editorial_conventions: string | null; created_by: string | null; created_at: string;
  updated_at: string; reviewed_at: string | null;
};
const textFromRow = (row: TextRow): ArchiveTextVersion => ({
  textVersionId: row.text_version_id, itemId: row.item_id, fileId: row.file_id,
  parentVersionId: row.parent_version_id, kind: row.kind, languageCode: row.language_code,
  content: row.content, status: row.status, engine: row.engine, model: row.model,
  confidence: row.confidence, editorialConventions: row.editorial_conventions,
  createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at, reviewedAt: row.reviewed_at,
});

export function createArchiveTextVersion(
  input: Pick<ArchiveTextVersion, 'itemId' | 'kind' | 'content'> &
    Partial<Omit<ArchiveTextVersion, 'textVersionId' | 'itemId' | 'kind' | 'content' | 'createdAt' | 'updatedAt'>>
): ArchiveTextVersion {
  return createPrimarySourceTextVersion({
    ...input,
    status: input.status ?? 'automatic',
  }).version;
}

function validateTextReference(input: PrimarySourceTextVersionCreateInput): {
  fileId: string | null;
  parent: ArchiveTextVersion | null;
} {
  const db = getDb();
  const item = db.prepare('SELECT item_id FROM archive_items WHERE item_id=?').get(input.itemId) as
    | { item_id: string }
    | undefined;
  if (!item) throw new Error('La fuente ya no existe.');
  const parent = input.parentVersionId ? getArchiveTextVersion(input.parentVersionId) : null;
  if (input.parentVersionId && !parent) throw new Error('La versión de texto de origen no existe.');
  if (parent && parent.itemId !== input.itemId) {
    throw new Error('La versión de origen pertenece a otra fuente.');
  }
  const fileId = input.fileId === undefined ? parent?.fileId ?? null : input.fileId;
  if (fileId) {
    const file = db.prepare(
      'SELECT item_id FROM archive_item_files WHERE file_id=?'
    ).get(fileId) as { item_id: string } | undefined;
    if (!file || file.item_id !== input.itemId) {
      throw new Error('El archivo de referencia pertenece a otra fuente o ya no existe.');
    }
  }
  if (!input.content.trim()) throw new Error('El texto no puede estar vacío.');
  if (
    input.confidence !== undefined
    && input.confidence !== null
    && (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)
  ) {
    throw new Error('La confianza debe estar entre 0 y 1.');
  }
  return { fileId, parent };
}

function automaticSegments(
  content: string,
  fileId: string | null
): PrimarySourceTextSegmentInput[] {
  const segments: PrimarySourceTextSegmentInput[] = [];
  let start = 0;
  let sequenceNo = 0;
  for (let index = 0; index <= content.length; index += 1) {
    if (index !== content.length && content[index] !== '\f') continue;
    const segmentContent = content.slice(start, index);
    if (segmentContent.length > 0) {
      segments.push({
        fileId,
        sequenceNo,
        pageLabel: content.includes('\f') ? `${sequenceNo + 1}` : null,
        startOffset: start,
        endOffset: index,
        content: segmentContent,
        bbox: null,
        timeStartMs: null,
        timeEndMs: null,
        confidence: null,
      });
      sequenceNo += 1;
    }
    start = index + 1;
  }
  return segments;
}

function validateSegments(
  content: string,
  fileId: string | null,
  input: PrimarySourceTextSegmentInput[] | undefined
): PrimarySourceTextSegmentInput[] {
  const segments = input?.length ? input : automaticSegments(content, fileId);
  const sequences = new Set<number>();
  for (const segment of segments) {
    if (!Number.isInteger(segment.sequenceNo) || segment.sequenceNo < 0) {
      throw new Error('La secuencia del segmento no es válida.');
    }
    if (sequences.has(segment.sequenceNo)) {
      throw new Error('Cada segmento necesita una posición de secuencia distinta.');
    }
    sequences.add(segment.sequenceNo);
    const start = segment.startOffset ?? null;
    const end = segment.endOffset ?? null;
    if ((start === null) !== (end === null)) {
      throw new Error('El intervalo de texto del segmento está incompleto.');
    }
    if (
      start !== null
      && end !== null
      && (
        !Number.isInteger(start)
        || !Number.isInteger(end)
        || start < 0
        || end <= start
        || end > content.length
        || content.slice(start, end) !== segment.content
      )
    ) {
      throw new Error('El segmento no coincide con el contenido y los offsets de la versión.');
    }
    if (
      segment.timeStartMs !== undefined
      && segment.timeStartMs !== null
      && (
        !Number.isFinite(segment.timeStartMs)
        || !Number.isFinite(segment.timeEndMs)
        || segment.timeStartMs < 0
        || Number(segment.timeEndMs) <= segment.timeStartMs
      )
    ) {
      throw new Error('El intervalo temporal del segmento no es válido.');
    }
  }
  return [...segments].sort((a, b) => a.sequenceNo - b.sequenceNo);
}

export function createPrimarySourceTextVersion(
  input: PrimarySourceTextVersionCreateInput
): { version: ArchiveTextVersion; segments: ArchiveTextSegment[] } {
  const { fileId, parent } = validateTextReference(input);
  const segments = validateSegments(input.content, fileId, input.segments);
  const textVersionId = `atv_${uuid()}`;
  const ts = now();
  const db = getDb();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO archive_text_versions (
        text_version_id, item_id, file_id, parent_version_id, kind, language_code, content,
        status, engine, model, confidence, editorial_conventions, created_by, created_at,
        updated_at, reviewed_at
      ) VALUES (${Array.from({ length: 16 }, () => '?').join(',')})`
    ).run(
      textVersionId, input.itemId, fileId, input.parentVersionId ?? null,
      input.kind, input.languageCode ?? parent?.languageCode ?? null, input.content,
      input.status ?? 'in_review', input.engine ?? null, input.model ?? null,
      input.confidence ?? null, input.editorialConventions ?? null,
      input.createdBy ?? 'primary_sources_user', ts, ts, null
    );
    const insertSegment = db.prepare(
      `INSERT INTO archive_text_segments (
        segment_id, text_version_id, file_id, sequence_no, page_label, start_offset,
        end_offset, content, bbox_json, time_start_ms, time_end_ms, speaker_label,
        confidence, created_at, updated_at
      ) VALUES (${Array.from({ length: 15 }, () => '?').join(',')})`
    );
    for (const segment of segments) {
      insertSegment.run(
        `ats_${uuid()}`, textVersionId, segment.fileId ?? fileId, segment.sequenceNo,
        segment.pageLabel ?? null, segment.startOffset ?? null, segment.endOffset ?? null,
        segment.content, segment.bbox ? JSON.stringify(segment.bbox) : null,
        segment.timeStartMs ?? null, segment.timeEndMs ?? null, segment.speakerLabel ?? null,
        segment.confidence ?? null,
        ts, ts
      );
    }
    // The preferred source-faithful text is part of the archive embedding input.
    // Mark the old vector stale transactionally; the background/manual indexer will
    // rebuild it under the vault's access and external-processing policy.
    db.prepare(
      `UPDATE archive_items
          SET embedding=NULL, embedding_model=NULL, embedding_dim=NULL,
              embedding_text_hash=NULL, updated_at=?
        WHERE item_id=?`
    ).run(ts, input.itemId);
    recordArchiveAudit({
      itemId: input.itemId,
      fileId,
      action: 'text_version_created',
      createdBy: input.createdBy ?? 'primary_sources_user',
      details: {
        textVersionId,
        parentVersionId: input.parentVersionId ?? null,
        kind: input.kind,
        status: input.status ?? 'in_review',
        languageCode: input.languageCode ?? parent?.languageCode ?? null,
        segmentCount: segments.length,
        characterCount: input.content.length,
        parentPreserved: Boolean(parent),
      },
    });
  })();
  return {
    version: getArchiveTextVersion(textVersionId)!,
    segments: listArchiveTextSegments(textVersionId),
  };
}

export function getArchiveTextVersion(textVersionId: string): ArchiveTextVersion | null {
  const row = getDb().prepare('SELECT * FROM archive_text_versions WHERE text_version_id=?').get(textVersionId) as TextRow | undefined;
  return row ? textFromRow(row) : null;
}

export function listArchiveTextVersions(itemId: string): ArchiveTextVersion[] {
  return (getDb().prepare(
    'SELECT * FROM archive_text_versions WHERE item_id=? ORDER BY kind, created_at DESC'
  ).all(itemId) as TextRow[]).map(textFromRow);
}

export function setArchiveTextReviewStatus(
  textVersionId: string,
  status: ArchiveTextVersion['status']
): ArchiveTextVersion | null {
  const current = getArchiveTextVersion(textVersionId);
  if (!current) return null;
  const ts = now();
  getDb().prepare(
    'UPDATE archive_text_versions SET status=?, reviewed_at=?, updated_at=? WHERE text_version_id=?'
  ).run(status, status === 'reviewed' || status === 'closed' ? ts : null, ts, textVersionId);
  getDb().prepare(
    `UPDATE archive_items
        SET embedding=NULL, embedding_model=NULL, embedding_dim=NULL,
            embedding_text_hash=NULL, updated_at=?
      WHERE item_id=?`
  ).run(ts, current.itemId);
  recordArchiveAudit({
    itemId: current.itemId,
    fileId: current.fileId,
    action: 'text_review_status_changed',
    createdBy: 'primary_sources_user',
    details: { textVersionId, from: current.status, to: status },
  });
  return getArchiveTextVersion(textVersionId);
}

type SegmentRow = {
  segment_id: string; text_version_id: string; file_id: string | null; sequence_no: number;
  page_label: string | null; start_offset: number | null; end_offset: number | null; content: string;
  bbox_json: string | null; time_start_ms: number | null; time_end_ms: number | null;
  speaker_label: string | null; confidence: number | null; created_at: string; updated_at: string;
};
const segmentFromRow = (row: SegmentRow): ArchiveTextSegment => ({
  segmentId: row.segment_id, textVersionId: row.text_version_id, fileId: row.file_id,
  sequenceNo: row.sequence_no, pageLabel: row.page_label, startOffset: row.start_offset,
  endOffset: row.end_offset, content: row.content, bbox: parseObject(row.bbox_json),
  timeStartMs: row.time_start_ms, timeEndMs: row.time_end_ms, speakerLabel: row.speaker_label,
  confidence: row.confidence,
  createdAt: row.created_at, updatedAt: row.updated_at,
});

export function replaceArchiveTextSegments(
  textVersionId: string,
  segments: Array<Omit<ArchiveTextSegment, 'segmentId' | 'textVersionId' | 'createdAt' | 'updatedAt'>>
): ArchiveTextSegment[] {
  const db = getDb();
  const ts = now();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM archive_text_segments WHERE text_version_id=?').run(textVersionId);
    const insert = db.prepare(
      `INSERT INTO archive_text_segments (
        segment_id, text_version_id, file_id, sequence_no, page_label, start_offset,
        end_offset, content, bbox_json, time_start_ms, time_end_ms, speaker_label,
        confidence, created_at, updated_at
      ) VALUES (${Array.from({ length: 15 }, () => '?').join(',')})`
    );
    for (const segment of segments) {
      insert.run(
        `ats_${uuid()}`, textVersionId, segment.fileId, segment.sequenceNo, segment.pageLabel,
        segment.startOffset, segment.endOffset, segment.content,
        segment.bbox ? JSON.stringify(segment.bbox) : null, segment.timeStartMs,
        segment.timeEndMs, segment.speakerLabel, segment.confidence, ts, ts
      );
    }
  });
  tx();
  return listArchiveTextSegments(textVersionId);
}

export function listArchiveTextSegments(textVersionId: string): ArchiveTextSegment[] {
  return (getDb().prepare(
    'SELECT * FROM archive_text_segments WHERE text_version_id=? ORDER BY sequence_no'
  ).all(textVersionId) as SegmentRow[]).map(segmentFromRow);
}

export function listArchiveTextSegmentsForItem(itemId: string): ArchiveTextSegment[] {
  return (getDb().prepare(
    `SELECT s.*
     FROM archive_text_segments s
     JOIN archive_text_versions v ON v.text_version_id=s.text_version_id
     WHERE v.item_id=?
     ORDER BY v.created_at, s.sequence_no`
  ).all(itemId) as SegmentRow[]).map(segmentFromRow);
}
