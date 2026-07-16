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
// by that Spanish source (see src/i18n.ts). A missing key silently falls back —
// which is exactly the bug the genealogy vault shipped with. This test enforces FULL
// coverage for EVERY translated language: it collects the keys the renderer asks for
// and asserts each has an entry in each table. When you add a new UI string, add its
// translations too, or this fails.
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

/** Bundle a TS module so its real exported values can be asserted on. */
function loadModule(file) {
  const bundle = path.join(outDir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  return require(bundle);
}

/**
 * Every language the interface is translated into; Spanish is the source, so it has
 * no table. Add a language here and it inherits every check below.
 */
const TRANSLATIONS = [
  { name: 'English', file: 'src/i18n.en.ts', export: 'EN' },
  { name: 'French', file: 'src/i18n.fr.ts', export: 'FR' },
  { name: 'German', file: 'src/i18n.de.ts', export: 'DE' },
  { name: 'European Portuguese', file: 'src/i18n.pt.ts', export: 'PT' },
  { name: 'Brazilian Portuguese', file: 'src/i18n.pt-BR.ts', export: 'PT_BR' },
].map((entry) => ({ ...entry, table: loadModule(entry.file)[entry.export] }));

const EN = TRANSLATIONS[0].table;
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
  // Why the CSV import suggested a column type, rendered as t(s.reason) in the import modal.
  { file: 'shared/databaseCsv.ts', pattern: /\bpick\([^,]+,\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // Column type + rollup function names, rendered as t(columnTypeDef(x).label) / t(f.label).
  { file: 'shared/databases.ts', pattern: /\blabel:\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // Formula recipe / operation / statistic names and hints, rendered as t(r.label) / t(r.hint).
  { file: 'shared/databaseFormula.ts', pattern: /\b(?:label|hint):\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // validateFormula's problems, surfaced through t(problem) in the editor and t(error) in the
  // cell. Only sentences: a returned single word here is a discriminant ('number'), not a key.
  { file: 'shared/databaseFormula.ts', pattern: /\breturn (["'])((?:\\.|(?!\1).)*?\s(?:\\.|(?!\1).)*?)\1;/g },
  // Formula errors written onto a row, surfaced through t(error) in the cell.
  { file: 'shared/databaseFormulaEval.ts', pattern: /\bsetError\([^,]+,[^,]+,\s*(?:problem \?\? )?(["'])((?:\\.|(?!\1).)*?)\1/g },
  // describeFormula stitches its sentence from words, each passed through the injected t().
  { file: 'shared/databaseFormulaEval.ts', pattern: /\bt\((["'])((?:\\.|(?!\1).)*?)\1\)/g },
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

for (const { name, file, table } of TRANSLATIONS) {
  test(`every t()/tx() string and tour step has a ${name} translation`, () => {
    const strings = collectTranslatableStrings();
    const missing = [...strings].filter(([s]) => !(s in table));
    const report = missing.map(([s, f]) => `  ${f}: ${JSON.stringify(s)}`).join('\n');
    assert.equal(missing.length, 0, `Untranslated strings (add to ${file}):\n${report}`);
  });
}

test('every language table covers exactly the same keys', () => {
  // A key in one table but not another means one language silently falls back.
  for (const { name, table } of TRANSLATIONS.slice(1)) {
    const missing = Object.keys(EN).filter((key) => !(key in table));
    const extra = Object.keys(table).filter((key) => !(key in EN));
    assert.deepEqual(missing, [], `${name} is missing keys English has`);
    assert.deepEqual(extra, [], `${name} has keys English does not`);
  }
});

test('translations keep every {placeholder} intact', () => {
  // tx() substitutes by name, so a translated or dropped placeholder renders literally.
  const names = (value) => [...String(value).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const { name, table } of TRANSLATIONS) {
    const broken = Object.entries(table).filter(([key, value]) => names(key) !== names(value));
    assert.deepEqual(
      broken.map(([key, value]) => `${JSON.stringify(key)} → ${JSON.stringify(value)}`),
      [],
      `${name} translations changed a {placeholder}`
    );
  }
});

test('no translation is empty', () => {
  for (const { name, table } of TRANSLATIONS) {
    const blank = Object.entries(table).filter(([, value]) => !String(value).trim()).map(([key]) => key);
    assert.deepEqual(blank, [], `${name} has blank translations`);
  }
});

test('the two Portuguese variants are really different', () => {
  // Shipping pt and pt-BR separately only earns its keep if they actually diverge:
  // the risk is one being a copy of the other, or drifting into its vocabulary.
  const PT = TRANSLATIONS.find((t) => t.export === 'PT').table;
  const PT_BR = TRANSLATIONS.find((t) => t.export === 'PT_BR').table;
  const keys = Object.keys(PT);
  const differing = keys.filter((key) => PT[key] !== PT_BR[key]);
  // Many short labels legitimately coincide ("Nome", "Data"), so this is a floor,
  // not a target — it only catches one variant being a copy of the other.
  assert.ok(
    differing.length > keys.length * 0.2,
    `expected the Portuguese variants to diverge substantially, only ${differing.length}/${keys.length} differ`
  );

  // Vocabulary that belongs to exactly one variant. Deliberately excludes words that
  // are legitimate in both: "arquivo" is Brazilian for a computer file but European
  // for an archive/repository, and "transferir" means download in pt and transfer in
  // pt-BR, so neither can be used as a marker.
  const forbidden = {
    PT: [/\bsalvar\b/i, /\busuários?\b/i, /\bconfigurações\b/i, /\bsenhas?\b/i, /\bgerenciar\b/i],
    PT_BR: [/\bficheiros?\b/i, /\becrã\b/i, /\butilizadores?\b/i, /\bpalavra-passe\b/i],
  };
  for (const [variant, patterns] of Object.entries(forbidden)) {
    const table = variant === 'PT' ? PT : PT_BR;
    for (const pattern of patterns) {
      const hits = Object.entries(table).filter(([, value]) => pattern.test(String(value)));
      assert.deepEqual(
        hits.map(([key, value]) => `${JSON.stringify(key)} → ${JSON.stringify(value)}`),
        [],
        `${variant} uses ${pattern} from the other variant`
      );
    }
  }
});

// The languages that in-data labels must also carry. Spanish and English are the
// source pair every table already had.
const IN_DATA_LANGUAGES = ['fr', 'de', 'pt', 'pt-BR'];

test('in-data labels are translated alongside the i18n table', () => {
  // These labels ship inside shared/ data rather than the i18n table, so the
  // coverage scan above cannot see them and they rot independently.
  const docTypes = loadModule('shared/archiveDocTypes.ts');
  const { RAW_DOC_TYPES, NATURALEZA, EPOCA, AMBITO, FUNCION, SOPORTE_MONUMENTAL, ESTATUS, SOPORTE_FISICO, GENEALOGIA } = docTypes;
  assert.ok(RAW_DOC_TYPES.length > 150, `expected the full doc-type taxonomy, got ${RAW_DOC_TYPES.length}`);

  // Assert against the source maps, not the expanded `labels`: those are
  // `DOC_TYPE_LABEL_XX[id] ?? labelEn`, so a missing id would silently look fine.
  // A label equal to the English one is legitimate ("Illustration", "Notes").
  const docTypeMaps = { fr: docTypes.DOC_TYPE_LABEL_FR, de: docTypes.DOC_TYPE_LABEL_DE, pt: docTypes.DOC_TYPE_LABEL_PT, 'pt-BR': docTypes.DOC_TYPE_LABEL_PT_BR };
  for (const language of IN_DATA_LANGUAGES) {
    const map = docTypeMaps[language];
    assert.ok(map, `no doc-type label map for ${language}`);
    const untranslated = RAW_DOC_TYPES.map((row) => row[0]).filter((id) => !map[id]?.trim());
    assert.deepEqual(untranslated, [], `these document types have no ${language} label and would fall back to English`);
  }

  for (const [dimension, values] of Object.entries({ NATURALEZA, EPOCA, AMBITO, FUNCION, SOPORTE_MONUMENTAL, ESTATUS, SOPORTE_FISICO, GENEALOGIA })) {
    for (const language of IN_DATA_LANGUAGES) {
      const blank = (values ?? []).filter((value) => !value[language]?.trim()).map((value) => value.id);
      assert.deepEqual(blank, [], `facet dimension ${dimension} has values with no ${language} label`);
    }
  }

  const kinship = loadModule('shared/treeKinship.ts');
  const roles = Object.keys(kinship.TREE_KINSHIP_ROLE_LABEL_ES);
  for (const language of IN_DATA_LANGUAGES) {
    const table = kinship.TREE_KINSHIP_ROLE_LABELS[language];
    assert.ok(table, `no kinship role table for ${language}`);
    const missing = roles.filter((role) => !table[role]?.trim());
    assert.deepEqual(missing, [], `these kinship roles have no ${language} label`);
  }

  const { RELEASE_NOTES } = loadModule('shared/releaseNotes.ts');
  const highlights = RELEASE_NOTES.flatMap((note) => note.highlights.map((h) => [note.version, h]));
  for (const language of IN_DATA_LANGUAGES) {
    const missing = highlights.filter(([, h]) => !h[language]?.trim()).map(([version]) => version);
    assert.deepEqual(missing, [], `these release notes have no ${language} highlight`);
  }
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
