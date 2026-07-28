import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('faction, culture and dynasty cards share thumbnails and one fixed size per workspace mode', async () => {
  const groups = await readFile(path.join(repoRoot, 'src/views/GroupsView.tsx'), 'utf8');
  assert.match(groups, /<GroupCard item=\{item\} compact=\{compact\} dynasty=\{dynasty\}/);
  assert.match(groups, /listWorldImages\('group', item\.groupId\)/);
  assert.match(groups, /src=\{worldImageThumbnailUrl\(image\)\}/);
  assert.match(groups, /compact \? 'h-20 flex-row' : 'h-64 flex-col'/);
  assert.match(groups, /'h-36 w-full shrink-0/);
  assert.match(groups, /line-clamp-2/);
  assert.doesNotMatch(groups, /compact \? 'flex h-20' : 'h-60'/);
});

test('group cards declare light and dark surfaces and hover states independently', async () => {
  const groups = await readFile(path.join(repoRoot, 'src/views/GroupsView.tsx'), 'utf8');
  assert.match(groups, /border-neutral-300 bg-white/);
  assert.match(groups, /hover:border-violet-400 hover:bg-violet-50/);
  assert.match(groups, /dark:border-neutral-800 dark:bg-neutral-950\/25/);
  assert.match(groups, /dark:hover:border-violet-700\/60 dark:hover:bg-violet-950\/20/);
  assert.doesNotMatch(groups, /hover:bg-indigo-950\/20/);
});
