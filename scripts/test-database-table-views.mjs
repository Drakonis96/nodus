// Loop 10 acceptance: atomic bulk edits, SQL aggregates, clipboard and board config.
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
const marker = '--electron-database-table-views-test';
if (!process.argv.includes(marker)) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-table-views-'));
installRuntimeHooks(root);
try {
  const Database = require('better-sqlite3');
  const { runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const repo = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const { databaseCellStorage } = require(path.join(repoRoot, 'shared/databaseCellStorage.ts'));
  const tableDomain = require(path.join(repoRoot, 'shared/databaseTableOps.ts'));
  const viewDomain = require(path.join(repoRoot, 'shared/databaseViewConfig.ts'));

  assert.deepEqual(tableDomain.parseRectangularClipboard('A\t"B\tC"\r\n"D\nE"\tF\n'), [['A', 'B\tC'], ['D\nE', 'F']]);
  const matrix = [['A', 'B\tC'], ['D\nE', '"F"']];
  assert.deepEqual(tableDomain.parseRectangularClipboard(tableDomain.serializeRectangularClipboard(matrix)), matrix);

  const sqlite = new Database(path.join(root, 'table-views.sqlite'));
  runMigrations(sqlite);
  globalThis.__databaseTableViewsDb = sqlite;
  const database = repo.createDatabase('Tablero de escala');
  const title = repo.createColumn(database.id, 'Nombre', 'title');
  const points = repo.createColumn(database.id, 'Puntos', 'number');
  const status = repo.createColumn(database.id, 'Estado', 'status');
  const created = repo.createColumn(database.id, 'Creado', 'created_time');
  const pending = repo.addOption(status.id, 'Pendiente', '#f59e0b', 'pending');
  const complete = repo.addOption(status.id, 'Completo', '#10b981', 'complete');

  const insertRow = sqlite.prepare(
    `INSERT INTO db_rows (id,database_id,position,unique_sequence,created_at,updated_at,revision,created_by,updated_by)
     VALUES (?,?,?,?,?,?,1,'fixture','fixture')`,
  );
  const insertCell = sqlite.prepare(
    `INSERT INTO db_cells
      (database_id,row_id,column_id,value_type,value_text,value_number,value_integer,value_date,value_json,value_reference,
       revision,created_by,updated_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,1,'fixture','fixture',?,?)`,
  );
  const timestamp = '2026-08-14T10:00:00.000Z';
  const addCell = (rowId, column, raw) => {
    const value = databaseCellStorage(column.type, raw);
    insertCell.run(database.id, rowId, column.id, value.value_type, value.value_text, value.value_number,
      value.value_integer, value.value_date, value.value_json, value.value_reference, timestamp, timestamp);
  };
  sqlite.transaction(() => {
    for (let index = 0; index < 10_000; index += 1) {
      const rowId = `card-${String(index).padStart(5, '0')}`;
      insertRow.run(rowId, database.id, index, index + 1, timestamp, timestamp);
      addCell(rowId, title, `Tarjeta ${String(index).padStart(5, '0')}`);
      addCell(rowId, points, String(index % 100));
      addCell(rowId, status, index % 2 === 0 ? pending.id : complete.id);
    }
    sqlite.prepare('UPDATE db_databases SET revision = revision + 1 WHERE id = ?').run(database.id);
  })();

  const first = repo.queryDatabaseRows({ databaseId: database.id, groups: [{ columnId: status.id, dir: 'asc' }], limit: 500 });
  assert.equal(first.totalCount, 10_000);
  assert.equal(first.rows.length, 500, 'a 10k board still transfers at most 500 cards');
  assert.ok(first.rows.every((row) => row.cells[status.id] === pending.id), 'board grouping is stable');

  const onlyPending = { type: 'condition', columnId: status.id, op: 'isAnyOf', value: [pending.id] };
  const aggregate = repo.aggregateDatabaseRows({ databaseId: database.id, filter: onlyPending, columnIds: [title.id, points.id, status.id] });
  assert.equal(aggregate.totalCount, 5_000);
  assert.equal(aggregate.columns.find((item) => item.columnId === title.id).nonEmpty, 5_000);
  const pointsAggregate = aggregate.columns.find((item) => item.columnId === points.id);
  assert.equal(pointsAggregate.numericCount, 5_000);
  assert.equal(pointsAggregate.sum, 245_000);
  assert.equal(pointsAggregate.average, 49);

  const revision = sqlite.prepare('SELECT revision FROM db_databases WHERE id = ?').get(database.id).revision;
  const edited = repo.setCellsBulk({
    databaseId: database.id,
    expectedRevision: revision,
    changes: [
      { rowId: 'card-00000', columnId: title.id, raw: 'Renombrada' },
      { rowId: 'card-00000', columnId: points.id, raw: '250' },
      { rowId: 'card-00001', columnId: status.id, raw: pending.id },
    ],
  });
  assert.equal(edited.rowsChanged, 2);
  assert.equal(edited.cellsChanged, 3);
  assert.equal(edited.revision, revision + 1, 'one transaction produces one database revision');
  assert.equal(repo.getRow('card-00000').cells[title.id], 'Renombrada');
  assert.equal(repo.getRow('card-00000').cells[points.id], '250');
  assert.equal(repo.getRow('card-00001').cells[status.id], pending.id, 'Kanban move persists');

  const beforeRollback = repo.getRow('card-00002').cells[title.id];
  assert.throws(() => repo.setCellsBulk({ databaseId: database.id, changes: [
    { rowId: 'card-00002', columnId: title.id, raw: 'No debe persistir' },
    { rowId: 'card-00002', columnId: created.id, raw: '2026-01-01' },
  ] }), /automática/);
  assert.equal(repo.getRow('card-00002').cells[title.id], beforeRollback, 'validation occurs before every write');
  assert.throws(() => repo.setCellsBulk({ databaseId: database.id, expectedRevision: revision, changes: [
    { rowId: 'card-00002', columnId: title.id, raw: 'Stale' },
  ] }), /Conflicto de revisión/);
  assert.throws(() => repo.setCellsBulk({ databaseId: database.id, changes: [
    { rowId: 'card-00002', columnId: title.id, raw: 'A' },
    { rowId: 'card-00002', columnId: title.id, raw: 'B' },
  ] }), /duplicada/);

  const board = viewDomain.normalizeDatabaseViewConfig({
    ...viewDomain.defaultDatabaseViewConfig('board'), groupBy: { columnId: status.id, dir: 'asc' },
    cardPropertyIds: [points.id], groupLimits: { [pending.id]: 7, [complete.id]: null, invalid: -2 },
  });
  assert.equal(board.groupLimits[pending.id], 7);
  assert.equal(board.groupLimits[complete.id], null);
  assert.equal(board.groupLimits.invalid, undefined);
  const saved = repo.createView(database.id, { name: 'Kanban', layout: 'board', filter: { conjunction: 'and', conditions: [] }, sorts: [], config: board });
  assert.deepEqual(repo.listViews(database.id).find((view) => view.id === saved.id).config.groupLimits, board.groupLimits);

  assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
  assert.equal(sqlite.pragma('quick_check', { simple: true }), 'ok');
  sqlite.close();
  console.log('database table/list/gallery/board + bulk/aggregate (real SQLite, 10k rows) test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const databaseStub = path.join(userDataPath, 'stub-database.cjs');
  fs.writeFileSync(databaseStub, 'exports.getDb = () => globalThis.__databaseTableViewsDb;\n');
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    const resolved = originalResolveFilename.call(this, request, parent, isMain, options);
    if (resolved === path.join(repoRoot, 'electron/db/database.ts')) return databaseStub;
    return resolved;
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return {
      app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
      safeStorage: { isEncryptionAvailable: () => false }, BrowserWindow: class {}, dialog: {}, shell: {},
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    module._compile(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
    }).outputText, filename);
  };
}
