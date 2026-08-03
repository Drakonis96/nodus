// End-to-end: basic mode, driven through the REAL Electron app.
//
// Everything below the interface is already covered by scripts/test-local-server.mjs, which
// drives server.mjs directly. What no unit test can see is the part that only exists once
// Electron is running: that the app can spawn the bundled server with its own Node, that the
// provisioning handshake works through real IPC, that the vault ends up genuinely published,
// and — the one that matters most on a laptop — that quitting the app takes the server with it
// instead of leaving an orphan listening on the network.
//
// Requires a build (dist/ + dist-electron/); run via `npm run test:e2e:local-server`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// Re-exec under Electron-as-Node, like every other script in this suite.
if (!process.argv.includes('--electron-e2e-local-server')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/e2e-local-server.mjs'), '--electron-e2e-local-server'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

if (!existsSync(path.join(repoRoot, 'dist-electron/main.js')) || !existsSync(path.join(repoRoot, 'dist/index.html'))) {
  console.log('[e2e] no build found — running npm run build first…');
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
}

// Never "nodus": a profile by that name shares the real installation's secret store, and an
// isolated run would delete the user's actual API keys.
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-e2e-localserver-'));

async function waitFor(label, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Timed out waiting for: ${label}.${last ? ` Last error: ${last.message}` : ''}`);
}

/** Is anything answering /healthz on this port? Used to prove both start and stop. */
async function serverAlive(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1_200) });
    return response.ok;
  } catch {
    return false;
  }
}

let app = null;
let port = 0;
try {
  const childEnv = {
    ...process.env,
    NODUS_USERDATA: userData,
    NODUS_DISABLE_AUTO_UPDATE: '1',
    NODUS_E2E_UPDATE_STATUS: 'not-available',
    NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;

  app = await electron.launch({
    executablePath: require('electron'),
    args: [repoRoot],
    env: childEnv,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => document.getElementById('root')?.childElementCount > 0);
  console.log('[e2e] app window is up');

  // Give the local server a port nothing else on this machine is using, so a developer already
  // running Nodus Server on 7443 does not turn a real failure into a confusing one.
  const chosen = 7000 + Math.floor((Date.now() % 900));
  port = await page.evaluate(async (value) => {
    await window.nodus.updateSettings({ localServerPort: value });
    return (await window.nodus.getSettings()).localServerPort;
  }, chosen);
  assert.equal(port, chosen, 'the port setting must survive a round trip');
  assert.equal(await serverAlive(port), false, 'nothing must be listening before we start');

  // ── Start ────────────────────────────────────────────────────────────────
  const started = await page.evaluate(() => window.nodus.startLocalServer());
  assert.equal(started.phase, 'running', `the server should be running: ${started.error ?? ''}`);
  assert.equal(started.access, 'loopback', 'the default must share with nothing');
  assert.equal(started.localUrl, `http://127.0.0.1:${port}`);
  assert.equal(started.shareUrl, null, 'loopback must offer no address to other devices');
  assert.ok(started.adminEmail, 'an administrator account must exist for the web administration');
  assert.ok(await serverAlive(port), 'the bundled server must actually answer');

  // The panel offers to show and copy this password, and there is no other copy of it anywhere
  // the user can reach. A rendering test can only prove the markup; this proves the whole path —
  // keychain, main process, preload, renderer — actually hands one over.
  const adminPassword = await page.evaluate(() => window.nodus.getLocalServerAdminPassword());
  assert.ok(adminPassword && adminPassword.length >= 24, 'the generated administration password must reach the interface');
  assert.notEqual(adminPassword, started.adminEmail);
  console.log(`[e2e] local server running on ${started.localUrl}`);

  // Tailscale is reported honestly whether or not it is installed on this machine.
  assert.equal(typeof started.tailscale.installed, 'boolean');
  if (started.tailscale.installed) console.log(`[e2e] tailscale detected: connected=${started.tailscale.connected}`);

  // ── Connect the open vault, with no code typed by anybody ────────────────
  const paired = await page.evaluate(() => window.nodus.connectVaultToLocalServer());
  assert.equal(paired.ok, true);
  assert.ok(paired.spaceId, 'pairing must return the space it created');
  console.log(`[e2e] vault paired into space "${paired.spaceName}"`);

  // The vault is genuinely published, not merely paired: the overview says so, and the desktop
  // kept the loopback URL rather than the server's own public URL.
  const overview = await waitFor('the vault to report itself connected', async () => {
    const value = await page.evaluate(() => window.nodus.getNodusServerOverview());
    return value.activeVault.connected ? value : null;
  });
  const connection = overview.connections.find((entry) => entry.isActiveVault);
  assert.ok(connection, 'the active vault must appear among the connections');
  assert.equal(connection.url, `http://127.0.0.1:${port}`, 'basic mode must publish over loopback');
  await waitFor('the first publication to land', async () => {
    const value = await page.evaluate(() => window.nodus.getNodusServerOverview());
    return value.connections.find((entry) => entry.isActiveVault)?.lastSyncAt;
  }, 60_000);
  console.log('[e2e] first publication landed');

  // Re-connecting the same vault must reuse its space rather than collect duplicates.
  const again = await page.evaluate(() => window.nodus.connectVaultToLocalServer());
  assert.equal(again.spaceId, paired.spaceId, 'reconnecting must not create a second space');

  // ── Power ────────────────────────────────────────────────────────────────
  // Only the switch that needs no administrator: the other one changes a machine-wide setting
  // and must never be exercised by a test run.
  const awake = await page.evaluate(() => window.nodus.setLocalServerKeepAwake(true));
  assert.equal(awake.awake, true, 'the idle-sleep block must actually be held');
  const released = await page.evaluate(() => window.nodus.setLocalServerKeepAwake(false));
  assert.equal(released.awake, false, 'and must be released again');
  assert.equal(released.lidOpenServing, false, 'this test must never engage the lid switch');

  // ── Stop ─────────────────────────────────────────────────────────────────
  const stopped = await page.evaluate(() => window.nodus.stopLocalServer());
  assert.equal(stopped.phase, 'stopped');
  assert.ok(await waitFor('the port to go quiet', async () => !(await serverAlive(port))));
  console.log('[e2e] stopped cleanly');

  // ── And the one that matters on a laptop: quitting takes it with us ──────
  const restarted = await page.evaluate(() => window.nodus.startLocalServer());
  assert.equal(restarted.phase, 'running', 'it must be startable again after a stop');
  assert.ok(await serverAlive(port));

  await app.close();
  app = null;
  assert.ok(
    await waitFor('the server to die with the app', async () => !(await serverAlive(port)), 15_000),
    'quitting Nodus must not leave an orphan server listening',
  );
  console.log('[e2e] closing the app took the server with it');

  console.log('\n[e2e] basic mode: OK');
} finally {
  if (app) await app.close().catch(() => undefined);
  // A leaked server would keep the port busy for the next run and, worse, keep serving.
  if (port && await serverAlive(port)) console.error(`[e2e] WARNING: something is still listening on ${port}`);
  await rm(userData, { recursive: true, force: true });
}
