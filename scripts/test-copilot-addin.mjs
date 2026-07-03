import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-copilot-addin-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-copilot-addin.mjs'), '--electron-copilot-addin-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-copilot-addin-test-'));
installRuntimeHooks(root);

try {
  const { renderManifest, purgeCachedCopilotAddin } = require(path.join(repoRoot, 'electron/copilot/install.ts'));
  const template = fs.readFileSync(path.join(repoRoot, 'word-addin/manifest.xml'), 'utf8');
  const rendered = renderManifest(template, 4455, '0.7.20-beta.1');

  assert.match(rendered, /<Version>0\.7\.20\.1<\/Version>/);
  assert.match(rendered, /https:\/\/localhost:4455\/addin\/taskpane\.html/);
  assert.match(rendered, /<CustomTab id="Nodus\.Tab">/);
  assert.match(rendered, /<Label resid="Nodus\.Tab\.Label" \/>/);
  assert.doesNotMatch(rendered, /<OfficeTab id="TabHome">/);

  const cache = path.join(root, 'Wef');
  fs.mkdirSync(path.join(cache, 'Manifests'), { recursive: true });
  fs.mkdirSync(path.join(cache, 'Other'), { recursive: true });
  fs.writeFileSync(path.join(cache, 'Manifests', 'old-nodus'), '<Id>E4352919-FFEC-4F77-8268-975BB4217FAD</Id>');
  fs.writeFileSync(path.join(cache, 'Other', 'old-label'), 'Nodus Copiloto');
  fs.writeFileSync(path.join(cache, 'Other', 'keep'), 'Claude in Microsoft Office');

  const removed = await purgeCachedCopilotAddin(cache);
  assert.equal(removed, 2);
  assert.equal(fs.existsSync(path.join(cache, 'Manifests', 'old-nodus')), false);
  assert.equal(fs.existsSync(path.join(cache, 'Other', 'old-label')), false);
  assert.equal(fs.existsSync(path.join(cache, 'Other', 'keep')), true);
  console.log('copilot add-in manifest/cache test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath() {
        return userDataPath;
      },
      getVersion() {
        return '0.7.20';
      },
      getAppPath() {
        return repoRoot;
      },
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable() {
        return false;
      },
      encryptString(value) {
        return Buffer.from(String(value), 'utf8');
      },
      decryptString(value) {
        return Buffer.from(value).toString('utf8');
      },
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };

  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
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
