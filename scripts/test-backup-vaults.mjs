// Whole-app backup integrity: proves an automatic backup captures EVERY vault (of
// every type), and that restoring it brings them all back — the guarantee that the
// copy is integral across vault types, not just the active vault. Runs the REAL
// vaultRegistry + database + exportImport under Electron-as-Node against a temp
// profile.
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

if (!process.argv.includes('--electron-backup-vaults-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-backup-vaults.mjs'), '--electron-backup-vaults-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-backup-vaults-'));
installRuntimeHooks(root);

try {
  const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const entities = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const dbmode = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const { createBackupArchive, restoreBackupArchive } = require(path.join(repoRoot, 'electron/export/exportImport.ts'));

  const switchTo = (id) => {
    vaults.setActiveVault(id);
    closeDb();
  };

  // ── Two vaults of different types, each with its own data ───────────────────
  const legacy = vaults.getActiveVault(); // the default 'academic' vault
  assert.equal(legacy.type, 'academic');
  const alice = entities.createPerson({ displayName: 'Alice Académica' });
  assert.ok(entities.getPerson(alice.personId), 'person seeded in vault A');

  const gene = vaults.createVault('Familia', 'genealogy');
  switchTo(gene.id);
  assert.equal(vaults.getActiveVault().type, 'genealogy', 'active vault is now the genealogy one');
  const bob = entities.createPerson({ displayName: 'Bob Genealógico' });
  assert.ok(entities.getPerson(bob.personId), 'person seeded in vault B');

  // A third vault in databases mode with a database, column, row and cell — proving
  // the db_* tables travel in the whole-app backup like any other vault data.
  const dataVault = vaults.createVault('Datos', 'databases');
  switchTo(dataVault.id);
  assert.equal(vaults.getActiveVault().type, 'databases', 'active vault is now the databases one');
  const database = dbmode.createDatabase('Muestras');
  const col = dbmode.createColumn(database.id, 'Nombre', 'title');
  const dbRow = dbmode.createRow(database.id);
  dbmode.setCell(dbRow.id, col.id, 'Muestra 1');
  // Also seed an attachment (BLOB), a relation and a saved view so the backup is proven
  // to carry every db_* table, including binary attachments.
  const attCol = dbmode.createColumn(database.id, 'Foto', 'attachment');
  const att = dbmode.addAttachment({ rowId: dbRow.id, columnId: attCol.id, fileName: 'x.png', mimeType: 'image/png', bytes: 3, blob: Buffer.from('PNG'), contentHash: 'h1' });
  const dbRow2 = dbmode.createRow(database.id);
  dbmode.setCell(dbRow2.id, col.id, 'Muestra 2');
  const relCol = dbmode.createColumn(database.id, 'Vínculo', 'relation', { relationTargetKind: 'db_row', relationTargetDatabaseId: database.id });
  dbmode.addRelation(dbRow.id, relCol.id, 'db_row', dbRow2.id);
  dbmode.createView(database.id, { name: 'Vista X', layout: 'gallery', filter: { conjunction: 'and', conditions: [] }, sorts: [] });
  assert.equal(dbmode.databaseStats(database.id).rowCount, 2, 'rows seeded in databases vault');
  // Restore the genealogy vault as active so the backup's active matches the assertion below.
  switchTo(gene.id);

  // Back up the WHOLE app (all vaults) while the genealogy vault is active.
  const archive = await createBackupArchive({ password: 'clave-larga-de-prueba', includeSecrets: false, appVersion: '9.9.9-test' });
  assert.ok(Buffer.isBuffer(archive) && archive.length > 0, 'archive produced');

  // ── Wipe both vaults' data ──────────────────────────────────────────────────
  entities.deletePerson(bob.personId); // vault B (active)
  assert.equal(entities.getPerson(bob.personId), null, 'Bob deleted from vault B');
  switchTo(dataVault.id);
  dbmode.deleteDatabase(database.id); // databases vault
  assert.equal(dbmode.listDatabases().length, 0, 'database wiped from the databases vault');
  switchTo(legacy.id);
  entities.deletePerson(alice.personId); // vault A
  assert.equal(entities.getPerson(alice.personId), null, 'Alice deleted from vault A');

  // ── Restore the whole app from the single archive ───────────────────────────
  const result = restoreBackupArchive(archive, 'clave-larga-de-prueba');
  assert.equal(result.ok, true, `restore ok: ${result.message}`);

  // Both vaults still exist, and BOTH people are back — proving the backup was
  // integral across vault types, and the active vault was restored to the backup's.
  const ids = vaults.listVaults().map((v) => v.id).sort();
  assert.ok(ids.includes(legacy.id) && ids.includes(gene.id), 'both vaults present after restore');
  assert.equal(vaults.getActiveVault().id, gene.id, 'active vault restored to the backed-up active (genealogy)');
  assert.ok(entities.getPerson(bob.personId), 'Bob restored in the genealogy vault');

  switchTo(dataVault.id);
  const restoredDbs = dbmode.listDatabases();
  assert.equal(restoredDbs.length, 1, 'database restored in the databases vault');
  assert.equal(restoredDbs[0].name, 'Muestras');
  const restoredRows = dbmode.listRows(restoredDbs[0].id);
  assert.equal(restoredRows.length, 2, 'rows restored');
  assert.equal(restoredRows[0].cells[col.id], 'Muestra 1', 'cell value restored');
  // Attachment blob, relation and saved view survive (ids are preserved by a full-DB backup).
  const restoredBlob = dbmode.getAttachmentBlob(att.id);
  assert.ok(restoredBlob && restoredBlob.toString() === 'PNG', 'attachment blob restored from the backup');
  assert.equal(dbmode.listRelations(dbRow.id, relCol.id).length, 1, 'relation restored from the backup');
  assert.equal(dbmode.listViews(database.id).length, 1, 'saved view restored from the backup');

  switchTo(legacy.id);
  assert.ok(entities.getPerson(alice.personId), 'Alice restored in the academic vault');

  // ── A wrong password refuses cleanly ────────────────────────────────────────
  const bad = restoreBackupArchive(archive, 'contraseña-incorrecta');
  assert.equal(bad.ok, false, 'wrong password rejected');

  closeDb();
  console.log('Multi-vault backup integrity test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-test',
      getAppPath: () => repoRoot,
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (v) => Buffer.from(String(v), 'utf8'),
      decryptString: (v) => Buffer.from(v).toString('utf8'),
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
