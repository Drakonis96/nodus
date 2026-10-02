import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(os.tmpdir(), 'nodus-browser-overlays-'));
const bundle = path.join(directory, 'overlays.cjs');
await build({
  entryPoints: [path.join(root, 'src/browserOverlay.ts')],
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
});
const { observeBrowserNativeOverlays } = createRequire(import.meta.url)(bundle);
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const png = 'data:image/png;base64,fixture';

function fixture({ capture = async () => png, decode = async () => {}, restore = async () => {} } = {}) {
  const dom = new JSDOM('<body><div data-browser-viewport style="position:relative"></div></body>');
  const previous = { window: globalThis.window, document: globalThis.document, MutationObserver: globalThis.MutationObserver };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, MutationObserver: dom.window.MutationObserver });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 500, height: 300 });
  dom.window.HTMLImageElement.prototype.decode = decode;
  const calls = [];
  const image = () => dom.window.document.querySelector('[data-testid="browser-native-overlay-snapshot"]');
  dom.window.nodus = {
    captureBrowserOverlaySnapshot: capture,
    setBrowserOverlayVisible: async (visible) => {
      calls.push({ visible, snapshot: Boolean(image()) });
      if (!visible) await restore();
    },
  };
  const stop = observeBrowserNativeOverlays();
  const overlay = (role = 'dialog') => {
    const element = dom.window.document.createElement('div');
    if (role === 'popover') element.dataset.browserNativeOverlay = 'true';
    else element.setAttribute('role', role);
    dom.window.document.body.append(element);
    return element;
  };
  return {
    calls, image, overlay, stop,
    async close() {
      stop();
      await settle();
      dom.window.close();
      Object.assign(globalThis, previous);
    },
  };
}

test('native overlays preserve the page and handle asynchronous opening/closing', async (t) => {
  try {
    await t.test('decode precedes hiding; overlapping menus keep one snapshot until the native page returns', async () => {
      const decoded = deferred();
      const restored = deferred();
      const f = fixture({ decode: () => decoded.promise, restore: () => restored.promise });
      try {
        const menu = f.overlay('popover');
        await settle();
        assert.equal(f.calls.length, 0, 'never hide the page before the image is decoded');
        decoded.resolve();
        await settle();
        assert.ok(f.image());
        assert.ok(f.calls.every((call) => call.visible && call.snapshot));
        assert.equal(f.image().parentElement.hasAttribute('data-browser-viewport'), true);
        assert.equal(f.image().style.width, '100%', 'the snapshot follows the resized viewport');
        assert.equal(f.image().style.pointerEvents, 'none');
        const dialog = f.overlay();
        await settle();
        const snapshot = f.image();
        menu.remove();
        await settle();
        assert.equal(f.image(), snapshot, 'closing one overlay must retain the shared backing image');
        assert.equal(f.calls.at(-1).visible, true);
        dialog.remove();
        await settle();
        assert.equal(f.calls.at(-1).visible, false);
        assert.equal(f.calls.at(-1).snapshot, true, 'restore native content before removing the image');
        assert.equal(f.image(), snapshot);
        restored.resolve();
        await settle();
        assert.equal(f.image(), null);
      } finally { restored.resolve(); await f.close(); }
    });

    await t.test('a slow capture cannot hide the page after its menu has closed', async () => {
      const captured = deferred();
      const f = fixture({ capture: () => captured.promise });
      try {
        const menu = f.overlay('popover');
        await settle();
        menu.remove();
        await settle();
        captured.resolve(png);
        await settle();
        assert.equal(f.image(), null);
        assert.ok(f.calls.every((call) => !call.visible));
      } finally { await f.close(); }
    });

    await t.test('closing and reopening invalidates the old restoration cleanup', async () => {
      const restored = deferred();
      const f = fixture({ restore: () => restored.promise });
      try {
        const menu = f.overlay();
        await settle();
        menu.remove();
        await settle();
        f.overlay('popover');
        await settle();
        const snapshot = f.image();
        restored.resolve();
        await settle();
        assert.ok(snapshot);
        assert.equal(f.image(), snapshot);
        assert.equal(f.calls.at(-1).visible, true);
      } finally { restored.resolve(); await f.close(); }
    });

    await t.test('leaving Browser cancels a pending decode and removes the backing image', async () => {
      const decoded = deferred();
      const f = fixture({ decode: () => decoded.promise });
      try {
        f.overlay();
        await settle();
        f.stop();
        decoded.resolve();
        await settle();
        assert.equal(f.image(), null);
        assert.ok(f.calls.every((call) => !call.visible));
      } finally { await f.close(); }
    });

    await t.test('a capture failure still protects overlapping app dialogs from the native page', async () => {
      const f = fixture({ capture: async () => { throw new Error('capture unavailable'); } });
      try {
        const menu = f.overlay('popover');
        const dialog = f.overlay();
        await settle();
        assert.equal(f.image(), null);
        assert.equal(f.calls.at(-1).visible, true);
        // Simulate the child's native visibility cleanup before its removal.
        await window.nodus.setBrowserOverlayVisible(false);
        dialog.remove();
        await settle();
        assert.equal(f.calls.at(-1).visible, true);
        menu.remove();
        await settle();
        assert.equal(f.calls.at(-1).visible, false);
      } finally { await f.close(); }
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
