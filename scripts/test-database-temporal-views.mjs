// Loop 11 acceptance: calendar/timeline domain, real SQLite queries and temporal writes.
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
const marker = '--electron-database-temporal-views-test';
if (!process.argv.includes(marker)) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-temporal-views-'));
installRuntimeHooks(root);
try {
  const Database = require('better-sqlite3');
  const { runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const repo = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const { databaseCellStorage } = require(path.join(repoRoot, 'shared/databaseCellStorage.ts'));
  const { encodeDatabaseDate, decodeDatabaseDate } = require(path.join(repoRoot, 'shared/databaseProperties.ts'));
  const temporal = require(path.join(repoRoot, 'shared/databaseTemporal.ts'));

  assert.equal(temporal.resolveDatabaseZonedDate('2026-03-29T02:30:00', 'Europe/Madrid').adjustment, 'gap-forward');
  assert.equal(temporal.resolveDatabaseZonedDate('2026-10-25T02:30:00', 'Europe/Madrid').adjustment, 'overlap-earlier');
  assert.equal(temporal.resolveDatabaseZonedDate('2026-08-14T12:00:00', 'Invalid/Zone').timeZone, 'UTC');
  assert.throws(() => temporal.resolveDatabaseZonedDate('10000-01-01', 'UTC'), /fuera de rango/);
  assert.equal(temporal.shiftDatabaseLocalDate('2024-01-31', 1, 'months'), '2024-02-29');
  assert.equal(temporal.shiftDatabaseLocalDate('2024-02-29', 1, 'years'), '2025-02-28');
  const recurring = temporal.expandDatabaseDateOccurrences({ start: '2026-10-24T09:00:00', includeTime: true,
    timeZone: 'Europe/Madrid', recurrence: 'daily' }, '2026-10-23T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'UTC');
  assert.equal(recurring.length, 4);
  assert.equal(Date.parse(recurring[1].startUtc) - Date.parse(recurring[0].startUtc), 25 * 60 * 60 * 1000,
    'daily recurrence preserves local wall time over autumn DST');
  const overlap = temporal.layoutDatabaseTemporalOverlaps([
    { id: 'a', startUtc: '2026-01-01T09:00:00Z', endUtc: '2026-01-01T11:00:00Z' },
    { id: 'b', startUtc: '2026-01-01T10:00:00Z', endUtc: '2026-01-01T12:00:00Z' },
    { id: 'c', startUtc: '2026-01-01T12:00:00Z', endUtc: '2026-01-01T13:00:00Z' },
  ]);
  assert.deepEqual(overlap.map((item) => item.lane), [0, 1, 0]);
  assert.deepEqual(overlap.map((item) => item.laneCount), [2, 2, 1]);

  const sqlite = new Database(path.join(root, 'temporal.sqlite'));
  runMigrations(sqlite); globalThis.__databaseTemporalViewsDb = sqlite;
  const database = repo.createDatabase('Plan temporal');
  const title = repo.createColumn(database.id, 'Nombre', 'title');
  const start = repo.createColumn(database.id, 'Inicio', 'date', { dateIncludeTime: true, dateTimeZone: 'Europe/Madrid' });
  const end = repo.createColumn(database.id, 'Final', 'date', { dateIncludeTime: true, dateTimeZone: 'Europe/Madrid' });
  const dependencies = repo.createColumn(database.id, 'Depende de', 'relation', {
    relationTargetKind: 'db_row', relationTargetDatabaseId: database.id, relationCardinality: 'many',
  });
  const insertRow = sqlite.prepare(`INSERT INTO db_rows
    (id,database_id,position,unique_sequence,created_at,updated_at,revision,created_by,updated_by)
    VALUES (?,?,?,?,?,?,1,'fixture','fixture')`);
  const insertCell = sqlite.prepare(`INSERT INTO db_cells
    (database_id,row_id,column_id,value_type,value_text,value_number,value_integer,value_date,value_json,value_reference,
     revision,created_by,updated_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,'fixture','fixture',?,?)`);
  const timestamp = '2026-08-14T10:00:00.000Z';
  const addCell = (rowId, column, raw) => {
    const stored = databaseCellStorage(column.type, raw);
    insertCell.run(database.id, rowId, column.id, stored.value_type, stored.value_text, stored.value_number,
      stored.value_integer, stored.value_date, stored.value_json, stored.value_reference, timestamp, timestamp);
  };
  const fixtures = [
    ['event-range', 'Rango editorial', { start: '2026-10-24T09:00:00', end: '2026-10-26T17:00:00', includeTime: true, timeZone: 'Europe/Madrid' }],
    ['event-daily', 'Reunión recurrente', { start: '2026-10-23T09:00:00', includeTime: true, timeZone: 'Europe/Madrid', recurrence: 'daily' }],
    ['event-overlap', 'Solape', { start: '2026-10-24T10:00:00', end: '2026-10-24T12:00:00', includeTime: true, timeZone: 'Europe/Madrid' }],
    ['event-boundary', 'Límite', { start: '9999-12-30', end: '9999-12-31', includeTime: false, timeZone: 'UTC' }],
  ];
  sqlite.transaction(() => fixtures.forEach(([rowId, name, value], index) => {
    insertRow.run(rowId, database.id, index, index + 1, timestamp, timestamp);
    addCell(rowId, title, name); addCell(rowId, start, encodeDatabaseDate(value));
  }))();
  repo.addRelation('event-overlap', dependencies.id, 'db_row', 'event-range');
  const revision = sqlite.prepare('SELECT revision FROM db_databases WHERE id = ?').get(database.id).revision;
  const page = repo.queryDatabaseTemporalEvents({ databaseId: database.id, startColumnId: start.id,
    dependencyColumnId: dependencies.id, windowStart: '2026-10-23T00:00:00.000Z', windowEnd: '2026-10-29T00:00:00.000Z',
    timeZone: 'Europe/Madrid' });
  assert.ok(page.events.length >= 8, 'ranges and recurring occurrences are expanded');
  assert.equal(page.events.find((event) => event.sourceRowId === 'event-overlap').dependencies[0], 'event-range');
  assert.ok(page.events.some((event) => event.recurrence === 'daily'));
  assert.ok(page.events.every((event) => event.timeZone === 'Europe/Madrid'));

  const moved = repo.updateDatabaseTemporalRange({ databaseId: database.id, rowId: 'event-range', startColumnId: start.id,
    endColumnId: end.id, start: '2026-10-27T09:00:00', end: '2026-10-29T17:00:00', timeZone: 'Europe/Madrid', expectedRevision: revision });
  assert.equal(moved.revision, revision + 1);
  assert.equal(decodeDatabaseDate(repo.getRow('event-range').cells[start.id]).start, '2026-10-27T09:00:00');
  assert.equal(decodeDatabaseDate(repo.getRow('event-range').cells[end.id]).start, '2026-10-29T17:00:00');
  assert.throws(() => repo.updateDatabaseTemporalRange({ databaseId: database.id, rowId: 'event-range', startColumnId: start.id,
    endColumnId: end.id, start: '2026-10-28T09:00:00', end: '2026-10-27T09:00:00', timeZone: 'Europe/Madrid' }), /anterior/);
  assert.throws(() => repo.updateDatabaseTemporalRange({ databaseId: database.id, rowId: 'event-range', startColumnId: start.id,
    endColumnId: end.id, start: '2026-10-28T09:00:00', end: '2026-10-29T09:00:00', timeZone: 'Europe/Madrid', expectedRevision: revision }), /Conflicto/);

  const scaleDb = repo.createDatabase('Escala temporal');
  const scaleTitle = repo.createColumn(scaleDb.id, 'Nombre', 'title');
  const scaleDate = repo.createColumn(scaleDb.id, 'Fecha', 'date');
  sqlite.transaction(() => {
    for (let index = 0; index < 650; index += 1) {
      const rowId = `scale-${String(index).padStart(4, '0')}`;
      insertRow.run(rowId, scaleDb.id, index, index + 1, timestamp, timestamp);
      const storedTitle = databaseCellStorage('title', `Evento ${index}`);
      insertCell.run(scaleDb.id, rowId, scaleTitle.id, storedTitle.value_type, storedTitle.value_text, storedTitle.value_number,
        storedTitle.value_integer, storedTitle.value_date, storedTitle.value_json, storedTitle.value_reference, timestamp, timestamp);
      const storedDate = databaseCellStorage('date', encodeDatabaseDate({ start: `2026-11-${String(index % 28 + 1).padStart(2, '0')}` }));
      insertCell.run(scaleDb.id, rowId, scaleDate.id, storedDate.value_type, storedDate.value_text, storedDate.value_number,
        storedDate.value_integer, storedDate.value_date, storedDate.value_json, storedDate.value_reference, timestamp, timestamp);
    }
  })();
  const capped = repo.queryDatabaseTemporalEvents({ databaseId: scaleDb.id, startColumnId: scaleDate.id,
    windowStart: '2026-11-01T00:00:00.000Z', windowEnd: '2026-12-01T00:00:00.000Z', timeZone: 'UTC', limit: 9999 });
  assert.equal(capped.events.length, 500); assert.equal(capped.truncated, true);
  assert.deepEqual(sqlite.pragma('foreign_key_check'), []); assert.equal(sqlite.pragma('quick_check', { simple: true }), 'ok');
  sqlite.close();
  console.log('database calendar/timeline + recurrence/DST/range (real SQLite) test passed');
} finally { await rm(root, { recursive: true, force: true }); }

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript'); const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename; const originalLoad = Module._load;
  const databaseStub = path.join(userDataPath, 'stub-database.cjs');
  fs.writeFileSync(databaseStub, 'exports.getDb = () => globalThis.__databaseTemporalViewsDb;\n');
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    const resolved = originalResolveFilename.call(this, request, parent, isMain, options);
    if (resolved === path.join(repoRoot, 'electron/db/database.ts')) return databaseStub;
    return resolved;
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return { app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot,
      isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false }, BrowserWindow: class {}, dialog: {}, shell: {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename }).outputText, filename);
  };
}
