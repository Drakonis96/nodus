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

if (!process.argv.includes('--electron-world-chat-history-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-world-chat-history-db.mjs'), '--electron-world-chat-history-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'nodus-world-chat-history-'));
installRuntimeHooks(tempRoot);

try {
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION, migrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const repo = require(path.join(repoRoot, 'electron/db/worldChatRepo.ts'));
  const db = getDb();

  assert.ok(SCHEMA_VERSION >= 102);
  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  const migration = migrations.find((item) => item.version === 102);
  assert.ok(migration, 'migration 102 exists');
  assert.doesNotMatch(migration.up.replace(/--[^\n]*/g, ' '), /\b(ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE)\b/i);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='world_chat_conversations'").get().count,
    1
  );

  const selection = { scope: 'manual', entryKeys: ['character:aurel', 'place:far'], keepFocus: false };
  const model = { provider: 'ollama', model: 'qwen3:8b' };
  const created = repo.createWorldChatConversation({ title: 'La siguiente escena', selection, model });
  assert.equal(created.messageCount, 0);
  assert.deepEqual(created.selection, selection);
  assert.deepEqual(created.model, model);

  const messages = [
    { role: 'user', content: '¿Dónde está Aurel?' },
    { role: 'assistant', content: 'En el Faro.' },
  ];
  const focus = [{ kind: 'character', id: 'aurel', title: 'Aurel' }];
  const saved = repo.saveWorldChatConversation(created.id, messages, selection, focus, model);
  assert.deepEqual(saved.messages, messages);
  assert.deepEqual(saved.focus, focus);
  assert.equal(saved.messageCount, 2);
  assert.equal(repo.listWorldChatConversations()[0].id, created.id);

  const { describeSyncCoverage } = require(path.join(repoRoot, 'electron/db/syncTables.ts'));
  assert.ok(describeSyncCoverage().included.worldbuilding.includes('world_chat_conversations'));

  repo.deleteWorldChatConversation(created.id);
  assert.equal(repo.getWorldChatConversation(created.id), null);
  console.log('World chat history database test passed!');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-test',
      getAppPath: () => repoRoot,
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(String(value), 'utf8'),
      decryptString: (value) => Buffer.from(value).toString('utf8'),
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
