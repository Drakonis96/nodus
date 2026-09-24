// The Global Library's clean Markdown carries no page markers; its source map does.
// "Extraer ideas" reads that clean copy and republishes it to the documentary index,
// so before this the passages of a Library PDF lost their pages once Ideas were
// extracted: Research Chat could quote a sentence but not say on which page it was.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const repo = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-library-pages-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const outfile = path.join(scratch, 'pages.cjs');
await build({ stdin: { contents: "export * from './electron/library/librarySourcePages'; export { planRetrievalChunks } from './shared/retrievalChunks';", resolveDir: repo, loader: 'ts' },
  outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', alias: { '@shared': path.join(repo, 'shared') } });
const { libraryMarkdownWithPageMarkers, readDocumentarySourceMap, planRetrievalChunks } = createRequire(import.meta.url)(outfile);

const paragraphs = [
  'Capítulo primero: método. La muestra excluye deliberadamente las parcelas de secano.',
  'Capítulo segundo: resultados. El ahorro no se tradujo en una reducción del caudal extraído del acuífero.',
  'Capítulo segundo, continuación. El descenso se mantuvo en las cuatro visitas.',
  'Capítulo tercero: recomendaciones. Extender el goteo a otras 90 parcelas.',
];
const markdown = paragraphs.join('\n\n');
const starts = paragraphs.map((_, index) => paragraphs.slice(0, index).reduce((sum, value) => sum + value.length + 2, 0));
const pages = [1, 2, 2, 3];
const map = { version: 1, source: { file: 'source.pdf', sha256: 'x' }, reader: { file: 'reader.md', sha256: createHash('sha256').update(markdown).digest('hex') },
  pages: [1, 2, 3].map(page => ({ page, width: 612, height: 792 })),
  blocks: paragraphs.map((text, index) => ({ id: `b${index}`, kind: 'paragraph', markdown: { start: starts[index], end: starts[index] + text.length }, anchors: [{ page: pages[index], bbox: [0, 0, 1, 1] }] })) };

test('the clean Markdown regains a marker at every page change', () => {
  const text = libraryMarkdownWithPageMarkers(markdown, map);
  assert.deepEqual(text.match(/\[\[p\. \d+\]\]/g), ['[[p. 1]]', '[[p. 2]]', '[[p. 3]]'], 'one marker per page, none repeated within a page');
  assert.equal(text.replace(/\n?\[\[p\. \d+\]\]\n/g, ''), markdown.replaceAll('\n\n', '\n\n'), 'the text itself is unchanged');
});

test('passages built from the clean copy carry the page of what they quote', () => {
  const quote = 'El ahorro no se tradujo';
  const without = planRetrievalChunks(markdown, { chunkWords: 12, overlapWords: 0 }).find(chunk => chunk.text.includes(quote));
  assert.equal(without.pageLabel, null, 'the clean copy alone has no pages (the defect)');
  const withPages = planRetrievalChunks(libraryMarkdownWithPageMarkers(markdown, map), { chunkWords: 12, overlapWords: 0 }).find(chunk => chunk.text.includes(quote));
  // A passage may cross a page boundary; its range must cover the page of the quote.
  assert.ok(withPages.pageNumber <= 2 && (withPages.pageEnd ?? withPages.pageNumber) >= 2, JSON.stringify(withPages));
  assert.match(withPages.pageLabel, /^p\. 2$|^pp\. [12]–[23]$/);
});

test('a map for other bytes, or no map, never invents a page', () => {
  assert.equal(libraryMarkdownWithPageMarkers(`${markdown} edited`, map), `${markdown} edited`);
  assert.equal(libraryMarkdownWithPageMarkers(markdown, null), markdown);
});

test('the source map is read only from inside its extraction folder', () => {
  const folder = fs.mkdtempSync(path.join(scratch, 'item-'));
  fs.writeFileSync(path.join(folder, 'source-map.json'), JSON.stringify(map));
  fs.writeFileSync(path.join(scratch, 'outside.json'), JSON.stringify(map));
  assert.equal(readDocumentarySourceMap(folder).reader.sha256, map.reader.sha256);
  assert.equal(readDocumentarySourceMap(folder, '../outside.json'), null);
});

test('the deep-scan text of a Library item goes through the page markers', () => {
  const source = fs.readFileSync(path.join(repo, 'electron/extraction/textExtractor.ts'), 'utf8');
  const branch = source.slice(source.indexOf('getLibraryReaderRawContent(zoteroKey)'), source.indexOf("origin: 'library_clean'"));
  assert.match(branch, /libraryMarkdownWithPageMarkers\(clean\.markdown, readDocumentarySourceMap\(clean\.folder, clean\.sourceMapFile\)\)/);
});
