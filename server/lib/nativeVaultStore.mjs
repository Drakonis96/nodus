import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { loadCanonicalMigrations } from './nativeMigrations.mjs';

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
  exec(sql) { execFileSync('sqlite3', [this.file], { input: `${sql}\n`, stdio: ['pipe', 'pipe', 'pipe'] }); }
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
  transaction(fn) { return fn; }
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
