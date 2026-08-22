// The citation workspace turns the names printed under a linked work into links to
// the author's own record. Bibliographies abbreviate the given name and the record
// keeps it whole, so the match cannot be a string comparison — and it must refuse to
// guess when two people would answer to the same abbreviation.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(path.join(os.tmpdir(), 'nodus-author-links-'));
test.after(() => rm(temp, { recursive: true, force: true }));

const bundle = path.join(temp, 'author-links.cjs');
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'src/authorLinks.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
], { cwd: root, stdio: 'inherit' });
const { buildAuthorIndex, lookupAuthor } = createRequire(import.meta.url)(bundle);

function author(id, firstName, lastName) {
  return { author_id: id, firstName, lastName, name: `${lastName}, ${firstName}`, fullName: `${firstName} ${lastName}` };
}

const corpus = [
  author('a1', 'Luis', 'Alburquerque García'),
  author('a2', 'Jesús', 'Cabornero Domingo'),
  author('a3', 'Henry L.', 'Roediger'),
  author('a4', 'Ana', 'Torres'),
  author('a5', 'Alberto', 'Torres'),
];
const index = buildAuthorIndex(corpus);
const id = (name) => lookupAuthor(index, name)?.author_id ?? null;

test('a byline written out in full matches either stored form', () => {
  assert.equal(id('Alburquerque García, Luis'), 'a1');
  assert.equal(id('Luis Alburquerque García'), 'a1');
});

test('an abbreviated given name still finds the person', () => {
  assert.equal(id('Alburquerque García, L.'), 'a1');
  assert.equal(id('Cabornero Domingo, J.'), 'a2');
  assert.equal(id('L. Alburquerque García'), 'a1');
});

test('accents and punctuation do not decide the match', () => {
  assert.equal(id('Alburquerque Garcia, L'), 'a1');
  assert.equal(id('CABORNERO DOMINGO, J.'), 'a2');
});

test('a record already stored with initials matches its own byline', () => {
  assert.equal(id('Roediger, H. L.'), 'a3');
});

test('two people behind one abbreviation stay plain text', () => {
  assert.equal(id('Torres, A.'), null);
  assert.equal(id('Torres, Ana'), 'a4');
});

test('a stranger to the corpus is never linked', () => {
  assert.equal(id('Martín, M.'), null);
  assert.equal(id('Alburquerque'), null);
  assert.equal(id(''), null);
});
