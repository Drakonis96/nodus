// Loop 3 acceptance test: recursive SQL filters + stable keyset pagination on real SQLite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
if (!process.argv.includes('--electron-row-query-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), '--electron-row-query-test'], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-row-query-'));
installRuntimeHooks(root);
try {
  const Database = require('better-sqlite3');
  const { runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const repo = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const { databaseCellStorage } = require(path.join(repoRoot, 'shared/databaseCellStorage.ts'));
  const sqlite = new Database(path.join(root, 'query.sqlite'));
  runMigrations(sqlite);
  globalThis.__rowQueryDb = sqlite;

  const database = repo.createDatabase('Paginación');
  const title = repo.createColumn(database.id, 'Nombre', 'title');
  const number = repo.createColumn(database.id, 'Puntuación', 'number');
  const checked = repo.createColumn(database.id, 'Activo', 'checkbox');
  const date = repo.createColumn(database.id, 'Fecha', 'date');
  const select = repo.createColumn(database.id, 'Grupo', 'select');
  const multi = repo.createColumn(database.id, 'Etiquetas', 'multi_select');
  const optionA = repo.addOption(select.id, 'A', '#2563eb');
  const optionB = repo.addOption(select.id, 'B', '#16a34a');
  const tagA = repo.addOption(multi.id, 'uno');
  const tagB = repo.addOption(multi.id, 'dos');

  const insertRow = sqlite.prepare(
    `INSERT INTO db_rows
      (id,database_id,position,created_at,updated_at,revision,created_by,updated_by)
     VALUES (?,?,?,?,?,1,'fixture','fixture')`,
  );
  const insertCell = sqlite.prepare(
    `INSERT INTO db_cells
      (database_id,row_id,column_id,value_type,value_text,value_number,value_integer,value_date,
       value_json,value_reference,revision,created_by,updated_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,1,'fixture','fixture',?,?)`,
  );
  const t = '2026-08-14T00:00:00.000Z';
  const addCell = (rowId, column, raw) => {
    const value = databaseCellStorage(column.type, raw);
    insertCell.run(
      database.id, rowId, column.id, value.value_type, value.value_text, value.value_number,
      value.value_integer, value.value_date, value.value_json, value.value_reference, t, t,
    );
  };
  sqlite.transaction(() => {
    for (let index = 0; index < 1_200; index += 1) {
      const rowId = `row-${String(index).padStart(4, '0')}`;
      insertRow.run(rowId, database.id, index, t, t);
      addCell(rowId, title, `Elemento ${String(index).padStart(4, '0')}${index % 17 === 0 ? ' especial' : ''}`);
      addCell(rowId, number, String(index % 100));
      addCell(rowId, checked, index % 2 === 0 ? '1' : '0');
      addCell(rowId, date, `2026-08-${String((index % 28) + 1).padStart(2, '0')}`);
      addCell(rowId, select, index % 3 === 0 ? optionB.id : optionA.id);
      addCell(rowId, multi, JSON.stringify(index % 5 === 0 ? [tagA.id, tagB.id] : [tagA.id]));
    }
    sqlite.prepare("UPDATE db_databases SET revision = revision + 1, updated_by = 'fixture' WHERE id = ?").run(database.id);
  })();

  const first = repo.queryDatabaseRows({ databaseId: database.id });
  assert.equal(first.rows.length, 200, 'default page size is 200');
  assert.equal(first.totalCount, 1_200);
  assert.ok(first.nextCursor);
  assert.equal(first.previousCursor, null);
  assert.deepEqual(first.rows.slice(0, 3).map((row) => row.id), ['row-0000', 'row-0001', 'row-0002']);

  const capped = repo.queryDatabaseRows({ databaseId: database.id, limit: 100_000 });
  assert.equal(capped.rows.length, 500, 'interactive payload is capped at 500 rows');
  assert.throws(() => repo.queryDatabaseRows({ databaseId: database.id, limit: 0 / 0 }), /número finito/);

  const filter = {
    type: 'group', operator: 'and', children: [
      { type: 'condition', columnId: number.id, op: 'gte', value: '20' },
      { type: 'group', operator: 'or', children: [
        { type: 'condition', columnId: checked.id, op: 'isChecked' },
        { type: 'condition', columnId: select.id, op: 'isAnyOf', value: [optionB.id] },
      ] },
      { type: 'condition', columnId: multi.id, op: 'hasAllOf', value: [tagA.id] },
    ],
  };
  const query = { databaseId: database.id, filter, sorts: [{ columnId: number.id, dir: 'desc' }, { columnId: title.id, dir: 'asc' }], limit: 73 };
  const expected = Array.from({ length: 1_200 }, (_, index) => index)
    .filter((index) => index % 100 >= 20 && (index % 2 === 0 || index % 3 === 0))
    .sort((left, right) => (right % 100) - (left % 100) || left - right)
    .map((index) => `row-${String(index).padStart(4, '0')}`);
  const received = [];
  let cursor = null;
  let pageCount = 0;
  do {
    const page = repo.queryDatabaseRows({ ...query, cursor });
    assert.ok(page.rows.length <= 73);
    assert.equal(page.totalCount, expected.length);
    received.push(...page.rows.map((row) => row.id));
    cursor = page.nextCursor;
    pageCount += 1;
  } while (cursor);
  assert.deepEqual(received, expected, 'recursive filter + multi-sort emits every matching row exactly once');
  assert.equal(new Set(received).size, received.length);
  assert.ok(pageCount > 1);

  const indexedNumber = repo.queryDatabaseRows({
    databaseId: database.id,
    filter: { type: 'group', operator: 'and', children: [
      { type: 'condition', columnId: number.id, op: 'gte', value: '90' },
    ] },
    sorts: [{ columnId: number.id, dir: 'desc' }],
    limit: 200,
  });
  assert.equal(indexedNumber.totalCount, 120, 'single typed number condition uses the exact indexed count');
  assert.deepEqual(indexedNumber.rows.slice(0, 3).map((row) => row.cells[number.id]), ['99', '99', '99']);

  const groupedQuery = {
    databaseId: database.id,
    groups: [{ columnId: select.id, dir: 'asc' }],
    sorts: [{ columnId: number.id, dir: 'desc' }],
    limit: 500,
  };
  const groupedRows = [];
  cursor = null;
  do {
    const grouped = repo.queryDatabaseRows({ ...groupedQuery, cursor });
    groupedRows.push(...grouped.rows);
    cursor = grouped.nextCursor;
  } while (cursor);
  const groupValues = groupedRows.map((row) => row.cells[select.id]);
  const firstB = groupValues.indexOf(optionB.id);
  assert.ok(firstB > 0 && groupValues.slice(0, firstB).every((value) => value === optionA.id));
  assert.ok(groupValues.slice(firstB).every((value) => value === optionB.id));

  const pageOne = repo.queryDatabaseRows({ ...query, limit: 41 });
  const pageTwo = repo.queryDatabaseRows({ ...query, limit: 41, cursor: pageOne.nextCursor });
  assert.ok(pageTwo.previousCursor);
  const backwards = repo.queryDatabaseRows({ ...query, limit: 41, cursor: pageTwo.previousCursor, direction: 'backward' });
  assert.deepEqual(backwards.rows.map((row) => row.id), pageOne.rows.map((row) => row.id), 'backward keyset restores a discarded page');

  assert.throws(
    () => repo.queryDatabaseRows({ databaseId: database.id, cursor: pageOne.nextCursor, sorts: [{ columnId: date.id, dir: 'asc' }] }),
    /otra consulta/,
  );
  const inserted = repo.createRow(database.id);
  assert.throws(() => repo.queryDatabaseRows({ ...query, cursor: pageOne.nextCursor }), /cambió/);
  repo.deleteRow(inserted.id);
  assert.throws(() => repo.queryDatabaseRows({ ...query, cursor: pageOne.nextCursor }), /cambió/);
  const restarted = repo.queryDatabaseRows(query);
  assert.equal(restarted.totalCount, expected.length, 'a fresh revision gets a fresh exact count');

  const view = repo.createView(database.id, {
    name: 'Solo especiales', layout: 'table',
    filter: { conjunction: 'and', conditions: [{ id: 'special', columnId: title.id, op: 'contains', value: 'especial' }] },
    sorts: [{ columnId: title.id, dir: 'desc' }],
  });
  const fromView = repo.queryDatabaseRows({ databaseId: database.id, viewId: view.id, limit: 500 });
  assert.equal(fromView.totalCount, Math.ceil(1_200 / 17));
  assert.ok(fromView.rows.every((row) => row.cells[title.id].includes('especial')));

  assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
  assert.equal(sqlite.pragma('quick_check', { simple: true }), 'ok');
  sqlite.close();
  console.log('database keyset row query (real SQLite) test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const databaseStub = path.join(userDataPath, 'stub-database.cjs');
  fs.writeFileSync(databaseStub, 'exports.getDb = () => globalThis.__rowQueryDb;\n');
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
