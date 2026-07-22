// Headless verification of the "Install/update in Zotero" flow. Runs the real
// install module under Electron-as-Node (electron stubbed; app.getAppPath →
// repo root so it zips zotero-plugin/). It WILL close + reopen a running Zotero.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electronBin = path.join(repoRoot, 'node_modules/.bin/electron');

if (!process.argv.includes('--seed')) {
  execFileSync(electronBin, [fileURLToPath(import.meta.url), '--seed'], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  });
  process.exit(0);
}

installRuntimeHooks();
const install = require(path.join(repoRoot, 'electron/zotero-plugin/install.ts'));

const info = await install.getZoteroInstallInfo();
console.log('installInfo:', JSON.stringify(info));
const res = await install.installZoteroPlugin();
console.log('installResult:', JSON.stringify(res));

// Give Zotero a moment to relaunch + register, then check.
await new Promise((r) => setTimeout(r, 11000));
const prof = info.profilePath;
try {
  const d = JSON.parse(fs.readFileSync(path.join(prof, 'extensions.json'), 'utf8'));
  const a = d.addons.find((x) => x.id === 'nodus-zotero@nodus.app');
  console.log('extensions.json →', a ? `v${a.version} active=${a.active}` : 'NOT REGISTERED');
} catch (e) { console.log('could not read extensions.json:', e.message); }
const reRunning = await install.isZoteroRunning();
console.log('zotero running after:', reRunning);
process.exit(res.ok ? 0 : 1);

function installRuntimeHooks() {
  const ts = require('typescript');
  const Module = require('node:module');
  const origResolve = Module._resolveFilename;
  const origLoad = Module._load;
  const electronStub = {
    app: { getAppPath: () => repoRoot, getPath: () => repoRoot, getVersion: () => '0.0.0-ztest', isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal: async () => {} },
    BrowserWindow: class {},
  };
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return origResolve.call(this, request, parent, isMain, options);
  };
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return origLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function (module, filename) {
    const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, resolveJsonModule: true, skipLibCheck: true },
    }).outputText;
    module._compile(out, filename);
  };
}
