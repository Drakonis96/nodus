// Headless verification of an installation completed through Zotero's official
// Add-ons UI. This script is read-only: it never sideloads an XPI, edits prefs,
// or mutates extensions.json.
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
const prof = info.profilePath;
if (!prof) { console.error('No Zotero profile found.'); process.exit(1); }
const AdmZip = require('adm-zip');
const packaged = path.join(repoRoot, 'dist-zotero', 'nodus-zotero.xpi');
const manifest = JSON.parse(new AdmZip(packaged).readAsText('manifest.json'));
const deadline = Date.now() + 30_000;
let failure = 'NOT REGISTERED';
while (Date.now() < deadline) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(prof, 'extensions.json'), 'utf8'));
    const addon = d.addons.find((entry) => entry.id === 'nodus-zotero@nodus.app');
    if (!addon) { failure = 'NOT REGISTERED'; }
    else {
      const addonPath = String(addon.path || '');
      const checks = {
        version: addon.version === manifest.version,
        active: addon.active === true,
        appEnabled: addon.appDisabled === false,
        userEnabled: addon.userDisabled === false,
        xpiPath: addonPath.endsWith('.xpi') && fs.existsSync(addonPath),
      };
      const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
      if (!failed.length && await install.isZoteroRunning()) {
        console.log(`extensions.json → v${addon.version} active=true path=${addonPath}`);
        process.exit(0);
      }
      failure = `registered but invalid: ${failed.join(', ') || 'Zotero not running'}`;
    }
  } catch (error) { failure = `could not read extensions.json: ${error.message}`; }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
console.error(`Zotero plugin verification failed: ${failure}`);
process.exit(1);

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
