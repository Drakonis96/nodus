import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AppSettings, VaultSummary } from '@shared/types';
import { getDb } from '../db/database';

export const SERVER_SNAPSHOT_FORMAT = 'nodus.server-snapshot';
export const SERVER_SNAPSHOT_VERSION = 1;

const CORE_TABLES = [
  'works', 'work_aliases', 'authors', 'work_authors', 'collections', 'work_collections',
  'zotero_tags', 'work_zotero_tags', 'themes', 'work_themes', 'ideas', 'idea_occurrences',
  'idea_theme_links', 'evidence', 'edges', 'gaps', 'external_refs', 'work_summaries',
  'author_relations', 'author_dossier_synthesis', 'synthesis_matrix_cell', 'work_idea_synthesis',
  'research_questions', 'research_subquestions', 'research_coverage_links', 'tutor_saved_routes',
] as const;

const USER_TABLES = [
  'note_folders', 'notes', 'writing_saved_drafts', 'projects', 'project_sections',
  'project_chapters', 'project_chapter_versions', 'project_chapter_chunks',
  'project_chapter_ideas', 'project_chapter_idea_relations', 'project_links',
  'project_insertion_suggestions', 'saved_searches', 'immersion_sessions',
] as const;

// Shareable teaching materials only. Student rosters, groups, grades, grading
// runs and assessment results are deliberately absent even when the user opts
// into sharing authored content: those records are not teaching materials.
const TEACHING_TABLES = [
  'teaching_exams', 'teaching_exam_questions', 'teaching_rubrics', 'teaching_logos',
] as const;

const OMIT_COLUMNS = new Set([
  'embedding', 'embedding_model', 'embedding_provider', 'blob', 'thumb', 'audio_blob',
  'file_path', 'source_path', 'storage_path', 'local_path', 'absolute_path',
  'api_key', 'access_token', 'refresh_token', 'password', 'secret', 'credentials',
]);

function tableNames(db: Database.Database): Set<string> {
  return new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((row) => row.name));
}

function safeValue(column: string, value: unknown): unknown {
  const normalized = column.toLowerCase();
  if (
    OMIT_COLUMNS.has(normalized) ||
    normalized.endsWith('_path') ||
    /(^|_)(api_key|access_token|refresh_token|password|secret|credential)(_|$)/.test(normalized) ||
    Buffer.isBuffer(value)
  ) return undefined;
  if (typeof value === 'bigint') return Number(value);
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  return undefined;
}

function readTable(db: Database.Database, table: string): Record<string, unknown>[] {
  return (db.prepare(`SELECT * FROM "${table.replace(/"/g, '""')}"`).all() as Record<string, unknown>[]).map((row) =>
    Object.fromEntries(Object.entries(row).flatMap(([column, value]) => {
      const safe = safeValue(column, value);
      return safe === undefined ? [] : [[column, safe]];
    }))
  );
}

export function lightweightVaultRevision(db: Database.Database = getDb()): string {
  const changes = db.prepare('SELECT total_changes() AS value').get() as { value: number };
  const dataVersion = db.pragma('data_version', { simple: true }) as number;
  const schemaVersion = db.pragma('user_version', { simple: true }) as number;
  return `${changes.value}:${dataVersion}:${schemaVersion}`;
}

export function buildServerSnapshot(
  vault: VaultSummary,
  settings: Pick<AppSettings, 'nodusServerIncludeUserContent' | 'nodusServerIncludePassages'>,
  db: Database.Database = getDb(),
): { buffer: Buffer; revision: string; counts: Record<string, number> } {
  const present = tableNames(db);
  const selected = new Set<string>(CORE_TABLES.filter((table) => present.has(table)));
  if (settings.nodusServerIncludePassages && present.has('passages')) selected.add('passages');
  if (settings.nodusServerIncludeUserContent) {
    USER_TABLES.filter((table) => present.has(table)).forEach((table) => selected.add(table));
    for (const table of present) {
      if (table.startsWith('study_')) selected.add(table);
    }
    TEACHING_TABLES.filter((table) => present.has(table)).forEach((table) => selected.add(table));
  }

  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of [...selected].sort()) tables[table] = readTable(db, table);
  const generatedAt = new Date().toISOString();
  const payload = {
    format: SERVER_SNAPSHOT_FORMAT,
    formatVersion: SERVER_SNAPSHOT_VERSION,
    generatedAt,
    vault: { id: vault.id, name: vault.name, type: vault.type },
    tables,
  };
  const raw = Buffer.from(JSON.stringify(payload));
  // generatedAt describes this upload, not its contents. Keeping it outside the
  // digest lets the server recognize an unchanged projection after app restarts.
  const revision = createHash('sha256').update(JSON.stringify({ vault: payload.vault, tables })).digest('base64url');
  return { buffer: raw, revision, counts: Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length])) };
}
