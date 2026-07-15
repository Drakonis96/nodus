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
const { adjustBranchColor, branchColorForTheme, deriveTreeKinship, treeKinshipLabel, TREE_KINSHIP_ROLE_LABEL_ES } = require(bundle);
test.after(() => rm(outDir, { recursive: true, force: true }));

const persons = [
  ['focus', 'male'], ['father', 'male'], ['mother', 'female'], ['pgf', 'male'], ['pgm', 'female'], ['mgf', 'male'], ['mgm', 'female'],
  ['pggf', 'male'], ['pgggf', 'female'], ['pguncle', 'male'], ['pgguncle', 'male'],
  ['sister', 'female'], ['puncle', 'male'], ['maunt', 'female'], ['cousin', 'female'], ['partner', 'female'], ['son', 'male'],
  ['partner_father', 'male'], ['partner_mother', 'female'], ['partner_brother', 'male'], ['partner_niece', 'female'],
  ['cousin_child', 'male'], ['cousin_grandchild', 'female'], ['maternal_granduncle', 'male'], ['second_cousin_parent', 'female'], ['second_cousin', 'male'],
  ['granddaughter', 'female'], ['greatgrandson', 'male'], ['greatgreatgranddaughter', 'female'],
  ['fifth_descendant', 'male'], ['deep_ancestor', 'male'], ['nephew', 'male'], ['grandniece', 'female'], ['greatgrandnephew', 'male'],
  ['fourth_generation_niece', 'female'], ['stranger', 'female'],
].map(([id, sex]) => ({ id, sex }));
const parentEdges = [
  { parent: 'deep_ancestor', child: 'pgggf' },
  { parent: 'pgggf', child: 'pggf' }, { parent: 'pgggf', child: 'pgguncle' },
  { parent: 'pggf', child: 'pgf' }, { parent: 'pggf', child: 'pguncle' },
  { parent: 'pgf', child: 'father' }, { parent: 'pgm', child: 'father' },
  { parent: 'mgf', child: 'mother' }, { parent: 'mgm', child: 'mother' },
  { parent: 'pgf', child: 'puncle' }, { parent: 'pgm', child: 'puncle' },
  { parent: 'mgf', child: 'maunt' }, { parent: 'mgm', child: 'maunt' },
  { parent: 'father', child: 'focus' }, { parent: 'mother', child: 'focus' },
  { parent: 'father', child: 'sister' }, { parent: 'mother', child: 'sister' },
  { parent: 'maunt', child: 'cousin' }, { parent: 'cousin', child: 'cousin_child' }, { parent: 'cousin_child', child: 'cousin_grandchild' },
  { parent: 'maternal_granduncle', child: 'second_cousin_parent' }, { parent: 'second_cousin_parent', child: 'second_cousin' },
  { parent: 'partner_father', child: 'partner' }, { parent: 'partner_mother', child: 'partner' },
  { parent: 'partner_father', child: 'partner_brother' }, { parent: 'partner_mother', child: 'partner_brother' }, { parent: 'partner_brother', child: 'partner_niece' },
  { parent: 'focus', child: 'son' }, { parent: 'partner', child: 'son' },
  { parent: 'son', child: 'granddaughter' }, { parent: 'granddaughter', child: 'greatgrandson' },
  { parent: 'greatgrandson', child: 'greatgreatgranddaughter' }, { parent: 'greatgreatgranddaughter', child: 'fifth_descendant' },
  { parent: 'sister', child: 'nephew' }, { parent: 'nephew', child: 'grandniece' },
  { parent: 'grandniece', child: 'greatgrandnephew' }, { parent: 'greatgrandnephew', child: 'fourth_generation_niece' },
];
const siblingEdges = [{ a: 'mgf', b: 'maternal_granduncle' }];

test('roles are explicit relative to the focus, including branches and collateral kin', () => {
  const context = deriveTreeKinship({ focusId: 'focus', persons, parentEdges, spouseEdges: [{ a: 'focus', b: 'partner' }], siblingEdges });
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
  assert.equal(context.get('partner').role, 'wife');
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

test('a spouse as focus receives complete blood and affinity labels instead of generic relatives', () => {
  const context = deriveTreeKinship({ focusId: 'partner', persons, parentEdges, spouseEdges: [{ a: 'focus', b: 'partner' }], siblingEdges });
  assert.equal(context.get('partner').role, 'focus');
  assert.equal(context.get('focus').role, 'husband');
  assert.equal(context.get('partner_father').role, 'father');
  assert.equal(context.get('partner_mother').role, 'mother');
  assert.equal(context.get('partner_brother').role, 'brother');
  assert.equal(context.get('partner_niece').role, 'niece');
  assert.equal(context.get('father').role, 'father_in_law');
  assert.equal(context.get('mother').role, 'mother_in_law');
  assert.equal(context.get('sister').role, 'sister_in_law');
  assert.equal(context.get('son').role, 'son');
  assert.equal(treeKinshipLabel(context.get('pgf'), 'es'), 'Abuelo paterno de su cónyuge');
  assert.equal(treeKinshipLabel(context.get('nephew'), 'en'), 'Nephew of their spouse');
  assert.notEqual(context.get('stranger').role, 'relative_by_marriage');
  assert.equal(context.get('stranger').role, 'unrelated');
});

test('a mother as focus resolves descendants and every relationship through her spouse', () => {
  const context = deriveTreeKinship({ focusId: 'mother', persons, parentEdges, spouseEdges: [{ a: 'father', b: 'mother' }, { a: 'focus', b: 'partner' }], siblingEdges });
  assert.equal(context.get('father').role, 'husband');
  assert.equal(context.get('focus').role, 'son');
  assert.equal(context.get('sister').role, 'daughter');
  assert.equal(context.get('son').role, 'grandson');
  assert.equal(context.get('partner').role, 'daughter_in_law');
  assert.equal(context.get('pgf').role, 'father_in_law');
  assert.equal(context.get('puncle').role, 'brother_in_law');
  assert.equal(treeKinshipLabel(context.get('puncle'), 'es'), 'Cuñado');
});

test('arbitrary depths, cousin degrees and removals receive exact generated labels', () => {
  const context = deriveTreeKinship({ focusId: 'focus', persons, parentEdges, spouseEdges: [], siblingEdges });
  assert.equal(treeKinshipLabel(context.get('deep_ancestor'), 'es'), 'Ascendiente paterno/a de 5.ª generación');
  assert.equal(treeKinshipLabel(context.get('fifth_descendant'), 'en'), '5th-generation descendant');
  assert.equal(treeKinshipLabel(context.get('cousin_child'), 'es'), 'Primo de 1.º grado, 1 generación de diferencia');
  assert.equal(treeKinshipLabel(context.get('cousin_grandchild'), 'en'), '1st female cousin, twice removed');
  assert.equal(treeKinshipLabel(context.get('second_cousin'), 'es'), 'Primo de 2.º grado');
  assert.equal(treeKinshipLabel(context.get('fourth_generation_niece'), 'es'), 'Sobrino/a de 4.ª generación');
});

test('stepfamily, co-parents and rare connected paths never collapse to relative', () => {
  const localPersons = [
    { id: 'focus', sex: 'male' }, { id: 'coparent', sex: 'female' }, { id: 'shared', sex: 'female' },
    { id: 'stepchild', sex: 'male' }, { id: 'father', sex: 'male' }, { id: 'stepmother', sex: 'female' },
  ];
  const localParents = [
    { parent: 'focus', child: 'shared' }, { parent: 'coparent', child: 'shared' }, { parent: 'coparent', child: 'stepchild' },
    { parent: 'father', child: 'focus' },
  ];
  const unmarried = deriveTreeKinship({ focusId: 'focus', persons: localPersons, parentEdges: localParents, spouseEdges: [{ a: 'father', b: 'stepmother' }] });
  assert.equal(unmarried.get('coparent').role, 'co_parent');
  assert.equal(unmarried.get('stepmother').role, 'stepmother');
  assert.equal(unmarried.get('stepchild').role, 'connected_relative');
  assert.match(treeKinshipLabel(unmarried.get('stepchild'), 'es'), /hija → hermano/);

  const married = deriveTreeKinship({ focusId: 'focus', persons: localPersons, parentEdges: localParents, spouseEdges: [{ a: 'focus', b: 'coparent' }, { a: 'father', b: 'stepmother' }] });
  assert.equal(married.get('stepchild').role, 'stepson');
});

test('extreme generations and distant cousin removals stay exact and total', () => {
  const extremePersons = [{ id: 'focus', sex: 'female' }, { id: 'root', sex: 'male' }, { id: 'remote_spouse', sex: 'male' }, { id: 'spouse_of_spouse', sex: 'female' }];
  const extremeParents = [];
  let previous = 'root';
  for (let index = 1; index <= 9; index++) {
    const id = index === 9 ? 'focus' : `left_${index}`;
    extremePersons.push({ id, sex: index % 2 ? 'female' : 'male' });
    extremeParents.push({ parent: previous, child: id });
    previous = id;
  }
  previous = 'root';
  for (let index = 1; index <= 13; index++) {
    const id = `right_${index}`;
    extremePersons.push({ id, sex: index === 13 ? 'male' : index % 2 ? 'male' : 'female' });
    extremeParents.push({ parent: previous, child: id });
    previous = id;
  }
  const context = deriveTreeKinship({
    focusId: 'focus', persons: extremePersons, parentEdges: extremeParents,
    spouseEdges: [{ a: 'focus', b: 'remote_spouse' }, { a: 'remote_spouse', b: 'spouse_of_spouse' }],
  });
  assert.equal(treeKinshipLabel(context.get('root'), 'en'), '9th-generation paternal ancestor');
  assert.equal(treeKinshipLabel(context.get('right_13'), 'es'), 'Primo de 8.º grado, 4 generaciones de diferencia');
  assert.equal(context.get('spouse_of_spouse').role, 'connected_relative');
  assert.ok(extremePersons.every((person) => context.has(person.id)), 'every recorded person receives a focus-relative result');
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
