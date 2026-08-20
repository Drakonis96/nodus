import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

test('snapshot and verification are one-shot Electron utility processes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-backup-utility-host-'));
  const worker = path.join(root, 'backupUtilityWorker.js');
  fs.writeFileSync(worker, '// host existence check');
  let kills = 0;
  const requests = [];
  class FakeChild extends EventEmitter {
    postMessage(request) {
      requests.push(request);
      const response = request.kind === 'snapshot'
        ? { kind: 'snapshot-done', id: request.id, reused: false, sourceFingerprint: 'revision:134:2' }
        : { kind: 'verify-done', id: request.id, result: { ok: true, message: 'verified' } };
      queueMicrotask(() => this.emit('message', response));
    }
    kill() { kills += 1; return true; }
  }
  installRuntimeHooks(root, { utilityProcess: { fork: () => new FakeChild() } });
  process.env.NODUS_BACKUP_UTILITY_FILE = worker;
  try {
    const host = require(path.join(repoRoot, 'electron/export/backupUtilityHost.ts'));
    const snapshot = await host.snapshotVaultInUtility({
      sourcePath: '/synthetic/vault.sqlite', targetPath: '/synthetic/snapshot.sqlite',
      cacheDir: '/synthetic/cache', vaultId: 'v1',
    });
    assert.equal(snapshot.reused, false);
    assert.equal((await host.verifyBackupFileInUtility('/synthetic/backup.nodus', 'password-long')).ok, true);
    assert.deepEqual(requests.map((request) => request.kind), ['snapshot', 'verify']);
    assert.equal(kills, 2, 'both utility processes are reaped after their one response');
  } finally {
    delete process.env.NODUS_BACKUP_UTILITY_FILE;
    await rm(root, { recursive: true, force: true });
  }
});

test('production backup contains no sqlite backup or synchronous auto verification fallback', () => {
  const worker = fs.readFileSync(path.join(repoRoot, 'electron/export/backupUtilityWorker.ts'), 'utf8');
  const host = fs.readFileSync(path.join(repoRoot, 'electron/export/backupUtilityHost.ts'), 'utf8');
  const writer = fs.readFileSync(path.join(repoRoot, 'electron/export/exportImport.ts'), 'utf8');
  const automatic = fs.readFileSync(path.join(repoRoot, 'electron/export/autoBackup.ts'), 'utf8');
  assert.match(host, /utilityProcess\.fork\(/);
  assert.match(worker, /VACUUM INTO/);
  assert.match(worker, /await verifyBackupFile\(/);
  assert.doesNotMatch(worker, /readFile\(request\.archivePath\)/);
  assert.doesNotMatch(writer, /\.backup\(/);
  assert.match(writer, /await zip\.addFile\('backup\.bin', ciphertextPath, true\)/);
  assert.match(writer, /restoreBackupArchiveFileSafely/);
  assert.match(automatic, /await verifyBackupFileInUtility\(target, password\)/);
  assert.doesNotMatch(automatic, /verifyBackupArchive\(|readFile\(target\)/);

  const recovery = fs.readFileSync(path.join(repoRoot, 'electron/recovery/recoveryManager.ts'), 'utf8');
  assert.match(recovery, /readZipEntrySync\(filePath, 'manifest\.json'/);
  assert.match(recovery, /restoreBackupArchiveFileSafely\(snapshot\.path/);
  assert.doesNotMatch(recovery, /new AdmZip\(filePath\)|readFileSync\(snapshot\.path\)/);
});
