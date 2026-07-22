import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

export function token(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function digest(value) {
  return createHash('sha256').update(String(value)).digest('base64url');
}

export function hashPassword(password, salt = token(16)) {
  return { salt, hash: scryptSync(password, salt, 64).toString('base64url') };
}

export function verifyPassword(password, salt, expected) {
  const actual = Buffer.from(scryptSync(password, salt, 64).toString('base64url'));
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function initialState() {
  return {
    version: 1,
    settings: { name: 'Nodus Server', publicUrl: '' },
    users: [],
    spaces: [],
    memberships: [],
    pairingCodes: [],
    deviceTokens: [],
    sessions: [],
    oauthClients: [],
    oauthCodes: [],
    accessTokens: [],
    refreshTokens: [],
  };
}

export class Store {
  constructor(root) {
    this.root = path.resolve(root);
    this.stateFile = path.join(this.root, 'state.json');
    this.spacesDir = path.join(this.root, 'spaces');
    fs.mkdirSync(this.spacesDir, { recursive: true });
    this.state = this.readState();
  }

  readState() {
    if (!fs.existsSync(this.stateFile)) return initialState();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      return { ...initialState(), ...parsed, settings: { ...initialState().settings, ...(parsed.settings ?? {}) } };
    } catch (error) {
      throw new Error(`No se pudo leer ${this.stateFile}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  save() {
    const temporary = `${this.stateFile}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.stateFile);
    try { fs.chmodSync(this.stateFile, 0o600); } catch { /* Windows */ }
  }

  cleanup(now = Date.now()) {
    const keep = (entry) => !entry.expiresAt || Date.parse(entry.expiresAt) > now;
    this.state.sessions = this.state.sessions.filter(keep);
    this.state.oauthCodes = this.state.oauthCodes.filter(keep);
    this.state.accessTokens = this.state.accessTokens.filter(keep);
    this.state.refreshTokens = this.state.refreshTokens.filter(keep);
    this.state.pairingCodes = this.state.pairingCodes.filter((entry) => keep(entry) && !entry.usedAt);
  }

  createUser(email, password, role = 'member') {
    const normalized = String(email).trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) throw new Error('Introduce un correo válido.');
    if (String(password).length < 12) throw new Error('La contraseña debe tener al menos 12 caracteres.');
    if (this.state.users.some((user) => user.email === normalized)) throw new Error('Ya existe una cuenta con ese correo.');
    const protectedPassword = hashPassword(password);
    const user = { id: randomUUID(), email: normalized, role, ...protectedPassword, createdAt: new Date().toISOString() };
    this.state.users.push(user);
    this.save();
    return user;
  }

  authenticate(email, password) {
    const user = this.state.users.find((entry) => entry.email === String(email).trim().toLowerCase());
    return user && verifyPassword(String(password), user.salt, user.hash) ? user : null;
  }

  createSession(userId) {
    const raw = token();
    this.state.sessions.push({ hash: digest(raw), userId, csrf: token(18), expiresAt: new Date(Date.now() + 12 * 3600_000).toISOString() });
    this.save();
    return raw;
  }

  session(raw) {
    if (!raw) return null;
    this.cleanup();
    const session = this.state.sessions.find((entry) => entry.hash === digest(raw));
    if (!session) return null;
    const user = this.state.users.find((entry) => entry.id === session.userId);
    return user ? { session, user } : null;
  }

  snapshotPath(spaceId) {
    const dir = path.join(this.spacesDir, spaceId);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'snapshot.json.gz');
  }

  writeSnapshot(spaceId, bytes) {
    const target = this.snapshotPath(spaceId);
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, bytes, { mode: 0o600 });
    fs.renameSync(temporary, target);
    return target;
  }

  removeSnapshot(spaceId) {
    const dir = path.join(this.spacesDir, spaceId);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
