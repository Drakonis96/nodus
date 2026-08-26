import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acquireDataDirectoryLock } from '../lib/dataDirectoryLock.mjs';

test('a server data directory has exactly one writer and stale locks recover', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-data-lock-'));
  try {
    const first = acquireDataDirectoryLock(root);
    assert.throws(() => acquireDataDirectoryLock(root), /already in use/);
    first.release();
    fs.writeFileSync(path.join(root, '.nodus-server.lock'), JSON.stringify({ pid: 999_999_999, token: 'stale' }));
    const recovered = acquireDataDirectoryLock(root);
    assert.ok(fs.existsSync(recovered.file));
    recovered.release();

    // A restarted container normally reuses PID 1. Simulate that PID reuse with this
    // process: a lock from an older process birth must not block the new server.
    fs.writeFileSync(path.join(root, '.nodus-server.lock'), JSON.stringify({
      pid: process.pid,
      processStartedAtMs: Date.now() - 24 * 60 * 60_000,
      token: 'previous-container',
    }));
    const afterPidReuse = acquireDataDirectoryLock(root);
    assert.ok(fs.existsSync(afterPidReuse.file));
    afterPidReuse.release();

    // Upgrade compatibility: old locks did not contain the process birth marker. When
    // their PID equals the new container's PID they are stale by construction.
    fs.writeFileSync(path.join(root, '.nodus-server.lock'), JSON.stringify({ pid: process.pid, token: 'legacy-container' }));
    const afterLegacyPidReuse = acquireDataDirectoryLock(root);
    afterLegacyPidReuse.release();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
