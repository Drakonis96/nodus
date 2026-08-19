// Loop 13 acceptance: compatible sources, typed mappings and linked-container paging on real SQLite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url); const marker = '--electron-database-sources-test';
if (!process.argv.includes(marker)) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  }); process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-database-sources-')); installRuntimeHooks(root);
try {
  const Database = require('better-sqlite3');
  const { migrations, runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const repo = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const pages = require(path.join(repoRoot, 'shared/pages.ts'));

  // A genuine v143 vault receives one source per database and one primary link per view.
  const historical = new Database(path.join(root, 'historical-v143.sqlite')); migrateThrough(historical, migrations, 143);
  const timestamp = '2026-08-14T08:00:00.000Z';
  historical.prepare(`INSERT INTO db_databases (id, short_id, name, icon, position, created_at, updated_at, revision, created_by, updated_by)
    VALUES ('legacy-db', 'DB-LEGACY', 'Legado', NULL, 0, ?, ?, 4, 'alice', 'alice')`).run(timestamp, timestamp);
  historical.prepare(`INSERT INTO db_views
    (id,database_id,name,layout,filter_json,sort_json,position,created_at,updated_at,revision,created_by,updated_by,
     config_version,config_json,scope,owner_actor_id,edit_permission,source_view_id)
    VALUES ('legacy-view','legacy-db','Tabla','table','{"conjunction":"and","conditions":[]}','[]',0,?,?,2,'alice','alice',2,
      '{"version":2,"layout":"table","properties":[],"rowHeight":"medium","wrap":false,"density":"comfortable","openMode":"center","filter":null,"sorts":[],"groups":[],"scope":"shared","ownerActorId":"local","editPermission":"editors","sourceViewId":null,"showCalculations":true}',
      'shared','local','editors',NULL)`).run(timestamp, timestamp);
  runMigrations(historical);
  assert.equal(historical.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.equal(historical.prepare('SELECT COUNT(*) AS n FROM db_data_sources').get().n, 1);
  assert.deepEqual(historical.prepare('SELECT view_id, is_primary FROM db_view_sources').get(), { view_id: 'legacy-view', is_primary: 1 });
  assert.deepEqual(historical.pragma('foreign_key_check'), []); historical.close();

  const sqlite = new Database(path.join(root, 'sources.sqlite')); runMigrations(sqlite); globalThis.__databaseSourcesDb = sqlite;
  const first = repo.createDatabase('Proyectos'); const firstTitle = repo.createColumn(first.id, 'Nombre', 'title');
  const firstStatus = repo.createColumn(first.id, 'Estado', 'status');
  const second = repo.createDatabase('Publicaciones'); const secondTitle = repo.createColumn(second.id, 'Título', 'title');
  const secondStatus = repo.createColumn(second.id, 'Fase', 'status');
  for (const [database, title, status, prefix] of [[first, firstTitle, firstStatus, 'A'], [second, secondTitle, secondStatus, 'B']]) {
    for (const label of ['Alpha 1', 'Beta 1', 'Alpha 2', 'Gamma 1']) { const row = repo.createRow(database.id);
      repo.setCell(row.id, title.id, `${prefix} ${label}`); repo.setCell(row.id, status.id, label.startsWith('Alpha') ? 'active' : 'pending'); }
  }
  const view = repo.createView(first.id, { name: 'Portfolio unido', layout: 'table',
    filter: { conjunction: 'and', conditions: [] }, sorts: [] });
  const beforeRevision = repo.listViews(first.id).find((entry) => entry.id === view.id).revision;
  const attached = repo.attachDatabaseViewSource(view.id, second.id, { alias: 'Editorial' });
  assert.equal(attached.databaseId, second.id); assert.equal(attached.propertyMap.title, secondTitle.id);
  assert.equal(attached.propertyMap.status, secondStatus.id, 'properties with different names map by type');
  const definition = repo.getDatabaseContainer(view.id);
  assert.equal(definition.sources.length, 2); assert.equal(definition.properties.find((property) => property.id === 'status').sources.length, 2);

  let cursor = null; const combined = [];
  do { const page = repo.queryDatabaseContainerRows({ viewId: view.id, cursor, limit: 3 }); combined.push(...page.rows); cursor = page.nextCursor; } while (cursor);
  assert.equal(combined.length, 8); assert.equal(new Set(combined.map((row) => row.id)).size, 8);
  assert.equal(new Set(combined.map((row) => row.sourceId)).size, 2);
  assert.ok(combined.every((row) => row.cells.title && row.cells.status));
  const filtered = repo.queryDatabaseContainerRows({ viewId: view.id,
    localFilter: { type: 'condition', columnId: 'title', op: 'contains', value: 'Alpha' }, limit: 500 });
  assert.equal(filtered.rows.length, 4); assert.equal(filtered.totalCount, 4);
  assert.equal(repo.listViews(first.id).find((entry) => entry.id === view.id).revision, beforeRevision,
    'a local linked-block filter cannot mutate the source view');
  const oneSource = repo.queryDatabaseContainerRows({ viewId: view.id, sourceId: attached.sourceId, limit: 500 });
  assert.equal(oneSource.rows.length, 4); assert.ok(oneSource.rows.every((row) => row.sourceId === attached.sourceId));
  const wrongCursor = repo.queryDatabaseContainerRows({ viewId: view.id, limit: 2 }).nextCursor;
  assert.throws(() => repo.queryDatabaseContainerRows({ viewId: view.id, cursor: wrongCursor,
    localFilter: { type: 'condition', columnId: 'title', op: 'contains', value: 'Beta' } }), /otra consulta/);
  assert.equal(repo.queryDatabaseContainerRows({ viewId: view.id, limit: 99_999 }).rows.length, 8);
  assert.throws(() => repo.attachDatabaseViewSource(view.id, second.id, { propertyMap: { status: secondTitle.id } }), /mismo tipo/);
  const primary = definition.sources.find((source) => source.primary);
  assert.throws(() => repo.detachDatabaseViewSource(view.id, primary.sourceId), /principal/);

  const content = { viewId: view.id, titleFilter: 'Alpha', localFilter: { type: 'condition', columnId: 'title', op: 'contains', value: 'Alpha' }, tabs: true };
  const markdown = pages.pageBlockToMarkdown({ type: 'database_view', content });
  const restored = pages.markdownToPageBlocks(markdown)[0];
  assert.deepEqual(restored.content, content, 'linked-view local state survives Markdown round-trip');
  const snapshotSource = fs.readFileSync(path.join(repoRoot, 'electron/serverSync/serverSnapshot.ts'), 'utf8');
  assert.match(snapshotSource, /'db_data_sources'/); assert.match(snapshotSource, /'db_view_sources'/);
  assert.deepEqual(sqlite.pragma('foreign_key_check'), []); assert.equal(sqlite.pragma('quick_check', { simple: true }), 'ok');
  sqlite.close(); console.log('database sources and linked page views (real SQLite) test passed');
} finally { await rm(root, { recursive: true, force: true }); }

function migrateThrough(db, migrations, version) {
  db.pragma('foreign_keys = ON');
  for (const migration of migrations.filter((item) => item.version <= version).sort((left, right) => left.version - right.version)) db.transaction(() => {
    db.exec(migration.up); migration.after?.(db); db.pragma(`user_version = ${migration.version}`);
  })();
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript'); const Module = require('node:module'); const originalResolveFilename = Module._resolveFilename; const originalLoad = Module._load;
  const databaseStub = path.join(userDataPath, 'stub-database.cjs'); fs.writeFileSync(databaseStub, 'exports.getDb = () => globalThis.__databaseSourcesDb;\n');
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    const resolved = originalResolveFilename.call(this, request, parent, isMain, options);
    return resolved === path.join(repoRoot, 'electron/db/database.ts') ? databaseStub : resolved;
  };
  Module._load = function load(request, parent, isMain) { if (request === 'electron') return {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => false }, BrowserWindow: class {}, dialog: {}, shell: {},
  }; return originalLoad.call(this, request, parent, isMain); };
  require.extensions['.ts'] = function loadTs(module, filename) { module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  }).outputText, filename); };
}
