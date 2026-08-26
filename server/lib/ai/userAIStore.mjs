import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { decryptEnvelope, encryptEnvelope, rewrapEnvelope } from './envelope.mjs';
import { FileKeyring } from './keyring.mjs';
import { redactStructured } from './redact.mjs';

export const AI_STORE_VERSION = 1;

function idPart(value, label) {
  const output = String(value ?? '').trim();
  if (!output || output.length > 256 || /[\u0000\r\n]/.test(output)) throw new TypeError(`Invalid ${label}.`);
  return output;
}

function aadFor(installationId, userId, provider) {
  return `nodus-ai-credential:v1:${installationId}:${userId}:${provider}`;
}

function writeJson(file, value) {
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  try { fs.chmodSync(temporary, 0o600); } catch { /* Windows */ }
  fs.renameSync(temporary, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
}

function emptyState() {
  return { version: AI_STORE_VERSION, users: {} };
}

/**
 * Persistent per-user AI credentials. The only API that supplies a secret is
 * `withUserCredential`; all other methods return metadata or redacted data.
 */
export class UserAIStore {
  constructor(root, { keyring = null, keyringPath = null, fileName = 'ai-credentials.json', createKeyring = false, installationId = 'legacy-installation' } = {}) {
    if (!root) throw new TypeError('A credential store directory is required.');
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.file = path.join(this.root, fileName);
    this.installationId = idPart(installationId, 'installation ID');
    this.keyring = keyring ?? new FileKeyring(keyringPath ?? path.join(this.root, 'ai-keyring.json'), { create: createKeyring });
    this.state = this.#read();
  }

  #read() {
    if (!fs.existsSync(this.file)) return emptyState();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (parsed?.version !== AI_STORE_VERSION || !parsed.users || typeof parsed.users !== 'object' || Array.isArray(parsed.users)) throw new Error('invalid store format');
      return parsed;
    } catch (error) {
      throw new Error(`Could not read ${this.file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  #save() {
    writeJson(this.file, this.state);
  }

  #metadata(userId, provider, entry) {
    return { userId, provider, keyId: entry.envelope.keyId, updatedAt: entry.updatedAt, createdAt: entry.createdAt };
  }

  setUserCredential(userIdValue, providerValue, credential) {
    const userId = idPart(userIdValue, 'user ID');
    const provider = idPart(providerValue, 'provider');
    let serialized;
    try {
      serialized = JSON.stringify(credential);
      if (serialized === undefined) throw new Error('undefined is not JSON serializable');
    } catch (error) {
      throw new TypeError(`Credential must be JSON serializable: ${error instanceof Error ? error.message : String(error)}`);
    }
    const prior = this.state.users[userId]?.[provider];
    const now = new Date().toISOString();
    const plaintext = Buffer.from(serialized, 'utf8');
    let envelope;
    try { envelope = encryptEnvelope(plaintext, { keyring: this.keyring, aad: aadFor(this.installationId, userId, provider) }); }
    finally { plaintext.fill(0); serialized = ''; }
    const entry = {
      envelope,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
    };
    this.state.users[userId] = { ...(this.state.users[userId] ?? {}), [provider]: entry };
    this.#save();
    return this.#metadata(userId, provider, entry);
  }

  /** Metadata only; never returns the encrypted payload or its decrypted value. */
  getUserCredential(userIdValue, providerValue) {
    const userId = idPart(userIdValue, 'user ID');
    const provider = idPart(providerValue, 'provider');
    const entry = this.state.users[userId]?.[provider];
    return entry ? this.#metadata(userId, provider, entry) : null;
  }

  listUserCredentials(userIdValue) {
    const userId = idPart(userIdValue, 'user ID');
    return Object.entries(this.state.users[userId] ?? {}).map(([provider, entry]) => this.#metadata(userId, provider, entry));
  }

  /** Read and redact non-secret metadata suitable for diagnostics. */
  inspectUserCredentials(userIdValue) {
    return redactStructured(this.listUserCredentials(userIdValue));
  }

  withUserCredential(userIdValue, providerValue, callback) {
    const userId = idPart(userIdValue, 'user ID');
    const provider = idPart(providerValue, 'provider');
    if (typeof callback !== 'function') throw new TypeError('A callback is required to access a credential.');
    const entry = this.state.users[userId]?.[provider];
    if (!entry) return undefined;
    const plaintext = decryptEnvelope(entry.envelope, { keyring: this.keyring, aad: aadFor(this.installationId, userId, provider) });
    let credential;
    try { credential = JSON.parse(plaintext.toString('utf8')); } catch (error) { plaintext.fill(0); throw new Error(`Stored credential is invalid: ${error.message}`); }
    try {
      const result = callback(credential);
      if (result && typeof result.finally === 'function') return result.finally(() => plaintext.fill(0));
      plaintext.fill(0);
      return result;
    } catch (error) {
      plaintext.fill(0);
      throw error;
    }
  }

  removeUserCredential(userIdValue, providerValue) {
    const userId = idPart(userIdValue, 'user ID');
    const provider = idPart(providerValue, 'provider');
    const user = this.state.users[userId];
    if (!user?.[provider]) return false;
    delete user[provider];
    if (!Object.keys(user).length) delete this.state.users[userId];
    this.#save();
    return true;
  }

  /** Rewrap every stored envelope after a keyring rotation. */
  rewrapAll() {
    let count = 0;
    for (const [userId, providers] of Object.entries(this.state.users)) {
      for (const [provider, entry] of Object.entries(providers)) {
        entry.envelope = rewrapEnvelope(entry.envelope, { keyring: this.keyring, aad: aadFor(this.installationId, userId, provider) });
        entry.updatedAt = new Date().toISOString();
        count += 1;
      }
    }
    if (count) this.#save();
    return { count };
  }

  rotateKey() {
    const rotated = this.keyring.rotate();
    const rewrapped = this.rewrapAll();
    return { ...rotated, rewrapped: rewrapped.count };
  }
}
