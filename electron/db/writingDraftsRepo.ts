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

interface SavedWritingDraftRow {
  id: string;
  title: string;
  brief_json: string;
  selection_json: string;
  model_json: string | null;
  draft_json: string;
  created_at: string;
  updated_at: string;
}

function toSavedDraft(row: SavedWritingDraftRow): WritingWorkshopSavedDraft | null {
  try {
    return {
      id: row.id,
      title: row.title,
      brief: JSON.parse(row.brief_json) as WritingWorkshopBrief,
      selection: JSON.parse(row.selection_json) as WritingWorkshopSelection,
      model: row.model_json ? (JSON.parse(row.model_json) as ModelRef) : null,
      draft: JSON.parse(row.draft_json) as WritingWorkshopDraft,
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
    .prepare('SELECT * FROM writing_saved_drafts ORDER BY updated_at DESC, created_at DESC')
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
  const row = getDb().prepare('SELECT * FROM writing_saved_drafts WHERE id = ?').get(id) as SavedWritingDraftRow | undefined;
  return row ? toSavedDraft(row) : null;
}

export function deleteWritingWorkshopDraft(id: string): boolean {
  return getDb().prepare('DELETE FROM writing_saved_drafts WHERE id = ?').run(id).changes > 0;
}
