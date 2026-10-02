// Commercial stock lists as an option: the setting or NODUS_STOCK_DIR=off switches every stock use
// off (chemistryStockDirectory returns null), and when on, the report and the pre-answer evidence
// say when the target itself can be bought, exactly or in another stereo/isotope form.
// Synthetic data only.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-stock-option-'));
test.after(() => rm(tmp, { recursive: true, force: true }));

async function bundle(entry, name, stubs = {}) {
  const outfile = path.join(tmp, name);
  await build({
    entryPoints: [path.join(root, entry)], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
    alias: { '@shared': path.join(root, 'shared') },
    plugins: [{ name: 'stubs', setup(api) {
      const names = Object.keys(stubs);
      if (!names.length) return;
      api.onResolve({ filter: new RegExp(`^(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`) }, (args) => ({ path: args.path, namespace: 'stub' }));
      api.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
    } }],
  });
  return import(pathToFileURL(outfile).href);
}

const evidence = await bundle('shared/synthesisEvidence.ts', 'evidence.mjs');

const userData = path.join(tmp, 'userData');
await mkdir(path.join(userData, 'chemistry-stock'), { recursive: true });
await writeFile(path.join(userData, 'chemistry-stock', 'demo.u64'), Buffer.alloc(8));
const stock = await bundle('electron/ai/chemistryStock.ts', 'stock.mjs', {
  electron: `export const app = { getPath: () => ${JSON.stringify(userData)} };`,
  '../db/settingsRepo': 'export const getSettings = () => globalThis.__settings ?? {};',
});

test('stock is on by default and off by setting or NODUS_STOCK_DIR=off', () => {
  const saved = process.env.NODUS_STOCK_DIR;
  try {
    delete process.env.NODUS_STOCK_DIR;
    globalThis.__settings = {};
    assert.equal(stock.chemistryStockDirectory(), path.join(userData, 'chemistry-stock'), 'a list present, setting unset: on');
    globalThis.__settings = { chemistryUseStockLists: false };
    assert.equal(stock.chemistryStockDirectory(), null, 'setting off: nothing uses stock');
    assert.deepEqual(stock.chemistryStockLists(), []);
    globalThis.__settings = { chemistryUseStockLists: true };
    for (const value of ['off', 'OFF', '', '  ']) {
      process.env.NODUS_STOCK_DIR = value;
      assert.equal(stock.chemistryStockDirectory(), null, `NODUS_STOCK_DIR=${JSON.stringify(value)} is off`);
    }
    process.env.NODUS_STOCK_DIR = path.join(userData, 'chemistry-stock');
    assert.equal(stock.chemistryStockDirectory(), path.join(userData, 'chemistry-stock'), 'a directory override still works');
  } finally {
    if (saved === undefined) delete process.env.NODUS_STOCK_DIR; else process.env.NODUS_STOCK_DIR = saved;
    delete globalThis.__settings;
  }
});

test('the route target is the last step\'s organic product', () => {
  const labels = [
    [{ role: 'reactant', byproduct: false, name: 'A', smiles: 'CCO' }, { role: 'product', byproduct: false, name: 'B', smiles: 'CC=O' }],
    [{ role: 'reactant', byproduct: false, name: 'B', smiles: 'CC=O' }, { role: 'product', byproduct: true, name: 'water', smiles: 'O' }, { role: 'product', byproduct: false, name: 'C', smiles: 'CC(O)=O' }],
  ];
  assert.deepEqual(evidence.routeTargetSmiles(labels), { name: 'C', smiles: 'CC(O)=O' });
  assert.equal(evidence.routeTargetSmiles([]), null);
});

test('target availability: exact, another form, orderable, none', () => {
  const smiles = 'C[C@H](O)C(=O)O';
  const line = (data) => evidence.formatTargetAvailability('lactic acid', evidence.compoundAvailability(smiles, data));
  assert.match(line({ stock: { [smiles]: ['acme'] } }), /^The target itself \(lactic acid\) is commercially available \(acme, in stock\) — a route may be unnecessary\.$/);
  assert.match(line({ stock: { [smiles]: [] }, sameSkeleton: { [smiles]: ['acme'] } }), /another stereo or isotope form.*\(acme, in stock\)/);
  assert.match(line({ orderable: { [smiles]: ['acme-full'] } }), /can be ordered \(acme, make-on-demand\)/, 'the -full suffix of an order list is dropped');
  assert.match(line({ sameSkeletonOrderable: { [smiles]: ['acme-full'] } }), /ordered in another stereo or isotope form/);
  assert.equal(line({ stock: { [smiles]: [] } }), '', 'not listed: no sentence');
});

test('the payload carries target availability and the rule explains it', () => {
  const payload = evidence.synthesisEvidencePayload({ target: 'CCO', startingMaterials: [], disconnections: [], passages: [], targetAvailability: 'The target itself (ethanol) is commercially available (acme, in stock) — a route may be unnecessary.' });
  assert.ok(payload, 'availability alone is worth sending');
  assert.match(payload.target_availability, /commercially available/);
  assert.equal(evidence.synthesisEvidencePayload({ target: 'CCO', startingMaterials: [], disconnections: [], passages: [] }), null, 'nothing at all: no payload');
  assert.match(evidence.SYNTHESIS_EVIDENCE_SYSTEM_RULE, /target_availability/);
});
