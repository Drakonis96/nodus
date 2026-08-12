// Shared harness for the suites that exercise a REAL Nodus Server process.
//
// Extracted from scripts/test-nodus-server.mjs once a second suite needed the same 150
// lines. Everything here spawns and talks to the actual server over HTTP; nothing stubs it,
// because the things worth testing — rate limits, CSP headers, role gates, the OAuth
// resource split — only exist in the running process.

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.listen(0, '127.0.0.1', resolve).once('error', reject));
  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

export async function waitForHealth(origin, child, logs) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Nodus Server exited early (${child.exitCode}).\n${logs.join('')}`);
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) return;
    } catch {
      // The listener is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Nodus Server did not become healthy.\n${logs.join('')}`);
}

/**
 * A clean environment.
 *
 * Every NODUS_* variable is deleted before the overrides are applied, so a developer who
 * happens to have one exported in their shell cannot change what the test measures.
 */
export function serverEnvironment(overrides = {}) {
  const env = { ...process.env };
  for (const name of [
    'NODUS_ADMIN_EMAIL', 'NODUS_ADMIN_PASSWORD', 'NODUS_ADMIN_EMAIL_FILE', 'NODUS_ADMIN_PASSWORD_FILE',
    'NODUS_SETUP_TOKEN', 'NODUS_PUBLIC_URL', 'NODUS_DATA_DIR', 'NODUS_HOST', 'NODUS_PORT',
    'NODUS_MAX_SNAPSHOT_BYTES', 'NODUS_MAX_SNAPSHOT_JSON_BYTES',
    'NODUS_MAX_ASSET_BYTES', 'NODUS_MAX_SPACE_ASSET_BYTES', 'NODUS_MAX_VECTOR_BYTES',
    'NODUS_MAX_MUTATION_BYTES', 'NODUS_MAX_MUTATION_BATCH_BYTES', 'NODUS_MAX_LEDGER_BYTES',
    // NODUS_MAX_CACHED_SNAPSHOTS is refused by the server now, so a developer who still has
    // it exported would fail every boot here rather than see one clear message once.
    'NODUS_MAX_CACHED_SNAPSHOTS', 'NODUS_MAX_SNAPSHOT_CACHE_BYTES', 'NODUS_VECTOR_WORKERS',
    'NODUS_SOURCE_URL',
  ]) delete env[name];
  return { ...env, ...overrides };
}

export async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
}

export function cookieFrom(response) {
  const value = response.headers.get('set-cookie');
  assert.ok(value, 'expected a session cookie');
  return value.split(';', 1)[0];
}

export function hidden(html, name) {
  const match = html.match(new RegExp(`name="${name}" value="([^"]+)"`));
  assert.ok(match, `missing hidden field ${name}`);
  return match[1];
}

export async function postForm(url, fields, options = {}) {
  return fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(options.headers ?? {}) },
    body: new URLSearchParams(fields),
  });
}

export async function postJson(url, value, options = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: JSON.stringify(value),
  });
}

/**
 * The whole PKCE dance against the real authorization server.
 *
 * `resource` matters now that MCP and the client API are separate protected resources: a
 * token minted for one must be refused by the other, and that is only observable if the
 * caller can choose which one it asks for.
 */
export async function oauthLogin(origin, client, cookie, options = {}) {
  const resource = options.resource ?? `${origin}/mcp`;
  const scope = options.scope ?? 'profile spaces.read materials.read';
  const verifier = randomBytes(36).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(8).toString('hex');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0],
    scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource,
  });
  const consentResponse = await fetch(`${origin}/oauth/authorize?${params}`, { headers: { cookie } });
  assert.equal(consentResponse.status, 200);
  const callbackOrigin = new URL(client.redirect_uris[0]).origin;
  assert.ok(
    (consentResponse.headers.get('content-security-policy') || '').includes(`form-action 'self' ${callbackOrigin};`),
    'the consent CSP must allow only the validated OAuth callback origin after its same-origin POST',
  );
  const consent = await consentResponse.text();
  const csrf = hidden(consent, 'csrf');
  const authorization = await postForm(`${origin}/oauth/authorize`, { ...Object.fromEntries(params), csrf }, { headers: { cookie } });
  assert.equal(authorization.status, 303);
  const callback = new URL(authorization.headers.get('location'));
  assert.equal(callback.searchParams.get('state'), state);
  const code = callback.searchParams.get('code');
  assert.ok(code);
  const tokenResponse = await postForm(`${origin}/oauth/token`, {
    grant_type: 'authorization_code',
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0],
    code,
    code_verifier: verifier,
    resource,
  });
  assert.equal(tokenResponse.status, 200);
  const tokens = await tokenResponse.json();
  assert.equal(tokens.token_type, 'Bearer');
  assert.ok(tokens.access_token);
  assert.ok(tokens.refresh_token);
  return tokens;
}

export async function mcp(origin, accessToken, method, params, id = 1) {
  const response = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

export async function registerOauthClient(origin, name = 'Harness client') {
  const response = await fetch(`${origin}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: name, redirect_uris: ['https://client.example.test/callback'] }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

/**
 * Boot a server, run `work(context)`, and always tear it down.
 *
 * The context carries what nearly every suite needs next: the origin, a signed-in admin
 * cookie, and helpers to create spaces and accounts through the real web forms rather than
 * by writing state.json behind the server's back.
 */
export async function withServer(options, work) {
  const root = await mkdtemp(path.join(os.tmpdir(), `nodus-server-${options.label ?? 'test'}-`));
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const logs = [];
  const adminEmail = options.adminEmail ?? 'admin@example.test';
  const adminPassword = options.adminPassword ?? 'harness-administrator-password';
  const child = spawn(process.execPath, ['server/server.mjs'], {
    cwd: repoRoot,
    env: serverEnvironment({
      NODUS_DATA_DIR: root,
      NODUS_HOST: '127.0.0.1',
      NODUS_PORT: String(port),
      NODUS_PUBLIC_URL: origin,
      NODUS_ADMIN_EMAIL: adminEmail,
      NODUS_ADMIN_PASSWORD: adminPassword,
      ...(options.env ?? {}),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));

  try {
    await waitForHealth(origin, child, logs);
    const context = { origin, root, logs, child, adminEmail, adminPassword };

    context.signIn = async (email, password) => {
      const response = await postForm(`${origin}/login`, { email, password, next: '/' });
      assert.equal(response.status, 303, `sign-in failed for ${email}`);
      return cookieFrom(response);
    };
    context.adminCookie = await context.signIn(adminEmail, adminPassword);

    context.dashboard = async (cookie = context.adminCookie) => {
      const response = await fetch(`${origin}/`, { headers: { cookie } });
      assert.equal(response.status, 200);
      return response.text();
    };
    context.csrf = async (cookie = context.adminCookie) => hidden(await context.dashboard(cookie), 'csrf');

    context.createSpace = async (name) => {
      const before = new Set(await context.spaceIds());
      const response = await postForm(`${origin}/admin/spaces`, { csrf: await context.csrf(), name }, { headers: { cookie: context.adminCookie } });
      assert.equal(response.status, 303);
      const after = await context.spaceIds();
      const created = after.find((id) => !before.has(id));
      assert.ok(created, `space ${name} was not created`);
      return created;
    };

    context.spaceIds = async () => [...(await context.dashboard()).matchAll(/<code>([0-9a-f-]{36})<\/code>/g)].map((match) => match[1]);

    /** Create a member account and grant it one role per space, through the real form. */
    context.createUser = async (email, password, grants = []) => {
      const fields = { csrf: await context.csrf(), email, password };
      for (const grant of grants) {
        fields[`space:${grant.spaceId}`] = 'on';
        fields[`role:${grant.spaceId}`] = grant.role;
      }
      const response = await postForm(`${origin}/admin/users`, fields, { headers: { cookie: context.adminCookie } });
      assert.equal(response.status, 303, `user ${email} was not created`);
      return { email, password };
    };

    context.setRole = async (userId, spaceId, role) => {
      const response = await postForm(`${origin}/admin/access/role`, { csrf: await context.csrf(), userId, spaceId, role }, { headers: { cookie: context.adminCookie } });
      assert.equal(response.status, 303);
    };

    /** Sign in as a replica and take a device token for one space. */
    context.deviceToken = async (email, password, spaceId, deviceName = 'Harness replica') => {
      const login = await postJson(`${origin}/api/v1/auth/login`, { email, password });
      assert.equal(login.status, 200, `api login failed for ${email}`);
      const session = await login.json();
      const device = await postJson(`${origin}/api/v1/auth/device`, { ticket: session.ticket, spaceId, deviceName });
      assert.equal(device.status, 200, `device token refused for ${email}`);
      return { ...(await device.json()), spaces: session.spaces, user: session.user };
    };

    context.pairingCode = async (spaceId) => {
      const response = await postForm(`${origin}/admin/pairing`, { csrf: await context.csrf(), spaceId }, { headers: { cookie: context.adminCookie } });
      assert.equal(response.status, 200);
      const match = (await response.text()).match(/<code>([A-Z0-9]{4}-[A-Z0-9]{4})<\/code>/);
      assert.ok(match, 'no pairing code was rendered');
      return match[1];
    };

    context.pair = async (code, deviceName = 'Harness desktop') => {
      const response = await postJson(`${origin}/api/v1/pair`, { code, deviceName });
      assert.equal(response.status, 200);
      return response.json();
    };

    context.api = async (token, method, pathname, options = {}) => fetch(`${origin}${pathname}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(options.json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(options.headers ?? {}),
      },
      ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
      ...(options.body !== undefined ? { body: options.body } : {}),
    });

    context.readState = async () => JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root, 'state.json'), 'utf8'));

    return await work(context);
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
}
