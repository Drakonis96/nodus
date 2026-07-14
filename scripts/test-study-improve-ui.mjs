import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('study improvement is selection-first, reviewable and undoable', async () => {
  const [editor, dialog] = await Promise.all([
    read('src/components/editor/StudyEditor.tsx'),
    read('src/components/editor/StudyImproveDialog.tsx'),
  ]);
  assert.match(editor, /data-testid="study-improve-toggle"/);
  assert.match(editor, /resolveImproveSelection/);
  assert.match(editor, /No hay texto seleccionado[^]*documento completo/);
  assert.match(editor, /data-testid="study-improve-undo"/);
  assert.match(editor, /Mejorar selección con IA/);
  for (const shortcut of ['builtin:formal', 'builtin:academic', 'builtin:clear', 'builtin:concise']) assert.match(editor, new RegExp(shortcut));
  assert.match(dialog, /diffWordsWithSpace/);
  assert.match(dialog, /insert_below/);
  assert.match(dialog, /updateStudyImprovementAction/);
  assert.match(dialog, /Transformación libre/);
  assert.match(dialog, /El original permanece intacto/);
});

test('custom styles expose CRUD, portability, scoped defaults and prompt history', async () => {
  const dialog = await read('src/components/editor/StudyImproveDialog.tsx');
  for (const contract of ['createStudyStyle', 'updateStudyStyle', 'duplicateStudyStyle', 'archiveStudyStyle', 'importStudyStyles', 'exportStudyStyles', 'restoreStudyStyleVersion', 'setStudyStyleAssociation']) {
    assert.match(dialog, new RegExp(contract));
  }
  assert.match(dialog, /validateStudyStylePrompt/);
  assert.match(dialog, /\{\{subject\}\}/);
  assert.match(dialog, /study-style-editor/);
});
