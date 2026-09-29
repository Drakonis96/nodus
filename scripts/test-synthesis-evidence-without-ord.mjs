// Route evidence must degrade, never fail, when the Open Reaction Database is not there: no
// Chemistry Studio, an older package without the disconnection tool, no downloaded index, a
// format-3 index without the retro tables, or a tool that throws. In every case the textbook
// passages still arrive and the research chat is not blocked.
//
// The real electron/ai/synthesisEvidence.ts is bundled with its app dependencies replaced by
// in-memory stand-ins (capability registry, runner, reaction index, database, embeddings).
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-evidence-no-ord-'));
test.after(() => rm(tmp, { recursive: true, force: true }));

// Shared state the stubs read, set per scenario.
globalThis.__ord = { provider: null, indexDir: null, invoke: null, calls: 0 };

const STUBS = {
  '../capabilities/registry': `export const capabilityRegistry = () => ({ providers: new Map(globalThis.__ord.provider ? [['nodus:chemistry', globalThis.__ord.provider]] : []) });`,
  '../reactionIndex': `export const reactionIndexService = () => ({ localDirectory: async () => globalThis.__ord.indexDir });`,
  './moleculeInspection': `export const chemistryRunner = () => ({ runner: { invoke: async (request) => { globalThis.__ord.calls += 1; return globalThis.__ord.invoke(request); } }, dispose: async () => {} });`,
  './aiClient': `export const embed = async () => null;`,
  '../db/database': `export const getDb = () => ({ prepare: () => ({ all: () => [{ nodus_id: 'w1', title: 'Klein Organic Chemistry 3rd Ed', collections: 'Chemistry' }] }) });`,
  '../db/passagesRepo': `export const findSimilarPassages = () => [];
export const lexicalPassageSearch = (query) => [{ passage_id: 'w1#' + query.length, nodus_id: 'w1', text: 'The Fischer esterification of a carboxylic acid with an alcohol under acid catalysis.', page_label: 'p. 862', source_ref: null, page_number: 862, similarity: 0.9, title: 'Klein Organic Chemistry 3rd Ed', authors_json: '[]', year: 2017, zotero_key: 'K' }];`,
};

const outfile = path.join(tmp, 'synthesisEvidence.mjs');
await build({
  entryPoints: [path.join(root, 'electron/ai/synthesisEvidence.ts')],
  outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
  alias: { '@shared': path.join(root, 'shared') },
  plugins: [{
    name: 'stubs',
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => (STUBS[args.path] ? { path: args.path, namespace: 'stub' } : undefined));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js' }));
    },
  }],
});
const { gatherSynthesisEvidence } = await import(pathToFileURL(outfile).href);
const { synthesisEvidencePayload } = await import(pathToFileURL(await (async () => {
  const out = path.join(tmp, 'shared.mjs');
  await build({ entryPoints: [path.join(root, 'shared/synthesisEvidence.ts')], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  return out;
})()).href);

const REQUEST = 'Propose a step-by-step laboratory synthesis of benzocaine (SMILES: CCOC(=O)c1ccc(N)cc1), starting from 4-nitrotoluene (Cc1ccc([N+](=O)[O-])cc1).';
const TOOL = { tools: [{ id: 'propose-disconnections' }] };
const quiet = async (fn) => { const warn = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = warn; } };

async function scenario(state) {
  Object.assign(globalThis.__ord, { provider: null, indexDir: null, invoke: null, calls: 0 }, state);
  return quiet(() => gatherSynthesisEvidence(REQUEST));
}

function assertTextbookOnly(evidence, label) {
  assert.ok(evidence, `${label}: evidence is still gathered`);
  assert.deepEqual(evidence.disconnections, [], `${label}: no ORD disconnections`);
  assert.equal(evidence.target, 'CCOC(=O)c1ccc(N)cc1');
  assert.ok(evidence.passages.length > 0, `${label}: the textbook passages still arrive`);
  const payload = synthesisEvidencePayload(evidence);
  assert.ok(payload && !('ord_disconnections' in payload) && payload.textbook_passages.length, `${label}: the payload carries passages only`);
}

test('no Chemistry Studio at all: textbook evidence only, the tool is never called', async () => {
  const evidence = await scenario({});
  assertTextbookOnly(evidence, 'no package');
  assert.equal(globalThis.__ord.calls, 0);
});

test('an older package without the disconnection tool', async () => {
  const evidence = await scenario({ provider: { tools: [{ id: 'known-reactions' }] }, indexDir: '/idx' });
  assertTextbookOnly(evidence, 'older package');
  assert.equal(globalThis.__ord.calls, 0);
});

test('the ORD index has not been downloaded', async () => {
  const evidence = await scenario({ provider: TOOL, indexDir: null });
  assertTextbookOnly(evidence, 'no index');
  assert.equal(globalThis.__ord.calls, 0);
});

test('a format-3 index without retro tables answers with no proposals', async () => {
  const empty = { artifacts: [{ artifactType: 'reaction-disconnections', data: { disconnections: [{ input: 'CCOC(=O)c1ccc(N)cc1', target: 'CCOC(=O)c1ccc(N)cc1', madeBy: null, proposals: [] }], indexLacks: ['retro-templates.tsv.zst', 'molecules.tsv.zst'] } }] };
  const evidence = await scenario({ provider: TOOL, indexDir: '/idx', invoke: async () => empty });
  assertTextbookOnly(evidence, 'format 3');
  assert.equal(globalThis.__ord.calls, 1, 'no second-level call when the first found nothing');
});

test('a tool that fails or returns no artifact never blocks the request', async () => {
  for (const invoke of [async () => { throw new Error('The disconnection search failed.'); }, async () => ({ artifacts: [] }), async () => ({})]) {
    const evidence = await scenario({ provider: TOOL, indexDir: '/idx', invoke });
    assertTextbookOnly(evidence, 'tool failure');
  }
});

test('an aborted request still aborts', async () => {
  const controller = new AbortController();
  controller.abort();
  Object.assign(globalThis.__ord, { provider: TOOL, indexDir: '/idx', invoke: async () => { throw new DOMException('aborted', 'AbortError'); }, calls: 0 });
  await assert.rejects(quiet(() => gatherSynthesisEvidence(REQUEST, { signal: controller.signal })));
});

test('with the index present, the ORD brief is included', async () => {
  const found = { artifacts: [{ artifactType: 'reaction-disconnections', data: { disconnections: [{ input: 'CCOC(=O)c1ccc(N)cc1', target: 'CCOC(=O)c1ccc(N)cc1', madeBy: null, proposals: [{ precursors: 'CCO.Nc1ccc(C(=O)O)cc1', classes: ['Fischer esterification'], recorded: 3, available: true }] }] } }] };
  const evidence = await scenario({ provider: TOOL, indexDir: '/idx', invoke: async () => found });
  assert.equal(evidence.disconnections[0].proposals[0].classes[0], 'Fischer esterification');
  assert.ok(synthesisEvidencePayload(evidence).ord_disconnections);
});
