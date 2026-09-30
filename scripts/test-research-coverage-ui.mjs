import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire, Module } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const fixture = build({
  stdin: { contents: "export { ResearchCoverage } from './src/components/ResearchCoverage'; export { setActiveLang } from './src/i18n'; export { compactResearchTraversal } from './shared/researchCorpus';",
    resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react/jsx-runtime'],
}).then(result => {
  const module = new Module(path.join(process.cwd(), 'scripts', 'research-coverage-fixture.cjs'));
  module.paths = Module._nodeModulePaths(process.cwd());
  module._compile(result.outputFiles[0].text, module.id);
  return module.exports;
});

function coverage() {
  const sources = Array.from({ length: 65 }, (_, i) => ({ documentId: `d${i}`, title: i === 0 ? 'Fuente consultada sin coincidencias' : `Obra ${i}`,
    reasons: i < 3 ? ['ocr_required', 'text_pending'] : [] }));
  return { scopeId: 'scope', sourceCount: 65, sourceCoverage: sources, matchedDocumentIds: ['d30'], readDocumentIds: [],
    catalogDocumentIds: ['d31'], limitations: ['ocr_required', 'text_pending'], rounds: 2, evidenceTokens: 500, partial: false,
    queries: [{ query: 'término ausente', sources: ['d0'], candidates: 0, partial: false },
      { query: 'consulta general', sources: sources.map(source => source.documentId), candidates: 4, partial: false }] };
}

test('coverage renders failed targets, scope query counts and omitted reason counts after storage', async () => {
  const { ResearchCoverage, compactResearchTraversal, setActiveLang } = await fixture;
  setActiveLang('es');
  const stored = JSON.parse(JSON.stringify(compactResearchTraversal(coverage())));
  const dom = new JSDOM(renderToStaticMarkup(React.createElement(ResearchCoverage, { value: stored })));
  try {
    const { document } = dom.window;
    assert.match(document.querySelector('summary').textContent, /Cobertura documental: 65 Fuentes/);
    assert.doesNotMatch(document.querySelector('summary').textContent, /Cobertura parcial/, 'storage compaction does not invent a retrieval failure');
    const queries = [...document.querySelectorAll('ol > li')].map(item => item.textContent);
    assert.match(queries[0], /término ausente · Fuente consultada sin coincidencias · 0 Candidatos por búsqueda/);
    assert.match(queries[1], /consulta general · 65 Fuentes · 4 Candidatos por búsqueda/);
    const detail = document.querySelector('details details');
    const listed = [...detail.querySelector('ul').children].map(item => item.textContent);
    assert.deepEqual(listed, ['Fuente consultada sin coincidencias · OCR pendiente · Preparación pendiente', 'Obra 30', 'Obra 31']);
    assert.equal(detail.querySelector('p').textContent, 'Fuentes adicionales resumidas: 62');
    const omitted = [...detail.querySelector('div ul').children].map(item => item.textContent.trim());
    assert.deepEqual(omitted, ['OCR pendiente: 2', 'Preparación pendiente: 2']);
    assert.doesNotMatch(document.body.textContent, /d0|scope|ocr_required|text_pending/, 'internal IDs and reason codes stay out of the panel');
  } finally { dom.window.close(); }
});

test('a turn with no relevant sources still displays its omitted coverage', async () => {
  const { ResearchCoverage, compactResearchTraversal, setActiveLang } = await fixture;
  setActiveLang('es');
  const stored = compactResearchTraversal({ ...coverage(), matchedDocumentIds: [], catalogDocumentIds: [], queries: [] });
  const dom = new JSDOM(renderToStaticMarkup(React.createElement(ResearchCoverage, { value: stored })));
  try {
    const detail = dom.window.document.querySelector('details details');
    assert.ok(detail, 'an empty retained list cannot hide the coverage summary');
    assert.equal(detail.querySelector('p').textContent, 'Fuentes adicionales resumidas: 65');
    assert.match(detail.textContent, /OCR pendiente: 3/);
  } finally { dom.window.close(); }
});

test('older full records and the original compact records render without new optional fields', async () => {
  const { ResearchCoverage, setActiveLang } = await fixture;
  setActiveLang('es');
  for (const sources of [coverage().sourceCoverage, [{ documentId: 'd30', title: 'Obra 30', reasons: [] }], undefined]) {
    const legacy = { scopeId: 'old', sourceCount: 65, sourceCoverage: sources, rounds: 1, evidenceTokens: 2, partial: true,
      queries: [{ query: 'old query', sources: ['d30'], candidates: 1, partial: true }] };
    const dom = new JSDOM(renderToStaticMarkup(React.createElement(ResearchCoverage, { value: legacy })));
    try {
      assert.match(dom.window.document.body.textContent, /Cobertura parcial/);
      assert.match(dom.window.document.body.textContent, /old query/);
      assert.doesNotMatch(dom.window.document.body.textContent, /Fuentes adicionales resumidas|undefined|NaN/, 'no counts are invented for earlier lossy records');
    } finally { dom.window.close(); }
  }
});

test('the coverage summary is translated in every supported interface language', async () => {
  const { ResearchCoverage, compactResearchTraversal, setActiveLang } = await fixture;
  const stored = compactResearchTraversal(coverage());
  for (const language of ['en', 'fr', 'de', 'it', 'pt', 'pt-BR', 'tr', 'zh-CN', 'zh-TW', 'ko', 'ja']) {
    setActiveLang(language);
    const dom = new JSDOM(renderToStaticMarkup(React.createElement(ResearchCoverage, { value: stored })));
    try {
      const summary = dom.window.document.querySelector('details details p').textContent;
      assert.ok(summary.includes('62'), `${language}: the omitted count is visible`);
      assert.ok(!summary.includes('{n}') && !summary.includes('Fuentes adicionales resumidas'), `${language}: translated and interpolated`);
    } finally { dom.window.close(); }
  }
  setActiveLang('es');
});
