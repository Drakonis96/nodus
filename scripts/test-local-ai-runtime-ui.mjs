import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadRuntimeModule, repoRoot } from './local-ai-runtime-test-utils.mjs';

test('runtime diagnostics translate every supported locale and never confuse detection with offload', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-runtime-ui-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const entry = path.join(dir, 'entry.ts');
  await writeFile(entry, `
    export * from ${JSON.stringify(path.join(repoRoot, 'src/i18n.localAiRuntime.ts'))};
    export { setActiveLang } from ${JSON.stringify(path.join(repoRoot, 'src/i18n.ts'))};
    export { LocalRuntimeStatus } from ${JSON.stringify(path.join(repoRoot, 'src/components/LocalRuntimeStatus.tsx'))};
  `);
  const mod = await loadRuntimeModule(t, entry, { jsx: 'automatic', absWorkingDir: repoRoot });
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const tables = mod.LOCAL_RUNTIME_TRANSLATIONS;
  const keys = Object.keys(tables.en).sort();
  assert.deepEqual(Object.keys(tables).sort(), ['de', 'en', 'fr', 'it', 'pt', 'pt-BR', 'tr', 'zh-CN'].sort());
  const placeholders = (s) => [...s.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort();
  for (const [language, table] of Object.entries(tables)) {
    assert.deepEqual(Object.keys(table).sort(), keys, language);
    mod.setActiveLang(language);
    for (const key of keys) {
      assert.ok(table[key].trim(), `${language}: ${key}`);
      assert.deepEqual(placeholders(table[key]), placeholders(key), `${language}: preserved interpolation`);
      assert.equal(mod.runtimeText(key), table[key]);
    }
  }
  mod.setActiveLang('es');
  for (const key of keys) assert.equal(mod.runtimeText(key), key);
  mod.setActiveLang('en');
  const diagnostic = { backend: 'vulkan', devices: [{ id: 'Vulkan0', name: 'Fixture RTX 3060' }], legacy: false,
    phase: 'installed', offloadedLayers: null };
  const render = (patch = {}) => renderToStaticMarkup(React.createElement(mod.LocalRuntimeStatus, {
    runtime: { version: 'b10002', ready: true, executablePath: '/fixture/llama-server', downloading: false, progress: 1, diagnostics: { ...diagnostic, ...patch } },
    busy: false, onCheck() {}, onCancel() {},
  }));
  const detected = render();
  assert.match(detected, /Detected GPU: Fixture RTX 3060/);
  assert.match(detected, /GPU usage is checked when the model loads/);
  assert.doesNotMatch(detected, /Model layers on GPU:/);
  assert.match(detected, /nodus-local-runtime-upgrade/);
  assert.match(render({ phase: 'running', offloadedLayers: 18 }), /Model layers on GPU: 18/);
  assert.match(render({ backend: 'cpu', devices: [], phase: 'running', offloadedLayers: 0, fallbackReason: 'gpu-start-failed' }), /GPU startup failed; startup was retried on CPU/);
  assert.match(render({ backend: 'cpu', legacy: true, fallbackReason: 'legacy-cpu' }), /without downloading the models again/);
  const settings = await readFile(path.join(repoRoot, 'src/components/LocalAiModelsSettings.tsx'), 'utf8');
  assert.match(settings, /<LocalRuntimeStatus/);
  assert.match(settings, /onCheck=\{\(\) => void installRuntime\(\)\}/);
  assert.match(settings, /onCancel=\{\(\) => void cancelRuntime\(\)\}/);
  assert.match(settings, /window\.nodus\.cancelNodusLocalDownloads\(\)/);
});
