import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The teaching sidebar mixes shipped sections (which navigate to a view) with planned
// ones (which open a permanent GitHub feedback thread). Those two states are mutually
// exclusive, and the dangerous transition is the second → first: when a section finally
// ships, whoever wires its `view` must also drop its `topic`, or the sidebar keeps
// sending teachers to a thread about a feature that already exists. Nothing about that
// mistake is visible at runtime — the item just navigates *and* the thread rots — so the
// invariant is asserted here instead of left as a comment nobody rereads.

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
const { ROADMAP_THREADS } = load('src/views/RoadmapFeedbackModal.tsx');
const items = TEACHING_GROUPS.flatMap((group) => group.items);

test.after(() => rm(outDir, { recursive: true, force: true }));

test('every sidebar item either navigates or opens a thread, never both or neither', () => {
  const broken = items
    .filter((item) => Boolean(item.view) === Boolean(item.topic))
    .map((item) => `${item.label}: view=${item.view ?? '—'} topic=${item.topic ?? '—'}`);
  assert.deepEqual(broken, [], `Sidebar items in an impossible state:\n  ${broken.join('\n  ')}`);
});

test('every planned item points at a thread that exists', () => {
  const unknown = items
    .filter((item) => item.topic && !ROADMAP_THREADS[item.topic])
    .map((item) => `${item.label} → ${item.topic}`);
  assert.deepEqual(unknown, [], `Sidebar items pointing at a missing thread: ${unknown.join(', ')}`);
});

test('every declared thread is reachable from exactly one sidebar item', () => {
  // A thread left in ROADMAP_THREADS after its section shipped is the dead-link case:
  // the issue stays open on GitHub collecting comments nobody will act on.
  const counts = new Map(Object.keys(ROADMAP_THREADS).map((key) => [key, 0]));
  for (const item of items) if (item.topic) counts.set(item.topic, (counts.get(item.topic) ?? 0) + 1);
  const wrong = [...counts].filter(([, n]) => n !== 1).map(([key, n]) => `${key} referenced ${n}×`);
  assert.deepEqual(wrong, [], `Threads not reachable from exactly one sidebar item: ${wrong.join(', ')}`);
});

test('each thread carries a distinct issue number and a blurb', () => {
  const issues = Object.values(ROADMAP_THREADS).map((thread) => thread.issue);
  assert.equal(new Set(issues).size, issues.length, 'two sections share a GitHub issue');
  for (const [key, thread] of Object.entries(ROADMAP_THREADS)) {
    assert.ok(Number.isInteger(thread.issue) && thread.issue > 0, `${key} has no issue number`);
    assert.ok(thread.label?.trim(), `${key} has no label`);
    assert.ok(thread.blurb?.trim(), `${key} has no blurb`);
  }
});
