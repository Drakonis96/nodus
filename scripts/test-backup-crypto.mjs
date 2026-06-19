import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = await mkdtemp(path.join(tmpdir(), 'nodus-backup-crypto-'));

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
} finally {
  await rm(outDir, { recursive: true, force: true });
}
