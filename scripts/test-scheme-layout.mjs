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
const loaderFile = path.join(tmp, 'pdfjsLoader.mjs');
await build({ entryPoints: [path.join(root, 'electron/extraction/pdfjsLoader.ts')], outfile: loaderFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { pageTextWithSchemes } = await import(pathToFileURL(loaderFile).href);
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

const extractPage = items => pageTextWithSchemes({ getTextContent: async () => ({ items: items.map(entry => ({ ...entry, hasEOL: true })) }) });

test('small Japanese, Chinese and Korean prose survives both classification and extraction', async () => {
  for (const text of [
    'これは学術論文の本文であり、化学構造式ではありません。',
    '研究结果与讨论以普通的学术文章形式呈现，这些内容必须保留。',
    '이 문장은 학술 논문의 본문이며 화학 구조식이 아닙니다.',
  ]) {
    const items = [item(text, 111, 600, 8, 340), item(text, 111, 588, 8, 340), item(text, 111, 576, 8, 340)];
    const layout = pageSchemeLayout(items);
    assert.equal(layout.body, 8, 'non-Latin prose contributes to the body-size estimate');
    assert.deepEqual(layout.scheme, [false, false, false]);
    const result = await extractPage(items);
    assert.equal(result.declutteredText, result.text, text);
    // A book-wide body hint must not discard a smaller sidebar or a short line in the margin.
    const sidebar = [...page, item(text, 20, 440, 8, 70), item('結果', 20, 428, 8, 20)];
    const hinted = pageSchemeLayout(sidebar, 10);
    assert.equal(hinted.scheme.at(-2), false);
    assert.equal(hinted.margin.at(-2), false);
    assert.equal(hinted.margin.at(-1), false);
  }
});

test('small Cyrillic and accented Latin prose is counted as prose', () => {
  for (const text of [
    'Исследование объясняет важные результаты научной работы подробно',
    'Éléments étudiés révèlent différentes réactions chimiques intéressantes',
  ]) {
    const items = [item(text, 111, 600, 8, 340), item(text, 111, 588, 8, 340), item(text, 111, 576, 8, 340)];
    assert.equal(pageSchemeLayout(items).body, 8);
    assert.deepEqual(pageSchemeLayout(items).scheme, [false, false, false]);
  }
});

test('captions and references remain protected between two scheme rows', async () => {
  for (const label of ['Figure 1. Reaction pathways', 'Figure S1', 'Fig. IV', 'Figura 1. Rutas de reacción', 'Tabelle 1. Reaktionswege', 'Şekil 1. Tepkime yolları', '1 S. Smith (1990)']) {
    const items = [
      prose(700, 'ordinary body prose containing enough words to estimate the main font size'),
      prose(688, 'another line of ordinary body prose continues in the main text column'),
      prose(676, 'a third line of ordinary body prose completes the main text paragraph'),
      item('OH O N O', 150, 620, 8, 100),
      item(label, 111, 605, 8, 160),
      item('OH O N O', 150, 590, 8, 100),
    ];
    assert.equal(pageSchemeLayout(items).scheme[4], false, label);
    const result = await extractPage(items);
    assert.ok(result.declutteredText.includes(label), label);
    assert.ok(result.declutteredText.includes('[scheme]'), 'the surrounding schemes are still removed');
  }
});

test('a caption outside the main text column is not discarded as margin', () => {
  const items = [...page, item('Figure 1. Pathways', 20, 440, 8, 70)];
  const layout = pageSchemeLayout(items);
  assert.equal(layout.scheme.at(-1), false);
  assert.equal(layout.margin.at(-1), false);
});

test('short ordinary phrases and verse in small type are not a run of scheme labels', async () => {
  const text = ['This is a line', 'A quiet river', 'The trees bend', 'We watch the sky'];
  const items = text.map((line, index) => item(line, 111, 600 - index * 12, 8, 120));
  assert.deepEqual(pageSchemeLayout(items, 10).scheme, [false, false, false, false]);
  const result = await extractPage(items);
  assert.equal(result.declutteredText, text.join('\n'));
});
