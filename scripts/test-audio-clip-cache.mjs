// Verifies the narrated-audio cache is actually bounded.
//
// Clips are held as base64 `data:` URLs and the player's cache had no bound: it
// was only cleared when the provider unmounted, and that provider wraps the
// whole app. Every clip ever played stayed pinned in the renderer heap for the
// session, so listening time translated directly into RSS that never came back.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-audio-cache-'));
const bundle = path.join(dir, 'audioClipCache.cjs');

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'src/audioClipCache.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

const require = createRequire(import.meta.url);
const { AudioClipCache, DEFAULT_MAX_BYTES } = require(bundle);

const clip = (size) => 'x'.repeat(size);

try {
  // --- 1. The unbounded case is what we are fixing ------------------------
  // A long listening session: 500 clips of 1 MB each.
  {
    const cache = new AudioClipCache(10 * 1024 * 1024); // 10 MB budget
    for (let i = 0; i < 500; i += 1) cache.set(`clip-${i}`, clip(1024 * 1024));
    assert.ok(
      cache.size <= 10 * 1024 * 1024,
      `cache must stay within its budget, held ${cache.size} bytes`
    );
    assert.ok(cache.count <= 10, `only a bounded number of clips may be retained (${cache.count})`);
    // Without the bound this would have been 500 MB.
    assert.ok(cache.size < 500 * 1024 * 1024 * 0.05, 'the cache must hold a small fraction of what was played');
  }

  // --- 2. Least-recently-used is what goes ---------------------------------
  {
    const cache = new AudioClipCache(300);
    cache.set('a', clip(100));
    cache.set('b', clip(100));
    cache.set('c', clip(100));
    assert.equal(cache.count, 3, 'all three fit exactly');

    // Touch 'a' so 'b' becomes the least recently used.
    assert.ok(cache.get('a'), 'a must still be cached');
    cache.set('d', clip(100));

    assert.ok(cache.has('a'), 'recently used entry must survive');
    assert.ok(!cache.has('b'), 'least-recently-used entry must be evicted');
    assert.ok(cache.has('c'), 'c must survive');
    assert.ok(cache.has('d'), 'the new entry must be cached');
    assert.equal(cache.size, 300, 'size accounting must stay exact after eviction');
  }

  // --- 3. Re-setting the same id must not double-count --------------------
  {
    const cache = new AudioClipCache(1000);
    cache.set('a', clip(100));
    cache.set('a', clip(200));
    assert.equal(cache.count, 1, 'the same id must occupy one slot');
    assert.equal(cache.size, 200, 'size must reflect the replacement, not the sum');
    assert.equal(cache.get('a').length, 200, 'the newer value must win');
  }

  // --- 4. A clip larger than the whole budget is not cached ---------------
  // Caching it would evict everything else and still not fit.
  {
    const cache = new AudioClipCache(1000);
    cache.set('small', clip(100));
    cache.set('huge', clip(5000));
    assert.ok(!cache.has('huge'), 'an oversized clip must not be cached');
    assert.ok(cache.has('small'), 'an oversized clip must not evict everything else');
    assert.equal(cache.size, 100, 'size accounting must be unaffected');
  }

  // --- 5. Misses and clearing ---------------------------------------------
  {
    const cache = new AudioClipCache(1000);
    assert.equal(cache.get('nope'), undefined, 'a miss must return undefined');
    cache.set('a', clip(100));
    cache.clear();
    assert.equal(cache.count, 0, 'clear must drop every entry');
    assert.equal(cache.size, 0, 'clear must reset the byte count');
    assert.equal(cache.get('a'), undefined, 'nothing survives a clear');
  }

  // --- 6. Replaying stays cheap -------------------------------------------
  // Repeated playback of the same short playlist must never evict anything.
  {
    const cache = new AudioClipCache(1000);
    for (let round = 0; round < 50; round += 1) {
      for (const id of ['a', 'b', 'c']) {
        if (!cache.has(id)) cache.set(id, clip(100));
        cache.get(id);
      }
    }
    assert.equal(cache.count, 3, 'a stable playlist must stay fully cached');
    assert.equal(cache.size, 300, 'repeated playback must not inflate the accounting');
  }

  // --- 7. The default budget is sane --------------------------------------
  {
    assert.ok(DEFAULT_MAX_BYTES >= 16 * 1024 * 1024, 'budget must hold a real listening session');
    assert.ok(DEFAULT_MAX_BYTES <= 256 * 1024 * 1024, 'budget must not defeat the purpose');
  }

  console.log('# audio clip cache tests passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
