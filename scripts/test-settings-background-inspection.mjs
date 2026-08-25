import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import os from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
const require = createRequire(import.meta.url);
let forkUtility = () => { throw new Error('unexpected migration utility launch'); };
installRuntimeHooks(os.tmpdir(), { utilityProcess: { fork: (...args) => forkUtility(...args) } });

test('migration snapshot validation runs in a disposable utility process', () => {
  const ipc = source('electron/ipc.ts');
  const host = source('electron/db/migrationRecoveryUtilityHost.ts');
  const worker = source('electron/db/migrationRecoveryUtilityWorker.ts');
  const vite = source('vite.config.ts');

  assert.match(ipc, /listMigrationRecoverySnapshotsInUtility\(getActiveVault\(\)\.path\)/);
  assert.doesNotMatch(ipc, /listMigrationRecoverySnapshots\(getActiveVault\(\)\.path\)/);
  assert.match(host, /utilityProcess\.fork\(file/);
  assert.match(host, /const inFlight = new Map/, 'repeated opens coalesce instead of scanning the same vault twice');
  assert.match(worker, /snapshots: listMigrationRecoverySnapshots\(request\.databasePath\)/);
  assert.match(vite, /utilityBuild\('migrationRecoveryUtilityWorker'/);
});

test('repeated requests coalesce and the migration utility is reaped', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-settings-utility-'));
  const workerFile = path.join(root, 'migrationRecoveryUtilityWorker.js');
  fs.writeFileSync(workerFile, '// existence sentinel');
  let forks = 0;
  let kills = 0;
  class FakeUtility extends EventEmitter {
    postMessage(request) {
      queueMicrotask(() => this.emit('message', { kind: 'list-done', id: request.id, snapshots: [] }));
    }
    kill() { kills += 1; return true; }
  }
  forkUtility = (file, args, options) => {
    forks += 1;
    assert.equal(file, workerFile);
    assert.deepEqual(args, []);
    assert.equal(options.serviceName, 'Nodus migration recovery validation');
    return new FakeUtility();
  };
  const previousWorker = process.env.NODUS_MIGRATION_RECOVERY_UTILITY_FILE;
  const previousRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
  process.env.NODUS_MIGRATION_RECOVERY_UTILITY_FILE = workerFile;
  delete process.env.ELECTRON_RUN_AS_NODE;
  try {
    const host = require(path.join(repoRoot, 'electron/db/migrationRecoveryUtilityHost.ts'));
    const databasePath = path.join(root, 'vault.sqlite');
    const [first, second] = await Promise.all([
      host.listMigrationRecoverySnapshotsInUtility(databasePath),
      host.listMigrationRecoverySnapshotsInUtility(databasePath),
    ]);
    assert.deepEqual(first, []);
    assert.deepEqual(second, []);
    assert.equal(forks, 1, 'one vault scan serves both callers');
    assert.equal(kills, 1, 'the one-shot child is killed after returning its result');
  } finally {
    if (previousWorker === undefined) delete process.env.NODUS_MIGRATION_RECOVERY_UTILITY_FILE;
    else process.env.NODUS_MIGRATION_RECOVERY_UTILITY_FILE = previousWorker;
    if (previousRunAsNode === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
    else process.env.ELECTRON_RUN_AS_NODE = previousRunAsNode;
    forkUtility = () => { throw new Error('unexpected migration utility launch'); };
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Settings starts expensive inspections only for the visible tab', () => {
  const settings = source('src/views/Settings.tsx');
  assert.match(settings, /if \(!dataTabRequested \|\| !activeVault\)/);
  assert.match(settings, /if \(!dataTabRequested \|\| !settings\.autoBackupFolder\)/);
  assert.match(settings, /if \(!integrationsTabRequested\) return;/);
  assert.match(settings, /if \(!serverTabRequested\) return;/);
});

test('backup-folder preview uses asynchronous filesystem calls', () => {
  const backup = source('electron/export/autoBackup.ts');
  const start = backup.indexOf('async function readCleanupContext');
  const end = backup.indexOf('function cleanupPreviewFromContext', start);
  const inspection = backup.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(inspection, /await fs\.promises\.lstat/);
  assert.match(inspection, /await fs\.promises\.readdir/);
  assert.doesNotMatch(inspection, /lstatSync|readdirSync|existsSync/);
  assert.match(inspection, /export async function previewBackupCleanup/);
});
