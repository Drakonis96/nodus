// Loop 7 acceptance: every new property crosses codecs, repository, SQL query and export.
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
const marker = '--electron-database-properties-test';
if (!process.argv.includes(marker)) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-database-properties-'));
installRuntimeHooks(root);
try {
  const Database = require('better-sqlite3');
  const { migrations, runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const repo = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const domain = require(path.join(repoRoot, 'shared/databases.ts'));
  const props = require(path.join(repoRoot, 'shared/databaseProperties.ts'));
  const storage = require(path.join(repoRoot, 'shared/databaseCellStorage.ts'));
  const filters = require(path.join(repoRoot, 'shared/databaseFilters.ts'));
  const exports = require(path.join(repoRoot, 'shared/databaseExport.ts'));
  const { buildXlsx } = require(path.join(repoRoot, 'electron/export/databaseExport.ts'));

  const dateValue = {
    start: '2026-08-14T09:30', end: '2026-08-15T18:00', includeTime: true,
    timeZone: 'Europe/Madrid', reminderMinutes: 30, recurrence: 'monthly',
  };
  const encodedDate = props.encodeDatabaseDate(dateValue);
  assert.deepEqual(props.decodeDatabaseDate(encodedDate), dateValue);
  assert.equal(props.databaseDateSortValue(encodedDate), dateValue.start);
  assert.equal(props.decodeDatabaseDate('2026-08-14').start, '2026-08-14', 'historical dates remain readable');

  const people = [
    { id: 'actor-ada', label: 'Ada Lovelace', kind: 'person' },
    { id: 'group-platform', label: 'Plataforma', kind: 'group' },
  ];
  const encodedPeople = props.encodeDatabasePeople(people);
  assert.deepEqual(props.decodeDatabasePeople(encodedPeople), people);
  assert.equal(props.databasePropertyPlainText('person', encodedPeople), 'Ada Lovelace, Plataforma');
  const encodedLocation = props.encodeDatabaseLocation({
    name: 'Oficina Madrid', address: 'Calle Mayor 1', latitude: 40.4168, longitude: -3.7038,
  });
  assert.deepEqual(props.decodeDatabaseLocation(encodedLocation), {
    name: 'Oficina Madrid', address: 'Calle Mayor 1', latitude: 40.4168, longitude: -3.7038,
  });
  assert.equal(props.decodeDatabaseLocation(props.encodeDatabaseLocation({ name: 'X', latitude: 100, longitude: -181 })).latitude, null);
  const encodedButton = props.encodeDatabaseButton({ clicks: 2, lastClickedAt: '2026-08-14T10:00:00.000Z', lastClickedBy: 'actor-ada' });
  assert.equal(props.decodeDatabaseButton(encodedButton).clicks, 2);
  assert.equal(props.formatUniqueDatabaseId('TASK-', 5, 42), 'TASK-00042');

  assert.equal(storage.databaseCellStorage('date', encodedDate).value_type, 'json');
  assert.equal(storage.databaseCellStorage('person', encodedPeople).value_type, 'json');
  assert.equal(storage.databaseCellStorage('location', encodedLocation).value_type, 'json');
  assert.equal(storage.databaseCellStorage('button', encodedButton).value_type, 'json');
  assert.equal(domain.normalizeCellValue('location', '{"name":""}'), null);
  assert.equal(domain.normalizeCellValue('person', 'Persona heredada'), props.encodeDatabasePeople([
    { id: 'person:persona heredada', label: 'Persona heredada', kind: 'person' },
  ]));

  // A real v139 database proves that immutable sequences are backfilled deterministically.
  const legacy = new Database(path.join(root, 'legacy-v139.sqlite'));
  migrateThrough(legacy, migrations, 139);
  const stamp = '2026-08-14T00:00:00.000Z';
  legacy.prepare(
    'INSERT INTO db_databases (id, short_id, name, icon, position, created_at, updated_at) VALUES (?, ?, ?, NULL, 0, ?, ?)',
  ).run('legacy-db', 'DB-L777', 'Legado', stamp, stamp);
  const insertLegacyRow = legacy.prepare(
    `INSERT INTO db_rows (id, database_id, position, revision, created_by, updated_by, created_at, updated_at)
     VALUES (?, 'legacy-db', ?, 1, 'legacy', 'legacy', ?, ?)`,
  );
  insertLegacyRow.run('legacy-b', 20, stamp, stamp);
  insertLegacyRow.run('legacy-a', 10, stamp, stamp);
  runMigrations(legacy);
  assert.equal(legacy.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.deepEqual(legacy.prepare("SELECT id, unique_sequence FROM db_rows WHERE database_id='legacy-db' ORDER BY unique_sequence").all(), [
    { id: 'legacy-a', unique_sequence: 1 }, { id: 'legacy-b', unique_sequence: 2 },
  ]);
  assert.throws(() => legacy.prepare(
    `INSERT INTO db_rows (id,database_id,position,unique_sequence,revision,created_by,updated_by,created_at,updated_at)
     VALUES ('duplicate-sequence','legacy-db',30,2,1,'legacy','legacy',?,?)`,
  ).run(stamp, stamp), /UNIQUE constraint failed/);
  assert.deepEqual(legacy.pragma('foreign_key_check'), []);
  assert.equal(legacy.pragma('quick_check', { simple: true }), 'ok');
  legacy.close();

  // Current schema, only through the real repository used by IPC and Electron.
  const sqlite = new Database(path.join(root, 'properties.sqlite'));
  runMigrations(sqlite);
  globalThis.__databasePropertiesDb = sqlite;
  const database = repo.createDatabase('Propiedades completas');
  const title = repo.createColumn(database.id, 'Nombre', 'title');
  const rich = repo.createColumn(database.id, 'Descripción', 'rich_text');
  const number = repo.createColumn(database.id, 'Presupuesto', 'number', {
    numberFormat: 'currency', numberCurrency: 'EUR', numberDecimals: 2,
  });
  const progress = repo.createColumn(database.id, 'Progreso', 'number', { numberFormat: 'progress', progressMaximum: 100 });
  const status = repo.createColumn(database.id, 'Estado', 'status');
  const date = repo.createColumn(database.id, 'Periodo', 'date', { dateIncludeTime: true, dateTimeZone: 'Europe/Madrid' });
  const person = repo.createColumn(database.id, 'Responsables', 'person');
  const url = repo.createColumn(database.id, 'Sitio', 'url');
  const email = repo.createColumn(database.id, 'Correo', 'email');
  const phone = repo.createColumn(database.id, 'Teléfono', 'phone');
  const location = repo.createColumn(database.id, 'Sede', 'location');
  const files = repo.createColumn(database.id, 'Archivos', 'files');
  const createdBy = repo.createColumn(database.id, 'Creado por', 'created_by');
  const editedBy = repo.createColumn(database.id, 'Editado por', 'last_edited_by');
  const createdTime = repo.createColumn(database.id, 'Creación', 'created_time');
  const editedTime = repo.createColumn(database.id, 'Edición', 'last_edited_time');
  const unique = repo.createColumn(database.id, 'Clave', 'unique_id', { uniqueIdPrefix: 'TASK-', uniqueIdPadding: 5 });
  const button = repo.createColumn(database.id, 'Acción', 'button', { buttonLabel: 'Publicar', buttonColor: '#4f46e5' });
  const pending = repo.addOption(status.id, 'Pendiente', '#64748b');
  const active = repo.addOption(status.id, 'En curso', '#2563eb');
  const complete = repo.addOption(status.id, 'Completo', '#16a34a');
  assert.deepEqual([pending.group, active.group, complete.group], ['pending', 'in_progress', 'complete']);
  repo.updateOption(active.id, { group: 'complete' });
  assert.equal(repo.getColumn(status.id).options.find((option) => option.id === active.id).group, 'complete');
  assert.throws(() => sqlite.prepare("UPDATE db_select_options SET group_key='invalid' WHERE id=?").run(active.id), /CHECK constraint failed/);

  const first = repo.createRow(database.id);
  const second = repo.createRow(database.id);
  assert.deepEqual([first.uniqueSequence, second.uniqueSequence], [1, 2]);
  repo.setCell(first.id, title.id, 'Proyecto Atlas');
  repo.setCell(first.id, rich.id, '**Especificación** local-first');
  repo.setCell(first.id, number.id, '1234.5');
  repo.setCell(first.id, progress.id, '65');
  repo.setCell(first.id, status.id, active.id);
  repo.setCell(first.id, date.id, encodedDate);
  repo.setCell(first.id, person.id, encodedPeople);
  repo.setCell(first.id, url.id, 'https://nodus.app/docs');
  repo.setCell(first.id, email.id, 'qa@nodus.app');
  repo.setCell(first.id, phone.id, '+34 600 123 456');
  repo.setCell(first.id, location.id, encodedLocation);
  repo.setCell(first.id, button.id, encodedButton);
  repo.setCell(second.id, title.id, 'Proyecto Beta');
  repo.setCell(second.id, status.id, pending.id);
  repo.setCell(second.id, date.id, props.encodeDatabaseDate({ start: '2026-07-01' }));
  const payload = Buffer.from('fixture de archivo deduplicado');
  repo.addAttachment({ rowId: first.id, columnId: files.id, fileName: 'especificacion.txt', mimeType: 'text/plain', bytes: payload.length, blob: payload, extractedText: 'Arquitectura local-first' });

  for (const automatic of [createdBy, editedBy, createdTime, editedTime, unique]) {
    assert.throws(() => repo.setCell(first.id, automatic.id, 'forzado'), /automática/);
  }
  const hydrated = repo.getRow(first.id);
  assert.equal(hydrated.cells[unique.id], 'TASK-00001');
  assert.equal(props.decodeDatabasePeople(hydrated.cells[createdBy.id])[0].label, 'local');
  assert.ok(hydrated.cells[createdTime.id].includes('T'));
  assert.equal(hydrated.attachments[files.id][0].fileName, 'especificacion.txt');

  const storedKinds = Object.fromEntries(sqlite.prepare(
    'SELECT column_id, value_type FROM db_cells WHERE row_id=?',
  ).all(first.id).map((entry) => [entry.column_id, entry.value_type]));
  assert.equal(storedKinds[number.id], 'number');
  assert.equal(storedKinds[status.id], 'reference');
  assert.equal(storedKinds[date.id], 'json');
  assert.equal(storedKinds[person.id], 'json');
  assert.equal(storedKinds[location.id], 'json');
  assert.equal(storedKinds[button.id], 'json');

  const queryOne = (columnId, op, value) => repo.queryDatabaseRows({
    databaseId: database.id, limit: 500,
    filter: { type: 'condition', columnId, op, value },
  }).rows.map((row) => row.id);
  assert.deepEqual(queryOne(status.id, 'isAnyOf', [active.id]), [first.id]);
  assert.deepEqual(queryOne(date.id, 'after', '2026-08-01'), [first.id]);
  assert.deepEqual(queryOne(person.id, 'contains', 'Ada'), [first.id]);
  assert.deepEqual(queryOne(location.id, 'contains', 'Madrid'), [first.id]);
  assert.deepEqual(queryOne(unique.id, 'contains', 'TASK-00001'), [first.id]);
  assert.deepEqual(queryOne(files.id, 'notEmpty', null), [first.id]);
  const byDate = repo.queryDatabaseRows({ databaseId: database.id, limit: 500, sorts: [{ columnId: date.id, dir: 'asc' }] });
  assert.deepEqual(byDate.rows.map((row) => row.id), [second.id, first.id]);
  const byId = repo.queryDatabaseRows({ databaseId: database.id, limit: 500, sorts: [{ columnId: unique.id, dir: 'desc' }] });
  assert.deepEqual(byId.rows.map((row) => row.id), [second.id, first.id]);

  assert.equal(filters.matchesCondition(person, hydrated, { id: 'person', columnId: person.id, op: 'contains', value: 'Plataforma' }), true);
  assert.equal(filters.matchesCondition(location, hydrated, { id: 'place', columnId: location.id, op: 'contains', value: 'Calle Mayor' }), true);
  const columns = repo.getColumns(database.id);
  const csv = exports.databaseToCsv(columns, [hydrated]);
  assert.match(csv, /Ada Lovelace, Plataforma/);
  assert.match(csv, /Oficina Madrid/);
  assert.match(csv, /especificacion\.txt/);
  const json = JSON.parse(exports.databaseToJson(columns, [hydrated]));
  assert.equal(json.rows[0].Presupuesto, 1234.5);
  assert.equal(json.rows[0].Estado, 'En curso');
  assert.equal(json.rows[0].Responsables[0].label, 'Ada Lovelace');
  assert.equal(json.rows[0].Clave, 'TASK-00001');
  const matrix = exports.databaseToMatrix(columns, [hydrated]);
  const xlsx = buildXlsx(matrix.header, matrix.body);
  assert.ok(xlsx.length > 1_000 && xlsx.subarray(0, 2).toString() === 'PK', 'XLSX is a real OOXML zip');

  repo.updateColumn(rich.id, { type: 'text' });
  repo.updateColumn(rich.id, { type: 'rich_text' });
  assert.equal(repo.getRow(first.id).cells[rich.id], '**Especificación** local-first', 'legacy/current text conversion is reversible');
  repo.deleteRow(first.id);
  const third = repo.createRow(database.id);
  assert.equal(third.uniqueSequence, 3, 'unique IDs are never reused after a deletion');
  assert.throws(() => sqlite.prepare(
    `INSERT INTO db_rows (id,database_id,position,unique_sequence,revision,created_by,updated_by,created_at,updated_at)
     VALUES ('duplicate-current',?,?,2,1,'qa','qa',?,?)`,
  ).run(database.id, 99, stamp, stamp), /UNIQUE constraint failed/);

  for (const required of ['rich_text', 'status', 'person', 'url', 'email', 'phone', 'location', 'files', 'created_by', 'last_edited_by', 'created_time', 'last_edited_time', 'unique_id', 'button']) {
    assert.ok(domain.availableColumnTypes().some((type) => type.id === required), `${required} is selectable`);
  }
  assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
  assert.equal(sqlite.pragma('quick_check', { simple: true }), 'ok');
  sqlite.close();
  console.log('database property parity (real SQLite) test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

function migrateThrough(db, migrations, target) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const migration of migrations.filter((item) => item.version <= target).sort((a, b) => a.version - b.version)) {
    db.transaction(() => {
      db.exec(migration.up);
      migration.after?.(db);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const databaseStub = path.join(userDataPath, 'stub-database.cjs');
  fs.writeFileSync(databaseStub, 'exports.getDb = () => globalThis.__databasePropertiesDb;\n');
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
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}
