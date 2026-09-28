import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESKTOP_TABLES, findServerClobbers } from './i18n-server-clobber.mjs';

// The server catalogue (src/i18n.server.ts) completes every locale over English
// bases so Server Web never shows the Spanish source. Those English values used
// to be spread into the desktop tables too, late enough to replace translations
// the desktop already had: IT['Completado'] read "Completed" over "Completo".
// A non-English table must never resolve a key to English while a native
// translation of it exists, whether that translation is the desktop's own or
// the server locale's.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

async function loadModule(file) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-i18n-server-'));
  const outfile = path.join(outDir, `${path.basename(file, '.ts')}.cjs`);
  try {
    await build({
      entryPoints: [path.join(repoRoot, file)],
      outfile,
      bundle: true,
      format: 'cjs',
      platform: 'node',
      target: 'es2022',
      logLevel: 'silent',
    });
    return require(outfile);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

const NON_ENGLISH = DESKTOP_TABLES.filter((entry) => entry.lang !== 'en');

test('the server catalogue hides no native translation behind English', async () => {
  const results = await findServerClobbers(NON_ENGLISH.map((entry) => entry.lang));
  assert.equal(results.length, NON_ENGLISH.length);
  const report = results
    .flatMap(({ lang, clobbered, shadowed }) => [
      ...clobbered.map(({ key, desktop, shipped }) =>
        `  ${lang} ${JSON.stringify(key)}: ${JSON.stringify(shipped)} over the desktop's ${JSON.stringify(desktop)}`,
      ),
      ...shadowed.map(({ key, server, shipped }) =>
        `  ${lang} ${JSON.stringify(key)}: ${JSON.stringify(shipped)} over the server's ${JSON.stringify(server)}`,
      ),
    ])
    .join('\n');
  assert.equal(report, '', `Native translations resolved to English:\n${report}`);
});

test('a server locale slice carries only what that locale translates', async () => {
  // The English bases belong to SERVER_TRANSLATIONS alone. A slice that spreads
  // one of them (SERVER_READER_LOCALE_OVERRIDES once spread SERVER_READER_EN in
  // every locale) overwrites the locale's own translations with English.
  const { SERVER_LOCALE_TRANSLATIONS, SERVER_TRANSLATIONS } = await loadModule('src/i18n.server.ts');
  for (const entry of NON_ENGLISH) {
    const own = SERVER_LOCALE_TRANSLATIONS[entry.lang] ?? {};
    const english = Object.keys(own).filter((key) => own[key] === SERVER_TRANSLATIONS.en[key]);
    // A handful of product names and loanwords legitimately read the same.
    assert.ok(
      english.length <= Object.keys(own).length * 0.1,
      `${entry.lang}: ${english.length} of ${Object.keys(own).length} server entries are English`,
    );
  }
});

test('the reported Italian case reads in Italian', async () => {
  const { IT } = await loadModule('src/i18n.it.ts');
  assert.equal(IT.Completado, 'Completo');
});
