// Loop 4 acceptance: FTS5, typed plans, materialized dependencies and streaming export.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const marker = '--electron-database-indexing-test';
if (!process.argv.includes(marker)) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-database-indexing-'));
installRuntimeHooks(root);
try {
  const Database = require('better-sqlite3');
  const AdmZip = require('adm-zip');
  const { runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const repo = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const exporter = require(path.join(repoRoot, 'electron/export/databaseExport.ts'));
  const sqlite = new Database(path.join(root, 'indexing.sqlite'));
  runMigrations(sqlite);
  globalThis.__databaseIndexingDb = sqlite;
  assert.equal(sqlite.pragma('user_version', { simple: true }), SCHEMA_VERSION);

  const database = repo.createDatabase('Índice real');
  const title = repo.createColumn(database.id, 'Nombre', 'title');
  const body = repo.createColumn(database.id, 'Contenido', 'text');
  const state = repo.createColumn(database.id, 'Estado', 'select');
  const attachment = repo.createColumn(database.id, 'Archivo', 'attachment');
  const active = repo.addOption(state.id, 'En marcha');
  const rows = [];
  for (let index = 0; index < 130; index += 1) {
    const row = repo.createRow(database.id);
    rows.push(row);
    repo.setCell(row.id, title.id, `Documento ${String(index).padStart(3, '0')}`);
    repo.setCell(row.id, body.id, `término común evidencia-${index}`);
    repo.setCell(row.id, state.id, active.id);
  }
  repo.addAttachment({
    rowId: rows[0].id, columnId: attachment.id, fileName: 'fuente.txt', mimeType: 'text/plain',
    bytes: 4, blob: Buffer.from('test'), extractedText: 'hallazgo paleográfico exclusivo',
  });

  let cursor = null;
  const seen = [];
  let largest = 0;
  do {
    const page = repo.searchDatabaseRowsPage({ query: 'término común', cursor, limit: 25 });
    largest = Math.max(largest, page.hits.length);
    seen.push(...page.hits.map((hit) => hit.rowId));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.length, 130);
  assert.equal(new Set(seen).size, 130);
  assert.equal(largest, 25);
  assert.equal(repo.searchDatabaseRowsPage({ query: 'paleográfico', limit: 20 }).hits[0].rowId, rows[0].id);
  assert.equal(repo.searchDatabaseRowsPage({ query: 'marcha', limit: 1_000 }).hits.length, 100, 'search page enforces its public cap');
  const stalePage = repo.searchDatabaseRowsPage({ query: 'evidencia', limit: 10 });
  repo.setCell(rows[0].id, body.id, 'contenido modificado');
  assert.throws(() => repo.searchDatabaseRowsPage({ query: 'evidencia', cursor: stalePage.nextCursor, limit: 10 }), /índice cambió/i);

  repo.updateOption(active.id, { label: 'Trabajando' });
  assert.equal(repo.searchDatabaseRowsPage({ query: 'Trabajando', limit: 100 }).hits.length, 100);
  assert.equal(repo.searchDatabaseRowsPage({ query: 'En marcha', limit: 100 }).hits.length, 0);

  const plans = {
    number: sqlite.prepare('EXPLAIN QUERY PLAN SELECT row_id FROM db_cells WHERE database_id=? AND column_id=? AND value_number>?').all(database.id, body.id, 1),
    date: sqlite.prepare('EXPLAIN QUERY PLAN SELECT row_id FROM db_cells WHERE database_id=? AND column_id=? AND value_date>?').all(database.id, body.id, '2026'),
  };
  assert.ok(JSON.stringify(plans.number).includes('idx_db_cells_number_value'));
  assert.ok(JSON.stringify(plans.date).includes('idx_db_cells_date_value'));

  const calculations = repo.createDatabase('Cálculo incremental');
  const calcTitle = repo.createColumn(calculations.id, 'Nombre', 'title');
  const amount = repo.createColumn(calculations.id, 'Importe', 'number');
  const tax = repo.createColumn(calculations.id, 'Impuesto', 'number');
  const calcRows = [];
  for (let index = 0; index < 3; index += 1) {
    const row = repo.createRow(calculations.id);
    calcRows.push(row);
    repo.setCell(row.id, calcTitle.id, `C${index}`);
    repo.setCell(row.id, amount.id, String((index + 1) * 10));
    repo.setCell(row.id, tax.id, '2');
  }
  const total = repo.createColumn(calculations.id, 'Total', 'formula', {
    formula: { kind: 'arithmetic', op: 'add', operands: [
      { kind: 'column', columnId: amount.id }, { kind: 'column', columnId: tax.id },
    ] },
  });
  const before = new Map(sqlite.prepare(
    'SELECT row_id, revision FROM db_computed_cells WHERE database_id=? AND column_id=?',
  ).all(calculations.id, total.id).map((entry) => [entry.row_id, entry.revision]));
  repo.setCell(calcRows[1].id, amount.id, '50');
  const after = sqlite.prepare(
    'SELECT row_id, revision, value_number FROM db_computed_cells WHERE database_id=? AND column_id=? ORDER BY row_id',
  ).all(calculations.id, total.id);
  for (const entry of after) {
    if (entry.row_id === calcRows[1].id) {
      assert.ok(entry.revision > before.get(entry.row_id));
      assert.equal(entry.value_number, 52);
    } else assert.equal(entry.revision, before.get(entry.row_id), 'unrelated rows are not recalculated');
  }
  const dependencies = sqlite.prepare(
    'SELECT source_column_id, dependent_column_id FROM db_column_dependencies WHERE dependent_database_id=? ORDER BY source_column_id',
  ).all(calculations.id);
  assert.deepEqual(new Set(dependencies.map((entry) => entry.source_column_id)), new Set([amount.id, tax.id]));

  const stableProjection = sqlite.prepare(
    'SELECT row_id, value_number, revision FROM db_computed_cells WHERE database_id=? AND column_id=? ORDER BY row_id',
  ).all(calculations.id, total.id);
  let cancelRequested = false;
  const cancelledCalculation = repo.recomputeDatabaseDerived(
    calculations.id,
    () => { cancelRequested = true; },
    () => cancelRequested,
  );
  assert.equal(cancelledCalculation.cancelled, true);
  assert.deepEqual(sqlite.prepare(
    'SELECT row_id, value_number, revision FROM db_computed_cells WHERE database_id=? AND column_id=? ORDER BY row_id',
  ).all(calculations.id, total.id), stableProjection, 'cancelled staging never replaces the visible projection');

  const fixtureRows = Array.from({ length: 1_205 }, (_, index) => [`Export ${index}`, String(index), `texto ${index}`]);
  const exportDb = repo.createDatabaseFromCsv('Exportación acotada', ['Nombre', 'Número', 'Texto'], fixtureRows, ['title', 'number', 'text']);
  for (const format of ['csv', 'json', 'xlsx']) {
    const destination = path.join(root, `stream.${format}`);
    const result = await exporter.exportDatabaseToFile(exportDb.id, format, destination);
    assert.equal(result.rows, 1_205);
    assert.equal(result.maxPageRows, 500);
    assert.ok(result.bytes > 0);
    if (format === 'json') assert.equal(JSON.parse(await readFile(destination, 'utf8')).rows.length, 1_205);
    if (format === 'xlsx') {
      const sheet = new AdmZip(destination).readAsText('xl/worksheets/sheet1.xml');
      assert.equal((sheet.match(/<row /g) ?? []).length, 1_206);
    }
  }

  assert.equal(sqlite.pragma('quick_check', { simple: true }), 'ok');
  assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
  sqlite.close();
  console.log('database FTS/materialization/streaming test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const databaseStub = path.join(userDataPath, 'stub-database.cjs');
  fs.writeFileSync(databaseStub, 'exports.getDb = () => globalThis.__databaseIndexingDb;\n');
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    const resolved = originalResolveFilename.call(this, request, parent, isMain, options);
    if (resolved === path.join(repoRoot, 'electron/db/database.ts')) return databaseStub;
    return resolved;
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return { app: { getPath: () => userDataPath }, safeStorage: {}, BrowserWindow: class {}, dialog: {}, shell: {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    module._compile(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
    }).outputText, filename);
  };
}
