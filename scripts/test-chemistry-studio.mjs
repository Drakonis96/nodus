import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const testBase = path.join(root, 'tmp');
fs.mkdirSync(testBase, { recursive: true });
const temporary = fs.mkdtempSync(path.join(testBase, 'nodus-chemistry-studio-test-'));
const bundle = path.join(temporary, 'chemistry.mjs');
await build({
  entryPoints: [path.join(root, 'electron/chemistry.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['node-tikzjax', 'openchemlib'],
  logLevel: 'silent',
});
const chemistry = await import(pathToFileURL(bundle).href);
const graphBundle = path.join(temporary, 'graph.mjs');
await build({
  entryPoints: [path.join(root, 'electron/ai/chatChemistryPlan.ts')],
  outfile: graphBundle, bundle: true, platform: 'node', format: 'esm',
  external: ['node-tikzjax', 'openchemlib'], logLevel: 'silent',
  plugins: [{ name: 'no-live-ai', setup(api) {
    api.onResolve({ filter: /^\.\/aiClient$/ }, () => ({ path: 'ai', namespace: 'mock' }));
    api.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const completeText = () => { throw new Error("Unexpected live AI call"); };', loader: 'js' }));
    api.onResolve({ filter: /^@shared\// }, ({ path: specifier }) => ({ path: path.join(root, 'shared', `${specifier.slice(8)}.ts`) }));
  } }],
});
const graph = await import(pathToFileURL(graphBundle).href);
process.on('exit', () => fs.rmSync(temporary, { recursive: true, force: true }));

test('SMILES structures use deterministic OpenChemLib SVG output', async () => {
  for (const source of ['CCC', 'c1ccccc1', 'CC(=O)Oc1ccccc1C(=O)O', 'C[C@H](O)C(=O)O', '[NH4+]']) {
    const svg = await chemistry.compileSmiles(source);
    assert.match(svg, /^<svg\b/);
    assert.match(svg, /<title>Molecular structure<\/title>/);
    assert.match(svg, /<rect[^>]+fill="#ffffff"/);
    assert.match(svg, /viewBox=/);
    assert.ok(svg.length < 300_000);
  }
  assert.equal(await chemistry.compileSmiles('CCC'), await chemistry.compileSmiles('CCC'), 'cached output is stable');
  await assert.rejects(chemistry.compileSmiles('not a molecule'), /without fences|parse/i);
  await assert.rejects(chemistry.compileSmiles('CC>>CO'), /reaction arrows/i);
});

test('Chemfig covers perspective bonds, lone pairs and grouped structures', async () => {
  const samples = [
    String.raw`\chemfig{C(-[2]H)(-[4]Cl)(<[:-30]Cl)(<:[:-150]Cl)}`,
    String.raw`\chemfig{H-\lewis{26,S}-H}`,
    String.raw`\chemname{\chemfig{H_3C-CH_2-CH_3}}{propane}`,
    String.raw`\chemfig{@{nuc}O^{-}-H}\qquad\chemfig{@{c2}C(-[2]H)(-[6]CH_3)(<[:-30]@{lg}Br)(<:[:-150]CH_2CH_3)}\chemmove{\draw[->](nuc).. controls +(45:8mm) and +(150:8mm).. (c2);\draw[->](c2).. controls +(-45:8mm) and +(-120:8mm).. (lg);}`,
  ];
  for (const source of samples) {
    const svg = await chemistry.compileChemfig(source);
    assert.match(svg, /^<svg\b/);
    assert.match(svg, /<title>Chemical structure<\/title>/);
    assert.match(svg, /<rect[^>]+fill="#ffffff"/);
    assert.ok(svg.length < 300_000);
    if (source.includes('\\chemmove')) {
      assert.match(svg, /data-electron-flow="measured"/);
      assert.doesNotMatch(svg, /fill="#01020[123]"/);
      if (process.env.NODUS_CHEMFIG_TEST_ARTIFACTS === '1') {
        const artifacts = path.join(root, 'artifacts/chat-skills/advanced-chemfig/deterministic-projections');
        fs.mkdirSync(artifacts, { recursive: true });
        fs.writeFileSync(path.join(artifacts, 'measured-arrows.svg'), svg);
      }
    }
  }
  await assert.rejects(chemistry.compileChemfig(String.raw`\input{/etc/passwd}`), /Unsupported TeX command/);
});

test('nested reaction schemes retain visible bond strokes', async () => {
  const svg = await chemistry.compileChemfig(String.raw`\schemestart\chemname{\chemfig{CH_3-CH_2-OH}}{ethanol}\schemestop`);
  const bonds = [...svg.matchAll(/<path\b[^>]*fill="none"[^>]*>/g)];
  assert.equal(bonds.length, 2);
  for (const [bond] of bonds) assert.match(bond, /stroke="#000"/);
  const anion = await chemistry.compileChemfig(String.raw`\chemfig{O^{-}}`);
  assert.match(anion, />−<\/text>/);
  assert.doesNotMatch(anion, />¡<\/text>/);
});

test('electron-flow overlays measure bond centres and reject ambiguous or unsupported anchors', async () => {
  const source = String.raw`\schemestart\chemfig{CH_3-[@{sigma}]@{br}Br}\schemestop\chemmove{\draw[->](sigma).. controls +(90:6mm) and +(90:6mm).. (br);}`;
  const svg = await chemistry.compileChemfig(source);
  assert.match(svg, /data-electron-flow="measured"/);
  assert.match(await chemistry.compileChemfig(source.replace('-[@{sigma}]', '<[@{sigma}:-30]')), /data-electron-flow="measured"/);
  assert.doesNotMatch(svg, /fill="#01020[12]"/);
  await assert.rejects(chemistry.compileChemfig(source.replace('(sigma)', '(missing)')), /Unknown electron-flow anchor/);
  await assert.rejects(chemistry.compileChemfig(source.replace('CH_3', '@{br}CH_3')), /Duplicate electron-flow anchor/);
  await assert.rejects(chemistry.compileChemfig(source.replace('controls +(90:6mm) and +(90:6mm)', 'controls +(90:600mm) and +(90:6mm)')), /control distances/);
});

test('deterministic graph serialization compiles acyclic, fused, aromatic and stereochemical molecules', async () => {
  for (const smiles of ['C[C@H](O)C(=O)O', 'C[C@H](Br)[C@@H](Br)C', 'Cl/C(Br)=C/C', 'Cl/C(Br)=C\\C', 'O=C1OC(=O)C=C1', 'C1CCC2CCCCC2C1', 'c1ccccc1', 'CC([O-])=[N+](C)C']) {
    const source = graph.smilesToChemfig(smiles);
    const svg = await chemistry.compileChemfig(`\\schemestart\\chemname{${source}}{molecule}\\schemestop`);
    assert.match(svg, /<path/);
    assert.match(svg, /stroke="#000"/);
  }
});

test('structured Haworth projections compile with exactly four OH groups and one CH2OH branch', async () => {
  const plan = { version: 1, kind: 'structure', title: 'Haworth projection',
    species: [{ id: 'aldohexose', label: 'aldohexose', formula: 'C6H12O6', role: 'structure', connectivity: 'aldohexopyranose', stereochemistry: 'Haworth', projection: { kind: 'haworth-aldohexose', hydroxylDirections: ['up', 'down', 'up', 'down'], hydroxymethylDirection: 'up' } }],
    stages: [['aldohexose']], arrows: [], electronFlow: [],
  };
  const source = await graph.compileChemistryPlan(JSON.stringify(plan), { provider: 'deepseek', model: 'deepseek-v4-flash' });
  assert.equal((source.match(/0\.5\]OH/g) ?? []).length, 4);
  assert.match(source, />\[1,0\.7\]\(-\[2,0\.5\]OH\)/);
  const svg = await chemistry.compileChemfig(source);
  assert.match(svg, /^<svg\b/);
  if (process.env.NODUS_CHEMFIG_TEST_ARTIFACTS === '1') {
    const artifacts = path.join(root, 'artifacts/chat-skills/advanced-chemfig/deterministic-projections');
    fs.mkdirSync(artifacts, { recursive: true });
    fs.writeFileSync(path.join(artifacts, 'haworth.svg'), svg);
  }
});

test('Lewis mode expands hydrogens and computes nonbonding pairs deterministically', async () => {
  const source = JSON.stringify({ structures: [
    { label: '(a) chloroform', smiles: 'ClC(Cl)Cl' },
    { label: '(b) hydrogen sulfide', smiles: 'S' },
    { label: '(c) methylamine', smiles: 'CN' },
    { label: '(d) methyllithium', smiles: '[Li]C' },
  ] });
  const svg = await chemistry.compileLewis(source);
  assert.match(svg, /^<svg\b/);
  assert.match(svg, /<title>Lewis structures<\/title>/);
  for (const label of ['chloroform', 'hydrogen sulfide', 'methylamine', 'methyllithium']) assert.match(svg, new RegExp(label));
  assert.equal((svg.match(/<circle\b/g) ?? []).length, 24, 'exactly twelve lone pairs are rendered as dots');
  assert.equal((svg.match(/>H<\/text>/g) ?? []).length, 11, 'every implicit hydrogen is expanded');
  assert.equal((svg.match(/>Li<\/text>/g) ?? []).length, 1);
  await assert.rejects(chemistry.compileLewis('{"structures":[]}'), /one to eight structures/);
});
