import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-roadmap-'));

/** Bundle a TS module so its real exported values can be asserted on. */
function load(file) {
  const bundle = path.join(outDir, `${path.basename(file).replace(/\.tsx?$/, '')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
      '--loader:.tsx=tsx', '--jsx=automatic', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  return require(bundle);
}

const { TEACHING_GROUPS } = load('src/components/TeachingSidebar.tsx');
const items = TEACHING_GROUPS.flatMap((group) => group.items);

test.after(() => rm(outDir, { recursive: true, force: true }));

test('every teaching sidebar item navigates to an available view', () => {
  for (const item of items) {
    assert.ok(item.view, `${item.label} has no view`);
    assert.equal(item.topic, undefined, `${item.label} still opens a feedback thread`);
  }
  assert.equal(new Set(items.map((item) => item.view)).size, items.length);
});
