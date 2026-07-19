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
  // must be present too, including teaching and the worldbuilding preview workspace.
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
  // Nodi's quick notes are user-authored Markdown living install-wide in userData,
  // exactly like the chat history beside them. They were missing from the archive.
  fs.writeFileSync(
    path.join(root, 'nodi-notes.json'),
    JSON.stringify({ version: 1, notes: [{ id: 'n1', title: 'Idea suelta', content: 'No perder esto', titleExplicit: false }] })
  );
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
  fs.rmSync(path.join(root, 'nodi-notes.json'), { force: true });

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
  assert.match(fs.readFileSync(path.join(root, 'nodi-notes.json'), 'utf8'), /No perder esto/, 'Nodi quick notes restored');

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

  // ── Machine-local paths must not travel between computers ───────────────────
  // The vault's settings row rides inside the snapshot, so a restore used to import
  // the SOURCE machine's absolute Zotero root. On a different computer (or a different
  // username) that path does not exist and every local PDF lookup fails silently —
  // the corpus text survives but nothing can be re-scanned or opened.
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  switchTo(legacy.id);
  settingsRepo.updateSettings({ zoteroStoragePath: '/Users/equipo-origen/Zotero/storage' });
  const pathArchive = await createBackupArchive({ password: 'clave-larga-de-prueba', appVersion: '9.9.9-test' });

  // Same vault on a different machine: its own Zotero root must survive the restore.
  settingsRepo.updateSettings({ zoteroStoragePath: '/Users/equipo-destino/Zotero/storage' });
  assert.equal(restoreBackupArchive(pathArchive, 'clave-larga-de-prueba').ok, true, 'restore ok');
  switchTo(legacy.id);
  assert.equal(
    settingsRepo.getSettings().zoteroStoragePath,
    '/Users/equipo-destino/Zotero/storage',
    'this machine\'s Zotero root is kept, not the archived one'
  );

  // A fresh device has no path of its own: the archived one must be dropped rather
  // than inherited, so Zotero auto-detection can find the real local library.
  settingsRepo.updateSettings({ zoteroStoragePath: '' });
  assert.equal(restoreBackupArchive(pathArchive, 'clave-larga-de-prueba').ok, true, 'restore ok on a fresh device');
  switchTo(legacy.id);
  assert.equal(settingsRepo.getSettings().zoteroStoragePath, '', 'a fresh device does not inherit a foreign Zotero root');

  // The rest of the settings row must still be restored normally.
  assert.ok(entities.getPerson(alice.personId), 'library data still restored alongside the path scrubbing');

  // ── The path the app actually uses: restore WITH a safety snapshot ──────────
  // `importData` and `restoreRecoverySnapshot` both go through this, and it had no
  // coverage at all — the rollback that protects a failed restore had never been run.
  const { restoreBackupArchiveSafely } = require(path.join(repoRoot, 'electron/export/exportImport.ts'));
  switchTo(gene.id);
  const safeArchive = await createBackupArchive({ password: 'clave-larga-de-prueba', appVersion: '9.9.9-test' });
  entities.deletePerson(bob.personId);
  assert.equal(entities.getPerson(bob.personId), null, 'Bob deleted again before the safe restore');

  const safeResult = await restoreBackupArchiveSafely(safeArchive, 'clave-larga-de-prueba', '9.9.9-test');
  assert.equal(safeResult.ok, true, `safe restore ok: ${safeResult.message}`);
  assert.ok(safeResult.safetyBackupPath && fs.existsSync(safeResult.safetyBackupPath), 'a pre-restore snapshot is retained');
  switchTo(gene.id);
  assert.ok(entities.getPerson(bob.personId), 'Bob restored through the safe path');

  // ── A restore that fails mid-swap must not destroy a vault ──────────────────
  // The old code deleted the live database and then copied the replacement over it, so
  // any failure in between (disk full, volume unmounted) left a truncated file where a
  // vault used to be — and the rollback hit the very same wall. The copy now lands on a
  // sibling and is renamed into place, so an interrupted restore leaves the vault whole.
  // Fault injection: the write of the replacement database fails. A read-only directory
  // is NOT enough to reproduce this — it blocks the delete too, so the vault survives by
  // accident. The hazard is specifically "delete succeeded, then the write failed", so
  // the copy itself is made to throw.
  const victim = extraVaults[0].vault;
  const victimDir = path.dirname(victim.path);
  const victimBytesBefore = fs.readFileSync(victim.path).length;
  switchTo(gene.id);
  const realCopyFileSync = fs.copyFileSync;
  fs.copyFileSync = (src, dest, ...rest) => {
    if (String(dest).startsWith(victim.path)) {
      const error = new Error('ENOSPC: no space left on device (simulado)');
      error.code = 'ENOSPC';
      throw error;
    }
    return realCopyFileSync(src, dest, ...rest);
  };
  let failed;
  try {
    failed = await restoreBackupArchiveSafely(safeArchive, 'clave-larga-de-prueba', '9.9.9-test');
  } finally {
    fs.copyFileSync = realCopyFileSync;
  }
  assert.equal(failed.ok, false, 'a restore that cannot write a vault reports failure');
  assert.ok(fs.existsSync(victim.path), 'the vault database still exists after a failed restore');
  assert.equal(fs.readFileSync(victim.path).length, victimBytesBefore, 'the vault database is intact, not truncated');
  const probe = new (require('better-sqlite3'))(victim.path, { readonly: true, fileMustExist: true });
  try {
    assert.equal(probe.pragma('quick_check', { simple: true }), 'ok', 'the surviving database is not corrupt');
  } finally {
    probe.close();
  }
  assert.equal(fs.readdirSync(victimDir).filter((name) => name.includes('.incoming-')).length, 0, 'no staging file is left behind');
  // The library still works after the failed attempt.
  switchTo(gene.id);
  assert.ok(entities.getPerson(bob.personId), 'the genealogy vault still reads after the failed restore');

  // ── Deletions must survive a backup round trip ──────────────────────────────
  // A tombstone is what stops a deleted row from being re-inserted by the next sync.
  // If a restore lost them, every deletion made before the backup would come back the
  // first time the other machine synced — the exact bug tombstones exist to prevent.
  switchTo(gene.id);
  const doomed = entities.createPerson({ displayName: 'Se borrará' });
  entities.deletePerson(doomed.personId);
  const tombstoneRows = getDb().prepare('SELECT table_name, row_key FROM sync_tombstones').all();
  assert.ok(tombstoneRows.length > 0, 'deleting through the real repository wrote a tombstone');

  const tombArchive = await createBackupArchive({ password: 'clave-larga-de-prueba', appVersion: '9.9.9-test' });
  getDb().prepare('DELETE FROM sync_tombstones').run();
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM sync_tombstones').get().n, 0, 'tombstones cleared before the restore');
  assert.equal(restoreBackupArchive(tombArchive, 'clave-larga-de-prueba').ok, true, 'restore ok');
  switchTo(gene.id);
  assert.deepEqual(
    getDb().prepare('SELECT table_name, row_key FROM sync_tombstones').all(),
    tombstoneRows,
    'the backup carried the deletions and the restore put them back'
  );
  assert.equal(entities.getPerson(doomed.personId), null, 'and the deleted person did not come back with it');

  // ── Schema compatibility across an app upgrade ──────────────────────────────
  // Every schema bump splits the world into installs that can read a backup and installs
  // that cannot. Both directions have to be safe: an older archive must still restore,
  // and a NEWER one must be refused outright rather than applied without the columns
  // this build does not know — a half-applied restore is how a library gets shredded.
  const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const compatArchive = await createBackupArchive({ password: 'clave-larga-de-prueba', appVersion: '9.9.9-test' });

  const rewriteSchemaVersion = (archiveBuffer, version) => {
    const zipped = new AdmZip(archiveBuffer);
    const outer = JSON.parse(zipped.readAsText('manifest.json'));
    outer.schemaVersion = version;
    zipped.updateFile('manifest.json', Buffer.from(JSON.stringify(outer)));
    return zipped.toBuffer();
  };

  switchTo(gene.id);
  const canaryBefore = entities.getPerson(bob.personId);
  assert.ok(canaryBefore, 'data present before the compatibility checks');

  const fromFuture = restoreBackupArchive(rewriteSchemaVersion(compatArchive, SCHEMA_VERSION + 1), 'clave-larga-de-prueba');
  assert.equal(fromFuture.ok, false, 'a backup from a newer schema is refused');
  assert.match(fromFuture.message, /esquema más reciente/, 'and says why, so the user knows to update');
  switchTo(gene.id);
  assert.ok(entities.getPerson(bob.personId), 'the refusal left the live data untouched');

  // An archive from an older schema still restores: its database simply migrates on open.
  const fromPast = restoreBackupArchive(rewriteSchemaVersion(compatArchive, SCHEMA_VERSION - 1), 'clave-larga-de-prueba');
  assert.equal(fromPast.ok, true, `an older archive still restores: ${fromPast.message}`);
  switchTo(gene.id);
  assert.ok(entities.getPerson(bob.personId), 'and its contents are intact');

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
