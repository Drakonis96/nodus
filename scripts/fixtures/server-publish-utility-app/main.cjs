/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, utilityProcess } = require('electron');

const repoRoot = process.env.NODUS_REPO_ROOT;
if (!repoRoot) throw new Error('NODUS_REPO_ROOT is required');
const Database = require(path.join(repoRoot, 'node_modules/better-sqlite3'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-real-publish-utility-'));
app.setPath('userData', root);

void app.whenReady().then(async () => {
  let db;
  let child;
  let failed = false;
  try {
    const databasePath = path.join(root, 'vault.sqlite');
    db = new Database(databasePath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE passages (
        passage_id TEXT PRIMARY KEY, nodus_id TEXT NOT NULL, chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL, page_label TEXT, char_len INTEGER NOT NULL, content_hash TEXT NOT NULL,
        embedding BLOB, embedding_provider TEXT, embedding_model TEXT, embedding_dim INTEGER,
        embedding_text_hash TEXT, created_at TEXT NOT NULL
      )
    `);
    const text = 'publicación aislada '.repeat(40);
    const insert = db.prepare(`INSERT INTO passages (
      passage_id, nodus_id, chunk_index, text, page_label, char_len, content_hash, created_at
    ) VALUES (?, 'work', ?, ?, '1', ?, ?, '2026-08-16T00:00:00.000Z')`);
    db.transaction(() => {
      for (let index = 0; index < 50_000; index += 1) insert.run(`p-${index}`, index, text, text.length, `h-${index}`);
    })();
    db.pragma('wal_checkpoint(PASSIVE)');

    const workerFile = path.join(repoRoot, 'dist-electron/serverPublishWorker.js');
    assert.ok(fs.existsSync(workerFile), 'vite did not emit the server publish utility entry');
    child = utilityProcess.fork(workerFile, [], { serviceName: 'Nodus publish verifier', stdio: 'inherit' });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('exit', (code) => reject(new Error(`utility process exited before spawn (${code})`)));
    });
    const childPid = child.pid;
    assert.ok(childPid && childPid !== process.pid, 'utility work must run in a distinct process');
    let ticks = 0;
    const heartbeat = setInterval(() => { ticks += 1; }, 10);
    const result = await new Promise((resolve, reject) => {
      child.once('message', resolve);
      child.once('exit', (code) => reject(new Error(`utility process exited early (${code})`)));
      child.once('error', (type, location) => reject(new Error(`${type} at ${location}`)));
      child.postMessage({
        kind: 'build', id: 1, vaultPath: databasePath,
        vault: { id: 'v1', name: 'Sintética', type: 'academic', path: databasePath, active: true, legacy: true },
        settings: { nodusServerIncludeUserContent: false, nodusServerIncludePassages: true },
        library: null, vectorKinds: [],
      });
    });
    clearInterval(heartbeat);
    assert.equal(result.kind, 'done', result.error || 'worker did not finish');
    assert.equal(result.counts.passages, 50_000);
    assert.ok(result.rawBytes > 30 * 1024 * 1024, `snapshot unexpectedly small: ${result.rawBytes}`);
    assert.ok(ticks > 0, 'main-process heartbeat did not advance while the utility process built the snapshot');
    console.log(`[verify][publish-utility] childPid=${childPid} rawBytes=${result.rawBytes} compressedBytes=${result.compressed.byteLength} mainHeartbeatTicks=${ticks}`);
  } catch (error) {
    console.error(error);
    failed = true;
  } finally {
    child?.kill();
    db?.close();
    fs.rmSync(root, { recursive: true, force: true });
    app.exit(failed ? 1 : 0);
  }
});
