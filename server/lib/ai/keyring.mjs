import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

export const KEYRING_VERSION = 1;

export class KeyringError extends Error {
  constructor(message, code = 'INVALID_KEYRING', options = {}) {
    super(message, options);
    this.name = 'KeyringError';
    this.code = code;
  }
}

export class MissingKEKError extends KeyringError {
  constructor(message = 'No key-encryption keyring is available.') {
    super(message, 'MISSING_KEK');
    this.name = 'MissingKEKError';
  }
}

function keyId() {
  return `kek-${Date.now().toString(36)}-${randomUUID()}`;
}

function material() {
  return randomBytes(32).toString('base64url');
}

function validate(parsed, file) {
  if (!parsed || parsed.version !== KEYRING_VERSION || typeof parsed.activeKeyId !== 'string' || !Array.isArray(parsed.keys)) {
    throw new KeyringError(`Could not read ${file}: invalid keyring format.`);
  }
  const seen = new Set();
  for (const entry of parsed.keys) {
    if (!entry || typeof entry.id !== 'string' || seen.has(entry.id) || typeof entry.material !== 'string') {
      throw new KeyringError(`Could not read ${file}: invalid key entry.`);
    }
    const bytes = Buffer.from(entry.material, 'base64url');
    if (bytes.length !== 32) throw new KeyringError(`Could not read ${file}: key material must be 32 bytes.`);
    seen.add(entry.id);
  }
  if (!seen.has(parsed.activeKeyId)) throw new MissingKEKError(`The keyring at ${file} has no active key.`);
  return parsed;
}

function writeJson(file, value) {
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  try { fs.chmodSync(temporary, 0o600); } catch { /* Windows */ }
  fs.renameSync(temporary, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
}

function unescapeMountPath(value) {
  return value.replace(/\\(040|011|012|134)/g, (_, code) => ({
    '040': ' ', '011': '\t', '012': '\n', '134': '\\',
  })[code]);
}

function isReadOnlyMount(file) {
  if (process.platform !== 'linux') return false;
  try {
    const resolved = path.resolve(file);
    let best = null;
    for (const line of fs.readFileSync('/proc/self/mountinfo', 'utf8').split('\n')) {
      const fields = line.split(' ');
      if (fields.length < 6) continue;
      const mountPoint = unescapeMountPath(fields[4]);
      if (resolved !== mountPoint && !resolved.startsWith(`${mountPoint}${path.sep}`)) continue;
      if (!best || mountPoint.length > best.mountPoint.length) best = { mountPoint, options: fields[5] };
    }
    return Boolean(best?.options.split(',').includes('ro'));
  } catch {
    return false;
  }
}

function assertSecureKeyringFile(file) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new KeyringError(`The keyring at ${file} must be a regular file and must not be a symbolic link.`);
  }
  if (process.platform === 'win32') return;
  const mode = stat.mode & 0o777;
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const ownerIsProcessOrRoot = uid == null || stat.uid === uid || stat.uid === 0;
  // Compose secrets are immutable files inside a read-only /run/secrets mount. Docker
  // Desktop reports bind-mounted files with a synthetic non-root owner ("fakeowner"), so
  // ownership alone cannot identify them; mountinfo proves that this process cannot alter
  // the keyring. Everywhere else, require a private 0600-style file.
  const dockerSecret = file.startsWith(`${path.resolve('/run/secrets')}${path.sep}`)
    && ownerIsProcessOrRoot && (mode & 0o222) === 0 && isReadOnlyMount(file);
  if (!ownerIsProcessOrRoot || (!dockerSecret && (mode & 0o077) !== 0)) {
    throw new KeyringError(`The keyring at ${file} has unsafe ownership or permissions; use a private 0600 file.`);
  }
}

/** A versioned KEK ring kept outside the application state file. */
export class FileKeyring {
  #state;

  constructor(file, { create = false } = {}) {
    if (!file) throw new TypeError('A keyring file path is required.');
    this.file = path.resolve(file);
    if (!fs.existsSync(this.file)) {
      if (!create) throw new MissingKEKError(`The keyring file ${this.file} does not exist.`);
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const first = { id: keyId(), material: material(), createdAt: new Date().toISOString() };
      writeJson(this.file, { version: KEYRING_VERSION, activeKeyId: first.id, keys: [first] });
    }
    assertSecureKeyringFile(this.file);
    this.#state = this.#read();
  }

  #read() {
    try {
      assertSecureKeyringFile(this.file);
      const descriptor = fs.openSync(this.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      try { return validate(JSON.parse(fs.readFileSync(descriptor, 'utf8')), this.file); }
      finally { fs.closeSync(descriptor); }
    } catch (error) {
      if (error instanceof KeyringError) throw error;
      throw new KeyringError(`Could not read ${this.file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  #save() {
    writeJson(this.file, this.#state);
  }

  activeKeyId() {
    return this.#state.activeKeyId;
  }

  getKey(id) {
    const entry = this.#state.keys.find((candidate) => candidate.id === id);
    if (!entry) throw new MissingKEKError(`The key ${id} is not present in the keyring.`);
    return Buffer.from(entry.material, 'base64url');
  }

  list() {
    return this.#state.keys.map(({ id, createdAt }) => ({ id, createdAt, active: id === this.#state.activeKeyId }));
  }

  rotate() {
    const next = { id: keyId(), material: material(), createdAt: new Date().toISOString() };
    this.#state.keys.push(next);
    this.#state.activeKeyId = next.id;
    this.#save();
    return { id: next.id, createdAt: next.createdAt };
  }
}

export function createKeyring(file) {
  return new FileKeyring(file, { create: true });
}
