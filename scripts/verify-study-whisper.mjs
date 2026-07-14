// Real local-Whisper integration check. It runs the same browser worker,
// WASM backend and audio decoder as the Study vault against the Kokoro samples
// shipped by the promotional site. This intentionally stays outside `npm test`:
// it downloads sizeable model files and can take several minutes.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { createServer } from 'vite';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const models = (process.env.NODUS_WHISPER_MODELS || 'Xenova/whisper-tiny,Xenova/whisper-base')
  .split(',').map((value) => value.trim()).filter(Boolean);
const fixtures = [
  {
    name: 'deep-research-sample.m4a',
    url: '/docs/assets/audio/deep-research-sample.m4a',
    expected: ['retrieval', 'practice', 'testing', 'memory', 'reading', 'recalling'],
  },
  {
    name: 'immersion-sample.m4a',
    url: '/docs/assets/audio/immersion-sample.m4a',
    expected: ['library', 'sky', 'constellation', 'stars', 'shelves', 'ideas'],
  },
];

if (!existsSync(path.join(repoRoot, 'dist-electron/main.js'))) {
  throw new Error('Run `npm run build` before the real Whisper verification.');
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-whisper-wasm-'));
const server = await createServer({
  configFile: false,
  root: repoRoot,
  logLevel: 'warn',
  resolve: { alias: { '@shared': path.join(repoRoot, 'shared') } },
  worker: { format: 'es' },
  server: { host: '127.0.0.1', port: 0, strictPort: false },
});
let app;
try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('The Whisper fixture server did not expose a TCP port.');
  const childEnv = {
    ...process.env,
    NODUS_USERDATA: userData,
    NODUS_DISABLE_AUTO_UPDATE: '1',
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: require('electron'),
    args: ['--headless', '--disable-gpu', repoRoot],
    env: childEnv,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // `createWindow()` starts its initial load without awaiting it. Let that
  // navigation settle before replacing the page with the isolated verifier.
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(750);
  await page.goto(`http://127.0.0.1:${address.port}/scripts/fixtures/study-whisper-verify.html`);
  await page.waitForFunction(() => document.documentElement.dataset.whisperVerifier === 'ready');

  const report = [];
  for (const model of models) {
    for (const fixture of fixtures) {
      process.stdout.write(`[whisper-wasm] ${model} × ${fixture.name}… `);
      const result = await page.evaluate(
        (request) => window.verifyStudyWhisper(request),
        { audioUrl: fixture.url, model, language: 'en' },
      );
      const normalized = result.text.toLocaleLowerCase();
      const matched = fixture.expected.filter((word) => normalized.includes(word));
      const wordCount = result.text.trim().split(/\s+/u).filter(Boolean).length;
      assert.ok(wordCount >= 12, `${model} produced too little text for ${fixture.name}: ${result.text}`);
      assert.ok(matched.length >= 2, `${model} missed expected content in ${fixture.name}: ${result.text}`);
      assert.ok(result.chunks.length > 0, `${model} did not return timestamped chunks for ${fixture.name}`);
      report.push({ model, fixture: fixture.name, wordCount, matched, durationMs: result.durationMs, text: result.text });
      console.log(`ok (${wordCount} words, ${matched.join(', ')}, ${(result.durationMs / 1000).toFixed(1)} s)`);
    }
  }
  assert.deepEqual(errors, [], `renderer errors: ${errors.join(' | ')}`);
  const payload = { backend: 'renderer-wasm', generatedAt: new Date().toISOString(), report };
  if (process.env.NODUS_WHISPER_REPORT) {
    await writeFile(path.resolve(process.env.NODUS_WHISPER_REPORT), JSON.stringify(payload, null, 2), 'utf8');
  }
  console.log(JSON.stringify(payload, null, 2));
  console.log('Real Study Whisper verification passed.');
} finally {
  await app?.close().catch(() => undefined);
  await server.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true });
}
