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
  // No stock lists imported: disconnections are requested without a stock directory.
  './chemistryStock': `export const chemistryStockDirectory = () => null; export const chemistryStockLists = () => [];`,
  // No textbook-scheme index unless a scenario sets one.
  './textbookSchemes': `export const textbookSchemeDirectory = () => globalThis.__textbook?.dir ?? null; export const textbookCitations = (ids) => (globalThis.__textbook?.cite ?? (() => []))(ids);`,
  // No local reranker installed: the fused order stands.
  './localReranker': `export const rerankerAvailable = () => false; export const rerank = async () => null;`,
  '../db/database': `export const getDb = () => ({ prepare: () => ({ all: () => [{ nodus_id: 'w1', title: 'Klein Organic Chemistry 3rd Ed', collections: 'Chemistry' }] }) });`,
  '../db/passagesRepo': `export const findSimilarPassages = () => [];
export const lexicalPassageSearch = (query) => [{ passage_id: 'w1#' + query.length, nodus_id: 'w1', text: 'Benzocaine is made by the Fischer esterification of a carboxylic acid with an alcohol under acid catalysis. The equilibrium is driven toward the ester by using the alcohol as the solvent and by removing the water that forms, and the nitro group is then reduced to the amine with tin and hydrochloric acid or by catalytic hydrogenation over palladium on carbon.', page_label: 'p. 862', source_ref: null, page_number: 862, similarity: 0.9, title: 'Klein Organic Chemistry 3rd Ed', authors_json: '[]', year: 2017, zotero_key: 'K' }];`,
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

test('with starting materials the lookup goes three levels back, toward them', async () => {
  const brief = (target, precursors) => ({ input: target, target, madeBy: null, proposals: precursors.map((p) => ({ precursors: p, classes: ['a class'], recorded: 1, available: true })) });
  // benzocaine ← ethyl 4-nitrobenzoate ← 4-nitrobenzoic acid ← 4-nitrotoluene
  const chain = {
    'CCOC(=O)c1ccc(N)cc1': brief('CCOC(=O)c1ccc(N)cc1', ['CCOC(=O)c1ccc([N+](=O)[O-])cc1']),
    'CCOC(=O)c1ccc([N+](=O)[O-])cc1': brief('CCOC(=O)c1ccc([N+](=O)[O-])cc1', ['CCO.O=C(O)c1ccc([N+](=O)[O-])cc1']),
    'O=C(O)c1ccc([N+](=O)[O-])cc1': brief('O=C(O)c1ccc([N+](=O)[O-])cc1', ['Cc1ccc([N+](=O)[O-])cc1']),
  };
  const asked = [];
  const invoke = async ({ input }) => {
    asked.push(input.targets);
    return { artifacts: [{ artifactType: 'reaction-disconnections', data: { disconnections: input.targets.map((t) => chain[t]).filter(Boolean) } }] };
  };
  const evidence = await scenario({ provider: TOOL, indexDir: '/idx', invoke });
  assert.deepEqual(asked, [['CCOC(=O)c1ccc(N)cc1'], ['CCOC(=O)c1ccc([N+](=O)[O-])cc1'], ['O=C(O)c1ccc([N+](=O)[O-])cc1']]);
  assert.equal(evidence.disconnections.length, 3);
  // Without starting materials it stops after two levels.
  asked.length = 0;
  Object.assign(globalThis.__ord, { provider: TOOL, indexDir: '/idx', invoke, calls: 0 });
  await quiet(() => gatherSynthesisEvidence('Propose a synthesis of benzocaine (SMILES: CCOC(=O)c1ccc(N)cc1).'));
  assert.equal(asked.length, 2);
});

test('with a textbook-scheme index, the textbook preparations of the target are cited by book and page', async () => {
  const TB = `tb-${'a'.repeat(32)}`;
  globalThis.__textbook = {
    dir: '/schemes',
    cite: (ids) => ids.filter((id) => id === TB).map((id) => ({ id, book: 'Klein Organic Chemistry 3rd Ed', page: 862, kind: 'crop', reagents: 'EtOH, H2SO4, reflux', yield: '85%', status: 'confirmed', link: 'nodus://passage/w1%23862' })),
  };
  const ordBrief = { artifacts: [{ artifactType: 'reaction-disconnections', data: { disconnections: [{ input: 'CCOC(=O)c1ccc(N)cc1', target: 'CCOC(=O)c1ccc(N)cc1', madeBy: null, proposals: [{ precursors: 'CCO.Nc1ccc(C(=O)O)cc1', classes: ['Fischer esterification'], recorded: 3, available: true }] }] } }] };
  const textbook = { artifacts: [{ artifactType: 'reaction-disconnections', data: { disconnections: [{ input: 'CCOC(=O)c1ccc(N)cc1', target: 'CCOC(=O)c1ccc(N)cc1', madeBy: { count: 1, reactions: [{ key: 'k', count: 1, samples: [TB, `tb-${'b'.repeat(32)}`, 'ord-x'], reaction: 'CCO.Nc1ccc(C(=O)O)cc1>>CCOC(=O)c1ccc(N)cc1' }] }, proposals: [] }] } }] };
  const dirs = [];
  try {
    const evidence = await scenario({ provider: TOOL, indexDir: '/idx', invoke: async ({ input }) => { dirs.push(input.indexDir); return input.indexDir === '/schemes' ? textbook : ordBrief; } });
    assert.ok(dirs.includes('/schemes'), 'the textbook index is asked');
    const payload = synthesisEvidencePayload(evidence);
    const [prep] = payload.textbook_preparations;
    assert.equal(prep.molecule, 'CCOC(=O)c1ccc(N)cc1');
    assert.equal(prep.reactions[0].citations.length, 1, 'unknown and ORD ids are not cited');
    assert.match(prep.reactions[0].citations[0], /\[\*Klein Organic Chemistry 3rd Ed\*, p\. 862\]\(nodus:\/\/passage\/w1%23862\) · conditions: EtOH, H2SO4, reflux · yield 85%/);
    assert.ok(payload.ord_disconnections, 'the ORD brief is still there');
  } finally {
    globalThis.__textbook = undefined;
  }
});

test('a textbook index that fails never blocks the request', async () => {
  globalThis.__textbook = { dir: '/schemes', cite: () => [] };
  try {
    const evidence = await scenario({ provider: TOOL, indexDir: null, invoke: async () => { throw new Error('boom'); } });
    assert.ok(evidence.passages.length > 0);
    assert.equal(evidence.textbookPreparations, undefined);
  } finally {
    globalThis.__textbook = undefined;
  }
});
