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
  const { decryptBackupPayload } = require(path.join(repoRoot, 'electron/export/backupCrypto.ts'));
  const AdmZip = require('adm-zip');

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

  // Every other selectable vault type uses the same complete SQLite contract and
  // must be present too, including the two preview workspaces.
  const extraVaults = [];
  for (const [name, type] of [['Estudio', 'estudio'], ['Mundo', 'worldbuilding'], ['Docencia', 'docencia']]) {
    const vault = vaults.createVault(name, type);
    switchTo(vault.id);
    const person = entities.createPerson({ displayName: `Dato ${name}` });
    extraVaults.push({ vault, person });
  }
  const studyVault = extraVaults.find((item) => item.vault.type === 'estudio').vault;
  const studyDir = path.dirname(studyVault.path);
  fs.writeFileSync(path.join(studyDir, 'study-chat-history.json'), JSON.stringify([{ text: 'historial estudio' }]));
  fs.mkdirSync(path.join(studyDir, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(studyDir, 'audio', 'lesson.wav'), Buffer.from('STUDY-AUDIO'));
  // Restore the genealogy vault as active so the backup's active matches the assertion below.
  switchTo(gene.id);

  // Back up the WHOLE app (all vaults) while the genealogy vault is active.
  const archive = await createBackupArchive({ password: 'clave-larga-de-prueba', appVersion: '9.9.9-test' });
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
  for (const item of extraVaults) {
    switchTo(item.vault.id);
    entities.deletePerson(item.person.personId);
  }
  fs.rmSync(path.join(studyDir, 'study-chat-history.json'), { force: true });
  fs.rmSync(path.join(studyDir, 'audio'), { recursive: true, force: true });

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
  for (const item of extraVaults) {
    switchTo(item.vault.id);
    assert.ok(entities.getPerson(item.person.personId), `${item.vault.type} vault data restored`);
  }
  assert.match(fs.readFileSync(path.join(studyDir, 'study-chat-history.json'), 'utf8'), /historial estudio/, 'study history restored');
  assert.equal(fs.readFileSync(path.join(studyDir, 'audio', 'lesson.wav'), 'utf8'), 'STUDY-AUDIO', 'study generated audio restored');

  // Full-state scope is enforced in the main process. Even a stale/hostile caller
  // passing the removed legacy selection cannot exclude vaults or auxiliary data.
  const scoped = await createBackupArchive({
    password: 'clave-de-seleccion',
    appVersion: '9.9.9-test',
    selection: { vaultIds: [gene.id], includePreferences: false, includeHistories: false, includeGeneratedMedia: false, includeApiKeys: false },
  });
  const scopedZip = new AdmZip(scoped);
  const scopedManifest = JSON.parse(scopedZip.readAsText('manifest.json'));
  assert.equal(scopedManifest.vaultCount, vaults.listVaults().length, 'legacy selection cannot reduce the protected vault set');
  const scopedPayload = new AdmZip(decryptBackupPayload(scopedZip.getEntry('backup.bin').getData(), 'clave-de-seleccion', scopedManifest.cipher));
  const scopedRegistry = JSON.parse(scopedPayload.readAsText('registry.json'));
  assert.deepEqual(new Set(scopedRegistry.vaults.map((vault) => vault.id)), new Set(vaults.listVaults().map((vault) => vault.id)), 'every vault remains in the payload');
  assert.equal(scopedPayload.getEntries().some((entry) => entry.entryName.startsWith('aux/')), true, 'legacy exclusions cannot omit auxiliary data');

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
