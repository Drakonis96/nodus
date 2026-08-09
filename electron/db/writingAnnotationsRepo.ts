import { v4 as uuid } from 'uuid';
import type {
  WritingDraftAnnotation,
  WritingDraftAnnotationColor,
  WritingDraftAnnotationInput,
} from '@shared/types';
import { getDb } from './database';

interface WritingDraftAnnotationRow {
  id: string;
  draft_id: string;
  scope: string;
  kind: string;
  color: string | null;
  start_offset: number;
  end_offset: number;
  selected_text: string;
  prefix: string;
  suffix: string;
  comment_text: string | null;
  created_at: string;
  updated_at: string;
}

const COLORS = new Set<WritingDraftAnnotationColor>(['yellow', 'rose', 'blue', 'mint', 'lavender', 'peach']);

function toAnnotation(row: WritingDraftAnnotationRow): WritingDraftAnnotation | null {
  if (row.kind !== 'highlight' && row.kind !== 'comment') return null;
  if (row.color !== null && !COLORS.has(row.color as WritingDraftAnnotationColor)) return null;
  if (!Number.isInteger(row.start_offset) || !Number.isInteger(row.end_offset) || row.end_offset <= row.start_offset) return null;
  return {
    id: row.id,
    draftId: row.draft_id,
    scope: row.scope,
    kind: row.kind,
    color: row.color as WritingDraftAnnotationColor | null,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    selectedText: row.selected_text,
    prefix: row.prefix,
    suffix: row.suffix,
    comment: row.comment_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizedInput(input: WritingDraftAnnotationInput) {
  const scope = input.scope.trim() || 'source';
  const selectedText = input.selectedText;
  const startOffset = Math.trunc(input.startOffset);
  const endOffset = Math.trunc(input.endOffset);
  if (scope.length > 180) throw new Error('El contexto de la anotación no es válido.');
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset) || startOffset < 0 || endOffset <= startOffset) {
    throw new Error('El fragmento seleccionado no es válido.');
  }
  if (!selectedText.trim() || selectedText.length !== endOffset - startOffset) {
    throw new Error('El texto seleccionado no coincide con su posición.');
  }
  if (input.kind === 'highlight') {
    if (!input.color || !COLORS.has(input.color)) throw new Error('El color del subrayado no es válido.');
    return {
      scope,
      kind: input.kind,
      color: input.color,
      startOffset,
      endOffset,
      selectedText,
      prefix: (input.prefix ?? '').slice(-64),
      suffix: (input.suffix ?? '').slice(0, 64),
      comment: null,
    } as const;
  }
  const comment = input.comment?.trim() ?? '';
  if (!comment) throw new Error('Escribe el comentario antes de guardarlo.');
  return {
    scope,
    kind: input.kind,
    color: null,
    startOffset,
    endOffset,
    selectedText,
    prefix: (input.prefix ?? '').slice(-64),
    suffix: (input.suffix ?? '').slice(0, 64),
    comment,
  } as const;
}

export function listWritingDraftAnnotations(draftId: string): WritingDraftAnnotation[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM writing_draft_annotations
       WHERE draft_id = ?
       ORDER BY scope, start_offset, created_at`
    )
    .all(draftId) as WritingDraftAnnotationRow[];
  return rows.map(toAnnotation).filter((item): item is WritingDraftAnnotation => item !== null);
}

export function createWritingDraftAnnotation(input: WritingDraftAnnotationInput): WritingDraftAnnotation {
  const db = getDb();
  const report = db.prepare('SELECT 1 FROM writing_saved_drafts WHERE id = ?').get(input.draftId);
  if (!report) throw new Error('El informe ya no existe.');
  const value = normalizedInput(input);
  const id = uuid();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO writing_draft_annotations (
       id, draft_id, scope, kind, color, start_offset, end_offset, selected_text,
       prefix, suffix, comment_text, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.draftId,
    value.scope,
    value.kind,
    value.color,
    value.startOffset,
    value.endOffset,
    value.selectedText,
    value.prefix,
    value.suffix,
    value.comment,
    now,
    now,
  );
  const row = db.prepare('SELECT * FROM writing_draft_annotations WHERE id = ?').get(id) as WritingDraftAnnotationRow;
  const annotation = toAnnotation(row);
  if (!annotation) throw new Error('No se pudo guardar la anotación.');
  return annotation;
}

export function updateWritingDraftComment(id: string, comment: string): WritingDraftAnnotation | null {
  const value = comment.trim();
  if (!value) throw new Error('Escribe el comentario antes de guardarlo.');
  const db = getDb();
  const changed = db.prepare(
    `UPDATE writing_draft_annotations
     SET comment_text = ?, updated_at = ?
     WHERE id = ? AND kind = 'comment'`
  ).run(value, new Date().toISOString(), id);
  if (changed.changes === 0) return null;
  const row = db.prepare('SELECT * FROM writing_draft_annotations WHERE id = ?').get(id) as WritingDraftAnnotationRow;
  return toAnnotation(row);
}

export function deleteWritingDraftAnnotation(id: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT draft_id FROM writing_draft_annotations WHERE id = ?').get(id) as { draft_id: string } | undefined;
  if (!row) return null;
  db.prepare('DELETE FROM writing_draft_annotations WHERE id = ?').run(id);
  return row.draft_id;
}

export function deleteAnnotationsForWritingDraft(draftId: string): number {
  return getDb().prepare('DELETE FROM writing_draft_annotations WHERE draft_id = ?').run(draftId).changes;
}
