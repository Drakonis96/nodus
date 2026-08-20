import assert from 'node:assert/strict';
import { createHash, randomFillSync } from 'node:crypto';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
installRuntimeHooks(repoRoot);

test('large backup manifests and payloads are verified from file streams', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-backup-streaming-'));
  const sourcePath = path.join(root, 'large.sqlite');
  const payloadPath = path.join(root, 'payload.zip');
  const ciphertextPath = path.join(root, 'backup.bin');
  const archivePath = path.join(root, 'large.nodus');
  const password = 'streaming-regression-password';
  const sourceBytes = 32 * 1024 * 1024;

  try {
    const source = fs.openSync(sourcePath, 'wx', 0o600);
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    const hash = createHash('sha256');
    try {
      for (let offset = 0; offset < sourceBytes; offset += chunk.byteLength) {
        randomFillSync(chunk);
        hash.update(chunk);
        fs.writeSync(source, chunk);
      }
    } finally {
      fs.closeSync(source);
    }

    const { StreamingZipWriter } = require(path.join(repoRoot, 'electron/export/streamingZip.ts'));
    const { encryptBackupPayloadFile } = require(path.join(repoRoot, 'electron/export/backupCrypto.ts'));
    const { readZipEntrySync } = require(path.join(repoRoot, 'electron/export/zipFile.ts'));
    const { verifyBackupFile } = require(path.join(repoRoot, 'electron/export/backupVerificationCore.ts'));

    const payload = new StreamingZipWriter(payloadPath, 6);
    await payload.addFile('vaults/v1/database.sqlite', sourcePath);
    await payload.addBuffer('payload-manifest.json', Buffer.from(JSON.stringify({
      schemaVersion: 153,
      files: {
        'vaults/v1/database.sqlite': { sha256: hash.digest('hex'), bytes: sourceBytes },
      },
      vaults: [{ id: 'v1', name: 'Streaming regression vault', dbFile: 'vaults/v1/database.sqlite' }],
    })));
    await payload.finalize();

    const cipher = await encryptBackupPayloadFile(payloadPath, ciphertextPath, password);
    const outerManifest = {
      format: 'nodus.encrypted-backup',
      formatVersion: 5,
      schemaVersion: 153,
      appVersion: 'test',
      date: new Date(0).toISOString(),
      cipher,
      vaultCount: 1,
      includesSecrets: false,
    };
    const outer = new StreamingZipWriter(archivePath, 0);
    await outer.addBuffer('manifest.json', Buffer.from(JSON.stringify(outerManifest)), true);
    await outer.addFile('backup.bin', ciphertextPath, true);
    await outer.finalize();
    assert.ok(fs.statSync(archivePath).size > 30 * 1024 * 1024, 'fixture must remain large enough to expose whole-file reads');

    const originalReadFileSync = fs.readFileSync;
    const originalReadFile = fs.promises.readFile;
    const forbidden = (file) => {
      const name = typeof file === 'string' ? file : file instanceof URL ? fileURLToPath(file) : '';
      return path.resolve(name) === archivePath || path.basename(name) === 'payload.zip';
    };
    fs.readFileSync = function patchedReadFileSync(file, ...args) {
      if (forbidden(file)) throw new Error(`whole-file sync read forbidden: ${file}`);
      return originalReadFileSync.call(this, file, ...args);
    };
    fs.promises.readFile = async function patchedReadFile(file, ...args) {
      if (forbidden(file)) throw new Error(`whole-file async read forbidden: ${file}`);
      return originalReadFile.call(this, file, ...args);
    };
    try {
      const manifest = readZipEntrySync(archivePath, 'manifest.json', 1024 * 1024);
      assert.deepEqual(JSON.parse(manifest.toString('utf8')), outerManifest);
      const verified = await verifyBackupFile(archivePath, password, 153);
      assert.equal(verified.ok, true, verified.message);
    } finally {
      fs.readFileSync = originalReadFileSync;
      fs.promises.readFile = originalReadFile;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
