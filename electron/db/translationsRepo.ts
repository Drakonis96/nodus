import { v4 as uuid } from 'uuid';
import type {
  ContentTranslation,
  ContentTranslationSummary,
  ModelRef,
  TranslationEntityKind,
} from '@shared/types';
import { getDb } from './database';

// Persistence for AI translations of reports/immersions. One row per
// (entity_kind, entity_id, language): regenerating a language upserts, so a report
// never accumulates duplicate translations for the same language.

interface TranslationRow {
  id: string;
  entity_kind: TranslationEntityKind;
  entity_id: string;
  language: string;
  language_label: string;
  title: string;
  markdown: string;
  model_json: string | null;
  created_at: string;
  updated_at: string;
}

function parseModel(json: string | null): ModelRef | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as ModelRef;
  } catch {
    return null;
  }
}

function toSummary(row: Omit<TranslationRow, 'markdown'>): ContentTranslationSummary {
  return {
    id: row.id,
    entityKind: row.entity_kind,
    entityId: row.entity_id,
    language: row.language,
    languageLabel: row.language_label,
    title: row.title,
    model: parseModel(row.model_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toFull(row: TranslationRow): ContentTranslation {
  return { ...toSummary(row), markdown: row.markdown };
}

const SUMMARY_COLS =
  'id, entity_kind, entity_id, language, language_label, title, model_json, created_at, updated_at';

export function listContentTranslations(
  entityKind: TranslationEntityKind,
  entityId: string
): ContentTranslationSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT ${SUMMARY_COLS} FROM content_translations
        WHERE entity_kind = ? AND entity_id = ?
        ORDER BY updated_at DESC`
    )
    .all(entityKind, entityId) as Omit<TranslationRow, 'markdown'>[];
  return rows.map(toSummary);
}

export function getContentTranslation(id: string): ContentTranslation | null {
  const row = getDb()
    .prepare('SELECT * FROM content_translations WHERE id = ?')
    .get(id) as TranslationRow | undefined;
  return row ? toFull(row) : null;
}

/** Insert or replace the translation for one (entity, language) pair. */
export function upsertContentTranslation(input: {
  entityKind: TranslationEntityKind;
  entityId: string;
  language: string;
  languageLabel: string;
  title: string;
  markdown: string;
  model: ModelRef | null;
}): ContentTranslationSummary {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db
    .prepare(
      'SELECT id, created_at FROM content_translations WHERE entity_kind = ? AND entity_id = ? AND language = ?'
    )
    .get(input.entityKind, input.entityId, input.language) as
    | { id: string; created_at: string }
    | undefined;
  const id = existing?.id ?? uuid();
  const createdAt = existing?.created_at ?? now;
  db.prepare(
    `INSERT INTO content_translations (
       id, entity_kind, entity_id, language, language_label, title, markdown, model_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(entity_kind, entity_id, language) DO UPDATE SET
       language_label = excluded.language_label,
       title = excluded.title,
       markdown = excluded.markdown,
       model_json = excluded.model_json,
       updated_at = excluded.updated_at`
  ).run(
    id,
    input.entityKind,
    input.entityId,
    input.language,
    input.languageLabel,
    input.title,
    input.markdown,
    input.model ? JSON.stringify(input.model) : null,
    createdAt,
    now
  );
  const saved = getContentTranslation(id);
  if (!saved) throw new Error('No se pudo guardar la traducción');
  const { markdown: _markdown, ...summary } = saved;
  return summary;
}

export function deleteContentTranslation(id: string): boolean {
  return getDb().prepare('DELETE FROM content_translations WHERE id = ?').run(id).changes > 0;
}

/** Remove every translation for an entity — called when the entity itself is deleted. */
export function deleteEntityTranslations(entityKind: TranslationEntityKind, entityId: string): void {
  getDb()
    .prepare('DELETE FROM content_translations WHERE entity_kind = ? AND entity_id = ?')
    .run(entityKind, entityId);
}
