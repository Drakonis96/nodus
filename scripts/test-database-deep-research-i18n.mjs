import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function loadCatalog() {
  const source = read('src/i18n.databaseDeepResearch.ts');
  const start = source.indexOf('const catalog = [');
  const end = source.indexOf('\n\nconst languages =', start);
  assert.ok(start >= 0 && end > start, 'database Deep Research catalog must be declared');
  const context = { catalog: null };
  vm.runInNewContext(`${source.slice(start, end).replace('const catalog =', 'catalog =')}`, context);
  return context.catalog;
}

const REQUIRED_KEYS = [
  'Exploración adaptativa y verificable de los datos seleccionados.',
  'Cobertura, missingness, duplicados, validez e integridad del conjunto.',
  'Compara grupos con magnitudes de efecto, incertidumbre y corrección de multiplicidad.',
  'Detecta tendencia, estacionalidad, drift y cambios de régimen.',
  'Audita joins, huérfanos, ciclos, cardinalidad y redes entre bases.',
  'Estima asociaciones bajo un contrato causal explícito y supuestos visibles.',
  'Analiza duración, evento, censura, retención y riesgo relativo.',
  'Audita PII, exposición, metadatos y disponibilidad de archivos.',
  'Reconstruye lineage, dependencias, divergencias y totales.',
  'Guardar a notas',
  'Informe copiado.',
  'Informe guardado en notas.',
];

test('Database Deep Research keeps one complete translation row per supported language', () => {
  const catalog = loadCatalog();
  assert.ok(Array.isArray(catalog) && catalog.length > 0);
  const keys = new Set(catalog.map((row) => row[0]));
  for (const key of REQUIRED_KEYS) assert.ok(keys.has(key), `missing catalog key: ${key}`);
  for (const row of catalog) {
    assert.equal(row.length, 8, `catalog row ${JSON.stringify(row[0])} must have es/en/fr/de/pt/pt-BR/it/tr`);
    assert.ok(row.every((value) => typeof value === 'string' && value.trim()), `blank translation for ${row[0]}`);
  }
});

test('live database surfaces use the shared Deep Research name', () => {
  for (const file of ['src/navigation.ts', 'src/views/HomeView.tsx', 'src/views/DatabasesTour.tsx']) {
    const source = read(file);
    assert.doesNotMatch(source, /Deep Research de datos|Data Deep Research/, `${file} keeps the old database label`);
  }
  assert.match(read('src/navigation.ts'), /id: 'dbDeepResearch', label: 'Deep Research'/);
  assert.match(read('src/views/HomeView.tsx'), /t\('Deep Research'\)/);
  assert.match(read('src/views/DatabasesTour.tsx'), /title: 'Deep Research'/);
});
