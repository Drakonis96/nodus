import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname, '..'), require = createRequire(import.meta.url);
fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
const temp = fs.mkdtempSync(path.join(root, 'tmp/chemistry-rules-v3-'));
await build({ stdin: { contents: `export * from './electron/chemistryNewman'; export * from './electron/chemistryAldol'; export * from './electron/chemistryE2'; export * from './electron/chemistryDielsAlder'; export * from './electron/chemistryMechanisms'; export * from './electron/chemistryScene'; export * from './electron/chemistryValidationCore'; export * from './electron/chemistry';`, resolveDir: root, loader: 'ts' }, outfile: path.join(temp, 'lib.mjs'), bundle: true, platform: 'node', format: 'esm', external: ['@rdkit/rdkit', 'openchemlib', 'node-tikzjax'], logLevel: 'silent' });
const lib = await import(pathToFileURL(path.join(temp, 'lib.mjs')).href), kit = await require('@rdkit/rdkit')();
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));
const canonical = s => { const m = kit.get_mol(s); try { return m.get_smiles(); } finally { m.delete(); } };
const inputs = xs => xs.map(canonical);

test('Newman reconstructs ethane/propane/butane and specified conformers from parsed ChemFig', async () => {
  for (const molecule of ['CC', 'CCC', 'CCCC']) for (const conformation of ['staggered', 'eclipsed', ...(molecule === 'CCCC' ? ['anti', 'gauche'] : [])]) {
    const p = lib.deriveNewman(molecule, kit, conformation), tex = lib.exportNewman(p);
    lib.verifyNewman(tex, p, molecule, kit);
    assert.equal(p.dihedralDegrees, conformation === 'eclipsed' ? 0 : conformation === 'gauche' ? 60 : 180);
    assert.throws(() => lib.verifyNewman(tex.replace('circle (12pt)', 'circle (18pt)'), p, molecule, kit), /changed/);
    try { assert.match(await lib.compileChemfig(tex), /<svg/); }
    catch (error) { if (process.env.NODUS_RULE_DEBUG) { console.log(tex); await require('node-tikzjax').default('\\begin{document}' + tex + '\\end{document}', { texPackages: { chemfig: '' }, showConsole: true }); } throw error; }
  }
  assert.throws(() => lib.deriveNewman('CC(C)C', kit), /supports/);
});

test('E2 enumerates unique regio/E/Z products and checks anti geometry and transferred H', () => {
  for (const length of [2, 3, 4, 5, 6]) for (const halogen of ['Cl', 'Br', 'I']) {
    const r = lib.deriveE2(inputs(['C'.repeat(length) + halogen, '[OH-]']), kit);
    assert.deepEqual(r.finalProducts, inputs(['C=' + 'C'.repeat(length - 1)]));
  }
  for (const [s, expected] of [['CCBr', ['C=C']], ['CC(C)Br', ['C=CC']], ['CC[C@@H](C)Br', ['C=CCC', 'C/C=C/C', 'C/C=C\\C']], ['CC[C@H](Br)CCC', ['CC/C=C/CC', 'CC/C=C\\CC', 'C/C=C/CCC', 'C/C=C\\CCC']]]) {
    const r = lib.deriveE2(inputs([s, 'CC[O-]']), kit);
    assert.deepEqual([...r.finalProducts].sort(), inputs(expected).sort());
    for (const p of r.panels) {
      assert.equal(p.electronFlow.length, 3); assert.ok(Math.abs(p.geometry.dihedralDegrees - 180) < .001);
      lib.validateMechanismLedger(p, kit);
      assert.equal(lib.canonicalScene(p.scenes[1], kit), canonical(s));
      const drawnAtoms = p.scenes[1].atoms;
      for (let i = 0; i < drawnAtoms.length; i++) for (let j = i + 1; j < drawnAtoms.length; j++) {
        assert.ok(Math.hypot(drawnAtoms[i].x - drawnAtoms[j].x, drawnAtoms[i].y - drawnAtoms[j].y) > .75, `E2 labels too close: ${i}/${j}`);
      }
      const broken = structuredClone(p); broken.atomMap.pop();
      assert.throws(() => lib.validateMechanismLedger(broken, kit));
    }
  }
  for (const s of ['CBr', 'CC(C)(C)Br', 'C1CCCCC1Br']) assert.throws(() => lib.deriveE2(inputs([s, '[OH-]']), kit));
});

test('aldol has three individually balanced steps, intermediate continuity and regenerated catalyst', () => {
  for (const [donor, acceptor, expected] of [['CC=O', 'CC=O', 'CC(O)CC=O'], ['CC(=O)C', 'CC(=O)C', 'CC(=O)CC(C)(C)O'], ['CC=O', 'C=O', 'OCCC=O'], ['CC(C)=O', 'C=O', 'CC(=O)CCO'], ['CC=O', 'CC(C)=O', 'O=CCC(C)(C)O'], ['CC(C)=O', 'CC=O', 'CC(=O)CC(C)O']]) {
    const r = lib.deriveAldol(inputs([donor, acceptor, '[OH-]']), kit);
    assert.equal(r.panels.length, 3); assert.equal(r.finalProducts[0], canonical(expected));
    for (const p of r.panels) {
      lib.validateMechanismLedger(p, kit);
      const broken = structuredClone(p); broken.scenes[broken.products[0]].atoms[0].charge += 1;
      assert.throws(() => lib.validateMechanismLedger(broken, kit));
    }
    assert.equal(r.panels[2].canonicalProducts[1], '[OH-]');
  }
  assert.throws(() => lib.deriveAldol(inputs(['CCC=O', 'CCC=O', '[OH-]']), kit), /supports/);
});

test('Diels–Alder graph edits retain atoms and distinguish endo/exo diastereomers', () => {
  const plain = lib.deriveDielsAlder(inputs(['C=CC=C', 'C=C']), kit);
  assert.equal(plain.finalProducts[0], canonical('C1=CCCCC1'));
  const bridged = lib.deriveDielsAlder(inputs(['C1=CC=CC1', 'C=C']), kit);
  assert.equal(bridged.panels.length, 1);
  const unbridgedMaleic = lib.deriveDielsAlder(inputs(['C=CC=C', 'O=C1OC(=O)C=C1']), kit);
  assert.equal(unbridgedMaleic.panels.length, 1);
  lib.validateMechanismLedger(unbridgedMaleic.panels[0], kit);
  const maleic = lib.deriveDielsAlder(inputs(['C1=CC=CC1', 'O=C1OC(=O)C=C1']), kit);
  assert.equal(maleic.panels.length, 2); assert.notEqual(...maleic.finalProducts);
  // Independent product identity fixtures: Sigma-Aldrich 247634 / 548006,
  // CAS 129-64-6 (endo), 2746-19-2 (exo), full stereochemical InChI.
  const referenceKeys = ['KNDQHSIWLOJIGP-UMRXKNAASA-N', 'KNDQHSIWLOJIGP-RNGGSSJXSA-N'];
  for (const [i, smiles] of maleic.finalProducts.entries()) {
    const mol = kit.get_mol(smiles);
    try { assert.equal(kit.get_inchikey_for_inchi(mol.get_inchi()), referenceKeys[i]); } finally { mol.delete(); }
  }
  for (const p of [...plain.panels, ...bridged.panels, ...maleic.panels]) lib.validateMechanismLedger(p, kit);
  assert.equal(lib.deriveDielsAlder(inputs(['C1=CC=CC1', 'O=C1OC(=O)C=C1']), kit, 'endo').finalProducts[0], maleic.finalProducts[0]);
  assert.throws(() => lib.deriveDielsAlder(inputs(['C=C(C)C=C', 'C=C']), kit), /supports/);
});

test('extended rules compile complete verified ChemFig panels and combined exports', async () => {
  const examples = [
    ['newman', { references: ['CCCC'], depiction: 'newman', conformation: 'gauche', exportChemfig: true }],
    ...[['e2', ['CC[C@@H](C)Br', 'CC[O-]']], ['aldol', ['CC=O', 'CC=O', '[OH-]']], ['diels-alder', ['C1=CC=CC1', 'O=C1OC(=O)C=C1']]].map(([rule, xs]) => [rule, { references: [canonical(xs[0])], mechanism: { rule, inputs: inputs(xs) } }]),
    ['e2-boundary', { references: inputs(['CC[C@H](Br)CCC']), mechanism: { rule: 'e2', inputs: inputs(['CC[C@H](Br)CCC', 'CC[O-]']) } }],
  ];
  for (const [name, request] of examples) {
    const result = await lib.validateChemicalReferences(request), artifact = result.mechanism ?? result;
    if (process.env.NODUS_RULE_ARTIFACTS === '1') {
      const dir = path.join(root, 'artifacts/chat-skills/rules-v3'); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(result, null, 2));
      fs.writeFileSync(path.join(dir, `${name}.svg`), artifact.svg);
      if (name === 'newman') fs.writeFileSync(path.join(dir, 'newman-chemfig.svg'), await lib.compileChemfig(artifact.chemfig.source));
      for (const [i, panel] of (artifact.panels ?? []).entries()) fs.writeFileSync(path.join(dir, `${name}-${i + 1}.svg`), panel.svg);
    }
    if (name === 'e2-boundary') {
      assert.equal(artifact.panels.length, 4);
      if (artifact.chemfig.status !== 'validated') assert.match(artifact.chemfig.reason, /individually validated panels/);
    } else assert.equal(artifact.chemfig.status, 'validated', artifact.chemfig.reason);
    for (const panel of artifact.panels ?? []) assert.equal(panel.chemfig.status, 'validated');
    assert.match(artifact.svg, /<svg/);
  }
});
