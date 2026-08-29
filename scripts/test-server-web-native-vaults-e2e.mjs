/*
 * Server-native vault manager E2E.
 *
 * This suite deliberately owns its whole server profile: it starts nodus-server with a
 * temporary NODUS_DATA_DIR, creates its fixtures through HTTP, restarts the same process
 * against the same temporary directory, and removes that directory in finally. It must never
 * be pointed at a developer profile (the environment helper also strips inherited NODUS_*).
 *
 * The first test is the deterministic API/control-plane contract. The second test drives the
 * compiled Server Web app in Chromium and covers the badge interaction and native activation.
 * Run after `npm run build:server-web` (as the other server-web E2E suites do).
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import test from 'node:test';
import { chromium } from 'playwright-core';
import {
  cookieFrom, hidden, postForm, repoRoot, serverEnvironment, stopServer, waitForHealth,
} from './lib/nodusServerHarness.mjs';
import { requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

// The server this suite spawns creates native vaults through better-sqlite3, which CI
// builds against Electron's ABI. Started from the system Node it falls back to the sqlite3
// CLI, whose build on the runner has no FTS5, and creation answers 500 instead of 201.
// Re-exec here so process.execPath -- the binary the server is spawned with below -- is
// Electron's Node, the same runtime the published image resolves better-sqlite3 under.
if (!requireElectronRuntime(path.join(repoRoot, 'scripts/test-server-web-native-vaults-e2e.mjs'), '--electron-native-vaults-test')) {
  process.exit(0);
}

const TYPES = [
  'academic', 'estudio', 'primary_sources', 'genealogy', 'prosopography',
  'databases', 'testimonios', 'worldbuilding', 'docencia',
];
const chromeCandidates = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function boot(root) {
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const logs = [];
  const child = spawn(process.execPath, ['server/server.mjs'], {
    cwd: repoRoot,
    env: serverEnvironment({
      NODUS_DATA_DIR: root,
      NODUS_HOST: '127.0.0.1',
      NODUS_PORT: String(port),
      NODUS_PUBLIC_URL: origin,
      NODUS_ADMIN_EMAIL: 'native-e2e-admin@example.test',
      NODUS_ADMIN_PASSWORD: 'native-e2e-administrator-password',
      NODUS_DEPLOYMENT_MODE: 'advanced',
      NODUS_AI_KEYRING_FILE: path.join(root, 'native-e2e-keyring.json'),
      NODUS_AI_CREATE_KEYRING: '1',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  await waitForHealth(origin, child, logs);
  return { child, origin, logs };
}

async function signIn(server) {
  const response = await postForm(`${server.origin}/login`, {
    email: 'native-e2e-admin@example.test',
    password: 'native-e2e-administrator-password',
    next: '/',
  });
  assert.equal(response.status, 303, 'admin login must succeed');
  return cookieFrom(response);
}

async function csrf(server, cookie) {
  const response = await fetch(`${server.origin}/`, { headers: { cookie } });
  assert.equal(response.status, 200);
  return hidden(await response.text(), 'csrf');
}

async function request(server, cookie, method, pathname, value, token) {
  const headers = { cookie, origin: server.origin };
  if (value !== undefined) {
    headers['content-type'] = 'application/json';
    if (token) headers['x-csrf-token'] = token;
  }
  return fetch(`${server.origin}${pathname}`, {
    method,
    headers,
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
}

async function createNative(server, cookie, token, type, name = `Native ${type}`) {
  const response = await request(server, cookie, 'POST', '/api/v2/vaults', { name, vaultType: type }, token);
  assert.equal(response.status, 201, `native ${type} creation must succeed`);
  const payload = await response.json();
  assert.equal(payload.vault.vaultType, type);
  assert.equal(payload.vault.storageKind, 'server_native');
  assert.equal(payload.vault.authorityMode, 'server');
  assert.equal(payload.vault.initializationState, 'ready');
  return payload.vault;
}

test('server-native lifecycle and authorization are isolated and restart-safe', { timeout: 90_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-native-web-e2e-'));
  let server;
  try {
    server = await boot(root);
    let cookie = await signIn(server);
    let token = await csrf(server, cookie);

    const created = [];
    for (const type of TYPES) created.push(await createNative(server, cookie, token, type));
    assert.deepEqual(
      (await (await request(server, cookie, 'GET', '/api/v2/vaults')).json()).vaults
        .filter((vault) => vault.storageKind === 'server_native').map((vault) => vault.vaultType).sort(),
      [...TYPES].sort(),
      'all nine native vault types must be listed',
    );

    // Missing and cross-site CSRF must not mutate a vault.
    let response = await request(server, cookie, 'PATCH', `/api/v2/vaults/${created[0].id}`, { name: 'Must fail' });
    assert.equal(response.status, 403, 'mutating without CSRF must be rejected');
    response = await request(server, cookie, 'PATCH', `/api/v2/vaults/${created[0].id}`, { name: 'Must fail' }, 'wrong-token');
    assert.equal(response.status, 403, 'mutating with an invalid CSRF must be rejected');
    response = await fetch(`${server.origin}/api/v2/vaults/${created[0].id}`, {
      method: 'PATCH', headers: { cookie, origin: 'https://attacker.example', 'content-type': 'application/json', 'x-csrf-token': token },
      body: JSON.stringify({ name: 'Must fail' }),
    });
    assert.equal(response.status, 403, 'cross-site mutation must be rejected');

    // Rename and optimistic revision conflict.
    response = await request(server, cookie, 'PATCH', `/api/v2/vaults/${created[0].id}`, { name: 'Native renamed', expectedRevision: 0 }, token);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).vault.revision, 1);
    response = await request(server, cookie, 'PATCH', `/api/v2/vaults/${created[0].id}`, { name: 'Stale name', expectedRevision: 0 }, token);
    assert.equal(response.status, 409, 'stale metadata updates must conflict');

    // Export, reset, import, duplicate and delete all use the real binary boundary.
    response = await request(server, cookie, 'GET', `/api/v2/vaults/${created[0].id}/export`);
    assert.equal(response.status, 200);
    const exported = Buffer.from(await response.arrayBuffer());
    assert.ok(exported.subarray(0, 16).toString().startsWith('SQLite format 3'), 'export must be SQLite');
    response = await request(server, cookie, 'POST', `/api/v2/vaults/${created[0].id}/reset`, { expectedRevision: 1 }, token);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).vault.revision, 2);
    response = await fetch(`${server.origin}/api/v2/vaults/${created[0].id}/import?expectedRevision=2`, {
      method: 'POST', headers: { cookie, origin: server.origin, 'content-type': 'application/vnd.sqlite3', 'x-csrf-token': token }, body: exported,
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).vault.revision, 3);
    response = await request(server, cookie, 'POST', `/api/v2/vaults/${created[0].id}/duplicate`, { name: 'Native duplicate' }, token);
    assert.equal(response.status, 201);
    const duplicate = (await response.json()).vault;
    response = await request(server, cookie, 'DELETE', `/api/v2/vaults/${duplicate.id}?expectedRevision=0`, {}, token);
    assert.equal(response.status, 200);

    // A desktop publication is visible through the shared selector contract but immutable.
    const before = new Set((await (await request(server, cookie, 'GET', '/api/v2/vaults')).json()).vaults.map((vault) => vault.id));
    const legacyCreate = await postForm(`${server.origin}/admin/spaces`, { csrf: token, name: 'Desktop publication' }, { headers: { cookie } });
    assert.equal(legacyCreate.status, 303);
    const legacyList = (await (await request(server, cookie, 'GET', '/api/v2/vaults')).json()).vaults;
    const legacy = legacyList.find((vault) => !before.has(vault.id));
    assert.ok(legacy);
    assert.equal(legacy.storageKind, 'desktop_published');
    response = await request(server, cookie, 'PATCH', `/api/v2/vaults/${legacy.id}`, { name: 'Cannot rename' }, token);
    assert.equal(response.status, 409, 'desktop-published spaces must be read-only');

    // Stop and boot against the same temporary profile: metadata and native databases survive.
    await stopServer(server.child);
    server = await boot(root);
    cookie = await signIn(server);
    token = await csrf(server, cookie);
    const afterRestart = (await (await request(server, cookie, 'GET', '/api/v2/vaults')).json()).vaults;
    const persisted = afterRestart.find((vault) => vault.id === created[0].id);
    assert.equal(persisted?.name, 'Native renamed');
    assert.equal(persisted?.revision, 3);
    assert.equal(afterRestart.find((vault) => vault.id === legacy.id)?.storageKind, 'desktop_published');
  } finally {
    if (server) await stopServer(server.child);
    await rm(root, { recursive: true, force: true });
  }
});

test('compiled Server Web badge closes on second click and activates a native vault', { timeout: 90_000 }, async (t) => {
  const chrome = chromeCandidates.find((candidate) => existsSync(candidate));
  if (!chrome) { t.skip('Chrome/Chromium is not installed; API lifecycle test remains runnable.'); return; }

  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-native-web-ui-e2e-'));
  let server;
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    server = await boot(root);
    const cookie = await signIn(server);
    const token = await csrf(server, cookie);
    const native = await createNative(server, cookie, token, 'worldbuilding', 'UI native world');
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`); });
    await page.goto(`${server.origin}/login?next=/`, { waitUntil: 'networkidle' });
    await page.locator('#login-email').fill('native-e2e-admin@example.test');
    await page.locator('#login-password').fill('native-e2e-administrator-password');
    await Promise.all([page.waitForURL(new RegExp(`${server.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`)), page.locator('button[type="submit"]').click()]);
    await page.getByTestId('worldbuilding-overview').waitFor();
    const badge = page.getByTestId('header-vault-badge');
    await badge.waitFor();
    await badge.click();
    await page.getByTestId('vault-manager').waitFor();
    assert.equal(await badge.getAttribute('aria-expanded'), 'true');
    await badge.click();
    await page.getByTestId('vault-manager').waitFor({ state: 'detached' });
    assert.equal(await badge.getAttribute('aria-expanded'), 'false', 'second badge click must close the manager');
    await badge.click();
    await page.getByTestId(`vault-option-${native.id}`).click();
    await page.getByTestId('worldbuilding-overview').waitFor();
    assert.match(await page.locator('body').innerText(), /UI native world/);
    await page.getByTestId('overview-metrics').getByRole('button').first().click();
    await page.getByTestId('native-content-surface').waitFor();
    await page.getByTestId('native-content-create').click();
    await page.getByRole('dialog', { name: 'New character' }).waitFor();
    await page.getByRole('button', { name: 'Close' }).click();
    assert.doesNotMatch(await page.locator('body').innerText(), /No se ha podido cargar esta vista|Internal Server Error/i);
    assert.deepEqual(errors, [], 'activating a native vault must not produce browser errors');
    await context.close();
  } finally {
    await browser.close();
    if (server) await stopServer(server.child);
    await rm(root, { recursive: true, force: true });
  }
});
