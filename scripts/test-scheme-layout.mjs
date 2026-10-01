import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-scheme-layout-'));
const outfile = path.join(tmp, 'schemeLayout.mjs');
await build({ entryPoints: [path.join(root, 'electron/extraction/schemeLayout.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { pageSchemeLayout } = await import(pathToFileURL(outfile).href);
test.after(() => rm(tmp, { recursive: true, force: true }));

// A textbook page modelled on a real one: 10 pt prose in a column at x=111, a reaction scheme
// in 8 pt fragments with 6 pt subscripts, 8 pt footnotes, and a 7 pt running head at x=25.
const item = (str, x, y, size, width = str.length * size * 0.5) => ({ str, transform: [size, 0, 0, size, x, y], width, height: size });
const prose = (y, str) => item(str, 111, y, 10, 340);
const page = [
  item('Reactions of Carbon', 25, 632, 7, 59),
  prose(666, 'conjugate addition reactions carried out by in situ generation of unsaturated'),
  prose(653, 'carbonyl compounds from Mannich bases and the synthesis of vernolepin, a compound'),
  item('186', 394, 657, 6, 10),
  prose(641, 'with antileukemic activity was achieved in five steps from the lactone precursor.'),
  // The scheme.
  item('1) LDA, THF, HMPA', 246, 572, 8), item('CH', 168, 574, 8), item('CH', 191, 574, 8),
  item('OH', 224, 566, 8), item('2) CH', 246, 562, 8), item('N(CH', 278, 561, 8), item('O', 172, 558, 8),
  item('2', 267, 552, 6), item('3', 298, 552, 6), item('2', 304, 552, 6),
  item('3) H', 246, 546, 8), item('O', 162, 541, 8), item('O', 321, 545, 8),
  item('vernolepin', 339, 516, 8),
  prose(479, 'Mannich reactions, or a mechanistic analog, are important in the biosynthesis of'),
  prose(466, 'many nitrogen-containing natural products, as in the synthesis of tropinone.'),
  // Footnotes.
  item('186', 110, 177, 5, 8), item('S. M. Kupchan, M. A. Eakin, and A. M. Thomas, J. Med. Chem., 14, 1147 (1971).', 124, 174, 8, 300),
  item('191', 110, 160, 5, 8), item('R. Robinson, J. Chem. Soc., 762 (1917).', 124, 157, 8, 150),
];
const byText = (layout, flag) => page.filter((_, index) => layout[flag][index]).map((entry) => entry.str);

test('the body size is the size carrying most text', () => {
  assert.equal(pageSchemeLayout(page).body, 10);
});

test('scheme fragments, their subscript row and the compound label are a scheme', () => {
  const schemeItems = byText(pageSchemeLayout(page), 'scheme');
  for (const expected of ['1) LDA, THF, HMPA', 'CH', 'N(CH', '3) H', 'vernolepin']) assert.ok(schemeItems.includes(expected), expected);
  assert.equal(page.filter((entry, index) => entry.str === '2' && pageSchemeLayout(page).scheme[index]).length, 2, 'the subscript row joins the scheme');
});

test('prose, a superscript citation and footnotes are not a scheme', () => {
  const schemeItems = byText(pageSchemeLayout(page), 'scheme');
  for (const kept of page.filter((entry) => entry.height === 10 || entry.str.includes('(19') || /^\d{3}$/.test(entry.str))) {
    assert.ok(!schemeItems.includes(kept.str) || kept.str === '2', kept.str);
  }
});

test('the running head in the margin is reported apart', () => {
  const layout = pageSchemeLayout(page);
  assert.deepEqual(byText(layout, 'margin'), ['Reactions of Carbon']);
  assert.ok(!layout.scheme[0]);
});

test('a page of prose only has no scheme; an empty page is empty', () => {
  const plain = [prose(600, 'one line of ordinary prose set in the body type across the column'), prose(588, 'and another line'), prose(576, 'and a third')];
  assert.deepEqual(pageSchemeLayout(plain).scheme, [false, false, false]);
  assert.deepEqual(pageSchemeLayout([]), { body: 0, scheme: [], margin: [] });
});

test('a sidebar of small prose outside the column, and its last short line, stay text', () => {
  const side = (y, str, x = 20, width = 180) => item(str, x, y, 9, width);
  const sidebarPage = [
    prose(600, 'the body column carries the main text of the chapter in ten point type here'),
    prose(588, 'and continues for several lines so that the column edge can be measured well'),
    prose(576, 'before the page ends with another ordinary line of body text in the column'),
    side(600, 'Fermentation of lactose produces several'), side(589, 'by-products, including the familiar'), side(578, 'lactic acid.', 20, 40),
    item('CHAPTER 2', 20, 700, 7, 30),
  ];
  const layout = pageSchemeLayout(sidebarPage);
  assert.deepEqual(sidebarPage.filter((_, index) => layout.scheme[index]).map((entry) => entry.str), [], 'no sidebar line is a scheme');
  assert.deepEqual(sidebarPage.filter((_, index) => layout.margin[index]).map((entry) => entry.str), ['CHAPTER 2'], 'only the short tab is margin');
});

test('a figure caption in small type stays text', () => {
  const captioned = [...page, item('FIGURE 8.4 The notion of', 111, 500, 8, 110), item('pseudoatoms.', 111, 490, 8, 50)];
  const layout = pageSchemeLayout(captioned);
  assert.ok(!layout.scheme[captioned.length - 2] && !layout.scheme[captioned.length - 1]);
});

test('a row of structure fragments at body size is a scheme; an equation or a number row is not', () => {
  const rows = [
    prose(600, 'ordinary prose in the column that runs the full width of it and more'),
    prose(588, 'more prose that also runs the full width of the column as prose does'),
    prose(576, 'and a third line of prose so that the column can be measured properly'),
    item('OH', 150, 540, 10), item('O', 200, 540, 10), item('O', 240, 540, 10), item('N', 280, 540, 10), item('O', 320, 540, 10),
    item('ΔG = ΔH − TΔS', 150, 520, 10, 120),
    item('1 2 3 4 5', 150, 500, 10, 80),
  ];
  const layout = pageSchemeLayout(rows);
  assert.deepEqual(rows.filter((_, index) => layout.scheme[index]).map((entry) => entry.str), ['OH', 'O', 'O', 'N', 'O']);
});
