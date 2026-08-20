import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const PASSWORD_BYTES = 24;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export interface BackupCipherMetadata {
  formatVersion: 1;
  algorithm: 'aes-256-gcm';
  kdf: {
    name: 'scrypt';
    salt: string;
    keyLength: number;
    N: number;
    r: number;
    p: number;
  };
  iv: string;
  authTag: string;
  plaintextSha256: string;
  ciphertextSha256: string;
}

export function generateBackupPassword(): string {
  const raw = randomBytes(PASSWORD_BYTES).toString('base64url');
  return raw.match(/.{1,4}/g)?.join('-') ?? raw;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function cleanPassword(password: string): string {
  return password.trim();
}

/** Backups may be keyed by a user-chosen master password, so the floor is a
 * usability minimum (UI enforces it at set time); scrypt provides the actual
 * brute-force resistance. Generated one-off passwords remain ~32 chars. */
export const MIN_BACKUP_PASSWORD_LENGTH = 8;

function deriveKey(password: string, salt: Buffer): Buffer {
  const clean = cleanPassword(password);
  if (clean.length < MIN_BACKUP_PASSWORD_LENGTH) {
    throw new Error('La contraseña de la copia de seguridad no es válida.');
  }
  return scryptSync(clean, salt, KEY_BYTES, {
    cost: SCRYPT_N,
    blockSize: SCRYPT_R,
    parallelization: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
}

/**
 * scrypt on libuv's threadpool instead of the main thread. Same parameters and
 * same key as {@link deriveKey}; only the scheduling differs. Used by the write
 * path, which runs unattended every 30 minutes and must not stall the app.
 */
function deriveKeyAsync(password: string, salt: Buffer): Promise<Buffer> {
  const clean = cleanPassword(password);
  if (clean.length < MIN_BACKUP_PASSWORD_LENGTH) {
    return Promise.reject(new Error('La contraseña de la copia de seguridad no es válida.'));
  }
  return new Promise((resolve, reject) => {
    scrypt(
      clean,
      salt,
      KEY_BYTES,
      { cost: SCRYPT_N, blockSize: SCRYPT_R, parallelization: SCRYPT_P, maxmem: SCRYPT_MAXMEM },
      (err, key) => (err ? reject(err) : resolve(key as Buffer))
    );
  });
}

export type KdfDescriptor = BackupCipherMetadata['kdf'];

/**
 * Derive the key ONCE for a payload made of many separately-encrypted pieces.
 *
 * The sync package encrypts each table and each attachment as its own zip entry, so that
 * no point in the process holds the whole package as a single buffer — that is what made
 * large vaults impossible to sync. Running scrypt per entry would cost ~100 ms each and
 * turn a 500-entry package into a minute of waiting, so the salt is stored once in the
 * manifest and the derived key is reused across entries with a fresh IV per entry.
 */
export function newKdfDescriptor(): KdfDescriptor {
  return {
    name: 'scrypt',
    salt: randomBytes(SALT_BYTES).toString('base64'),
    keyLength: KEY_BYTES,
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  };
}

export function deriveKeyFromDescriptor(password: string, kdf: KdfDescriptor): Buffer {
  if (kdf.name !== 'scrypt') throw new Error('Formato de cifrado no soportado.');
  const clean = cleanPassword(password);
  if (clean.length < MIN_BACKUP_PASSWORD_LENGTH) {
    throw new Error('La contraseña no es válida.');
  }
  return scryptSync(clean, Buffer.from(kdf.salt, 'base64'), kdf.keyLength, {
    cost: kdf.N,
    blockSize: kdf.r,
    parallelization: kdf.p,
    maxmem: SCRYPT_MAXMEM,
  });
}

/** One self-contained encrypted chunk: `IV ‖ authTag ‖ ciphertext`. Each chunk carries
 *  its own IV, which is mandatory — reusing an IV under one key breaks GCM entirely. */
export function encryptWithKey(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptWithKey(sealed: Buffer, key: Buffer): Buffer {
  if (sealed.length < IV_BYTES + AUTH_TAG_BYTES) throw new Error('Fragmento cifrado incompleto.');
  const iv = sealed.subarray(0, IV_BYTES);
  const authTag = sealed.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(sealed.subarray(IV_BYTES + AUTH_TAG_BYTES)), decipher.final()]);
}

export function encryptBackupPayload(plaintext: Buffer, password: string): { ciphertext: Buffer; metadata: BackupCipherMetadata } {
  const salt = randomBytes(SALT_BYTES);
  return sealPayload(plaintext, deriveKey(password, salt), salt);
}

/** {@link encryptBackupPayload} with the key derivation moved off the event loop. */
export async function encryptBackupPayloadAsync(
  plaintext: Buffer,
  password: string
): Promise<{ ciphertext: Buffer; metadata: BackupCipherMetadata }> {
  const salt = randomBytes(SALT_BYTES);
  return sealPayload(plaintext, await deriveKeyAsync(password, salt), salt);
}

/** Encrypt a payload file without materialising either plaintext or ciphertext in RAM. */
export async function encryptBackupPayloadFile(
  sourcePath: string,
  targetPath: string,
  password: string,
): Promise<BackupCipherMetadata> {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKeyAsync(password, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintextHash = createHash('sha256');
  const ciphertextHash = createHash('sha256');
  const hashPlaintext = new Transform({
    transform(chunk, _encoding, callback) {
      plaintextHash.update(chunk);
      callback(null, chunk);
    },
  });
  const hashCiphertext = new Transform({
    transform(chunk, _encoding, callback) {
      ciphertextHash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    fs.createReadStream(sourcePath),
    hashPlaintext,
    cipher,
    hashCiphertext,
    fs.createWriteStream(targetPath, { flags: 'wx' }),
  );
  return {
    formatVersion: 1,
    algorithm: 'aes-256-gcm',
    kdf: {
      name: 'scrypt', salt: salt.toString('base64'), keyLength: KEY_BYTES,
      N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P,
    },
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    plaintextSha256: plaintextHash.digest('hex'),
    ciphertextSha256: ciphertextHash.digest('hex'),
  };
}

/** Decrypt an authenticated backup entry to a temporary file with bounded RAM.
 * Plaintext is written before GCM's final authentication check, so callers must
 * only use the file after this promise resolves; every failure removes it. */
export async function decryptBackupPayloadStream(
  ciphertext: Readable,
  targetPath: string,
  password: string,
  metadata: BackupCipherMetadata,
  onProgress?: (completedBytes: number) => void,
): Promise<void> {
  if (metadata.formatVersion !== 1 || metadata.algorithm !== 'aes-256-gcm' || metadata.kdf.name !== 'scrypt') {
    throw new Error('Formato de cifrado no soportado.');
  }
  const salt = Buffer.from(metadata.kdf.salt, 'base64');
  const iv = Buffer.from(metadata.iv, 'base64');
  const authTag = Buffer.from(metadata.authTag, 'base64');
  const key = await deriveKeyAsync(password, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const ciphertextHash = createHash('sha256');
  const plaintextHash = createHash('sha256');
  let completedBytes = 0;
  const hashCiphertext = new Transform({
    transform(chunk, _encoding, callback) {
      ciphertextHash.update(chunk);
      completedBytes += Buffer.byteLength(chunk);
      onProgress?.(completedBytes);
      callback(null, chunk);
    },
  });
  const hashPlaintext = new Transform({
    transform(chunk, _encoding, callback) {
      plaintextHash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      ciphertext,
      hashCiphertext,
      decipher,
      hashPlaintext,
      fs.createWriteStream(targetPath, { flags: 'wx', mode: 0o600 }),
    );
    if (ciphertextHash.digest('hex') !== metadata.ciphertextSha256) {
      throw new Error('La copia de seguridad no supera la verificación de integridad.');
    }
    if (plaintextHash.digest('hex') !== metadata.plaintextSha256) {
      throw new Error('El contenido descifrado no coincide con el hash esperado.');
    }
  } catch (error) {
    await fs.promises.rm(targetPath, { force: true });
    throw error;
  }
}

function sealPayload(plaintext: Buffer, key: Buffer, salt: Buffer): { ciphertext: Buffer; metadata: BackupCipherMetadata } {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext,
    metadata: {
      formatVersion: 1,
      algorithm: 'aes-256-gcm',
      kdf: {
        name: 'scrypt',
        salt: salt.toString('base64'),
        keyLength: KEY_BYTES,
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
      },
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      plaintextSha256: sha256Hex(plaintext),
      ciphertextSha256: sha256Hex(ciphertext),
    },
  };
}

export function decryptBackupPayload(ciphertext: Buffer, password: string, metadata: BackupCipherMetadata): Buffer {
  if (metadata.formatVersion !== 1 || metadata.algorithm !== 'aes-256-gcm' || metadata.kdf.name !== 'scrypt') {
    throw new Error('Formato de cifrado no soportado.');
  }
  if (sha256Hex(ciphertext) !== metadata.ciphertextSha256) {
    throw new Error('La copia de seguridad no supera la verificación de integridad.');
  }

  const salt = Buffer.from(metadata.kdf.salt, 'base64');
  const iv = Buffer.from(metadata.iv, 'base64');
  const authTag = Buffer.from(metadata.authTag, 'base64');
  const key = deriveKey(password, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  if (sha256Hex(plaintext) !== metadata.plaintextSha256) {
    throw new Error('El contenido descifrado no coincide con el hash esperado.');
  }
  return plaintext;
}
