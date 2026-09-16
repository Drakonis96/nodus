import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-runtime-ui-'));
const i18n = path.join(tmp, 'i18n.mjs');
const icons = path.join(tmp, 'icons.mjs');
await writeFile(i18n, 'export const pick = tables => tables[globalThis.__runtimeTestLanguage ?? "en"]; export const t = value => value;');
await writeFile(icons, 'export const Icon = () => null;');
const outfile = path.join(tmp, 'panel.mjs');
await build({ entryPoints: [path.join(repo, 'src/components/LocalAiRuntimePanel.tsx')], outfile,
  bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', logLevel: 'silent',
  plugins: [{ name: 'ui-boundaries', setup(b) {
    b.onResolve({ filter: /^\.\.\/i18n$/ }, () => ({ path: i18n }));
    b.onResolve({ filter: /^\.\/ui$/ }, () => ({ path: icons }));
  } }],
});
const { LocalAiRuntimePanel } = await import(pathToFileURL(outfile).href);
after(async () => { delete globalThis.__runtimeTestLanguage; await rm(tmp, { recursive: true, force: true }); });
const diagnostics = { backend: 'vulkan', devices: ['Vulkan0: NVIDIA fixture'], upgradeRequired: false,
  state: 'installed', offloadedLayers: null, fallbackReason: null, startupLog: '' };
const render = (changes = {}, busy = false) => renderToStaticMarkup(createElement(LocalAiRuntimePanel, {
  status: { version: 'b10002', ready: true, downloading: false, diagnostics: { ...diagnostics, ...changes } },
  busy, install: async () => { throw new Error('rendering must not install or contact the network'); },
}));

test('installed capability is distinguished from observed running GPU offload', () => {
  const installed = render();
  assert.match(installed, /Local engine installed/); assert.match(installed, /GPU detected during setup/);
  assert.doesNotMatch(installed, /Layers on GPU|Model ready/);
  assert.match(render({ state: 'loading' }), /Loading model/);
  assert.match(render({ state: 'ready', offloadedLayers: 28 }), /Layers on GPU: 28/);
  assert.match(render({ state: 'ready', offloadedLayers: 0 }), /CPU in use/);
});

test('legacy upgrade, CPU fallback, disabled actions and escaped diagnostics are visible', () => {
  assert.match(render({ upgradeRequired: true, fallbackReason: 'legacy-runtime' }), /Update local engine/);
  assert.match(render({ backend: 'cpu', fallbackReason: 'gpu-unavailable' }), /Check your drivers/);
  assert.match(render({ backend: 'cpu', fallbackReason: 'gpu-startup-failed' }), /CPU for this session/);
  assert.match(render({}, true), /disabled=""/);
  const failed = render({ state: 'failed', startupLog: '<script>not executable</script>' });
  assert.match(failed, /Local engine failed to start/);
  assert.match(failed, /&lt;script&gt;/); assert.doesNotMatch(failed, /<script>/);
});

test('the panel follows the existing active-language selector', () => {
  globalThis.__runtimeTestLanguage = 'es'; assert.match(render(), /Motor local instalado/);
  globalThis.__runtimeTestLanguage = 'zh-CN'; assert.match(render(), /本地引擎已安装/);
  globalThis.__runtimeTestLanguage = 'en';
});
