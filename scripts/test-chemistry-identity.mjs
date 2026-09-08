import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-chemical-identity-'));
const bundle = path.join(temporary, 'test.cjs');
await build({ stdin: { contents: `export * from './electron/ai/chemistryIdentity'; export * from './electron/chemistryValidationCore';`, resolveDir: root, loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', define: { 'import.meta.url': JSON.stringify(new URL('../package.json', import.meta.url).href) }, logLevel: 'silent', plugins: [{ name: 'external-rdkit', setup(api) {
  api.onResolve({ filter: /^@rdkit\/rdkit$/ }, () => ({ path: require.resolve('@rdkit/rdkit'), external: true }));
} }] });
const lib = require(bundle);
process.on('exit', () => fs.rmSync(temporary, { recursive: true, force: true }));
const intent = (kind, value) => JSON.stringify({ version: 2, kind: 'structure', depiction: 'skeletal', species: [{ id: 'target', input: { kind, value } }] });
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const validate = lib.validateChemicalReferences;

test('twelve frozen public reference regressions survive the independent layout and stereo guards', async () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/chemistry-reference-v2.json'), 'utf8'));
  for (const entry of fixture.cases) {
    const result = await validate({ references: entry.references.map(ref => ref.smiles) });
    assert.equal(result.graph.canonicalSmiles, entry.canonicalSmiles, entry.name);
  }
});

test('intent rejects model-authored evidence, guessed structures and shortened names', () => {
  assert.equal(lib.parseChemistryIntent(intent('name', '(R)-lactic acid'), 'Draw (R)-lactic acid.').species[0].input.value, '(R)-lactic acid');
  assert.throws(() => lib.parseChemistryIntent(intent('smiles', 'CCO'), 'Draw ethanol'), /quoted exactly/);
  assert.throws(() => lib.parseChemistryIntent(intent('name', 'ethanol'), 'Draw methanol'), /quoted exactly/);
  assert.throws(() => lib.parseChemistryIntent(intent('name', 'lactic acid'), 'Draw (R)-lactic acid'), /quoted exactly/);
  assert.throws(() => lib.parseChemistryIntent(intent('name', 'glucose'), 'Draw the Fischer projection of glucose'), /specialized depiction/);
  assert.throws(() => lib.parseChemistryIntent(intent('pubchem-cid', '702'), 'Draw a structure at 702 degrees'), /explicitly labelled/);
  assert.equal(lib.parseChemistryIntent(intent('pubchem-cid', '702'), 'Draw PubChem CID 702.').species[0].input.value, '702');
  const forged = JSON.parse(intent('name', 'ethanol'));
  forged.status = 'verified';
  assert.throws(() => lib.parseChemistryIntent(JSON.stringify(forged), 'ethanol'), /schema/);
  forged.version = 1;
  assert.throws(() => lib.parseChemistryIntent(JSON.stringify(forged), 'ethanol'), /version-2/);
});

test('independent molecular round-trip preserves exact enantiomers, isotopes and charges', async () => {
  for (const smiles of ['C[C@@H](O)C(=O)O', 'C[C@H](O)C(=O)O', '[13CH3]CO', 'CC(=O)[O-]', 'F/C=C/F', 'F/C=C\\F', 'c1ccc2ccccc2c1', 'C[C@H](Br)[C@H](C)Br']) {
    const result = await validate({ references: [smiles] });
    assert.equal(result.engineVersion, '2025.03.4');
    assert.ok(result.graph.atoms.length);
    assert.match(result.svg, /<svg/);
    assert.equal(new Set(result.graph.atoms.map(a => a.id)).size, result.graph.atoms.length);
  }
  const r = await validate({ references: ['C[C@@H](O)C(=O)O'] });
  assert.equal(r.graph.atoms.find(a => a.cip)?.cip, 'R');
  await assert.rejects(validate({ references: ['C[C@@H](O)C(=O)O', 'C[C@H](O)C(=O)O'] }), /disagree/);
  await assert.rejects(validate({ references: ['CC(=O)O', 'CC(=O)[O-]'] }), /disagree/);
  await assert.rejects(validate({ references: ['[13CH3]CO', 'CCO'] }), /disagree/);
});

test('projection and mechanism intents cannot substitute a weaker depiction or model-authored products', () => {
  const fischer = { ...JSON.parse(intent('smiles', 'O=C[C@H](O)CO')), depiction: 'fischer' };
  assert.equal(lib.parseChemistryIntent(JSON.stringify(fischer), 'Fischer O=C[C@H](O)CO').depiction, 'fischer');
  assert.throws(() => lib.parseChemistryIntent(JSON.stringify(fischer), 'Haworth O=C[C@H](O)CO'), /specialized depiction/);
  const mechanism = { version: 2, kind: 'mechanism', depiction: 'skeletal', rule: 'sn2', species: [{ id: 'substrate', input: { kind: 'smiles', value: 'CBr' } }, { id: 'nucleophile', input: { kind: 'smiles', value: '[OH-]' } }] };
  assert.equal(lib.parseChemistryIntent(JSON.stringify(mechanism), 'SN2 mechanism CBr and [OH-]').rule, 'sn2');
  assert.throws(() => lib.parseChemistryIntent(JSON.stringify(mechanism), 'Draw CBr and [OH-]'), /explicitly requested/);
  assert.throws(() => lib.parseChemistryIntent(JSON.stringify({ ...mechanism, products: ['CO'] }), 'SN2 CBr and [OH-]'), /schema/);
  assert.throws(() => lib.parseChemistryIntent(JSON.stringify(mechanism), 'E2 mechanism CBr and [OH-]'), /explicitly requested/);
  assert.throws(() => lib.parseChemistryIntent(intent('smiles', 'CBr'), 'SN2 mechanism CBr and [OH-]'), /must not be replaced/);
});

test('canonical equivalence is atom-specific rather than literal SMILES or CIP inventory', async () => {
  await validate({ references: ['C[C@@H](O)C(=O)O', 'O=C(O)[C@H](O)C'] });
  await assert.rejects(validate({ references: ['C[C@H](F)[C@@H](Cl)CC', 'C[C@@H](F)[C@H](Cl)CC'] }), /disagree/);
});

test('new rule intents preserve conformations, ordered inputs and endo/exo requests', () => {
  const make = (rule, values, extra = {}) => JSON.stringify({ version: 2, kind: 'mechanism', depiction: 'skeletal', rule, species: values.map((value, i) => ({ id: `s${i}`, input: { kind: 'smiles', value } })), ...extra });
  for (const [rule, values, question] of [['e2', ['CCBr', '[OH-]'], 'E2 CCBr [OH-]'], ['aldol', ['CC=O', 'CC=O', '[OH-]'], 'aldol CC=O [OH-]'], ['diels-alder', ['C=CC=C', 'C=C'], 'Diels–Alder C=CC=C C=C']]) assert.equal(lib.parseChemistryIntent(make(rule, values), question).rule, rule);
  const da = make('diels-alder', ['C1=CC=CC1', 'O=C1OC(=O)C=C1']);
  assert.equal(lib.parseChemistryIntent(da, 'Diels–Alder endo C1=CC=CC1 O=C1OC(=O)C=C1').approach, 'endo');
  const newman = { ...JSON.parse(intent('smiles', 'CCCC')), depiction: 'newman', conformation: 'eclipsed' };
  assert.equal(lib.parseChemistryIntent(JSON.stringify(newman), 'Newman eclipsada CCCC').conformation, 'eclipsed');
  assert.equal(lib.parseChemistryIntent(JSON.stringify({ ...newman, conformation: undefined }), 'Newman alternada CCCC').conformation, 'staggered');
  assert.throws(() => lib.parseChemistryIntent(JSON.stringify(newman), 'Newman gauche CCCC'), /conformation/);
  assert.throws(() => lib.parseChemistryIntent(JSON.stringify(newman), 'Newman eclipsada 120 grados CCCC'), /Numeric/);
});

test('abstains on unspecified tetrahedral and alkene stereochemistry, radicals and impossible valence', async () => {
  await assert.rejects(validate({ references: ['CC(O)C(=O)O'] }), /stereocentre is unspecified/);
  await assert.rejects(validate({ references: ['CC=CC'] }), /Bond stereochemistry is unspecified/);
  await assert.rejects(validate({ references: ['[CH3]'] }), /Radicals/);
  await assert.rejects(validate({ references: ['C(C)(C)(C)(C)C'] }), /rejected/);
  await assert.rejects(validate({ references: ['CC=[C@AL1]=CC'] }), /outside the validated scope/);
  await assert.rejects(validate({ references: ['CC=C=CC'] }), /outside the validated stereochemical scope/);
  await assert.rejects(validate({ references: ['F[P@TB1](Cl)(Br)(I)N'] }), /outside the validated scope/);
  await assert.rejects(validate({ references: ['[C@H](F)(F)Cl'] }), /discarded/);
});

test('explicit user SMILES remain local and do not certify a name', async () => {
  const result = await lib.resolveChemistryIntent(intent('smiles', 'CCO'), 'Draw CCO', { validate, fetch: () => { throw new Error('No network permitted'); } });
  assert.equal(result.status, 'verified');
  assert.equal(result.species[0].references[0].provider, 'user');
  assert.ok(result.limitations.some(s => s.includes('not a compound name')));
});

test('reference lookup sends only exact identity and requires agreement', async () => {
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    if (url.includes('opsin')) return json({ status: 'SUCCESS', smiles: 'CCO' });
    if (url.includes('/cids/')) return json({ IdentifierList: { CID: [702] } });
    return json({ PropertyTable: { Properties: [{ CID: 702, SMILES: 'OCC' }] } });
  };
  const result = await lib.resolveChemistryIntent(intent('name', 'ethanol'), 'Private unrelated context. Draw ethanol.', { validate, fetch });
  assert.equal(result.status, 'verified');
  assert.equal(result.species[0].references.length, 2);
  assert.ok(calls.every(url => !url.includes('Private')));
  const disagree = await lib.resolveChemistryIntent(intent('name', 'ethanol'), 'ethanol', { validate, fetch: async url => url.includes('opsin') ? json({ status: 'SUCCESS', smiles: 'CO' }) : fetch(url) });
  assert.equal(disagree.status, 'needs-clarification');
  assert.match(disagree.reason, /disagree/);
});

test('no first-hit fallback for multiple PubChem CIDs or OPSIN warnings', async () => {
  for (const warning of [false, true]) {
    const result = await lib.resolveChemistryIntent(intent('name', 'glucose'), 'glucose', { validate, fetch: async url => url.includes('opsin')
      ? json({ status: warning ? 'WARNING' : 'FAILURE', warnings: warning ? ['Ambiguous'] : [] })
      : json({ IdentifierList: { CID: [1, 2] } }) });
    assert.equal(result.status, 'needs-clarification');
    assert.match(result.reason, /ambiguous/i);
  }
});

test('reference failures, oversized bodies and cancellation cannot yield a certificate', async () => {
  const result = await lib.resolveChemistryIntent(intent('name', 'ethanol'), 'ethanol', { validate, fetch: async () => new Response('x'.repeat(256001)) });
  assert.equal(result.status, 'needs-clarification');
  assert.match(result.reason, /too large/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(lib.resolveChemistryIntent(intent('smiles', 'CCO'), 'CCO', { validate, fetch }, controller.signal), /abort/i);
});
