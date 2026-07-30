// The eviction policy for the extracted-text cache.
//
// That cache is written with an upsert and, until this branch, never read back
// out again: on a real library it held 105 MB of PDF text across 211 rows — about
// a quarter of the vault file, copied whole into every backup. Nothing in it is
// authoritative, so the only thing worth testing is that the policy frees what it
// promises and never keeps more than the cap.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-extraction-prune-'));
const bundle = path.join(dir, 'extractionCachePrune.cjs');

execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
  path.join(repoRoot, 'shared/extractionCachePrune.ts'),
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${bundle}`,
]);

const { planExtractionCacheEviction } = createRequire(import.meta.url)(bundle);

const MB = 1024 * 1024;
/** `n` entries of `bytes` each, oldest first. */
function entries(n, bytes) {
  return Array.from({ length: n }, (_, i) => ({
    filePath: `/docs/${String(i).padStart(3, '0')}.pdf`,
    bytes,
    updatedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
  }));
}

test('keeps everything when the cache is under the cap', () => {
  const plan = planExtractionCacheEviction(entries(10, MB), { maxBytes: 64 * MB });
  assert.deepEqual(plan.remove, []);
  assert.equal(plan.freedBytes, 0);
  assert.equal(plan.keptBytes, 10 * MB);
});

test('trims to the cap keeping the newest', () => {
  // 10 MB of entries, 4 MB cap: the four newest survive.
  const plan = planExtractionCacheEviction(entries(10, MB), { maxBytes: 4 * MB });
  assert.equal(plan.keptBytes, 4 * MB);
  assert.equal(plan.freedBytes, 6 * MB);
  assert.deepEqual(
    plan.remove.sort(),
    ['/docs/000.pdf', '/docs/001.pdf', '/docs/002.pdf', '/docs/003.pdf', '/docs/004.pdf', '/docs/005.pdf']
  );
});

test('never keeps more than the cap — the property the 105 MB cache violated', () => {
  for (const [count, size, cap] of [
    [211, 512 * 1024, 64 * MB],
    [1, 200 * MB, 64 * MB],
    [50, 3 * MB, 10 * MB],
    [0, 0, 64 * MB],
  ]) {
    const plan = planExtractionCacheEviction(entries(count, size), { maxBytes: cap });
    assert.ok(plan.keptBytes <= cap, `kept ${plan.keptBytes} > cap ${cap}`);
    assert.equal(plan.keptBytes + plan.freedBytes, count * size);
  }
});

test('a single oversized entry is evicted rather than kept over the cap', () => {
  // Guards the boundary the obvious implementation gets wrong: subtracting until
  // the total fits leaves one entry that is itself larger than the whole budget.
  const plan = planExtractionCacheEviction(
    [{ filePath: '/docs/huge.pdf', bytes: 200 * MB, updatedAt: '2026-07-01T00:00:00.000Z' }],
    { maxBytes: 64 * MB }
  );
  assert.deepEqual(plan.remove, ['/docs/huge.pdf']);
  assert.equal(plan.keptBytes, 0);
});

test('the plan is deterministic when timestamps tie', () => {
  const tied = ['b', 'a', 'c'].map((name) => ({
    filePath: `/docs/${name}.pdf`,
    bytes: MB,
    updatedAt: '2026-07-01T00:00:00.000Z',
  }));
  const first = planExtractionCacheEviction(tied, { maxBytes: 2 * MB });
  const again = planExtractionCacheEviction([...tied].reverse(), { maxBytes: 2 * MB });
  assert.deepEqual(first.remove, again.remove);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
