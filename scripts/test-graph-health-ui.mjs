// Settings › Data › Graph health and the repaired-themes notice in Main themes, rendered
// for real in jsdom against a stubbed preload bridge. Covers what the source cannot
// show: the three groups of findings, Repair disabled while the analysis queue writes and
// asking for confirmation first, the model-backed follow-ups hidden in Manual mode, and
// the theme reassignment calling the bridge and clearing the notice afterwards.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-graph-health-ui-'));
await symlink(path.join(repoRoot, 'node_modules'), path.join(outDir, 'node_modules'));
const entry = path.join(outDir, 'entry.tsx');
await writeFile(entry, [
  `export { GraphHealthPanel } from ${JSON.stringify(path.join(repoRoot, 'src/components/GraphHealthPanel.tsx'))};`,
  `export { ThemesModal } from ${JSON.stringify(path.join(repoRoot, 'src/views/ThemesModal.tsx'))};`,
  `export { FeedbackHost } from ${JSON.stringify(path.join(repoRoot, 'src/components/feedback.tsx'))};`,
].join('\n'));
const bundle = path.join(outDir, 'graph-health.cjs');
execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
  entry,
  '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
  '--loader:.tsx=tsx', '--jsx=automatic', `--tsconfig=${path.join(repoRoot, 'tsconfig.json')}`,
  '--loader:.png=empty', '--loader:.svg=empty', '--loader:.css=empty', '--loader:.webp=empty', '--loader:.mp3=empty',
  '--external:react', '--external:react/jsx-runtime', '--external:react-dom', '--external:react-dom/client',
  `--outfile=${bundle}`,
], { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] });

test.after(() => rm(outDir, { recursive: true, force: true }));

function defineGlobal(key, value) {
  try {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  } catch {
    // Left as Node defined it.
  }
}

const check = (id, category, count, works = []) => ({ id, category, count, works });

function report({ repairable = 3, rescan = 1, pending = [], rescanWorks = [] } = {}) {
  return {
    checks: [
      check('theme_links_missing_theme', 'repairable', repairable, [{ nodus_id: 'W1', title: 'Obra con temas rotos', count: repairable }]),
      check('rows_missing_idea', 'rescan', rescan, rescanWorks.map((work) => ({ ...work, count: 1 }))),
      check('hidden_edges', 'info', 2),
    ],
    totals: { repairable, rescan, info: 2 },
    rescanWorks,
    pendingThemeWorks: pending,
    checkedAt: '2026-09-28T00:00:00.000Z',
  };
}

async function render(element, bridge) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://nodus.test/' });
  for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (!(key in globalThis)) globalThis[key] = dom.window[key];
  }
  defineGlobal('window', dom.window);
  defineGlobal('document', dom.window.document);
  defineGlobal('navigator', dom.window.navigator);
  defineGlobal('Event', dom.window.Event);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.nodus = bridge;
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const act = React.act ?? require('react-dom/test-utils').act;
  const ui = require(bundle);
  const container = dom.window.document.getElementById('root');
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(React.Fragment, null, element(ui, React), React.createElement(ui.FeedbackHost)));
  });
  const click = async (node) => act(async () => { node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  const byTestId = (id) => dom.window.document.querySelector(`[data-testid="${id}"]`);
  const confirmButton = (label) => [...dom.window.document.querySelectorAll('button')]
    .find((button) => button.textContent.trim() === label && !button.dataset.testid);
  const settle = async () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return { dom, click, byTestId, confirmButton, settle, unmount: () => act(async () => root.unmount()) };
}

function bridge(overrides = {}) {
  const calls = { check: 0, repair: 0, reassign: [], dismiss: 0, rescan: [] };
  let current = overrides.report ?? report();
  const queueListeners = [];
  const api = {
    calls,
    setQueue: (value) => queueListeners.forEach((listener) => listener(value)),
    getQueue: async () => overrides.queue ?? { paused: false, items: [], total: 0, done: 0, failed: 0, maintenanceRunning: false },
    onQueueProgress: (listener) => { queueListeners.push(listener); return () => undefined; },
    checkGraphIntegrity: async () => { calls.check += 1; return current; },
    repairGraphIntegrity: async () => {
      calls.repair += 1;
      current = report({ repairable: 0, rescan: current.totals.rescan, pending: [{ nodus_id: 'W1', title: 'Obra con temas rotos' }], rescanWorks: current.rescanWorks });
      return { counts: {}, integrityFailedWorks: [], backupPath: '/tmp/backups/nodus-pre-graph-repair.sqlite', report: current };
    },
    reprocessRepairedThemeWorks: async (model, onProgress) => {
      calls.reassign.push(model);
      onProgress?.({ phase: 'themes', label: 'Agrupando', current: 1, total: 1 });
      current = { ...current, pendingThemeWorks: [] };
      return { ideas: 4, themedIdeas: 4, newThemes: 0, relationsAdded: 0 };
    },
    dismissRepairedThemeWorks: async () => { calls.dismiss += 1; current = { ...current, pendingThemeWorks: [] }; return current; },
    processFullBulk: async (ids, model, options) => { calls.rescan.push({ ids, options }); },
    listManagedThemes: async () => [],
    ...overrides.bridge,
  };
  return api;
}

test('the panel shows the three groups, repairs after confirmation and reports the backup', async () => {
  const api = bridge({ report: report({ rescanWorks: [{ nodus_id: 'W3', title: 'Obra por reanalizar' }] }) });
  const ui = await render(({ GraphHealthPanel }, React) => React.createElement(GraphHealthPanel, { manualMode: false }), api);
  await ui.settle();
  assert.equal(api.calls.check, 1, 'it checks once on open');
  for (const category of ['repairable', 'rescan', 'info']) assert.ok(ui.byTestId(`graph-health-${category}`), `${category} group shown`);
  assert.match(ui.byTestId('graph-health-check-theme_links_missing_theme').textContent, /Obra con temas rotos/);

  const repair = ui.byTestId('graph-health-repair');
  assert.equal(repair.disabled, false, 'something repairable enables Repair');
  await ui.click(repair);
  await ui.settle();
  assert.equal(api.calls.repair, 0, 'nothing is repaired before the confirmation');
  await ui.click(ui.confirmButton('Reparar'));
  await ui.settle();
  assert.equal(api.calls.repair, 1);
  assert.match(ui.byTestId('graph-health-message').textContent, /nodus-pre-graph-repair\.sqlite/, 'the backup path is shown');
  assert.equal(ui.byTestId('graph-health-repair').disabled, true, 'with nothing left to repair the button disables');

  assert.ok(ui.byTestId('graph-health-pending-themes'), 'the works whose themes were removed are offered for reassignment');
  await ui.click(ui.byTestId('graph-health-reassign-themes'));
  await ui.settle();
  assert.equal(api.calls.reassign.length, 1, 'reassigning calls the bridge once');
  assert.equal(ui.byTestId('graph-health-pending-themes'), null, 'and the offer disappears');

  await ui.click(ui.byTestId('graph-health-analyse-again'));
  await ui.settle();
  await ui.click(ui.confirmButton('Volver a analizar'));
  await ui.settle();
  assert.deepEqual(api.calls.rescan, [{ ids: ['W3'], options: { mode: 'refresh' } }], 'the listed works are analysed again, refreshed');
  await ui.unmount();
});

test('Repair waits for the analysis queue', async () => {
  const api = bridge({ queue: { paused: false, items: [{ state: 'running' }], total: 1, done: 0, failed: 0, maintenanceRunning: false } });
  const ui = await render(({ GraphHealthPanel }, React) => React.createElement(GraphHealthPanel, { manualMode: false }), api);
  await ui.settle();
  assert.equal(ui.byTestId('graph-health-repair').disabled, true, 'a running scan disables Repair');
  assert.match(ui.byTestId('graph-health').textContent, /Espera a que termine la cola de análisis/);
  await ui.unmount();
});

test('Manual mode keeps check and repair but hides the actions that use the model', async () => {
  const api = bridge({ report: report({ pending: [{ nodus_id: 'W1', title: 'Obra' }], rescanWorks: [{ nodus_id: 'W3', title: 'Obra' }] }) });
  const ui = await render(({ GraphHealthPanel }, React) => React.createElement(GraphHealthPanel, { manualMode: true }), api);
  await ui.settle();
  assert.ok(ui.byTestId('graph-health-check'));
  assert.equal(ui.byTestId('graph-health-repair').disabled, false);
  assert.equal(ui.byTestId('graph-health-pending-themes'), null, 'no theme reassignment in Manual mode');
  assert.equal(ui.byTestId('graph-health-analyse-again'), null, 'no new analysis in Manual mode');
  await ui.unmount();
});

test('Main themes offers to reassign the repaired works, and the notice goes once done', async () => {
  const api = bridge({ report: report({ pending: [{ nodus_id: 'W1', title: 'Obra' }, { nodus_id: 'W2', title: 'Otra' }] }) });
  const props = { settings: { academicMode: 'auto', themesLocked: false }, onClose: () => undefined, onSettingsChange: () => undefined };
  const ui = await render(({ ThemesModal }, React) => React.createElement(ThemesModal, props), api);
  await ui.settle();
  const notice = ui.byTestId('themes-repaired-notice');
  assert.ok(notice, 'the notice is shown');
  assert.match(notice.textContent, /2 obra\(s\)/);
  await ui.click(ui.byTestId('themes-reassign-repaired'));
  await ui.settle();
  assert.equal(api.calls.reassign.length, 1);
  assert.equal(ui.byTestId('themes-repaired-notice'), null, 'the notice disappears once the themes are reassigned');
  await ui.unmount();
});

test('Main themes shows no notice in Manual mode and can dismiss it in Auto', async () => {
  const pending = [{ nodus_id: 'W1', title: 'Obra' }];
  const manualApi = bridge({ report: report({ pending }) });
  const manual = await render(({ ThemesModal }, React) => React.createElement(ThemesModal, {
    settings: { academicMode: 'manual' }, onClose: () => undefined, onSettingsChange: () => undefined,
  }), manualApi);
  await manual.settle();
  assert.equal(manual.byTestId('themes-repaired-notice'), null);
  assert.equal(manualApi.calls.check, 0, 'Manual mode does not even ask');
  await manual.unmount();

  const autoApi = bridge({ report: report({ pending }) });
  const auto = await render(({ ThemesModal }, React) => React.createElement(ThemesModal, {
    settings: { academicMode: 'auto' }, onClose: () => undefined, onSettingsChange: () => undefined,
  }), autoApi);
  await auto.settle();
  await auto.click(auto.byTestId('themes-dismiss-repaired'));
  await auto.settle();
  assert.equal(autoApi.calls.dismiss, 1);
  assert.equal(auto.byTestId('themes-repaired-notice'), null);
  await auto.unmount();
});

test('Manual mode gates the theme reassignment channel, and only that one', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(path.join(repoRoot, 'electron/ipc/academic.ts'), 'utf8');
  const gate = source.match(/if \(\/(\^\(scan:.*?)\/\.test\(channel\)\) assertAcademicAutomation\(\);/);
  assert.ok(gate, 'the automation gate is found');
  const regex = new RegExp(gate[1]);
  assert.equal(regex.test('themes:reprocessRepairedWorks'), true, 'reassigning themes uses the model, so Manual mode blocks it');
  for (const channel of ['graph:integrity:check', 'graph:integrity:repair', 'graph:integrity:dismissThemeWorks']) {
    assert.equal(regex.test(channel), false, `${channel} is plain SQL and stays available in Manual mode`);
    assert.match(source, new RegExp(`h\\('${channel}'`), `${channel} is registered`);
  }
  assert.match(source, /h\('themes:reprocessRepairedWorks'/);
});
