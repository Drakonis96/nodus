// Scope is this build's own boundary, never a chemical judgement. These tests pin the
// two halves of that rule: what used to be refused now draws, and what is genuinely
// ambiguous is still refused.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-chemistry-scope-'));
const bundle = path.join(temporary, 'test.cjs');
await build({ stdin: { contents: `export * from './electron/chemistryValidationCore';`, resolveDir: root, loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', define: { 'import.meta.url': JSON.stringify(new URL('../package.json', import.meta.url).href) }, logLevel: 'silent', plugins: [{ name: 'external-rdkit', setup(api) {
  api.onResolve({ filter: /^@rdkit\/rdkit$/ }, () => ({ path: require.resolve('@rdkit/rdkit'), external: true }));
} }] });
const { validateChemicalReferences: validate } = require(bundle);
process.on('exit', () => fs.rmSync(temporary, { recursive: true, force: true }));

// Heme b and cyanocobalamin, the two structures reported as refused. Both carry a
// metal and a macrocycle, so each used to hit several independent blockers at once.
const HEME_B = 'CC1=C(CCC(=O)O)C2=CC3=C(C=C)C(C)=C4C=C5C(C)=C(C=C)C6=[N]5[Fe]5([N]34)([N]2=C1C=C1C(C)=C(CCC(=O)O)C(=C6)[N]15)';
const PORPHINE = 'C1=CC2=CC3=CC=C(N3)C=C4C=CC(=N4)C=C5C=CC(=N5)C=C1N2';

test('a metal is drawn instead of refused, and says what it could not certify', async () => {
  for (const [name, smiles] of Object.entries({
    'aluminium chloride': 'Cl[Al](Cl)Cl',
    'aluminium metal': '[Al]',
    'sodium chloride': '[Na+].[Cl-]',
    'iron(II) chloride': 'Cl[Fe]Cl',
    'magnesium oxide': '[Mg+2].[O-2]',
    'porphine core': PORPHINE,
  })) {
    const result = await validate({ references: [smiles] });
    assert.ok(result.svg.includes('<svg'), `${name} produced no drawing`);
    assert.ok(result.graph.atoms.length > 0, `${name} produced no graph`);
  }
  // Elemental aluminium carries unpaired electrons in RDKit's valence model. That is a
  // modelling artefact of writing a bare metal atom, not a radical the user asked for.
  const metal = await validate({ references: ['[Al]'] });
  assert.equal(metal.graph.atoms[0].atomicNumber, 13);
  // A non-organic element is honest about the reduced claim it carries.
  const salt = await validate({ references: ['[Na+].[Cl-]'] });
  assert.deepEqual(salt.partialReasons, ['element-outside-cip-scope']);
  assert.equal(salt.graph.atoms.length, 2, 'both ions survive; a salt is not silently halved');
});

test('an ordinary organic structure still claims full verification', async () => {
  for (const smiles of ['CCO', 'c1ccccc1', 'C[C@@H](O)C(=O)O', 'c1ccc2ccccc2c1']) {
    const result = await validate({ references: [smiles] });
    assert.equal(result.partialReasons, undefined, `${smiles} should be fully verified`);
  }
});

test('a fused macrocycle is no longer reported as unspecified E/Z', async () => {
  // Porphyrin and chlorophyll cores: the meso bridges sit in a sixteen-membered ring,
  // but each is fused to a pyrrole, so the ring system already fixes their geometry.
  for (const smiles of [PORPHINE, HEME_B]) {
    const result = await validate({ references: [smiles] });
    assert.ok(result.svg.includes('<svg'));
  }
});

test('genuinely ambiguous stereochemistry is still refused, with an actionable reason', async () => {
  // Rings of eight or more really do have two isolable geometries, so silence there is
  // a question for the user, not a limit of ours.
  for (const smiles of ['CC=CC', 'C1CCCC=CCC1', 'C1CCCC=CCCCC1']) {
    await assert.rejects(() => validate({ references: [smiles] }), /Bond stereochemistry is unspecified/, smiles);
  }
  // Smaller rings were never ambiguous and must not start failing.
  for (const smiles of ['C1CCC=CC1', 'C1CCC=CCC1']) {
    const result = await validate({ references: [smiles] });
    assert.ok(result.svg.includes('<svg'), smiles);
  }
  // An unassigned tetrahedral centre stays a question too.
  await assert.rejects(() => validate({ references: ['CC(O)C(=O)O'] }), /stereocentre is unspecified/);
});

test('a drawing is never produced from coordinates that changed the graph', async () => {
  // A conjugated polyene inside a macrolactone is the shape that makes OpenChemLib's
  // coordinate inventor rewrite geometry. Either a faithful layout is found — RDKit's
  // own is tried second — or nothing is drawn. A silently wrong structure is the one
  // outcome that is never acceptable, so the invariant is checked, not the engine.
  const initRDKit = require('@rdkit/rdkit');
  const kit = await initRDKit();
  const structures = [
    'O=C1OCCCC/C=C/C=C/C=C/C=C/CCCCCC1',
    'O=C1OCC/C=C/C=C/C=C/C=C/C=C/C=C/CCCC1',
    'CC1=C(CCC(=O)O)C2=CC3=C(C=C)C(C)=C4C=C5C(C)=C(C=C)C6=[N]5[Fe]5([N]34)([N]2=C1C=C1C(C)=C(CCC(=O)O)C(=C6)[N]15)',
  ];
  for (const smiles of structures) {
    let result;
    try { result = await validate({ references: [smiles] }); }
    catch (error) {
      assert.match(error.message, /No available layout reproduced the reference graph/, smiles);
      continue;
    }
    // Re-read the molfile the user is actually shown and confirm it still spells the
    // same molecule the reference resolved to.
    const drawn = kit.get_mol(result.graph.molfile);
    assert.ok(drawn, `the emitted molfile must parse: ${smiles}`);
    assert.equal(drawn.get_smiles(), result.graph.canonicalSmiles, `the drawn coordinates must encode the reference molecule: ${smiles}`);
    drawn.delete();
  }
});

test('references are reconciled when one is silent, and refused when they contradict', async () => {
  // OPSIN returns what a systematic name literally says; PubChem returns the curated
  // isomer. Silence on one side is not a conflict, so the specified form is adopted.
  for (const [flat, curated] of [
    ['CC=CC', 'C/C=C/C'],
    ['C1CCCC=CCC1', 'C1CCC/C=C\\CC1'],
    ['CC(O)C(=O)O', 'C[C@@H](O)C(=O)O'],
  ]) {
    // Compare against the engine's own canonical form of the curated reference, not
    // the literal input string.
    const expected = (await validate({ references: [curated] })).graph.canonicalSmiles;
    const result = await validate({ references: [flat, curated] });
    assert.equal(result.graph.canonicalSmiles, expected, `${flat} should adopt ${curated}`);
    assert.equal(result.reconciledStereochemistry, true, 'the assumption must be reported, not silent');
  }
  // Order must not decide the outcome.
  const reversed = await validate({ references: ['C/C=C/C', 'CC=CC'] });
  assert.equal(reversed.graph.canonicalSmiles, (await validate({ references: ['C/C=C/C'] })).graph.canonicalSmiles);

  // Two references that both speak and disagree are a genuine conflict.
  await assert.rejects(() => validate({ references: ['C[C@@H](O)C(=O)O', 'C[C@H](O)C(=O)O'] }), /disagree/);
  await assert.rejects(() => validate({ references: ['F/C=C/F', 'F/C=C\\F'] }), /disagree/);
  // And a difference that is not stereochemical at all is still a conflict.
  await assert.rejects(() => validate({ references: ['CC(=O)O', 'CC(=O)[O-]'] }), /disagree/);
  await assert.rejects(() => validate({ references: ['[13CH3]CO', 'CCO'] }), /disagree/);

  // A single fully specified reference is unaffected and claims no assumption.
  const plain = await validate({ references: ['C/C=C/C'] });
  assert.equal(plain.reconciledStereochemistry, undefined);
});
