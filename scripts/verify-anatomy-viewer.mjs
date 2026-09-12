// Exercise the existing React result component and native viewer with verified atlas bytes.
// No model APIs or external resources: local synthetic chat references only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkout = process.env.NODUS_MARKETPLACE_CHECKOUT;
if (!checkout) throw new Error('Set NODUS_MARKETPLACE_CHECKOUT to the marketplace under test.');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-atlas-viewer-'));
const output = process.env.NODUS_ATLAS_QA_OUTPUT || scratch;
fs.mkdirSync(output, { recursive: true });
let browser, server;
try {
  const native = path.join(scratch, 'native.cjs');
  await build({ entryPoints: [path.join(root, 'electron/pluginAssets.ts')], outfile: native, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const { selectPackagedModel } = createRequire(import.meta.url)(native);
  const dir = path.join(checkout, 'anatomy-visualization/capabilities/anatomy');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'capability.json')));
  const assets = new Map(manifest.assets.map(a => [a.id, a]));
  const runtime = new Function('return (' + fs.readFileSync(path.join(dir, 'runtime.js'), 'utf8') + ')')();
  const host = { assets: { read: async id => JSON.parse(fs.readFileSync(path.join(dir, assets.get(id).path))) } };
  const cases = [
    { structures: ['left kidney', 'right kidney'], language: 'es' },
    { structures: ['digestive system'] },
    { structures: ['uterus'], sex: 'female' },
    { structures: ['left deltoid', 'right deltoid'] },
  ];
  const files = new Map(), results = [];
  const validator = createRequire(path.join(checkout, 'package.json'))('gltf-validator');
  for (const input of cases) {
    const result = await runtime({ toolId: 'render-anatomy-3d', input }, host);
    for (const panel of result.panels) {
      const asset = assets.get(panel.assetId);
      const bytes = selectPackagedModel({ asset, text: fs.readFileSync(path.join(dir, asset.path), 'base64') }, panel.nodeIds);
      const report = await validator.validateBytes(bytes, { externalResourceFunction: async () => { throw new Error('External resource'); } });
      const failures = report.issues.messages.filter(m => m.severity < 2);
      assert.equal(report.issues.numErrors, 0, JSON.stringify(failures));
      assert.equal(report.issues.numWarnings, 0, JSON.stringify(failures));
      const id = '00000000-0000-4000-8000-' + String(files.size + 1).padStart(12, '0');
      files.set('/models/' + id, bytes);
      results.push({ kind: 'model', metadata: result.metadata, panels: [{ source: 'nodus-capability://chat/' + 'a'.repeat(64) + '/' + id, title: panel.title, alt: panel.alt, bytes: bytes.length, name: panel.assetId + '.glb', mimeType: asset.mimeType }] });
    }
  }
  const svg = await runtime({ toolId: 'render-anatomy', input: { structures: ['liver', 'kidneys'], labelMode: 'numbers', legend: false } }, {});
  await build({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ChatCapabilityResult} from './src/components/ChatCapabilityResult';
    window.nodus={readCapabilityModel:async source=>({bytes:new Uint8Array(await (await fetch('/models/'+source.split('/').pop())).arrayBuffer()),mimeType:'model/gltf-binary'})};
    const results=${JSON.stringify(results)};
    createRoot(document.getElementById('root')).render(<>{results.map((result,i)=><div key={i} data-case={i}><ChatCapabilityResult source={JSON.stringify({capabilityId:'anatomy-visualization:anatomy',pluginId:'anatomy-visualization',result})}/></div>)}</>);
  `, resolveDir: root, loader: 'tsx' }, outfile: path.join(scratch, 'viewer.js'), bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', logLevel: 'silent' });
  const html = '<html><head><link rel="stylesheet" href="/viewer.css"><style>body{font:16px system-ui;background:#f5f5f5;color:#e5e7eb;margin:24px} [data-case]{width:850px;border:1px solid #bbb;padding:12px;margin-bottom:20px}pre{white-space:pre-wrap}button{padding:8px;margin:4px}.capability-view-model-stage{height:420px}svg{max-width:850px}</style></head><body><div id="root"></div><section id="quiz">' + svg.svg + '</section><script type="module" src="/viewer.js"></script></body></html>';
  server = http.createServer((req, res) => {
    const name = req.url;
    if (name === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); }
    else if (files.has(name)) res.end(files.get(name));
    else if (name === '/viewer.js' || name === '/viewer.css') { res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(fs.readFileSync(path.join(scratch, name.slice(1)))); }
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const chrome = process.env.CHROME_PATH || [chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
  assert.ok(chrome, 'A Chromium installation is required for the native viewer check.');
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
  const errors = [], remote = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { remote.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.goto('http://127.0.0.1:' + server.address().port);
  for (let i = 0; i < results.length; i++) {
    const figure = page.locator('[data-case="' + i + '"]');
    await figure.locator('.capability-view-model-open').click();
    await figure.locator('.capability-view-model[data-state="ready"]').waitFor();
    const canvas = figure.locator('canvas');
    const before = await canvas.screenshot();
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 40, { steps: 12 }); await page.mouse.up();
    await page.waitForTimeout(250);
    assert.notDeepEqual(await canvas.screenshot(), before, 'Dragging rotates the reference model');
    await figure.locator('.capability-view-model-controls button').nth(0).click();
    await figure.screenshot({ path: path.join(output, 'model-' + i + '.png') });
    await figure.locator('.capability-view-model-controls button').nth(2).click();
    assert.equal(await figure.locator('canvas').count(), 0, 'Closing disposes the viewer');
  }
  await page.locator('#quiz').screenshot({ path: path.join(output, 'quiz.png') });
  assert.deepEqual(errors, []); assert.deepEqual(remote, []);
  console.log(JSON.stringify({ status: 'passed', nativeViewerModels: results.length, interactions: ['open', 'rotate', 'reset', 'close'], selectedModelsValidated: true, screenshots: output }));
} finally {
  await browser?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve());
  fs.rmSync(scratch, { recursive: true, force: true });
}
