import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..'), require = createRequire(import.meta.url);
fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
const temp = fs.mkdtempSync(path.join(root, 'tmp/chemistry-advanced-'));
await build({ stdin: { contents: `export * from './electron/chemistryValidationCore'; export * from './electron/chemistryScene'; export * from './electron/chemistryProjections'; export * from './electron/chemistryMechanisms';`, resolveDir: root, loader: 'ts' }, outfile: path.join(temp, 'core.mjs'), bundle: true, platform: 'node', format: 'esm', external: ['@rdkit/rdkit', 'openchemlib', 'node-tikzjax'], logLevel: 'silent' });
const lib = await import(pathToFileURL(path.join(temp, 'core.mjs')).href), kit = await require('@rdkit/rdkit')();
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));
const canonical = s => { const m = kit.get_mol(s); try { return m.get_smiles(); } finally { m.delete(); } };
const glucose = 'O=C[C@H](O)[C@@H](O)[C@H](O)[C@H](O)CO';
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/chemistry-reference-v2.json'))).cases;

test('Fischer is derived from the full graph, including enantiomer and epimer distinctions', () => {
  const scene = lib.deriveProjection(canonical(glucose), 'fischer', kit);
  assert.deepEqual(scene.atoms.filter(a => a.label === 'OH').slice(0, 4).map(a => a.x > 0), [true, false, true, true]);
  const mirror = lib.deriveProjection(canonical('O=C[C@@H](O)[C@H](O)[C@@H](O)[C@@H](O)CO'), 'fischer', kit);
  assert.deepEqual(mirror.atoms.filter(a => a.label === 'OH').slice(0, 4).map(a => a.x > 0), [false, true, false, false]);
  assert.throws(() => lib.deriveProjection(canonical('CCO'), 'fischer', kit), /scope/);
});

test('Haworth derives both anomers independently; it does not trust direction lists', () => {
  for (const [name, expected] of [['beta-D-glucopyranose', [true, false, true, false, true]], ['alpha-D-glucopyranose', [false, false, true, false, true]]]) {
    const entry = fixtures.find(f => f.name === name), scene = lib.deriveProjection(entry.canonicalSmiles, 'haworth', kit);
    assert.deepEqual(scene.atoms.filter(a => a.depth).filter(a => a.id !== 'a11').map(a => a.depth > 0), expected);
    assert.equal(lib.canonicalScene(scene, kit), entry.canonicalSmiles);
  }
});

test('ChemFig round-trip rejects changed labels, geometry, wedges and missing atoms', () => {
  const m = kit.get_mol('C[C@@H](O)C(=O)O'), scene = lib.sceneFromMolfile(m.get_molblock()); m.delete();
  const expected = canonical('C[C@@H](O)C(=O)O'), source = lib.exportSceneChemfig(scene);
  lib.verifySceneChemfig(source, scene, expected, kit);
  assert.throws(() => lib.verifySceneChemfig(source.replace('OH', 'NH'), scene, expected, kit), /changed/);
  assert.throws(() => lib.verifySceneChemfig(source.replace(/(<|>)(?=\[)/, '$1:'), scene, expected, kit), /changed/);
  assert.throws(() => lib.verifySceneChemfig(source.replace(/:([-\d.]+),/, ':45,'), scene, expected, kit), /changed/);
  const projection = lib.deriveProjection(canonical(glucose), 'fischer', kit), f = lib.exportSceneChemfig(projection);
  lib.verifySceneChemfig(f, projection, canonical(glucose), kit);
  assert.throws(() => lib.verifySceneChemfig(f.replace(/:180\.000000/, ':0.000000'), projection, canonical(glucose), kit), /changed/);
});

test('actual ChemFig compilation succeeds for Fischer, Haworth and skeletal exports', async () => {
  for (const [smiles, depiction] of [[glucose, 'fischer'], [fixtures.find(f => f.name === 'beta-D-glucopyranose').canonicalSmiles, 'haworth'], ['C[C@@H](O)C(=O)O', 'skeletal']]) {
    const result = await lib.validateChemicalReferences({ references: [smiles], depiction, exportChemfig: true });
    assert.equal(result.chemfig?.status, 'validated', result.chemfig?.reason);
    if (process.env.NODUS_ADVANCED_ARTIFACTS === '1') {
      const output = path.join(root, 'artifacts/chat-skills/verified-advanced'); fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, `${depiction}.svg`), result.svg);
      fs.writeFileSync(path.join(output, `${depiction}.json`), JSON.stringify(result, null, 2));
    }
  }
});

test('SN2 maps every atom and derives inversion; tertiary/aryl/unsupported nucleophile cases abstain', () => {
  for (const [input, expected] of [['CC[C@@H](C)Br', 'CC[C@H](C)O'], ['CC[C@H](C)Br', 'CC[C@@H](C)O'], ['CBr', 'CO'], ['CC[C@H](C)[C@@H](Br)CC', 'CC[C@H](C)[C@H](O)CC']]) {
    const result = lib.deriveMechanism('sn2', [canonical(input), '[OH-]'], kit);
    assert.equal(result.canonicalProducts[0], canonical(expected));
    assert.equal(result.canonicalProducts[1], '[Br-]');
    assert.equal(result.electronFlow[1].from.bond != null, true);
    lib.validateMechanismLedger(result, kit);
    const broken = structuredClone(result); broken.atomMap.pop();
    assert.throws(() => lib.validateMechanismLedger(broken, kit), /incomplete/);
    const wrongSide = structuredClone(result); wrongSide.atomMap[0].from = wrongSide.atomMap[0].to;
    assert.throws(() => lib.validateMechanismLedger(wrongSide, kit), /mapping/);
  }
  assert.equal(lib.deriveMechanism('sn2', [canonical('CC[C@H](C)Br'), '[I-]'], kit).canonicalProducts[0], canonical('CC[C@@H](C)I'));
  for (const input of ['CC(C)(C)Br', 'Brc1ccccc1', 'C1CCCCC1Br']) assert.throws(() => lib.deriveMechanism('sn2', [canonical(input), '[OH-]'], kit));
  assert.throws(() => lib.deriveMechanism('sn2', ['CBr', 'O'], kit), /nucleophile/);
});

test('amide resonance preserves atom mapping and formal charge; non-amides are not accepted', () => {
  const result = lib.deriveMechanism('amide-resonance', ['CC(=O)N(C)C'], kit);
  assert.equal(result.canonicalProducts[0], canonical('CC([O-])=[N+](C)C'));
  assert.equal(result.electronFlow.length, 2);
  const invalid = structuredClone(result); invalid.scenes[1].atoms.find(a => a.charge === -1).charge = 0;
  assert.throws(() => lib.validateMechanismLedger(invalid, kit));
  assert.throws(() => lib.deriveMechanism('amide-resonance', ['CC(=O)OC'], kit), /amide/);
});

test('full mechanism schemes compile with measured bond-centre electron arrows', async () => {
  for (const [rule, inputs] of [['sn2', ['CC[C@@H](C)Br', '[OH-]']], ['amide-resonance', ['CC(=O)N(C)C']]]) {
    const result = await lib.validateChemicalReferences({ references: [inputs[0]], mechanism: { rule, inputs } });
    assert.equal(result.mechanism.chemfig.status, 'validated');
    assert.match(result.mechanism.svg, /data-electron-flow="measured"/);
    assert.match(result.mechanism.chemfig.source, rule === 'sn2' ? /SN2/ : /\\arrow\{<->\}/);
    for (const mapping of result.mechanism.atomMap) {
      assert.equal(result.mechanism.molecules[mapping.from[0]].role, 'reactant');
      assert.equal(result.mechanism.molecules[mapping.to[0]].role, 'product');
    }
    for (const molecular of result.mechanism.molecules) {
      const m = kit.get_mol(molecular.molfile);
      try { assert.equal(m.get_smiles(), molecular.canonicalSmiles); } finally { m.delete(); }
    }
    if (process.env.NODUS_ADVANCED_ARTIFACTS === '1') {
      const output = path.join(root, 'artifacts/chat-skills/verified-advanced'); fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, `${rule}.svg`), result.mechanism.svg);
      fs.writeFileSync(path.join(output, `${rule}.json`), JSON.stringify(result, null, 2));
    }
  }
});
