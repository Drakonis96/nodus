import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [editor, tree, dossier, people, settings, styles] = await Promise.all([
  readFile(path.join(root, 'src/components/KinshipEditor.tsx'), 'utf8'),
  readFile(path.join(root, 'src/views/TreeView.tsx'), 'utf8'),
  readFile(path.join(root, 'src/components/PersonDossier.tsx'), 'utf8'),
  readFile(path.join(root, 'src/views/PersonasView.tsx'), 'utf8'),
  readFile(path.join(root, 'electron/db/settingsRepo.ts'), 'utf8'),
  readFile(path.join(root, 'src/index.css'), 'utf8'),
]);

test('tree sidebar and person dossier share the persistent relationship editor', () => {
  assert.match(tree, /<KinshipEditor person=\{person\} persons=\{persons\}/);
  assert.match(dossier, /<KinshipEditor/);
  assert.match(editor, /listRelationships\(person\.personId\)/);
  assert.match(editor, /updateRelationship\(/);
  assert.match(editor, /removeRelationship\(/);
});

test('tree routes parentage by family units instead of overlapping independent elbows', () => {
  assert.match(tree, /buildTreeFamilies/);
  assert.match(tree, /families\.map/);
  assert.match(tree, /laneIndex/);
  assert.match(tree, /layout\.edges\.filter\(\(edge\) => edge\.kind !== 'parent'\)/);
  assert.doesNotMatch(tree, /const midY = \(a\.y \+ b\.y\) \/ 2/);
});

test('paternal and maternal colours are the only user-selectable tree branch colours', () => {
  assert.match(tree, /data-testid="tree-paternal-color"/);
  assert.match(tree, /data-testid="tree-maternal-color"/);
  assert.equal((tree.match(/type="color"/g) ?? []).length, 2);
  assert.match(settings, /treePaternalColor: '#2563eb'/);
  assert.match(settings, /treeMaternalColor: '#dc2626'/);
  assert.match(styles, /\.light \.tree-branch-color-control/);
});

test('each person displays an explicit relationship label relative to the focus', () => {
  assert.match(tree, /deriveTreeKinship/);
  assert.match(tree, /KINSHIP_ROLE_LABEL/);
  assert.match(tree, /relationLabel/);
  assert.match(tree, /Abuelo paterno/);
  assert.match(tree, /Tía materna/);
});

test('relationship editor exposes two known parents, chronology review and repair actions', () => {
  assert.match(editor, /Progenitor 2 \(si se conoce\)/);
  assert.match(editor, /parentAgeWarning/);
  assert.match(editor, /Invertir/);
  assert.match(editor, /Editar parentesco/);
  assert.match(people, /Parentesco inicial \(opcional\)/);
});
