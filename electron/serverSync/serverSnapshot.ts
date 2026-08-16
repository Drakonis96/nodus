import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AppSettings, VaultSummary } from '@shared/types';
import { getDb } from '../db/database';
import type { PublishedLibraryManifest } from './serverLibrary';

export const SERVER_SNAPSHOT_FORMAT = 'nodus.server-snapshot';
export const SERVER_SNAPSHOT_VERSION = 2;

const CORE_TABLES = [
  'works', 'work_aliases', 'authors', 'work_authors', 'collections', 'work_collections',
  'zotero_tags', 'work_zotero_tags', 'themes', 'work_themes', 'ideas', 'idea_occurrences',
  'idea_theme_links', 'evidence', 'edges', 'edge_feedback', 'gaps', 'external_refs', 'work_summaries',
  'author_relations', 'author_dossier_synthesis', 'synthesis_matrix_cell', 'work_idea_synthesis',
  'research_questions', 'research_subquestions', 'research_coverage_links', 'tutor_saved_routes',
] as const;

// `edge_feedback` is core rather than user content on purpose. Every reader of the graph
// goes through the `visible_edges` view, which hides a pair the user has vetoed in BOTH
// directions. Without those rows the server would serve debates the owner already
// dismissed from their own screen, and no amount of care elsewhere could make the two
// agree. The rows carry no prose beyond an optional note.

const USER_TABLES = [
  'note_folders', 'notes', 'note_versions', 'note_annotations', 'workspace_library_links',
  'writing_saved_drafts', 'writing_draft_annotations', 'projects', 'project_sections',
  'project_chapters', 'project_chapter_versions', 'project_chapter_chunks',
  'project_chapter_ideas', 'project_chapter_idea_relations', 'project_links',
  'project_insertion_suggestions', 'saved_searches', 'immersion_sessions',
  'decorative_images', 'content_translations',
] as const;

// Shareable teaching materials only. Student rosters, groups, grades, grading
// runs and assessment results are deliberately absent even when the user opts
// into sharing authored content: those records are not teaching materials.
export const TEACHING_SERVER_TABLES = [
  'teaching_exams', 'teaching_exam_questions', 'teaching_rubrics', 'teaching_logos',
] as const;
const TEACHING_TABLES = TEACHING_SERVER_TABLES;

// A Worldbuilding vault has no imported bibliography that can act as its "core":
// these authored tables ARE the corpus. Once the user explicitly pairs that vault
// with Nodus Server, its current canonical world is published just like academic
// works are. Editing history, AI/chat transcripts, image binaries and discarded
// proposals stay local; snapshots remain a read-only consultation projection.
export const WORLDBUILDING_SERVER_TABLES = [
  'persons', 'person_names', 'person_places', 'places', 'events', 'event_participants', 'relationships',
  'character_profiles', 'event_world_dates', 'character_abilities',
  'world_groups', 'character_affiliations', 'place_profiles',
  'world_secrets', 'secret_knowers',
  'world_scenes', 'scene_characters', 'world_scene_days',
  'world_maps', 'map_layers', 'map_markers', 'map_travel_modes',
  'world_calendar', 'world_calendar_eras', 'world_calendar_months',
  'world_articles', 'world_links',
  'world_threads', 'thread_parties', 'world_beats', 'world_rules',
  'world_questions', 'world_question_options',
  'world_scene_text', 'world_chapter_breaks', 'world_manuscript_starts',
] as const;

/**
 * Genealogy and prosopography: the people, where and when, and how they relate.
 *
 * Portraits are metadata here; their bytes ride the asset channel, which is the only place a
 * binary is allowed to travel. Archive item FILES are absent on purpose — a scanned parish
 * register is a heavy document, and those never leave the machine.
 */
export const GENEALOGY_SERVER_TABLES = [
  'persons', 'person_names', 'person_places', 'person_portraits',
  'places', 'events', 'event_participants', 'relationships',
] as const;

/**
 * A study vault: what the user is learning, and how they organised it.
 *
 * Three deliberate absences. `study_recordings` is class audio, and audio never travels.
 * `study_ai_usage` is local telemetry that means nothing to a reader. And the attempt and
 * grading tables (`study_attempts`, `study_attempt_answers`, `study_grading_runs`,
 * `study_grading_annotations`, `study_mastery`, `study_reviews`, `study_srs_state`) are a
 * record of how well somebody performed — that is not shareable material, it is a transcript.
 *
 * `study_materials` travels as metadata only: the row says a document exists and what it is
 * about, while `content_blob` and `file_path` are stripped like every other binary and path.
 */
export const STUDY_SERVER_TABLES = [
  'study_academic_years', 'study_subjects', 'study_courses', 'study_topics', 'study_folders',
  'study_docs', 'study_doc_links', 'study_doc_tags', 'study_tags',
  'study_materials', 'study_material_annotations', 'study_material_placements', 'study_material_fragment_links',
  'study_schedule_periods', 'study_schedule_cells', 'study_schedule_day_styles',
  'study_calendar_events', 'study_plans', 'study_plan_blocks', 'study_goals', 'study_placements',
  'study_ideas', 'study_idea_edges', 'study_idea_evidence', 'study_idea_occurrences',
  'study_flashcards', 'study_questions', 'study_question_collections', 'study_question_collection_items',
  'study_rubrics', 'study_templates', 'study_styles', 'study_style_associations',
  'study_annotations', 'study_transcripts', 'study_transcript_segments', 'study_audio_markers',
] as const;

/**
 * A Notion-style databases vault: the shape and the values, not the files.
 *
 * `db_attachments` is included for its metadata — a reader can see that a row has a file and
 * what it is called — while its `blob` and `thumb` are stripped on the way out, as every
 * binary is. The images among them travel on the asset channel instead, by hash, under the
 * sniffer and the size ceiling (`ASSET_SOURCES` above); a PDF or a 5 GB video is metadata here
 * and nothing anywhere else.
 */
export const DATABASES_SERVER_TABLES = [
  'db_databases', 'db_columns', 'db_rows', 'db_cells', 'db_views', 'db_select_options', 'db_relations',
  'db_attachments',
] as const;

const OMIT_COLUMNS = new Set([
  'embedding', 'embedding_model', 'embedding_provider', 'embedding_dim', 'embedding_text_hash',
  'blob', 'thumb', 'audio_blob',
  'file_path', 'source_path', 'storage_path', 'local_path', 'absolute_path',
  'api_key', 'access_token', 'refresh_token', 'password', 'secret', 'credentials',
]);

// `embedding_dim` and `embedding_text_hash` used to survive while `embedding` itself was
// stripped, which left a replica holding rows that claimed a 1536-dimension vector they did
// not have. That made PASSAGE_IS_CURRENT (electron/db/readinessFilters.ts:44) report those
// passages as indexed, so the library said "ready" over a corpus with no vectors at all.

/**
 * Matches the server's own ceiling; an oversized image is skipped, never fatal.
 *
 * Declared before `ASSET_SOURCES` because one of them reads it: a source whose rows are not
 * images by construction applies the ceiling in SQL, and a `const` used inside an array
 * literal has to exist by the time that literal is evaluated.
 */
export const MAX_ASSET_BYTES = 8 * 1024 * 1024;

/**
 * The ONLY code path that turns a database blob into something the server can receive.
 *
 * The product rule is that heavy documents never travel — no PDFs, no audio — while three
 * kinds of image do: the illustration on a Deep Research report, a person's portrait, and the
 * pictures in a database's attachment columns. Rather than scan for blob columns and try to
 * exclude the wrong ones, this list names the three tables that may produce an asset. Nothing
 * else is even looked at.
 *
 * The third one is different in kind from the first two, and worth saying out loud: a Deep
 * Research illustration and a portrait are images by construction, while an attachment column
 * holds whatever the user dropped on it. It is admitted here on the strength of the two rules
 * that follow it — the sniffer, which passes four image formats and refuses everything else
 * including a PDF and a WAV, and a size ceiling applied in SQL before any blob is read. A
 * database of scanned documents therefore publishes its metadata and none of its documents,
 * which is the same answer as before; a database of photographs publishes its photographs.
 *
 * It is also why TTS audio and source PDFs are safe by construction rather than by filter:
 * narration is a loose .wav under <vault>/audio/ with only metadata in SQLite, and a work's
 * PDF lives in Zotero's own storage/ directory, outside the vault entirely.
 */
export const ASSET_SOURCES = [
  {
    kind: 'deep_research_image',
    table: 'decorative_images',
    keyColumns: ['entity_kind', 'entity_id'],
    where: "entity_kind = 'deep_research' AND status = 'ready'",
    blobColumn: 'image_blob',
    mimeColumn: 'mime_type',
    thumbColumn: 'thumbnail_blob',
    thumbMimeColumn: 'thumbnail_mime_type',
  },
  {
    kind: 'person_portrait',
    table: 'person_portraits',
    keyColumns: ['person_id'],
    where: null,
    blobColumn: 'blob',
    mimeColumn: 'mime',
    thumbColumn: 'thumbnail',
    thumbMimeColumn: 'thumbnail_mime',
  },
  {
    // The images in a database's `attachment` and `ai_image` columns.
    //
    // This is the one source where the row itself decides whether it may travel: an
    // attachment column takes anything the user drops on it, and that is explicitly allowed
    // to be a PDF or a five-gigabyte photograph. The sniffer already refuses everything that
    // is not one of four image formats, so a PDF is skipped rather than shipped; the `where`
    // adds the size ceiling *before* the blob is read, because the point of a ceiling that
    // only applies after loading a 5 GB column is hard to defend.
    //
    // What does not travel still travels as metadata: `db_attachments` is in
    // DATABASES_SERVER_TABLES, so a reader sees that a row has a file and what it is called
    // even when its bytes stayed at home.
    kind: 'db_attachment',
    table: 'db_attachments',
    keyColumns: ['id'],
    where: `blob IS NOT NULL AND length(blob) > 0 AND length(blob) <= ${MAX_ASSET_BYTES}`,
    blobColumn: 'blob',
    mimeColumn: 'mime_type',
    thumbColumn: 'thumb',
    // There is no thumbnail mime column here; the sniffer derives it from the bytes, which
    // is what it does for every source anyway.
    thumbMimeColumn: 'thumb_mime',
  },
] as const;

const IMAGE_SIGNATURES: { mime: string; test: (bytes: Buffer) => boolean }[] = [
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  // WAV opens with the same four RIFF bytes as WEBP; the format name at 8..12 is what
  // tells them apart, and getting that wrong would ship audio through the image channel.
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
  { mime: 'image/gif', test: (b) => /^GIF8[79]a$/.test(b.subarray(0, 6).toString('ascii')) },
];

function sniffImage(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  return IMAGE_SIGNATURES.find((signature) => signature.test(bytes))?.mime ?? null;
}

export interface SnapshotAssetRef {
  hash: string;
  thumbHash: string | null;
  mime: string;
  thumbMime: string | null;
  bytes: number;
  thumbBytes: number | null;
  kind: string;
  table: string;
  key: string[];
}

export interface SnapshotAsset extends SnapshotAssetRef {
  data: Buffer;
  thumbData: Buffer | null;
}

/**
 * What each vault type publishes beyond the academic core.
 *
 * A type absent from this map publishes only CORE_TABLES, which for a non-academic vault
 * means almost nothing — that was the state genealogy, teaching, study and databases were in:
 * a connected replica received their images and no rows at all.
 */
const TABLES_BY_VAULT_TYPE: Partial<Record<VaultSummary['type'], readonly string[]>> = {
  worldbuilding: WORLDBUILDING_SERVER_TABLES,
  genealogy: GENEALOGY_SERVER_TABLES,
  prosopography: GENEALOGY_SERVER_TABLES,
  estudio: STUDY_SERVER_TABLES,
  // Teaching reuses the study views, so a shared teaching vault carries both its own
  // materials and the study structure they hang from. Rosters and grades are in neither.
  docencia: [...TEACHING_SERVER_TABLES, ...STUDY_SERVER_TABLES],
  databases: DATABASES_SERVER_TABLES,
};

function tableNames(db: Database.Database): Set<string> {
  return new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((row) => row.name));
}

function safeValue(column: string, value: unknown): unknown {
  const normalized = column.toLowerCase();
  if (
    OMIT_COLUMNS.has(normalized) ||
    normalized.endsWith('_path') ||
    /(^|_)(api_key|access_token|refresh_token|password|credential|credentials)(_|$)/.test(normalized) ||
    Buffer.isBuffer(value)
  ) return undefined;
  if (typeof value === 'bigint') return Number(value);
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  return undefined;
}

/**
 * Drop the columns a publication never carries.
 *
 * Shared with the outgoing mutation queue, and it has to be: the server validates an
 * incoming row against the shape of the last snapshot, so a replica sending the full live
 * row would be refused for naming `embedding` — a column that is local by design and whose
 * value belongs to whichever machine computed it, not to the vault.
 */
export function stripUnpublishableColumns(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).flatMap(([column, value]) => {
      const safe = safeValue(column, value);
      return safe === undefined ? [] : [[column, safe]];
    })
  );
}

function readTable(db: Database.Database, table: string): Record<string, unknown>[] {
  return (db.prepare(`SELECT * FROM "${table.replace(/"/g, '""')}"`).all() as Record<string, unknown>[]).map((row) =>
    Object.fromEntries(Object.entries(row).flatMap(([column, value]) => {
      const safe = safeValue(column, value);
      return safe === undefined ? [] : [[column, safe]];
    }))
  );
}

function columnNames(db: Database.Database, table: string): Set<string> {
  return new Set((db.pragma(`table_info("${table.replace(/"/g, '""')}")`) as { name: string }[]).map((row) => row.name));
}

/**
 * Read the publishable images out of the two whitelisted tables.
 *
 * Every candidate is sniffed from its own bytes rather than trusted from its declared mime
 * column: the database is local and honest, but the same rule holds on both ends of the
 * wire, and it means a corrupt row is skipped instead of shipped.
 */
export function collectSnapshotAssets(db: Database.Database, present: Set<string>): SnapshotAsset[] {
  const assets: SnapshotAsset[] = [];
  for (const source of ASSET_SOURCES) {
    if (!present.has(source.table)) continue;
    const columns = columnNames(db, source.table);
    if (!columns.has(source.blobColumn)) continue;
    const selected: string[] = [...source.keyColumns, source.blobColumn];
    if (columns.has(source.mimeColumn)) selected.push(source.mimeColumn);
    if (columns.has(source.thumbColumn)) selected.push(source.thumbColumn);
    if (columns.has(source.thumbMimeColumn)) selected.push(source.thumbMimeColumn);
    const where = source.where ? ` WHERE ${source.where}` : '';
    const rows = db
      .prepare(`SELECT ${selected.map((name) => `"${name}"`).join(', ')} FROM "${source.table}"${where}`)
      .all() as Record<string, unknown>[];

    for (const row of rows) {
      const cell = (column: string): unknown => (row as Record<string, unknown>)[column];
      const data = cell(source.blobColumn);
      if (!Buffer.isBuffer(data) || data.length === 0 || data.length > MAX_ASSET_BYTES) continue;
      const mime = sniffImage(data);
      if (!mime) continue;
      const rawThumb = cell(source.thumbColumn);
      const thumbData = Buffer.isBuffer(rawThumb) && rawThumb.length > 0 && rawThumb.length <= MAX_ASSET_BYTES ? rawThumb : null;
      const thumbMime = thumbData ? sniffImage(thumbData) : null;
      const usableThumb = thumbMime ? thumbData : null;
      assets.push({
        hash: createHash('sha256').update(data).digest('hex'),
        thumbHash: usableThumb ? createHash('sha256').update(usableThumb).digest('hex') : null,
        mime,
        thumbMime,
        bytes: data.length,
        thumbBytes: usableThumb ? usableThumb.length : null,
        kind: source.kind,
        table: source.table,
        key: source.keyColumns.map((column) => String(cell(column) ?? '')),
        data,
        thumbData: usableThumb,
      });
    }
  }
  // Stable order so an unchanged vault hashes to an unchanged revision.
  return assets.sort((a, b) => (a.kind === b.kind ? a.key.join('\u0000').localeCompare(b.key.join('\u0000')) : a.kind.localeCompare(b.kind)));
}

/** The reference that rides in the JSON: everything about the image except its bytes. */
function assetRef(asset: SnapshotAsset): SnapshotAssetRef {
  const { data: _data, thumbData: _thumbData, ...ref } = asset;
  return ref;
}

export function lightweightVaultRevision(db: Database.Database = getDb()): string {
  const changes = db.prepare('SELECT total_changes() AS value').get() as { value: number };
  const dataVersion = db.pragma('data_version', { simple: true }) as number;
  const schemaVersion = db.pragma('user_version', { simple: true }) as number;
  return `${changes.value}:${dataVersion}:${schemaVersion}`;
}

export interface BuiltSnapshot {
  buffer: Buffer;
  revision: string;
  counts: Record<string, number>;
  assets: SnapshotAsset[];
  schemaVersion: number;
}

export function buildServerSnapshot(
  vault: VaultSummary,
  settings: Pick<AppSettings, 'nodusServerIncludeUserContent' | 'nodusServerIncludePassages'>,
  db: Database.Database = getDb(),
  library: PublishedLibraryManifest | null = null,
): BuiltSnapshot {
  const present = tableNames(db);
  const selected = new Set<string>(CORE_TABLES.filter((table) => present.has(table)));
  // Each vault type contributes its own corpus. Academic has none listed here because
  // CORE_TABLES already IS the academic corpus; the others have no imported bibliography, so
  // these authored tables are what a reader would come for.
  for (const table of TABLES_BY_VAULT_TYPE[vault.type] ?? []) {
    if (present.has(table)) selected.add(table);
  }
  if (settings.nodusServerIncludePassages && present.has('passages')) selected.add('passages');
  if (settings.nodusServerIncludeUserContent) {
    USER_TABLES.filter((table) => present.has(table)).forEach((table) => selected.add(table));
    // Was `table.startsWith('study_')`, which swept in everything the prefix touched:
    // `study_recordings` (what was recorded in a class and when), `study_attempts`,
    // `study_grading_runs` and `study_mastery` (how well somebody performed), and
    // `study_ai_usage` (local telemetry). None of that is shareable material. The explicit
    // list is the point: a table added by a later migration now has to be named to travel.
    STUDY_SERVER_TABLES.filter((table) => present.has(table)).forEach((table) => selected.add(table));
    TEACHING_TABLES.filter((table) => present.has(table)).forEach((table) => selected.add(table));
  }

  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of [...selected].sort()) tables[table] = readTable(db, table);

  // Images ride their own channel, addressed by content hash, so the JSON keeps its
  // invariant of holding no binary at all. A portrait is only published for a vault that
  // has people; a Deep Research illustration only when its report travels.
  const wantsAssets = settings.nodusServerIncludeUserContent || vault.type !== 'academic';
  const assets = wantsAssets ? collectSnapshotAssets(db, present) : [];
  const assetRefs = assets.map(assetRef);
  const schemaVersion = db.pragma('user_version', { simple: true }) as number;

  const generatedAt = new Date().toISOString();
  const payload = {
    format: SERVER_SNAPSHOT_FORMAT,
    formatVersion: SERVER_SNAPSHOT_VERSION,
    generatedAt,
    schemaVersion,
    vault: { id: vault.id, name: vault.name, type: vault.type },
    capabilities: {
      includesUserContent: Boolean(settings.nodusServerIncludeUserContent),
      includesPassages: Boolean(settings.nodusServerIncludePassages),
      hasAssets: assetRefs.length > 0,
      includesLibraryDocuments: Boolean(library),
    },
    assets: assetRefs,
    library,
    tables,
  };
  const raw = Buffer.from(JSON.stringify(payload));
  // generatedAt describes this upload, not its contents. Keeping it outside the
  // digest lets the server recognize an unchanged projection after app restarts.
  // Asset hashes ARE part of it: replacing only a report's illustration has to count
  // as a change, or the republish would be short-circuited as "unchanged".
  const revision = createHash('sha256')
    .update(JSON.stringify({
      vault: payload.vault,
      schemaVersion,
      assets: assetRefs,
      // Like the snapshot timestamp, the library projection's generatedAt describes the
      // upload and is not content. Excluding it keeps an unchanged library revision stable.
      library: library ? { ...library, generatedAt: undefined } : null,
      tables,
    }))
    .digest('base64url');
  return {
    buffer: raw,
    revision,
    counts: Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length])),
    assets,
    schemaVersion,
  };
}
