// Automatic encrypted backups: drives the REAL autoBackup + exportImport +
// backupCrypto modules against a scratch DB and proves the contract — one
// master password for every backup, full-state archives, atomic writes,
// GFS retention scoped per machine, and the due-scheduling logic. Runs under
// Electron-as-Node so better-sqlite3 matches the app ABI.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readdir, mkdir } from 'node:fs/promises';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!process.argv.includes('--electron-auto-backup-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-auto-backup.mjs'), '--electron-auto-backup-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

process.env.NODE_PATH = [path.join(repoRoot, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
Module._initPaths();
const require = createRequire(import.meta.url);

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-auto-backup-'));
process.env.NODUS_TEST_USERDATA = root; // stub-electron app.getPath → temp files land here
try {
  const Database = require('better-sqlite3');
  const db = new Database(path.join(root, 'live.sqlite'));
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE works (nodus_id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE ideas (global_id TEXT PRIMARY KEY, label TEXT, embedding BLOB);
    CREATE TABLE passages (passage_id TEXT PRIMARY KEY, text TEXT, embedding BLOB);
    CREATE TABLE work_summaries (nodus_id TEXT PRIMARY KEY, summary TEXT, embedding BLOB);
  `);
  db.prepare("INSERT INTO works VALUES ('w1', 'Obra uno')").run();
  db.prepare("INSERT INTO ideas VALUES ('g-0001', 'Idea', ?)").run(Buffer.from(new Float32Array([1, 0]).buffer));
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
    'app',
    JSON.stringify({ zoteroUserId: '42', mcpEnabled: true, mcpToken: 'SECRET-TOKEN', autoBackupIntervalHours: 24 })
  );

  const bundle = await bundleModules();
  globalThis.__backupTestDb = db;
  globalThis.__backupTestPassword = 'mi-frase-maestra';
  globalThis.__backupTestRecoveryKey = null;
  const { autoBackup, exportImport, crypto, settingsRepo } = require(bundle);
  const AdmZip = require('adm-zip');

  // ── Pure scheduling + naming logic ──────────────────────────────────────────
  assert.equal(autoBackup.isBackupDue(null, 24), true, 'never backed up → due');
  assert.equal(autoBackup.isBackupDue(new Date(Date.now() - 2 * 3600e3).toISOString(), 24), false, '2h ago on 24h cadence → not due');
  assert.equal(autoBackup.isBackupDue(new Date(Date.now() - 25 * 3600e3).toISOString(), 24), true, '25h ago → due');
  assert.equal(autoBackup.isBackupDue('garbage-date', 24), true, 'unparseable timestamp → fail open (due)');

  // ── Schedule by day(s)-of-week + time, with startup catch-up semantics ──────
  const now = new Date(2026, 6, 10, 10, 0, 0); // fixed reference: 10:00 local
  const at = (dayOffset, h, m = 0) => new Date(2026, 6, 10 + dayOffset, h, m, 0).toISOString();
  // Daily schedule at 03:00.
  assert.equal(autoBackup.isScheduledBackupDue(null, [], 3, 0, now), true, 'never backed up → due');
  assert.equal(autoBackup.isScheduledBackupDue(at(0, 9), [], 3, 0, now), false, 'already backed up after today’s 03:00 slot → not due');
  assert.equal(autoBackup.isScheduledBackupDue(at(-1, 9), [], 3, 0, now), true, 'last backup yesterday → today’s slot passed → due');
  // Startup catch-up: machine was off for a week, daily schedule → due on next launch.
  assert.equal(autoBackup.isScheduledBackupDue(at(-8, 9), [], 3, 0, now), true, 'missed slots while off → due at next start');
  // Weekly on today's weekday → today's slot applies like the daily case.
  const today = now.getDay();
  const tomorrow = (today + 1) % 7;
  assert.equal(autoBackup.isScheduledBackupDue(at(-1, 9), [today], 3, 0, now), true, 'scheduled weekday, last backup yesterday → due');
  assert.equal(autoBackup.isScheduledBackupDue(at(-1, 9), [tomorrow], 3, 0, now), false, 'not a scheduled weekday today → last slot was days ago, already covered');
  // A slot exactly now counts as passed.
  assert.equal(autoBackup.isScheduledBackupDue(at(-1, 9), [], 10, 0, now), true, 'slot at exactly now has passed');

  assert.equal(autoBackup.sanitizeHostname('MacBook-Pro-de-Jorge.local'), 'macbook-pro-de-jorge');
  const name = autoBackup.backupFileName('MacBook-Pro-de-Jorge.local', new Date(2026, 6, 10, 9, 30, 5));
  assert.equal(name, 'nodus-backup-macbook-pro-de-jorge-20260710-093005.nodus');

  // ── GFS retention, scoped to this machine's lineage ────────────────────────
  const mk = (host, y, m, d, hh = 3) => autoBackup.backupFileName(host, new Date(y, m - 1, d, hh, 0, 0));
  const mine = [];
  for (let day = 1; day <= 20; day++) mine.push(mk('mac-a', 2026, 7, day)); // 20 daily backups
  mine.push(mk('mac-a', 2026, 6, 15), mk('mac-a', 2026, 5, 20), mk('mac-a', 2026, 4, 25)); // older months
  const theirs = [mk('mac-b', 2026, 7, 1), mk('mac-b', 2026, 7, 2)];
  const doomed = autoBackup.selectBackupsToPrune('mac-a', [...mine, ...theirs, 'unrelated.txt']);

  assert.ok(!doomed.some((f) => f.includes('mac-b')), 'other machines’ lineages untouched');
  assert.ok(!doomed.includes('unrelated.txt'), 'non-backup files untouched');
  for (let day = 14; day <= 20; day++) assert.ok(!doomed.includes(mk('mac-a', 2026, 7, day)), `newest 7 dailies kept (day ${day})`);
  assert.ok(!doomed.includes(mk('mac-a', 2026, 6, 15)), 'monthly grandfather kept (June)');
  assert.ok(!doomed.includes(mk('mac-a', 2026, 5, 20)), 'monthly grandfather kept (May)');
  assert.ok(doomed.includes(mk('mac-a', 2026, 7, 3)), 'mid-month surplus pruned');
  assert.ok(doomed.length >= 8, `a real chunk of surplus goes (${doomed.length} pruned)`);

  // ── Real v6 full backup: recovery key, secrets, atomic write ────────────────
  const backupDir = path.join(root, 'backups');
  await mkdir(backupDir, { recursive: true });
  settingsRepo.updateSettings({
    autoBackupFolder: backupDir,
    // Simulate stale granular preferences from an older release. They must not
    // be able to reduce a new backup under the full-state invariant.
    backupVaultIds: ['does-not-exist'],
    backupIncludePreferences: false,
    backupIncludeHistories: false,
    backupIncludeGeneratedMedia: false,
    backupIncludeApiKeys: false,
  });

  const result = await autoBackup.runAutoBackupNow('9.9.9-test');
  assert.equal(result.ok, true, `backup runs: ${result.message}`);
  const written = (await readdir(backupDir)).filter((f) => f.endsWith('.nodus'));
  assert.equal(written.length, 1, 'exactly one archive, no .tmp leftovers');

  const zip = new AdmZip(path.join(backupDir, written[0]));
  const manifest = JSON.parse(zip.readAsText('manifest.json'));
  assert.equal(manifest.format, 'nodus.encrypted-backup');
  assert.equal(manifest.formatVersion, 6, 'automatic backups are v6 (password + independent recovery key)');
  assert.equal(manifest.includesSecrets, true);
  assert.equal(manifest.appVersion, '9.9.9-test');
  assert.ok(manifest.vaultCount >= 1, 'at least one vault backed up');

  assert.ok(zip.getEntry('recovery-key.bin'), 'password-wrapped recovery key is present');
  const recoveredKey = crypto.decryptBackupPayload(
    zip.getEntry('recovery-key.bin').getData(),
    'mi-frase-maestra',
    manifest.recovery.wrappedKeyCipher
  ).toString('utf8');
  assert.equal(recoveredKey, globalThis.__backupTestRecoveryKey, 'master password unwraps the stable recovery key');
  const payload = new AdmZip(crypto.decryptBackupPayload(zip.getEntry('backup.bin').getData(), recoveredKey, manifest.cipher));
  const names = payload.getEntries().map((e) => e.entryName).sort();
  assert.ok(names.includes('api-keys.json'), 'API keys are protected inside the encrypted full-state payload');
  assert.ok(names.includes('registry.json'), 'the vault registry is included');
  const dbEntryName = names.find((n) => /^vaults\/.+\/database\.sqlite$/.test(n));
  const invEntryName = names.find((n) => /^vaults\/.+\/inventory\.json$/.test(n));
  assert.ok(dbEntryName && invEntryName, 'each vault carries its DB snapshot + inventory');
  const registry = JSON.parse(payload.readAsText('registry.json'));
  assert.ok(Array.isArray(registry.vaults) && registry.vaults.length >= 1, 'registry lists the vaults');
  const payloadManifest = JSON.parse(payload.readAsText('payload-manifest.json'));
  assert.deepEqual(payloadManifest.selection, {
    vaultIds: [],
    includePreferences: true,
    includeHistories: true,
    includeGeneratedMedia: true,
    includeApiKeys: true,
  }, 'stale granular settings are overridden by the full-state backup invariant');

  // The DB snapshot inside is a valid SQLite file with the scrubbed settings row.
  const snapshotFile = path.join(root, 'snapshot-check.sqlite');
  await writeFile(snapshotFile, payload.getEntry(dbEntryName).getData());
  const snap = new Database(snapshotFile, { readonly: true });
  const snapSettings = JSON.parse(snap.prepare("SELECT value FROM settings WHERE key = 'app'").get().value);
  assert.equal(snapSettings.mcpToken, undefined, 'token scrubbed inside the DB snapshot too');
  assert.equal(snap.prepare('SELECT COUNT(*) AS n FROM ideas').get().n, 1, 'graph data present in snapshot');
  snap.close();

  assert.throws(
    () => crypto.decryptBackupPayload(zip.getEntry('recovery-key.bin').getData(), 'contraseña-equivocada', manifest.recovery.wrappedKeyCipher),
    'wrong master password refuses to unwrap the recovery key'
  );
  assert.doesNotThrow(() => crypto.decryptBackupPayload(zip.getEntry('backup.bin').getData(), recoveredKey, manifest.cipher), 'recovery key independently decrypts the payload');

  // Status + timestamp persisted for the UI and the scheduler.
  const appSettings = settingsRepo.getSettings();
  assert.ok(appSettings.lastAutoBackupAt, 'lastAutoBackupAt recorded');
  assert.ok(String(appSettings.lastAutoBackupStatus).startsWith('ok:'), 'status recorded');

  // ── maybeRunAutoBackup gating ───────────────────────────────────────────────
  assert.equal(await autoBackup.maybeRunAutoBackup('9.9.9-test'), null, 'disabled → no run');
  settingsRepo.updateSettings({ autoBackupEnabled: true });
  assert.equal(await autoBackup.maybeRunAutoBackup('9.9.9-test'), null, 'enabled but fresh → no run');
  settingsRepo.updateSettings({ lastAutoBackupAt: new Date(Date.now() - 48 * 3600e3).toISOString() });
  const scheduled = await autoBackup.maybeRunAutoBackup('9.9.9-test');
  assert.equal(scheduled?.ok, true, 'overdue → scheduler runs a backup');

  // Missing password pauses cleanly instead of erroring.
  globalThis.__backupTestPassword = null;
  assert.equal(await autoBackup.maybeRunAutoBackup('9.9.9-test'), null, 'no master password → paused, no error');
  globalThis.__backupTestPassword = 'mi-frase-maestra';

  // ── Manual exports also provide a second independent recovery credential ───
  const manualRecoveryKey = 'clave-recuperacion-manual-independiente';
  const manual = await exportImport.createBackupArchive({ password: 'clave-manual-larga', recoveryKey: manualRecoveryKey, appVersion: 'x' });
  const manualZip = new AdmZip(manual);
  const manualManifest = JSON.parse(manualZip.readAsText('manifest.json'));
  assert.equal(manualManifest.formatVersion, 6, 'manual export is v6 and supports an independent recovery key');
  assert.equal(manualManifest.includesSecrets, true, 'manual export includes secrets');
  const manualPayload = new AdmZip(
    crypto.decryptBackupPayload(manualZip.getEntry('backup.bin').getData(), manualRecoveryKey, manualManifest.cipher)
  );
  assert.ok(manualPayload.getEntry('api-keys.json'), 'manual export still carries keys');

  db.close();
  console.log('auto backup (master password + GFS retention) test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

/** Bundle the real modules with database + secretStore stubbed and electron aliased. */
async function bundleModules() {
  const dbStub = path.join(root, 'stub-database.js');
  await writeFile(
    dbStub,
    'export function getDb() { return globalThis.__backupTestDb; }\nexport const SCHEMA_VERSION = 28;\n' +
      'export function closeDb() {}\nexport function replaceDbFile() {}\n'
  );
  const secretsStub = path.join(root, 'stub-secrets.js');
  await writeFile(
    secretsStub,
    [
      'export function getBackupPassword() { return globalThis.__backupTestPassword ?? null; }',
      'export function hasBackupPassword() { return Boolean(globalThis.__backupTestPassword); }',
      'export function getBackupRecoveryKey() { return globalThis.__backupTestRecoveryKey ?? null; }',
      'export function setBackupRecoveryKey(value) { globalThis.__backupTestRecoveryKey = value; }',
      "export function getApiKey(p) { return p === 'openai' ? 'sk-test' : null; }",
      'export function setApiKey() {}',
      'export function clearApiKey() {}',
      'export function providerKeyMap() { return {}; }',
    ].join('\n')
  );
  const entry = path.join(root, 'entry.ts');
  await writeFile(
    entry,
    [
      `export * as autoBackup from ${JSON.stringify(path.join(repoRoot, 'electron/export/autoBackup.ts'))};`,
      `export * as exportImport from ${JSON.stringify(path.join(repoRoot, 'electron/export/exportImport.ts'))};`,
      `export * as crypto from ${JSON.stringify(path.join(repoRoot, 'electron/export/backupCrypto.ts'))};`,
      `export * as settingsRepo from ${JSON.stringify(path.join(repoRoot, 'electron/db/settingsRepo.ts'))};`,
    ].join('\n')
  );
  const out = path.join(root, 'bundle.cjs');
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['better-sqlite3'],
    alias: { '@shared': path.join(repoRoot, 'shared'), electron: path.join(repoRoot, 'scripts/stub-electron.mjs') },
    plugins: [
      {
        name: 'stub-deps',
        setup(api) {
          api.onResolve({ filter: /\/database$|^\.\/database$|\.\.\/db\/database$/ }, () => ({ path: dbStub }));
          api.onResolve({ filter: /secretStore$/ }, () => ({ path: secretsStub }));
        },
      },
    ],
  });
  return out;
}
