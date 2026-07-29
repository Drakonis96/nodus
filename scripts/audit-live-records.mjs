import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-live-records')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/audit-live-records.mjs'), '--electron-live-records'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const key = process.env.NODUS_AUDIT_GEMINI_KEY;
if (!key) throw new Error('NODUS_AUDIT_GEMINI_KEY is required.');
const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-live-records-'));
installRuntimeHooks(userDataPath);

try {
  const model = { provider: 'gemini', model: 'gemini-2.5-flash-lite' };
  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const settings = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const records = require(path.join(repoRoot, 'electron/ai/recordsScan.ts'));
  const database = require(path.join(repoRoot, 'electron/db/database.ts'));
  secrets.setApiKey('gemini', key);
  settings.updateSettings({ extractionModel: model, synthesisModel: model, promptLanguage: 'es' });
  const result = await records.scanArchiveTextRecords(
    'audit-archive-source',
    'Partida de nacimiento. En Sevilla, el 12 de mayo de 1901, nació María López, hija de Juan López y Ana Ruiz. Fuente: folio 3.',
    model,
  );
  assert.ok(result.persons >= 1, 'records extraction must identify people');
  assert.ok(result.places >= 1, 'records extraction must identify the stated place');
  assert.ok(result.events >= 1, 'records extraction must identify the birth event');
  assert.ok(result.evidence >= 1, 'persisted records must retain quoted evidence');
  database.closeDb();
  console.log(JSON.stringify({
    model: model.model,
    people: result.persons,
    places: result.places,
    events: result.events,
    evidence: result.evidence,
    persisted: true,
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
