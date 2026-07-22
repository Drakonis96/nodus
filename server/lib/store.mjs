import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { normalizeServerLanguage } from './i18n.mjs';

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

const DUMMY_PASSWORD = hashPassword('nodus-invalid-login-password', 'nodus-dummy-auth-salt');

function normalizedEmail(value) {
  const email = String(value).trim().toLowerCase();
  if (!email || email.length > 320 || !email.includes('@')) throw new Error('Enter a valid email address.');
  return email;
}

function validatePassword(value) {
  const password = String(value);
  if (password.length < 12) throw new Error('The password must contain at least 12 characters.');
  if (password.length > 1024) throw new Error('The password is too long.');
  return password;
}

function initialState() {
  return {
    version: 1,
    settings: { name: 'Nodus Server', publicUrl: '', language: 'en' },
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
      const settings = { ...initialState().settings, ...(parsed.settings ?? {}) };
      settings.language = normalizeServerLanguage(settings.language);
      return { ...initialState(), ...parsed, settings };
    } catch (error) {
      throw new Error(`Could not read ${this.stateFile}: ${error instanceof Error ? error.message : String(error)}`);
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
    const normalized = normalizedEmail(email);
    const cleanPassword = validatePassword(password);
    if (this.state.users.some((user) => user.email === normalized)) throw new Error('An account already exists for that email address.');
    const protectedPassword = hashPassword(cleanPassword);
    const user = { id: randomUUID(), email: normalized, role, ...protectedPassword, createdAt: new Date().toISOString() };
    this.state.users.push(user);
    this.save();
    return user;
  }

  authenticate(email, password) {
    const user = this.state.users.find((entry) => entry.email === String(email).trim().toLowerCase());
    // Always perform the same expensive password verification. Returning early for
    // an unknown email makes account discovery possible through response timing.
    const protectedPassword = user ?? DUMMY_PASSWORD;
    const valid = verifyPassword(String(password).slice(0, 1024), protectedPassword.salt, protectedPassword.hash);
    return user && valid ? user : null;
  }

  syncAdminCredentials(email, password) {
    const normalized = normalizedEmail(email);
    const cleanPassword = validatePassword(password);
    let admin = this.state.users.find((entry) => entry.role === 'admin');
    if (!admin) {
      admin = this.createUser(normalized, cleanPassword, 'admin');
      return { created: true, emailChanged: false, passwordChanged: false };
    }
    if (this.state.users.some((entry) => entry.id !== admin.id && entry.email === normalized)) {
      throw new Error('The configured administrator email already belongs to another account.');
    }
    const emailChanged = admin.email !== normalized;
    const passwordChanged = !verifyPassword(cleanPassword, admin.salt, admin.hash);
    if (emailChanged) admin.email = normalized;
    if (passwordChanged) this.replacePassword(admin.id, cleanPassword);
    else if (emailChanged) this.save();
    return { created: false, emailChanged, passwordChanged };
  }

  replacePassword(userId, password, exceptSessionHash = null) {
    const user = this.state.users.find((entry) => entry.id === userId);
    if (!user) throw new Error('The account does not exist.');
    const cleanPassword = validatePassword(password);
    Object.assign(user, hashPassword(cleanPassword), { passwordChangedAt: new Date().toISOString() });

    // A password change is also a credential-recovery event: stale browser and
    // OAuth credentials must stop working immediately. The session performing a
    // self-service change may remain signed in, but receives a new CSRF secret.
    this.state.sessions = this.state.sessions.filter((entry) => entry.userId !== userId || entry.hash === exceptSessionHash);
    const currentSession = exceptSessionHash
      ? this.state.sessions.find((entry) => entry.hash === exceptSessionHash && entry.userId === userId)
      : null;
    if (currentSession) currentSession.csrf = token(18);
    this.state.oauthCodes = this.state.oauthCodes.filter((entry) => entry.userId !== userId);
    this.state.accessTokens = this.state.accessTokens.filter((entry) => entry.userId !== userId);
    this.state.refreshTokens = this.state.refreshTokens.filter((entry) => entry.userId !== userId);
    this.state.pairingCodes = this.state.pairingCodes.filter((entry) => entry.userId !== userId);
    this.save();
    return user;
  }

  changePassword(userId, currentPassword, newPassword, currentSessionHash) {
    const user = this.state.users.find((entry) => entry.id === userId);
    if (!user || !verifyPassword(String(currentPassword), user.salt, user.hash)) throw new Error('The current password is incorrect.');
    if (verifyPassword(String(newPassword), user.salt, user.hash)) throw new Error('The new password must be different from the current password.');
    return this.replacePassword(userId, newPassword, currentSessionHash);
  }

  resetPassword(userId, newPassword) {
    return this.replacePassword(userId, newPassword);
  }

  createSession(userId) {
    const raw = token();
    this.cleanup();
    const existing = this.state.sessions.filter((entry) => entry.userId === userId).sort((a, b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt));
    const retained = new Set(existing.slice(0, 19));
    this.state.sessions = this.state.sessions.filter((entry) => entry.userId !== userId || retained.has(entry));
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
