import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('faction, culture and dynasty cards stay readable in the narrow detail rail', async () => {
  const [groups, workspace] = await Promise.all([
    readFile(path.join(repoRoot, 'src/views/GroupsView.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/components/world/WorldWorkspace.tsx'), 'utf8'),
  ]);
  assert.match(groups, /<GroupCard item=\{item\} compact=\{compact\} dynasty=\{dynasty\}/);
  assert.match(groups, /listWorldImages\('group', item\.groupId\)/);
  assert.match(groups, /src=\{worldImageThumbnailUrl\(image\)\}/);
  assert.match(groups, /compactPresentation: 'list'/);
  assert.match(workspace, /split && section\.compactPresentation === 'list'/);
  assert.match(groups, /compact \? 'h-24 flex-row' : 'h-72 flex-col'/);
  assert.match(groups, /compact \? 'px-3 py-2\.5' : 'px-4 py-3\.5'/);
  assert.match(groups, /line-clamp-2 block max-w-full break-words pr-0\.5/);
  assert.match(groups, /'h-36 w-full shrink-0/);
  assert.match(groups, /line-clamp-2/);
  assert.doesNotMatch(groups, /compact \? 'h-20 flex-row'/);
});

test('long group names reserve a right gutter in factions, cultures and dynasties', async () => {
  const groups = await readFile(path.join(repoRoot, 'src/views/GroupsView.tsx'), 'utf8');
  assert.match(groups, /function GroupCard\(/, 'all three sections share one card');
  assert.match(groups, /min-h-0 min-w-0 flex-1 overflow-hidden/);
  assert.match(groups, /px-4 py-3\.5/, 'full cards keep sixteen pixels on both sides');
  assert.match(groups, /line-clamp-2 block max-w-full break-words pr-0\.5/);
  assert.doesNotMatch(groups, /compact \? 'line-clamp-2 leading-5' : 'truncate'/);
});

test('group cards declare light and dark surfaces and hover states independently', async () => {
  const groups = await readFile(path.join(repoRoot, 'src/views/GroupsView.tsx'), 'utf8');
  assert.match(groups, /border-neutral-300 bg-white/);
  assert.match(groups, /hover:border-violet-400 hover:bg-violet-50/);
  assert.match(groups, /dark:border-neutral-800 dark:bg-neutral-950\/25/);
  assert.match(groups, /dark:hover:border-violet-700\/60 dark:hover:bg-violet-950\/20/);
  assert.doesNotMatch(groups, /hover:bg-indigo-950\/20/);
});
