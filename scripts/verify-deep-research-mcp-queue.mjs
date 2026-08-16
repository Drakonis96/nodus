// Live verification of Deep Research queued over MCP, end to end: launches the REAL
// Electron app against a throwaway profile, turns the MCP server on through the app's
// own settings, connects a genuine MCP client over HTTP, queues reports with
// nodus_enqueue_deep_research, and checks what the app window does about it.
//
// What no unit test can see is what this proves: a report a client queued over the
// network reaches the Nodus window — main-process lane → broadcast → preload → view —
// and lands in the user's gallery, so work that spends their tokens is never invisible.
//
// Nothing here is timed: on an empty vault a report finishes in tens of milliseconds,
// so "look at the strip while it runs" would be a race. The assertions are made instead
// against the complete history of lane snapshots the window received (every state the
// lane was ever in) and against the durable result in the gallery.
//
// Requires a build (dist/ + dist-electron/):
//   npm run build && node scripts/verify-deep-research-mcp-queue.mjs
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;
// Never named "nodus": a profile with that name would be the user's real one.
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-drq-verify-'));
const port = 4600 + Math.floor(Math.random() * 300);

async function waitFor(label, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

let app = null;
let client = null;
try {
  const childEnv = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });

  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return !!root && root.children.length > 0;
  }, { timeout: 30_000 });
  // Past the what's-new and update-tour overlays: they are modal, and this walk is
  // about the queue, not about onboarding (which scripts/e2e-smoke.mjs covers screen
  // by screen). Each guide records its own "seen" flag in localStorage.
  await page.evaluate((version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
  }, appVersion);
  // Past first run: this walk is about the queue, not about onboarding (which
  // scripts/e2e-smoke.mjs already covers screen by screen).
  await page.evaluate(() =>
    window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 99, tourComplete: true, recoverySetupVersion: 99, mascotStyleChosen: true, uiLanguage: 'es' })
  );
  await page.reload();
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return !!root && root.children.length > 0;
  }, { timeout: 30_000 });
  console.log('[verify] renderer mounted');

  // Every lane snapshot the window receives, from before anything is queued. This is a
  // complete history, so assertions about it never depend on catching a moment.
  await page.evaluate(() => {
    window.__laneEvents = [];
    window.nodus.onDeepResearchQueue((jobs) => window.__laneEvents.push(jobs));
  });

  // Sit on Deep Research, empty, before a single report exists.
  await page.locator('[data-tour="nav-deepResearch"]').click();
  await waitFor('the empty Deep Research gallery', async () => (await page.locator('.card').count()) === 0);

  // Turn the MCP server on the way a user would: through Settings.
  const token = await page.evaluate(async (mcpPort) => {
    await window.nodus.updateSettings({ mcpEnabled: true, mcpPort });
    return (await window.nodus.getSettings()).mcpToken;
  }, port);
  assert.ok(token, 'enabling MCP mints a bearer token');
  await waitFor('the MCP server to listen', async () => (await page.evaluate(() => window.nodus.getMcpStatus())).running);
  console.log(`[verify] MCP server listening on ${port}`);

  // A genuine MCP client over HTTP — the same path a real client takes.
  const { Client } = await import(path.join(repoRoot, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'));
  const { StreamableHTTPClientTransport } = await import(
    path.join(repoRoot, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js')
  );
  client = new Client({ name: 'deep-research-queue-verify', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    })
  );

  const names = (await client.listTools()).tools.map((tool) => tool.name);
  for (const tool of [
    'nodus_enqueue_deep_research',
    'nodus_list_deep_research_jobs',
    'nodus_get_deep_research_job',
    'nodus_cancel_deep_research_job',
  ]) {
    assert.ok(names.includes(tool), `${tool} is offered over the real protocol`);
  }
  console.log('[verify] the four queue tools are reachable over the real protocol');

  const call = async (name, args) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);

  // Four reports at once. However they interleave, the lane must never have run two.
  const objectives = [0, 1, 2, 3].map((i) => `Informe ${i} encolado por un cliente MCP`);
  const queued = await Promise.all(objectives.map((objective) => call('nodus_enqueue_deep_research', { objective, save: true })));
  for (const [index, result] of queued.entries()) {
    assert.ok(result.job.id, `report ${index} was accepted`);
    assert.equal(result.job.origin, 'mcp');
    assert.ok(result.job.vaultId, 'the job records the vault it was queued against');
  }
  console.log('[verify] four reports queued over MCP');

  await waitFor('every queued report to finish', async () => {
    const statuses = await Promise.all(queued.map(async ({ job }) => (await call('nodus_get_deep_research_job', { jobId: job.id })).job.status));
    return statuses.every((status) => status === 'completed');
  });

  // The single lane: no snapshot the window ever received had two reports generating.
  const worst = await page.evaluate(() =>
    Math.max(0, ...window.__laneEvents.map((jobs) => jobs.filter((job) => job.status === 'running').length))
  );
  assert.equal(worst, 1, 'the lane never generated two reports at once');

  // The window learned about work it did not start, while it was still waiting.
  const seen = await page.evaluate(() =>
    window.__laneEvents.flat().filter((job) => job.origin === 'mcp').map((job) => `${job.title}|${job.status}`)
  );
  for (const objective of objectives) {
    assert.ok(seen.includes(`${objective}|running`), `the window saw "${objective}" generating`);
  }
  assert.ok(
    seen.some((entry) => entry.endsWith('|queued')),
    'a report waiting its turn is shown as queued, not as running'
  );
  console.log('[verify] the lane reached the renderer over the preload bridge, one report at a time');

  // …and the finished reports land in the gallery without the user reloading anything.
  await waitFor('the reports to appear in the gallery', async () => (await page.locator('.card').count()) >= objectives.length);
  const detail = await call('nodus_get_deep_research_job', { jobId: queued[0].job.id, includeReport: true });
  assert.ok(detail.job.savedDraftId, 'save=true files the report as a draft');
  assert.ok(detail.report.draft.title, 'includeReport returns the report itself');
  assert.ok(
    await page.getByText(detail.report.draft.title, { exact: false }).first().isVisible(),
    'the report queued over MCP is on screen in the gallery'
  );
  console.log('[verify] the finished reports are in the gallery, no reload needed');

  const listed = await call('nodus_list_deep_research_jobs', { status: 'finished' });
  assert.equal(listed.jobs.length, objectives.length);
  assert.equal(listed.running, false);

  // The app's own path goes through the same lane: the window still gets its report,
  // and the lane records it as `app` — which is how the strip avoids showing it twice.
  const appReport = await page.evaluate(() =>
    window.nodus.generateDeepResearchReport({ objective: 'Informe pedido desde la ventana de Nodus' })
  );
  assert.ok(appReport.draft.title, 'a report started in the window still comes back to it');
  const laneAfter = await call('nodus_list_deep_research_jobs', { status: 'all' });
  const appJob = laneAfter.jobs.find((job) => job.objective === 'Informe pedido desde la ventana de Nodus');
  assert.ok(appJob, 'the window report went through the shared lane');
  assert.equal(appJob.origin, 'app');
  assert.equal(appJob.status, 'completed');
  console.log('[verify] reports started in the window share the lane and are marked as its own');

  assert.deepEqual(pageErrors.map((error) => error.message), [], 'no renderer errors');
  console.log('deep research MCP queue verification passed');
} finally {
  await client?.close().catch(() => {});
  await app?.close().catch(() => {});
  await rm(userData, { recursive: true, force: true });
}
