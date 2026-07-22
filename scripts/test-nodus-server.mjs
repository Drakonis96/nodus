import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import test from 'node:test';

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

test('Nodus Server pairs a desktop publisher and protects read-only MCP with OAuth + space ACLs', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-server-test-'));
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const setupToken = 'test-setup-token-very-long';
  const logs = [];
  const child = spawn(process.execPath, ['server/server.mjs'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      NODUS_DATA_DIR: root,
      NODUS_HOST: '127.0.0.1',
      NODUS_PORT: String(port),
      NODUS_PUBLIC_URL: origin,
      NODUS_SETUP_TOKEN: setupToken,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));

  try {
    await waitForHealth(origin, child, logs);

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

    const readerLogin = await postForm(`${origin}/login`, {
      email: 'student@example.test',
      password: 'student-password-strong',
      next: '/',
    });
    assert.equal(readerLogin.status, 303);
    const readerCookie = cookieFrom(readerLogin);
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
    assert.ok((await refreshed.json()).refresh_token);
    const replayedRefresh = await postForm(`${origin}/oauth/token`, {
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: tokens.refresh_token,
      resource: `${origin}/mcp`,
    });
    assert.equal(replayedRefresh.status, 400, 'refresh tokens rotate and cannot be replayed');
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    await rm(root, { recursive: true, force: true });
  }
});
