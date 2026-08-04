// The parsed publications the server holds, and what bounds them.
//
// The cache used to keep three snapshots of any size. On a real academic corpus one
// publication is 99 MB of JSON and 331 MB of heap, so "three" quietly authorised a gigabyte;
// on a server with eight small spaces the same rule evicted snapshots it had room for many
// times over. A count is not a memory limit. These tests describe the byte budget that
// replaced it, and the one case it must never enforce: a space larger than the whole budget
// still has to be servable.

import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { SnapshotCache } from '../server/lib/snapshotCache.mjs';
import { freePort, repoRoot, serverEnvironment, withServer } from './lib/nodusServerHarness.mjs';

const snapshot = (id) => ({ tables: { works: [{ nodus_id: id }] } });

test('the budget is bytes, so small spaces are not evicted to honour a count', () => {
  const cache = new SnapshotCache(100);
  for (let index = 0; index < 10; index += 1) cache.set(`s-${index}`, 1, snapshot(`s-${index}`), 10);

  // The old rule kept three of anything. Ten spaces at ten bytes fit in a hundred bytes, and
  // the point of counting bytes is that they are all still here.
  assert.equal(cache.size, 10);
  assert.equal(cache.heldBytes, 100);

  // One more pushes past the ceiling, and exactly enough is dropped, oldest first.
  cache.set('s-10', 1, snapshot('s-10'), 10);
  assert.equal(cache.size, 10);
  assert.equal(cache.heldBytes, 100);
  assert.deepEqual(cache.ids()[0], 's-1', 'the least recently used entry should have gone first');
  assert.equal(cache.get('s-0', 1), null, 'the evicted space must miss');
});

test('a large space evicts many small ones, which a count could never express', () => {
  const cache = new SnapshotCache(100);
  for (let index = 0; index < 8; index += 1) cache.set(`small-${index}`, 1, snapshot(`small-${index}`), 12);
  cache.set('large', 1, snapshot('large'), 96);

  assert.deepEqual(cache.ids(), ['large']);
  assert.equal(cache.heldBytes, 96);
});

test('reading a space saves it from the next eviction', () => {
  const cache = new SnapshotCache(30);
  cache.set('a', 1, snapshot('a'), 10);
  cache.set('b', 1, snapshot('b'), 10);
  cache.set('c', 1, snapshot('c'), 10);

  // 'a' is the oldest by insertion and would be dropped next. Reading it makes it the newest:
  // without this the space every request touches is evicted ahead of one nobody has opened.
  assert.deepEqual(cache.get('a', 1), snapshot('a'));
  cache.set('d', 1, snapshot('d'), 10);

  assert.deepEqual(cache.ids(), ['c', 'a', 'd']);
  assert.equal(cache.get('b', 1), null);
});

test('a space larger than the whole budget is still served', () => {
  const cache = new SnapshotCache(100);
  cache.set('huge', 1, snapshot('huge'), 5_000);

  // Evicting it would mean answering the request that just loaded it with something this
  // process no longer has, and re-reading 5 KB — or 99 MB — on every request after that.
  assert.deepEqual(cache.get('huge', 1), snapshot('huge'));
  assert.equal(cache.heldBytes, 5_000);

  // And it does not pin the cache: the next space to be loaded takes its place.
  cache.set('ordinary', 1, snapshot('ordinary'), 10);
  assert.deepEqual(cache.ids(), ['ordinary']);
});

test('a republished space is re-read rather than served stale', () => {
  const cache = new SnapshotCache(100);
  cache.set('a', 1_000, snapshot('first'), 10);
  assert.equal(cache.get('a', 2_000), null, 'a newer file on disk has to miss');
  assert.deepEqual(cache.get('a', 1_000), snapshot('first'));
});

test('deleting a space returns its bytes to the budget', () => {
  const cache = new SnapshotCache(100);
  cache.set('a', 1, snapshot('a'), 60);
  cache.set('b', 1, snapshot('b'), 30);
  assert.equal(cache.heldBytes, 90);

  assert.equal(cache.delete('a'), true);
  assert.equal(cache.heldBytes, 30);
  assert.equal(cache.delete('a'), false, 'deleting twice must not charge the budget twice');
  assert.equal(cache.heldBytes, 30);
});

test('a space bigger than the cache budget serves every request', { timeout: 30_000 }, async () => {
  // 64 KiB is the smallest budget the server accepts, and the publication below is larger
  // than that on purpose: this is the deployment where the ceiling is set too low for the
  // corpus, and it has to keep working rather than half-work.
  await withServer({ label: 'snapshot-cache', env: { NODUS_MAX_SNAPSHOT_CACHE_BYTES: String(64 * 1024) } }, async (context) => {
    const spaceId = await context.createSpace('Oversized');
    const owner = await context.deviceToken(context.adminEmail, context.adminPassword, spaceId);
    const works = Array.from({ length: 400 }, (_, index) => ({
      nodus_id: `w-${index}`,
      title: `A work with a title long enough to matter ${index}`,
      authors_json: '[]',
    }));
    const body = gzipSync(Buffer.from(JSON.stringify({
      format: 'nodus.server-snapshot',
      formatVersion: 2,
      vault: { id: 'v', name: 'Oversized', type: 'academic' },
      capabilities: {},
      assets: [],
      tables: { works },
    })));
    const published = await context.api(owner.deviceToken, 'PUT', `/api/v1/spaces/${spaceId}/snapshot`, {
      headers: { 'content-type': 'application/vnd.nodus.snapshot+json', 'content-encoding': 'gzip', 'x-nodus-revision': 'r1' },
      body,
    });
    assert.equal(published.status, 200, await published.text());

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await context.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/works?limit=5`);
      assert.equal(response.status, 200, `request ${attempt} failed`);
      const value = await response.json();
      assert.equal(value.total, 400, `request ${attempt} saw a different corpus`);
    }
  });
});

test('the count-based setting is refused rather than ignored', { timeout: 10_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-server-cache-env-test-'));
  const child = spawn(process.execPath, ['server/server.mjs'], {
    cwd: repoRoot,
    env: serverEnvironment({
      NODUS_DATA_DIR: root,
      NODUS_HOST: '127.0.0.1',
      NODUS_PORT: String(await freePort()),
      NODUS_MAX_CACHED_SNAPSHOTS: '3',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  try {
    // Booting anyway would leave an operator believing they had capped this process.
    assert.notEqual(await new Promise((resolve) => child.once('exit', resolve)), 0);
    assert.match(logs.join(''), /NODUS_MAX_CACHED_SNAPSHOTS has been replaced by NODUS_MAX_SNAPSHOT_CACHE_BYTES/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
