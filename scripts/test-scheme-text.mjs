import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-scheme-text-'));
const outfile = path.join(tmp, 'schemeText.mjs');
await build({ entryPoints: [path.join(root, 'shared/schemeText.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { removeLayoutLines, cleanChunkText } = await import(pathToFileURL(outfile).href);
test.after(() => rm(tmp, { recursive: true, force: true }));

const passage = 'synthesis of tropinone, a derivative of the alkaloid tropine, in 1917. CO2 – 2 CH2 CHO + H2NCH3 + C O CH3 N O Ref. 191 As with aldol additions, the Mannich reaction uses 2 equivalents. CHAPTER 2 Reactions of Carbon';
const lines = {
  scheme: ['CO2 –', '2', 'CH2 CHO + H2NCH3 + C O', 'CH3 N O', 'Ref. 191'],
  margin: ['CHAPTER 2', 'Reactions of Carbon'],
};

test('scheme lines become one placeholder and margin lines disappear', () => {
  assert.equal(removeLayoutLines(passage, lines),
    'synthesis of tropinone, a derivative of the alkaloid tropine, in 1917. [scheme] As with aldol additions, the Mannich reaction uses 2 equivalents.');
});

test('a one-token line counts only beside another removed line: the same token in prose stays', () => {
  const text = 'the reaction uses 2 equivalents of base. O CH3 CH3 then water';
  assert.equal(removeLayoutLines(text, { scheme: ['2', 'O CH3 CH3'], margin: [] }), 'the reaction uses 2 equivalents of base. [scheme] then water');
});

test('matching is by whole tokens and ignores spacing changes', () => {
  assert.equal(removeLayoutLines('the CH3 group CH3I', { scheme: ['CH3'], margin: [] }), 'the CH3 group CH3I', 'a one-token scheme label is not taken from prose');
  assert.equal(removeLayoutLines('before 1) LDA,THF 2) CH3I after', { scheme: ['1) LDA, THF', '2) CH3I'], margin: [] }), 'before [scheme] after');
  assert.equal(removeLayoutLines('prose only', { scheme: ['NaBH4'], margin: [] }), 'prose only');
});

test('a chunk crossing pages uses each page\'s own lines', () => {
  const text = 'end of page one CH3 OH next page prose CO2H NaOH here';
  const pageStarts = [{ page: 1, offset: 0 }, { page: 2, offset: text.indexOf('next') }];
  const byPage = { 1: { scheme: ['CH3 OH'], margin: [] }, 2: { scheme: ['CO2H NaOH'], margin: [] } };
  assert.equal(cleanChunkText(text, 1, pageStarts, (page) => byPage[page] ?? null), 'end of page one [scheme] next page prose [scheme] here');
  assert.equal(cleanChunkText(text, 1, undefined, () => null), text, 'no layout: unchanged');
});
