import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'compass-search-cases.json');
// Keep the transient bundle below the repository so Node's normal package
// resolution can find the native better-sqlite3 dependency. It is removed by
// test.after and is never a repository artifact.
const temp = await mkdtemp(path.join(root, 'scripts/fixtures/visual-tests/.tmp-compass-'));
const built = new Map();

async function load(entry, name, options = {}) {
  if (built.has(name)) return built.get(name);
  const outfile = path.join(temp, `${name}.mjs`);
  await build({
    entryPoints: [path.join(root, entry)], outfile, bundle: true, format: 'esm', platform: 'node',
    target: 'es2022', logLevel: 'silent', ...options,
  });
  const module = await import(`${pathToFileURL(outfile).href}?${Date.now()}`);
  built.set(name, module);
  return module;
}

test.after(async () => { await rm(temp, { recursive: true, force: true }); });

test('the fixture catalogue contains fifteen realistic multilingual discovery searches', async () => {
  const cases = JSON.parse(await readFile(fixturePath, 'utf8'));
  assert.equal(cases.length, 15);
  assert.ok(new Set(cases.map((item) => item.filters?.languages?.[0]).filter(Boolean)).size >= 7);
  assert.ok(cases.some((item) => item.filters?.openAccessOnly));
  assert.ok(cases.some((item) => item.filters?.types?.includes('book')));
  assert.ok(cases.some((item) => item.filters?.providers?.includes('hal')));
  assert.ok(cases.some((item) => item.failure?.status === 503));
});

test('natural-language interpretation extracts phrases, exclusions, years, languages, types, OA and identifiers', async () => {
  const { interpretCompassQuery } = await load('electron/compass/compassQueryInterpreter.ts', 'query');
  const plan = interpretCompassQuery('"open science" climate -predatory since 2020 language:fr type:thesis 10.1234/example');
  assert.deepEqual(plan.exactPhrases, ['open science']);
  assert.deepEqual(plan.excludedTerms, ['predatory']);
  assert.equal(plan.fromYear, 2020);
  assert.deepEqual(plan.languages, ['fr']);
  assert.deepEqual(plan.types, ['thesis']);
  assert.equal(plan.openAccessOnly, false);
  assert.deepEqual(plan.identifiers, [{ scheme: 'doi', value: '10.1234/example' }]);
  const oa = interpretCompassQuery('historia acceso abierto', { languages: ['es'], openAccessOnly: true });
  assert.equal(oa.openAccessOnly, true);
  assert.deepEqual(oa.languages, ['es']);
});

test('provider routing respects explicit selection and routes repository/type searches', async () => {
  const { routeCompassProviders } = await load('electron/compass/compassRouter.ts', 'router');
  const { interpretCompassQuery } = await load('electron/compass/compassQueryInterpreter.ts', 'query-again');
  const explicit = routeCompassProviders(interpretCompassQuery('topic', { providers: ['hal', 'crossref', 'hal'] }));
  assert.deepEqual(explicit, ['hal', 'crossref']);
  const routed = routeCompassProviders(interpretCompassQuery('humanities repository type:thesis'));
  assert.ok(routed.includes('hal') && routed.includes('openaire'));
  assert.ok(routed.includes('crossref') && routed.includes('openalex'));
  const books = routeCompassProviders(interpretCompassQuery('libros de historia idioma:español type:book'));
  assert.ok(books.includes('doab') && books.includes('oapen') && books.includes('dialnet') && books.includes('scielo'));
});

test('provider helpers normalize compact metadata, cap pages and create stable identifiers', async () => {
  const { author, canonicalKey, page, result } = await load('electron/compass/providers/provider.ts', 'provider');
  const record = result({ provider: 'crossref', providerId: 'x-1', title: '  A   useful title ', authors: [author({ given: 'Ada', family: 'Lovelace' })].filter(Boolean), year: 2022, doi: '10.1000/test' });
  assert.equal(record.title, 'A useful title');
  assert.deepEqual(record.authors[0], { name: 'Ada Lovelace', given: 'Ada', family: 'Lovelace', orcid: undefined });
  assert.equal(record.identifiers[0].scheme, 'doi');
  assert.equal(record.doiUrl, 'https://doi.org/10.1000/test');
  const many = Array.from({ length: 40 }, (_, i) => result({ provider: 'openalex', providerId: String(i), title: `Title ${i}` }));
  const first = page(many, 'openalex', 'cursor-2');
  assert.equal(first.records.length, 25);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextCursor, 'cursor-2');
  // DOI identity is case-insensitive at the persistence boundary. This also
  // protects callers that build canonical keys before the store's identity index.
  assert.equal(canonicalKey([{ scheme: 'doi', value: '10.1000/ABC' }], 'Title'), canonicalKey([{ scheme: 'doi', value: '10.1000/abc' }], 'Title'));
});

test('adapter pagination and transient provider failures are cancellable and retryable', async () => {
  const { createCompassAdapters } = await load('electron/compass/providers/adapters.ts', 'adapters');
  const { requestJson } = await load('electron/compass/providers/provider.ts', 'provider-retry');
  const originalFetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) return new Response('{}', { status: 429, headers: { 'retry-after': '0' } });
      return new Response(JSON.stringify({ results: [{ id: 'https://openalex.org/W1', title: 'Fixture paper', publication_year: 2024 }], meta: { next_cursor: 'next' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const adapters = createCompassAdapters();
    assert.deepEqual(new Set(adapters.keys()), new Set(['openalex', 'crossref', 'openaire', 'semanticscholar', 'hal', 'doab', 'oapen', 'dialnet', 'openedition', 'scielo', 'unpaywall', 'opencitations']));
    const pageResult = await adapters.get('openalex').search({ query: { text: 'fixture', exactPhrases: [], excludedTerms: [], authors: [], venues: [], identifiers: [], languages: [], types: [], disciplines: [], openAccessOnly: false, providers: [] }, filters: {}, signal: new AbortController().signal });
    assert.equal(pageResult.records.length, 1);
    assert.equal(pageResult.nextCursor, 'next');
    assert.equal(calls, 2);

    const controller = new AbortController();
    globalThis.fetch = (_url, init = {}) => new Promise((resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
    const pending = requestJson('https://example.invalid/slow', controller.signal);
    controller.abort();
    await assert.rejects(pending, /Abort|aborted/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CompassStore persists pagination, selections, saved/dismissed records and bounded cache state', async (t) => {
  process.env.NODUS_TEST_USERDATA = temp;
  const electronStub = path.join(root, 'scripts/stub-electron.mjs');
  const mod = await load('electron/compass/compassStore.ts', 'store', { alias: { electron: electronStub }, external: ['better-sqlite3'] });
  const { CompassStore } = mod;
  const file = path.join(temp, 'store.sqlite');
  let store;
  try {
    store = new CompassStore(file);
  } catch (error) {
    // better-sqlite3 is intentionally compiled for Electron in this project;
    // plain Node runners can have a different ABI. The same test runs in the
    // Electron validation job, where it must not be skipped.
    if (error?.code === 'ERR_DLOPEN_FAILED') {
      t.skip('better-sqlite3 native addon requires the Electron ABI');
      return;
    }
    throw error;
  }
  try {
    const session = { searchId: 'search-1', requestId: 'req-1', generation: 1, query: 'fixture', fingerprint: 'fp-1', plan: { text: 'fixture', exactPhrases: [], excludedTerms: [], authors: [], venues: [], identifiers: [], languages: [], types: [], disciplines: [], openAccessOnly: false, providers: [] }, filters: {}, state: 'partial', revision: 1, resultCount: 0, selectedCount: 0, providers: [{ provider: 'openalex', state: 'complete', count: 2 }], createdAt: 1, updatedAt: 1 };
    const { result } = await load('electron/compass/providers/provider.ts', 'provider-store');
    const one = result({ provider: 'openalex', providerId: 'W1', title: 'First Fixture', doi: '10.1000/ABC', year: 2024 });
    const two = result({ provider: 'crossref', providerId: 'C2', title: 'Second Fixture', isbn: undefined, year: 2023 });
    store.saveSearch(session);
    store.upsertResult(session.searchId, one, 1);
    store.upsertResult(session.searchId, two, 2);
    assert.equal(store.listResults(session.searchId, 0, 1).length, 1);
    assert.equal(store.listResults(session.searchId, 1, 1).length, 1);
    assert.equal(store.findResultByIdentity(session.searchId, [{ scheme: 'DOI', value: '10.1000/abc' }])?.title, 'First Fixture');
    store.setSelection(session.searchId, [one.canonicalKey, two.canonicalKey], 2);
    assert.deepEqual(new Set(store.selectedKeys(session.searchId)), new Set([one.canonicalKey, two.canonicalKey]));
    store.saveCandidate(session.searchId, one.canonicalKey);
    store.dismissCandidate(session.searchId, two.canonicalKey);
    store.putProviderCache('fixture-cache', 'openalex', { results: [one] }, 'cursor', 60_000);
    assert.equal(store.getProviderCache('fixture-cache')?.nextCursor, 'cursor');
  } finally {
    store.close();
  }
});
