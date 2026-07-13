// Unit tests for the archive document-type search (literal + fuzzy/synonym), and for
// the taxonomy's integrity (bilingual labels, valid facets, legacy ids preserved).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const Module = require('node:module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) {
  if (r.startsWith('@shared/')) return path.join(repoRoot, `shared/${r.slice('@shared/'.length)}.ts`);
  return origResolve.call(this, r, ...a);
};
require.extensions['.ts'] = function (m, f) {
  const out = ts.transpileModule(fs.readFileSync(f, 'utf8'), {
    compilerOptions: { module: 'commonjs', target: 'es2022', esModuleInterop: true },
  }).outputText;
  m._compile(out, f);
};

const { ARCHIVE_DOC_TYPES, getArchiveDocType, NATURALEZA, AMBITO, EPOCA, FUNCION, SOPORTE_MONUMENTAL, ESTATUS, SOPORTE_FISICO } =
  require(path.join(repoRoot, 'shared/archiveDocTypes.ts'));
const { searchDocTypes, diceCoefficient, normalizeText } = require(path.join(repoRoot, 'shared/docTypeSearch.ts'));

const ids = (defs) => defs.map((d) => d.id);
const top = (q, n = 5, opts) => ids(searchDocTypes(q, opts)).slice(0, n);

test('taxonomy integrity: ≥190 types, unique ids, bilingual, fields, valid facets', () => {
  assert.ok(ARCHIVE_DOC_TYPES.length >= 190, `has ${ARCHIVE_DOC_TYPES.length} types`);
  const seen = new Set();
  const valid = {
    naturaleza: new Set(NATURALEZA.map((v) => v.id)),
    ambito: new Set(AMBITO.map((v) => v.id)),
    epoca: new Set(EPOCA.map((v) => v.id)),
    funcion: new Set(FUNCION.map((v) => v.id)),
    soporteMonumental: new Set(SOPORTE_MONUMENTAL.map((v) => v.id)),
    estatus: new Set(ESTATUS.map((v) => v.id)),
    soporteFisico: new Set(SOPORTE_FISICO.map((v) => v.id)),
  };
  for (const d of ARCHIVE_DOC_TYPES) {
    assert.ok(!seen.has(d.id), `duplicate id ${d.id}`);
    seen.add(d.id);
    assert.ok(d.label && d.labelEn, `${d.id} bilingual`);
    assert.ok(Array.isArray(d.fields) && d.fields.length > 0, `${d.id} has fields`);
    for (const dim of Object.keys(valid)) {
      for (const v of d.facets[dim]) assert.ok(valid[dim].has(v), `${d.id}: bad ${dim} value "${v}"`);
    }
    assert.equal(typeof d.facets.genealogia, 'boolean');
  }
});

test('legacy ids + their bespoke fields are preserved', () => {
  const legacy = ['birth_record', 'baptism_record', 'marriage_record', 'death_record', 'census', 'photograph', 'map', 'database', 'other_doc'];
  for (const id of legacy) assert.ok(getArchiveDocType(id), `legacy ${id} present`);
  assert.deepEqual(
    getArchiveDocType('birth_record').fields.map((f) => f.key),
    ['persona', 'fecha_nacimiento', 'lugar', 'padre', 'madre', 'parroquia_registro', 'referencia']
  );
});

test('literal search: exact + prefix + substring', () => {
  assert.equal(top('Partida de nacimiento', 1)[0], 'birth_record');
  assert.ok(top('catedral', 3).includes('catedral'));
  assert.ok(top('iglesia', 5).includes('iglesia'));
});

test('synonym search surfaces apt types without exact match', () => {
  // "tumba" is a keyword synonym of several funerary types, none literally named "tumba".
  const r = top('tumba', 8);
  assert.ok(r.some((id) => ['lapida_losa_sepulcral', 'sepulcro_arca_funeraria', 'panteon_mausoleo_familiar', 'nicho_columbario'].includes(id)), r.join(','));
  // "boda" → marriage record via synonym.
  assert.ok(top('boda', 5).includes('marriage_record'));
});

test('fuzzy search tolerates typos', () => {
  assert.ok(top('catedrl', 5).includes('catedral'), 'missing letter');
  assert.ok(top('testamneto', 5).includes('testamento_codicilo') || top('testamnto', 5).includes('testamento_codicilo'));
});

test('bilingual: an English query matches', () => {
  assert.ok(top('gravestone', 5).includes('lapida_losa_sepulcral'));
  assert.ok(top('church', 6).includes('iglesia'));
  assert.ok(top('will', 8).includes('testamento_codicilo'));
});

test('pool option restricts the search set (e.g. genealogy-only)', () => {
  const genealogy = ARCHIVE_DOC_TYPES.filter((d) => d.facets.genealogia);
  const r = searchDocTypes('registro', { pool: genealogy });
  assert.ok(r.length > 0);
  assert.ok(r.every((d) => d.facets.genealogia));
});

test('empty query returns the whole pool', () => {
  assert.equal(searchDocTypes('').length, ARCHIVE_DOC_TYPES.length);
});

test('helpers: normalizeText strips accents, dice in [0,1]', () => {
  assert.equal(normalizeText('  Índice / Transcripción '), 'indice / transcripcion');
  const d = diceCoefficient('catedral', 'catedrl');
  assert.ok(d > 0.6 && d <= 1, `dice=${d}`);
});

console.log('Doc-type search + taxonomy tests defined.');
