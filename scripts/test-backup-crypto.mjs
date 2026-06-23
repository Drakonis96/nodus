import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = await mkdtemp(path.join(tmpdir(), 'nodus-backup-crypto-'));
const require = createRequire(import.meta.url);

if (process.argv.includes('--sqlite-snapshot-test')) {
  try {
    await testOnlineSqliteSnapshot();
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
  process.exit(0);
}

try {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/tsc'),
    [
      'electron/export/backupCrypto.ts',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--outDir',
      outDir,
      '--rootDir',
      repoRoot,
      '--esModuleInterop',
      '--skipLibCheck',
    ],
    { cwd: repoRoot, stdio: 'inherit' }
  );

  const cryptoModule = await import(pathToFileURL(path.join(outDir, 'electron/export/backupCrypto.js')));
  const {
    decryptBackupPayload,
    encryptBackupPayload,
    generateBackupPassword,
    sha256Hex,
  } = cryptoModule;

  const password = generateBackupPassword();
  assert.match(password, /^(?:[A-Za-z0-9_-]{4}-){7}[A-Za-z0-9_-]{4}$/);

  const plaintext = Buffer.from('database + settings + api keys');
  const { ciphertext, metadata } = encryptBackupPayload(plaintext, password);

  assert.notDeepEqual(ciphertext, plaintext);
  assert.equal(metadata.plaintextSha256, sha256Hex(plaintext));
  assert.equal(metadata.ciphertextSha256, sha256Hex(ciphertext));
  assert.deepEqual(decryptBackupPayload(ciphertext, password, metadata), plaintext);

  assert.throws(
    () => decryptBackupPayload(ciphertext, 'wrong-password-with-enough-length', metadata),
    /Unsupported state|contraseña|descifrar|authenticate/i
  );

  const tampered = Buffer.from(ciphertext);
  tampered[0] ^= 0xff;
  assert.throws(
    () => decryptBackupPayload(tampered, password, metadata),
    /integridad/i
  );

  // better-sqlite3 is compiled for Electron's Node ABI, so run the actual
  // SQLite snapshot test under the same runtime that exports backups.
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-backup-crypto.mjs'), '--sqlite-snapshot-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
} finally {
  await rm(outDir, { recursive: true, force: true });
}

async function testOnlineSqliteSnapshot() {
  // The export path uses better-sqlite3's online backup API. Verify that an
  // active WAL is captured with every vector BLOB and the selected model config.
  const Database = require('better-sqlite3');
  const sourcePath = path.join(outDir, 'source.sqlite');
  const snapshotPath = path.join(outDir, 'snapshot.sqlite');
  const source = new Database(sourcePath);
  source.pragma('journal_mode = WAL');
  source.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE ideas (global_id TEXT PRIMARY KEY, embedding BLOB);
    CREATE TABLE work_summaries (nodus_id TEXT PRIMARY KEY, embedding BLOB);
    CREATE TABLE passages (passage_id TEXT PRIMARY KEY, embedding BLOB);
    CREATE TABLE extraction_cache (cache_key TEXT PRIMARY KEY, text TEXT NOT NULL);
  `);
  const embeddings = {
    idea: embedding([0.1, -0.2, 0.3]),
    summary: embedding([0.4, 0.5]),
    passage: embedding([-0.6, 0.7, 0.8, 0.9]),
  };
  source.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
    'app',
    JSON.stringify({ embeddingProvider: 'openrouter', embeddingModel: 'baai/bge-m3', synthesisModel: { provider: 'openai', id: 'gpt-5' } })
  );
  source.prepare('INSERT INTO ideas (global_id, embedding) VALUES (?, ?)').run('g-1', embeddings.idea);
  source.prepare('INSERT INTO work_summaries (nodus_id, embedding) VALUES (?, ?)').run('work-1', embeddings.summary);
  source.prepare('INSERT INTO passages (passage_id, embedding) VALUES (?, ?)').run('work-1#0', embeddings.passage);
  source.prepare('INSERT INTO extraction_cache (cache_key, text) VALUES (?, ?)').run('work-1', 'Texto completo ya extraído.');
  await source.backup(snapshotPath);
  source.close();

  const restored = new Database(snapshotPath, { readonly: true });
  assert.equal(restored.prepare('SELECT value FROM settings WHERE key = ?').get('app').value, JSON.stringify({ embeddingProvider: 'openrouter', embeddingModel: 'baai/bge-m3', synthesisModel: { provider: 'openai', id: 'gpt-5' } }));
  assert.deepEqual(restored.prepare('SELECT embedding FROM ideas WHERE global_id = ?').get('g-1').embedding, embeddings.idea);
  assert.deepEqual(restored.prepare('SELECT embedding FROM work_summaries WHERE nodus_id = ?').get('work-1').embedding, embeddings.summary);
  assert.deepEqual(restored.prepare('SELECT embedding FROM passages WHERE passage_id = ?').get('work-1#0').embedding, embeddings.passage);
  assert.equal(restored.prepare('SELECT text FROM extraction_cache WHERE cache_key = ?').get('work-1').text, 'Texto completo ya extraído.');
  restored.close();
}

function embedding(values) {
  return Buffer.from(new Float32Array(values).buffer);
}
