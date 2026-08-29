import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { loadCanonicalMigrations } from './nativeMigrations.mjs';
import { MUTABLE_TABLES } from './core/generatedMutableTables.mjs';

export const NATIVE_STORAGE_KIND = 'server_native';
export const DESKTOP_PUBLISHED_STORAGE_KIND = 'desktop_published';
export const SERVER_AUTHORITY_MODE = 'server';
export const DESKTOP_AUTHORITY_MODE = 'desktop';
export const NATIVE_INITIALIZATION_STATES = Object.freeze(['initializing', 'ready', 'failed']);
export const NATIVE_VAULT_TYPES = Object.freeze([
  'academic', 'estudio', 'primary_sources', 'genealogy', 'prosopography',
  'databases', 'testimonios', 'worldbuilding', 'docencia',
]);

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const COMMAND_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_NAME = 120;
const MAX_DESCRIPTION = 500;
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PRIVATE_COLUMN = /(?:national[_-]?id|email|phone|address|api[-_]?key|token|password|secret|credential|authorization|cookie|private[-_]?key|signing[-_]?key|audio[-_]?path|file[-_]?path|absolute[-_]?path|local[-_]?path|embedding)/i;
const OWNER_COLUMN = /(?:owner|user|actor|created[_-]?by|updated[_-]?by|student|participant|speaker)/i;
const NON_PORTABLE_COLUMN = /(?:blob|(?:file|local|absolute|audio)[_-]?path|(?:^|[_-])path$)/i;

// Database Deep Research needs a read-only projection of normalized database
// internals. Keep these out of NATIVE_CONTENT_KEYS so the generic authoring
// contract never exposes mutation for rows/cells maintained by Desktop.
const NATIVE_READONLY_CONTENT_KEYS = Object.freeze({
  db_columns: ['id'], db_rows: ['id'], db_cells: ['row_id', 'column_id'],
  db_computed_cells: ['row_id', 'column_id'], db_views: ['id'],
  // Analysis needs metadata for typed options, attachments and relations.  They
  // are projections only: the write allowlist intentionally still excludes them.
  db_select_options: ['id'], db_attachments: ['id'], db_relations: ['id'],
});

// These tables are intentionally absent from the publication contract, but remain
// available to authenticated members of their server-native vault. They are kept
// separate from the ordinary authoring set so the publication denylist cannot be
// weakened accidentally.
const NATIVE_PRIVATE_CONTENT_KEYS = Object.freeze({
  teaching_groups: ['id'], teaching_students: ['id'], teaching_assessment_plans: ['id'],
  teaching_assessment_items: ['id'], teaching_grade_entries: ['id'], teaching_rubric_evaluations: ['id'],
  study_attempts: ['id'], study_attempt_answers: ['id'], study_grading_runs: ['id'],
  study_grading_annotations: ['id'], study_srs_state: ['card_id'], study_reviews: ['id'], study_mastery: ['id'],
  testimony_participant_profiles: ['person_id'], testimony_interview_participants: ['interview_id', 'person_id', 'role'],
  testimony_media: ['id'], testimony_agreements: ['id'],
});

// List endpoints deliberately return a small, useful projection. Detail and mutation
// responses retain the non-secret scalar columns, while BLOBs and local paths are never
// accepted or returned by this boundary.
const NATIVE_MINIMAL_LIST_COLUMNS = Object.freeze({
  teaching_groups: ['id', 'short_id', 'name', 'subject_id', 'academic_year_id', 'expected_size', 'position', 'archived_at', 'deleted_at', 'created_at', 'updated_at'],
  teaching_students: ['id', 'group_id', 'pseudonym_code', 'position', 'created_at', 'updated_at'],
  teaching_assessment_plans: ['id', 'short_id', 'name', 'subject_id', 'academic_year_id', 'profile', 'published_at', 'version', 'archived_at', 'deleted_at', 'created_at', 'updated_at'],
  teaching_assessment_items: ['id', 'plan_id', 'parent_id', 'name', 'kind', 'position', 'weight', 'weight_alt', 'aggregation', 'entry_mode', 'max_points', 'min_to_average', 'is_mandatory', 'is_recoverable', 'target', 'best_of', 'conditional_min', 'created_at', 'updated_at'],
  teaching_grade_entries: ['id', 'student_id', 'item_id', 'convocatoria', 'raw_value', 'status', 'is_override', 'created_at', 'updated_at'],
  teaching_rubric_evaluations: ['id', 'entry_id', 'criterion_id', 'level_id', 'created_at', 'updated_at'],
  study_attempts: ['id', 'short_id', 'assessment_id', 'mode', 'status', 'score', 'max_score', 'correct_count', 'incorrect_count', 'omitted_count', 'duration_seconds', 'started_at', 'submitted_at', 'created_at', 'updated_at'],
  study_attempt_answers: ['id', 'attempt_id', 'assessment_item_id', 'question_id', 'is_correct', 'points_awarded', 'response_ms', 'flagged', 'confidence', 'created_at', 'updated_at'],
  study_grading_runs: ['id', 'attempt_answer_id', 'rubric_id', 'severity', 'estimated_score', 'manual_score', 'created_at', 'updated_at'],
  study_grading_annotations: ['id', 'grading_run_id', 'from_pos', 'to_pos', 'kind', 'severity', 'created_at'],
  study_srs_state: ['card_id', 'ease_factor', 'interval_days', 'due_at', 'repetitions', 'lapses', 'last_rating', 'last_reviewed_at', 'confidence', 'mastered', 'excluded', 'updated_at'],
  study_reviews: ['id', 'card_id', 'rating', 'confidence', 'correct', 'elapsed_ms', 'previous_interval_days', 'next_interval_days', 'scheduled_at', 'created_at'],
  study_mastery: ['id', 'scope_kind', 'scope_id', 'mastery', 'confidence', 'evidence_count', 'status', 'last_activity_at', 'updated_at'],
  testimony_participant_profiles: ['person_id', 'identity_mode', 'created_at', 'updated_at'],
  testimony_interview_participants: ['interview_id', 'person_id', 'role', 'is_primary', 'position', 'created_at'],
  testimony_media: ['id', 'session_id', 'media_kind', 'role', 'file_name', 'mime_type', 'content_hash', 'duration_seconds', 'size_bytes', 'immutable', 'created_at', 'deleted_at'],
  testimony_agreements: ['id', 'interview_id', 'version_no', 'is_current', 'status', 'access_level', 'embargo_until', 'attribution_mode', 'narrator_review_required', 'narrator_review_status', 'created_at', 'updated_at'],
});

// Foreign keys and provisional labels are needed to author private domain rows, but
// remain absent from list projections where they are not needed for navigation.
const NATIVE_PRIVATE_WRITABLE_COLUMNS = Object.freeze({
  teaching_grade_entries: ['student_id'],
  testimony_interview_participants: ['speaker_label'],
});

// This is deliberately an allow-list of canonical Desktop tables. Tables excluded here
// are either derived (works/ideas), account-private (user-scoped sync rows), or contain
// student/participant/prosopography identity. The source of truth for keys remains the
// generated Desktop mutation contract; the additional tables are canonical entities whose
// Desktop repositories provide ordinary CRUD but do not participate in device sync.
const NATIVE_CONTENT_KEYS = {
  ...Object.fromEntries(Object.entries(MUTABLE_TABLES).filter(([table]) => !table.startsWith('prosop_') && !Object.hasOwn(NATIVE_READONLY_CONTENT_KEYS, table)).map(([table, definition]) => [table, definition.key])),
  ...NATIVE_PRIVATE_CONTENT_KEYS,
  // Core academic entities are canonical Desktop tables but are not generated
  // device-sync mutations; their keys are taken directly from the migrations.
  ideas: ['global_id'], works: ['nodus_id'], authors: ['author_id'], passages: ['passage_id'],
  themes: ['theme_id'], gaps: ['id'], work_themes: ['nodus_id', 'theme_id'], work_authors: ['nodus_id', 'author_id'],
  idea_occurrences: ['global_id', 'nodus_id'], evidence: ['id'], edges: ['id'], external_refs: ['id'],
  study_courses: ['id'], study_subjects: ['id'], study_topics: ['id'], study_folders: ['id'], study_docs: ['id'],
  study_materials: ['id'], study_questions: ['id'], study_flashcards: ['id'], study_plans: ['id'], study_plan_blocks: ['id'],
  study_calendar_events: ['id'], study_goals: ['id'], study_schedule_periods: ['id'], study_schedule_cells: ['id'],
  teaching_exams: ['id'], teaching_exam_questions: ['id'], teaching_rubrics: ['id'],
  archive_folders: ['folder_id'], archive_items: ['item_id'], archive_repositories: ['repository_id'],
  archive_description_units: ['unit_id'], archive_excerpts: ['excerpt_id'], archive_source_analyses: ['analysis_id'],
  testimony_interviews: ['id'], testimony_transcripts: ['id'], testimony_codes: ['id'], testimony_contrasts: ['id'],
};

// Prosopography is identity-bearing, but a server-native vault is owned by the
// authenticated workspace and may author its own people, sources and explicit
// links. Keep this contract separate from Desktop publication: these tables are
// never copied into a desktop_published snapshot or exposed through v1 corpus
// collections. Derived observations, captures and proposals remain domain-owned
// until their dedicated server contract exists.
const PROSOPOGRAPHY_NATIVE_CONTENT_KEYS = Object.freeze({
  persons: ['person_id'],
  prosop_person_profiles: ['person_id'],
  prosop_sources: ['source_id'],
  prosop_source_segments: ['segment_id'],
  prosop_network_layers: ['layer_id'],
  prosop_network_edges: ['edge_id'],
  prosop_organizations: ['organization_id'],
});

Object.assign(NATIVE_CONTENT_KEYS, PROSOPOGRAPHY_NATIVE_CONTENT_KEYS);
Object.freeze(NATIVE_CONTENT_KEYS);

// A table being present in a canonical SQLite file is not sufficient authority to
// expose it from every vault family. Keep this second boundary explicit: it mirrors
// the web surfaces that have a real Desktop CRUD counterpart and fails closed for
// every other cross-domain table.
const ALLOWED_CONTENT_TABLES_BY_VAULT_TYPE = Object.freeze({
  academic: new Set(['db_databases', 'pages', 'ideas', 'works', 'authors', 'passages', 'themes', 'gaps', 'work_themes', 'work_authors', 'idea_occurrences', 'evidence', 'edges', 'external_refs', 'persons', 'places', 'events', 'relationships']),
  estudio: new Set(['study_courses', 'study_materials', 'study_questions', 'study_plans', 'study_calendar_events', 'study_schedule_periods', 'study_attempts', 'study_attempt_answers', 'study_grading_runs', 'study_grading_annotations', 'study_srs_state', 'study_reviews', 'study_mastery']),
  primary_sources: new Set(['archive_items', 'archive_repositories', 'archive_description_units', 'archive_excerpts', 'archive_source_analyses']),
  genealogy: new Set(['persons', 'places', 'events', 'relationships']),
  // Native prosopography is an authenticated authoring workspace. Its person/source/
  // link rows are deliberately absent from the desktop publication allowlist below.
  prosopography: new Set(['persons', 'prosop_person_profiles', 'prosop_sources', 'prosop_source_segments', 'prosop_network_layers', 'prosop_network_edges', 'prosop_organizations']),
  databases: new Set(['db_databases', 'pages', 'db_columns', 'db_rows', 'db_cells', 'db_computed_cells', 'db_views', 'db_select_options', 'db_attachments', 'db_relations']),
  testimonios: new Set(['testimony_interviews', 'testimony_transcripts', 'testimony_codes', 'testimony_contrasts', 'testimony_participant_profiles', 'testimony_interview_participants', 'testimony_media', 'testimony_agreements']),
  worldbuilding: new Set(['persons', 'places', 'events', 'relationships', 'world_groups', 'world_scenes', 'world_articles', 'world_threads', 'world_rules', 'world_questions', 'world_maps']),
  docencia: new Set(['study_courses', 'study_subjects', 'teaching_exams', 'teaching_rubrics', 'teaching_groups', 'teaching_students', 'teaching_assessment_plans', 'teaching_assessment_items', 'teaching_grade_entries', 'teaching_rubric_evaluations']),
});

const CONTENT_DENYLIST = new Set([
  'teaching_groups', 'teaching_students', 'teaching_assessment_plans', 'teaching_assessment_items',
  'teaching_grade_entries', 'teaching_rubric_evaluations', 'study_attempts', 'study_attempt_answers',
  'study_grading_runs', 'study_grading_annotations', 'study_mastery', 'study_reviews', 'study_srs_state',
  'testimony_participant_profiles', 'testimony_interview_participants', 'testimony_media',
  'testimony_agreements', 'testimony_agreement_versions',
  // Prosopography has an explicit native authoring allowlist below. Keep the
  // evidence/analysis tables denied here; they require domain invariants and
  // must not become generic row mutations. People, sources and links are the
  // small authenticated workspace contract, so they are intentionally not
  // part of this denylist.
  'prosop_factoids', 'prosop_statements', 'prosop_variable_revisions', 'prosop_population_memberships',
]);

function contentTablePolicy(vaultType, table, mode = 'write') {
  const known = Object.hasOwn(NATIVE_CONTENT_KEYS, table)
    || (mode === 'read' && Object.hasOwn(NATIVE_READONLY_CONTENT_KEYS, table));
  if (!known || (CONTENT_DENYLIST.has(table) && !Object.hasOwn(NATIVE_PRIVATE_CONTENT_KEYS, table))) return false;
  if (!ALLOWED_CONTENT_TABLES_BY_VAULT_TYPE[vaultType]?.has(table)) return false;
  if (MUTABLE_TABLES[table]?.scope === 'user') return false;
  // Prosopography has an aggregate-only publication policy. Never let a generic endpoint
  // become an identity oracle, even for a member of a newly created vault.
  // `desktop_published` never reaches this native content policy. A native
  // prosopography request is already authenticated and scoped to its own vault.
  if (vaultType === 'testimonios' && /^(persons|person_names|person_places|relationships|character_profiles)$/.test(table)) return false;
  if (vaultType === 'primary_sources' && /^(persons|person_names|person_places|relationships)$/.test(table)) return false;
  if (vaultType === 'docencia' && /^(persons|person_names|person_places|relationships)$/.test(table)) return false;
  return true;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`;
  return `'${String(value).replaceAll("'", "''")}'`;
}

function bindSql(sql, values) {
  if (values && !Array.isArray(values) && typeof values === 'object') {
    return sql.replace(/[@:$][A-Za-z_][A-Za-z0-9_]*/g, (token) => Object.hasOwn(values, token.slice(1)) ? sqlLiteral(values[token.slice(1)]) : token);
  }
  let index = 0; return sql.replace(/\?/g, () => sqlLiteral((values || [])[index++]));
}

// The desktop dependency is compiled for Electron's Node ABI in development distributions.
// A server started with the system Node can still provide real SQLite files through the
// sqlite3 utility (available in the server image), instead of silently falling back to JSON.
class CliDatabase {
  constructor(file, options = {}) { this.file = file; this.readonly = Boolean(options.readonly); }
  exec(sql) {
    if (this._transactionStatements) {
      const statement = String(sql).trim();
      this._transactionStatements.push(statement.endsWith(';') ? statement : `${statement};`);
      return;
    }
    execFileSync('sqlite3', [this.file], { input: `${sql}\n`, stdio: ['pipe', 'pipe', 'pipe'] });
  }
  pragma(value) {
    if (/^wal_checkpoint/i.test(String(value))) return this.get(`PRAGMA ${value}`);
    if (/=/.test(String(value))) { this.exec(`PRAGMA ${value}`); return undefined; }
    return this.get(`PRAGMA ${value}`)?.[Object.keys(this.get(`PRAGMA ${value}`) || {})[0]];
  }
  prepare(sql) {
    const params = (values) => values.length === 1 && (Array.isArray(values[0]) || (values[0] && typeof values[0] === 'object')) ? values[0] : values;
    return {
      get: (...values) => { const rows = this._query(bindSql(sql, params(values))); return rows[0]; },
      all: (...values) => this._query(bindSql(sql, params(values))),
      run: (...values) => { this.exec(bindSql(sql, params(values))); return { changes: 0 }; },
    };
  }
  get(sql) { return this._query(sql)[0]; }
  _query(sql) {
    const output = execFileSync('sqlite3', ['-json', this.file, sql], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return output ? JSON.parse(output) : [];
  }
  transaction(fn) {
    return (...args) => {
      // sqlite3's CLI is process-scoped. BEGIN in one execFileSync call followed
      // by INSERTs in later calls would auto-rollback the transaction. Queue the
      // callback's writes and send one BEGIN/COMMIT script to one client process.
      this._transactionStatements = [];
      try {
        const result = fn(...args);
        const script = ['.bail on', 'BEGIN IMMEDIATE;', ...this._transactionStatements, 'COMMIT;'].join('\n');
        execFileSync('sqlite3', [this.file], { input: `${script}\n`, stdio: ['pipe', 'pipe', 'pipe'] });
        return result;
      } finally { this._transactionStatements = null; }
    };
  }
  close() {}
}

function migrateWithCli(file, migrations) {
  const currentOutput = execFileSync('sqlite3', [file, 'PRAGMA user_version;'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const currentVersion = Number.parseInt(currentOutput, 10) || 0;
  const script = [...migrations].sort((a, b) => a.version - b.version)
    .filter((migration) => migration.version > currentVersion)
    .map((migration) => `${migration.up}\nPRAGMA user_version = ${migration.version};`).join('\n');
  if (!script) return;
  execFileSync('sqlite3', [file], { input: `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;\n${script}\n`, stdio: ['pipe', 'pipe', 'pipe'] });
}

function nowIso() { return new Date().toISOString(); }
function cleanId(value, label = 'id') {
  const result = String(value ?? '');
  if (!ID.test(result)) throw new NativeVaultError('invalid_id', `Invalid ${label}.`);
  return result;
}
function cleanName(value) {
  const result = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
  if (!result) throw new NativeVaultError('invalid_name', 'A vault name is required.');
  return result;
}
function cleanType(value) {
  const result = String(value || 'academic');
  if (!NATIVE_VAULT_TYPES.includes(result)) throw new NativeVaultError('invalid_vault_type', 'This vault type is not supported.');
  return result;
}
function safeRevision(value) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new NativeVaultError('invalid_revision', 'Revision must be a non-negative integer.');
  return revision;
}

export class NativeVaultError extends Error {
  constructor(code, message, details = {}) {
    super(message); this.name = 'NativeVaultError'; this.code = code; this.details = details;
  }
}

/**
 * Canonical storage for server-owned vaults.
 *
 * `state.json` remains the control plane (accounts, memberships and old published spaces).
 * This class owns every byte of a native vault and never mutates an existing
 * `desktop_published` space. Each operation stages files before swapping them into place.
 */
export class NativeVaultStore {
  constructor(root, options = {}) {
    this.root = path.resolve(root);
    this.vaultsRoot = path.join(this.root, 'vaults');
    this.migrations = options.migrations ?? null;
    this.Database = options.Database;
    fs.mkdirSync(this.vaultsRoot, { recursive: true, mode: 0o700 });
  }

  async canonical() {
    if (!this.migrations) this.migrations = await loadCanonicalMigrations();
    return this.migrations;
  }

  vaultDirectory(id) { return path.join(this.vaultsRoot, cleanId(id, 'vault id')); }
  databasePath(id) { return path.join(this.vaultDirectory(id), 'vault.sqlite'); }
  metadataPath(id) { return path.join(this.vaultDirectory(id), 'metadata.json'); }

  async _database() {
    if (this.Database === undefined) {
      try { this.Database = (await import('better-sqlite3')).default; }
      catch { this.Database = null; }
    }
    return this.Database;
  }

  async _createDb(file, mode = {}) {
    const DatabaseClass = await this._database();
    if (!DatabaseClass) return new CliDatabase(file, mode);
    try { return new DatabaseClass(file, mode); }
    catch (error) {
      // Electron's native module may be present but built for another Node ABI. Treat that
      // exactly like an unavailable optional driver and keep the canonical SQLite fallback.
      if (error?.code !== 'ERR_DLOPEN_FAILED') throw error;
      this.Database = null; return new CliDatabase(file, mode);
    }
  }

  async _open(id, mode = {}) {
    const file = this.databasePath(id);
    if (!fs.existsSync(file)) throw new NativeVaultError('vault_not_found', 'Vault not found.');
    const db = await this._createDb(file, mode);
    try {
      db.pragma('foreign_keys = ON');
      db.pragma('busy_timeout = 5000');
      return db;
    } catch (error) { db.close(); throw error; }
  }

  _ensureMetadataTable(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS server_native_metadata (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      storage_kind TEXT NOT NULL,
      authority_mode TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      initialization_state TEXT NOT NULL,
      vault_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      vault_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (storage_kind = 'server_native'),
      CHECK (authority_mode = 'server'),
      CHECK (initialization_state IN ('initializing', 'ready', 'failed'))
    );`);
  }

  _metadataFromDb(db) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='server_native_metadata'").get()) return null;
    const row = db.prepare('SELECT * FROM server_native_metadata WHERE id=1').get();
    return row ? {
      id: row.vault_id, name: row.name, description: row.description,
      vaultType: row.vault_type, storageKind: row.storage_kind, authorityMode: row.authority_mode,
      schemaVersion: Number(row.schema_version), revision: Number(row.revision),
      initializationState: row.initialization_state, createdAt: row.created_at, updatedAt: row.updated_at,
    } : null;
  }

  async _migrate(file) {
    const { runMigrations, SCHEMA_VERSION } = await this.canonical();
    const DatabaseClass = await this._database();
    if (!DatabaseClass) { migrateWithCli(file, this.migrations.migrations); return { db: new CliDatabase(file), schemaVersion: Number(SCHEMA_VERSION) }; }
    const db = await this._createDb(file);
    if (db instanceof CliDatabase) { migrateWithCli(file, this.migrations.migrations); return { db, schemaVersion: Number(SCHEMA_VERSION) }; }
    try { runMigrations(db); return { db, schemaVersion: Number(SCHEMA_VERSION) }; }
    catch (error) { db.close(); throw error; }
  }

  async create(input = {}) {
    const id = input.id ? cleanId(input.id, 'vault id') : randomUUID();
    const name = cleanName(input.name);
    const description = String(input.description || '').trim().slice(0, MAX_DESCRIPTION);
    const vaultType = cleanType(input.vaultType ?? input.type);
    const directory = this.vaultDirectory(id);
    if (fs.existsSync(directory)) throw new NativeVaultError('vault_exists', 'A vault with that id already exists.');
    const temporary = path.join(this.vaultsRoot, `.creating-${id}-${process.pid}-${randomUUID()}`);
    fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
    const file = path.join(temporary, 'vault.sqlite');
    const createdAt = nowIso();
    let db;
    try {
      const migrated = await this._migrate(file); db = migrated.db;
      this._ensureMetadataTable(db);
      db.prepare(`INSERT INTO server_native_metadata
        (id, storage_kind, authority_mode, schema_version, revision, initialization_state,
         vault_id, name, description, vault_type, created_at, updated_at)
        VALUES (1, 'server_native', 'server', ?, 0, 'ready', ?, ?, ?, ?, ?, ?)`)
        .run(migrated.schemaVersion, id, name, description, vaultType, createdAt, createdAt);
      db.close(); db = null;
      fs.renameSync(temporary, directory);
      return this.get(id);
    } catch (error) {
      try { db?.close(); } catch {}
      fs.rmSync(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  async get(id) {
    const db = await this._open(id, { readonly: true });
    try { return this._metadataFromDb(db); } finally { db.close(); }
  }

  async list() {
    if (!fs.existsSync(this.vaultsRoot)) return [];
    const entries = fs.readdirSync(this.vaultsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && ID.test(entry.name))
      .map((entry) => this.get(entry.name).catch(() => null));
    return (await Promise.all(entries))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  async mutateMetadata(id, expectedRevision, patch = {}) {
    const db = await this._open(id);
    try {
      const current = this._metadataFromDb(db);
      if (expectedRevision !== undefined && safeRevision(expectedRevision) !== current.revision) {
        throw new NativeVaultError('revision_conflict', 'The vault changed since it was read.', { currentRevision: current.revision });
      }
      const name = patch.name === undefined ? current.name : cleanName(patch.name);
      const description = patch.description === undefined ? current.description : String(patch.description || '').trim().slice(0, MAX_DESCRIPTION);
      const vaultType = patch.vaultType === undefined && patch.type === undefined ? current.vaultType : cleanType(patch.vaultType ?? patch.type);
      const updatedAt = nowIso(); const revision = current.revision + 1;
      db.prepare(`UPDATE server_native_metadata SET name=?, description=?, vault_type=?, revision=?, updated_at=? WHERE id=1`)
        .run(name, description, vaultType, revision, updatedAt);
      return this._metadataFromDb(db);
    } finally { db.close(); }
  }

  async duplicate(sourceId, input = {}) {
    const source = await this.get(sourceId);
    const id = input.id ? cleanId(input.id, 'vault id') : randomUUID();
    const name = cleanName(input.name ?? `${source.name} (copy)`);
    const target = this.vaultDirectory(id);
    if (fs.existsSync(target)) throw new NativeVaultError('vault_exists', 'A vault with that id already exists.');
    const temporary = path.join(this.vaultsRoot, `.duplicating-${id}-${process.pid}-${randomUUID()}`);
    fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
    const staged = path.join(temporary, 'vault.sqlite');
    let sourceDb;
    try {
      sourceDb = await this._open(sourceId);
      sourceDb.pragma('wal_checkpoint(TRUNCATE)');
      fs.copyFileSync(this.databasePath(sourceId), staged);
      fs.renameSync(temporary, target);
      const db = await this._createDb(path.join(target, 'vault.sqlite'));
      try {
        const createdAt = nowIso();
        db.prepare(`UPDATE server_native_metadata SET vault_id=?, name=?, description=?, revision=0, created_at=?, updated_at=?, initialization_state='ready' WHERE id=1`)
          .run(id, name, String(input.description ?? source.description).trim().slice(0, MAX_DESCRIPTION), createdAt, createdAt);
      } finally { db.close(); }
      return this.get(id);
    } catch (error) {
      fs.rmSync(temporary, { recursive: true, force: true }); fs.rmSync(target, { recursive: true, force: true }); throw error;
    } finally { sourceDb?.close(); }
  }

  async reset(id, expectedRevision) {
    const current = await this.get(id);
    if (expectedRevision !== undefined && safeRevision(expectedRevision) !== current.revision) throw new NativeVaultError('revision_conflict', 'The vault changed since it was read.', { currentRevision: current.revision });
    const db = await this._open(id);
    try {
      // Preserve the identity and metadata, while clearing domain rows. Re-running the
      // canonical migration on a fresh temporary DB is safer than guessing foreign-key order.
      const temporary = `${this.databasePath(id)}.reset-${process.pid}-${randomUUID()}`;
      db.close();
      const migrated = await this._resetDatabaseFile(temporary, current);
      const target = this.databasePath(id); const backup = `${target}.before-reset-${process.pid}-${randomUUID()}`;
      try {
        fs.renameSync(target, backup); fs.renameSync(temporary, target); fs.rmSync(backup, { force: true });
      } catch (error) {
        fs.rmSync(temporary, { force: true });
        try { if (fs.existsSync(backup)) fs.renameSync(backup, target); } catch {}
        throw error;
      }
      return migrated;
    } catch (error) { try { db.close(); } catch {} throw error; }
  }

  async _resetDatabaseFile(file, current) {
    const migrated = await this._migrate(file); const db = migrated.db;
    try {
      this._ensureMetadataTable(db); const timestamp = nowIso();
      db.prepare(`INSERT INTO server_native_metadata
        (id, storage_kind, authority_mode, schema_version, revision, initialization_state,
         vault_id, name, description, vault_type, created_at, updated_at)
        VALUES (1, 'server_native', 'server', ?, ?, 'ready', ?, ?, ?, ?, ?, ?)`)
        .run(migrated.schemaVersion, current.revision + 1, current.id, current.name, current.description, current.vaultType, current.createdAt, timestamp);
      const result = this._metadataFromDb(db); db.close(); return result;
    } catch (error) { db.close(); fs.rmSync(file, { force: true }); throw error; }
  }

  async delete(id, expectedRevision) {
    const directory = this.vaultDirectory(id);
    if (!fs.existsSync(directory)) throw new NativeVaultError('vault_not_found', 'Vault not found.');
    if (expectedRevision !== undefined) {
      const current = await this.get(id);
      if (safeRevision(expectedRevision) !== current.revision) throw new NativeVaultError('revision_conflict', 'The vault changed since it was read.', { currentRevision: current.revision });
    }
    fs.rmSync(directory, { recursive: true, force: false });
    return { id, deleted: true };
  }

  async importFile(id, sourceFile, expectedRevision) {
    const current = await this.get(id); if (expectedRevision !== undefined && safeRevision(expectedRevision) !== current.revision) throw new NativeVaultError('revision_conflict', 'The vault changed since it was read.', { currentRevision: current.revision });
    const incoming = path.resolve(String(sourceFile));
    if (!fs.existsSync(incoming) || !fs.statSync(incoming).isFile()) throw new NativeVaultError('invalid_import', 'The import file does not exist.');
    const staged = `${this.databasePath(id)}.import-${process.pid}-${randomUUID()}`;
    try {
      fs.copyFileSync(incoming, staged); fs.chmodSync(staged, 0o600);
      // Run the canonical migrations on the staged copy before it can become
      // authoritative. This also rejects non-SQLite input without touching the
      // current vault.
      const migrated = await this._migrate(staged); const db = migrated.db;
      try {
        const metadata = this._metadataFromDb(db);
        if (!metadata || metadata.id !== id) throw new NativeVaultError('invalid_import', 'The import does not belong to this vault.');
        const timestamp = nowIso();
        db.prepare(`UPDATE server_native_metadata SET
          storage_kind=?, authority_mode=?, schema_version=?, revision=?, initialization_state='ready',
          vault_id=?, name=?, description=?, vault_type=?, created_at=?, updated_at=? WHERE id=1`)
          .run(NATIVE_STORAGE_KIND, SERVER_AUTHORITY_MODE, migrated.schemaVersion, current.revision + 1,
            current.id, current.name, current.description, current.vaultType, current.createdAt, timestamp);
        try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
      } finally { db.close(); }
      for (const sidecar of [`${staged}-wal`, `${staged}-shm`]) fs.rmSync(sidecar, { force: true });
      const target = this.databasePath(id); const backup = `${target}.before-import-${process.pid}-${randomUUID()}`;
      try {
        fs.renameSync(target, backup);
      } catch (error) {
        fs.rmSync(staged, { force: true });
        throw error;
      }
      try {
        fs.renameSync(staged, target);
      } catch (error) {
        try { if (fs.existsSync(backup) && !fs.existsSync(target)) fs.renameSync(backup, target); } catch {}
        throw error;
      }
      // A cleanup failure should not turn a successful, durable import into an
      // error response. The backup is only needed during the swap itself.
      try { fs.rmSync(backup, { force: true }); } catch {}
      return this.get(id);
    } catch (error) { fs.rmSync(staged, { force: true }); throw error; }
  }

  async exportFile(id) {
    await this.get(id); const db = await this._open(id); try { db.pragma('wal_checkpoint(TRUNCATE)'); } finally { db.close(); }
    return fs.readFileSync(this.databasePath(id));
  }

  async contentContract(id, vaultType) {
    const db = await this._open(id, { readonly: true });
    try {
      const tables = {};
      // Include read-only projections in the advertised contract as well.  These
      // tables are needed by browser-capable database analysis, but deliberately
      // never enter NATIVE_CONTENT_KEYS (and therefore can never be mutated by
      // the generic endpoint).  Keeping them visible here lets a client choose a
      // safe read path without guessing that the table exists.
      const contractEntries = [
        ...Object.entries(NATIVE_CONTENT_KEYS).map(([table, key]) => [table, key, false]),
        ...Object.entries(NATIVE_READONLY_CONTENT_KEYS).map(([table, key]) => [table, key, true]),
      ];
      for (const [table, key, readOnly] of contractEntries) {
        if (!contentTablePolicy(vaultType, table, readOnly ? 'read' : 'write') || !SAFE_IDENTIFIER.test(table)) continue;
        const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
        if (!exists) continue;
        const columns = db.prepare(`PRAGMA table_info(${table})`).all()
          .filter((column) => String(column.type || '').toUpperCase() !== 'BLOB')
          .map((column) => String(column.name)).filter((column) => SAFE_IDENTIFIER.test(column) && !PRIVATE_COLUMN.test(column) && (!OWNER_COLUMN.test(column) || NATIVE_PRIVATE_WRITABLE_COLUMNS[table]?.includes(column)) && !NON_PORTABLE_COLUMN.test(column));
        const safeKey = key.map((column) => String(typeof column === 'object' ? column : column));
        if (safeKey.every((column) => columns.includes(column))) tables[table] = { key: safeKey, columns, ...(readOnly ? { readOnly: true } : {}) };
      }
      const metadata = this._metadataFromDb(db);
      return { schemaVersion: metadata?.schemaVersion || 0, revision: metadata?.revision || 0, tables };
    } finally { db.close(); }
  }

  _contentDefinition(db, table, vaultType, mode = 'write') {
    const cleanTable = String(table || '');
    if (!SAFE_IDENTIFIER.test(cleanTable) || !contentTablePolicy(vaultType, cleanTable, mode)) throw new NativeVaultError('content_table_denied', 'This content table is not available in Server authoring.');
    const definition = NATIVE_CONTENT_KEYS[cleanTable] || NATIVE_READONLY_CONTENT_KEYS[cleanTable];
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(cleanTable);
    if (!definition || !exists) throw new NativeVaultError('content_table_not_found', 'This content table does not exist in the canonical vault schema.');
    const columns = db.prepare(`PRAGMA table_info(${cleanTable})`).all().map((column) => String(column.name));
    const key = definition.map((column) => String(typeof column === 'object' ? column : column));
    if (key.some((column) => !columns.includes(column))) throw new NativeVaultError('content_schema_mismatch', 'The canonical table key is not available in this vault schema.');
    const columnInfo = db.prepare(`PRAGMA table_info(${cleanTable})`).all();
    const writable = columnInfo.filter((column) => String(column.type || '').toUpperCase() !== 'BLOB').map((column) => String(column.name))
      .filter((column) => SAFE_IDENTIFIER.test(column) && !PRIVATE_COLUMN.test(column) && (!OWNER_COLUMN.test(column) || NATIVE_PRIVATE_WRITABLE_COLUMNS[cleanTable]?.includes(column)) && !NON_PORTABLE_COLUMN.test(column));
    const listColumns = (NATIVE_MINIMAL_LIST_COLUMNS[cleanTable] || writable).filter((column) => writable.includes(column));
    return { table: cleanTable, key, columns, writable, listColumns };
  }

  _safeContentRow(row, definition, minimal = false) {
    const allowed = minimal ? definition.listColumns : definition.writable;
    return Object.fromEntries(Object.entries(row || {}).filter(([column, value]) => allowed.includes(column) && !PRIVATE_COLUMN.test(column) && !NON_PORTABLE_COLUMN.test(column)
      && (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')));
  }

  _contentWhere(definition, keyValues) {
    const values = definition.key.map((column) => keyValues[column]);
    if (values.some((value) => value === undefined || value === null || (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean'))) throw new NativeVaultError('invalid_content_key', 'A complete content key is required.');
    return { sql: definition.key.map((column) => `${column}=?`).join(' AND '), values };
  }

  async listContent(id, table, vaultType, options = {}) {
    const limit = Math.max(1, Math.min(200, Math.trunc(Number(options.limit) || 100)));
    const offset = Math.max(0, Math.trunc(Number(options.offset) || 0));
    const db = await this._open(id, { readonly: true });
    try {
      const definition = this._contentDefinition(db, table, vaultType, 'read');
      const info = db.prepare(`PRAGMA table_info(${definition.table})`).all();
      const selected = definition.listColumns;
      const searchable = info.filter((column) => selected.includes(String(column.name)) && ['TEXT', ''].includes(String(column.type || '').toUpperCase())).map((column) => String(column.name)).slice(0, 8);
      const query = String(options.q || '').trim().slice(0, 200);
      let where = ''; let values = [];
      const databaseId = String(options.database_id || '');
      if (databaseId && selected.includes('database_id')) { where = ' WHERE database_id = ?'; values = [databaseId]; }
      if (query && searchable.length) {
        const tokens = query.split(/\s+/).filter(Boolean).slice(0, 8);
        const searchWhere = tokens.map(() => `(${searchable.map((column) => `${column} LIKE ?`).join(' OR ')})`).join(' AND ');
        where = where ? `${where} AND ${searchWhere}` : ` WHERE ${searchWhere}`;
        values.push(...tokens.flatMap((token) => searchable.map(() => `%${token}%`)));
      }
      const orderColumn = selected.includes('updated_at') ? 'updated_at' : definition.key[0];
      const rows = db.prepare(`SELECT ${selected.join(',')} FROM ${definition.table}${where} ORDER BY ${orderColumn} DESC LIMIT ? OFFSET ?`).all(...values, limit, offset)
        .map((row) => this._safeContentRow(row, definition, true));
      const count = db.prepare(`SELECT COUNT(*) AS count FROM ${definition.table}${where}`).get(...values);
      const metadata = this._metadataFromDb(db);
      return { table: definition.table, rows, items: rows, total: Number(count?.count || 0), limit, offset, hasMore: offset + rows.length < Number(count?.count || 0), revision: metadata?.revision || 0 };
    } finally { db.close(); }
  }

  /**
   * Read-only database workbench projection for Server Web.  The Desktop
   * analysis view needs the normalized columns/cells plus safe attachment and
   * relation metadata, not merely the paginated `db_databases` catalogue.  Keep
   * this projection here so native vaults and published snapshots share the
   * same shape without exposing BLOB bytes or local paths.
   */
  async databaseAnalysis(id, vaultType, databaseId) {
    const db = await this._open(id, { readonly: true });
    try {
      const definition = this._contentDefinition(db, 'db_databases', vaultType, 'read');
      const dbWhere = this._contentWhere(definition, { id: databaseId });
      const database = db.prepare(`SELECT ${definition.writable.join(',')} FROM db_databases WHERE ${dbWhere.sql}`).get(...dbWhere.values);
      if (!database) throw new NativeVaultError('content_not_found', 'The database does not exist.');
      const metadata = this._metadataFromDb(db);
      const read = (table, where = '', values = [], order = '') => {
        const next = this._contentDefinition(db, table, vaultType, 'read');
        return db.prepare(`SELECT ${next.writable.join(',')} FROM ${next.table}${where}${order ? ` ORDER BY ${order}` : ''}`).all(...values)
          .map((row) => this._safeContentRow(row, next));
      };
      const columns = read('db_columns', ' WHERE database_id=?', [databaseId], 'position, id');
      const columnIds = new Set(columns.map((column) => String(column.id)));
      const options = read('db_select_options', '', [], 'position, id').filter((option) => columnIds.has(String(option.column_id)));
      const databaseRows = read('db_rows', ' WHERE database_id=?', [databaseId], 'position, id');
      const rowIds = databaseRows.map((row) => String(row.id));
      const inClause = rowIds.length ? ` WHERE row_id IN (${rowIds.map(() => '?').join(',')})` : ' WHERE 0';
      const cells = read('db_cells', inClause, rowIds);
      const computed = read('db_computed_cells', inClause, rowIds);
      const attachments = read('db_attachments', inClause, rowIds).map((row) => ({ ...row, has_blob: Boolean(row.blob_hash || row.has_blob) }));
      const relations = read('db_relations', inClause, rowIds);
      const views = read('db_views', ' WHERE database_id=?', [databaseId], 'position, id');
      const cellValue = (row) => row.value_text ?? row.value_json ?? row.value_reference ?? row.value_date ?? row.value_number ?? row.value_integer ?? null;
      const cellsByRow = new Map();
      for (const row of [...cells, ...computed]) {
        const values = cellsByRow.get(String(row.row_id)) || {};
        values[String(row.column_id)] = cellValue(row);
        cellsByRow.set(String(row.row_id), values);
      }
      const attachmentsByRow = new Map();
      for (const row of attachments) {
        const values = attachmentsByRow.get(String(row.row_id)) || {};
        const column = String(row.column_id);
        (values[column] ||= []).push({
          id: row.id, rowId: row.row_id, columnId: row.column_id, fileName: row.file_name ?? null,
          mimeType: row.mime_type ?? null, bytes: Number(row.bytes) || 0, hasBlob: Boolean(row.has_blob),
          contentHash: row.content_hash ?? null, description: row.description ?? null,
          aiGenerated: Boolean(row.ai_generated), position: Number(row.position) || 0, createdAt: row.created_at ?? null,
        });
        attachmentsByRow.set(String(row.row_id), values);
      }
      const relationCountsByRow = new Map();
      for (const row of relations) {
        const values = relationCountsByRow.get(String(row.row_id)) || {};
        const column = String(row.column_id); values[column] = (values[column] || 0) + 1;
        relationCountsByRow.set(String(row.row_id), values);
      }
      return {
        database: this._safeContentRow(database, definition),
        columns: columns.map((column) => ({
          ...column, databaseId: column.database_id, config: (() => { try { return JSON.parse(String(column.config_json || '{}')); } catch { return {}; } })(),
          options: options.filter((option) => String(option.column_id) === String(column.id)).map((option) => ({ id: option.id, label: option.label, color: option.color ?? null, position: option.position, group: option.group_key ?? null })),
        })),
        rows: databaseRows.map((row) => ({
          id: row.id, databaseId, position: Number(row.position) || 0, cells: cellsByRow.get(String(row.id)) || {},
          attachments: attachmentsByRow.get(String(row.id)) || {}, relationCounts: relationCountsByRow.get(String(row.id)) || {},
          createdAt: row.created_at ?? null, updatedAt: row.updated_at ?? null,
        })),
        views: views.map((view) => ({ ...view, databaseId: view.database_id, filter: (() => { try { return JSON.parse(String(view.filter_json || 'null')); } catch { return null; } })(), sort: (() => { try { return JSON.parse(String(view.sort_json || 'null')); } catch { return null; } })() })),
        total: databaseRows.length, revision: metadata?.revision || 0,
      };
    } finally { db.close(); }
  }

  async getContent(id, table, vaultType, keyValues) {
    const db = await this._open(id, { readonly: true });
    try {
      const definition = this._contentDefinition(db, table, vaultType, 'read'); const where = this._contentWhere(definition, keyValues);
      const row = db.prepare(`SELECT ${definition.writable.join(',')} FROM ${definition.table} WHERE ${where.sql}`).get(...where.values);
      if (!row) return null;
      const metadata = this._metadataFromDb(db);
      return { table: definition.table, row: this._safeContentRow(row, definition), revision: metadata?.revision || 0 };
    } finally { db.close(); }
  }

  async mutateContent(id, table, vaultType, operation, input = {}, actorUserId) {
    if (!['create', 'update', 'delete'].includes(operation)) throw new NativeVaultError('invalid_content_operation', 'Unsupported content operation.');
    const key = String(input.idempotencyKey || '');
    if (!COMMAND_ID.test(key)) throw new NativeVaultError('invalid_idempotency_key', 'A safe idempotencyKey is required.');
    const db = await this._open(id);
    try {
      const transact = db.transaction(() => {
      const definition = this._contentDefinition(db, table, vaultType);
      const expectedRevision = safeRevision(input.expectedRevision);
      const schemaVersion = Number(input.schemaVersion || 1);
      if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) throw new NativeVaultError('invalid_schema_version', 'schemaVersion must be a positive integer.');
      db.exec(`CREATE TABLE IF NOT EXISTS server_native_commands (
        id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
        schema_version INTEGER NOT NULL, expected_revision INTEGER NOT NULL, payload_json TEXT NOT NULL,
        actor_user_id TEXT, status TEXT NOT NULL, result_json TEXT, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`);
      const payload = { table: definition.table, operation, key: input.key || null, row: input.row || null };
      const payloadJson = JSON.stringify(payload);
      const commandTableExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='server_native_commands'").get();
      const duplicate = commandTableExists ? db.prepare('SELECT * FROM server_native_commands WHERE idempotency_key=?').get(key) : null;
      if (duplicate) {
        if (duplicate.payload_json !== payloadJson || Number(duplicate.expected_revision) !== expectedRevision) throw new NativeVaultError('idempotency_conflict', 'That idempotency key was already used for another content mutation.');
        const result = duplicate.result_json ? JSON.parse(duplicate.result_json) : null;
        return { ...(result || {}), command: this._commandView(duplicate), duplicate: true };
      }
      const metadata = this._metadataFromDb(db);
      if (!metadata || metadata.revision !== expectedRevision) throw new NativeVaultError('revision_conflict', 'The vault changed since it was read.', { currentRevision: metadata?.revision ?? 0 });
      const keyInput = input.key && typeof input.key === 'object' && !Array.isArray(input.key) ? input.key : {};
      const rowInput = input.row && typeof input.row === 'object' && !Array.isArray(input.row) ? input.row : {};
      const keyValues = { ...keyInput, ...Object.fromEntries(definition.key.map((column) => [column, rowInput[column] ?? keyInput[column]])) };
      const where = this._contentWhere(definition, keyValues);
      const cleanRow = this._safeContentRow(rowInput, definition);
      for (const column of Object.keys(rowInput)) if (!definition.writable.includes(column)) throw new NativeVaultError('content_column_denied', `Column ${column} is not writable through this contract.`);
      for (const [column, value] of Object.entries(rowInput)) {
        if (definition.writable.includes(column) && value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
          throw new NativeVaultError('content_value_invalid', `Column ${column} must be a scalar value.`);
        }
      }
      // SQLite remains the final authority for constraints/FKs, but reject malformed JSON
      // and absent required fields before touching the domain row so clients get an
      // actionable contract error. Timestamps are canonicalized exactly as Desktop repos do.
      const columnInfo = db.prepare(`PRAGMA table_info(${definition.table})`).all();
      for (const [column, value] of Object.entries(cleanRow)) {
        if (column.endsWith('_json') && value !== null && String(value) !== '') {
          try { JSON.parse(String(value)); } catch { throw new NativeVaultError('invalid_json_column', `Column ${column} must contain valid JSON.`); }
        }
      }
      let current;
      let updates = {};
      if (operation === 'create') {
        const timestamp = nowIso();
        for (const column of ['created_at', 'updated_at']) if (definition.writable.includes(column) && cleanRow[column] === undefined) cleanRow[column] = timestamp;
        for (const column of columnInfo.filter((entry) => Number(entry.notnull) === 1 && entry.dflt_value === null && Number(entry.pk) === 0).map((entry) => String(entry.name))) {
          if (cleanRow[column] === undefined) throw new NativeVaultError('missing_required_column', `Column ${column} is required.`);
        }
      }
      if (operation === 'create') {
        for (const column of definition.key) if (cleanRow[column] === undefined && keyValues[column] !== undefined) cleanRow[column] = keyValues[column];
        for (const column of definition.key) if (cleanRow[column] === undefined) throw new NativeVaultError('invalid_content_key', 'Create requires every key column.');
        const columns = Object.keys(cleanRow); const placeholders = columns.map(() => '?').join(',');
        const insert = db instanceof CliDatabase
          ? `INSERT INTO ${definition.table} (${columns.join(',')}) SELECT ${placeholders} WHERE (SELECT revision FROM server_native_metadata WHERE id=1)=?`
          : `INSERT INTO ${definition.table} (${columns.join(',')}) VALUES (${placeholders})`;
        db.prepare(insert).run(...columns.map((column) => cleanRow[column]), ...(db instanceof CliDatabase ? [expectedRevision] : []));
      } else if (operation === 'update') {
        current = db.prepare(`SELECT ${definition.writable.join(',')} FROM ${definition.table} WHERE ${where.sql}`).get(...where.values);
        if (!current) throw new NativeVaultError('content_not_found', 'The content record does not exist.');
        updates = Object.fromEntries(Object.entries(cleanRow).filter(([column]) => !definition.key.includes(column)));
        const columns = Object.keys(updates);
        if (!columns.length) throw new NativeVaultError('empty_content_update', 'An update must include at least one writable field.');
        const guard = db instanceof CliDatabase ? ` AND (SELECT revision FROM server_native_metadata WHERE id=1)=${expectedRevision}` : '';
        db.prepare(`UPDATE ${definition.table} SET ${columns.map((column) => `${column}=?`).join(',')} WHERE ${where.sql}${guard}`).run(...columns.map((column) => updates[column]), ...where.values);
      } else {
        current = db.prepare(`SELECT ${definition.writable.join(',')} FROM ${definition.table} WHERE ${where.sql}`).get(...where.values);
        if (!current) throw new NativeVaultError('content_not_found', 'The content record does not exist.');
        const guard = db instanceof CliDatabase ? ` AND (SELECT revision FROM server_native_metadata WHERE id=1)=${expectedRevision}` : '';
        db.prepare(`DELETE FROM ${definition.table} WHERE ${where.sql}${guard}`).run(...where.values);
      }
      const revision = metadata.revision + 1; const updatedAt = nowIso();
      const metadataUpdate = db instanceof CliDatabase
        ? 'UPDATE server_native_metadata SET revision=?, updated_at=? WHERE id=1 AND revision=?'
        : 'UPDATE server_native_metadata SET revision=?, updated_at=? WHERE id=1';
      db.prepare(metadataUpdate).run(revision, updatedAt, ...(db instanceof CliDatabase ? [expectedRevision] : []));
      // The CLI fallback queues writes until the single transactional script is
      // submitted, so it cannot observe its own uncommitted SELECT. Reconstruct
      // the deterministic result from the validated input; better-sqlite3 uses a
      // normal in-connection SELECT for parity.
      const resulting = operation === 'delete' ? null : db instanceof CliDatabase
        ? (operation === 'create' ? cleanRow : { ...current, ...updates })
        : db.prepare(`SELECT ${definition.writable.join(',')} FROM ${definition.table} WHERE ${where.sql}`).get(...where.values);
      const result = { table: definition.table, operation, row: resulting ? this._safeContentRow(resulting, definition) : null, revision };
      const timestamp = nowIso(); const commandId = `content_${randomUUID()}`;
      if (db instanceof CliDatabase) {
        db.prepare(`INSERT INTO server_native_commands
          (id,idempotency_key,kind,schema_version,expected_revision,payload_json,actor_user_id,status,result_json,created_at,updated_at)
          SELECT ?,?,?,?,?,?,?, 'applied',?,?,? WHERE (SELECT revision FROM server_native_metadata WHERE id=1)=?`)
          .run(commandId, key, `content.${operation}`, schemaVersion, expectedRevision, payloadJson, actorUserId || null, JSON.stringify(result), timestamp, timestamp, revision);
      } else {
        db.prepare(`INSERT INTO server_native_commands
          (id,idempotency_key,kind,schema_version,expected_revision,payload_json,actor_user_id,status,result_json,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,'applied',?,?,?)`).run(commandId, key, `content.${operation}`, schemaVersion, expectedRevision, payloadJson, actorUserId || null, JSON.stringify(result), timestamp, timestamp);
      }
      return { result, commandId, duplicate: false };
      });
      const applied = transact();
      if (applied.duplicate) return applied;
      if (db instanceof CliDatabase) {
        const after = this._metadataFromDb(db);
        if (!after || after.revision !== safeRevision(input.expectedRevision) + 1) {
          throw new NativeVaultError('revision_conflict', 'The vault changed while this content mutation was being applied.', { currentRevision: after?.revision ?? 0 });
        }
      }
      const after = this._metadataFromDb(db);
      const definition = this._contentDefinition(db, table, vaultType);
      const keyInput = input.key && typeof input.key === 'object' && !Array.isArray(input.key) ? input.key : {};
      const rowInput = input.row && typeof input.row === 'object' && !Array.isArray(input.row) ? input.row : {};
      const keyValues = { ...keyInput, ...Object.fromEntries(definition.key.map((column) => [column, rowInput[column] ?? keyInput[column]])) };
      const where = this._contentWhere(definition, keyValues);
      const row = operation === 'delete' ? null : db.prepare(`SELECT ${definition.writable.join(',')} FROM ${definition.table} WHERE ${where.sql}`).get(...where.values);
      const result = { ...applied.result, row: row ? this._safeContentRow(row, definition) : null, revision: after?.revision ?? applied.result.revision };
      const command = db.prepare('SELECT * FROM server_native_commands WHERE id=?').get(applied.commandId);
      return { ...result, command: this._commandView(command), duplicate: false };
    } catch (error) {
      if (error instanceof NativeVaultError) throw error;
      throw new NativeVaultError('content_constraint', 'The content row violates the canonical SQLite schema.');
    } finally { db.close(); }
  }

  async createCommand(id, input = {}, actorUserId) {
    const current = await this.get(id);
    const kind = String(input.kind || ''); const key = String(input.idempotencyKey || '');
    const commandId = String(input.id || `cmd_${randomUUID()}`);
    if (!COMMAND_ID.test(kind) || !COMMAND_ID.test(key) || !COMMAND_ID.test(commandId)) throw new NativeVaultError('invalid_command', 'Command kind, id and idempotencyKey must be safe identifiers.');
    if (input.payload == null || typeof input.payload !== 'object' || Array.isArray(input.payload)) throw new NativeVaultError('invalid_payload', 'Command payload must be an object.');
    const expectedRevision = safeRevision(input.expectedRevision);
    if (expectedRevision !== current.revision) throw new NativeVaultError('revision_conflict', 'The vault changed since it was read.', { currentRevision: current.revision });
    const db = await this._open(id);
    try {
      this._ensureMetadataTable(db);
      db.exec(`CREATE TABLE IF NOT EXISTS server_native_commands (
        id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
        schema_version INTEGER NOT NULL, expected_revision INTEGER NOT NULL, payload_json TEXT NOT NULL,
        actor_user_id TEXT, status TEXT NOT NULL, result_json TEXT, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`);
      const duplicate = db.prepare('SELECT * FROM server_native_commands WHERE idempotency_key=?').get(key);
      const payloadJson = JSON.stringify(input.payload);
      if (duplicate) {
        if (duplicate.kind !== kind || duplicate.payload_json !== payloadJson || Number(duplicate.schema_version) !== Number(input.schemaVersion || 1) || Number(duplicate.expected_revision) !== expectedRevision) throw new NativeVaultError('idempotency_conflict', 'That idempotency key was already used for another command.');
        return { ...this._commandView(duplicate), duplicate: true };
      }
      const timestamp = nowIso(); const schemaVersion = Number(input.schemaVersion || 1);
      if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) throw new NativeVaultError('invalid_schema_version', 'schemaVersion must be a positive integer.');
      db.prepare(`INSERT INTO server_native_commands
        (id,idempotency_key,kind,schema_version,expected_revision,payload_json,actor_user_id,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'queued',?,?)`).run(commandId, key, kind, schemaVersion, expectedRevision, payloadJson, actorUserId || null, timestamp, timestamp);
      return { ...this._commandView(db.prepare('SELECT * FROM server_native_commands WHERE id=?').get(commandId)), duplicate: false };
    } finally { db.close(); }
  }

  async listCommands(id) {
    const db = await this._open(id, { readonly: true });
    try {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='server_native_commands'").get()) return [];
      return db.prepare('SELECT * FROM server_native_commands ORDER BY created_at, id').all().map((row) => this._commandView(row));
    } finally { db.close(); }
  }

  async getCommand(id, commandId) {
    const cleanCommandId = String(commandId || '');
    if (!COMMAND_ID.test(cleanCommandId)) throw new NativeVaultError('invalid_command', 'Invalid command id.');
    const db = await this._open(id, { readonly: true });
    try {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='server_native_commands'").get()) return null;
      const row = db.prepare('SELECT * FROM server_native_commands WHERE id=?').get(cleanCommandId);
      return row ? this._commandView(row) : null;
    } finally { db.close(); }
  }

  _commandView(row) {
    return { id: row.id, idempotencyKey: row.idempotency_key, kind: row.kind, schemaVersion: Number(row.schema_version), expectedRevision: Number(row.expected_revision), payload: JSON.parse(row.payload_json), actorUserId: row.actor_user_id, status: row.status, result: row.result_json ? JSON.parse(row.result_json) : null, createdAt: row.created_at, updatedAt: row.updated_at };
  }
}
