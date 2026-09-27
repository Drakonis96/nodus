import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-web-flow-'));
const outfile = path.join(root, 'webResearch.mjs');
await build({
  entryPoints: [path.join(repoRoot, 'electron/websearch/webResearch.ts')], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node20',
  alias: { '@shared': path.join(repoRoot, 'shared') },
});
const { runWebResearch } = await import(pathToFileURL(outfile).href);
test.after(() => rm(root, { recursive: true, force: true }));

const QUESTION = '¿Qué factores explican la represión franquista de posguerra y cuántas víctimas estiman los historiadores?';
const PARAGRAPH = 'La represión franquista de posguerra se explica por la Ley de Responsabilidades Políticas de 1939, por la militarización de las instituciones del nuevo Estado y por la depuración de la administración pública. ';
const hit = (url, index, engines = ['bing']) => ({ url, title: `Estudio sobre la represión franquista ${index}`, content: 'estudio historiográfico sobre la represión franquista y las víctimas de posguerra', engines, positions: [index], score: 1, category: 'general', publishedDate: null });

/** The step with every dependency injected: no network, no model, no clock. */
function harness({ general = [], science = [], fail = [], empty = [], enginesFor = () => ['bing'] }) {
  const fetched = [];
  const searches = [];
  const deps = {
    search: async (query, category) => {
      searches.push(`${category}|${query}`);
      return { results: (category === 'general' ? general : science).map((url, index) => hit(url, index + 1, enginesFor(url))), unresponsive: category === 'general' ? [['duckduckgo', 'CAPTCHA']] : [] };
    },
    fetchPage: async url => {
      fetched.push(url);
      if (fail.some(pattern => url.includes(pattern))) throw new Error('refused');
      return { url, finalUrl: url, kind: 'html', body: '<html></html>', contentType: 'text/html' };
    },
    extract: async page => ({
      kind: 'html', title: `Documento ${new URL(page.finalUrl).hostname}`, siteName: null, byline: null, publishedAt: null, doi: null, pdfUrl: null, language: 'es',
      blocks: empty.some(pattern => page.finalUrl.includes(pattern)) ? [] : [{ heading: 'La represión', text: PARAGRAPH.repeat(6), pageNumber: null }],
      challenge: false,
    }),
    planQueries: async () => ({ search: true, queries: [{ q: 'represión franquista posguerra víctimas', scholarly: false }, { q: 'francoist repression victims historiography', scholarly: true }] }),
    reformulate: async () => [],
    now: () => Date.now(),
  };
  return { deps, fetched, searches };
}
const run = (deps, signal = new AbortController().signal) => runWebResearch({
  question: QUESTION, depth: 'balanced', hint: [], intent: 'expand', library: '', signal, activity: { start: () => () => {} },
}, deps);

test('an empty general query is recorded honestly and not searched twice', async () => {
  const { deps, searches } = harness({ science: ['https://www.scielo.org.mx/a', 'https://www.cepc.gob.es/b'] });
  const outcome = await run(deps);
  assert.ok(outcome.queries.filter(item => item.category === 'general').every(item => item.results === 0));
  assert.equal(searches.length, new Set(searches).size, 'no query is searched twice on the same category');
  assert.ok(outcome.evidence.length > 0, 'the scholarly queries still bring the evidence');
});

test('a page that refuses leaves its slot to another site', async () => {
  const urls = ['https://refuses.example/a', 'https://refuses.example/b', 'https://www.cepc.gob.es/c', 'https://www.scielo.org.mx/d', 'https://www.persee.fr/e', 'https://www.hal.science/f', 'https://www.cervantesvirtual.com/g', 'https://www.bne.es/h'];
  const { deps, fetched } = harness({ science: urls, fail: ['refuses.example'] });
  const outcome = await run(deps);
  assert.equal(fetched.filter(url => url.includes('refuses.example')).length, 2, 'each refusing page is attempted once');
  assert.equal(outcome.consulted.filter(page => page.outcome === 'read').length, 6, 'the two lost slots were spent on other sites');
  for (const [, count] of outcome.consulted.reduce((map, page) => map.set(page.domain, (map.get(page.domain) ?? 0) + 1), new Map())) assert.ok(count <= 3, 'no site takes more than its share of the budget');
});

test('a walled result is listed but never read', async () => {
  const { deps, fetched } = harness({ science: ['https://www.jstor.org/stable/1', 'https://www.scielo.org.mx/a', 'https://www.persee.fr/b'] });
  const outcome = await run(deps);
  assert.ok(!fetched.some(url => url.includes('jstor.org')));
  assert.deepEqual(outcome.consulted.map(page => page.domain).sort(), ['persee.fr', 'scielo.org.mx']);
});

test('a page with no text is recorded as empty and contributes no passage', async () => {
  const { deps } = harness({ science: ['https://www.scielo.org.mx/a', 'https://www.persee.fr/b'], empty: ['scielo.org.mx'] });
  const outcome = await run(deps);
  assert.equal(outcome.consulted.find(page => page.domain === 'scielo.org.mx')?.outcome, 'empty');
  assert.ok(!outcome.evidence.some(item => item.domain === 'scielo.org.mx'));
  assert.ok(outcome.evidence.some(item => item.domain === 'persee.fr'));
});

test('cancelling stops the step', async () => {
  const { deps } = harness({ science: ['https://www.scielo.org.mx/a'] });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => run(deps, controller.signal));
});
