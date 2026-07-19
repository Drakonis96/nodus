import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';

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
  const iv = randomBytes(IV_BYTES);
  const key = deriveKey(password, salt);
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
