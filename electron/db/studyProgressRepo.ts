import type { StudyProgressKind, StudyProgressRecord, StudyProgressStatus } from '@shared/types';
import { getDb } from './database';

const VALID_KINDS = new Set<StudyProgressKind>(['author', 'work', 'idea', 'theme']);
const VALID_STATUSES = new Set<StudyProgressStatus>(['pending', 'in_progress', 'understood', 'needs_full_read', 'review']);

function assertKind(value: StudyProgressKind): void {
  if (!VALID_KINDS.has(value)) throw new Error('Tipo de progreso de estudio no valido');
}

function assertStatus(value: StudyProgressStatus): void {
  if (!VALID_STATUSES.has(value)) throw new Error('Estado de estudio no valido');
}

function toRecord(row: {
  target_kind: string;
  target_id: string;
  status: string;
  note: string | null;
  updated_at: string;
}): StudyProgressRecord {
  return {
    targetKind: row.target_kind as StudyProgressKind,
    targetId: row.target_id,
    status: row.status as StudyProgressStatus,
    note: row.note,
    updatedAt: row.updated_at,
  };
}

export function listStudyProgress(): StudyProgressRecord[] {
  const rows = getDb()
    .prepare('SELECT target_kind, target_id, status, note, updated_at FROM study_progress ORDER BY updated_at DESC')
    .all() as {
    target_kind: string;
    target_id: string;
    status: string;
    note: string | null;
    updated_at: string;
  }[];
  return rows.map(toRecord);
}

export function studyProgressMap(): Map<string, StudyProgressRecord> {
  return new Map(listStudyProgress().map((record) => [`${record.targetKind}:${record.targetId}`, record] as const));
}

export function getStudyProgress(kind: StudyProgressKind, id: string): StudyProgressRecord | null {
  assertKind(kind);
  const row = getDb()
    .prepare('SELECT target_kind, target_id, status, note, updated_at FROM study_progress WHERE target_kind = ? AND target_id = ?')
    .get(kind, id) as
    | {
        target_kind: string;
        target_id: string;
        status: string;
        note: string | null;
        updated_at: string;
      }
    | undefined;
  return row ? toRecord(row) : null;
}

export function setStudyProgress(input: {
  targetKind: StudyProgressKind;
  targetId: string;
  status: StudyProgressStatus;
  note?: string | null;
}): StudyProgressRecord {
  assertKind(input.targetKind);
  assertStatus(input.status);
  const targetId = input.targetId.trim();
  if (!targetId) throw new Error('Falta el identificador del progreso de estudio');
  const note = input.note?.trim() || null;
  const updatedAt = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO study_progress (target_kind, target_id, status, note, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(target_kind, target_id) DO UPDATE SET
         status = excluded.status,
         note = excluded.note,
         updated_at = excluded.updated_at`
    )
    .run(input.targetKind, targetId, input.status, note, updatedAt);
  return {
    targetKind: input.targetKind,
    targetId,
    status: input.status,
    note,
    updatedAt,
  };
}
