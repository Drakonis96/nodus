// Loop 14 acceptance: templates, recurrence, subitems, dependencies and sprints on real SQLite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const require = createRequire(import.meta.url);
const marker = '--electron-database-tasks-test';
if (!process.argv.includes(marker)) { execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker], {
  cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
}); process.exit(0); }

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-database-tasks-')); installRuntimeHooks(root);
try {
  const Database = require('better-sqlite3'); const { migrations, runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const databases = require(path.join(repoRoot, 'electron/db/databasesRepo.ts')); const tasks = require(path.join(repoRoot, 'electron/db/databaseTasksRepo.ts'));
  const pages = require(path.join(repoRoot, 'electron/db/pagesRepo.ts')); const domain = require(path.join(repoRoot, 'shared/databaseTasks.ts'));

  const historical = new Database(path.join(root, 'historical-v143.sqlite')); migrateThrough(historical, migrations, 143); runMigrations(historical);
  assert.equal(historical.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  for (const table of ['db_row_templates','db_template_runs','db_row_hierarchy','db_row_dependencies','db_task_configs','db_sprints','db_sprint_rows'])
    assert.ok(historical.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} migrated`);
  historical.close();

  const sqlite = new Database(path.join(root, 'tasks.sqlite')); runMigrations(sqlite); globalThis.__databaseTasksDb = sqlite;
  const database = databases.createDatabase('Plan editorial');
  const title = databases.createColumn(database.id, 'Nombre', 'title'); const status = databases.createColumn(database.id, 'Estado', 'status');
  const pending = databases.addOption(status.id, 'Pendiente', '#64748b', 'pending'); const date = databases.createColumn(database.id, 'Fecha', 'date');
  const relation = databases.createColumn(database.id, 'Relacionado', 'relation', { relationTargetKind: 'db_row', relationTargetDatabaseId: database.id });
  const make = (name, rawDate) => { const row = databases.createRow(database.id); databases.setCell(row.id, title.id, name); databases.setCell(row.id, date.id, rawDate); return row; };
  const first = make('Proyecto raíz', '2026-08-14'); const second = make('Capítulo', '2026-08-14'); const third = make('Revisión', '2026-08-14');

  tasks.setDatabaseSubitemParent(second.id, first.id); tasks.setDatabaseSubitemParent(third.id, second.id);
  assert.deepEqual(tasks.listDatabaseRowHierarchy(database.id).map((row) => [row.title, row.depth]), [['Proyecto raíz',0],['Capítulo',1],['Revisión',2]]);
  assert.throws(() => tasks.setDatabaseSubitemParent(first.id, third.id), /ciclo/);
  tasks.setDatabaseSubitemCollapsed(first.id, true); assert.equal(tasks.listDatabaseRowHierarchy(database.id)[0].collapsed, true);

  tasks.addDatabaseRowDependency(first.id, second.id); tasks.addDatabaseRowDependency(second.id, third.id);
  assert.throws(() => tasks.addDatabaseRowDependency(third.id, first.id), /ciclo/);
  assert.throws(() => tasks.addDatabaseRowDependency(first.id, first.id), /sí misma/);
  tasks.updateDatabaseTaskConfig(database.id, { dateColumnId: date.id, statusColumnId: status.id, avoidWeekends: true, shiftDependents: true, subitemView: 'nested' });
  const shifted = tasks.shiftDatabaseTaskDates(first.id, 1); assert.equal(shifted.length, 3);
  for (const row of [first,second,third]) assert.match(databases.getRow(row.id).cells[date.id], /2026-08-17/);
  tasks.shiftDatabaseTaskDates(first.id, -1); for (const row of [first,second,third]) assert.match(databases.getRow(row.id).cells[date.id], /2026-08-14/);

  const template = tasks.createDatabaseRowTemplate(database.id, { name: 'Tarea mensual', icon: '🗓️', properties: { [title.id]: 'Nueva entrega', [status.id]: pending.id },
    blocks: [{ id: 'template-block', type: 'heading_2', content: { text: 'Lista de comprobación' } }, { id: 'template-child', parentBlockId: 'template-block', type: 'task', content: { text: 'Revisar', checked: false } }],
    defaultRelations: [{ columnId: relation.id, targetKind: 'db_row', targetId: first.id }], recurrence: 'monthly', timeZone: 'Europe/Madrid', nextRunAt: '2026-08-31T09:00:00.000Z' });
  const occurrence = `${template.id}:manual-idempotent`; const made = tasks.instantiateDatabaseRowTemplate(template.id, occurrence);
  const repeated = tasks.instantiateDatabaseRowTemplate(template.id, occurrence); assert.equal(made.created, true); assert.equal(repeated.created, false); assert.equal(repeated.rowId, made.rowId);
  assert.equal(databases.getRow(made.rowId).cells[title.id], 'Nueva entrega'); assert.equal(databases.listRelations(made.rowId, relation.id).length, 1);
  const document = pages.getPageDocumentForRow(made.rowId); assert.equal(document.blocks.length, 2); assert.equal(document.page.icon, '🗓️');
  assert.notEqual(document.blocks[0].id, 'template-block', 'every instance gets globally fresh block ids');

  const due = tasks.runDueDatabaseRowTemplates('2026-08-31T10:00:00.000Z'); assert.equal(due.length, 1); assert.equal(due[0].created, true);
  assert.equal(tasks.runDueDatabaseRowTemplates('2026-08-31T10:00:00.000Z').length, 0, 'scheduled occurrence advances atomically');
  assert.equal(domain.nextDatabaseTemplateRun('2026-01-31T09:00:00.000Z', 'monthly'), '2026-02-28T09:00:00.000Z');

  const sourceDoc = pages.getPageDocumentForRow(second.id); pages.savePageDocument({ pageId: sourceDoc.page.id, expectedRevision: sourceDoc.revision,
    blocks: [{ type: 'paragraph', content: { text: 'Contenido duplicable' } }], reason: 'test' });
  const deep = tasks.duplicateDatabaseRow({ rowId: second.id, includeContent: true, includeChildren: true });
  assert.equal(pages.getPageDocumentForRow(deep.rowId).blocks[0].normalizedText, 'Contenido duplicable');
  const deepTree = tasks.listDatabaseRowHierarchy(database.id).filter((row) => row.parentRowId === deep.rowId); assert.equal(deepTree.length, 1);
  const shallow = tasks.duplicateDatabaseRow({ rowId: second.id, includeContent: false }); assert.equal(pages.getPageDocumentForRow(shallow.rowId).blocks.length, 0);

  const sprint = tasks.createDatabaseSprint(database.id, { name: 'Sprint 01', startAt: '2026-08-17T00:00:00.000Z', endAt: '2026-08-28T23:59:59.999Z' });
  tasks.assignDatabaseRowToSprint(sprint.id, first.id); assert.equal(tasks.listDatabaseSprints(database.id)[0].rowCount, 1);
  assert.equal(tasks.updateDatabaseSprintState(sprint.id, 'active').state, 'active'); assert.throws(() => tasks.createDatabaseSprint(database.id, { name: 'Mal', startAt: '2026-09-02T00:00:00.000Z', endAt: '2026-09-01T00:00:00.000Z' }), /intervalo/);

  const snapshot = fs.readFileSync(path.join(repoRoot, 'electron/serverSync/serverSnapshot.ts'), 'utf8');
  for (const table of ['db_row_templates','db_template_runs','db_row_hierarchy','db_row_dependencies','db_task_configs','db_sprints','db_sprint_rows']) assert.match(snapshot, new RegExp(`'${table}'`));
  assert.deepEqual(sqlite.pragma('foreign_key_check'), []); assert.equal(sqlite.pragma('quick_check', { simple: true }), 'ok'); sqlite.close();
  console.log('database templates, subitems, dependencies and sprints (real SQLite) test passed');
} finally { await rm(root, { recursive: true, force: true }); }

function migrateThrough(db, migrations, version) { db.pragma('foreign_keys = ON'); for (const migration of migrations.filter((item) => item.version <= version).sort((a,b) => a.version-b.version)) db.transaction(() => { db.exec(migration.up); migration.after?.(db); db.pragma(`user_version = ${migration.version}`); })(); }
function installRuntimeHooks(userDataPath) {
  const ts = require('typescript'); const Module = require('node:module'); const originalResolveFilename = Module._resolveFilename; const originalLoad = Module._load;
  const databaseStub = path.join(userDataPath, 'stub-database.cjs'); fs.writeFileSync(databaseStub, 'exports.getDb = () => globalThis.__databaseTasksDb;\n');
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) { if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`); const resolved = originalResolveFilename.call(this, request, parent, isMain, options); return resolved === path.join(repoRoot, 'electron/db/database.ts') ? databaseStub : resolved; };
  Module._load = function load(request, parent, isMain) { if (request === 'electron') return { app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false }, BrowserWindow: class {}, dialog: {}, shell: {} }; return originalLoad.call(this, request, parent, isMain); };
  require.extensions['.ts'] = function loadTs(module, filename) { module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename }).outputText, filename); };
}
