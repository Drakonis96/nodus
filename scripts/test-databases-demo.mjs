// Databases-mode demo integrity: seeding populates the three sample databases with
// every column type and coloured options, flips the vault to `databases` (remembering
// the prior type), is idempotent/guarded, and clears surgically while restoring the
// vault type. Runs the REAL repo + demo module under Electron-as-Node.

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

if (!process.argv.includes('--electron-databases-demo-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-databases-demo.mjs'), '--electron-databases-demo-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-databases-demo-'));
installRuntimeHooks(root);

try {
  const demo = require(path.join(repoRoot, 'electron/db/databasesDemoData.ts'));
  const dbmode = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const shared = require(path.join(repoRoot, 'shared/databases.ts'));
  const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const { getSettings } = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));

  // Fresh academic vault → seeding flips it to databases and remembers the prior type.
  assert.equal(vaults.getActiveVault().type, 'academic', 'starts academic');
  assert.equal(demo.seedDatabasesDemoData(), true, 'demo seeds on an empty vault');
  assert.equal(vaults.getActiveVault().type, 'databases', 'vault flipped to databases');
  assert.equal(getSettings().demoPriorVaultType, 'academic', 'prior type remembered');

  // Three databases, every column type present, options coloured, rows + cells wired.
  const dbs = dbmode.listDatabases();
  assert.equal(dbs.length, 3, 'three sample databases seeded');
  const samples = dbs.find((d) => d.name === 'Muestras de campo' || d.name === 'Field samples');
  assert.ok(samples, 'field-samples database present');
  assert.equal(samples.rowCount, 8, 'field samples has 8 rows');

  const detail = dbmode.getDatabaseDetail(samples.id);
  const types = new Set(detail.columns.map((c) => c.type));
  for (const needed of ['title', 'text', 'number', 'date', 'time', 'select', 'multi_select', 'checkbox']) {
    assert.ok(types.has(needed), `column type ${needed} present in the demo`);
  }
  const speciesCol = detail.columns.find((c) => c.type === 'select');
  assert.ok(speciesCol.options.length >= 3 && speciesCol.options.every((o) => o.color), 'select options are coloured');

  // A row's cells decode correctly per type.
  const rows = dbmode.listRows(samples.id, { sort: 'position' });
  const first = rows[0];
  const titleCol = detail.columns.find((c) => c.type === 'title');
  const numCol = detail.columns.find((c) => c.type === 'number');
  const multiCol = detail.columns.find((c) => c.type === 'multi_select');
  const chkCol = detail.columns.find((c) => c.type === 'checkbox');
  assert.ok(first.cells[titleCol.id], 'title cell populated');
  assert.ok(shared.decodeNumber(first.cells[numCol.id]) != null, 'number cell decodes');
  assert.ok(shared.decodeMultiSelect(first.cells[multiCol.id]).length >= 1, 'multi-select cell has options');
  assert.equal(first.cells[chkCol.id], '1', 'checkbox cell stored');

  // The % header spans all databases (20 rows total: 8 + 6 + 6).
  const stats = dbmode.databaseStats(samples.id);
  assert.equal(stats.vaultTotal, 20, 'vault total across the three demo databases');
  assert.equal(stats.percent, 40, 'field samples is 40% of the rows');

  // Idempotent / guarded: a second seed is a no-op.
  assert.equal(demo.seedDatabasesDemoData(), false, 'seeding is guarded on a non-empty vault');
  assert.equal(dbmode.listDatabases().length, 3, 'no duplication on re-seed');

  // Clearing removes every demo row and restores the vault type.
  demo.clearDatabasesDemoData();
  assert.equal(dbmode.listDatabases().length, 0, 'demo databases cleared');
  assert.equal(vaults.getActiveVault().type, 'academic', 'vault type restored on clear');
  assert.equal(getSettings().demoPriorVaultType, null, 'prior type cleared');

  console.log('Databases demo test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
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
