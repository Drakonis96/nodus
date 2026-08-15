import {
  HttpError,
  all,
  bearerToken,
  bootstrapToken,
  bytesToBase64Url,
  clientAddress,
  constantTimeEqual,
  cookies,
  first,
  nowIso,
  randomId,
  readJson,
  run,
  sha256Hex,
  strictRateLimit,
} from './util.mjs';

// Cloudflare Workers caps PBKDF2 at 100_000 iterations; anything higher makes
// crypto.subtle.deriveBits throw NotSupportedError and bootstrap fails with a 500.
const PASSWORD_ITERATIONS = 100_000;
const ACCESS_TTL_MS = 15 * 60_000;
const REFRESH_TTL_MS = 30 * 86400_000;
const DEVICE_TTL_MS = 3650 * 86400_000;
const SESSION_TTL_MS = 12 * 3600_000;

function randomSecret(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64Url(value);
}

function encodeHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function decodeHex(value) {
  const clean = String(value);
  if (!/^(?:[0-9a-f]{2})+$/i.test(clean)) return new Uint8Array();
  return Uint8Array.from(clean.match(/.{2}/g).map((part) => Number.parseInt(part, 16)));
}

export async function hashPassword(password, saltHex = null, iterations = PASSWORD_ITERATIONS) {
  const salt = saltHex ? decodeHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return { scheme: `pbkdf2-sha256:${iterations}`, salt: encodeHex(salt), hash: encodeHex(new Uint8Array(bits)) };
}

// Each record stores the iteration count it was hashed with, so verification must
// replay that count rather than the current constant. Otherwise tuning
// PASSWORD_ITERATIONS invalidates every password already on record.
function schemeIterations(scheme) {
  const match = /^pbkdf2-sha256:(\d+)$/.exec(String(scheme || ''));
  if (!match) return null;
  const iterations = Number(match[1]);
  return Number.isSafeInteger(iterations) && iterations > 0 ? iterations : null;
}

export async function verifyPassword(password, user) {
  if (!user?.password_hash || !user?.password_salt) return false;
  const iterations = schemeIterations(user.password_scheme);
  if (!iterations) return false;
  const calculated = await hashPassword(password, user.password_salt, iterations);
  return constantTimeEqual(calculated.hash, user.password_hash);
}

export async function bootstrap(env, request) {
  const supplied = bootstrapToken(request);
  const suppliedVerifier = supplied ? await sha256Hex(supplied) : '';
  if (!supplied || !env.NODUS_BOOTSTRAP_SECRET_HASH || !constantTimeEqual(suppliedVerifier, env.NODUS_BOOTSTRAP_SECRET_HASH)) {
    throw new HttpError(401, 'invalid_bootstrap_token', 'The one-time deployment credential is invalid.');
  }
  const existing = await first(env.DB, 'SELECT installation_id FROM installation WHERE id = 1');
  if (existing) throw new HttpError(409, 'already_bootstrapped', 'This Nodus installation has already been initialized.');
  const input = await readJson(request, 128 * 1024);
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'bad_email', 'Enter a valid administrator email address.');
  if (password.length < 12) throw new HttpError(400, 'weak_password', 'The administrator password needs at least 12 characters.');
  const now = nowIso();
  const userId = randomId('usr_');
  const spaceId = randomId('spc_');
  const installationId = randomId('ins_');
  const passwordRecord = await hashPassword(password);
  const deviceToken = randomSecret(32);
  const deviceId = randomId('dev_');
  // Deterministic from the 256-bit bootstrap secret so Desktop can recover from
  // a lost bootstrap response without Nodus or Cloudflare learning the key.
  const recoveryKey = bytesToBase64Url(decodeHex(await sha256Hex(`nodus-recovery-v1:${supplied}`)));
  const recoveryObjectKey = `recovery/${installationId}.json`;
  await env.OBJECTS.put(recoveryObjectKey, JSON.stringify({
    format: 'nodus.cloudflare-recovery', formatVersion: 1, installationId, administrator: email,
    createdAt: now, recoveryHash: await sha256Hex(recoveryKey),
  }), { httpMetadata: { contentType: 'application/json' } });
  const statements = [
    env.DB.prepare(`INSERT INTO installation (id, installation_id, name, language, source_code_url, worker_version, created_at, updated_at)
      VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?6)`).bind(
        installationId,
        String(input.serverName || 'Nodus Cloud').trim().slice(0, 100) || 'Nodus Cloud',
        String(input.language || 'en').slice(0, 10),
        String(env.NODUS_SOURCE_URL || ''),
        String(env.NODUS_VERSION || '0.0.0'),
        now,
      ),
    env.DB.prepare(`INSERT INTO users (id, email, display_name, role, password_hash, password_salt, password_scheme, created_at, updated_at)
      VALUES (?1, ?2, ?3, 'admin', ?4, ?5, ?6, ?7, ?7)`).bind(
        userId, email, String(input.displayName || '').trim().slice(0, 100), passwordRecord.hash, passwordRecord.salt, passwordRecord.scheme, now,
      ),
    env.DB.prepare(`INSERT INTO spaces (id, name, description, vault_json, created_at, updated_at)
      VALUES (?1, ?2, '', ?3, ?4, ?4)`).bind(
        spaceId, String(input.vault?.name || 'Principal').slice(0, 200), JSON.stringify(input.vault || null), now,
      ),
    env.DB.prepare(`INSERT INTO memberships (user_id, space_id, role, created_at, updated_at)
      VALUES (?1, ?2, 'owner', ?3, ?3)`).bind(userId, spaceId, now),
    env.DB.prepare(`INSERT INTO device_tokens
      (id, token_hash, user_id, space_id, device_name, device_kind, expires_at, last_seen_at, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, 'publisher', ?6, ?7, ?7)`).bind(
        deviceId, await sha256Hex(deviceToken), userId, spaceId, String(input.deviceName || 'Nodus Desktop').slice(0, 200),
        new Date(Date.now() + DEVICE_TTL_MS).toISOString(), now,
      ),
  ];
  try { await env.DB.batch(statements); }
  catch (error) {
    try { await env.OBJECTS.delete(recoveryObjectKey); } catch { /* best-effort rollback of a newly created object */ }
    throw error;
  }
  return { ok: true, installationId, userId, space: { id: spaceId, name: String(input.vault?.name || 'Principal') }, deviceToken, recoveryKey };
}

export async function issueDeviceToken(env, user, space, deviceName, kind = 'replica') {
  const token = randomSecret(32);
  const id = randomId('dev_');
  const now = Date.now();
  await run(env.DB, `INSERT INTO device_tokens
    (id, token_hash, user_id, space_id, device_name, device_kind, expires_at, last_seen_at, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
    id, await sha256Hex(token), user.id, space.id, String(deviceName || 'Nodus').slice(0, 200), kind,
    new Date(now + DEVICE_TTL_MS).toISOString(), new Date(now).toISOString());
  return { id, token };
}

async function deviceAuthorization(env, token) {
  const tokenHash = await sha256Hex(token);
  return first(env.DB, `SELECT d.id AS device_id, d.device_name, d.device_kind, d.space_id, d.expires_at,
      u.id AS user_id, u.email, u.role AS user_role, u.disabled_at,
      s.name AS space_name, s.description AS space_description, s.vault_json, s.revision, s.schema_version,
      m.role AS space_role
    FROM device_tokens d
    JOIN users u ON u.id = d.user_id
    JOIN spaces s ON s.id = d.space_id
    JOIN memberships m ON m.user_id = u.id AND m.space_id = s.id
    WHERE d.token_hash = ?1 AND d.revoked_at IS NULL`, tokenHash);
}

async function oauthAuthorization(env, token) {
  const tokenHash = await sha256Hex(token);
  return first(env.DB, `SELECT o.id AS oauth_token_id, o.scope, o.resource, o.access_expires_at,
      u.id AS user_id, u.email, u.role AS user_role, u.disabled_at
    FROM oauth_tokens o JOIN users u ON u.id = o.user_id
    WHERE o.token_hash = ?1 AND o.revoked_at IS NULL`, tokenHash);
}

function roleAllows(role, need) {
  const rank = { reader: 1, writer: 2, owner: 3 };
  return (rank[role] || 0) >= (rank[need] || 0);
}

export async function authorize(env, request, options = {}) {
  const token = bearerToken(request);
  if (!token) throw new HttpError(401, 'invalid_token', 'Authentication is required.');
  let auth = await deviceAuthorization(env, token);
  let via = 'device';
  if (!auth) {
    auth = await oauthAuthorization(env, token);
    via = 'oauth';
  }
  if (!auth || auth.disabled_at) throw new HttpError(401, 'invalid_token', 'The credential is invalid or has been revoked.');
  const expiresAt = via === 'device' ? auth.expires_at : auth.access_expires_at;
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) throw new HttpError(401, 'expired_token', 'The credential has expired.');
  if (options.via && !options.via.includes(via)) throw new HttpError(403, 'wrong_credential', 'This operation requires a device credential.');
  if (via === 'oauth' && options.scope && !String(auth.scope || '').split(/\s+/).includes(options.scope)) {
    throw new HttpError(403, 'insufficient_scope', `The token does not include ${options.scope}.`);
  }
  if (via === 'oauth' && options.resource && auth.resource !== options.resource) {
    throw new HttpError(403, 'wrong_resource', 'This OAuth token belongs to a different protected resource.');
  }
  if (options.spaceId) {
    if (via === 'device' && auth.space_id !== options.spaceId) throw new HttpError(403, 'space_forbidden', 'This device is paired with a different vault.');
    if (via === 'oauth') {
      const membership = await first(env.DB, `SELECT m.role AS space_role, s.name AS space_name, s.description AS space_description,
          s.vault_json, s.revision, s.schema_version
        FROM memberships m JOIN spaces s ON s.id = m.space_id
        WHERE m.user_id = ?1 AND m.space_id = ?2`, auth.user_id, options.spaceId);
      if (!membership) throw new HttpError(403, 'space_forbidden', 'This account cannot access that vault.');
      auth = { ...auth, ...membership, space_id: options.spaceId };
    }
    if (!roleAllows(auth.space_role, options.need || 'reader')) throw new HttpError(403, 'insufficient_role', 'This operation is not allowed by the vault role.');
  }
  if (via === 'device') await run(env.DB, 'UPDATE device_tokens SET last_seen_at = ?1 WHERE id = ?2', nowIso(), auth.device_id);
  return { ...auth, via };
}

export async function pairDevice(env, request) {
  if (!await strictRateLimit(env, 'pair', clientAddress(request), 15, 15 * 60_000)) throw new HttpError(429, 'rate_limited', 'Try pairing again later.');
  const input = await readJson(request, 64 * 1024);
  const code = String(input.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 8) throw new HttpError(400, 'bad_code', 'Enter the complete one-time code.');
  const hash = await sha256Hex(code);
  const row = await first(env.DB, `SELECT p.*, u.email, s.name AS space_name, s.vault_json, m.role AS space_role
    FROM pairing_codes p JOIN users u ON u.id = p.user_id JOIN spaces s ON s.id = p.space_id
    JOIN memberships m ON m.user_id = p.user_id AND m.space_id = p.space_id
    WHERE p.code_hash = ?1`, hash);
  if (!row || row.consumed_at || Date.parse(row.expires_at) <= Date.now()) throw new HttpError(400, 'invalid_code', 'The one-time code is invalid or has expired.');
  const consumed = await run(env.DB, 'UPDATE pairing_codes SET consumed_at = ?1 WHERE code_hash = ?2 AND consumed_at IS NULL', nowIso(), hash);
  if (!Number(consumed?.meta?.changes || 0)) throw new HttpError(400, 'invalid_code', 'The one-time code was already used.');
  const device = await issueDeviceToken(env, { id: row.user_id }, { id: row.space_id }, String(input.deviceName || 'Nodus Desktop'), String(input.deviceKind || row.device_kind || 'publisher'));
  const installation = await first(env.DB, 'SELECT name, language FROM installation WHERE id = 1');
  return {
    accessToken: device.token,
    token: device.token,
    deviceToken: device.token,
    space: { id: row.space_id, name: row.space_name, vault: row.vault_json ? JSON.parse(row.vault_json) : null },
    user: { email: row.email, role: row.space_role },
    server: { name: installation?.name || 'Nodus Cloud', service: 'nodus-cloudflare', publicUrl: new URL(request.url).origin, language: installation?.language || 'en' },
  };
}

export async function passwordLogin(env, request) {
  if (!await strictRateLimit(env, 'login', clientAddress(request), 10, 15 * 60_000)) throw new HttpError(429, 'rate_limited', 'Try signing in again later.');
  const input = await readJson(request, 64 * 1024);
  const email = String(input.email || '').trim().toLowerCase();
  const user = await first(env.DB, 'SELECT * FROM users WHERE email = ?1 COLLATE NOCASE', email);
  const valid = user && !user.disabled_at && await verifyPassword(String(input.password || ''), user);
  if (!valid) throw new HttpError(401, 'invalid_credentials', 'The email or password is incorrect.');
  const ticket = randomSecret(32);
  const ticketHash = await sha256Hex(ticket);
  await run(env.DB, `INSERT INTO sessions (id, token_hash, user_id, csrf_hash, expires_at, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)`, randomId('ses_'), ticketHash, user.id, await sha256Hex(randomSecret()), new Date(Date.now() + 5 * 60_000).toISOString(), nowIso());
  const spaces = await all(env.DB, `SELECT s.id, s.name, s.description, s.vault_json, s.updated_at, s.revision, m.role
    FROM memberships m JOIN spaces s ON s.id = m.space_id WHERE m.user_id = ?1 ORDER BY s.name COLLATE NOCASE`, user.id);
  const installation = await first(env.DB, 'SELECT name FROM installation WHERE id = 1');
  return {
    ticket,
    service: 'nodus-cloudflare',
    serverName: installation?.name || 'Nodus Cloud',
    userEmail: user.email,
    spaces: spaces.map((space) => ({
      id: space.id, name: space.name, description: space.description, role: space.role,
      vault: space.vault_json ? JSON.parse(space.vault_json) : null,
      updatedAt: space.updated_at, hasSnapshot: Boolean(space.revision),
    })),
  };
}

export async function authenticateWebPassword(env, emailValue, password) {
  const email = String(emailValue || '').trim().toLowerCase();
  const user = await first(env.DB, 'SELECT * FROM users WHERE email = ?1 COLLATE NOCASE', email);
  if (!user || user.disabled_at || !await verifyPassword(String(password || ''), user)) {
    throw new HttpError(401, 'invalid_credentials', 'The email or password is incorrect.');
  }
  return user;
}

export async function exchangeDeviceTicket(env, request) {
  const input = await readJson(request, 64 * 1024);
  const ticketHash = await sha256Hex(String(input.ticket || ''));
  const session = await first(env.DB, `SELECT s.*, u.email FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?1`, ticketHash);
  if (!session || Date.parse(session.expires_at) <= Date.now()) throw new HttpError(401, 'invalid_ticket', 'The sign-in ticket is invalid or expired.');
  const spaceId = String(input.spaceId || '');
  const membership = await first(env.DB, `SELECT m.role, s.name, s.vault_json FROM memberships m JOIN spaces s ON s.id = m.space_id
    WHERE m.user_id = ?1 AND m.space_id = ?2`, session.user_id, spaceId);
  if (!membership) throw new HttpError(403, 'space_forbidden', 'This account cannot access that vault.');
  const consumed = await run(env.DB, 'DELETE FROM sessions WHERE id = ?1', session.id);
  if (!Number(consumed?.meta?.changes || 0)) throw new HttpError(401, 'invalid_ticket', 'The sign-in ticket was already used.');
  const device = await issueDeviceToken(env, { id: session.user_id }, { id: spaceId }, String(input.deviceName || 'Nodus'), 'replica');
  return { deviceToken: device.token, role: membership.role, userEmail: session.email, space: { id: spaceId, name: membership.name, vault: membership.vault_json ? JSON.parse(membership.vault_json) : null } };
}

export async function sessionUser(env, request) {
  const token = cookies(request).nodus_session;
  if (!token) return null;
  const row = await first(env.DB, `SELECT s.*, u.email, u.display_name, u.role, u.disabled_at
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1`, await sha256Hex(token));
  if (!row || row.disabled_at || Date.parse(row.expires_at) <= Date.now()) return null;
  return row;
}

export async function createWebSession(env, user) {
  const token = randomSecret(32);
  const csrf = randomSecret(24);
  const now = Date.now();
  await run(env.DB, `INSERT INTO sessions (id, token_hash, user_id, csrf_hash, expires_at, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)`, randomId('ses_'), await sha256Hex(token), user.id, await sha256Hex(csrf), new Date(now + SESSION_TTL_MS).toISOString(), new Date(now).toISOString());
  return { token, csrf };
}

export async function requireCsrf(env, request, session, supplied) {
  if (!session || !supplied || !constantTimeEqual(await sha256Hex(String(supplied)), session.csrf_hash)) throw new HttpError(403, 'csrf', 'The form expired. Reload the page and try again.');
}

export async function createPairingCode(env, userId, spaceId, deviceKind = 'publisher') {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const raw = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
  const display = `${raw.slice(0, 5)}-${raw.slice(5)}`;
  await run(env.DB, `INSERT INTO pairing_codes (code_hash, space_id, user_id, device_kind, expires_at, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)`, await sha256Hex(raw), spaceId, userId, deviceKind, new Date(Date.now() + 15 * 60_000).toISOString(), nowIso());
  return { code: display, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
}

export async function issueOAuthTokens(env, { clientId, userId, scope, resource, includeRefresh = true }) {
  const access = randomSecret(32);
  const refresh = includeRefresh ? randomSecret(40) : null;
  const now = Date.now();
  await run(env.DB, `INSERT INTO oauth_tokens
    (id, token_hash, refresh_hash, client_id, user_id, scope, resource, access_expires_at, refresh_expires_at, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    randomId('oat_'), await sha256Hex(access), refresh ? await sha256Hex(refresh) : null, clientId, userId, scope, resource,
    new Date(now + ACCESS_TTL_MS).toISOString(), refresh ? new Date(now + REFRESH_TTL_MS).toISOString() : null, new Date(now).toISOString());
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, scope, ...(refresh ? { refresh_token: refresh } : {}) };
}
