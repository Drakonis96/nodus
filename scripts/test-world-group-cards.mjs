import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('faction and culture cards have one fixed size per workspace mode', async () => {
  const groups = await readFile(path.join(repoRoot, 'src/views/GroupsView.tsx'), 'utf8');
  assert.match(groups, /compact \? 'h-20 p-2\.5' : 'h-40 p-4'/);
  assert.match(groups, /line-clamp-2/);
});

test('group cards declare light and dark surfaces and hover states independently', async () => {
  const groups = await readFile(path.join(repoRoot, 'src/views/GroupsView.tsx'), 'utf8');
  assert.match(groups, /border-neutral-300 bg-white/);
  assert.match(groups, /hover:border-violet-400 hover:bg-violet-50/);
  assert.match(groups, /dark:border-neutral-800 dark:bg-neutral-950\/25/);
  assert.match(groups, /dark:hover:border-violet-700\/60 dark:hover:bg-violet-950\/20/);
  assert.doesNotMatch(groups, /hover:bg-indigo-950\/20/);
});
