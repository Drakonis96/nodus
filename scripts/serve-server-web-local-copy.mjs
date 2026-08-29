// Launch Nodus Server with a publication made from an isolated copy of the
// currently active local vault. The source profile and database are opened only
// for a SQLite online backup; every mutable path is redirected into a temporary
// directory.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const thisScript = fileURLToPath(import.meta.url);
const electronBin = path.join(repoRoot, 'node_modules/.bin/electron');

// better-sqlite3 is compiled for Electron's bundled Node ABI in this project.
// Re-exec once under that runtime before importing it, while keeping the real
// Electron launch below free of ELECTRON_RUN_AS_NODE.
if (!process.argv.includes('--electron-node')) {
  execFileSync(electronBin, [thisScript, '--electron-node'], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  });
  process.exit(0);
}

const { default: Database } = await import('better-sqlite3');
const { _electron: electron } = await import('playwright-core');
const sourceProfile = path.resolve(process.env.NODUS_SOURCE_USERDATA || '');
const requestedVaultId = String(process.env.NODUS_SOURCE_VAULT_ID || '').trim();
const publishAllVaults = process.env.NODUS_QA_ALL_VAULTS === '1';
const verifyOnly = process.env.NODUS_QA_VERIFY_ONLY === '1';
const skipLibrary = process.env.NODUS_QA_SKIP_LIBRARY === '1';
const adminEmail = 'qa-local@nodus.local';
const adminPassword = randomBytes(18).toString('base64url');
const scratch = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nodus-server-local-copy-'));
const profile = path.join(scratch, 'profile');
const copiedVaultDir = path.join(profile, 'vaults');
let desktop = null;
let server = null;
let stopping = false;
let expectedLibraryDocuments = 0;
const expectedProjections = new Map();

assert.ok(sourceProfile && sourceProfile !== path.parse(sourceProfile).root, 'Define NODUS_SOURCE_USERDATA with the source Nodus profile.');
assert.notEqual(path.resolve(sourceProfile), path.resolve(profile), 'The isolated profile must differ from the source profile.');

function within(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(origin, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Server did not become healthy.${lastError ? ` ${lastError.message}` : ''}`);
}

function safeSettings(current, port, libraryBase = '') {
  return {
    ...current,
    syncMode: 'manual',
    autoLightScan: false,
    autoDeepScanOnReadTag: false,
    autoSummaryAfterDeep: false,
    autoBridgeAfterQueue: false,
    autoResumeQueue: false,
    documentIndexingEnabled: false,
    announcementsEnabled: false,
    betaUpdates: false,
    autoBackupEnabled: false,
    // The QA profile gets a copy-on-write/read-only projection of the source library below.
    // Pointing at that shadow keeps Library realistic without letting its initialisation or
    // reader sidecars touch the user's real nodus-library.
    autoBackupFolder: libraryBase,
    backupCleanupEnabled: false,
    libraryGlobalEnabled: Boolean(libraryBase),
    mcpEnabled: false,
    nodusServerEnabled: false,
    nodusServerAutoSync: false,
    nodusServerIncludeUserContent: true,
    nodusServerIncludePassages: true,
    nodusServerIncludeLibraryDocuments: Boolean(libraryBase),
    nodusServerIncludeVectors: false,
    nodusServerIncludePersonalImports: false,
    nodusServerUrl: '',
    nodusServerSpaceId: '',
    nodusServerSpaceName: '',
    localServerEnabled: false,
    localServerAccess: 'loopback',
    localServerPort: port,
    localServerKeepAwake: false,
    localServerLidServing: false,
    copilotEnabled: false,
    zoteroPluginEnabled: false,
    browserConnectorEnabled: false,
    demoMode: false,
    onboardingComplete: true,
    tourComplete: true,
  };
}

async function createIsolatedLibrary(sourcePrefs) {
  if (skipLibrary) return '';
  const sourceBase = typeof sourcePrefs.autoBackupFolder === 'string' ? sourcePrefs.autoBackupFolder.trim() : '';
  const sourceLibrary = sourceBase ? path.join(path.resolve(sourceBase), 'nodus-library') : '';
  const sourceCatalog = path.join(sourceProfile, 'library', 'catalog.sqlite');
  if (!sourceLibrary || !fs.existsSync(sourceLibrary) || !fs.existsSync(sourceCatalog)) return '';

  const isolatedBase = path.join(profile, 'library-shadow');
  const isolatedLibrary = path.join(isolatedBase, 'nodus-library');
  const isolatedCatalogDir = path.join(profile, 'library');
  await fs.promises.mkdir(isolatedCatalogDir, { recursive: true, mode: 0o700 });
  const catalog = new Database(sourceCatalog, { readonly: true, fileMustExist: true });
  let eligibleFolders = [];
  try {
    catalog.pragma('query_only = ON');
    const rows = catalog.prepare('SELECT folder_name FROM library_items WHERE deleted_at IS NULL').all();
    eligibleFolders = rows.map((row) => String(row.folder_name || '')).filter(Boolean);
    expectedLibraryDocuments = eligibleFolders.length;
    await catalog.backup(path.join(isolatedCatalogDir, 'catalog.sqlite'));
  } finally {
    catalog.close();
  }
  const device = path.join(sourceProfile, 'library', 'device.json');
  if (fs.existsSync(device)) await fs.promises.copyFile(device, path.join(isolatedCatalogDir, 'device.json'));

  // Copy only catalogued, non-deleted item folders. The library root also contains a multi-
  // gigabyte `.nodus` cache; copying the whole root made this supposedly quick QA launcher
  // hang for minutes and needlessly touched data unrelated to the published projection.
  // Files larger than the Server publication ceiling can never enter a package, so omitting
  // them avoids pulling large originals out of cloud storage. Everything eligible is copied
  // (using APFS clone-on-write when available) into a tree the isolated app owns.
  const maxEligibleFileBytes = 96 * 1024 * 1024;
  const copyEligible = async (source, destination) => fs.promises.cp(source, destination, {
    recursive: true,
    mode: fs.constants.COPYFILE_FICLONE,
    filter: async (entry) => {
      const stat = await fs.promises.lstat(entry);
      if (stat.isSymbolicLink()) return false;
      return stat.isDirectory() || (stat.isFile() && stat.size <= maxEligibleFileBytes);
    },
  });
  await fs.promises.mkdir(isolatedLibrary, { recursive: true, mode: 0o700 });
  for (const folder of eligibleFolders) {
    const sourceFolder = path.join(sourceLibrary, folder);
    if (fs.existsSync(sourceFolder)) await copyEligible(sourceFolder, path.join(isolatedLibrary, folder));
  }
  const rootManifest = path.join(sourceLibrary, 'library.json');
  if (fs.existsSync(rootManifest)) await fs.promises.copyFile(rootManifest, path.join(isolatedLibrary, 'library.json'));
  const sourceNodus = path.join(sourceLibrary, '.nodus');
  const isolatedNodus = path.join(isolatedLibrary, '.nodus');
  await fs.promises.mkdir(isolatedNodus, { recursive: true, mode: 0o700 });
  for (const name of ['library-settings.json', 'view-preferences.json', 'vault-links.json']) {
    const sourceFile = path.join(sourceNodus, name);
    if (fs.existsSync(sourceFile)) await fs.promises.copyFile(sourceFile, path.join(isolatedNodus, name));
  }
  return isolatedBase;
}

async function createIsolatedProfile(port) {
  const registryFile = path.join(sourceProfile, 'vaults.json');
  assert.ok(fs.existsSync(registryFile), `Vault registry not found: ${registryFile}`);
  const registry = JSON.parse(await fs.promises.readFile(registryFile, 'utf8'));
  const vaultId = requestedVaultId || registry.activeVaultId;
  const activeVault = (registry.vaults || []).find((entry) => entry.id === vaultId);
  assert.ok(activeVault, `Vault ${vaultId} is not present in the source registry.`);
  const sourceVaults = publishAllVaults ? (registry.vaults || []) : [activeVault];
  assert.ok(sourceVaults.length > 0, 'The source registry has no vaults.');
  for (const vault of sourceVaults) assert.ok(fs.existsSync(vault.path), `Vault database not found: ${vault.path}`);

  await fs.promises.mkdir(copiedVaultDir, { recursive: true, mode: 0o700 });

  const sourcePrefsFile = path.join(sourceProfile, 'app-prefs.json');
  const sourcePrefs = fs.existsSync(sourcePrefsFile)
    ? JSON.parse(await fs.promises.readFile(sourcePrefsFile, 'utf8'))
    : {};
  const isolatedLibraryBase = await createIsolatedLibrary(sourcePrefs);

  const copiedVaults = [];
  for (const vault of sourceVaults) {
    const copiedPath = path.join(copiedVaultDir, `${String(vault.id).replace(/[^a-zA-Z0-9_-]/g, '_')}.sqlite`);
    const source = new Database(vault.path, { readonly: true, fileMustExist: true });
    try {
      source.pragma('query_only = ON');
      await source.backup(copiedPath);
    } finally {
      source.close();
    }
    const expected = { deepResearchReports: 0, researchQuestions: 0, libraryDocuments: vault.id === activeVault.id ? expectedLibraryDocuments : null };
    const copy = new Database(copiedPath);
    try {
      try {
        expected.researchQuestions = Number(copy.prepare('SELECT COUNT(*) AS n FROM research_questions').get()?.n) || 0;
        expected.deepResearchReports = (copy.prepare('SELECT brief_json FROM writing_saved_drafts').all())
          .filter((entry) => {
            try { return JSON.parse(entry.brief_json || '{}')?.kind === 'deep_research'; }
            catch { return false; }
          }).length;
      } catch { /* old/non-academic vaults legitimately have neither table */ }
      const row = copy.prepare("SELECT value FROM settings WHERE key = 'app'").get();
      if (row?.value) {
        const current = JSON.parse(row.value);
        copy.prepare("UPDATE settings SET value = ? WHERE key = 'app'").run(JSON.stringify(safeSettings(current, port, isolatedLibraryBase)));
      }
    } finally {
      copy.close();
    }
    expectedProjections.set(vault.id, expected);
    copiedVaults.push({
      ...vault,
      name: `${vault.name} · copia aislada`,
      path: copiedPath,
      origin: 'local',
      active: vault.id === activeVault.id,
      lastOpenedAt: new Date().toISOString(),
    });
  }

  const now = new Date().toISOString();
  const isolatedRegistry = {
    formatVersion: 1,
    activeVaultId: activeVault.id,
    vaults: copiedVaults.map((vault) => ({ ...vault, lastOpenedAt: now })),
  };
  assert.ok(isolatedRegistry.vaults.every((entry) => within(entry.path, profile)), 'A copied vault path escaped the isolated profile.');
  await fs.promises.writeFile(path.join(profile, 'vaults.json'), `${JSON.stringify(isolatedRegistry, null, 2)}\n`, { mode: 0o600 });

  await fs.promises.writeFile(
    path.join(profile, 'app-prefs.json'),
    `${JSON.stringify(safeSettings(sourcePrefs, port, isolatedLibraryBase), null, 2)}\n`,
    { mode: 0o600 },
  );
  return { activeVault, vaults: sourceVaults };
}

async function verifyIsolatedPublication(spaceId, vaultId) {
  const snapshotPath = path.join(profile, 'local-server', 'data', 'spaces', String(spaceId), 'snapshot.json.gz');
  assert.ok(within(snapshotPath, profile), 'The published snapshot escaped the isolated profile.');
  const snapshot = JSON.parse(gunzipSync(await fs.promises.readFile(snapshotPath)).toString('utf8'));
  const publishedReports = (snapshot.tables?.writing_saved_drafts || []).filter((entry) => {
    try { return JSON.parse(entry.brief_json || '{}')?.kind === 'deep_research'; }
    catch { return false; }
  }).length;
  const publishedQuestions = Array.isArray(snapshot.tables?.research_questions) ? snapshot.tables.research_questions.length : 0;
  const publishedLibrary = Array.isArray(snapshot.library?.documents) ? snapshot.library.documents.length : 0;
  const expected = expectedProjections.get(vaultId) || { deepResearchReports: 0, researchQuestions: 0, libraryDocuments: null };
  assert.equal(publishedReports, expected.deepResearchReports, 'The isolated publication omitted Deep Research reports.');
  assert.equal(publishedQuestions, expected.researchQuestions, 'The isolated publication omitted coverage questions.');
  if (expected.libraryDocuments !== null) assert.equal(publishedLibrary, expected.libraryDocuments, 'The isolated publication omitted Library documents.');
  return { deepResearchReports: publishedReports, researchQuestions: publishedQuestions, libraryDocuments: publishedLibrary };
}

async function publishCopies(port, selection) {
  const env = {
    ...process.env,
    NODUS_USERDATA: profile,
    NODUS_DISABLE_AUTO_UPDATE: '1',
    NODUS_E2E_UPDATE_STATUS: 'not-available',
    NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await electron.launch({
    executablePath: require('electron'),
    args: [repoRoot],
    cwd: repoRoot,
    env,
    timeout: 10 * 60_000,
  });
  const page = await desktop.firstWindow({ timeout: 10 * 60_000 });
  page.setDefaultTimeout(30 * 60_000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await desktop.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.hide();
  });

  const isolatedPrefs = JSON.parse(await fs.promises.readFile(path.join(profile, 'app-prefs.json'), 'utf8'));
  await page.evaluate(({ localPort, libraryBase }) => window.nodus.updateSettings({
    syncMode: 'manual',
    autoBackupEnabled: false,
    announcementsEnabled: false,
    autoBackupFolder: libraryBase,
    libraryGlobalEnabled: Boolean(libraryBase),
    mcpEnabled: false,
    nodusServerEnabled: false,
    nodusServerAutoSync: false,
    nodusServerIncludeUserContent: true,
    nodusServerIncludePassages: true,
    nodusServerIncludeLibraryDocuments: Boolean(libraryBase),
    nodusServerIncludeVectors: false,
    nodusServerIncludePersonalImports: false,
    localServerEnabled: false,
    localServerAccess: 'loopback',
    localServerPort: localPort,
    localServerKeepAwake: false,
    copilotEnabled: false,
    zoteroPluginEnabled: false,
    browserConnectorEnabled: false,
  }), { localPort: port, libraryBase: isolatedPrefs.autoBackupFolder || '' });
  const listed = await page.evaluate(() => window.nodus.listVaults());
  // Profiles whose selected vault id is not `default` may get a fresh, empty default vault
  // from Desktop's bootstrap migration. It is still inside the disposable profile and is
  // never published; require the requested copy to be present instead of confusing this
  // harmless bootstrap row with access to the user's real registry.
  assert.ok(selection.vaults.every((vault) => listed.some((entry) => entry.id === vault.id)), 'A selected copied vault is missing from the isolated Desktop.');
  assert.ok(listed.every((entry) => within(entry.path, profile)), 'Desktop exposed a vault outside the isolated profile.');

  const started = await page.evaluate(() => window.nodus.startLocalServer());
  assert.equal(started.phase, 'running', started.error || 'The temporary local server did not start.');
  const publications = [];
  for (const vault of selection.vaults) {
    if (vault.id !== selection.activeVault.id || publications.length > 0) {
      const switched = await page.evaluate((vaultId) => window.nodus.switchVault(vaultId), vault.id);
      assert.equal(switched.ok, true, switched.error || `Could not switch to copied vault ${vault.name}.`);
    }
    process.stdout.write(`[local-copy] Publishing “${vault.name}” (${vault.type}) from the isolated SQLite backup…\n`);
    const paired = await page.evaluate(() => window.nodus.connectVaultToLocalServer());
    assert.equal(paired.ok, true, 'The copied vault was not paired.');
    let overview = await page.evaluate(() => window.nodus.getNodusServerOverview());
    let connection = overview.connections.find((entry) => entry.isActiveVault);
    // A first full publication can exceed the bridge's optimistic connect deadline on a
    // large real vault. Pairing has already succeeded at that point; retry the explicit sync
    // once instead of treating a transient timeout as a corrupt isolated copy.
    if (!connection?.lastSyncAt && connection?.vaultId) {
      overview = await page.evaluate((vaultId) => window.nodus.syncNodusServerVaultNow(vaultId), connection.vaultId);
      connection = overview.connections.find((entry) => entry.isActiveVault);
    }
    assert.ok(connection?.lastSyncAt, connection?.lastError || 'The first publication did not complete.');
    process.stdout.write(`[local-copy] Publication complete: ${paired.spaceName}.\n`);
    publications.push({ vault, paired, connection });
  }

  await page.evaluate(() => window.nodus.stopLocalServer());
  await desktop.close();
  desktop = null;
  return publications;
}

async function launchStandalone(port) {
  const origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(repoRoot, 'server/server.mjs')], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODUS_DATA_DIR: path.join(profile, 'local-server', 'data'),
      NODUS_PORT: String(port),
      NODUS_HOST: '127.0.0.1',
      NODUS_PUBLIC_URL: origin,
      NODUS_DEPLOYMENT_MODE: 'advanced',
      NODUS_ADMIN_EMAIL: adminEmail,
      NODUS_ADMIN_PASSWORD: adminPassword,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => process.stdout.write(chunk));
  server.stderr.on('data', (chunk) => process.stderr.write(chunk));
  await waitForHealth(origin);
  return origin;
}

async function stop() {
  if (stopping) return;
  stopping = true;
  if (desktop) await desktop.close().catch(() => undefined);
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
  }
  await fs.promises.rm(scratch, { recursive: true, force: true });
}

process.once('SIGINT', () => void stop().then(() => process.exit(0)));
process.once('SIGTERM', () => void stop().then(() => process.exit(0)));

try {
  const port = await freePort();
  const selection = await createIsolatedProfile(port);
  const publications = await publishCopies(port, selection);
  const verifications = [];
  for (const publication of publications) verifications.push({ publication, verified: await verifyIsolatedPublication(publication.paired.spaceId, publication.vault.id) });
  if (verifyOnly) {
    for (const { publication, verified } of verifications) process.stdout.write(`[local-copy] VERIFIED ${JSON.stringify({ vaultId: publication.vault.id, name: publication.vault.name, type: publication.vault.type, ...verified })}\n`);
    process.exitCode = 0;
  } else {
  const origin = await launchStandalone(port);
  process.stdout.write(`\n[local-copy] READY\n`);
  process.stdout.write(`[local-copy] URL: ${origin}/\n`);
  process.stdout.write(`[local-copy] User: ${adminEmail}\n`);
  process.stdout.write(`[local-copy] Password: ${adminPassword}\n`);
  process.stdout.write(`[local-copy] Source vault${selection.vaults.length === 1 ? '' : 's'}: ${selection.vaults.map((vault) => vault.name).join(' · ')}\n`);
  process.stdout.write(`[local-copy] Isolated root: ${scratch}\n`);
  process.stdout.write(`[local-copy] Published at: ${publications.map((entry) => entry.connection.lastSyncAt).sort().at(-1)}\n`);
  process.stdout.write(`[local-copy] Verified ${verifications.length} vault(s): ${verifications.reduce((sum, entry) => sum + entry.verified.deepResearchReports, 0)} Deep Research · ${verifications.reduce((sum, entry) => sum + entry.verified.researchQuestions, 0)} coverage question(s) · ${verifications.reduce((sum, entry) => sum + entry.verified.libraryDocuments, 0)} Library document(s)\n`);
  process.stdout.write('[local-copy] Ctrl-C stops the server and deletes the isolated copy.\n');
  await new Promise((resolve, reject) => {
    server.once('exit', (code, signal) => code === 0 || signal === 'SIGTERM' ? resolve() : reject(new Error(`Server exited with ${code ?? signal}.`)));
  });
  }
} catch (error) {
  console.error(`[local-copy] ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await stop();
}
