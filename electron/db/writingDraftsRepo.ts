import { v4 as uuid } from 'uuid';
import type {
  ModelRef,
  WritingWorkshopBrief,
  WritingWorkshopDraft,
  WritingWorkshopSavedDraft,
  WritingWorkshopSaveDraftRequest,
  WritingWorkshopSelection,
} from '@shared/types';
import { getDb } from './database';
import { deleteDecorativeImageRow, getDecorativeImage } from './decorativeImagesRepo';

interface SavedWritingDraftRow {
  id: string;
  title: string;
  brief_json: string;
  selection_json: string;
  model_json: string | null;
  draft_json: string;
  created_at: string;
  updated_at: string;
  /** From the LEFT JOIN below: when this report was marked read, or null. */
  read_at?: string | null;
}

/** Every list goes through the same join, so a report can never be listed without
 *  knowing whether it has been read — which is what made the badge and the button in
 *  the gallery disagree the one time it was fetched separately. */
const SELECT_DRAFTS =
  'SELECT d.*, r.updated_at AS read_at FROM writing_saved_drafts d ' +
  'LEFT JOIN writing_draft_reads r ON r.draft_id = d.id';

function toSavedDraft(row: SavedWritingDraftRow): WritingWorkshopSavedDraft | null {
  try {
    return {
      id: row.id,
      title: row.title,
      brief: JSON.parse(row.brief_json) as WritingWorkshopBrief,
      selection: JSON.parse(row.selection_json) as WritingWorkshopSelection,
      model: row.model_json ? (JSON.parse(row.model_json) as ModelRef) : null,
      draft: JSON.parse(row.draft_json) as WritingWorkshopDraft,
      image: getDecorativeImage('deep_research', row.id),
      readAt: row.read_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch {
    // One corrupt local record must not prevent opening the rest of the workshop.
    return null;
  }
}

export function listWritingWorkshopDrafts(): WritingWorkshopSavedDraft[] {
  const rows = getDb()
    .prepare(`${SELECT_DRAFTS} ORDER BY d.updated_at DESC, d.created_at DESC`)
    .all() as SavedWritingDraftRow[];
  return rows.map(toSavedDraft).filter((draft): draft is WritingWorkshopSavedDraft => draft !== null);
}

export function saveWritingWorkshopDraft(request: WritingWorkshopSaveDraftRequest): WritingWorkshopSavedDraft {
  const now = new Date().toISOString();
  const id = uuid();
  const title = request.title?.trim() || request.draft.title.trim() || 'Borrador sin título';
  getDb()
    .prepare(
      `INSERT INTO writing_saved_drafts (
         id, title, brief_json, selection_json, model_json, draft_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      title,
      JSON.stringify(request.draft.brief),
      JSON.stringify(request.draft.selection),
      request.model ? JSON.stringify(request.model) : null,
      JSON.stringify(request.draft),
      now,
      now
    );
  const saved = getWritingWorkshopDraft(id);
  if (!saved) throw new Error('No se pudo guardar el borrador');
  return saved;
}

export function getWritingWorkshopDraft(id: string): WritingWorkshopSavedDraft | null {
  const row = getDb().prepare(`${SELECT_DRAFTS} WHERE d.id = ?`).get(id) as SavedWritingDraftRow | undefined;
  return row ? toSavedDraft(row) : null;
}

/**
 * Mark a saved report read, or take the mark back.
 *
 * Returns the report as it now stands, or null when there is no such report — the
 * gallery can have a stale id after a delete on another machine, and inserting a read
 * mark for a report that is gone would leave a row nothing ever reads.
 *
 * There is no foreign key, deliberately: `writing_saved_drafts` rows also arrive by
 * merge and by the ledger, and a constraint would decide the order those two have to
 * land in. The delete below is what keeps a mark from outliving its report.
 */
export function setWritingWorkshopDraftRead(id: string, read: boolean): WritingWorkshopSavedDraft | null {
  const db = getDb();
  const exists = db.prepare('SELECT 1 FROM writing_saved_drafts WHERE id = ?').get(id);
  if (!exists) return null;
  if (read) {
    db.prepare(
      'INSERT INTO writing_draft_reads (draft_id, updated_at) VALUES (?, ?) ' +
        'ON CONFLICT(draft_id) DO UPDATE SET updated_at = excluded.updated_at'
    ).run(id, new Date().toISOString());
  } else {
    db.prepare('DELETE FROM writing_draft_reads WHERE draft_id = ?').run(id);
  }
  return getWritingWorkshopDraft(id);
}

export function deleteWritingWorkshopDraft(id: string): boolean {
  deleteDecorativeImageRow('deep_research', id);
  // Before the report, so a mark can never be left pointing at nothing.
  getDb().prepare('DELETE FROM writing_draft_reads WHERE draft_id = ?').run(id);
  return getDb().prepare('DELETE FROM writing_saved_drafts WHERE id = ?').run(id).changes > 0;
}
