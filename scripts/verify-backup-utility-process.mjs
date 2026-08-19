import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const worker = path.join(repo, 'dist-electron', 'backupUtilityWorker.js');
assert.ok(fs.existsSync(worker), 'build must emit a self-contained backupUtilityWorker.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-backup-utility-'));
try {
  const stdout = execFileSync(
    path.join(repo, 'node_modules', '.bin', 'electron'),
    [path.join(repo, 'scripts', 'fixtures', 'backup-utility-app')],
    {
      cwd: repo,
      env: {
        ...process.env,
        NODUS_BACKUP_UTILITY_TMP: temp,
        NODUS_BACKUP_UTILITY_WORKER: worker,
        NODUS_REPO_NODE_MODULES: path.join(repo, 'node_modules'),
      },
      encoding: 'utf8',
    },
  );
  const result = JSON.parse(stdout.trim().split('\n').at(-1));
  assert.notEqual(result.childPid, result.mainPid, 'snapshot and verification execute in another OS process');
  assert.ok(result.heartbeats > 0, 'the Electron main event loop advanced during VACUUM INTO');
  assert.equal(result.quickCheck, 'ok');
  assert.equal(result.bytes, 64 * 1024 * 1024);
  assert.equal(result.snapshotKind, 'snapshot-done');
  assert.equal(result.verify.kind, 'verify-done');
  assert.equal(result.verify.result.ok, false, 'the utility verifier rejects a malformed archive');
  console.log(`[verify][backup-utility] mainPid=${result.mainPid} childPid=${result.childPid} heartbeats=${result.heartbeats} bytes=${result.bytes}`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
