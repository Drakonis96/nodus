// Curved arrows are checked by applying them: the structure they build must be the
// structure that was declared, with atoms and charge conserved. These are the McMurry
// chapter 2 exercises that had no rule in the bounded library and so could not be drawn.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-arrow-ledger-'));
const bundle = path.join(temporary, 'test.cjs');
await build({ stdin: { contents: `export * from './electron/chemistryArrowLedger'; export * from './electron/chemistryRuleRender';`, resolveDir: root, loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', define: { 'import.meta.url': JSON.stringify(new URL('../package.json', import.meta.url).href) }, logLevel: 'silent', plugins: [{ name: 'external-rdkit', setup(api) {
  api.onResolve({ filter: /^@rdkit\/rdkit$/ }, () => ({ path: require.resolve('@rdkit/rdkit'), external: true }));
} }] });
const { deriveElectronFlowMechanism, renderCheckedMechanism } = require(bundle);
process.on('exit', () => fs.rmSync(temporary, { recursive: true, force: true }));
const kit = await require('@rdkit/rdkit')();

const canonical = smiles => { const m = kit.get_mol(smiles); const value = m.get_smiles(); m.delete(); return value; };

/** Lewis base donating a lone pair to HCl: two arrows, one bond made and one broken. */
function protonation(baseSmiles, baseElement) {
  return deriveElectronFlowMechanism(
    [baseSmiles, 'Cl'],
    ['base', 'acid'],
    [
      { from: { species: 'base', atom: { element: baseElement } }, to: { species: 'acid', atom: { element: 'H' } } },
      { from: { species: 'acid', bond: ['H', 'Cl'] }, to: { species: 'acid', atom: { element: 'Cl' } } },
    ],
    false, kit);
}

test('a Lewis base donating to HCl produces the conjugate acid and chloride', () => {
  for (const [name, smiles, element, cation] of [
    ['ethanol', 'CCO', 'O', 'CC[OH2+]'],
    ['dimethylamine', 'CNC', 'N', 'C[NH2+]C'],
    ['trimethylphosphine', 'CP(C)C', 'P', 'C[PH+](C)C'],
  ]) {
    const mechanism = protonation(smiles, element);
    const products = mechanism.canonicalProducts.slice().sort();
    assert.deepEqual(products, [canonical(cation), canonical('[Cl-]')].sort(), `${name} gave ${products.join(' + ')}`);
    assert.equal(mechanism.electronFlow.length, 2);
    // The arrow that breaks H–Cl must be reported against the acid, not the base.
    assert.equal(mechanism.electronFlow[1].from.molecule, 1);
    assert.equal(mechanism.electronFlow[0].from.molecule, 0);
  }
});

test('a bare proton reacting with THF gives the cyclic oxonium ion', () => {
  const mechanism = deriveElectronFlowMechanism(
    ['C1CCOC1', '[H+]'],
    ['thf', 'proton'],
    [{ from: { species: 'thf', atom: { element: 'O' } }, to: { species: 'proton', atom: { element: 'H' } } }],
    false, kit);
  assert.deepEqual(mechanism.canonicalProducts, [canonical('C1CC[OH+]C1')]);
  // One arrow only: a bare proton has no leaving group to push electrons onto.
  assert.equal(mechanism.electronFlow.length, 1);
});

test('arrows that do not conserve electrons are refused, with a reason that names the arrow', () => {
  // Donating from an atom that has no lone pair left.
  assert.throws(() => deriveElectronFlowMechanism(
    ['C', 'Cl'], ['alkane', 'acid'],
    [{ from: { species: 'alkane', atom: { element: 'C' } }, to: { species: 'acid', atom: { element: 'H' } } }],
    false, kit), /electronFlow\[0\]\.from: C has no lone pair/);

  // Naming a bond the species does not have.
  assert.throws(() => deriveElectronFlowMechanism(
    ['CCO', 'Cl'], ['base', 'acid'],
    [{ from: { species: 'acid', bond: ['C', 'Cl'] }, to: { species: 'acid', atom: { element: 'Cl' } } }],
    false, kit), /has no C–Cl bond/);

  // Naming a species that is not in the intent.
  assert.throws(() => deriveElectronFlowMechanism(
    ['CCO', 'Cl'], ['base', 'acid'],
    [{ from: { species: 'solvent', atom: { element: 'O' } }, to: { species: 'acid', atom: { element: 'H' } } }],
    false, kit), /"solvent" is not one of the species ids/);

  // An ambiguous selector says how many it matched so the next attempt can be precise.
  assert.throws(() => deriveElectronFlowMechanism(
    ['CCO', 'Cl'], ['base', 'acid'],
    [{ from: { species: 'base', atom: { element: 'C' } }, to: { species: 'acid', atom: { element: 'H' } } }],
    false, kit), /matches 2 atoms in this species\. Add "index"/);
});

test('every reactant atom is accounted for in the products', () => {
  const mechanism = protonation('CCO', 'O');
  const reactantAtoms = mechanism.reactants.reduce((total, index) => total + mechanism.scenes[index].atoms.length, 0);
  const productAtoms = mechanism.products.reduce((total, index) => total + mechanism.scenes[index].atoms.length, 0);
  assert.equal(reactantAtoms, productAtoms);
  assert.equal(mechanism.atomMap.length, reactantAtoms, 'the conservation check is only meaningful with a complete mapping');
});

test('resonance contributors keep the same atoms and total charge', () => {
  // Nitromethane: the classic two-contributor case. One arrow moves the N=O pair onto
  // oxygen, the other pushes the N–O lone pair back up into a double bond.
  const mechanism = deriveElectronFlowMechanism(
    ['C[N+](=O)[O-]'],
    ['nitromethane'],
    [
      { from: { species: 'nitromethane', bond: { between: ['N', 'O'], order: 2 } }, to: { species: 'nitromethane', atom: { element: 'O', index: 1 } } },
      { from: { species: 'nitromethane', atom: { element: 'O', index: 2 } }, to: { species: 'nitromethane', bond: { between: ['N', 'O'], order: 1 } } },
    ],
    true, kit);
  assert.equal(mechanism.resonance, true, 'a contributor set is drawn with a double-headed arrow');
  assert.equal(mechanism.canonicalProducts.length, 1);
});

test('a declared mechanism compiles to a drawing with its arrows actually measured', async () => {
  // The ledger proving the chemistry is only half the job: the arrows have to survive
  // ChemFig compilation and be anchored onto the finished SVG, across two molecules.
  const mechanism = protonation('CCO', 'O');
  const artifact = await renderCheckedMechanism(mechanism, kit);
  assert.match(artifact.svg, /<svg/);
  assert.equal(artifact.chemfig.status, 'validated');
  assert.match(artifact.svg, /data-electron-flow="measured"/, 'the curved arrows must reach the drawing, not just the ledger');
  assert.equal(artifact.rule, 'electron-flow');
});
