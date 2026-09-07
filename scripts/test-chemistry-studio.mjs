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
  ];
  for (const source of samples) {
    const svg = await chemistry.compileChemfig(source);
    assert.match(svg, /^<svg\b/);
    assert.match(svg, /<title>Chemical structure<\/title>/);
    assert.match(svg, /<rect[^>]+fill="#ffffff"/);
    assert.ok(svg.length < 300_000);
  }
  await assert.rejects(chemistry.compileChemfig(String.raw`\input{/etc/passwd}`), /Unsupported TeX command/);
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
