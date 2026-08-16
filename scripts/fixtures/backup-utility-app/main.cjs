const { app, utilityProcess } = require('electron');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

process.env.NODE_PATH = [process.env.NODUS_REPO_NODE_MODULES, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
Module._initPaths();
const Database = require('better-sqlite3');

app.whenReady().then(async () => {
  const root = process.env.NODUS_BACKUP_UTILITY_TMP;
  const sourcePath = path.join(root, 'source.sqlite');
  const targetPath = path.join(root, 'snapshot.sqlite');
  const cacheDir = path.join(root, 'cache');
  const invalidPath = path.join(root, 'invalid.nodus');
  const db = new Database(sourcePath);
  db.exec(`
    CREATE TABLE backup_revision (singleton INTEGER PRIMARY KEY, sequence INTEGER NOT NULL);
    INSERT INTO backup_revision VALUES (1, 1);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO settings VALUES ('app', '{}');
    CREATE TABLE payload (id INTEGER PRIMARY KEY, bytes BLOB);
    INSERT INTO payload(bytes) VALUES (zeroblob(67108864));
    PRAGMA user_version=134;
  `);
  db.close();
  fs.writeFileSync(invalidPath, 'not a backup');

  const child = utilityProcess.fork(process.env.NODUS_BACKUP_UTILITY_WORKER, [], { stdio: 'inherit' });
  let heartbeats = 0;
  const timer = setInterval(() => { heartbeats += 1; }, 5);
  const request = (message) => new Promise((resolve, reject) => {
    const onMessage = (response) => {
      if (response.id !== message.id) return;
      child.off('message', onMessage);
      response.kind === 'error' ? reject(new Error(response.error)) : resolve(response);
    };
    child.on('message', onMessage);
    child.postMessage(message);
  });
  try {
    const snapshot = await request({ kind: 'snapshot', id: 1, sourcePath, targetPath, cacheDir, vaultId: 'synthetic' });
    const check = new Database(targetPath, { readonly: true, fileMustExist: true });
    const quickCheck = check.pragma('quick_check', { simple: true });
    const bytes = check.prepare('SELECT length(bytes) AS bytes FROM payload').get().bytes;
    check.close();
    const verify = await request({ kind: 'verify', id: 2, archivePath: invalidPath, password: 'contraseña-larga', schemaVersion: 134 });
    clearInterval(timer);
    process.stdout.write(`${JSON.stringify({ mainPid: process.pid, childPid: child.pid, heartbeats, quickCheck, bytes, snapshotKind: snapshot.kind, verify })}\n`);
    child.kill();
    app.quit();
  } catch (error) {
    clearInterval(timer);
    child.kill();
    process.stderr.write(`${error.stack || error}\n`);
    app.exit(1);
  }
});
