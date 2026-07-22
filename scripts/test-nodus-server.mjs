import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { missingServerTranslations } from '../server/lib/i18n.mjs';
import { Store } from '../server/lib/store.mjs';

test('Nodus Server web translations cover every supported app language', () => {
  assert.deepEqual(missingServerTranslations(), {
    en: [], es: [], fr: [], de: [], pt: [], 'pt-BR': [], it: [],
  });
});

test('existing server state without a language migrates to English', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-server-language-test-'));
  try {
    await writeFile(path.join(root, 'state.json'), JSON.stringify({ version: 1, settings: { name: 'Legacy server', publicUrl: '' } }));
    const store = new Store(root);
    assert.equal(store.state.settings.language, 'en');
    store.state.settings.language = 'it';
    store.save();
    assert.equal(new Store(root).state.settings.language, 'it');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('active browser sessions are bounded per account', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-server-session-limit-test-'));
  try {
    const store = new Store(root);
    const user = store.createUser('session-admin@example.test', 'session-limit-password-strong', 'admin');
    for (let index = 0; index < 25; index += 1) store.createSession(user.id);
    assert.equal(store.state.sessions.filter((session) => session.userId === user.id).length, 20);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.listen(0, '127.0.0.1', resolve).once('error', reject));
  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitForHealth(origin, child, logs) {
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

function serverEnvironment(overrides = {}) {
  const env = { ...process.env };
  for (const name of [
    'NODUS_ADMIN_EMAIL', 'NODUS_ADMIN_PASSWORD', 'NODUS_ADMIN_EMAIL_FILE', 'NODUS_ADMIN_PASSWORD_FILE',
    'NODUS_SETUP_TOKEN', 'NODUS_PUBLIC_URL', 'NODUS_DATA_DIR', 'NODUS_HOST', 'NODUS_PORT',
  ]) delete env[name];
  return { ...env, ...overrides };
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
}

function cookieFrom(response) {
  const value = response.headers.get('set-cookie');
  assert.ok(value, 'expected a session cookie');
  return value.split(';', 1)[0];
}

function hidden(html, name) {
  const match = html.match(new RegExp(`name="${name}" value="([^"]+)"`));
  assert.ok(match, `missing hidden field ${name}`);
  return match[1];
}

async function postForm(url, fields, options = {}) {
  return fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(options.headers ?? {}) },
    body: new URLSearchParams(fields),
  });
}

async function oauthLogin(origin, client, cookie) {
  const verifier = randomBytes(36).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(8).toString('hex');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0],
    scope: 'profile spaces.read materials.read',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: `${origin}/mcp`,
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
  assert.ok(
    (authorization.headers.get('content-security-policy') || '').includes(`form-action 'self' ${callbackOrigin};`),
    'the authorization redirect must retain the callback-compatible CSP',
  );
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
    resource: `${origin}/mcp`,
  });
  assert.equal(tokenResponse.status, 200);
  const tokens = await tokenResponse.json();
  assert.equal(tokens.token_type, 'Bearer');
  assert.ok(tokens.access_token);
  assert.ok(tokens.refresh_token);
  return tokens;
}

async function mcp(origin, accessToken, method, params, id = 1) {
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

test('environment credentials skip setup, rotate the admin, and rate-limit distributed login attacks', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-server-env-admin-test-'));
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const logs = [];
  let child;
  const start = async (credentials) => {
    child = spawn(process.execPath, ['server/server.mjs'], {
      cwd: path.resolve('.'),
      env: serverEnvironment({
        NODUS_DATA_DIR: root,
        NODUS_HOST: '127.0.0.1',
        NODUS_PORT: String(port),
        NODUS_PUBLIC_URL: origin,
        ...credentials,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
    child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
    await waitForHealth(origin, child, logs);
  };

  try {
    const emailFile = path.join(root, 'admin-email');
    const passwordFile = path.join(root, 'admin-password');
    await writeFile(emailFile, 'first-admin@example.test\n');
    await writeFile(passwordFile, 'first-admin-password-strong\n');
    await start({ NODUS_ADMIN_EMAIL_FILE: emailFile, NODUS_ADMIN_PASSWORD_FILE: passwordFile });
    const rootResponse = await fetch(`${origin}/`, { redirect: 'manual' });
    assert.equal(rootResponse.status, 303);
    assert.match(rootResponse.headers.get('location') || '', /^\/login/);
    const oldSetup = await fetch(`${origin}/setup`, { redirect: 'manual' });
    assert.equal(oldSetup.status, 303);
    assert.equal(oldSetup.headers.get('location'), '/login');

    const initialLogin = await postForm(`${origin}/login`, {
      email: 'first-admin@example.test', password: 'first-admin-password-strong', next: '/',
    });
    assert.equal(initialLogin.status, 303);
    const initialCookie = cookieFrom(initialLogin);
    await stopServer(child);

    await start({
      NODUS_ADMIN_EMAIL: 'rotated-admin@example.test',
      NODUS_ADMIN_PASSWORD: 'rotated-admin-password-strong',
    });
    const staleSession = await fetch(`${origin}/account`, { headers: { cookie: initialCookie }, redirect: 'manual' });
    assert.equal(staleSession.status, 303, 'rotating the environment password revokes old sessions');
    const oldCredentials = await postForm(`${origin}/login`, {
      email: 'first-admin@example.test', password: 'first-admin-password-strong', next: '/',
    });
    assert.equal(oldCredentials.status, 401);
    const rotatedCredentials = await postForm(`${origin}/login`, {
      email: 'rotated-admin@example.test', password: 'rotated-admin-password-strong', next: '/',
    });
    assert.equal(rotatedCredentials.status, 303);

    const state = JSON.parse(await readFile(path.join(root, 'state.json'), 'utf8'));
    assert.equal(state.users.filter((user) => user.role === 'admin').length, 1);
    assert.equal(state.users[0].email, 'rotated-admin@example.test');
    const serializedState = JSON.stringify(state);
    assert.ok(!serializedState.includes('first-admin-password-strong'));
    assert.ok(!serializedState.includes('rotated-admin-password-strong'));

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const rejected = await postForm(`${origin}/login`, {
        email: 'rotated-admin@example.test', password: `wrong-password-${attempt}`, next: '/',
      }, { headers: { 'x-forwarded-for': `198.51.100.${attempt + 1}` } });
      assert.equal(rejected.status, 401);
    }
    const accountLimited = await postForm(`${origin}/login`, {
      email: 'rotated-admin@example.test', password: 'another-wrong-password', next: '/',
    }, { headers: { 'x-forwarded-for': '203.0.113.20' } });
    assert.equal(accountLimited.status, 429, 'the account bucket must stop a distributed brute-force attempt');
    assert.ok(Number(accountLimited.headers.get('retry-after')) > 0);

    const oversized = await fetch(`${origin}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '203.0.113.50' },
      body: `email=other%40example.test&password=${'x'.repeat(40_000)}`,
      redirect: 'manual',
    });
    assert.equal(oversized.status, 413);
    assert.ok(!logs.join('').includes('rotated-admin-password-strong'), 'credentials must never be logged');
  } finally {
    if (child) await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test('partial environment administrator configuration fails closed', { timeout: 10_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-server-partial-env-test-'));
  const child = spawn(process.execPath, ['server/server.mjs'], {
    cwd: path.resolve('.'),
    env: serverEnvironment({
      NODUS_DATA_DIR: root,
      NODUS_HOST: '127.0.0.1',
      NODUS_PORT: String(await freePort()),
      NODUS_ADMIN_EMAIL: 'partial-admin@example.test',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  try {
    const exitCode = await new Promise((resolve) => child.once('exit', resolve));
    assert.notEqual(exitCode, 0);
    assert.match(logs.join(''), /must be configured together/);
    assert.ok(!logs.join('').includes('partial-admin@example.test'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Nodus Server pairs a desktop publisher and protects read-only MCP with OAuth + space ACLs', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-server-test-'));
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const setupToken = 'test-setup-token-very-long';
  const logs = [];
  const child = spawn(process.execPath, ['server/server.mjs'], {
    cwd: path.resolve('.'),
    env: serverEnvironment({
      NODUS_DATA_DIR: root,
      NODUS_HOST: '127.0.0.1',
      NODUS_PORT: String(port),
      NODUS_PUBLIC_URL: origin,
      NODUS_SETUP_TOKEN: setupToken,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));

  try {
    await waitForHealth(origin, child, logs);

    const initialSetupResponse = await fetch(`${origin}/setup`);
    assert.equal(initialSetupResponse.status, 200);
    const initialSetupHtml = await initialSetupResponse.text();
    assert.match(initialSetupHtml, /<html lang="en">/);
    assert.match(initialSetupHtml, /<h1>Set up Nodus Server<\/h1>/);

    const setup = await postForm(`${origin}/setup`, {
      setupToken,
      name: 'Nodus Test',
      publicUrl: origin,
      email: 'admin@example.test',
      password: 'admin-password-strong',
    });
    assert.equal(setup.status, 303);
    const adminCookie = cookieFrom(setup);

    let dashboardResponse = await fetch(`${origin}/`, { headers: { cookie: adminCookie } });
    let dashboard = await dashboardResponse.text();
    const csrf = hidden(dashboard, 'csrf');

    for (const [name, description] of [['Curso de teoría', 'Materiales del curso'], ['Vault privado', 'No asignado']]) {
      const created = await postForm(`${origin}/admin/spaces`, { csrf, name, description }, { headers: { cookie: adminCookie } });
      assert.equal(created.status, 303);
    }

    dashboardResponse = await fetch(`${origin}/`, { headers: { cookie: adminCookie } });
    dashboard = await dashboardResponse.text();
    const spaceIds = [...dashboard.matchAll(/<code>([0-9a-f-]{36})<\/code>/g)].map((match) => match[1]);
    assert.equal(spaceIds.length, 2);
    const [sharedSpaceId, privateSpaceId] = spaceIds;

    const readerCreated = await postForm(`${origin}/admin/users`, {
      csrf,
      email: 'student@example.test',
      password: 'student-password-strong',
      spaceId: sharedSpaceId,
    }, { headers: { cookie: adminCookie } });
    assert.equal(readerCreated.status, 303);

    const pairingPage = await postForm(`${origin}/admin/pairing`, { csrf, spaceId: sharedSpaceId }, { headers: { cookie: adminCookie } });
    assert.equal(pairingPage.status, 200);
    const pairingHtml = await pairingPage.text();
    const pairingCode = pairingHtml.match(/<h2><code>([^<]+)<\/code><\/h2>/)?.[1];
    assert.ok(pairingCode);

    const pairedResponse = await fetch(`${origin}/api/v1/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: pairingCode, deviceName: 'Test desktop' }),
    });
    assert.equal(pairedResponse.status, 200);
    const paired = await pairedResponse.json();
    assert.equal(paired.space.id, sharedSpaceId);
    assert.ok(paired.accessToken);
    assert.equal(paired.server.language, 'en');

    const anonymousLanguageChange = await fetch(`${origin}/api/v1/settings/language`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'es' }),
    });
    assert.equal(anonymousLanguageChange.status, 401, 'server language changes require a paired device token');

    const unsupportedLanguage = await fetch(`${origin}/api/v1/settings/language`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${paired.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'tr' }),
    });
    assert.equal(unsupportedLanguage.status, 400);

    for (const [language, heading] of [
      ['es', 'Entrar en Nodus Server'],
      ['fr', 'Se connecter à Nodus Server'],
      ['de', 'Bei Nodus Server anmelden'],
      ['pt', 'Iniciar sessão no Nodus Server'],
      ['pt-BR', 'Iniciar sessão no Nodus Server'],
      ['it', 'Accedi a Nodus Server'],
      ['en', 'Sign in to Nodus Server'],
    ]) {
      const changed = await fetch(`${origin}/api/v1/settings/language`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${paired.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ language }),
      });
      assert.equal(changed.status, 200);
      assert.equal((await changed.json()).language, language);
      const loginPageResponse = await fetch(`${origin}/login`);
      const loginPageHtml = await loginPageResponse.text();
      assert.match(loginPageHtml, new RegExp(`<html lang="${language}">`));
      assert.ok(loginPageHtml.includes(`<h1>${heading}</h1>`));
    }

    const reusedPairing = await fetch(`${origin}/api/v1/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: pairingCode, deviceName: 'Second desktop' }),
    });
    assert.equal(reusedPairing.status, 401, 'pairing codes must be single-use');

    const snapshot = {
      format: 'nodus.server-snapshot',
      formatVersion: 1,
      generatedAt: new Date().toISOString(),
      vault: { id: 'vault-test', name: 'Curso', type: 'academic' },
      tables: {
        works: [{ nodus_id: 'work-1', title: 'La condición humana', abstract: 'Teoría de la acción.' }],
        ideas: [{ global_id: 'idea-1', label: 'Acción', statement: 'Actuar inaugura algo nuevo.' }],
        themes: [{ id: 'theme-1', label: 'Teoría política' }],
        edges: [],
      },
    };
    const published = await fetch(`${origin}/api/v1/spaces/${sharedSpaceId}/snapshot`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${paired.accessToken}`,
        'content-type': 'application/vnd.nodus.snapshot+json',
        'content-encoding': 'gzip',
        'x-nodus-revision': 'revision-1',
      },
      body: gzipSync(JSON.stringify(snapshot)),
    });
    assert.equal(published.status, 200);
    assert.equal((await published.json()).unchanged, false);

    const unchanged = await fetch(`${origin}/api/v1/spaces/${sharedSpaceId}/snapshot`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${paired.accessToken}`,
        'content-type': 'application/vnd.nodus.snapshot+json',
        'content-encoding': 'gzip',
        'x-nodus-revision': 'revision-1',
      },
      body: gzipSync(JSON.stringify(snapshot)),
    });
    assert.equal((await unchanged.json()).unchanged, true);

    const unauthorizedMcp = await fetch(`${origin}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(unauthorizedMcp.status, 401);
    assert.match(unauthorizedMcp.headers.get('www-authenticate') || '', /resource_metadata=/);

    const registered = await fetch(`${origin}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'MCP test client', redirect_uris: ['https://client.example/callback'] }),
    });
    assert.equal(registered.status, 201);
    const client = await registered.json();

    for (const redirectUri of [
      'http://client.example/callback',
      'https://user:password@client.example/callback',
      'https://client.example/callback#fragment',
    ]) {
      const rejectedRegistration = await fetch(`${origin}/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_name: 'Untrusted callback test', redirect_uris: [redirectUri] }),
      });
      assert.equal(rejectedRegistration.status, 400, `unsafe OAuth redirect must be rejected: ${redirectUri}`);
    }

    const readerLogin = await postForm(`${origin}/login`, {
      email: 'student@example.test',
      password: 'student-password-strong',
      next: '/',
    });
    assert.equal(readerLogin.status, 303);
    assert.equal(readerLogin.headers.get('location'), '/account', 'reader accounts land on their account page');
    const readerCookie = cookieFrom(readerLogin);
    const secondReaderLogin = await postForm(`${origin}/login`, {
      email: 'student@example.test',
      password: 'student-password-strong',
      next: '/account',
    });
    assert.equal(secondReaderLogin.status, 303);
    const secondReaderCookie = cookieFrom(secondReaderLogin);
    const tokens = await oauthLogin(origin, client, readerCookie);

    const initialized = await mcp(origin, tokens.access_token, 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'server-test', version: '1.0.0' },
    });
    assert.equal(initialized.result.serverInfo.name, 'nodus-server');

    const listed = await mcp(origin, tokens.access_token, 'tools/call', {
      name: 'nodus_list_spaces', arguments: {},
    }, 2);
    assert.deepEqual(listed.result.structuredContent.spaces.map((space) => space.id), [sharedSpaceId]);

    const searched = await mcp(origin, tokens.access_token, 'tools/call', {
      name: 'nodus_search', arguments: { spaceId: sharedSpaceId, query: 'acción' },
    }, 3);
    assert.ok(searched.result.structuredContent.results.length >= 1);

    const denied = await mcp(origin, tokens.access_token, 'tools/call', {
      name: 'nodus_get_space_summary', arguments: { spaceId: privateSpaceId },
    }, 4);
    assert.equal(denied.result.isError, true);

    const refreshed = await postForm(`${origin}/oauth/token`, {
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: tokens.refresh_token,
      resource: `${origin}/mcp`,
    });
    assert.equal(refreshed.status, 200);
    const refreshedTokens = await refreshed.json();
    assert.ok(refreshedTokens.refresh_token);
    const replayedRefresh = await postForm(`${origin}/oauth/token`, {
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: tokens.refresh_token,
      resource: `${origin}/mcp`,
    });
    assert.equal(replayedRefresh.status, 400, 'refresh tokens rotate and cannot be replayed');

    const accountResponse = await fetch(`${origin}/account`, { headers: { cookie: readerCookie } });
    assert.equal(accountResponse.status, 200);
    const account = await accountResponse.text();
    const accountCsrf = hidden(account, 'csrf');
    const wrongCurrentPassword = await postForm(`${origin}/account/password`, {
      csrf: accountCsrf,
      currentPassword: 'incorrect-password',
      newPassword: 'student-password-updated',
      confirmPassword: 'student-password-updated',
    }, { headers: { cookie: readerCookie } });
    assert.equal(wrongCurrentPassword.status, 400);
    assert.match(await wrongCurrentPassword.text(), /current password is incorrect/i);

    const changedPassword = await postForm(`${origin}/account/password`, {
      csrf: accountCsrf,
      currentPassword: 'student-password-strong',
      newPassword: 'student-password-updated',
      confirmPassword: 'student-password-updated',
    }, { headers: { cookie: readerCookie } });
    assert.equal(changedPassword.status, 303);
    assert.match(changedPassword.headers.get('location') || '', /^\/account\?notice=/);

    const currentSessionStillWorks = await fetch(`${origin}/account`, { headers: { cookie: readerCookie }, redirect: 'manual' });
    assert.equal(currentSessionStillWorks.status, 200, 'the session changing its own password remains valid');
    const secondSessionRevoked = await fetch(`${origin}/account`, { headers: { cookie: secondReaderCookie }, redirect: 'manual' });
    assert.equal(secondSessionRevoked.status, 303);
    assert.match(secondSessionRevoked.headers.get('location') || '', /^\/login/);

    const oldPasswordRejected = await postForm(`${origin}/login`, {
      email: 'student@example.test', password: 'student-password-strong', next: '/account',
    });
    assert.equal(oldPasswordRejected.status, 401);
    const updatedPasswordAccepted = await postForm(`${origin}/login`, {
      email: 'student@example.test', password: 'student-password-updated', next: '/account',
    });
    assert.equal(updatedPasswordAccepted.status, 303);
    const updatedReaderCookie = cookieFrom(updatedPasswordAccepted);

    for (const accessToken of [tokens.access_token, refreshedTokens.access_token]) {
      const revokedAccess = await fetch(`${origin}/mcp`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/list' }),
      });
      assert.equal(revokedAccess.status, 401, 'password changes revoke OAuth access tokens');
    }
    const revokedRefresh = await postForm(`${origin}/oauth/token`, {
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: refreshedTokens.refresh_token,
      resource: `${origin}/mcp`,
    });
    assert.equal(revokedRefresh.status, 400, 'password changes revoke OAuth refresh tokens');

    dashboardResponse = await fetch(`${origin}/`, { headers: { cookie: adminCookie } });
    dashboard = await dashboardResponse.text();
    const readerId = dashboard.match(/\/admin\/users\/password\?userId=([0-9a-f-]{36})/)?.[1];
    assert.ok(readerId, 'the administrator can open a reader password reset');
    const resetPageResponse = await fetch(`${origin}/admin/users/password?userId=${readerId}`, { headers: { cookie: adminCookie } });
    assert.equal(resetPageResponse.status, 200);
    const resetPage = await resetPageResponse.text();
    const resetCsrf = hidden(resetPage, 'csrf');
    const resetPassword = await postForm(`${origin}/admin/users/password`, {
      csrf: resetCsrf,
      userId: readerId,
      newPassword: 'temporary-password-reset',
      confirmPassword: 'temporary-password-reset',
    }, { headers: { cookie: adminCookie } });
    assert.equal(resetPassword.status, 303);
    const resetSessionRevoked = await fetch(`${origin}/account`, { headers: { cookie: updatedReaderCookie }, redirect: 'manual' });
    assert.equal(resetSessionRevoked.status, 303, 'an administrator reset revokes every reader session');
    const resetPasswordAccepted = await postForm(`${origin}/login`, {
      email: 'student@example.test', password: 'temporary-password-reset', next: '/account',
    });
    assert.equal(resetPasswordAccepted.status, 303);
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});
