// No translation table may declare the same key twice.
//
// TypeScript catches this (TS1117), but only once the whole project typechecks,
// and the failure names a line rather than a key. More to the point, the mistake
// is easy to MAKE and hard to see: these tables mix three key forms — 'single',
// "double" and bare identifiers — so a search for one form happily misses an
// existing entry written in another, and the duplicate looks fine in review.
//
// That is not hypothetical. Adding Nodus Browser's strings introduced duplicates
// twice: once because the existing key used single quotes and the check looked
// for double ones, and again because `Pausar:` was written as a bare identifier.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];

/** Every key form these tables actually use. */
const KEY = /^ {2}(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([A-Za-z_$][\w$]*))\s*:/;

for (const lang of LANGS) {
  test(`src/i18n.${lang}.ts declares every key once`, () => {
    const lines = readFileSync(path.join(repoRoot, `src/i18n.${lang}.ts`), 'utf8').split('\n');
    const seen = new Map();
    const duplicates = [];
    lines.forEach((line, index) => {
      const match = KEY.exec(line);
      if (!match) return;
      const key = match[1] ?? match[2] ?? match[3];
      if (seen.has(key)) duplicates.push(`"${key}" (lines ${seen.get(key) + 1} and ${index + 1})`);
      else seen.set(key, index);
    });
    assert.ok(seen.size > 100, `the table looked wrong (${seen.size} keys parsed)`);
    assert.deepEqual(duplicates, [], `duplicate keys in i18n.${lang}.ts:\n  ${duplicates.join('\n  ')}`);
  });
}
