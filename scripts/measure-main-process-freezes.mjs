// D0 diagnostic harness for the two main-process freeze paths.
//
// It never opens the installed profile. The parent creates an isolated NODUS_USERDATA,
// seeds eight migrated synthetic vaults with the measured shape, then runs backup and
// publication in separate Electron-as-Node processes so their RSS readings do not bleed
// into one another.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electron = path.join(repoRoot, 'node_modules/.bin/electron');
const childFlag = '--electron-main-process-perf';
const mode = process.env.NODUS_PERF_MODE;

if (!process.argv.includes(childFlag)) {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-main-process-perf-'));
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODUS_USERDATA: userData,
    NODUS_DISABLE_AUTO_UPDATE: '1',
  };
  console.log(`[perf][harness] isolatedUserData=${userData}`);
  try {
    for (const childMode of ['seed', 'backup', 'publish']) {
      execFileSync(electron, [fileURLToPath(import.meta.url), childFlag], {
        cwd: repoRoot,
        env: { ...env, NODUS_PERF_MODE: childMode },
        stdio: 'inherit',
      });
    }
  } finally {
    if (process.env.NODUS_PERF_KEEP_PROFILE === '1') {
      console.log(`[perf][harness] keptProfile=${userData}`);
    } else {
      await rm(userData, { recursive: true, force: true });
    }
  }
  process.exit(0);
}

const userData = process.env.NODUS_USERDATA;
if (!userData || !mode) throw new Error('NODUS_USERDATA and NODUS_PERF_MODE are required');
installRuntimeHooks(userData);

const Database = require('better-sqlite3');

if (mode === 'seed') {
  await seedProfile();
} else if (mode === 'backup') {
  await measureBackup();
} else if (mode === 'publish') {
  await measurePublish();
} else {
  throw new Error(`Unknown NODUS_PERF_MODE: ${mode}`);
}

async function seedProfile() {
  const vaultRegistry = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));

  // Opening once creates and migrates the legacy Principal vault through production code.
  getDb();
  closeDb();
  const targetMiB = [615, 127, 20, 20, 20, 20, 18, 18];
  for (let index = 1; index < targetMiB.length; index += 1) {
    vaultRegistry.createVault(`Sintetica ${index + 1}`, 'academic');
  }

  const vaults = vaultRegistry.listVaults();
  if (vaults.length !== targetMiB.length) throw new Error(`Expected 8 vaults, got ${vaults.length}`);
  for (let index = 0; index < vaults.length; index += 1) {
    seedVault(vaults[index].path, targetMiB[index], index === 0);
  }
  vaultRegistry.setActiveVault(vaults[0].id);
  const totalBytes = vaults.reduce((sum, vault) => sum + fs.statSync(vault.path).size, 0);
  console.log(`[perf][harness] seed:complete vaults=${vaults.length} bytes=${totalBytes} rssMiB=${rssMiB()}`);
}

function seedVault(databasePath, targetMiB, includePassages) {
  const db = new Database(databasePath);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = OFF');
    db.exec('CREATE TABLE IF NOT EXISTS perf_payload (id INTEGER PRIMARY KEY, data BLOB NOT NULL)');
    if (includePassages) seedPassages(db);

    const pageSize = Number(db.pragma('page_size', { simple: true }));
    const targetBytes = targetMiB * 1024 * 1024;
    const insert = db.prepare('INSERT INTO perf_payload (data) VALUES (?)');
    const addBatch = db.transaction((count) => {
      for (let index = 0; index < count; index += 1) insert.run(randomBytes(1024 * 1024));
    });
    while (Number(db.pragma('page_count', { simple: true })) * pageSize < targetBytes) addBatch(8);
    db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
  console.log(`[perf][harness] seed:vault path=${databasePath} bytes=${fs.statSync(databasePath).size} rssMiB=${rssMiB()}`);
}

function seedPassages(db) {
  const count = 157_442;
  const textBase = 'La memoria documental enlaza archivo, lectura, contexto y evidencia. '.repeat(7);
  const insert = db.prepare(`
    INSERT INTO passages (
      passage_id, nodus_id, chunk_index, text, page_label, char_len,
      content_hash, embedding, embedding_provider, embedding_model,
      embedding_dim, embedding_text_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?)
  `);
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    for (let index = 0; index < count; index += 1) {
      const text = `${textBase}${index}`;
      insert.run(`perf-passage-${index}`, 'perf-work', index, text, String((index % 400) + 1), text.length, `hash-${index}`, '2026-08-16T00:00:00.000Z');
    }
  })();
}

async function measureBackup() {
  const { closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { createBackupArchive, verifyBackupArchive } = require(path.join(repoRoot, 'electron/export/exportImport.ts'));
  const password = 'frase-maestra-sintetica-d0';
  const target = path.join(userData, 'd0-real-backup.nodus');
  const startedAt = process.hrtime.bigint();
  let phaseStartedAt = startedAt;
  try {
    const archive = await createBackupArchive({ password, appVersion: 'd0-perf' });
    phaseStartedAt = logHarnessBackup('archive-returned', phaseStartedAt, archive.byteLength);
    await fs.promises.writeFile(target, archive);
    phaseStartedAt = logHarnessBackup('archive-written', phaseStartedAt, archive.byteLength);
    const committedArchive = await fs.promises.readFile(target);
    phaseStartedAt = logHarnessBackup('archive-reread', phaseStartedAt, committedArchive.byteLength);
    const verification = verifyBackupArchive(committedArchive, password);
    logHarnessBackup('archive-verified', phaseStartedAt, committedArchive.byteLength);
    if (!verification.ok) throw new Error(verification.message);
    logHarnessBackup('run:complete', startedAt, committedArchive.byteLength);
  } finally {
    closeDb();
  }
}

async function measurePublish() {
  const vaultRegistry = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const { buildServerSnapshot } = require(path.join(repoRoot, 'electron/serverSync/serverSnapshot.ts'));
  const vault = vaultRegistry.getActiveVault();
  const db = new Database(vault.path, { readonly: true, fileMustExist: true });
  try {
    const built = buildServerSnapshot(
      vault,
      { nodusServerIncludeUserContent: true, nodusServerIncludePassages: true },
      db,
    );
    console.log(`[perf][harness] publish:result bytes=${built.buffer.byteLength} revision=${built.revision} rssMiB=${rssMiB()}`);
  } finally {
    db.close();
  }
}

function logHarnessBackup(phase, startedAt, bytes) {
  const endedAt = process.hrtime.bigint();
  const elapsedMs = Number(endedAt - startedAt) / 1_000_000;
  console.log(`[perf][backup] phase=harness-${phase} elapsedMs=${elapsedMs.toFixed(1)} rssMiB=${rssMiB()} bytes=${bytes}`);
  return endedAt;
}

function rssMiB() {
  return (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);
}
