import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the scene cast picker searches, selects several characters and opens above', async () => {
  const scenes = await readFile(path.join(repoRoot, 'src/views/ScenesView.tsx'), 'utf8');

  assert.match(scenes, /<SearchableMultiSelect/);
  assert.match(scenes, /testId="scene-cast-picker"/);
  assert.match(scenes, /searchPlaceholder=\{t\('Buscar personaje…'\)\}/);
  assert.match(scenes, /placement="above"/);
  assert.match(scenes, /selectedIds=\{addingIds\}/);
  assert.match(scenes, /onChange=\{setAddingIds\}/);
  assert.match(scenes, /for \(const personId of addingIds\)/);
  assert.match(scenes, /addSceneCharacter\(scene\.sceneId, personId\)/);
  assert.match(scenes, /addingIds\.length === 0 \|\| addingCharacters/);
  assert.doesNotMatch(scenes, /scene-sheet-cast[\s\S]{0,1200}<select/);
});

test('the shared multi-selector can anchor a variable-height panel above its trigger', async () => {
  const picker = await readFile(path.join(repoRoot, 'src/components/PersonMultiSelect.tsx'), 'utf8');

  assert.match(picker, /placement\?: 'auto' \| 'above' \| 'below'/);
  assert.match(picker, /placement === 'above'/);
  assert.match(picker, /bottom: window\.innerHeight - rect\.top \+ 4/);
  assert.match(picker, /aria-multiselectable="true"/);
  assert.match(picker, /type="checkbox"/);
  assert.match(picker, /dark:bg-neutral-950/);
});
