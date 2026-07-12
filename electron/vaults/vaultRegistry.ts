import Database from 'better-sqlite3';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { VaultSummary, VaultType } from '@shared/types';
import { normalizeVaultType } from '@shared/vaultTypes';
import { runMigrations } from '../db/migrations';

interface VaultRecord {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
  legacy: boolean;
  type: VaultType;
}

interface VaultRegistryFile {
  formatVersion: 1;
  activeVaultId: string;
  vaults: VaultRecord[];
}

const REGISTRY_FILE = 'vaults.json';
const LEGACY_VAULT_ID = 'default';

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

function defaultVaultRecord(): VaultRecord {
  const now = nowIso();
  return {
    id: LEGACY_VAULT_ID,
    name: 'Principal',
    path: legacyDbPath(),
    createdAt: now,
    lastOpenedAt: now,
    legacy: true,
    type: 'academic',
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
      // Pre-existing vaults have no `type`; they default to academic.
      type: normalizeVaultType(vault.type),
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
        type: vault.type,
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

function toSummary(vault: VaultRecord, activeVaultId: string): VaultSummary {
  return {
    id: vault.id,
    name: vault.name,
    path: vault.path,
    createdAt: vault.createdAt,
    lastOpenedAt: vault.lastOpenedAt,
    active: vault.id === activeVaultId,
    legacy: vault.legacy,
    type: vault.type,
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

export function createVault(name: string, type: VaultType = 'academic'): VaultSummary {
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
    type: normalizeVaultType(type),
  };
  initializeDatabase(vault.path);
  writeVaultManifest(vault);
  registry.vaults.push(vault);
  writeRegistry(registry);
  return toSummary(vault, registry.activeVaultId);
}

/**
 * Restore a vault's database from a backup, KEYED BY ITS ORIGINAL ID. If a vault with
 * that id already exists locally its database file is replaced in place; otherwise the
 * vault is registered (recreating the folder for a non-legacy vault, or the legacy
 * path for the primary one). The copied file's stale WAL/SHM siblings are cleared so
 * SQLite never replays an old journal over the restored data. Migrations run lazily
 * when the vault is next opened. Does NOT touch the live DB connection — the caller
 * must closeDb() before restoring the active vault and reopen afterwards.
 */
export function restoreVaultDatabase(
  input: { id: string; name: string; type: VaultType; legacy: boolean },
  sourceFile: string
): void {
  const registry = ensureVaultRegistry();
  let record = registry.vaults.find((v) => v.id === input.id);
  if (record) {
    record.name = cleanName(input.name);
    record.type = normalizeVaultType(input.type);
    record.lastOpenedAt = nowIso();
  } else {
    const legacy = input.legacy || input.id === LEGACY_VAULT_ID;
    const target = legacy ? legacyDbPath() : path.join(vaultsDir(), input.id, 'nodus.sqlite');
    record = {
      id: input.id,
      name: cleanName(input.name),
      path: target,
      createdAt: nowIso(),
      lastOpenedAt: nowIso(),
      legacy,
      type: normalizeVaultType(input.type),
    };
    registry.vaults.push(record);
  }
  fs.mkdirSync(path.dirname(record.path), { recursive: true });
  removeSqliteDatabaseFiles(record.path);
  fs.copyFileSync(sourceFile, record.path);
  writeVaultManifest(record);
  writeRegistry(registry);
}

export function createVaultFromDatabaseFile(
  sourceFile: string,
  name: string,
  type: VaultType = 'academic'
): VaultSummary {
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
    type: normalizeVaultType(type),
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

export function setVaultType(id: string, type: VaultType): VaultSummary {
  const registry = ensureVaultRegistry();
  const vault = registry.vaults.find((candidate) => candidate.id === id);
  if (!vault) throw new Error('Bóveda no encontrada.');
  vault.type = normalizeVaultType(type);
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

export function vaultExists(id: string): boolean {
  return getVault(id) !== null;
}
