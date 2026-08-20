// Loop 9 acceptance: versioned view configs, compatibility and restoration on real SQLite.
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
const marker = '--electron-database-views-v2-test';
if (!process.argv.includes(marker)) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-views-v2-'));
installRuntimeHooks(root);
try {
  const Database = require('better-sqlite3');
  const { migrations, runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const repo = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const viewDomain = require(path.join(repoRoot, 'shared/databaseViewConfig.ts'));

  // A genuine v141 saved view migrates to v2 without changing its table/gallery result.
  const historical = new Database(path.join(root, 'historical-v141.sqlite'));
  migrateThrough(historical, migrations, 141);
  const timestamp = '2026-08-14T08:00:00.000Z';
  historical.prepare(
    `INSERT INTO db_databases (id, short_id, name, icon, position, created_at, updated_at)
     VALUES ('legacy-db', 'DB-LEGACY', 'Legado', NULL, 0, ?, ?)`,
  ).run(timestamp, timestamp);
  historical.prepare(
    `INSERT INTO db_views
      (id, database_id, name, layout, filter_json, sort_json, position, created_at, updated_at,
       revision, created_by, updated_by)
     VALUES ('legacy-view', 'legacy-db', 'Galería vigente', 'gallery', ?, ?, 0, ?, ?, 3, 'alice', 'alice')`,
  ).run(
    JSON.stringify({ conjunction: 'and', conditions: [{ id: 'legacy-condition', columnId: 'missing-column', op: 'contains', value: 'atlas' }] }),
    JSON.stringify([{ columnId: 'missing-column', dir: 'desc' }]), timestamp, timestamp,
  );
  runMigrations(historical);
  assert.equal(historical.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  const migrated = historical.prepare('SELECT * FROM db_views WHERE id = ?').get('legacy-view');
  const migratedConfig = JSON.parse(migrated.config_json);
  assert.equal(migrated.layout, 'gallery');
  assert.equal(migratedConfig.version, 2);
  assert.equal(migratedConfig.layout, 'gallery');
  assert.equal(migratedConfig.sorts[0].dir, 'desc');
  assert.equal(migratedConfig.filter.children[0].value, 'atlas');
  assert.equal(historical.prepare('SELECT COUNT(*) AS n FROM db_view_revisions WHERE view_id = ?').get('legacy-view').n, 1);
  historical.close();

  const sqlite = new Database(path.join(root, 'views-v2.sqlite'));
  runMigrations(sqlite);
  globalThis.__databaseViewsV2Db = sqlite;
  const database = repo.createDatabase('Proyectos');
  const title = repo.createColumn(database.id, 'Nombre', 'title');
  const status = repo.createColumn(database.id, 'Estado', 'status');
  const due = repo.createColumn(database.id, 'Fecha', 'date');
  const location = repo.createColumn(database.id, 'Lugar', 'location');
  const rows = ['Atlas', 'Bóreas', 'Cronos'].map((label) => {
    const row = repo.createRow(database.id);
    repo.setCell(row.id, title.id, label);
    return row;
  });

  const nestedFilter = {
    type: 'group', operator: 'and', children: [
      { type: 'group', operator: 'or', children: [
        { type: 'condition', columnId: title.id, op: 'contains', value: 'Atlas' },
        { type: 'condition', columnId: title.id, op: 'contains', value: 'Cronos' },
      ] },
    ],
  };
  const tableConfig = viewDomain.normalizeDatabaseViewConfig({
    ...viewDomain.defaultDatabaseViewConfig('table'),
    properties: [
      { columnId: status.id, visible: true, order: 0, width: 220, frozen: true },
      { columnId: title.id, visible: true, order: 1, width: 310, frozen: false },
      { columnId: due.id, visible: false, order: 2, width: null, frozen: false },
    ],
    rowHeight: 'tall', wrap: true, density: 'spacious', openMode: 'side',
    filter: nestedFilter, sorts: [{ columnId: title.id, dir: 'desc' }],
    groups: [{ columnId: status.id, dir: 'asc' }], scope: 'personal', editPermission: 'owner',
  });
  const primary = repo.createView(database.id, {
    name: 'Plan personal', layout: 'table', filter: { conjunction: 'and', conditions: [] }, sorts: [], config: tableConfig,
  });
  assert.equal(primary.config.version, 2);
  assert.equal(primary.config.rowHeight, 'tall');
  assert.equal(primary.config.properties[0].columnId, status.id);
  assert.equal(primary.scope, 'personal');
  assert.equal(primary.revision, 1);
  assert.equal(repo.queryDatabaseRows({ databaseId: database.id, viewId: primary.id }).rows.length, 2,
    'queryDatabaseRows reads the recursive filter from config_json');

  // Every public discriminant survives repository serialization now, before its renderer
  // arrives in the following loops.
  const layouts = ['gallery', 'list', 'board', 'calendar', 'timeline', 'chart', 'map', 'feed', 'dashboard'];
  const created = [primary];
  for (const layout of layouts) {
    const config = viewDomain.normalizeDatabaseViewConfig({
      ...viewDomain.defaultDatabaseViewConfig(layout),
      dateColumnId: due.id,
      startColumnId: due.id,
      locationColumnId: location.id,
      cardPropertyIds: [status.id],
    });
    created.push(repo.createView(database.id, {
      name: layout, layout, filter: { conjunction: 'and', conditions: [] }, sorts: [], config,
    }));
  }
  assert.deepEqual(repo.listViews(database.id).map((view) => view.layout), ['table', ...layouts]);

  const changedConfig = viewDomain.normalizeDatabaseViewConfig({ ...primary.config, rowHeight: 'compact', openMode: 'full_page' });
  const updated = repo.updateView(primary.id, { config: changedConfig, expectedRevision: primary.revision });
  assert.equal(updated.revision, 2);
  assert.equal(updated.config.rowHeight, 'compact');
  assert.throws(() => repo.updateView(primary.id, { name: 'stale', expectedRevision: 1 }), /Conflicto de revisión/);

  const duplicate = repo.duplicateView(primary.id, 'Copia independiente');
  const linked = repo.linkView(primary.id, 'Personal enlazada', 'personal');
  assert.equal(duplicate.sourceViewId, null);
  assert.equal(linked.sourceViewId, primary.id);
  assert.equal(linked.scope, 'personal');
  repo.updateView(linked.id, { name: 'Enlace local editado', expectedRevision: linked.revision });
  assert.equal(repo.listViews(database.id).find((view) => view.id === primary.id).name, primary.name,
    'a linked view keeps local changes away from its source');

  const beforeOrder = repo.listViews(database.id);
  const reversedIds = beforeOrder.map((view) => view.id).reverse();
  const reordered = repo.reorderViews(database.id, reversedIds);
  assert.deepEqual(reordered.map((view) => view.id), reversedIds);
  assert.throws(() => repo.reorderViews(database.id, [reversedIds[0]]), /exactamente todas/);

  const current = repo.listViews(database.id).find((view) => view.id === primary.id);
  const historyBeforeRestore = repo.listViewRevisions(primary.id);
  assert.ok(historyBeforeRestore.some((revision) => revision.revision === 1));
  const restored = repo.restoreViewRevision(primary.id, 1, current.revision);
  assert.equal(restored.config.rowHeight, 'tall');
  assert.ok(restored.revision > current.revision);
  const historyAfterRestore = repo.listViewRevisions(primary.id);
  assert.ok(historyAfterRestore.some((revision) => revision.revision === 2), 'later revisions remain after restore');
  assert.equal(historyAfterRestore[0].reason, 'restore');

  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM db_views WHERE config_version = 2 AND config_json IS NOT NULL').get().n, reordered.length);
  assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
  assert.equal(sqlite.pragma('quick_check', { simple: true }), 'ok');
  sqlite.close();
  console.log('database view config v2, migration and revision restoration (real SQLite) test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

function migrateThrough(db, migrations, version) {
  db.pragma('foreign_keys = ON');
  for (const migration of migrations.filter((item) => item.version <= version).sort((a, b) => a.version - b.version)) {
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
  fs.writeFileSync(databaseStub, 'exports.getDb = () => globalThis.__databaseViewsV2Db;\n');
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
