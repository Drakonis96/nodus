// Conversation folders: additive migration, nesting, membership cascades, and the JSON-backed
// study surface. Runs under Electron-as-Node against a throwaway userData dir, like the other
// repository tests, so the real getDb()/migrations path is exercised.
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
if (!process.argv.includes('--electron-chat-folders-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [path.join(repoRoot, 'scripts/test-chat-folders.mjs'), '--electron-chat-folders-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-chat-folders-'));
installRuntimeHooks(root);
try {
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const folders = require(path.join(repoRoot, 'electron/db/chatFoldersRepo.ts'));
  const chat = require(path.join(repoRoot, 'electron/db/chatRepo.ts'));
  const study = require(path.join(repoRoot, 'electron/ai/studyAssistant.ts'));

  const db = getDb();
  assert.ok(SCHEMA_VERSION >= 179, `schema version advances (got ${SCHEMA_VERSION})`);
  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  const FOLDER_TABLES = ['chat_folders', 'chat_conversation_folders', 'database_conversation_folders', 'world_conversation_folders'];
  const tableExists = (name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  for (const table of FOLDER_TABLES) assert.ok(tableExists(table), `${table} exists`);

  // Nested folders on the research surface.
  const parent = folders.createChatFolder('research', 'Trials');
  const child = folders.createChatFolder('research', 'Cubane', parent.folderId);
  assert.equal(child.parentId, parent.folderId);
  assert.deepEqual(folders.listChatFolders('research').map((f) => f.name).sort(), ['Cubane', 'Trials']);

  // Rename, and refuse to move a folder into its own subtree.
  folders.renameChatFolder(child.folderId, 'Cubane runs');
  assert.equal(folders.getChatFolder(child.folderId).name, 'Cubane runs');
  assert.equal(folders.moveChatFolder(parent.folderId, child.folderId).parentId, null, 'cycle move is refused');
  assert.equal(folders.getChatFolder(parent.folderId).parentId, null);

  // Filing a conversation, then deleting it, cascades the membership away.
  const first = chat.createConversation({ title: 'First' });
  folders.setConversationFolder('research', first.id, parent.folderId);
  assert.equal(folders.conversationFolderMap('research')[first.id], parent.folderId);
  chat.deleteConversation(first.id);
  assert.equal(folders.conversationFolderMap('research')[first.id], undefined, 'membership cascades with the conversation');

  // Deleting a folder unfiles its conversations and drops its subfolders — never the chats.
  const second = chat.createConversation({ title: 'Second' });
  folders.setConversationFolder('research', second.id, child.folderId);
  folders.deleteChatFolder(parent.folderId);
  assert.equal(folders.getChatFolder(parent.folderId), null);
  assert.equal(folders.getChatFolder(child.folderId), null, 'subfolder cascades');
  assert.equal(folders.conversationFolderMap('research')[second.id], null, 'conversation is unfiled, not deleted');
  assert.ok(chat.getConversation(second.id), 'the conversation survives the folder delete');

  // Study carries its folder on the JSON record; deleting the folder orphans it.
  const researchFolders = folders.listChatFolders('study');
  assert.equal(researchFolders.length, 0);
  const studyFolder = folders.createChatFolder('study', 'Study trials');
  const studyChat = study.createStudyAssistantConversation({ title: 'Study chat' });
  study.setStudyConversationFolder(studyChat.id, studyFolder.folderId);
  assert.equal(study.listStudyConversationFolders()[studyChat.id], studyFolder.folderId);
  folders.deleteChatFolder(studyFolder.folderId);
  study.unfileMissingStudyFolders(folders.chatFolderIds('study'));
  assert.equal(study.listStudyConversationFolders()[studyChat.id], null, 'orphaned study folder id is cleared');

  assert.equal(db.pragma('foreign_key_check').length, 0, 'no foreign-key violations');

  // The migration is additive on a database that already holds conversations: drop the folder
  // objects, claim v178, re-migrate, and the pre-existing conversation must survive untouched.
  const survivor = chat.createConversation({ title: 'Pre-existing' });
  db.exec('DROP TABLE IF EXISTS chat_conversation_folders; DROP TABLE IF EXISTS database_conversation_folders; DROP TABLE IF EXISTS world_conversation_folders; DROP TABLE IF EXISTS chat_folders;');
  db.pragma('user_version = 178');
  runMigrations(db);
  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  for (const table of FOLDER_TABLES) assert.ok(tableExists(table), `${table} recreated by the additive migration`);
  assert.ok(chat.getConversation(survivor.id), 'pre-existing conversation is intact after re-migration');
  assert.equal(db.pragma('foreign_key_check').length, 0);

  closeDb();
  console.log('Chat folders tests passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript'); const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename; const originalLoad = Module._load;
  const electronStub = { app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false, encryptString: (value) => Buffer.from(String(value)), decryptString: (value) => Buffer.from(value).toString() }, dialog: {}, shell: {}, BrowserWindow: class {} };
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function (module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true } }).outputText;
    module._compile(output, filename);
  };
}
