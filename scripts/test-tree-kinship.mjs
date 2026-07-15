import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-tree-kinship-'));
const bundle = path.join(outDir, 'treeKinship.cjs');
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'shared/treeKinship.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
], { cwd: root, stdio: 'inherit' });
const { adjustBranchColor, branchColorForTheme, deriveTreeKinship, TREE_KINSHIP_ROLE_LABEL_ES } = require(bundle);
test.after(() => rm(outDir, { recursive: true, force: true }));

const persons = [
  ['focus', 'male'], ['father', 'male'], ['mother', 'female'], ['pgf', 'male'], ['pgm', 'female'], ['mgf', 'male'], ['mgm', 'female'],
  ['pggf', 'male'], ['pgggf', 'female'], ['pguncle', 'male'], ['pgguncle', 'male'],
  ['sister', 'female'], ['puncle', 'male'], ['maunt', 'female'], ['cousin', 'female'], ['partner', 'female'], ['son', 'male'],
  ['granddaughter', 'female'], ['greatgrandson', 'male'], ['greatgreatgranddaughter', 'female'],
  ['nephew', 'male'], ['grandniece', 'female'], ['greatgrandnephew', 'male'],
].map(([id, sex]) => ({ id, sex }));
const parentEdges = [
  { parent: 'pgggf', child: 'pggf' }, { parent: 'pgggf', child: 'pgguncle' },
  { parent: 'pggf', child: 'pgf' }, { parent: 'pggf', child: 'pguncle' },
  { parent: 'pgf', child: 'father' }, { parent: 'pgm', child: 'father' },
  { parent: 'mgf', child: 'mother' }, { parent: 'mgm', child: 'mother' },
  { parent: 'pgf', child: 'puncle' }, { parent: 'pgm', child: 'puncle' },
  { parent: 'mgf', child: 'maunt' }, { parent: 'mgm', child: 'maunt' },
  { parent: 'father', child: 'focus' }, { parent: 'mother', child: 'focus' },
  { parent: 'father', child: 'sister' }, { parent: 'mother', child: 'sister' },
  { parent: 'maunt', child: 'cousin' }, { parent: 'focus', child: 'son' },
  { parent: 'son', child: 'granddaughter' }, { parent: 'granddaughter', child: 'greatgrandson' },
  { parent: 'greatgrandson', child: 'greatgreatgranddaughter' },
  { parent: 'sister', child: 'nephew' }, { parent: 'nephew', child: 'grandniece' },
  { parent: 'grandniece', child: 'greatgrandnephew' },
];

test('roles are explicit relative to the focus, including branches and collateral kin', () => {
  const context = deriveTreeKinship({ focusId: 'focus', persons, parentEdges, spouseEdges: [{ a: 'focus', b: 'partner' }] });
  assert.equal(context.get('father').role, 'father');
  assert.equal(context.get('mother').role, 'mother');
  assert.equal(context.get('pgf').role, 'paternal_grandfather');
  assert.equal(context.get('pgm').role, 'paternal_grandmother');
  assert.equal(context.get('mgf').role, 'maternal_grandfather');
  assert.equal(context.get('mgm').role, 'maternal_grandmother');
  assert.equal(context.get('sister').role, 'sister');
  assert.equal(context.get('puncle').role, 'paternal_uncle');
  assert.equal(context.get('maunt').role, 'maternal_aunt');
  assert.equal(context.get('cousin').role, 'female_cousin');
  assert.equal(context.get('partner').role, 'spouse');
  assert.equal(context.get('son').role, 'son');
  assert.equal(context.get('pggf').role, 'great_grandfather');
  assert.equal(context.get('pgggf').role, 'great_great_grandmother');
  assert.equal(context.get('pguncle').role, 'paternal_granduncle');
  assert.equal(context.get('pgguncle').role, 'great_granduncle');
  assert.equal(context.get('granddaughter').role, 'granddaughter');
  assert.equal(context.get('greatgrandson').role, 'great_grandson');
  assert.equal(context.get('greatgreatgranddaughter').role, 'great_great_granddaughter');
  assert.equal(context.get('nephew').role, 'nephew');
  assert.equal(context.get('grandniece').role, 'grandniece');
  assert.equal(context.get('greatgrandnephew').role, 'great_grandnephew');
  assert.equal(TREE_KINSHIP_ROLE_LABEL_ES[context.get('pgggf').role], 'Tatarabuela');
  assert.equal(TREE_KINSHIP_ROLE_LABEL_ES[context.get('greatgreatgranddaughter').role], 'Tataranieta');
});

test('every tag is recalculated when another person becomes the tree focus', () => {
  const context = deriveTreeKinship({ focusId: 'son', persons, parentEdges, spouseEdges: [] });
  assert.equal(context.get('son').role, 'focus');
  assert.equal(context.get('focus').role, 'father');
  assert.equal(context.get('sister').role, 'paternal_aunt');
  assert.equal(context.get('granddaughter').role, 'daughter');
  assert.equal(context.get('greatgrandson').role, 'grandson');
  assert.equal(context.get('greatgreatgranddaughter').role, 'great_granddaughter');

  const nephewFocus = deriveTreeKinship({ focusId: 'nephew', persons, parentEdges, spouseEdges: [] });
  assert.equal(nephewFocus.get('sister').role, 'mother');
  assert.equal(nephewFocus.get('focus').role, 'maternal_uncle');
  assert.equal(nephewFocus.get('son').role, 'male_cousin');

  const oldestFocus = deriveTreeKinship({ focusId: 'pgggf', persons, parentEdges, spouseEdges: [] });
  assert.equal(oldestFocus.get('focus').role, 'great_great_grandson');
});

test('sub-branches keep their base colour but alternate intensity', () => {
  const context = deriveTreeKinship({ focusId: 'focus', persons, parentEdges, spouseEdges: [] });
  assert.equal(context.get('pgf').branch, 'paternal');
  assert.equal(context.get('pgm').branch, 'paternal');
  assert.notEqual(context.get('pgf').tone, context.get('pgm').tone);
  assert.notEqual(adjustBranchColor('#2563eb', context.get('pgf').tone), adjustBranchColor('#2563eb', context.get('pgm').tone));
  assert.equal(context.get('mgf').branch, 'maternal');
  assert.equal(context.get('mgm').branch, 'maternal');
});

test('conflicting parent sex data never produces duplicate gendered kinship labels', () => {
  const inconsistentPersons = persons.map((person) => person.id === 'mgf' ? { ...person, sex: 'female' } : person);
  const context = deriveTreeKinship({ focusId: 'focus', persons: inconsistentPersons, parentEdges, spouseEdges: [] });
  assert.equal(context.get('mgf').role, 'maternal_grandparent');
  assert.equal(context.get('mgm').role, 'maternal_grandparent');
  assert.notEqual(context.get('mgf').tone, context.get('mgm').tone);
});

test('dark theme brightens tonal branch colours without changing the configured base', () => {
  assert.equal(branchColorForTheme('#2563eb', -0.2, true), adjustBranchColor('#2563eb', -0.2));
  assert.notEqual(branchColorForTheme('#2563eb', -0.2, false), branchColorForTheme('#2563eb', -0.2, true));
  assert.equal(branchColorForTheme('#dc2626', 0, false), '#e66363');
});
