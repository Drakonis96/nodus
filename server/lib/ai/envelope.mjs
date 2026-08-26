import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const ENVELOPE_VERSION = 1;
export const ENVELOPE_ALGORITHM = 'A256GCM';
const KEY_BYTES = 32;
const IV_BYTES = 12;

export class EnvelopeError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'EnvelopeError';
    this.code = options.code ?? 'INVALID_ENVELOPE';
  }
}

function bytes(value, label) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  throw new TypeError(`${label} must be a string or byte array.`);
}

function encoded(value) {
  return Buffer.from(value).toString('base64url');
}

function decoded(value, label) {
  if (typeof value !== 'string' || !value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new EnvelopeError(`Invalid ${label}.`);
  try {
    const output = Buffer.from(value, 'base64url');
    if (!output.length) throw new Error('empty');
    if (output.toString('base64url') !== value) throw new Error('non-canonical');
    return output;
  } catch {
    throw new EnvelopeError(`Invalid ${label}.`);
  }
}

function key(value) {
  const output = bytes(value, 'Key');
  if (output.length !== KEY_BYTES) throw new EnvelopeError('Envelope keys must be 32 bytes.', { code: 'INVALID_KEY' });
  return output;
}

function keyFor(keyring, keyId) {
  if (!keyring || typeof keyring.getKey !== 'function') {
    throw new EnvelopeError('A keyring is required.', { code: 'MISSING_KEK' });
  }
  try {
    return key(keyring.getKey(keyId));
  } catch (error) {
    if (error instanceof EnvelopeError) throw error;
    throw new EnvelopeError('The envelope key is unavailable.', { code: 'MISSING_KEK', cause: error });
  }
}

function wrapAad(keyId, aad) {
  return Buffer.concat([Buffer.from('nodus-envelope-wrap-v1:', 'utf8'), Buffer.from(String(keyId), 'utf8'), Buffer.from('\0', 'utf8'), aad]);
}

function encryptWith(keyBytes, plaintext, iv, aad) {
  const cipher = createCipheriv('aes-256-gcm', keyBytes, iv);
  cipher.setAAD(aad);
  return { ciphertext: Buffer.concat([cipher.update(plaintext), cipher.final()]), tag: cipher.getAuthTag() };
}

function decryptWith(keyBytes, ciphertext, iv, tag, aad) {
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyBytes, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    throw new EnvelopeError('Envelope authentication failed.', { code: 'AUTHENTICATION_FAILED', cause: error });
  }
}

/** Encrypt plaintext with a fresh data-encryption key wrapped by the active KEK. */
export function encryptEnvelope(plaintext, { keyring, aad = '' } = {}) {
  const data = bytes(plaintext, 'Plaintext');
  const associatedData = bytes(aad, 'AAD');
  if (!keyring || typeof keyring.activeKeyId !== 'function') {
    throw new EnvelopeError('A keyring is required.', { code: 'MISSING_KEK' });
  }
  const keyId = keyring.activeKeyId();
  if (typeof keyId !== 'string' || !keyId) throw new EnvelopeError('The keyring has no active key.', { code: 'MISSING_KEK' });
  const kek = keyFor(keyring, keyId);
  const dataKey = randomBytes(KEY_BYTES);
  const dataIv = randomBytes(IV_BYTES);
  const encrypted = encryptWith(dataKey, data, dataIv, associatedData);
  const wrappedIv = randomBytes(IV_BYTES);
  const wrapped = encryptWith(kek, dataKey, wrappedIv, wrapAad(keyId, associatedData));
  return {
    version: ENVELOPE_VERSION,
    algorithm: ENVELOPE_ALGORITHM,
    keyId,
    iv: encoded(dataIv),
    tag: encoded(encrypted.tag),
    ciphertext: encoded(encrypted.ciphertext),
    wrappedKey: encoded(wrapped.ciphertext),
    wrappedIv: encoded(wrappedIv),
    wrappedTag: encoded(wrapped.tag),
  };
}

/** Decrypt an envelope. Authentication covers both the payload and its exact AAD. */
export function decryptEnvelope(envelope, { keyring, aad = '' } = {}) {
  if (!envelope || typeof envelope !== 'object' || envelope.version !== ENVELOPE_VERSION || envelope.algorithm !== ENVELOPE_ALGORITHM) {
    throw new EnvelopeError('Unsupported or malformed envelope.');
  }
  const associatedData = bytes(aad, 'AAD');
  const keyId = envelope.keyId;
  if (typeof keyId !== 'string' || !keyId) throw new EnvelopeError('Envelope key ID is missing.');
  const kek = keyFor(keyring, keyId);
  const dataKey = decryptWith(
    kek,
    decoded(envelope.wrappedKey, 'wrapped key'),
    decoded(envelope.wrappedIv, 'wrapped IV'),
    decoded(envelope.wrappedTag, 'wrapped tag'),
    wrapAad(keyId, associatedData),
  );
  if (dataKey.length !== KEY_BYTES) throw new EnvelopeError('Invalid wrapped data key.');
  return decryptWith(
    dataKey,
    decoded(envelope.ciphertext, 'ciphertext'),
    decoded(envelope.iv, 'IV'),
    decoded(envelope.tag, 'authentication tag'),
    associatedData,
  );
}

/** Re-encrypt without exposing the decrypted data to the caller. */
export function rewrapEnvelope(envelope, options = {}) {
  return encryptEnvelope(decryptEnvelope(envelope, options), options);
}
