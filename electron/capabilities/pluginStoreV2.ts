import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { compareSemver, SLUG } from '../../packages/capability-api/src/json';
import { permissionFingerprint, permissionsExpandV2, type TrustedPermissionSetV2 } from '../../packages/capability-api/src/permissions';
import { assertMayProvide, resolvePluginTarget, validateCapabilityManifestV2, validatePluginManifestV2, type CapabilityManifestV2, type PluginManifestV2, type PluginTarget } from '../../packages/capability-api/src/manifest';
import { assertArchiveMatchesRelease, assertNotDowngrade, assertPackageMatchesRelease, assertStableDigest, sha256Hex, verifyReleaseManifest, type PluginReleaseManifest } from '../../packages/capability-api/src/signature';
import { extractPluginArchive } from './packageArchive';
import { assertPublishingKeysConfigured, trustedPublishingKeys } from './trustedKeys';
import type { TrustedWorkerRuntime } from './workerHost';

/** The transactional store behind capability API v2.
 *
 *  Code, durable data, rebuildable caches, runtimes and secrets live in separate trees so
 *  an update, a cache wipe and an uninstall can each touch exactly what they mean to. An
 *  install is staged and verified whole before anything becomes active, and the previous
 *  version is kept so a bad release is one click from being undone. */

export type PluginStatus = 'ready' | 'degraded' | 'pending-permissions' | 'pending-migration' | 'failed';

export interface InstalledVersion {
  version: string;
  /** SHA-256 of the signed archive; the same number the release manifest pinned. */
  digest: string;
  target: PluginTarget;
  installedAt: string;
}

export interface InstalledPluginStateV2 {
  schemaVersion: 2;
  id: string;
  source: { id: string; path: string; commit: string };
  trust: { publisher: string; keyId: string; verified: true };
  active?: InstalledVersion;
  previous?: InstalledVersion;
  pending?: InstalledVersion & { reason: 'permissions' | 'incompatible' | 'migration' };
  approvedPermissionFingerprint: string;
  status: PluginStatus;
  autoUpdate: boolean;
  rollbackAvailable: boolean;
  dataVersion: number;
}

export interface StagedPackage {
  manifest: PluginManifestV2;
  capabilities: Array<{ manifest: CapabilityManifestV2; entryPath: string }>;
  permissions: TrustedPermissionSetV2;
  digest: string;
  target: PluginTarget;
  root: string;
}

const root = () => path.join(app.getPath('userData'), 'plugins');
export const pluginsInstalledRoot = () => path.join(root(), 'installed');
export const pluginsDataRoot = () => path.join(root(), 'data');
export const pluginsCacheRoot = () => path.join(root(), 'cache');
export const pluginsRuntimesRoot = () => path.join(root(), 'runtimes');
export const pluginsSecretsRoot = () => path.join(root(), 'secrets');
export const pluginsStagingRoot = () => path.join(root(), 'staging');
const tombstonesRoot = () => path.join(root(), 'tombstones');

const assertId = (id: string) => { if (!SLUG.test(id)) throw new Error('Invalid plugin id.'); return id; };
const pluginDir = (id: string) => path.join(pluginsInstalledRoot(), assertId(id));
const statePath = (id: string) => path.join(pluginDir(id), 'state.json');
const versionDir = (id: string, version: string, digest: string) => path.join(pluginDir(id), 'versions', `${version}-${digest}`);

export function initializeCapabilityPluginStore(): void {
  for (const directory of [pluginsInstalledRoot(), pluginsDataRoot(), pluginsCacheRoot(), pluginsRuntimesRoot(), pluginsSecretsRoot(), pluginsStagingRoot(), tombstonesRoot()]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  // Staging is disposable by design: nothing left there by an interrupted install can
  // ever become active, so the safe thing is to start every session without it.
  for (const entry of fs.readdirSync(pluginsStagingRoot(), { withFileTypes: true })) {
    if (entry.isDirectory()) fs.rmSync(path.join(pluginsStagingRoot(), entry.name), { recursive: true, force: true });
  }
}

export function readPluginStateV2(id: string): InstalledPluginStateV2 | null {
  try {
    const value = JSON.parse(fs.readFileSync(statePath(id), 'utf8')) as InstalledPluginStateV2;
    if (value.schemaVersion !== 2 || value.id !== id || !value.active && !value.pending) return null;
    return value;
  } catch { return null; }
}

function writeStateV2(state: InstalledPluginStateV2): InstalledPluginStateV2 {
  const target = statePath(state.id);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, target);
  return state;
}

export function listInstalledPluginsV2(): InstalledPluginStateV2[] {
  try {
    return fs.readdirSync(pluginsInstalledRoot(), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .flatMap(entry => { const state = readPluginStateV2(entry.name); return state ? [state] : []; });
  } catch { return []; }
}

/** Reads a package that is already on disk and checks it describes itself consistently:
 *  declared capabilities exist, versions agree, and nothing claims an id it may not. */
export function readStagedPackage(directory: string, digest: string, target: PluginTarget): StagedPackage {
  const manifest = validatePluginManifestV2(JSON.parse(fs.readFileSync(path.join(directory, 'plugin.json'), 'utf8')));
  const seen = new Set<string>();
  const capabilities = manifest.capabilities.map(relative => {
    const manifestPath = path.join(directory, ...relative.split('/'));
    const capability = validateCapabilityManifestV2(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
    const expectedId = relative.split('/')[1];
    if (capability.id !== expectedId) throw new Error('Capability directory and id must match.');
    if (capability.version !== manifest.version) throw new Error('Capability versions must match the plugin version.');
    if (seen.has(capability.provides)) throw new Error(`The package provides ${capability.provides} twice.`);
    seen.add(capability.provides);
    assertMayProvide(manifest, capability.provides);
    const entryPath = path.join(path.dirname(manifestPath), ...capability.runtime.entry.split('/'));
    const stat = fs.lstatSync(entryPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Missing capability entry: ${capability.runtime.entry}`);
    return { manifest: capability, entryPath };
  });
  const permissions = mergedTrustedPermissions(capabilities.map(entry => entry.manifest));
  return { manifest, capabilities, permissions, digest, target, root: directory };
}

/** The union of what every capability in a package declares. This is what the user is
 *  shown once, and what an update is diffed against. */
export function mergedTrustedPermissions(capabilities: readonly CapabilityManifestV2[]): TrustedPermissionSetV2 {
  const network = capabilities.flatMap(capability => capability.permissions.network ?? []);
  const secrets = capabilities.flatMap(capability => capability.permissions.secrets ?? []);
  const runtimes = capabilities.flatMap(capability => capability.permissions.runtimes ?? []);
  const storages = capabilities.flatMap(capability => capability.permissions.storage ? [capability.permissions.storage] : []);
  const models = capabilities.flatMap(capability => capability.permissions.model ? [capability.permissions.model] : []);
  return {
    ...(network.length ? { network } : {}),
    ...(secrets.length ? { secrets } : {}),
    ...(runtimes.length ? { runtimes } : {}),
    ...(storages.length ? { storage: {
      stateBytes: storages.reduce((sum, storage) => sum + storage.stateBytes, 0),
      cacheBytes: storages.reduce((sum, storage) => sum + storage.cacheBytes, 0),
      tempBytes: storages.reduce((sum, storage) => sum + storage.tempBytes, 0),
    } } : {}),
    ...(models.length ? { model: { maxCalls: Math.max(...models.map(model => model.maxCalls)), purpose: models[0].purpose } } : {}),
    ...(capabilities.some(capability => capability.permissions.svg) ? { svg: true } : {}),
    ...(capabilities.some(capability => capability.permissions.subworkers)
      ? { subworkers: { max: Math.max(...capabilities.map(capability => capability.permissions.subworkers?.max ?? 0)) } }
      : {}),
  };
}

export interface VerifiedDownload {
  archive: Buffer;
  releaseManifestBytes: Buffer;
  signature: Buffer;
  source: { id: string; path: string; commit: string };
}

export interface InstallOptions {
  approvePermissions?: boolean;
  autoUpdate?: boolean;
  allowRollback?: boolean;
  now?: Date;
}

export interface InstallOutcome {
  state: InstalledPluginStateV2;
  package: StagedPackage;
  release: PluginReleaseManifest;
  activated: boolean;
}

/** The whole install, in the order the plan fixes: verify the signature, verify the bytes
 *  against it, extract into staging, validate what came out, then — and only then — make
 *  it active. Every failure before the last step leaves the previous version untouched. */
export function installVerifiedPlugin(download: VerifiedDownload, options: InstallOptions = {}): InstallOutcome {
  assertPublishingKeysConfigured();
  const now = options.now ?? new Date();
  const release = verifyReleaseManifest(download.releaseManifestBytes, download.signature, trustedPublishingKeys(), now);

  const target = resolvePluginTarget(
    release.targets.map(entry => entry.target),
    process.platform,
    process.arch,
  );
  if (!target) throw new Error(`${release.plugin} ${release.version} does not publish a package for ${process.platform}-${process.arch}.`);

  const current = readPluginStateV2(release.plugin);
  const digest = sha256Hex(download.archive);
  if (!options.allowRollback) assertNotDowngrade(current?.active?.version, release.version);
  assertStableDigest(current?.active, { version: release.version, digest });
  if (current?.active && current.active.version === release.version && current.active.digest === digest) {
    return { state: current, package: readStagedPackage(versionDir(release.plugin, release.version, digest), digest, target), release, activated: true };
  }

  // The digest is checked before the archive is opened, so a substituted download never
  // reaches the decompressor at all.
  assertArchiveMatchesRelease(release, target, download.archive);

  const staging = path.join(pluginsStagingRoot(), `${release.plugin}-${randomUUID()}`);
  let staged: StagedPackage;
  try {
    extractPluginArchive(download.archive, staging);
    const manifest = validatePluginManifestV2(JSON.parse(fs.readFileSync(path.join(staging, 'plugin.json'), 'utf8')));
    assertPackageMatchesRelease(release, target, download.archive, manifest);
    if (compareSemver(app.getVersion(), manifest.compatibility.minNodusVersion) < 0) {
      return { state: pend(current, release, digest, target, 'incompatible', options, now), package: readStagedPackage(staging, digest, target), release, activated: false };
    }
    staged = readStagedPackage(staging, digest, target);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }

  const fingerprint = permissionFingerprint(staged.permissions);
  const expands = current
    ? permissionsExpandV2(previousPermissions(current), staged.permissions)
    : Object.keys(staged.permissions).length > 0;
  if (expands && !options.approvePermissions) {
    const pending = pend(current, release, digest, target, 'permissions', options, now);
    // The package stays staged under its version directory so approving it later does not
    // need a second download, but nothing about it is active.
    promote(staging, release.plugin, release.version, digest);
    return { state: pending, package: staged, release, activated: false };
  }

  const versionRoot = promote(staging, release.plugin, release.version, digest);
  const state = writeStateV2({
    schemaVersion: 2,
    id: release.plugin,
    source: download.source,
    trust: { publisher: release.publisher.id, keyId: release.publisher.keyId, verified: true },
    active: { version: release.version, digest, target, installedAt: now.toISOString() },
    ...(current?.active ? { previous: current.active } : {}),
    approvedPermissionFingerprint: fingerprint,
    status: 'ready',
    autoUpdate: current?.autoUpdate ?? options.autoUpdate ?? true,
    rollbackAvailable: Boolean(current?.active),
    dataVersion: current?.dataVersion ?? 0,
  });
  pruneVersions(state);
  return { state, package: { ...staged, root: versionRoot }, release, activated: true };
}

/** A fingerprint cannot be reversed into the set it summarizes, so what the user approved
 *  last time is read back from the installed version's own manifests. */
function previousPermissions(state: InstalledPluginStateV2): TrustedPermissionSetV2 {
  if (!state.active) return {};
  try {
    const staged = readStagedPackage(versionDir(state.id, state.active.version, state.active.digest), state.active.digest, state.active.target);
    return staged.permissions;
  } catch { return {}; }
}

function pend(
  current: InstalledPluginStateV2 | null,
  release: PluginReleaseManifest,
  digest: string,
  target: PluginTarget,
  reason: 'permissions' | 'incompatible' | 'migration',
  options: InstallOptions,
  now: Date,
): InstalledPluginStateV2 {
  const base: InstalledPluginStateV2 = current ?? {
    schemaVersion: 2, id: release.plugin,
    source: { id: '', path: '', commit: '' },
    trust: { publisher: release.publisher.id, keyId: release.publisher.keyId, verified: true },
    approvedPermissionFingerprint: '', status: 'pending-permissions',
    autoUpdate: options.autoUpdate ?? true, rollbackAvailable: false, dataVersion: 0,
  };
  return writeStateV2({
    ...base,
    pending: { version: release.version, digest, target, installedAt: now.toISOString(), reason },
    status: reason === 'permissions' ? 'pending-permissions' : base.active ? 'ready' : 'failed',
  });
}

function promote(staging: string, id: string, version: string, digest: string): string {
  const target = versionDir(id, version, digest);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  if (fs.existsSync(target)) fs.rmSync(staging, { recursive: true, force: true });
  else fs.renameSync(staging, target);
  return target;
}

function pruneVersions(state: InstalledPluginStateV2): void {
  const keep = new Set([state.active, state.previous, state.pending].flatMap(entry => entry ? [`${entry.version}-${entry.digest}`] : []));
  const versions = path.join(pluginDir(state.id), 'versions');
  try {
    for (const entry of fs.readdirSync(versions, { withFileTypes: true })) {
      if (entry.isDirectory() && !keep.has(entry.name)) fs.rmSync(path.join(versions, entry.name), { recursive: true, force: true });
    }
  } catch { /* nothing to prune */ }
}

export function approvePendingPluginV2(id: string): InstalledPluginStateV2 {
  const state = readPluginStateV2(id);
  if (!state?.pending) throw new Error('This plugin has no update awaiting approval.');
  if (state.pending.reason !== 'permissions') throw new Error('This pending update is not waiting on permissions.');
  const staged = readStagedPackage(versionDir(id, state.pending.version, state.pending.digest), state.pending.digest, state.pending.target);
  const next = writeStateV2({
    ...state,
    active: { version: state.pending.version, digest: state.pending.digest, target: state.pending.target, installedAt: new Date().toISOString() },
    ...(state.active ? { previous: state.active } : {}),
    pending: undefined,
    approvedPermissionFingerprint: permissionFingerprint(staged.permissions),
    status: 'ready',
    rollbackAvailable: Boolean(state.active),
  });
  pruneVersions(next);
  return next;
}

export function rollbackPluginV2(id: string): InstalledPluginStateV2 {
  const state = readPluginStateV2(id);
  if (!state?.previous || !state.active) throw new Error('No previous version of this plugin is available.');
  return writeStateV2({ ...state, active: state.previous, previous: state.active, pending: undefined, status: 'ready', rollbackAvailable: true });
}

/** The default uninstall keeps what the user made and removes what the machine can
 *  rebuild or must not keep. A tombstone remembers identity and flags so reinstalling
 *  restores the plugin's place rather than creating a stranger with the same name. */
export function removePluginV2(id: string, options: { purgeData?: boolean } = {}): void {
  const state = readPluginStateV2(id);
  if (state) {
    fs.mkdirSync(tombstonesRoot(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(tombstonesRoot(), `${assertId(id)}.json`), JSON.stringify({
      id, source: state.source, autoUpdate: state.autoUpdate, dataVersion: state.dataVersion, removedAt: new Date().toISOString(),
    }, null, 2), { mode: 0o600 });
  }
  fs.rmSync(pluginDir(id), { recursive: true, force: true });
  fs.rmSync(path.join(pluginsCacheRoot(), assertId(id)), { recursive: true, force: true });
  fs.rmSync(path.join(pluginsRuntimesRoot(), assertId(id)), { recursive: true, force: true });
  fs.rmSync(path.join(pluginsSecretsRoot(), `${assertId(id)}.bin`), { force: true });
  if (options.purgeData) fs.rmSync(path.join(pluginsDataRoot(), assertId(id)), { recursive: true, force: true });
}

/** The data version a package's own migrations actually reached.
 *
 *  Written by the host after the worker reports what completed, never by the package: a
 *  number that says "this profile holds version 3 data" is only worth anything if the
 *  process that failed halfway cannot also write it. */
export function recordPluginDataVersion(id: string, dataVersion: number): InstalledPluginStateV2 {
  const state = readPluginStateV2(id);
  if (!state) throw new Error(`${id} is not installed.`);
  if (!Number.isInteger(dataVersion) || dataVersion < 0 || dataVersion > 1000) throw new Error('Invalid data version.');
  // A migration never walks data backwards: an older build that reports a lower number is
  // describing what it can read, not what is on disk.
  if (dataVersion <= state.dataVersion) return state;
  return writeStateV2({ ...state, dataVersion });
}

/** Where the active version of a package was installed. */
export function activePluginRoot(id: string): string | null {
  const state = readPluginStateV2(id);
  return state?.active ? versionDir(id, state.active.version, state.active.digest) : null;
}

/** The migration scripts a package declares, as absolute paths inside the installed
 *  version. Resolved here, by the host, so a worker can only ever be handed files that
 *  came out of the signed archive. */
export function pluginMigrationScripts(id: string): string[] {
  const root = activePluginRoot(id);
  if (!root) return [];
  const manifest = validatePluginManifestV2(JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8')));
  return manifest.migrations.map(relative => {
    const file = path.join(root, ...relative.split('/'));
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Missing migration: ${relative}`);
    if (path.relative(root, file).startsWith('..')) throw new Error(`Migration outside the package: ${relative}`);
    return file;
  });
}

/** Whether this package may update itself. The only field of the state a user sets
 *  directly, so it is written on its own rather than as part of an install. */
export function writePluginAutoUpdate(id: string, autoUpdate: boolean): InstalledPluginStateV2 {
  const state = readPluginStateV2(id);
  if (!state) throw new Error(`${id} is not installed.`);
  return writeStateV2({ ...state, autoUpdate });
}

export function pluginTombstone(id: string): { id: string; source: InstalledPluginStateV2['source']; autoUpdate: boolean; dataVersion: number } | null {
  try { return JSON.parse(fs.readFileSync(path.join(tombstonesRoot(), `${assertId(id)}.json`), 'utf8')); } catch { return null; }
}

/** Resolves one capability to something the worker host can run. A snapshot pins the
 *  version and digest a turn started with, so an update mid-turn changes nothing. */
export function resolveTrustedCapability(capabilityId: string, snapshot?: { version: string; digest: string }): TrustedWorkerRuntime | null {
  for (const state of listInstalledPluginsV2()) {
    const selected = snapshot ?? state.active;
    if (!selected) continue;
    const usable = state.active && selected.version === state.active.version && selected.digest === state.active.digest
      || state.previous && selected.version === state.previous.version && selected.digest === state.previous.digest;
    if (!usable) continue;
    const target = (state.active?.version === selected.version ? state.active.target : state.previous?.target) ?? 'any';
    let staged: StagedPackage;
    try { staged = readStagedPackage(versionDir(state.id, selected.version, selected.digest), selected.digest, target); }
    catch { continue; }
    const capability = staged.capabilities.find(entry => entry.manifest.provides === capabilityId);
    if (!capability) continue;
    return {
      capabilityId,
      plugin: { id: state.id, version: selected.version, digest: selected.digest },
      manifest: capability.manifest,
      entryPath: capability.entryPath,
      permissions: capability.manifest.permissions,
    };
  }
  return null;
}
