// The Deep Research progress bar reads a percentage off the events the pipelines
// emit. A bar that jumps backwards, or that sits at zero through the longest phase
// of all, is worse than no bar — so the mapping is pinned here against the real
// event sequence a report produces.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = mkdtempSync(path.join(os.tmpdir(), 'nodus-deep-progress-'));
const bundle = path.join(outDir, 'progress.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [path.join(repoRoot, 'shared/deepResearchProgress.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
  { cwd: repoRoot, stdio: 'inherit' }
);
const { deepResearchProgressFraction, deepResearchProgressPercent } = require(bundle);

test('nothing to report yet reads as no bar at all', () => {
  assert.equal(deepResearchProgressFraction(null), null);
  assert.equal(deepResearchProgressFraction(undefined), null);
  assert.equal(deepResearchProgressPercent(null), null);
});

test('a queued report has not started, a finished one is complete', () => {
  assert.equal(deepResearchProgressFraction({ phase: 'queued', message: 'En cola' }), 0);
  assert.equal(deepResearchProgressPercent({ phase: 'done', message: 'Listo' }), 100);
});

test('the bar never goes backwards over a whole report', () => {
  const total = 5;
  const events = [
    { phase: 'queued', message: '' },
    { phase: 'snapshot', message: '' },
    { phase: 'planning', message: '' },
    ...Array.from({ length: total }, (_, i) => ({ phase: 'section', message: '', sectionIndex: i + 1, sectionTotal: total })),
    // The coverage top-up writes FURTHER sections, past the planned total: those must
    // not overflow the section band and push the bar past where coverage starts.
    { phase: 'coverage', message: '' },
    { phase: 'section', message: '', sectionIndex: total + 1, sectionTotal: total },
    { phase: 'assembling', message: '' },
    { phase: 'done', message: '' },
  ];
  let previous = -1;
  for (const event of events) {
    const value = deepResearchProgressFraction(event);
    assert.ok(value !== null, `${event.phase} has a value`);
    assert.ok(value >= previous, `${event.phase}${event.sectionIndex ? ` ${event.sectionIndex}` : ''} does not go backwards (${value} < ${previous})`);
    assert.ok(value >= 0 && value <= 1, 'stays within the bar');
    previous = value;
  }
  assert.equal(previous, 1, 'a finished report fills the bar');
});

test('writing the sections is where most of the bar is spent', () => {
  const first = deepResearchProgressFraction({ phase: 'section', message: '', sectionIndex: 1, sectionTotal: 6 });
  const last = deepResearchProgressFraction({ phase: 'section', message: '', sectionIndex: 6, sectionTotal: 6 });
  assert.ok(last - first > 0.5, 'the section band is the largest one');
  // The first section is already under way; a bar still on zero would read as stuck.
  assert.ok(first > deepResearchProgressFraction({ phase: 'planning', message: '' }), 'section 1 is ahead of planning');
});

test('a pipeline that reports an index without a total still moves', () => {
  const one = deepResearchProgressPercent({ phase: 'section', message: '', sectionIndex: 1 });
  const three = deepResearchProgressPercent({ phase: 'section', message: '', sectionIndex: 3 });
  const nine = deepResearchProgressPercent({ phase: 'section', message: '', sectionIndex: 9 });
  assert.ok(one < three && three <= nine, 'more sections written reads as more progress');
  assert.ok(nine <= 82, 'and never past the end of the section band');
});

test.after(() => rmSync(outDir, { recursive: true, force: true }));
