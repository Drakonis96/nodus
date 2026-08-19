// Loop 2 acceptance test: typed database storage and integrity on real SQLite.
// Re-executes under Electron-as-Node so better-sqlite3 uses the same ABI as Nodus.

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

if (!process.argv.includes('--electron-typed-storage-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-database-typed-storage.mjs'), '--electron-typed-storage-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' },
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-typed-storage-'));
installRuntimeHooks(root);

try {
  const Database = require('better-sqlite3');
  const { migrations, runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const dbmode = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const { databaseCellStorage, databaseCellRaw } = require(path.join(repoRoot, 'shared/databaseCellStorage.ts'));

  assert.deepEqual(databaseCellStorage('number', '12.5'), {
    value_type: 'number', value_text: '12.5', value_number: 12.5,
    value_integer: null, value_date: null, value_json: null, value_reference: null,
  });
  assert.equal(databaseCellRaw({ value_text: null, value_integer: 1 }), '1');

  // Historical v134 fixture: contains duplicate titles, a database without a title,
  // duplicate attachment bytes and three cross-database EAV edges. The migration must
  // preserve every legitimate value and quarantine every illegitimate edge with payload.
  const legacy = new Database(path.join(root, 'legacy-v134.sqlite'));
  migrateThrough(legacy, migrations, 134);
  const t = '2026-01-02T03:04:05.000Z';
  legacy.exec('PRAGMA foreign_keys = ON');
  const addDatabase = legacy.prepare(
    'INSERT INTO db_databases (id, short_id, name, icon, position, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?)',
  );
  addDatabase.run('dbA', 'DB-A001', 'A', 0, t, t);
  addDatabase.run('dbB', 'DB-B001', 'B', 1, t, t);
  const addColumn = legacy.prepare(
    'INSERT INTO db_columns (id, database_id, name, type, position, config_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  addColumn.run('titleA1', 'dbA', 'Principal', 'title', 0, '{}', t);
  addColumn.run('titleA2', 'dbA', 'Título extra', 'title', 1, '{}', t);
  addColumn.run('fileA', 'dbA', 'Archivos', 'attachment', 2, '{}', t);
  addColumn.run('relA', 'dbA', 'Relación', 'relation', 3, '{}', t);
  addColumn.run('numberB', 'dbB', 'Cantidad', 'number', 0, '{}', t);
  const addRow = legacy.prepare(
    'INSERT INTO db_rows (id, database_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  );
  addRow.run('rowA', 'dbA', 0, t, t);
  addRow.run('rowB', 'dbB', 0, t, t);
  const addCell = legacy.prepare('INSERT INTO db_cells (row_id, column_id, value_text) VALUES (?, ?, ?)');
  addCell.run('rowA', 'titleA1', 'Conservar principal');
  addCell.run('rowA', 'titleA2', 'Conservar título extra');
  addCell.run('rowB', 'numberB', '42.5');
  addCell.run('rowA', 'numberB', 'celda cruzada');
  const addAttachment = legacy.prepare(
    `INSERT INTO db_attachments
      (id, row_id, column_id, file_name, mime_type, bytes, blob, content_hash, extracted_text,
       description, ai_generated, ai_prompt, thumb, position, created_at)
     VALUES (?, ?, ?, ?, 'text/plain', ?, ?, NULL, NULL, NULL, 0, NULL, NULL, ?, ?)`,
  );
  const duplicateBytes = Buffer.from('contenido-deduplicado');
  addAttachment.run('att1', 'rowA', 'fileA', 'uno.txt', duplicateBytes.length, duplicateBytes, 0, t);
  addAttachment.run('att2', 'rowA', 'fileA', 'dos.txt', duplicateBytes.length, duplicateBytes, 1, t);
  addAttachment.run('attCross', 'rowA', 'numberB', 'cruzado.txt', 7, Buffer.from('CRUZADO'), 2, t);
  legacy.prepare(
    `INSERT INTO db_relations
      (id, row_id, column_id, target_kind, target_id, target_vault_id, position, created_at)
     VALUES ('relCross', 'rowA', 'numberB', 'db_row', 'rowB', NULL, 0, ?)`,
  ).run(t);

  runMigrations(legacy);
  assert.equal(legacy.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.deepEqual(
    legacy.prepare("SELECT id, type FROM db_columns WHERE database_id = 'dbA' ORDER BY position").all().slice(0, 2),
    [{ id: 'titleA1', type: 'title' }, { id: 'titleA2', type: 'text' }],
    'the first title remains primary and later titles become lossless rich text',
  );
  assert.equal(
    legacy.prepare("SELECT COUNT(*) AS n FROM db_columns WHERE database_id = 'dbB' AND type = 'title'").get().n,
    1,
    'a deterministic Nombre title is created when none existed',
  );
  assert.equal(
    legacy.prepare("SELECT value_text FROM db_cells WHERE row_id = 'rowA' AND column_id = 'titleA2'").get().value_text,
    'Conservar título extra',
  );
  const typedLegacyNumber = legacy.prepare(
    "SELECT value_type, value_text, value_number FROM db_cells WHERE row_id = 'rowB' AND column_id = 'numberB'",
  ).get();
  assert.deepEqual(typedLegacyNumber, { value_type: 'number', value_text: '42.5', value_number: 42.5 });
  assert.equal(legacy.prepare('SELECT COUNT(*) AS n FROM db_blobs').get().n, 1, 'equal legacy files share one blob');
  assert.equal(legacy.prepare('SELECT COUNT(*) AS n FROM db_attachments').get().n, 2, 'invalid attachment is not activated');
  const quarantine = legacy.prepare(
    'SELECT source_table, payload_json, payload_blob FROM db_integrity_quarantine ORDER BY source_table',
  ).all();
  assert.equal(quarantine.length, 3, 'cell, attachment and relation mismatches are quarantined');
  assert.deepEqual(quarantine.map((row) => row.source_table), ['db_attachments', 'db_cells', 'db_relations']);
  assert.equal(quarantine[0].payload_blob.toString(), 'CRUZADO', 'quarantined attachment bytes are retained');
  assert.deepEqual(legacy.pragma('foreign_key_check'), []);
  legacy.close();

  // Current schema through the public repository.
  const current = new Database(path.join(root, 'current.sqlite'));
  runMigrations(current);
  globalThis.__typedStorageDb = current;
  const first = dbmode.createDatabase('Tipada');
  const second = dbmode.createDatabase('Aislada');
  const title = dbmode.createColumn(first.id, 'Nombre', 'title');
  const extraTitle = dbmode.createColumn(first.id, 'Otro título', 'title');
  const text = dbmode.createColumn(first.id, 'Texto', 'text');
  const number = dbmode.createColumn(first.id, 'Número', 'number');
  const checkbox = dbmode.createColumn(first.id, 'Sí/No', 'checkbox');
  const date = dbmode.createColumn(first.id, 'Fecha', 'date');
  const select = dbmode.createColumn(first.id, 'Estado', 'select');
  const multi = dbmode.createColumn(first.id, 'Etiquetas', 'multi_select');
  const file = dbmode.createColumn(first.id, 'Archivo', 'attachment');
  const relation = dbmode.createColumn(first.id, 'Relación', 'relation');
  const foreignColumn = dbmode.createColumn(second.id, 'Nombre', 'title');
  assert.equal(extraTitle.type, 'text', 'a second title request is safely demoted');
  const option = dbmode.addOption(select.id, 'Activo', '#16a34a');
  const tagA = dbmode.addOption(multi.id, 'A');
  const tagB = dbmode.addOption(multi.id, 'B');
  const row = dbmode.createRow(first.id);
  const target = dbmode.createRow(first.id);
  const foreignRow = dbmode.createRow(second.id);
  dbmode.setCell(row.id, title.id, 'Registro');
  dbmode.setCell(row.id, text.id, 'texto rico');
  dbmode.setCell(row.id, number.id, '3.5');
  dbmode.setCell(row.id, checkbox.id, '1');
  dbmode.setCell(row.id, date.id, '2026-08-14');
  dbmode.setCell(row.id, select.id, option.id);
  dbmode.setCell(row.id, multi.id, JSON.stringify([tagA.id, tagB.id]));

  const stored = Object.fromEntries(
    current.prepare(
      `SELECT column_id, value_type, value_number, value_integer, value_date, value_json, value_reference
       FROM db_cells WHERE row_id = ?`,
    ).all(row.id).map((value) => [value.column_id, value]),
  );
  assert.equal(stored[number.id].value_type, 'number');
  assert.equal(stored[number.id].value_number, 3.5);
  assert.equal(stored[checkbox.id].value_type, 'integer');
  assert.equal(stored[checkbox.id].value_integer, 1);
  assert.equal(stored[date.id].value_type, 'date');
  assert.equal(stored[date.id].value_date, '2026-08-14');
  assert.equal(stored[select.id].value_type, 'reference');
  assert.equal(stored[select.id].value_reference, option.id);
  assert.equal(stored[multi.id].value_type, 'json');
  assert.equal(stored[multi.id].value_json, JSON.stringify([tagA.id, tagB.id]));

  current.prepare('UPDATE db_cells SET value_text = NULL WHERE row_id = ? AND column_id = ?').run(row.id, number.id);
  assert.equal(dbmode.getRow(row.id).cells[number.id], '3.5', 'typed-only writers remain readable by the compatibility API');
  const revBeforeRetype = current.prepare(
    'SELECT revision FROM db_cells WHERE row_id = ? AND column_id = ?',
  ).get(row.id, number.id).revision;
  dbmode.updateColumn(number.id, { type: 'text' });
  let retyped = current.prepare(
    'SELECT value_type, value_text, value_number, revision FROM db_cells WHERE row_id = ? AND column_id = ?',
  ).get(row.id, number.id);
  assert.equal(retyped.value_type, 'text');
  assert.equal(retyped.value_text, '3.5');
  assert.equal(retyped.value_number, null);
  dbmode.updateColumn(number.id, { type: 'number' });
  retyped = current.prepare(
    'SELECT value_type, value_text, value_number, revision FROM db_cells WHERE row_id = ? AND column_id = ?',
  ).get(row.id, number.id);
  assert.equal(retyped.value_type, 'number');
  assert.equal(retyped.value_number, 3.5);
  assert.ok(retyped.revision >= revBeforeRetype + 2, 'retyping is revisioned in both directions');

  assert.throws(
    () => dbmode.setCell(row.id, foreignColumn.id, 'no permitido'),
    /bases de datos distintas/,
    'the public repository rejects a cross-database cell',
  );
  assert.throws(
    () => current.prepare(
      `INSERT INTO db_cells
        (database_id,row_id,column_id,value_type,value_text,revision,created_by,updated_by,created_at,updated_at)
       VALUES (?,?,?,?,?,1,'test','test',?,?)`,
    ).run(first.id, row.id, foreignColumn.id, 'text', 'inválida', t, t),
    /FOREIGN KEY constraint failed/,
  );

  const bytes = Buffer.from('mismo-contenido-binario');
  const attachmentA = dbmode.addAttachment({
    rowId: row.id, columnId: file.id, fileName: 'a.bin', mimeType: 'application/octet-stream', bytes: bytes.length, blob: bytes,
  });
  const attachmentB = dbmode.addAttachment({
    rowId: target.id, columnId: file.id, fileName: 'b.bin', mimeType: 'application/octet-stream', bytes: bytes.length, blob: bytes,
  });
  assert.equal(current.prepare('SELECT COUNT(*) AS n FROM db_blobs').get().n, 1);
  assert.equal(dbmode.getAttachmentBlob(attachmentA.id).toString(), bytes.toString());
  dbmode.deleteAttachment(attachmentA.id);
  assert.equal(current.prepare('SELECT COUNT(*) AS n FROM db_blobs').get().n, 1, 'a referenced blob is retained');
  dbmode.deleteAttachment(attachmentB.id);
  assert.equal(current.prepare('SELECT COUNT(*) AS n FROM db_blobs').get().n, 0, 'the last delete garbage-collects the blob');

  const relationValue = dbmode.addRelation(row.id, relation.id, 'db_row', target.id);
  assert.ok(relationValue.id);
  assert.throws(
    () => dbmode.addRelation(row.id, foreignColumn.id, 'db_row', foreignRow.id),
    /bases de datos distintas/,
  );
  const view = dbmode.createView(first.id, { name: 'Principal', layout: 'table' });
  dbmode.updateView(view.id, { name: 'Actualizada' });
  dbmode.updateOption(option.id, { label: 'Listo' });

  const metadataChecks = [
    current.prepare('SELECT revision, updated_at, updated_by FROM db_columns WHERE id = ?').get(number.id),
    current.prepare('SELECT revision, updated_at, updated_by FROM db_select_options WHERE id = ?').get(option.id),
    current.prepare('SELECT revision, updated_at, updated_by FROM db_views WHERE id = ?').get(view.id),
    current.prepare('SELECT revision, updated_at, updated_by FROM db_relations WHERE id = ?').get(relationValue.id),
  ];
  for (const metadata of metadataChecks) {
    assert.ok(metadata.revision >= 1);
    assert.notEqual(metadata.updated_at, '1970-01-01T00:00:00.000Z');
    assert.ok(metadata.updated_by);
  }
  assert.deepEqual(current.pragma('foreign_key_check'), [], 'all current typed edges pass foreign_key_check');
  assert.equal(current.pragma('quick_check', { simple: true }), 'ok');
  current.close();

  console.log('database typed storage/integrity (real SQLite) test passed');
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
  fs.writeFileSync(databaseStub, 'exports.getDb = () => globalThis.__typedStorageDb;\n');

  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    const resolved = originalResolveFilename.call(this, request, parent, isMain, options);
    if (resolved === path.join(repoRoot, 'electron/db/database.ts')) return databaseStub;
    return resolved;
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
        safeStorage: { isEncryptionAvailable: () => false },
        BrowserWindow: class {}, dialog: {}, shell: {},
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}
