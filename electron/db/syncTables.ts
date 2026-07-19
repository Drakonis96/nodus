import type Database from 'better-sqlite3';
import type { SyncGroupKey } from '@shared/types';
import { getDb } from './database';
import { identityColumns, tableColumns } from './rowIdentity';

/**
 * Which tables travel between machines, and which deliberately do not.
 *
 * Lives apart from the sync package itself because the deletion tombstones generate
 * their triggers from this same list. Two lists would drift, and a table that syncs but
 * whose deletions do not propagate resurrects itself forever.
 */

/**
 * What travels, by group. Prefix groups pick up new tables automatically — the reason
 * study data never developed the coverage gaps the hand-written groups did.
 *
 * Everything absent from here is either derived from the Zotero corpus and rebuilt on
 * the destination, or machine-local. `describeSyncCoverage()` reports the omissions to
 * the user rather than leaving them to be discovered as missing data.
 */
const SYNC_GROUPS: { key: SyncGroupKey; prefix?: string; tables?: string[] }[] = [
  // Deletions travel as their own records, and are applied before any row is merged so
  // a tombstone can stop a resurrection rather than undo it afterwards.
  { key: 'tombstones', tables: ['sync_tombstones'] },
  { key: 'notes', tables: ['note_folders', 'notes'] },
  {
    key: 'writing',
    tables: [
      'writing_saved_drafts',
      'projects',
      'project_sections',
      'project_chapters',
      'project_chapter_versions',
      'project_chapter_chunks',
      'project_chapter_ideas',
      'project_chapter_idea_relations',
      'project_links',
      'project_insertion_suggestions',
    ],
  },
  { key: 'searches', tables: ['saved_searches'] },
  { key: 'edgeFeedback', tables: ['edge_feedback'] },
  { key: 'curation', tables: ['match_feedback'] },
  { key: 'databases', prefix: 'db_' },
  { key: 'study', prefix: 'study_' },
  { key: 'teaching', prefix: 'teaching_' },
  {
    key: 'genealogy',
    tables: [
      'persons',
      'person_names',
      'person_places',
      'person_portraits',
      'places',
      'events',
      'event_participants',
      'relationships',
      'evidence',
      'record_evidence',
      'archive_folders',
      'archive_items',
      'archive_item_folders',
      'archive_item_persons',
      'archive_item_tags',
      'kinship_suggestions',
      'kinship_suggestion_evidence',
      'social_contacts',
      'social_relations',
    ],
  },
  {
    key: 'research',
    tables: [
      'research_questions',
      'research_subquestions',
      'research_coverage_links',
      'synthesis_matrix_cell',
      'tutor_saved_routes',
      'immersion_sessions',
    ],
  },
  { key: 'chats', tables: ['chat_conversations', 'chat_messages', 'database_chat_conversations'] },
  { key: 'content', tables: ['content_translations', 'decorative_images', 'audio_clips'] },
];

/**
 * Corpus-derived or machine-local tables, listed explicitly so `describeSyncCoverage`
 * can tell the user what a package does NOT carry. Anything in neither list is reported
 * as unclassified, which is how a future migration announces itself instead of being
 * quietly dropped.
 */
const NOT_SYNCED_TABLES = new Set([
  'works', 'work_aliases', 'work_authors', 'work_collections', 'work_idea_synthesis', 'work_summaries',
  'work_themes', 'work_zotero_tags', 'authors', 'author_relations', 'author_dossier_synthesis',
  'ideas', 'idea_occurrences', 'idea_theme_links', 'themes', 'edges', 'edge_traces', 'gaps',
  'passages', 'collections', 'zotero_tags', 'external_refs', 'extraction_cache', 'scan_checkpoints',
  'sync_log', 'settings',
  // Deliberately machine-local: it is THIS computer's record of what its own merges
  // discarded. Shipping it would let one machine's audit trail overwrite the other's,
  // and restoring an entry there would write a row that never lost anything here.
  'sync_superseded',
]);

export function localTableNames(db: Database.Database = getDb()): Set<string> {
  return new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
      .map((row) => row.name)
      .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
  );
}

/** The tables this build syncs, in group order, restricted to what actually exists. */
export function syncedTablesByGroup(db: Database.Database = getDb()): { key: SyncGroupKey; tables: string[] }[] {
  const present = localTableNames(db);
  return SYNC_GROUPS.map((group) => ({
    key: group.key,
    tables: [...present]
      .filter((name) => (group.prefix ? name.startsWith(group.prefix) : group.tables?.includes(name) ?? false))
      .sort(),
  }));
}

export function syncedTableNames(db: Database.Database = getDb()): string[] {
  return syncedTablesByGroup(db).flatMap((group) => group.tables);
}

export function groupOfTable(): Map<string, SyncGroupKey> {
  const map = new Map<string, SyncGroupKey>();
  for (const group of syncedTablesByGroup()) {
    for (const table of group.tables) map.set(table, group.key);
  }
  return map;
}

/**
 * What a package carries and what it deliberately leaves behind, for the UI. Users were
 * previously given a success count with no way to tell that whole modules had not
 * travelled at all.
 */
export function describeSyncCoverage(): {
  included: Record<string, string[]>;
  excluded: string[];
  unclassified: string[];
  unmergeable: string[];
} {
  const included: Record<string, string[]> = {};
  for (const group of syncedTablesByGroup()) {
    if (group.tables.length > 0) included[group.key] = group.tables;
  }
  const covered = [...new Set(Object.values(included).flat())];
  const present = [...localTableNames()].sort();
  return {
    included,
    excluded: present.filter((name) => !covered.includes(name) && NOT_SYNCED_TABLES.has(name)),
    unclassified: present.filter((name) => !covered.includes(name) && !NOT_SYNCED_TABLES.has(name)),
    // Synced tables whose rows cannot be matched at all. Must stay empty: a table here
    // would travel on a first sync and then conflict forever after.
    unmergeable: covered.filter((name) => identityColumns(name, tableColumns(name)).length === 0).sort(),
  };
}
