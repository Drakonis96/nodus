// Seed a throwaway profile with the teaching demo and launch the Nodus GUI in it, so
// the class list, the rubric, the exam builder, the gradebook and the guided tutorial
// can be explored without touching your real vaults.
//
//   npm run build           # once, so dist-electron/ is current
//   node scripts/demo-teaching.mjs [profileDir]
//
// The first pass re-execs under Electron-as-Node to convert the profile's vault to
// `docencia` and seed it, then spawns the real GUI detached so it stays open after
// this script exits.
//
// NEVER verify teaching UI with `npm run dev` against your own install: that runs any
// pending migrations against the live vault. This isolated profile is the safe path.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electronBin = path.join(repoRoot, 'node_modules/.bin/electron');

const profileDir = process.env.NODUS_DEMO_PROFILE || path.join(os.tmpdir(), 'nodus-teaching-demo');

if (!process.argv.includes('--seed')) {
  if (!fs.existsSync(path.join(repoRoot, 'dist-electron/main.js'))) {
    console.log('[demo] building the app first…');
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  }
  fs.mkdirSync(profileDir, { recursive: true });
  console.log(`[demo] seeding teaching demo into ${profileDir}`);
  execFileSync(electronBin, [fileURLToPath(import.meta.url), '--seed'], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODUS_USERDATA: profileDir },
    stdio: 'inherit',
  });
  console.log('[demo] launching Nodus in teaching demo mode…');
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
const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
const demo = require(path.join(repoRoot, 'electron/db/teachingDemoData.ts'));
const groups = require(path.join(repoRoot, 'electron/db/teachingGroupsRepo.ts'));

// Skip onboarding and the cinematic basics tutorial (its gate is `=== 0`), so the app
// opens straight into the teaching workspace; the docencia tour then shows because
// the seeder leaves docenciaTourComplete false.
updateSettings({ onboardingComplete: true, tourComplete: true, basicsTutorialVersion: 1 });
// The teaching demo refuses any vault that is not already `docencia` — it never
// converts one behind the user's back — so the throwaway profile is converted here.
vaults.setVaultType(vaults.getActiveVault().id, 'docencia');

if (demo.seedTeachingDemoData()) {
  const group = groups.listTeachingGroups()[0];
  const students = group ? groups.getTeachingGroup(group.id).students.length : 0;
  console.log(`[demo] seeded a course, ${students} students, a rubric, an exam and a published gradebook. The teaching tutorial shows on launch.`);
} else {
  console.log('[demo] profile already has the demo — leaving it as is.');
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
    // `@shared/assessment` is a directory, so a blind `.ts` suffix misses its index.
    if (request.startsWith('@shared/')) {
      const rest = request.slice('@shared/'.length);
      const direct = path.join(repoRoot, 'shared', `${rest}.ts`);
      const asIndex = path.join(repoRoot, 'shared', rest, 'index.ts');
      return fs.existsSync(direct) ? direct : asIndex;
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
