import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-web-ranking-'));
const outfile = path.join(root, 'ranking.mjs');
await build({ entryPoints: [path.join(repoRoot, 'shared/webResearchRanking.ts')], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node20' });
const { webDomainPrior, isWalledSource, selectPagesToRead, selectWebPassages, rankWebResults, canonicalWebUrl, passageSimilarity } = await import(pathToFileURL(outfile).href);
test.after(() => rm(root, { recursive: true, force: true }));

const ranked = (url, score, lexical) => ({ key: url, url, title: 't', snippet: 's', domain: new URL(url).hostname.replace(/^www\./, ''), engines: ['bing'], queries: ['q'], category: 'general', publishedDate: null, score, parts: { consensus: 0, lexical, prior: 0, agreement: 0 } });
const passage = (page, domain, text, relevance) => ({ key: `${page}#${text.slice(0, 8)}`, pageKey: page, domain, text, relevance });

test('a page that refuses readers ranks last and is never read', () => {
  for (const url of ['https://www.jstor.org/stable/23530050', 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1', 'https://www.researchgate.net/profile/x/publication/1_y', 'https://www.academia.edu/download/1/x.pdf']) {
    assert.ok(webDomainPrior(url) < 0, `${url} should rank below an ordinary page`);
    assert.equal(isWalledSource(url), true, `${url} should be recognised as walled`);
  }
  const pool = [ranked('https://www.jstor.org/stable/1', 0.9, 0.9), ranked('https://www.scielo.org.mx/a', 0.5, 0.5)];
  const picked = selectPagesToRead(pool, new Set(), new Map(), 2);
  assert.deepEqual(picked.map(item => item.domain), ['scielo.org.mx']);
});

test('scholarly and institutional sources outrank ordinary pages', () => {
  assert.equal(webDomainPrior('https://www.scielo.org.mx/scielo.php?pid=1'), 0.8, 'open-access networks count whatever their country domain');
  assert.equal(webDomainPrior('https://www.cepc.gob.es/a.html'), 0.8);
  assert.equal(webDomainPrior('https://www.cambridge.org/core/journals/x/article/y'), 0.8);
  assert.equal(webDomainPrior('https://www.dialnet.unirioja.es/servlet/articulo?codigo=1'), 0.8);
  assert.ok(webDomainPrior('https://es.wikipedia.org/wiki/Represi%C3%B3n_franquista') > 0);
  assert.equal(webDomainPrior('https://example.com/blog/post'), 0);
});

test('a site that already refused keeps none of the remaining read budget', () => {
  const pool = [ranked('https://www.scielo.org.mx/a', 0.5, 0.5), ranked('https://www.cepc.gob.es/b', 0.4, 0.4), ranked('https://www.persee.fr/c', 0.3, 0.3)];
  const picked = selectPagesToRead(pool, new Set(), new Map(), 2, 2, 0.12, 0.1, new Set(['scielo.org.mx']));
  assert.deepEqual(picked.map(item => item.domain), ['cepc.gob.es', 'persee.fr']);
});

test('evidence spreads over sources instead of piling on one page', () => {
  const candidates = [
    passage('https://a.org/x', 'a.org', 'La represión franquista de posguerra se explica por la Ley de Responsabilidades Políticas y por la militarización de las instituciones del nuevo Estado.', 0.86),
    passage('https://a.org/x', 'a.org', 'Los consejos de guerra sumarísimos tramitaron cientos de miles de causas contra los vencidos entre 1939 y 1945 en toda España.', 0.84),
    passage('https://a.org/x', 'a.org', 'La cifra de víctimas mortales de la represión de posguerra sigue siendo objeto de debate entre los historiadores y las cifras varían mucho.', 0.82),
    passage('https://b.org/y', 'b.org', 'El balance historiográfico más citado estima unas cifras muy superiores a las aceptadas durante la transición y discute el método de conteo.', 0.72),
  ];
  const spread = selectWebPassages(candidates, 3, { perPage: 3, perDomain: 3, floor: 0 });
  assert.equal(spread.filter(item => item.domain === 'a.org').length, 2, 'the second source takes a slot before the first one takes three');
  assert.ok(spread.some(item => item.domain === 'b.org'));
  const single = selectWebPassages(candidates.filter(item => item.domain === 'a.org'), 3, { perPage: 3, perDomain: 3, floor: 0 });
  assert.equal(single.length, 3, 'a page with no alternative still fills the limit');
});

test('near-copies of the same text are recognised', () => {
  const text = 'La represión franquista de posguerra se explica por la Ley de Responsabilidades Políticas y por la militarización del nuevo Estado.';
  assert.ok(passageSimilarity(text, text) > 0.99);
  assert.ok(passageSimilarity(text, 'El clima de la meseta castellana es continental, con inviernos largos y veranos secos.') < 0.05);
});

test('cosmetic URL differences collapse into one document and the relevant one wins', () => {
  assert.equal(canonicalWebUrl('https://www.arxiv.org/pdf/2207.01042v1.pdf'), canonicalWebUrl('https://arxiv.org/abs/2207.01042'));
  const runs = [{ query: 'q', category: 'general', round: 1, results: [
    { url: 'https://a.org/one', title: 'Represión franquista posguerra víctimas', content: 'estudio sobre la represión franquista y las víctimas', engines: ['bing', 'brave'], positions: [1], score: 1, category: 'general', publishedDate: null },
    { url: 'https://a.org/one?utm_source=x', title: 'Represión franquista posguerra víctimas', content: 'estudio sobre la represión franquista y las víctimas', engines: ['bing'], positions: [1], score: 1, category: 'general', publishedDate: null },
    { url: 'https://z.org/other', title: 'Cocina tradicional', content: 'recetas de temporada', engines: ['bing'], positions: [9], score: 1, category: 'general', publishedDate: null },
  ] }];
  const merged = rankWebResults(runs, '¿qué factores explican la represión franquista de posguerra?');
  assert.equal(merged.filter(item => item.domain === 'a.org').length, 1);
  assert.equal(merged[0].domain, 'a.org');
});
