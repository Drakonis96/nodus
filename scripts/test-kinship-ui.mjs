import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [editor, tree, dossier, people] = await Promise.all([
  readFile(path.join(root, 'src/components/KinshipEditor.tsx'), 'utf8'),
  readFile(path.join(root, 'src/views/TreeView.tsx'), 'utf8'),
  readFile(path.join(root, 'src/components/PersonDossier.tsx'), 'utf8'),
  readFile(path.join(root, 'src/views/PersonasView.tsx'), 'utf8'),
]);

test('tree sidebar and person dossier share the persistent relationship editor', () => {
  assert.match(tree, /<KinshipEditor person=\{person\} persons=\{persons\}/);
  assert.match(dossier, /<KinshipEditor/);
  assert.match(editor, /listRelationships\(person\.personId\)/);
  assert.match(editor, /updateRelationship\(/);
  assert.match(editor, /removeRelationship\(/);
});

test('relationship editor exposes two known parents, chronology review and repair actions', () => {
  assert.match(editor, /Progenitor 2 \(si se conoce\)/);
  assert.match(editor, /parentAgeWarning/);
  assert.match(editor, /Invertir/);
  assert.match(editor, /Editar parentesco/);
  assert.match(people, /Parentesco inicial \(opcional\)/);
});
