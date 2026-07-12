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

// The vault type's prompt pack must be APPENDED to the system prompt (like the
// language directive), be empty for academic (no behaviour change for existing
// vaults), and sit BEFORE the highest-priority language directive.
if (!process.argv.includes('--electron-vault-prompt-pack-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-vault-prompt-pack.mjs'), '--electron-vault-prompt-pack-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(fs.realpathSync(os.tmpdir()) + '/nodus-vault-prompt-pack-test-');
installRuntimeHooks(root);

const BASE = 'Eres un analista. Analiza la obra recibida.';

try {
  const { updateSettings } = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const { withVaultTypeContext, withPromptLanguage } = require(path.join(repoRoot, 'electron/ai/aiClient.ts'));
  const registry = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));

  updateSettings({ promptLanguage: 'es' });

  // The default vault is academic → no pack appended.
  assert.equal(registry.getActiveVault().type, 'academic');
  assert.equal(withVaultTypeContext({ system: BASE }).system, BASE, 'academic vault leaves the prompt unchanged');

  // An estudio vault appends its persona directive.
  const study = registry.createVault('Estudio', 'estudio');
  registry.setActiveVault(study.id);
  assert.equal(registry.getActiveVault().type, 'estudio');
  const withPack = withVaultTypeContext({ system: BASE }).system;
  assert.ok(withPack.startsWith(BASE), 'base prompt preserved as a prefix');
  assert.match(withPack, /MODO ESTUDIO/, 'estudio pack is appended');

  // Composition order: vault-type pack first, output-language directive last.
  updateSettings({ promptLanguage: 'en' });
  const composed = withPromptLanguage(withVaultTypeContext({ system: BASE })).system;
  assert.match(composed, /MODO ESTUDIO/, 'pack present in composed prompt');
  assert.match(composed, /HIGHEST PRIORITY/, 'language directive present in composed prompt');
  assert.ok(
    composed.indexOf('MODO ESTUDIO') < composed.indexOf('HIGHEST PRIORITY'),
    'the language directive must come after the vault-type pack'
  );

  // Switching back to the academic vault drops the pack again.
  updateSettings({ promptLanguage: 'es' });
  registry.setActiveVault('default');
  assert.equal(withVaultTypeContext({ system: BASE }).system, BASE, 'switching back to academic drops the pack');

  console.log('Vault prompt-pack test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;

  const Database = require('better-sqlite3');
  const testDb = new Database(':memory:');
  testDb.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');

  const electronStub = {
    app: {
      getPath() {
        return userDataPath;
      },
      getVersion() {
        return '0.0.0-test';
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

  // Only the settings/secrets repos talk to the active DB in this test; the vault
  // registry manages its own on-disk sqlite files via the real better-sqlite3.
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    if (request === './database' || request === '../database') {
      return {
        getDb() {
          return testDb;
        },
      };
    }
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
