import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('rules in play reflow their states without crossing a narrow manuscript rail', async () => {
  const rules = await readFile(path.join(repoRoot, 'src/components/world/RulesInPlay.tsx'), 'utf8');

  assert.match(rules, /grid-cols-\[repeat\(auto-fit,minmax\(6rem,1fr\)\)\]/);
  assert.match(rules, /min-h-7 min-w-0 whitespace-normal break-words/);
  assert.match(rules, /min-w-0 rounded border border-neutral-200/);
  assert.match(rules, /flex flex-wrap items-center gap-x-2 gap-y-1/);
  assert.doesNotMatch(rules, /flex shrink-0 gap-0\.5/);
});

test('manuscript workbench buttons grow with wrapped or translated labels', async () => {
  const manuscript = await readFile(path.join(repoRoot, 'src/views/ManuscriptView.tsx'), 'utf8');
  const workbench = manuscript.slice(
    manuscript.indexOf('function SceneWorkbench'),
    manuscript.indexOf('/**', manuscript.indexOf('function SceneWorkbench') + 1),
  );

  assert.match(workbench, /grid-cols-\[repeat\(auto-fit,minmax\(7rem,1fr\)\)\]/);
  assert.equal((workbench.match(/min-h-9 min-w-0 whitespace-normal break-words/g) ?? []).length, 2);
  assert.doesNotMatch(workbench, /className="btn btn-ghost h-7 flex-1/);
  assert.match(workbench, /min-w-0 rounded-xl border border-neutral-200/);
});
