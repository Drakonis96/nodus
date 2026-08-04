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
  // `testimony_note_links` viaja con las notas y no con lo que enlaza: la tabla esta hecha para
  // tolerar un destino ausente (la nota conserva su texto y muestra el enlace roto), asi
  // que un enlace que llega a una maquina sin la entrevista de destino degrada bien. Lo
  // contrario -- una nota que llega sin sus enlaces -- perderia trabajo del investigador
  // en silencio.
  { key: 'notes', tables: ['note_folders', 'notes', 'note_links', 'testimony_note_links'] },
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
  { key: 'protect', tables: ['protect_copies'] },
  { key: 'study', prefix: 'study_' },
  { key: 'teaching', prefix: 'teaching_' },
  { key: 'prosopography', prefix: 'prosop_' },
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
      // Primary Sources is an additive archival layer over archive_items. Every table
      // below contains user-authored description, evidence, preservation history or
      // review decisions and therefore travels with the compatible legacy record.
      'archive_repositories',
      'archive_description_units',
      'archive_item_units',
      'archive_capture_sessions',
      'archive_item_profiles',
      'archive_item_files',
      'archive_text_versions',
      'archive_text_segments',
      'archive_excerpts',
      'archive_entity_proposals',
      'archive_proposal_decisions',
      'archive_source_analyses',
      'archive_place_mentions',
      'archive_place_resolution_decisions',
      'archive_person_mentions',
      'entity_resolutions',
      'note_links',
      'testimony_note_links',
      'primary_source_note_profiles',
      'primary_source_note_link_snapshots',
      'primary_source_policies',
      'primary_source_citation_settings',
      'primary_source_operation_runs',
      'primary_source_export_manifests',
      'primary_source_restore_reports',
      'archive_integrity_checks',
      'archive_exports',
      'archive_description_templates',
      'archive_audit_log',
      'kinship_suggestions',
      'kinship_suggestion_evidence',
      'social_contacts',
      'social_relations',
    ],
  },
  // A worldbuilding character's own layer. The person row it hangs off travels in the
  // group above (both vault types share that ontology); these two are the fiction-only
  // half, and they are authored by hand and irreplaceable, so they must travel too.
  {
    key: 'worldbuilding',
    tables: [
      'character_profiles',
      'event_world_dates',
      'character_abilities',
      // v94: one gallery table for every world entity, replacing character_images.
      'world_images',
      'world_groups',
      'character_affiliations',
      'place_profiles',
      'world_secrets',
      'secret_knowers',
      'world_scenes',
      'scene_characters',
      // The world's calendar. Its `world_day` values are derived, but they travel with the
      // eras and months that produced them, so a merged package stays self-consistent.
      // Maps. The image blobs travel with them: a map without its picture is an empty
      // frame full of correctly-placed pins, which is worse than no map at all.
      'world_maps',
      'map_images',
      'map_layers',
      'map_markers',
      'map_travel_modes',
      'world_calendar',
      'world_calendar_eras',
      'world_calendar_months',
      // The encyclopedia. `world_links` is derived from the bodies, but it travels anyway:
      // there is no cheap way to recompute it on arrival for the five entry kinds that
      // have no body column, so mergeSyncPackage reconciles it with rebuildWorldLinks()
      // once the bodies it describes have been merged.
      'world_articles',
      'world_links',
      'world_entry_proposals',
      // Analizar (v99). `world_beats` is irreplaceable authorship, not a derivative: the
      // mention comes from `world_links`, but "the law breaks here and nobody pays" is
      // something only the writer can say. The keys of `world_beats`, `thread_parties`
      // and `world_notice_mutes` are content-derived precisely so that rewriting them
      // leaves no tombstone on every save.
      'world_scene_days',
      'world_threads',
      'thread_parties',
      'world_beats',
      'world_rules',
      'world_questions',
      'world_question_options',
      'world_notice_mutes',
      // El manuscrito (v100). La prosa es autoria irreemplazable; el recuento de palabras
      // viaja con ella porque se deriva de un texto que la lista no lee, y el diario de
      // palabras es historia, no cache.
      'world_scene_text',
      'world_chapter_breaks',
      'world_word_days',
      // v101: los libros son marcas como los capitulos, y las instantaneas son autoria
      // que el autor ya ha perdido una vez si viaja sin ellas.
      'world_manuscript_starts',
      'world_scene_snapshots',
      // v102: conversation history and its explicit focus are author working context,
      // not a regenerable model cache.
      'world_chat_conversations',
      // v103: character roleplay chats and their generated binary attachments. Images
      // follow messages so an imported package never presents an attachment without its
      // answer, even though deletion remains explicit rather than FK-driven.
      'character_chat_conversations',
      'character_chat_messages',
      'character_chat_images',
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
  // Explicitly local, opt-in and content-free beta performance observations.
  'primary_source_local_metrics',
  // Deliberately machine-local: it is THIS computer's record of what its own merges
  // discarded. Shipping it would let one machine's audit trail overwrite the other's,
  // and restoring an entry there would write a row that never lost anything here.
  'sync_superseded',
  // Same reasoning: THIS machine's queue of changes still owed to a Nodus Server space.
  // Carrying it in a .nodussync package would make the receiving machine re-send work it
  // never did, and the sender would then see its own edits arrive back as someone else's.
  'server_outbox',
  // Y su reverso: THIS machine's record of what arrived from another device and what
  // was done with it. An entry belongs to the vault it landed in, on the computer that
  // applied it — carrying it would tell a second machine it had received work it never
  // received, and its read/unread state is one person's, on one screen.
  'server_inbox',
  // TESTIMONIOS NO SE SINCRONIZA, y es una decision, no una omision (decision 18 del
  // plan). Antes de activarlo hay que demostrar que TODAS estas tablas viajan, que los
  // blobs de los maestros tienen una politica explicita, y sobre todo que las
  // restricciones y el acuerdo viajan DE FORMA ATOMICA con su entrevista. Una entrevista
  // que llegue a otra maquina sin su acuerdo llega como material sin condiciones de
  // acceso, que es exactamente la exposicion que este vault existe para evitar. Hasta
  // entonces se presenta como local y respaldable, y `describeSyncCoverage` lo dice.
  'testimony_segment_embeddings',
  'testimony_interviews',
  'testimony_participant_profiles',
  'testimony_interview_participants',
  'testimony_sessions',
  'testimony_media',
  'testimony_transcripts',
  'testimony_transcript_segments',
  'testimony_codes',
  'testimony_annotations',
  'testimony_annotation_codes',
  'testimony_agreements',
  'testimony_contrasts',
  'testimony_contrast_items',
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
