// Seed a throwaway profile with the genealogy demo and launch the Nodus GUI in it,
// so the family tree, fichas, archive, evidence-driven suggestions and the guided
// tutorial can be explored without touching your real vaults. Portraits fill in
// automatically on launch if the profile has a Gemini key.
//
//   npm run build           # once, so dist-electron/ is current
//   node scripts/demo-genealogy.mjs [profileDir]
//
// The first pass re-execs under Electron-as-Node to seed the DB, then spawns the
// real GUI detached so it stays open after this script exits.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electronBin = path.join(repoRoot, 'node_modules/.bin/electron');

const profileDir = process.env.NODUS_DEMO_PROFILE || path.join(os.tmpdir(), 'nodus-genealogy-demo');

if (!process.argv.includes('--seed')) {
  if (!fs.existsSync(path.join(repoRoot, 'dist-electron/main.js'))) {
    console.log('[demo] building the app first…');
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  }
  fs.mkdirSync(profileDir, { recursive: true });
  console.log(`[demo] seeding genealogy demo into ${profileDir}`);
  execFileSync(electronBin, [fileURLToPath(import.meta.url), '--seed'], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODUS_USERDATA: profileDir },
    stdio: 'inherit',
  });
  console.log('[demo] launching Nodus in genealogy demo mode…');
  const child = spawn(electronBin, [repoRoot], {
    cwd: repoRoot,
    env: { ...process.env, NODUS_USERDATA: profileDir, NODUS_DISABLE_AUTO_UPDATE: '1' },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  console.log('[demo] done. Close the window to end; delete the profile dir to reset.');
  process.exit(0);
}

// ── Seed pass (Electron-as-Node) ────────────────────────────────────────────────
installRuntimeHooks(process.env.NODUS_USERDATA);
const { updateSettings } = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
const demo = require(path.join(repoRoot, 'electron/db/genealogyDemoData.ts'));
const { recordCounts } = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));

// Skip onboarding/first-run tour so the app opens straight into the demo.
updateSettings({ onboardingComplete: true, tourComplete: true });
const seeded = demo.seedGenealogyDemoData();
if (seeded) {
  const c = recordCounts();
  console.log(`[demo] seeded ${c.persons} people, ${c.events} events. Portraits generate on launch if a Gemini key is set.`);
} else {
  console.log('[demo] profile already has data — leaving it as is.');
}
process.exit(0);

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-demo', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (v) => Buffer.from(String(v), 'utf8'),
      decryptString: (v) => Buffer.from(v).toString('utf8'),
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
