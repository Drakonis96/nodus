import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../lib/store.mjs';

test('all server filesystem namespaces reject traversal and malformed hashes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-paths-'));
  try {
    const store = new Store(root);
    for (const call of [
      () => store.snapshotPath('../other-user'),
      () => store.assetPath('space', '../../secret'),
      () => store.sharedBlobUploadDir('space/child', 'a'.repeat(64)),
      () => store.vectorsPath('space', '../ideas'),
    ]) assert.throws(call);
    const safe = store.assetPath('space-safe', 'a'.repeat(64));
    assert.equal(path.relative(root, safe).startsWith('..'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
