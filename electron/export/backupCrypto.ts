import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';

const PASSWORD_BYTES = 24;
const SALT_BYTES = 16;
const IV_BYTES = 12;
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
