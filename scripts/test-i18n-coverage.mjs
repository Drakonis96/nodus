import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Every user-facing string is authored in Spanish and translated via t()/tx() keyed
// by that Spanish source (see src/i18n.ts). A missing key silently falls back to
// Spanish — which is exactly the bug the genealogy vault shipped with. This test
// enforces FULL English coverage: it scans every renderer source for t('…')/tx('…')
// literals and the GenealogyTour step strings, and asserts each has an EN entry.
// When you add a new UI string, add its EN translation too, or this fails.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-i18n-'));
const bundle = path.join(outDir, 'en.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [path.join(repoRoot, 'src/i18n.en.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
  { cwd: repoRoot, stdio: 'inherit' }
);
const { EN } = require(bundle);
const enKeys = new Set(Object.keys(EN));

test.after(() => rm(outDir, { recursive: true, force: true }));

function walk(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (/\.(tsx?)$/.test(e.name) && !e.name.startsWith('i18n')) out.push(p);
  }
  return out;
}

/** All literal first-args of t()/tx() across the renderer (skips template interpolation). */
function collectTranslatableStrings() {
  const files = walk(path.join(repoRoot, 'src'));
  const re = /\bt[x]?\(\s*(["'`])((?:\\.|(?!\1).)*?)\1/g;
  const found = new Map(); // string -> file
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(src))) {
      if (m[1] === '`' && m[2].includes('${')) continue;
      const val = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\`/g, '`');
      if (val && /[a-zA-Z]/.test(val) && !found.has(val)) found.set(val, path.relative(repoRoot, f));
    }
  }
  // Tour steps are plain object literals fed through t() by the tour engine.
  for (const tourFile of ['src/views/GenealogyTour.tsx', 'src/views/DatabasesTour.tsx']) {
    const tour = fs.readFileSync(path.join(repoRoot, tourFile), 'utf8');
    const tre = /(?:title|body):\s*(["'`])((?:\\.|(?!\1).)*?)\1/g;
    let tm;
    while ((tm = tre.exec(tour))) {
      const val = tm[2];
      if (!found.has(val)) found.set(val, tourFile);
    }
  }
  return found;
}

test('every t()/tx() string and tour step has an English translation', () => {
  const strings = collectTranslatableStrings();
  const missing = [...strings].filter(([s]) => !enKeys.has(s));
  const report = missing.map(([s, f]) => `  ${f}: ${JSON.stringify(s)}`).join('\n');
  assert.equal(missing.length, 0, `Untranslated strings (add to src/i18n.en.ts):\n${report}`);
});

test('genealogy vault-type + section labels are translated', () => {
  // Spot-check the surfaces the user reported: header vault label, tree, relations,
  // archive, tour welcome.
  for (const key of ['Genealogía', 'Árbol genealógico', 'Relaciones sociales', 'Archivo', 'Personas', 'Línea temporal', 'Bienvenido al modo genealogía']) {
    assert.ok(enKeys.has(key), `"${key}" must have an English translation`);
  }
  assert.equal(EN['Genealogía'], 'Genealogy');
  assert.equal(EN['Relaciones sociales'], 'Social relations');
});
