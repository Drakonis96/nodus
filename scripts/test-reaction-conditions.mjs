// ORD reaction conditions (tools/reaction-index/conditions.py): the worker attaches what a recorded
// reaction was run with to precedents; the host validates it, shows it under exact matches and the
// closest recorded reaction in the route report, and gives the model one plain line per recorded
// preparation. Synthetic data only.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-reaction-conditions-'));
test.after(() => rm(tmp, { recursive: true, force: true }));

async function bundle(entry, name) {
  const outfile = path.join(tmp, name);
  await build({ entryPoints: [path.join(root, entry)], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent', alias: { '@shared': path.join(root, 'shared') } });
  return import(pathToFileURL(outfile).href);
}

const conditions = await bundle('shared/reactionConditions.ts', 'conditions.mjs');
const inspection = await bundle('shared/moleculeInspection.ts', 'inspection.mjs');
const evidence = await bundle('shared/synthesisEvidence.ts', 'evidence.mjs');

const ORD = /^ord-[0-9a-f]{32}$/;
const ID_A = `ord-${'a'.repeat(32)}`;
const ID_B = `ord-${'b'.repeat(32)}`;
const RUN_A = { id: ID_A, reagents: ['NaBH4'], solvents: ['MeOH'], temperature: '0 °C', time: '2 h', yield: 92, ref: 'US00000001' };
const RUN_B = { id: ID_B, catalysts: ['[Pd]'], solvents: ['ethanol'], ref: 'doi:10.1000/example' };

test('conditions are validated: ids, yield range, references, names', () => {
  const out = conditions.normalizeReactionConditions([
    RUN_A,
    { id: 'not-an-id', reagents: ['x'] },
    { id: ID_B, yield: 140, ref: 'javascript:alert(1)', solvents: ['a|b\n`c`'] },
    { id: ID_A },
  ], ORD);
  assert.equal(out.length, 2, 'bad ids and empty entries are dropped; at most two kept');
  assert.deepEqual(out[0], RUN_A);
  assert.equal(out[1].yield, undefined, 'a yield over 100% is not kept');
  assert.equal(out[1].ref, undefined, 'only doi:, http(s) and patent references');
  assert.deepEqual(out[1].solvents, ['a b c'], 'table pipes, newlines and backticks are removed');
  assert.deepEqual(conditions.normalizeReactionConditions('nope', ORD), []);
});

test('one line per recorded run; SMILES-like names in code spans', () => {
  assert.equal(conditions.conditionsText(RUN_A), 'NaBH4, MeOH · 0 °C · 2 h · yield 92% · US00000001');
  assert.equal(conditions.conditionsText(RUN_B), '`[Pd]`, ethanol · doi:10.1000/example');
  assert.equal(conditions.conditionsPlainText(RUN_B), '[Pd], ethanol · doi:10.1000/example');
});

test('the route report shows conditions under an exact match and the closest recorded reaction', () => {
  const precedent = inspection.normalizeReactionPrecedent({
    reactions: [
      { input: 'CC=O>>CCO', count: 3, samples: [ID_A], conditions: [RUN_A] },
      { input: 'CCO>>CC=O', count: 0 },
    ],
    products: [],
    similar: [{ input: 'CCO>>CC=O', neighbors: [{ key: 'k', distance: 4, count: 2, similarity: 0.8, samples: [ID_B], conditions: [RUN_B] }] }],
  });
  assert.deepEqual(precedent.reactions[0].conditions, [RUN_A]);
  assert.deepEqual(precedent.similar[0].neighbors[0].samples, [ID_B]);
  const text = inspection.formatReactionPrecedents(precedent);
  assert.match(text, /✔ Exact match — 3 recorded precedent\(s\): `ord-a+`\.\n {2}- Run with: NaBH4, MeOH · 0 °C · 2 h · yield 92% · US00000001 \(`ord-a+`\)/);
  assert.match(text, /Closest recorded reaction: 80% similar[^\n]*\n {2}- The closest reaction was run with: `\[Pd\]`, ethanol · doi:10\.1000\/example \(`ord-b+`\)/);
});

test('identical runs are shown once', () => {
  const precedent = inspection.normalizeReactionPrecedent({ reactions: [{ input: 'CC=O>>CCO', count: 2, samples: [ID_A, ID_B], conditions: [RUN_A, { ...RUN_A, id: ID_B }] }], products: [], similar: [] });
  const text = inspection.formatReactionPrecedents(precedent);
  assert.equal(text.match(/Run with/g).length, 1);
});

test('without conditions the report is as before', () => {
  const precedent = inspection.normalizeReactionPrecedent({ reactions: [{ input: 'CC=O>>CCO', count: 3, samples: [ID_A] }], products: [], similar: [] });
  const text = inspection.formatReactionPrecedents(precedent);
  assert.doesNotMatch(text, /Run with/);
  assert.equal('conditions' in precedent.reactions[0], false);
});

test('the model sees one plain conditions line per recorded preparation and recorded disconnection', () => {
  const briefs = evidence.normalizeDisconnections({
    disconnections: [{
      input: 'CCO', target: 'CCO',
      madeBy: { count: 1, asReactant: 0, reactions: [{ key: 'k', count: 3, samples: [ID_A], reaction: 'CC=O>>CCO', conditions: [RUN_A] }] },
      proposals: [
        { precursors: 'CC=O', recorded: 3, available: true, classes: [], conditions: [RUN_A] },
        { precursors: 'CC(=O)O', recorded: 0, available: true, classes: [] },
      ],
    }],
  });
  assert.equal(briefs[0].recordedRoutes[0].conditions, 'NaBH4, MeOH · 0 °C · 2 h · yield 92% · US00000001');
  assert.equal(briefs[0].proposals[0].conditions, 'NaBH4, MeOH · 0 °C · 2 h · yield 92% · US00000001');
  assert.equal('conditions' in briefs[0].proposals[1], false);
  const payload = evidence.synthesisEvidencePayload({ target: 'CCO', startingMaterials: [], disconnections: briefs, passages: [] });
  assert.equal(payload.ord_disconnections[0].recorded_preparations[0].conditions, 'NaBH4, MeOH · 0 °C · 2 h · yield 92% · US00000001');
});
