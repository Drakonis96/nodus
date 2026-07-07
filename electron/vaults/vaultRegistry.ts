import Database from 'better-sqlite3';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { VaultDataImportResult, VaultSummary } from '@shared/types';
import { runMigrations } from '../db/migrations';

interface VaultRecord {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
  legacy: boolean;
}

interface VaultRegistryFile {
  formatVersion: 1;
  activeVaultId: string;
  vaults: VaultRecord[];
}

const REGISTRY_FILE = 'vaults.json';
const LEGACY_VAULT_ID = 'default';
const IMPORT_CONTENT_TABLES = [
  'works',
  'work_aliases',
  'themes',
  'work_themes',
  'ideas',
  'idea_occurrences',
  'evidence',
  'edges',
  'authors',
  'author_relations',
  'work_authors',
  'gaps',
  'external_refs',
  'extraction_cache',
  'idea_theme_links',
  'chat_conversations',
  'chat_messages',
  'tutor_saved_routes',
  'scan_checkpoints',
  'edge_traces',
  'zotero_tags',
  'work_zotero_tags',
  'work_summaries',
  'collections',
  'work_collections',
  'research_questions',
  'research_subquestions',
  'research_coverage_links',
  'passages',
  'writing_saved_drafts',
  'note_folders',
  'notes',
  'projects',
  'project_sections',
  'project_links',
  'project_chapters',
  'project_chapter_chunks',
  'project_insertion_suggestions',
  'project_chapter_versions',
  'saved_searches',
  'project_chapter_ideas',
  'project_chapter_idea_relations',
  'author_dossier_synthesis',
  'synthesis_matrix_cell',
  'study_progress',
  'work_idea_synthesis',
];

function userDataDir(): string {
  return app.getPath('userData');
}

function registryPath(): string {
  return path.join(userDataDir(), REGISTRY_FILE);
}

function legacyDbPath(): string {
  return path.join(userDataDir(), 'nodus.sqlite');
}

function vaultsDir(): string {
  return path.join(userDataDir(), 'vaults');
}

function nowIso(): string {
  return new Date().toISOString();
}

function cleanName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  return trimmed || 'Nueva bóveda';
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function defaultVaultRecord(): VaultRecord {
  const now = nowIso();
  return {
    id: LEGACY_VAULT_ID,
    name: 'Principal',
    path: legacyDbPath(),
    createdAt: now,
    lastOpenedAt: now,
    legacy: true,
  };
}

function writeRegistry(registry: VaultRegistryFile): VaultRegistryFile {
  fs.mkdirSync(userDataDir(), { recursive: true });
  fs.writeFileSync(registryPath(), JSON.stringify(registry, null, 2), 'utf8');
  return registry;
}

function normalizeRegistry(input: VaultRegistryFile): VaultRegistryFile {
  const seen = new Set<string>();
  const vaults = input.vaults
    .filter((vault) => vault && typeof vault.id === 'string' && typeof vault.path === 'string')
    .map((vault) => ({
      id: vault.id,
      name: cleanName(vault.name || 'Nueva bóveda'),
      path: path.resolve(vault.path),
      createdAt: vault.createdAt || nowIso(),
      lastOpenedAt: vault.lastOpenedAt || vault.createdAt || nowIso(),
      legacy: Boolean(vault.legacy),
    }))
    .filter((vault) => {
      if (seen.has(vault.id)) return false;
      seen.add(vault.id);
      return true;
    });

  if (!vaults.some((vault) => vault.id === LEGACY_VAULT_ID)) {
    vaults.unshift(defaultVaultRecord());
  }

  const activeVaultId = vaults.some((vault) => vault.id === input.activeVaultId)
    ? input.activeVaultId
    : LEGACY_VAULT_ID;

  return { formatVersion: 1, activeVaultId, vaults };
}

export function ensureVaultRegistry(): VaultRegistryFile {
  fs.mkdirSync(userDataDir(), { recursive: true });
  const file = registryPath();
  if (!fs.existsSync(file)) {
    return writeRegistry({
      formatVersion: 1,
      activeVaultId: LEGACY_VAULT_ID,
      vaults: [defaultVaultRecord()],
    });
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as VaultRegistryFile;
    const normalized = normalizeRegistry(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) writeRegistry(normalized);
    return normalized;
  } catch {
    return writeRegistry({
      formatVersion: 1,
      activeVaultId: LEGACY_VAULT_ID,
      vaults: [defaultVaultRecord()],
    });
  }
}

function writeVaultManifest(vault: VaultRecord): void {
  if (vault.legacy) return;
  const dir = path.dirname(vault.path);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(
      {
        id: vault.id,
        name: vault.name,
        createdAt: vault.createdAt,
        lastOpenedAt: vault.lastOpenedAt,
        database: path.basename(vault.path),
      },
      null,
      2
    ),
    'utf8'
  );
}

function initializeDatabase(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  try {
    runMigrations(db);
  } finally {
    db.close();
  }
}

function removeSqliteDatabaseFiles(file: string): void {
  for (const candidate of [file, `${file}-wal`, `${file}-shm`]) {
    fs.rmSync(candidate, { force: true });
  }
}

function openInitializedDatabase(file: string): Database.Database {
  initializeDatabase(file);
  const db = new Database(file);
  runMigrations(db);
  return db;
}

function toSummary(vault: VaultRecord, activeVaultId: string): VaultSummary {
  return {
    id: vault.id,
    name: vault.name,
    path: vault.path,
    createdAt: vault.createdAt,
    lastOpenedAt: vault.lastOpenedAt,
    active: vault.id === activeVaultId,
    legacy: vault.legacy,
    apiKeyProviders: [],
  };
}

export function listVaults(): VaultSummary[] {
  const registry = ensureVaultRegistry();
  return registry.vaults.map((vault) => toSummary(vault, registry.activeVaultId));
}

export function getActiveVault(): VaultSummary {
  const registry = ensureVaultRegistry();
  const vault = registry.vaults.find((candidate) => candidate.id === registry.activeVaultId) ?? registry.vaults[0];
  return toSummary(vault, registry.activeVaultId);
}

export function getVault(id: string): VaultSummary | null {
  const registry = ensureVaultRegistry();
  const vault = registry.vaults.find((candidate) => candidate.id === id);
  return vault ? toSummary(vault, registry.activeVaultId) : null;
}

export function activeVaultDbPath(): string {
  return getActiveVault().path;
}

export function activeVaultDir(): string {
  return path.dirname(activeVaultDbPath());
}

export function vaultDir(vaultId: string): string | null {
  const vault = getVault(vaultId);
  return vault ? path.dirname(vault.path) : null;
}

export function createVault(name: string): VaultSummary {
  const registry = ensureVaultRegistry();
  const id = randomUUID();
  const createdAt = nowIso();
  const dir = path.join(vaultsDir(), id);
  const vault: VaultRecord = {
    id,
    name: cleanName(name),
    path: path.join(dir, 'nodus.sqlite'),
    createdAt,
    lastOpenedAt: createdAt,
    legacy: false,
  };
  initializeDatabase(vault.path);
  writeVaultManifest(vault);
  registry.vaults.push(vault);
  writeRegistry(registry);
  return toSummary(vault, registry.activeVaultId);
}

export function createVaultFromDatabaseFile(sourceFile: string, name: string): VaultSummary {
  const registry = ensureVaultRegistry();
  const id = randomUUID();
  const createdAt = nowIso();
  const dir = path.join(vaultsDir(), id);
  const vault: VaultRecord = {
    id,
    name: cleanName(name),
    path: path.join(dir, 'nodus.sqlite'),
    createdAt,
    lastOpenedAt: createdAt,
    legacy: false,
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(sourceFile, vault.path);
  initializeDatabase(vault.path);
  writeVaultManifest(vault);
  registry.vaults.push(vault);
  writeRegistry(registry);
  return toSummary(vault, registry.activeVaultId);
}

export function renameVault(id: string, name: string): VaultSummary {
  const registry = ensureVaultRegistry();
  const vault = registry.vaults.find((candidate) => candidate.id === id);
  if (!vault) throw new Error('Bóveda no encontrada.');
  vault.name = cleanName(name);
  writeVaultManifest(vault);
  writeRegistry(registry);
  return toSummary(vault, registry.activeVaultId);
}

export function setActiveVault(id: string): VaultSummary {
  const registry = ensureVaultRegistry();
  const vault = registry.vaults.find((candidate) => candidate.id === id);
  if (!vault) throw new Error('Bóveda no encontrada.');
  vault.lastOpenedAt = nowIso();
  registry.activeVaultId = id;
  writeVaultManifest(vault);
  writeRegistry(registry);
  return toSummary(vault, registry.activeVaultId);
}

export function deleteVault(id: string, deleteFiles: boolean): void {
  const registry = ensureVaultRegistry();
  if (id === registry.activeVaultId) throw new Error('No puedes borrar la bóveda activa.');
  const vault = registry.vaults.find((candidate) => candidate.id === id);
  if (!vault) return;
  if (vault.legacy) throw new Error('No puedes borrar la bóveda principal. Reinicialízala si quieres vaciarla.');
  registry.vaults = registry.vaults.filter((candidate) => candidate.id !== id);
  writeRegistry(registry);
  if (deleteFiles && !vault.legacy) {
    fs.rmSync(path.dirname(vault.path), { recursive: true, force: true });
  }
}

export function resetVaultDatabase(id: string): VaultSummary {
  const registry = ensureVaultRegistry();
  const vault = registry.vaults.find((candidate) => candidate.id === id);
  if (!vault) throw new Error('Bóveda no encontrada.');
  removeSqliteDatabaseFiles(vault.path);
  initializeDatabase(vault.path);
  vault.lastOpenedAt = nowIso();
  writeVaultManifest(vault);
  writeRegistry(registry);
  return toSummary(vault, registry.activeVaultId);
}

export function importVaultDataBetweenVaults(sourceVaultId: string, targetVaultId: string): VaultDataImportResult {
  if (sourceVaultId === targetVaultId) {
    throw new Error('Selecciona una bóveda de origen distinta.');
  }

  const registry = ensureVaultRegistry();
  const source = registry.vaults.find((candidate) => candidate.id === sourceVaultId);
  const target = registry.vaults.find((candidate) => candidate.id === targetVaultId);
  if (!source || !target) throw new Error('Bóveda no encontrada.');

  const sourceDb = openInitializedDatabase(source.path);
  sourceDb.close();

  const targetDb = openInitializedDatabase(target.path);
  const tableRows: Record<string, number> = {};
  let importedRows = 0;
  try {
    targetDb.prepare('ATTACH DATABASE ? AS source').run(source.path);
    targetDb.pragma('foreign_keys = OFF');

    const importTx = targetDb.transaction(() => {
      for (const table of IMPORT_CONTENT_TABLES) {
        const quoted = quoteIdentifier(table);
        targetDb.prepare(`INSERT OR IGNORE INTO main.${quoted} SELECT * FROM source.${quoted}`).run();
        const count = (targetDb.prepare('SELECT changes() AS count').get() as { count: number }).count;
        if (count > 0) {
          tableRows[table] = count;
          importedRows += count;
        }
      }

      targetDb
        .prepare(
          /* sql */ `
            UPDATE main.works
            SET
              light_status = CASE
                WHEN COALESCE(main.works.light_status, 'none') != 'done'
                  AND (SELECT s.light_status FROM source.works s WHERE s.nodus_id = main.works.nodus_id) = 'done'
                THEN 'done'
                ELSE main.works.light_status
              END,
              light_at = CASE
                WHEN main.works.light_at IS NULL
                THEN (SELECT s.light_at FROM source.works s WHERE s.nodus_id = main.works.nodus_id)
                ELSE main.works.light_at
              END,
              light_hash = CASE
                WHEN main.works.light_hash IS NULL
                THEN (SELECT s.light_hash FROM source.works s WHERE s.nodus_id = main.works.nodus_id)
                ELSE main.works.light_hash
              END,
              deep_status = CASE
                WHEN COALESCE(main.works.deep_status, 'none') != 'done'
                  AND (SELECT s.deep_status FROM source.works s WHERE s.nodus_id = main.works.nodus_id) = 'done'
                THEN 'done'
                ELSE main.works.deep_status
              END,
              deep_at = CASE
                WHEN main.works.deep_at IS NULL
                THEN (SELECT s.deep_at FROM source.works s WHERE s.nodus_id = main.works.nodus_id)
                ELSE main.works.deep_at
              END,
              deep_hash = CASE
                WHEN main.works.deep_hash IS NULL
                THEN (SELECT s.deep_hash FROM source.works s WHERE s.nodus_id = main.works.nodus_id)
                ELSE main.works.deep_hash
              END,
              summary_status = CASE
                WHEN COALESCE(main.works.summary_status, 'none') != 'done'
                  AND (SELECT s.summary_status FROM source.works s WHERE s.nodus_id = main.works.nodus_id) = 'done'
                THEN 'done'
                ELSE main.works.summary_status
              END,
              summary_at = CASE
                WHEN main.works.summary_at IS NULL
                THEN (SELECT s.summary_at FROM source.works s WHERE s.nodus_id = main.works.nodus_id)
                ELSE main.works.summary_at
              END,
              summary_hash = CASE
                WHEN main.works.summary_hash IS NULL
                THEN (SELECT s.summary_hash FROM source.works s WHERE s.nodus_id = main.works.nodus_id)
                ELSE main.works.summary_hash
              END,
              creators_json = CASE
                WHEN main.works.creators_json IS NULL
                THEN (SELECT s.creators_json FROM source.works s WHERE s.nodus_id = main.works.nodus_id)
                ELSE main.works.creators_json
              END
            WHERE EXISTS (SELECT 1 FROM source.works s WHERE s.nodus_id = main.works.nodus_id)
          `
        )
        .run();

      const fkIssues = targetDb.pragma('foreign_key_check') as unknown[];
      if (fkIssues.length > 0) {
        throw new Error('La importación dejó referencias internas inconsistentes y se ha cancelado.');
      }
    });

    importTx();
  } finally {
    targetDb.pragma('foreign_keys = ON');
    try {
      targetDb.prepare('DETACH DATABASE source').run();
    } catch {
      /* already detached or never attached */
    }
    targetDb.close();
  }

  return { importedRows, tableRows };
}

export function vaultExists(id: string): boolean {
  return getVault(id) !== null;
}
