#!/usr/bin/env node
// Lists desktop translations that the Nodus Server catalogue overrides.
//
// Every desktop table (src/i18n.<lang>.ts) also carries the server catalogue
// (src/i18n.server.ts). That catalogue builds each locale over English bases, so
// a key it only has in English used to reach the desktop table as an English
// value and replace a translation the desktop already had: IT['Completado']
// read "Completed" although the Italian table says "Completo".
//
// Each table is bundled twice: as it ships, and with the server catalogue
// emptied. The second bundle is what the desktop alone says; any key whose
// shipped value differs from it AND reads as the English value is a desktop
// translation the server catalogue clobbered. For English itself there is no
// "English fallback" to detect, so any value that differs is reported.
//
// Usage: node scripts/i18n-server-clobber.mjs [lang…]
// Exits 1 when any non-English table has lost a translation.

import { build } from 'esbuild';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

export const DESKTOP_TABLES = [
  { lang: 'en', file: 'src/i18n.en.ts', export: 'EN' },
  { lang: 'fr', file: 'src/i18n.fr.ts', export: 'FR' },
  { lang: 'de', file: 'src/i18n.de.ts', export: 'DE' },
  { lang: 'pt', file: 'src/i18n.pt.ts', export: 'PT' },
  { lang: 'pt-BR', file: 'src/i18n.pt-BR.ts', export: 'PT_BR' },
  { lang: 'it', file: 'src/i18n.it.ts', export: 'IT' },
  { lang: 'tr', file: 'src/i18n.tr.ts', export: 'TR' },
  { lang: 'zh-CN', file: 'src/i18n.zh-CN.ts', export: 'ZH_CN' },
  { lang: 'zh-TW', file: 'src/i18n.zh-TW.ts', export: 'ZH_TW' },
  { lang: 'ja', file: 'src/i18n.ja.ts', export: 'JA' },
  { lang: 'ko', file: 'src/i18n.ko.ts', export: 'KO' },
];

const SERVER_MODULE = path.join(repoRoot, 'src', 'i18n.server.ts');

// Replaces src/i18n.server.ts with an empty catalogue: every locale lookup,
// in either export, answers {}.
const emptyServerCatalogue = {
  name: 'empty-server-catalogue',
  setup(build) {
    build.onLoad({ filter: /[\\/]i18n\.server\.ts$/ }, (args) => {
      if (path.resolve(args.path) !== SERVER_MODULE) return undefined;
      const empty = 'new Proxy({}, { get: () => ({}) })';
      return {
        loader: 'ts',
        contents: [
          `export const SERVER_LOCALE_TRANSLATIONS: Record<string, Record<string, string>> = ${empty};`,
          `export const SERVER_TRANSLATIONS: Record<string, Record<string, string>> = ${empty};`,
          `export const SERVER_ENGLISH_FALLBACKS: Record<string, Record<string, string>> = ${empty};`,
        ].join('\n'),
      };
    });
  },
};

let outDir;
let bundleCount = 0;

async function bundle(file, plugins = []) {
  outDir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-i18n-clobber-'));
  const outfile = path.join(outDir, `${path.basename(file, '.ts')}-${bundleCount++}.cjs`);
  // The async API: esbuild runs plugins only there.
  await build({
    entryPoints: [path.join(repoRoot, file)],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'es2022',
    logLevel: 'silent',
    plugins,
  });
  return require(outfile);
}

/**
 * For each requested language, the English the server catalogue brings in over
 * a native translation:
 *   - clobbered: the desktop table's own translation, replaced;
 *   - shadowed: the server locale's own translation, hidden behind English the
 *     desktop table did not write itself (a word the desktop deliberately
 *     spells like English, French "Index", is its call and is not reported).
 * Returns [{ lang, clobbered: [{ key, desktop, shipped }], shadowed: [{ key, server, shipped }] }].
 */
export async function findServerClobbers(langs = DESKTOP_TABLES.map((entry) => entry.lang)) {
  try {
    // "English" is either wording: the desktop English table's or the server
    // catalogue's own English base, which is what leaks into the other locales
    // and does not always match the desktop ('Completado': "Complete" on the
    // desktop, "Completed" in the server catalogue).
    const desktopEnglish = (await bundle('src/i18n.en.ts')).EN;
    const server = await bundle('src/i18n.server.ts');
    const serverEnglish = server.SERVER_TRANSLATIONS.en;
    const isEnglish = (key, value) => value === desktopEnglish[key] || value === serverEnglish[key];
    const results = [];
    for (const entry of DESKTOP_TABLES.filter((table) => langs.includes(table.lang))) {
      const shipped = (await bundle(entry.file))[entry.export];
      const desktop = (await bundle(entry.file, [emptyServerCatalogue]))[entry.export];
      const clobbered = [];
      for (const [key, own] of Object.entries(desktop)) {
        const value = shipped[key];
        if (value === own) continue;
        // English has no fallback to tell apart: any replacement is reported.
        if (entry.lang !== 'en') {
          if (isEnglish(key, own)) continue; // the desktop had no translation to lose
          if (!isEnglish(key, value)) continue; // replaced by another native value
        }
        clobbered.push({ key, desktop: own, shipped: value });
      }
      const shadowed = [];
      if (entry.lang !== 'en') {
        for (const [key, native] of Object.entries(server.SERVER_LOCALE_TRANSLATIONS[entry.lang] ?? {})) {
          const value = shipped[key];
          if (isEnglish(key, native) || !isEnglish(key, value) || value === desktop[key]) continue;
          shadowed.push({ key, server: native, shipped: value });
        }
      }
      results.push({ lang: entry.lang, clobbered, shadowed });
    }
    return results;
  } finally {
    if (outDir) fs.rmSync(outDir, { recursive: true, force: true });
    outDir = undefined;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const requested = process.argv.slice(2);
  const results = await findServerClobbers(requested.length ? requested : undefined);
  let total = 0;
  for (const { lang, clobbered, shadowed } of results) {
    // English cannot lose a translation to an English fallback; what is left
    // there is only the server's own English wording, listed for review.
    const label =
      lang === 'en'
        ? 'desktop wording(s) the server catalogue rewrites (informational)'
        : 'desktop translation(s) replaced by an English value';
    if (lang !== 'en') total += clobbered.length + shadowed.length;
    console.log(`${lang}: ${clobbered.length} ${label}`);
    for (const { key, desktop, shipped } of clobbered) {
      console.log(`  ${JSON.stringify(key)}\n    desktop: ${JSON.stringify(desktop)}\n    shipped: ${JSON.stringify(shipped)}`);
    }
    if (!shadowed.length) continue;
    console.log(`${lang}: ${shadowed.length} server translation(s) hidden behind an English value`);
    for (const { key, server, shipped } of shadowed) {
      console.log(`  ${JSON.stringify(key)}\n    server:  ${JSON.stringify(server)}\n    shipped: ${JSON.stringify(shipped)}`);
    }
  }
  process.exitCode = total ? 1 : 0;
}
