import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marker = '--electron-gemini-deterministic-live';
const profileArg = process.argv.find((value) => value.startsWith('--profile='));

if (!process.argv.includes(marker)) {
  assert.ok(profileArg, 'Usage: node scripts/verify-gemini-deterministic-live.mjs --profile=/isolated/Nodus/profile');
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/verify-gemini-deterministic-live.mjs'), marker, profileArg],
    { cwd: repoRoot, env: { ...process.env }, stdio: 'inherit' });
  process.exit(0);
}

const profile = profileArg?.slice('--profile='.length);
assert.ok(profile && path.isAbsolute(profile), 'The isolated profile must be an absolute path.');
const { app } = await import('electron');
app.setName('Nodus');
app.setPath('userData', profile);
const require = createRequire(import.meta.url);
installTsHook();
console.log('Gemini deterministic smoke: isolated profile selected; waiting for safe storage…');
app.whenReady()
  .then(runSmoke)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    app.exit(1);
  });

async function runSmoke() {
  let closeDb = () => undefined;
  try {
    console.log('Gemini deterministic smoke: loading AI transport…');
    const aiClient = require(path.join(repoRoot, 'electron/ai/aiClient.ts'));
    ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));
    const model = { provider: 'gemini', model: 'gemini-2.5-flash-lite' };
    const options = {
      system: 'Return only JSON. The property name must be exactly "values" and its value must be an array of exactly three strings.',
      user: 'Return exactly {"values":["alpha","beta","gamma"]}.',
      temperature: 0.15,
      maxTokens: 128,
      deterministic: true,
      noRetry: true,
      requestClass: 'background',
      jobId: 'gemini-native-seed-smoke',
    };
    const guard = (value) => Boolean(
      value && typeof value === 'object' && Array.isArray(value.values) &&
      value.values.length === 3 && value.values.every((entry) => typeof entry === 'string'),
    );
    console.log('Gemini deterministic smoke: sending first native request…');
    const first = await aiClient.completeJson(options, guard, model);
    console.log('Gemini deterministic smoke: sending identical native request…');
    const second = await aiClient.completeJson(options, guard, model);
    assert.deepEqual(second, first, 'the native fixed-seed request must reproduce its structured result');
    console.log(JSON.stringify({ pass: true, provider: model.provider, model: model.model, repeatedResultIdentical: true }));
  } finally {
    try { closeDb(); } catch { /* database may not have opened */ }
  }
}

function installTsHook() {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
