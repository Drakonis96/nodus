// Nodus Drift, rendered for real: the actual provider, engine, page and header panel in jsdom,
// against a stand-in for the preload bridge and a faithful Web Audio double.
//
// This is where the promises that cross layers are kept or broken: one engine per window even
// under StrictMode, nothing audible or fetched at start-up, a restored mix that waits for an
// explicit play, navigation and "vault switches" that never rebuild it, unmounting that frees
// everything and still saves, and a popover whose tabs never touch playback.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDriftFixtures } from './drift-fixtures.mjs';
import { FakeContext, deferred, fakeAudioBytes, flush } from './drift-audio-fakes.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

function defineGlobal(key, value) {
  try { Object.defineProperty(globalThis, key, { value, writable: true, configurable: true }); } catch { /* Node's own is kept */ }
}

// react-dom decides at LOAD time whether the DOM can be trusted with `input` events, so a window
// has to exist before it is required. Every test then replaces it with a fresh one.
const bootstrap = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://nodus.test/', pretendToBeVisual: true });
for (const key of Object.getOwnPropertyNames(bootstrap.window)) if (!(key in globalThis)) globalThis[key] = bootstrap.window[key];
defineGlobal('window', bootstrap.window);
defineGlobal('document', bootstrap.window.document);
defineGlobal('navigator', bootstrap.window.navigator);
defineGlobal('Event', bootstrap.window.Event);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = require('react');
const { createRoot } = require('react-dom/client');
const act = React.act ?? require('react-dom/test-utils').act;

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-drift-provider-'));
await symlink(path.join(repoRoot, 'node_modules'), path.join(outDir, 'node_modules'));
test.after(() => rm(outDir, { recursive: true, force: true }));

// One small entry file that pulls in the real components; it lives outside the repo.
const entry = path.join(outDir, 'harness.tsx');
await writeFile(entry, `
import * as React from 'react';
import { DriftProvider, useDrift } from '${repoRoot}/src/components/drift/DriftProvider';
import { ToolkitDriftView } from '${repoRoot}/src/views/ToolkitDriftView';
import { DriftMiniPlayer } from '${repoRoot}/src/components/drift/DriftMiniPlayer';
import { BrowserMediaPopover, BrowserMediaProvider } from '${repoRoot}/src/components/browser/BrowserMedia';

export { DriftProvider, ToolkitDriftView, DriftMiniPlayer, BrowserMediaPopover, BrowserMediaProvider };
export const probe: { current: ReturnType<typeof useDrift> | null } = { current: null };
export function Probe() { probe.current = useDrift(); return null; }
export function PopoverHarness({ anchor, onClose, onOpenDrift }: { anchor: HTMLElement | null; onClose: () => void; onOpenDrift: () => void }) {
  const drift = useDrift();
  return (
    <BrowserMediaPopover
      anchorEl={anchor}
      onClose={onClose}
      onOpenTab={() => undefined}
      drift={{ hasSelection: drift.selection.length > 0, lastTab: drift.mediaTab, onTab: drift.setMediaTab, panel: <DriftMiniPlayer onOpenDrift={onOpenDrift} /> }}
    />
  );
}
`);
const bundle = path.join(outDir, 'harness.cjs');
execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
  entry, '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
  '--loader:.tsx=tsx', '--jsx=automatic', `--tsconfig=${path.join(repoRoot, 'tsconfig.json')}`,
  '--external:react', '--external:react/jsx-runtime', '--external:react-dom', '--external:react-dom/client',
  `--outfile=${bundle}`,
], { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] });
const harness = require(bundle);

const { loadTs } = await import('./drift-test-utils.mjs');
const { DRIFT_SOUNDS } = loadTs('shared/driftCatalog.ts');
const driftShared = loadTs('shared/drift.ts');

const fixtures = buildDriftFixtures(path.join(outDir, 'fixtures'));
const ALL = [...DRIFT_SOUNDS, ...fixtures.sounds];
// The catalogue as the main process would answer with every recording approved: what the app ships.
const APPROVED_CATALOG = { schemaVersion: 1, sounds: ALL.map((definition) => ({ ...structuredClone(definition), availability: definition.id === 'fixture-missing' ? 'missing' : driftShared.baseDriftAvailability(definition) })) };
// The same, with the two ways a recording can be unavailable put back, so the page that explains them stays covered:
// three recordings nobody approved, and one whose file is not in the app.
const PENDING_IDS = new Set(['light-rain', 'heavy-rain', 'thunder']);
const ABSENT_IDS = new Set(['rain-on-window']);
const CATALOG = {
  schemaVersion: 1,
  sounds: APPROVED_CATALOG.sounds.map((entry) => {
    const copy = structuredClone(entry);
    if (PENDING_IDS.has(copy.id)) {
      copy.availability = 'license-unresolved';
      copy.provenance = { licenseStatus: 'unresolved', evidenceRefs: [...copy.provenance.evidenceRefs], distributionReview: 'pending' };
    }
    if (ABSENT_IDS.has(copy.id)) copy.availability = 'missing';
    return copy;
  }),
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A fresh jsdom window with the preload bridge and Web Audio replaced. `catalogGate` holds the
 * catalogue back; `readImpl` decides what reading a recording does.
 */
function environment({ stored = null, catalogGate = null, readImpl = null, browserSessions = [], catalog = CATALOG } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://nodus.test/', pretendToBeVisual: true });
  for (const key of Object.getOwnPropertyNames(dom.window)) if (!(key in globalThis)) globalThis[key] = dom.window[key];
  for (const key of ['window', 'document', 'navigator', 'Event']) defineGlobal(key, dom.window[key === 'window' ? 'window' : key] ?? dom.window);
  defineGlobal('window', dom.window);
  defineGlobal('document', dom.window.document);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const writes = [];
  const originalSet = dom.window.Storage.prototype.setItem;
  dom.window.Storage.prototype.setItem = function (key, value) { writes.push([key, value]); return originalSet.call(this, key, value); };
  if (stored) dom.window.localStorage.setItem('nodus:drift:v1', typeof stored === 'string' ? stored : JSON.stringify(stored));
  writes.length = 0;

  const contexts = [];
  const calls = { catalog: 0, reads: [], setBrowserDeviceVolume: [], browserMediaCommand: [], freeze: 0, overlay: [] };
  globalThis.AudioContext = class extends FakeContext {
    constructor(options) { super({ sampleRate: 48000 }); this.constructorOptions = options; contexts.push(this); }
  };
  dom.window.nodus = {
    getDriftCatalog: async () => { calls.catalog += 1; if (catalogGate) await catalogGate.promise; return structuredClone(catalog); },
    readDriftAudio: async (id) => {
      calls.reads.push(id);
      if (readImpl) return readImpl(id);
      return fakeAudioBytes({ frames: 48000, sampleRate: 48000 });
    },
    // the Browser media popover's own bridge
    getBrowserMedia: async () => structuredClone(browserSessions),
    onBrowserMediaChanged: () => () => undefined,
    captureBrowserOverlaySnapshot: async () => { calls.freeze += 1; return null; },
    setBrowserOverlayVisible: async (visible) => { calls.overlay.push(visible); },
    getBrowserDeviceVolume: async () => 40,
    setBrowserDeviceVolume: async (v) => { calls.setBrowserDeviceVolume.push(v); },
    browserMediaCommand: async (...args) => { calls.browserMediaCommand.push(args); },
  };
  const container = dom.window.document.getElementById('root');
  const root = createRoot(container);
  const q = (selector) => container.querySelector(selector) ?? dom.window.document.body.querySelector(selector);
  const qa = (selector) => [...dom.window.document.body.querySelectorAll(selector)];
  const settle = async (times = 6) => { for (let i = 0; i < times; i++) await act(async () => { await flush(); }); };
  const click = async (element) => { assert.ok(element, 'the element to click exists'); await act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); await settle(3); };
  const input = async (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    await act(async () => { setter.call(element, String(value)); element.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  };
  const render = async (tree) => { await act(async () => { root.render(tree); }); await settle(); };
  const strict = (...children) => React.createElement(React.StrictMode, null, ...children);
  return { dom, container, root, contexts, calls, writes, q, qa, settle, click, input, render, strict, storage: dom.window.localStorage };
}

const h = React.createElement;
const provider = (...children) => h(harness.DriftProvider, null, h(harness.Probe), ...children);
const savedMix = (extra = {}) => ({
  version: 1, selection: ['white-noise', 'fixture-a'], volumes: { 'white-noise': 0.6, 'fixture-a': 0.4 }, master: 0.5, favorites: ['light-rain'], filter: 'all',
  snapshot: {
    'white-noise': { nameKey: 'Ruido blanco', icon: 'waveform', categoryId: 'noise', kind: 'noise' },
    'fixture-a': { nameKey: 'Fixture A', icon: 'bell', categoryId: 'things', kind: 'file' },
  },
  ...extra,
});

// ── start-up ───────────────────────────────────────────────────────────────

test('mounting under StrictMode builds no context, fetches nothing and writes nothing', async () => {
  const env = environment();
  await env.render(env.strict(provider()));
  assert.equal(env.contexts.length, 0, 'no AudioContext: StrictMode\'s throw-away engine created none either');
  assert.equal(env.calls.catalog, 0, 'the catalogue is asked for when Drift opens, not at start-up');
  assert.deepEqual(env.calls.reads, []);
  assert.deepEqual(env.writes, [], 'and nothing is written back');
  assert.deepEqual(harness.probe.current.selection, []);
  assert.equal(harness.probe.current.playing, false);
  await act(async () => env.root.unmount());
});

test('a saved mix comes back PAUSED and silent, named from its snapshot before any catalogue exists', async () => {
  const env = environment({ stored: savedMix() });
  await env.render(env.strict(provider()));
  const { probe } = harness;
  assert.deepEqual(probe.current.selection, ['white-noise', 'fixture-a']);
  assert.deepEqual(probe.current.voices.map((v) => [v.id, v.status, v.volume]), [['white-noise', 'paused', 0.6], ['fixture-a', 'paused', 0.4]]);
  assert.equal(probe.current.master, 0.5);
  assert.deepEqual(probe.current.voices.map((v) => v.nameKey), ['Ruido blanco', 'Fixture A']);
  assert.equal(probe.current.playing, false);
  assert.equal(probe.current.loading, false);
  assert.equal(env.contexts.length, 0);
  assert.equal(env.calls.catalog, 0);
  assert.deepEqual(env.calls.reads, []);
  assert.deepEqual(env.writes, [], 'reading the saved state is not a change');
  await act(async () => env.root.unmount());
});

test('corrupt or foreign saved state is the empty default, without an error', async () => {
  for (const stored of ['{ not json', '[]', '{"version":9}', '{"version":1,"selection":"x","master":"loud"}']) {
    const env = environment({ stored });
    await env.render(env.strict(provider()));
    assert.deepEqual(harness.probe.current.selection, [], String(stored));
    assert.equal(harness.probe.current.master, 0.35);
    await act(async () => env.root.unmount());
  }
});

// ── explicit play ──────────────────────────────────────────────────────────

test('header Play on a restored mix: the context exists and is resumed inside the click, before the catalogue arrives', async () => {
  const gate = deferred();
  const env = environment({ stored: savedMix(), catalogGate: gate });
  await env.render(env.strict(provider()));
  await act(async () => { harness.probe.current.play(); });
  // Synchronously, in the same act as the click: nothing has been awaited yet.
  assert.equal(env.contexts.length, 1, 'ONE context even though StrictMode mounted the provider twice');
  assert.equal(env.contexts[0].resumeCalls, 1);
  assert.deepEqual(env.contexts[0].constructorOptions, { latencyHint: 'playback' });
  assert.deepEqual(env.calls.reads, [], 'no recording is read until the catalogue is known');
  assert.equal(harness.probe.current.playing, false, 'and nothing claims to be playing yet');
  gate.resolve();
  await env.settle(10);
  assert.equal(env.calls.catalog, 1, 'the catalogue was fetched once, however many voices waited for it');
  assert.deepEqual(env.calls.reads, ['fixture-a'], 'the recording is read; the noise is generated locally and read from nowhere');
  assert.deepEqual(harness.probe.current.voices.map((v) => v.status), ['playing', 'playing']);
  assert.equal(env.contexts[0].sources.length, 2);
  assert.ok(env.contexts[0].sources.every((s) => s.startCalls.length === 1 && s.loop === true));
  assert.equal(harness.probe.current.playing, true);
  await act(async () => env.root.unmount());
});

test('unmounting disposes the engine, closes the context and still saves what changed', async () => {
  const env = environment({ stored: savedMix() });
  await env.render(env.strict(provider()));
  await act(async () => { harness.probe.current.play(); });
  await env.settle(10);
  await act(async () => { harness.probe.current.setMaster(0.9); harness.probe.current.setVolume('white-noise', 0.7); });
  assert.deepEqual(env.writes, [], 'the write is debounced: nothing yet');
  await act(async () => env.root.unmount());
  await env.settle();
  assert.equal(env.contexts[0].closeCalls, 1, 'the window\'s engine is destroyed with the window');
  assert.equal(env.contexts[0].state, 'closed');
  assert.equal(env.contexts[0].listenerCount(), 0);
  const saved = JSON.parse(env.storage.getItem('nodus:drift:v1'));
  assert.equal(saved.master, 0.9, 'the pending change was flushed on unmount');
  assert.equal(saved.volumes['white-noise'], 0.7);
  assert.ok(!('playing' in saved) && !('status' in saved), 'a play state is never saved');
});

test('a new window starts again from the saved settings, paused', async () => {
  const first = environment({ stored: savedMix() });
  await first.render(first.strict(provider()));
  await act(async () => { harness.probe.current.play(); });
  await first.settle(10);
  await act(async () => { harness.probe.current.setMaster(0.8); });
  await act(async () => first.root.unmount());
  const second = environment({ stored: first.storage.getItem('nodus:drift:v1') });
  await second.render(second.strict(provider()));
  assert.equal(harness.probe.current.master, 0.8);
  assert.deepEqual(harness.probe.current.voices.map((v) => v.status), ['paused', 'paused']);
  assert.equal(second.contexts.length, 0, 'silence until an interaction');
  await act(async () => second.root.unmount());
});

// ── the page ───────────────────────────────────────────────────────────────

test('browsing never starts audio: search, filters, favourites and the unavailable list', async () => {
  const env = environment();
  await env.render(env.strict(provider(h(harness.ToolkitDriftView, { onBack: () => undefined }))));
  assert.equal(env.calls.catalog, 1, 'opening the page asks for the catalogue once');
  const search = env.q('[data-testid="drift-search"]');
  await env.input(search, 'lluvia');
  await env.input(search, 'CAFETERÍA');
  await env.input(search, '');
  await env.click(env.q('[data-testid="drift-filter-binaural"]'));
  await env.click(env.q('[data-testid="drift-filter-favorites"]'));
  assert.ok(env.q('[data-testid="drift-no-results"]'), 'an empty favourites list says so');
  await env.click(env.q('[data-testid="drift-filter-all"]'));
  await env.click(env.q('[data-testid="drift-card-brown-noise-favorite"]'));
  assert.equal(env.q('[data-testid="drift-card-brown-noise-favorite"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(harness.probe.current.selection, [], 'starring a card does not select it');
  // Even asked directly, the provider refuses what the catalogue does not offer: a recording nobody
  // approved, a file that is not there, an id nobody has ever heard of.
  await act(async () => {
    for (const id of ['light-rain', 'rain-on-window', 'fixture-missing', 'no-such-sound', '../../etc/passwd', 'https://example.com/a.mp3']) harness.probe.current.toggleSound(id);
  });
  await env.settle();
  assert.deepEqual(harness.probe.current.selection, [], 'nothing unavailable can enter the mix');
  assert.equal(env.contexts.length, 0, 'none of that made a sound, or even a context');
  assert.deepEqual(env.calls.reads, []);
  // what is unavailable is explained, collapsed, and none of it is a control
  const unavailable = env.q('[data-testid="drift-unavailable"]');
  assert.ok(unavailable, 'the unavailable section exists');
  assert.equal(unavailable.open, false);
  const buttons = [...unavailable.querySelectorAll('button')].map((b) => b.getAttribute('data-testid'));
  assert.ok(buttons.length > 0 && buttons.every((id) => id.endsWith('-favorite')), 'only favourite stars: no card there can play or download');
  assert.match(env.q('[data-testid="drift-card-light-rain-reason"]').textContent, /Pendiente de revisión de licencia/);
  assert.match(env.q('[data-testid="drift-card-rain-on-window-reason"]').textContent, /No se encuentra el archivo/);
  assert.ok(env.q('[data-testid="drift-license-note"]'), 'and the page says why');
  await act(async () => env.root.unmount());
});

test('with every recording approved there is no pending-licence note, and a real recording plays through the bridge', async () => {
  const env = environment({ catalog: APPROVED_CATALOG });
  await env.render(env.strict(provider(h(harness.ToolkitDriftView, { onBack: () => undefined }))));
  assert.equal(env.q('[data-testid="drift-license-note"]'), null, 'nothing is waiting for a licence, so the page does not say so');
  const unavailable = env.qa('[data-testid="drift-unavailable"] [data-testid^="drift-card-"]:not([data-testid$="-favorite"]):not([data-testid$="-reason"])');
  assert.deepEqual(unavailable.map((card) => card.getAttribute('data-testid')), ['drift-card-fixture-missing'], 'only the file that is not there is listed as unavailable');
  for (const id of ['light-rain', 'rain-on-tent', 'airport']) {
    assert.ok(env.q(`[data-testid="drift-grid"] [data-testid="drift-card-${id}"] button[aria-pressed]`), `${id} is a playable card`);
  }
  await env.click(env.q('[data-testid="drift-card-light-rain"] button[aria-pressed]'));
  await env.settle(6);
  assert.deepEqual(harness.probe.current.selection, ['light-rain']);
  assert.deepEqual(env.calls.reads, ['light-rain'], 'the recording came through readDriftAudio, by id');
  assert.equal(env.contexts.length, 1);
  assert.equal(harness.probe.current.playing, true);
  await act(async () => env.root.unmount());
});

test('activating a card adds it and plays; sliders, remove and clear act on the Drift bus only', async () => {
  const env = environment();
  await env.render(env.strict(provider(h(harness.ToolkitDriftView, { onBack: () => undefined }))));
  assert.equal(env.q('[data-testid="drift-mix-toggle"]').disabled, true, 'Play is disabled with nothing selected');
  assert.equal(env.q('[data-testid="drift-clear"]').disabled, true);
  assert.ok(env.q('[data-testid="drift-mix-empty"]'));

  await env.click(env.q('[data-testid="drift-card-brown-noise"] button[aria-pressed]'));
  await env.settle(6);
  assert.deepEqual(harness.probe.current.selection, ['brown-noise']);
  assert.equal(env.contexts.length, 1);
  assert.equal(harness.probe.current.playing, true);
  assert.match(env.q('[data-testid="drift-mix-voice-brown-noise-status"]').textContent, /Reproduciendo/);
  assert.equal(env.q('[data-testid="drift-mix-toggle"]').disabled, false);

  await env.input(env.q('[data-testid="drift-volume-brown-noise"]'), 60);
  await env.input(env.q('[data-testid="drift-master"]'), 80);
  assert.equal(harness.probe.current.voices[0].volume, 0.6);
  assert.equal(harness.probe.current.master, 0.8);
  const gains = env.contexts[0].of('gain');
  assert.ok(gains.some((g) => g.gain.value === 0.6) && gains.some((g) => g.gain.value === 0.8), 'the slider values reached the voice gain and the master');
  assert.deepEqual(env.calls.setBrowserDeviceVolume, [], 'the system/Browser volume was never touched');
  assert.deepEqual(env.calls.browserMediaCommand, []);

  await sleep(350);
  const saved = JSON.parse(env.storage.getItem('nodus:drift:v1'));
  assert.equal(saved.volumes['brown-noise'], 0.6);
  assert.equal(saved.master, 0.8);
  assert.deepEqual(saved.selection, ['brown-noise']);
  assert.equal(env.writes.length, 1, 'a burst of slider moves is ONE write');

  // pause keeps the mix; Play resumes it; remove and clear empty it
  await env.click(env.q('[data-testid="drift-mix-toggle"]'));
  await env.settle(8);
  assert.equal(harness.probe.current.playing, false);
  assert.deepEqual(harness.probe.current.selection, ['brown-noise'], 'pausing keeps the selection');
  await env.click(env.q('[data-testid="drift-mix-toggle"]'));
  await env.settle(8);
  assert.equal(harness.probe.current.playing, true);
  await env.click(env.q('[data-testid="drift-remove-brown-noise"]'));
  assert.deepEqual(harness.probe.current.selection, []);
  await env.click(env.q('[data-testid="drift-card-white-noise"] button[aria-pressed]'));
  await env.click(env.q('[data-testid="drift-clear"]'));
  assert.deepEqual(harness.probe.current.selection, []);
  assert.equal(env.contexts.length, 1, 'through all of it: still the one context');
  await act(async () => env.root.unmount());
});

test('the seventh voice raises a notice and leaves the mix untouched; a second binaural replaces the first', async () => {
  const env = environment();
  await env.render(env.strict(provider(h(harness.ToolkitDriftView, { onBack: () => undefined }))));
  const card = (id) => env.q(`[data-testid="drift-card-${id}"] button[aria-pressed]`);
  for (const id of ['white-noise', 'pink-noise', 'brown-noise', 'binaural-alpha', 'fixture-a', 'fixture-b']) await env.click(card(id));
  await env.settle(8);
  assert.equal(harness.probe.current.selection.length, 6);
  const reads = env.calls.reads.length;
  await env.click(card('fixture-c'));
  assert.ok(env.q('[data-testid="drift-limit-notice"]'), 'the notice appears');
  assert.equal(env.q('[data-testid="drift-limit-notice"]').getAttribute('role'), 'status');
  assert.deepEqual(harness.probe.current.selection, ['white-noise', 'pink-noise', 'brown-noise', 'binaural-alpha', 'fixture-a', 'fixture-b'], 'the mix is exactly as it was');
  assert.equal(env.calls.reads.length, reads, 'and the refused sound was never read');
  // binaural: choosing another replaces it, even at the limit
  await env.click(card('binaural-gamma'));
  await env.settle(6);
  assert.deepEqual(harness.probe.current.selection, ['white-noise', 'pink-noise', 'brown-noise', 'binaural-gamma', 'fixture-a', 'fixture-b']);
  assert.equal(env.q('[data-testid="drift-limit-notice"]'), null, 'a successful change clears the notice');
  const tones = env.contexts[0].oscillators.map((o) => o.frequency.value);
  assert.deepEqual(tones, [95, 105, 80, 120], 'the old pair was replaced by the new pair');
  await act(async () => env.root.unmount());
});

test('a recording that fails shows its reason and a retry on that voice; the rest keep playing', async () => {
  let corruptTries = 0;
  const env = environment({
    readImpl: (id) => {
      if (id === 'fixture-corrupt') { corruptTries += 1; if (corruptTries === 1) throw new Error('Error invoking remote method \'drift:read-audio\': Error: drift-audio:corrupt: the file does not match its catalogued SHA-256'); }
      return fakeAudioBytes({ frames: 48000, sampleRate: 48000 });
    },
  });
  await env.render(env.strict(provider(h(harness.ToolkitDriftView, { onBack: () => undefined }))));
  await env.click(env.q('[data-testid="drift-card-brown-noise"] button[aria-pressed]'));
  await env.click(env.q('[data-testid="drift-card-fixture-corrupt"] button[aria-pressed]'));
  await env.settle(8);
  const error = env.q('[data-testid="drift-error-fixture-corrupt"]');
  assert.ok(error, 'the failing voice has an error row');
  assert.equal(error.getAttribute('role'), 'alert');
  assert.match(error.textContent, /El archivo de este sonido está dañado\./, 'the interface\'s own copy, never the raw error text');
  assert.doesNotMatch(error.textContent, /drift-audio|SHA-256|remote method/);
  assert.match(env.q('[data-testid="drift-mix-voice-brown-noise-status"]').textContent, /Reproduciendo/, 'the healthy voice carries on');
  assert.equal(harness.probe.current.playing, true);
  await env.click(env.q('[data-testid="drift-retry-fixture-corrupt"]'));
  await env.settle(8);
  assert.equal(env.q('[data-testid="drift-error-fixture-corrupt"]'), null, 'the retry worked');
  assert.equal(corruptTries, 2);
  assert.deepEqual(harness.probe.current.voices.map((v) => v.status), ['playing', 'playing']);
  await act(async () => env.root.unmount());
});

test('leaving the page, or a whole new app tree below the provider, never rebuilds the engine or restarts a voice', async () => {
  const env = environment();
  const App = (view, key) => env.strict(provider(h('div', { key }, view === 'tools' ? h(harness.ToolkitDriftView, { onBack: () => undefined }) : h('div', { 'data-testid': 'elsewhere' }, view))));
  await env.render(App('tools', 'vault-a'));
  await env.click(env.q('[data-testid="drift-card-pink-noise"] button[aria-pressed]'));
  await env.settle(8);
  const context = env.contexts[0];
  const source = context.sources[0];
  assert.equal(harness.probe.current.playing, true);

  // to another tool, back, to another view...
  await env.render(App('other', 'vault-a'));
  assert.ok(env.q('[data-testid="elsewhere"]'));
  assert.equal(harness.probe.current.playing, true, 'still playing on another page');
  await env.render(App('tools', 'vault-a'));
  // ...and a vault switch: everything under the provider is remounted with a new key
  await env.render(App('tools', 'vault-b'));
  await env.render(App('other', 'vault-c'));
  await env.settle(4);

  assert.equal(env.contexts.length, 1, 'one AudioContext for the window, however much navigation');
  assert.equal(env.contexts[0], context);
  assert.equal(context.sources.length, 1, 'no voice was duplicated');
  assert.equal(source.startCalls.length, 1);
  assert.equal(source.stopCalls.length, 0, 'and none was stopped');
  assert.equal(context.closeCalls, 0);
  assert.equal(context.state, 'running');
  assert.equal(harness.probe.current.playing, true);
  assert.deepEqual(harness.probe.current.selection, ['pink-noise']);
  await act(async () => env.root.unmount());
});

test('the catalogue failing shows a retry; a second try recovers', async () => {
  const env = environment();
  let attempts = 0;
  env.dom.window.nodus.getDriftCatalog = async () => { attempts += 1; if (attempts === 1) throw new Error('boom'); return structuredClone(CATALOG); };
  await env.render(env.strict(provider(h(harness.ToolkitDriftView, { onBack: () => undefined }))));
  assert.ok(env.q('[data-testid="drift-catalog-error"]'));
  assert.equal(env.q('[data-testid="drift-catalog-error"]').getAttribute('role'), 'alert');
  await env.click(env.q('[data-testid="drift-catalog-retry"]'));
  await env.settle(6);
  assert.equal(env.q('[data-testid="drift-catalog-error"]'), null);
  assert.ok(env.q('[data-testid="drift-card-white-noise"]'));
  assert.equal(attempts, 2);
  await act(async () => env.root.unmount());
});

// ── the header popover ─────────────────────────────────────────────────────

test('the header panel: one popover, tabs that never touch playback, the last tab remembered, and Drift\'s own volume', async () => {
  const env = environment({ stored: savedMix() });
  const opened = [];
  const anchor = () => env.dom.window.document.body;
  const tree = (open) => env.strict(h(harness.BrowserMediaProvider, null, provider(h(harness.PopoverHarness, {
    anchor: open ? anchor() : null, onClose: () => undefined, onOpenDrift: () => opened.push('drift'),
  }))));
  await env.render(tree(true));

  // Only Drift has anything (a paused mix): the popover opens on Drift
  assert.equal(env.qa('[data-testid="browser-media-popover"]').length, 1);
  assert.equal(env.qa('.fixed.inset-0.z-\\[130\\]').length, 1, 'one backdrop');
  assert.equal(env.q('[data-testid="media-source-tab-drift"]').getAttribute('aria-selected'), 'true');
  assert.ok(env.q('[data-testid="drift-mini-player"]'));
  assert.match(env.q('[data-testid="drift-mini-count"]').textContent, /2 sonidos en la mezcla/);
  assert.match(env.q('[data-testid="drift-mini-count"]').textContent, /En pausa/);
  assert.equal(env.q('[data-testid="drift-mini-voices"]').textContent, 'Ruido blanco · Fixture A');
  assert.equal(env.contexts.length, 0, 'opening the panel plays nothing');
  // (StrictMode runs the popover's mount effect twice in development; what matters is that nothing after opening adds to it)
  const frozen = env.calls.freeze;
  const overlay = [...env.calls.overlay];
  assert.ok(frozen >= 1, 'the Browser page is frozen when the popover opens');

  // switching tabs: Browser (empty here) and back, no playback, no re-freeze, no Browser API
  await env.click(env.q('[data-testid="media-source-tab-browser"]'));
  assert.equal(env.q('[data-testid="media-source-tab-browser"]').getAttribute('aria-selected'), 'true');
  assert.ok(env.q('[data-testid="browser-media-empty"]'));
  assert.equal(env.q('[data-testid="browser-device-volume"]'), null, 'no Browser volume with no Browser session');
  await env.click(env.q('[data-testid="media-source-tab-drift"]'));
  assert.equal(env.contexts.length, 0);
  assert.equal(env.calls.freeze, frozen, 'changing tabs does not restart the popover\'s effect');
  assert.deepEqual(env.calls.overlay, overlay, 'and the native view is not hidden or shown again');

  // Drift's slider moves the Drift master only
  await env.input(env.q('[data-testid="drift-mini-master"]'), 20);
  assert.equal(harness.probe.current.master, 0.2);
  assert.deepEqual(env.calls.setBrowserDeviceVolume, []);
  assert.deepEqual(env.calls.browserMediaCommand, []);

  // play / pause / clear from the panel, and the way into the tool
  await env.click(env.q('[data-testid="drift-mini-toggle"]'));
  await env.settle(10);
  assert.equal(harness.probe.current.playing, true);
  assert.equal(env.contexts.length, 1);
  assert.match(env.q('[data-testid="drift-mini-count"]').textContent, /Reproduciendo/);
  await env.click(env.q('[data-testid="drift-mini-toggle"]'));
  await env.settle(8);
  assert.equal(harness.probe.current.playing, false);
  await env.click(env.q('[data-testid="drift-mini-open"]'));
  assert.deepEqual(opened, ['drift']);
  assert.equal(env.calls.freeze, frozen, 'still no new freeze after play, pause and volume');
  assert.deepEqual(env.calls.overlay, overlay);
  // Clearing the only source removes the header button itself, and with it the popover
  await env.click(env.q('[data-testid="drift-mini-clear"]'));
  assert.deepEqual(harness.probe.current.selection, []);
  assert.equal(env.qa('[data-testid="browser-media-popover"]').length, 0, 'nothing left to show, nothing rendered');
  await act(async () => env.root.unmount());
});

test('with a Browser session AND a Drift mix: Browser first, the last tab remembered, each source keeps its own controls', async () => {
  const session = { tabId: 't1', title: 'Lecture 4', url: 'https://example.org/lecture', origin: 'https://example.org', faviconDataUrl: null, hasMedia: true, playing: true, audible: true, muted: false, canPlayPause: true, kind: 'video' };
  const env = environment({ stored: savedMix(), browserSessions: [session] });
  let open = false;
  const tree = () => env.strict(h(harness.BrowserMediaProvider, null, provider(h(harness.PopoverHarness, {
    anchor: open ? env.dom.window.document.body : null, onClose: () => undefined, onOpenDrift: () => undefined,
  }))));
  await env.render(tree());       // the Browser session loads while the popover is closed, as it does in the app
  open = true;
  await env.render(tree());       // ...and the user opens it with a click

  assert.equal(env.q('[data-testid="media-source-tab-browser"]').getAttribute('aria-selected'), 'true', 'both exist and none was chosen yet: Browser');
  assert.ok(env.q('[data-testid="browser-media-row"]'), 'the Browser session is listed');
  assert.ok(env.q('[data-testid="browser-device-volume"]'));
  const frozen = env.calls.freeze;

  // the Browser slider is Browser's: it moves the device volume and never Drift's master
  await env.input(env.q('[data-testid="browser-device-volume"] input'), 70);
  assert.deepEqual(env.calls.setBrowserDeviceVolume, [70]);
  assert.equal(harness.probe.current.master, 0.5, 'Drift\'s master is untouched');

  // choose Drift: playback of the Browser session and of Drift is untouched by the choice
  await env.click(env.q('[data-testid="media-source-tab-drift"]'));
  assert.deepEqual(env.calls.browserMediaCommand, [], 'no command was sent to the Browser page');
  assert.equal(env.contexts.length, 0);
  await env.input(env.q('[data-testid="drift-mini-master"]'), 10);
  assert.equal(harness.probe.current.master, 0.1);
  assert.deepEqual(env.calls.setBrowserDeviceVolume, [70], 'and Drift\'s slider never reached the Browser volume');

  // close and reopen: the popover opens on the tab that was chosen last
  open = false;
  await env.render(tree());
  assert.equal(env.qa('[data-testid="browser-media-popover"]').length, 0);
  open = true;
  await env.render(tree());
  assert.equal(env.q('[data-testid="media-source-tab-drift"]').getAttribute('aria-selected'), 'true', 'the last choice is remembered while both sources exist');
  assert.equal(env.qa('.fixed.inset-0.z-\\[130\\]').length, 1, 'still one backdrop');
  assert.ok(env.calls.freeze > frozen, 'each opening freezes the page again, as it always did');
  const frozenNow = env.calls.freeze;

  // clearing Drift leaves the popover (Browser still has a session), with Drift's controls disabled and explained
  await env.click(env.q('[data-testid="drift-mini-clear"]'));
  assert.deepEqual(harness.probe.current.selection, []);
  assert.ok(env.q('[data-testid="browser-media-popover"]'), 'the popover stays: Browser is still there');
  assert.equal(env.q('[data-testid="drift-mini-toggle"]').disabled, true);
  assert.equal(env.q('[data-testid="drift-mini-clear"]').disabled, true);
  assert.match(env.q('[data-testid="drift-mini-count"]').textContent, /Mezcla vacía/);
  assert.ok(env.q('[data-testid="drift-mini-open"]'), 'and the way into the tool is still offered');
  assert.equal(env.calls.freeze, frozenNow, 'no re-freeze from clearing, or from anything since the popover opened');
  await act(async () => env.root.unmount());
});

test('the tabs are a WAI-ARIA tablist: roving focus and arrow keys', async () => {
  const env = environment({ stored: savedMix() });
  await env.render(env.strict(h(harness.BrowserMediaProvider, null, provider(h(harness.PopoverHarness, { anchor: env.dom.window.document.body, onClose: () => undefined, onOpenDrift: () => undefined })))));
  const list = env.q('[role="tablist"]');
  assert.ok(list);
  const [browserTab, driftTab] = ['browser', 'drift'].map((id) => env.q(`[data-testid="media-source-tab-${id}"]`));
  assert.equal(driftTab.getAttribute('tabindex'), '0');
  assert.equal(browserTab.getAttribute('tabindex'), '-1');
  assert.equal(env.q('[role="tabpanel"]').getAttribute('aria-labelledby'), 'media-source-tab-drift');
  await act(async () => { driftTab.dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
  assert.equal(env.q('[data-testid="media-source-tab-browser"]').getAttribute('aria-selected'), 'true');
  await act(async () => { env.q('[data-testid="media-source-tab-browser"]').dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { key: 'End', bubbles: true })); });
  assert.equal(env.q('[data-testid="media-source-tab-drift"]').getAttribute('aria-selected'), 'true');
  assert.equal(env.contexts.length, 0, 'keyboard navigation of the tabs plays nothing');
  await act(async () => env.root.unmount());
});

test('Active shows paused and failed voices, clears a stale search and keeps volume, retry and removal available', async () => {
  const env = environment({ readImpl: async () => { throw new Error('drift-audio:corrupt'); } });
  await env.render(env.strict(provider(h(harness.ToolkitDriftView, { onBack: () => undefined }))));
  await env.click(env.q('[data-testid="drift-card-brown-noise"] button[aria-pressed]'));
  await env.click(env.q('[data-testid="drift-card-fixture-corrupt"] button[aria-pressed]'));
  await env.settle(8);
  await env.click(env.q('[data-testid="drift-mix-toggle"]'));
  await env.input(env.q('[data-testid="drift-search"]'), 'a query that matches nothing');
  await env.click(env.q('[data-testid="drift-filter-active"]'));
  assert.equal(env.q('[data-testid="drift-search"]').value, '', 'Active reveals the whole mix');
  assert.equal(env.qa('[data-testid^="drift-active-voice-"]').length, 2);
  assert.equal(env.q('[data-testid="drift-grid"]'), null);
  assert.ok(env.q('[data-testid="drift-retry-fixture-corrupt"]'), 'failed voice can be retried');
  assert.match(env.q('[data-testid="drift-active-voice-brown-noise"]').textContent, /En pausa/);
  await env.input(env.q('[data-testid="drift-volume-brown-noise"]'), 72);
  assert.equal(harness.probe.current.voices.find((voice) => voice.id === 'brown-noise').volume, .72);
  await env.click(env.q('[data-testid="drift-active-remove-fixture-corrupt"]'));
  assert.deepEqual(harness.probe.current.selection, ['brown-noise']);
  await env.click(env.q('[data-testid="drift-clear"]'));
  assert.ok(env.q('[data-testid="drift-active-empty"]'));
  assert.equal(env.q('[data-testid="drift-mix-toggle"]').disabled, true);
  await act(async () => env.root.unmount());
});

test('usage counts successful playback starts, never failed loads, controls or paused preset restoration', async () => {
  const env = environment({ readImpl: async () => { throw new Error('Unreadable fixture'); } });
  await env.render(env.strict(provider(h(harness.ToolkitDriftView, { onBack: () => undefined }))));
  await env.click(env.q('[data-testid="drift-card-brown-noise"] button[aria-pressed]'));
  assert.equal(harness.probe.current.usage['brown-noise'], 1);
  await act(async () => {
    harness.probe.current.setVolume('brown-noise', 0.6);
    harness.probe.current.setMaster(0.8);
    harness.probe.current.setSort('usage');
    harness.probe.current.toggleFavorite('brown-noise');
  });
  assert.equal(harness.probe.current.usage['brown-noise'], 1);
  await env.click(env.q('[data-testid="drift-mix-toggle"]'));
  await env.click(env.q('[data-testid="drift-mix-toggle"]'));
  assert.equal(harness.probe.current.usage['brown-noise'], 2);
  await act(async () => { harness.probe.current.toggleSound('fixture-a'); });
  await env.settle();
  assert.equal(harness.probe.current.voices.find(voice => voice.id === 'fixture-a').status, 'error');
  assert.equal(harness.probe.current.usage['fixture-a'], undefined);
  await act(async () => { harness.probe.current.savePreset('Lectura', 'bookOpen'); });
  const preset = harness.probe.current.presets[0];
  await act(async () => { harness.probe.current.applyPreset(preset.id); });
  await env.settle();
  assert.equal(harness.probe.current.usage['brown-noise'], 2);
  assert.equal(harness.probe.current.presetUsage[preset.id], 1);
  await env.click(env.q('[data-testid="drift-mix-toggle"]'));
  assert.equal(harness.probe.current.usage['brown-noise'], 3);
  assert.equal(harness.probe.current.usage['fixture-a'], undefined);
  assert.equal(env.contexts.length, 1, 'usage tracking never rebuilds the engine');
  await act(async () => env.root.unmount());
  const restored = environment({ stored: env.writes.at(-1)[1] });
  await restored.render(restored.strict(provider()));
  assert.equal(harness.probe.current.sort, 'usage');
  assert.equal(harness.probe.current.usage['brown-noise'], 3);
  assert.equal(restored.contexts.length, 0);
  await act(async () => restored.root.unmount());
});

test('the sorting popover offers four icon/text choices, changes order silently, and supports keyboard and fullscreen Escape', async () => {
  const env = environment();
  await env.render(env.strict(provider(h(harness.ToolkitDriftView, { onBack: () => undefined }))));
  const names = () => env.qa('[data-testid="drift-grid"] .drift-sound-name').map(node => node.textContent);
  const recommended = names();
  const trigger = env.q('[data-testid="drift-sort-toggle"]');
  assert.match(trigger.getAttribute('aria-label'), /Recomendado/);
  await env.click(trigger);
  const choices = env.qa('[data-testid="drift-sort-menu"] [role="menuitemradio"]');
  assert.equal(choices.length, 4);
  assert.ok(choices.every(button => button.querySelector('svg') && button.querySelector('span')?.textContent));
  assert.equal(choices[0].getAttribute('aria-checked'), 'true');
  await act(async () => choices[0].dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  assert.equal(env.dom.window.document.activeElement, choices[1]);
  await env.click(choices[1]);
  assert.equal(env.q('[data-testid="drift-sort-menu"]'), null);
  assert.equal(env.dom.window.document.activeElement, trigger);
  const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
  assert.deepEqual(names(), [...recommended].sort(collator.compare));
  await env.click(trigger);
  await env.click(env.q('[data-testid="drift-sort-recommended"]'));
  assert.deepEqual(names(), recommended);
  await env.click(trigger);
  await act(async () => env.dom.window.document.body.dispatchEvent(new env.dom.window.MouseEvent('pointerdown', { bubbles: true })));
  assert.equal(env.q('[data-testid="drift-sort-menu"]'), null, 'an outside click closes the popover');
  const workspace = env.q('[data-testid="toolkit-drift"]');
  let current = null;
  Object.defineProperty(env.dom.window.document, 'fullscreenElement', { get: () => current });
  workspace.requestFullscreen = async () => { current = workspace; env.dom.window.document.dispatchEvent(new env.dom.window.Event('fullscreenchange')); };
  env.dom.window.document.exitFullscreen = async () => { current = null; env.dom.window.document.dispatchEvent(new env.dom.window.Event('fullscreenchange')); };
  await env.click(env.q('[data-testid="drift-fullscreen-toggle"]'));
  await env.click(trigger);
  await act(async () => env.dom.window.document.dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(env.q('[data-testid="drift-sort-menu"]'), null);
  assert.equal(current, workspace, 'Escape closes sorting before exiting fullscreen');
  await act(async () => env.dom.window.document.dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(current, null);
  await env.click(env.q('[data-testid="drift-filter-presets"]'));
  assert.ok(env.q('[data-testid="drift-search"]'));
  await env.click(trigger);
  await env.click(env.q('[data-testid="drift-sort-alphabetical"]'));
  assert.equal(env.contexts.length, 0, 'opening and choosing sorting never starts audio');
  await act(async () => env.root.unmount());
  const restored = environment({ stored: env.writes.at(-1)[1] });
  await restored.render(restored.strict(provider(h(harness.ToolkitDriftView, { onBack: () => undefined }))));
  assert.match(restored.q('[data-testid="drift-sort-toggle"]').getAttribute('aria-label'), /Alfabético/);
  await act(async () => restored.root.unmount());
});

test('preset search remains available when empty and filters names without accents or case without starting audio', async () => {
  for (const presets of [[], [
    { id: 'reading', name: 'Lectúra', icon: 'bookOpen', selection: ['brown-noise'], volumes: { 'brown-noise': 0.4 }, master: 0.5 },
    { id: 'night', name: 'Noche', icon: 'moon', selection: ['white-noise'], volumes: { 'white-noise': 0.3 }, master: 0.5 },
  ]]) {
    const env = environment({ stored: savedMix({ selection: [], filter: 'presets', presets }) });
    await env.render(env.strict(provider(h(harness.ToolkitDriftView, { onBack: () => undefined }))));
    const search = env.q('[data-testid="drift-search"]');
    assert.ok(search, 'the search bar is present even without saved presets');
    assert.equal(search.getAttribute('placeholder'), 'Buscar predefinidos');
    await env.input(search, 'LECTURA');
    if (!presets.length) {
      assert.ok(env.q('[data-testid="drift-presets-empty"]'));
    } else {
      assert.ok(env.q('[data-testid="drift-preset-reading"]'));
      assert.equal(env.q('[data-testid="drift-preset-night"]'), null);
      await env.input(search, 'no match');
      assert.ok(env.q('[data-testid="drift-presets-no-results"]'));
      assert.equal(env.qa('.drift-preset-card').length, 0);
      await env.click(env.q('button[aria-label="Limpiar búsqueda"]'));
      assert.equal(search.value, '');
      assert.equal(env.qa('.drift-preset-card').length, 2);
    }
    assert.equal(env.contexts.length, 0, 'searching does not start playback');
    await act(async () => env.root.unmount());
  }
});

test('presets save, edit, reload paused in the same context, survive restart and delete without changing the mix', async () => {
  const env = environment();
  await env.render(env.strict(provider(h(harness.ToolkitDriftView, { onBack: () => undefined }))));
  assert.equal(env.q('[data-testid="drift-save-preset"]').disabled, true);
  await env.click(env.q('[data-testid="drift-card-brown-noise"] button[aria-pressed]'));
  await env.input(env.q('[data-testid="drift-volume-brown-noise"]'), 65);
  await env.input(env.q('[data-testid="drift-master"]'), 80);
  await env.click(env.q('[data-testid="drift-save-preset"]'));
  await env.input(env.q('[data-testid="drift-preset-name"]'), 'Lectura');
  await env.click(env.q('[data-testid="drift-preset-icon-bookOpen"]'));
  await act(async () => env.q('[data-testid="drift-preset-editor"]').dispatchEvent(new env.dom.window.Event('submit', { bubbles: true, cancelable: true })));
  const saved = structuredClone(harness.probe.current.presets[0]);
  assert.equal(saved.name, 'Lectura'); assert.equal(saved.icon, 'bookOpen');
  assert.equal(harness.probe.current.playing, true, 'saving does not interrupt playback');
  await env.click(env.q(`[data-testid="drift-preset-edit-${saved.id}"]`));
  await env.input(env.q('[data-testid="drift-preset-name"]'), 'Noche');
  await env.click(env.q('[data-testid="drift-preset-icon-moon"]'));
  await act(async () => env.q('[data-testid="drift-preset-editor"]').dispatchEvent(new env.dom.window.Event('submit', { bubbles: true, cancelable: true })));
  assert.deepEqual(harness.probe.current.presets[0], { ...saved, name: 'Noche', icon: 'moon' });
  await act(async () => { harness.probe.current.setVolume('brown-noise', 0.1); });
  await env.click(env.q(`[data-testid="drift-preset-load-${saved.id}"]`));
  await env.settle();
  assert.equal(harness.probe.current.playing, false);
  assert.equal(harness.probe.current.voices[0].status, 'paused');
  assert.equal(harness.probe.current.voices[0].volume, 0.65);
  assert.equal(harness.probe.current.master, 0.8);
  assert.equal(env.contexts.length, 1, 'loading uses the original context');
  await act(async () => { harness.probe.current.play(); });
  await env.settle();
  assert.equal(harness.probe.current.playing, true, 'explicit play starts the loaded mix');
  await act(async () => env.root.unmount());
  const restored = environment({ stored: env.writes.at(-1)[1] });
  await restored.render(restored.strict(provider(h(harness.ToolkitDriftView, { onBack: () => undefined }))));
  assert.equal(harness.probe.current.presets[0].name, 'Noche');
  assert.equal(restored.contexts.length, 0);
  await restored.click(restored.q('[data-testid="drift-filter-presets"]'));
  await restored.click(restored.q(`[data-testid="drift-preset-delete-${saved.id}"]`));
  assert.deepEqual(harness.probe.current.presets, []);
  assert.deepEqual(harness.probe.current.selection, ['brown-noise']);
  await act(async () => restored.root.unmount());
});

test('fullscreen follows the document, exits with Escape and unmounts without changing playback', async () => {
  const env = environment();
  await env.render(env.strict(provider(h(harness.ToolkitDriftView, { onBack: () => undefined }))));
  const workspace = env.q('[data-testid="toolkit-drift"]');
  let current = null;
  Object.defineProperty(env.dom.window.document, 'fullscreenElement', { get: () => current });
  workspace.requestFullscreen = async () => { current = workspace; env.dom.window.document.dispatchEvent(new env.dom.window.Event('fullscreenchange')); };
  env.dom.window.document.exitFullscreen = async () => { current = null; env.dom.window.document.dispatchEvent(new env.dom.window.Event('fullscreenchange')); };
  await env.click(env.q('[data-testid="drift-fullscreen-toggle"]'));
  assert.equal(workspace.dataset.fullscreen, 'true');
  await act(async () => env.dom.window.document.dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(workspace.dataset.fullscreen, 'false');
  assert.equal(env.contexts.length, 0, 'fullscreen does not start audio');
  await env.click(env.q('[data-testid="drift-fullscreen-toggle"]'));
  await act(async () => env.root.unmount());
  assert.equal(current, null, 'leaving the tool exits fullscreen');
});
