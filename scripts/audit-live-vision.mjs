import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-live-vision')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/audit-live-vision.mjs'), '--electron-live-vision'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const key = process.env.NODUS_AUDIT_GEMINI_KEY;
if (!key) throw new Error('NODUS_AUDIT_GEMINI_KEY is required.');
const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-live-vision-'));
installRuntimeHooks(userDataPath);

try {
  const { createCanvas } = require('@napi-rs/canvas');
  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const settings = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const vision = require(path.join(repoRoot, 'electron/ai/imageAnalysis.ts'));
  const database = require(path.join(repoRoot, 'electron/db/database.ts'));
  const model = { provider: 'gemini', model: 'gemini-2.5-flash-lite' };
  secrets.setApiKey('gemini', key);
  settings.updateSettings({ extractionModel: model, visionModel: model, promptLanguage: 'es' });

  const canvas = createCanvas(1000, 360);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#111111';
  context.font = 'bold 62px sans-serif';
  context.fillText('ARCHIVO NODUS', 70, 145);
  context.font = '52px sans-serif';
  context.fillText('AÑO 2024', 70, 250);
  const result = await vision.analyzeImageBytes(canvas.toBuffer('image/png'), 'image/png', model);
  assert.ok(result?.description.trim().length > 20, 'vision must return an objective description');
  assert.match(result?.text ?? '', /(?:NODUS|2024)/iu, 'vision OCR must recover visible text');
  database.closeDb();
  console.log(JSON.stringify({
    model: model.model,
    description: true,
    ocr: true,
    recognizedMarker: true,
  }));
} finally {
  fs.rmSync(userDataPath, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-audit', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(String(value)),
      decryptString: (value) => Buffer.from(value).toString(),
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
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
