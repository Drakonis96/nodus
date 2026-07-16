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
// enforces FULL English coverage: it collects the keys the renderer asks for and
// asserts each has an EN entry. When you add a new UI string, add its EN
// translation too, or this fails.
//
// Keys reach t() two ways, and both must be collected or the gap stays invisible:
//   - directly as a literal — including inside a ternary, `t(a ? 'X' : 'Y')`, which
//     is why the argument is scanned rather than just the first token after `t(`;
//   - indirectly from a data table translated at render time, e.g. navigation.ts
//     labels rendered as `t(n.label)`. Those hide best (the Spanish sidebar labels
//     shipped that way), so every such table is listed in INDIRECT_KEY_SOURCES.

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

// Data tables whose Spanish values are handed to t() from somewhere else.
const INDIRECT_KEY_SOURCES = [
  // Sidebar + command palette labels, rendered as t(n.label) / t(g.label) in App.tsx.
  { file: 'src/navigation.ts', pattern: /\blabel:\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // Settings tab labels, rendered as t(tab.label).
  { file: 'src/views/Settings.tsx', pattern: /\blabel:\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // Tour steps are plain object literals fed through t() by the tour engine.
  ...['Tour', 'AdvancedTour', 'StudyTour', 'GenealogyTour', 'DatabasesTour'].map((name) => ({
    file: `src/views/${name}.tsx`,
    pattern: /(?:title|body):\s*(["'])((?:\\.|(?!\1).)*?)\1/g,
  })),
];

// Literals that sit inside a t() call but are not keys: they index a label map
// whose *values* are the real keys, e.g. t(LABELS[state ?? 'empty']).
const NOT_KEYS = new Set(['none', 'empty']);

/** Yield the balanced argument text of every t()/tx() call in `src`. */
function* translationCallArgs(src) {
  const re = /\bt[x]?\(/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = re.lastIndex;
    const start = i;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === "'" || c === '"' || c === '`') {
        const quote = c;
        i++;
        while (i < src.length && src[i] !== quote) i += src[i] === '\\' ? 2 : 1;
      }
      i++;
    }
    yield src.slice(start, i - 1);
  }
}

/** Remove literals that are compared or used as a lookup index, not translated. */
function stripNonKeyLiterals(arg) {
  return arg
    .replace(/(?:===|!==|==|!=)\s*(["'])(?:\\.|(?!\1).)*?\1/g, '')
    .replace(/(["'])(?:\\.|(?!\1).)*?\1\s*(?:===|!==|==|!=)/g, '')
    .replace(/\.(?:includes|startsWith|endsWith|split|join|has|get)\(\s*(["'])(?:\\.|(?!\1).)*?\1\s*\)/g, '')
    .replace(/\[[^\]]*(["'])(?:\\.|(?!\1).)*?\1\s*\]/g, '');
}

/** Every key the renderer asks t()/tx() for, mapped to the file that asks. */
function collectTranslatableStrings() {
  const found = new Map(); // string -> file
  const record = (val, file) => {
    if (!val || NOT_KEYS.has(val) || !/[a-zA-Z]/.test(val)) return;
    if (!found.has(val)) found.set(val, path.relative(repoRoot, file));
  };
  const unescape = (s) => s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\`/g, '`');

  for (const f of walk(path.join(repoRoot, 'src'))) {
    const src = fs.readFileSync(f, 'utf8');
    for (const arg of translationCallArgs(src)) {
      if (arg.length > 600) continue; // a long expression, not a literal key
      for (const m of stripNonKeyLiterals(arg).matchAll(/(["'])((?:\\.|(?!\1).)*?)\1/g)) {
        record(unescape(m[2]), f);
      }
    }
  }
  for (const { file, pattern } of INDIRECT_KEY_SOURCES) {
    const full = path.join(repoRoot, file);
    const src = fs.readFileSync(full, 'utf8');
    for (const m of src.matchAll(pattern)) record(unescape(m[2]), full);
  }
  return found;
}

test('every t()/tx() string and tour step has an English translation', () => {
  const strings = collectTranslatableStrings();
  const missing = [...strings].filter(([s]) => !enKeys.has(s));
  const report = missing.map(([s, f]) => `  ${f}: ${JSON.stringify(s)}`).join('\n');
  assert.equal(missing.length, 0, `Untranslated strings (add to src/i18n.en.ts):\n${report}`);
});

test('keys reached indirectly and through ternaries are collected', () => {
  // Without these the scan silently stops seeing whole surfaces and the coverage
  // test above passes while the UI renders Spanish.
  const strings = collectTranslatableStrings();
  for (const key of ['Grafo de estudio', 'Ideas de estudio', 'Explorar']) {
    assert.ok(strings.has(key), `sidebar label "${key}" (navigation.ts) must be collected`);
  }
  assert.ok(strings.has('Proveedores'), 'Settings tab labels must be collected');
  assert.ok(strings.has('Ocultar contraseña'), 'keys inside a t(cond ? … : …) ternary must be collected');
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
