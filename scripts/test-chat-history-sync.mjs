// Chat history folders across two devices. The rule, documented in
// docs/research-chat-views.md: a folder deletion wins over a chat filed into that folder on
// another device that had not yet heard of the deletion. The chat is never lost nor hidden:
// after the merge it sits in the same project, with no folder, on both devices, whichever
// device syncs first and whichever edit was made last. Placements and folders carry
// updated_at, so an ordinary move or rename travels by newest-wins like any other row, and
// the repair pass after every merge clears a reference that no longer resolves.
//
// Runs under Electron-as-Node so better-sqlite3 matches the app ABI.
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

if (!process.argv.includes('--electron-chat-history-sync-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-chat-history-sync.mjs'), '--electron-chat-history-sync-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-chat-history-sync-'));
installRuntimeHooks(root);

try {
  const Database = require('better-sqlite3');
  const { runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const { ensureTombstoneTriggers } = require(path.join(repoRoot, 'electron/db/tombstones.ts'));
  const sync = require(path.join(repoRoot, 'electron/export/syncPackage.ts'));
  const { CHAT_HISTORY_TABLES, repairAllChatPlacements } = require(path.join(repoRoot, 'electron/db/chatHistoryTables.ts'));
  const { createChatOrganizer } = require(path.join(repoRoot, 'electron/db/chatOrganizerRepo.ts'));
  const folderTree = require(path.join(repoRoot, 'shared/researchChatFolders.ts'));

  const PASS = 'frase-de-sincronizacion-de-prueba';
  const use = (db) => { globalThis.__syncTestDb = db; };
  const pause = () => new Promise((resolve) => setTimeout(resolve, 8));
  let files = 0;
  /** A device's database, opened the way the app opens one. */
  const openDevice = (file = `device-${files++}.sqlite`) => {
    const db = new Database(path.join(root, file));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    ensureTombstoneTriggers(db);
    return db;
  };
  /** Build a package on `from` and merge it into `to`. */
  const syncInto = (from, to) => {
    use(from);
    const pack = sync.buildSyncPackage('test', PASS);
    use(to);
    return sync.mergeSyncPackage(pack.buffer, PASS);
  };
  // Each table-backed history, with how its conversation rows are written.
  const surfaces = CHAT_HISTORY_TABLES.map((tables) => ({
    tables,
    projects: createChatOrganizer(tables),
    addConversation: (db, id, title) => {
      const now = new Date().toISOString();
      if (tables.surface === 'research') db.prepare('INSERT INTO chat_conversations (id, title, created_at, updated_at, archived) VALUES (?, ?, ?, ?, 0)').run(id, title, now, now);
      else if (tables.surface === 'database') db.prepare("INSERT INTO database_chat_conversations (id, title, database_ids_json, messages_json, created_at, updated_at) VALUES (?, ?, '[]', '[]', ?, ?)").run(id, title, now, now);
      else db.prepare("INSERT INTO world_chat_conversations (id, title, selection_json, focus_json, messages_json, created_at, updated_at) VALUES (?, ?, '{}', '[]', '[]', ?, ?)").run(id, title, now, now);
    },
  }));
  assert.deepEqual(surfaces.map((surface) => surface.tables.surface), ['research', 'database', 'world'], 'every table-backed history is covered');

  for (const { tables, projects, addConversation } of surfaces) {
    const placementOf = (db, id) => {
      const row = db.prepare(`SELECT project_id, folder_id FROM ${tables.placements} WHERE conversation_id = ?`).get(id);
      return { projectId: row?.project_id ?? null, folderId: row?.folder_id ?? null };
    };
    const folderIds = (db) => db.prepare(`SELECT folder_id FROM ${tables.folders} ORDER BY folder_id`).all().map((row) => row.folder_id);

    /**
     * What must hold on a device after any merge, in any order: every conversation is still
     * there, and no placement names a folder that is missing or belongs to another project.
     * Then the history's own filter is asked where each chat shows, the way the sidebar asks.
     */
    const assertNothingHidden = (db, label, conversationIds) => {
      use(db);
      const present = new Set(db.prepare(`SELECT id FROM ${tables.conversations}`).all().map((row) => row.id));
      for (const id of conversationIds) assert.ok(present.has(id), `${label}: ${id} still exists`);
      const dangling = db.prepare(`SELECT p.conversation_id FROM ${tables.placements} p
        WHERE p.folder_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${tables.folders} f WHERE f.folder_id = p.folder_id AND f.project_id = p.project_id)`).all();
      assert.deepEqual(dangling, [], `${label}: no placement names a missing or foreign folder`);
      assert.deepEqual(db.pragma('foreign_key_check'), [], `${label}: no broken reference`);
      const folders = projects.listChatProjectFolders();
      for (const project of projects.listChatProjects()) {
        const inProject = conversationIds.map((id) => ({ id, ...placementOf(db, id) })).filter((item) => item.projectId === project.id);
        const reachable = new Set([
          ...folderTree.conversationsInSelection(inProject, folders, project.id, folderTree.UNFILED_FOLDER).map((item) => item.id),
          ...folders.filter((folder) => folder.projectId === project.id).flatMap((folder) => folderTree.conversationsInSelection(inProject, folders, project.id, folder.id).map((item) => item.id)),
        ]);
        for (const item of inProject) assert.ok(reachable.has(item.id), `${label}: ${item.id} shows in a folder or under "No folder"`);
      }
    };

    // ══ 1 · Ordinary moves and renames travel by newest-wins ════════════════════
    {
      const a = openDevice(); const b = openDevice();
      use(a);
      const project = projects.createChatProject({ name: 'Tesis' });
      const folder = projects.createChatProjectFolder({ projectId: project.id, name: 'Fuentes' });
      addConversation(a, 'c-move', 'Un chat');
      projects.setConversationProject('c-move', project.id);
      syncInto(a, b);
      assert.deepEqual(placementOf(b, 'c-move'), { projectId: project.id, folderId: null }, `${tables.surface}: B learns the project`);
      await pause();
      use(b);
      projects.setConversationFolder('c-move', folder.id);
      projects.renameChatProjectFolder(folder.id, 'Fuentes primarias');
      syncInto(b, a);
      assert.deepEqual(placementOf(a, 'c-move'), { projectId: project.id, folderId: folder.id }, 'a chat filed on B is filed on A');
      assert.equal(a.prepare(`SELECT name FROM ${tables.folders} WHERE folder_id = ?`).get(folder.id).name, 'Fuentes primarias', `${tables.surface}: a rename on B reaches A`);
      await pause();
      use(a);
      projects.setConversationFolder('c-move', null);
      syncInto(a, b);
      assert.deepEqual(placementOf(b, 'c-move'), { projectId: project.id, folderId: null }, 'taking it out of its folder travels back');
      a.close(); b.close();
    }

    // ══ 2 · A deletes a folder; B, not knowing, files chats into it ═════════════
    // Four runs: B's filing before or after A's deletion on the wall clock, and each device
    // syncing first. Every run must end the same way on both devices.
    const scenarios = [
      { edits: 'delete-then-file', first: 'a' },
      { edits: 'delete-then-file', first: 'b' },
      { edits: 'file-then-delete', first: 'a' },
      { edits: 'file-then-delete', first: 'b' },
    ];
    for (const scenario of scenarios) {
      const label = `${tables.surface}: ${scenario.edits}, ${scenario.first.toUpperCase()} syncs first`;
      const a = openDevice(); const b = openDevice();
      use(a);
      const project = projects.createChatProject({ name: 'Tesis' });
      const doomed = projects.createChatProjectFolder({ projectId: project.id, name: 'Capítulos' });
      const inner = projects.createChatProjectFolder({ projectId: project.id, parentId: doomed.id, name: 'Capítulo 1' });
      const kept = projects.createChatProjectFolder({ projectId: project.id, name: 'Notas' });
      const ids = ['c-filed-before', 'c-filed-on-b', 'c-inner-on-b', 'c-kept'];
      for (const id of ids) addConversation(a, id, id);
      projects.setConversationFolder('c-filed-before', doomed.id);
      projects.setConversationProject('c-filed-on-b', project.id);
      projects.setConversationProject('c-inner-on-b', project.id);
      projects.setConversationFolder('c-kept', kept.id);
      syncInto(a, b);
      assert.deepEqual(folderIds(b), [doomed.id, inner.id, kept.id].sort(), `${label}: B has the tree`);

      const deleteOnA = () => { use(a); projects.deleteChatProjectFolder(doomed.id); };
      const fileOnB = () => {
        use(b);
        projects.setConversationFolder('c-filed-on-b', doomed.id);
        projects.setConversationFolder('c-inner-on-b', inner.id);
      };
      if (scenario.edits === 'delete-then-file') { deleteOnA(); await pause(); fileOnB(); } else { fileOnB(); await pause(); deleteOnA(); }
      assert.deepEqual(placementOf(a, 'c-filed-before'), { projectId: project.id, folderId: null }, `${label}: on A, the deletion unfiles without deleting`);

      const [first, second] = scenario.first === 'a' ? [a, b] : [b, a];
      syncInto(first, second);
      assertNothingHidden(second, `${label}, after the first merge`, ids);
      syncInto(second, first);
      assertNothingHidden(first, `${label}, after the second merge`, ids);
      // One more round in each direction: nothing may keep changing.
      syncInto(first, second);
      syncInto(second, first);

      for (const [name, db] of [['A', a], ['B', b]]) {
        assertNothingHidden(db, `${label}, ${name} settled`, ids);
        assert.deepEqual(folderIds(db), [kept.id], `${label}: the deleted folder and its subfolder stay deleted on ${name}`);
        for (const id of ['c-filed-before', 'c-filed-on-b', 'c-inner-on-b']) {
          assert.deepEqual(placementOf(db, id), { projectId: project.id, folderId: null }, `${label}: ${id} is in the project with no folder on ${name}`);
        }
        assert.deepEqual(placementOf(db, 'c-kept'), { projectId: project.id, folderId: kept.id }, `${label}: an unrelated folder keeps its chat on ${name}`);
      }
      a.close(); b.close();
    }

  }

  // ══ 3 · The repair after a merge, and on every table-backed history ═════════
  {
    const { projects, addConversation } = surfaces[0];
    const placementOf = (db, id) => {
      const row = db.prepare('SELECT project_id, folder_id FROM research_chat_placements WHERE conversation_id = ?').get(id);
      return { projectId: row?.project_id ?? null, folderId: row?.folder_id ?? null };
    };
    const a = openDevice();
    use(a);
    const one = projects.createChatProject({ name: 'Uno' });
    const two = projects.createChatProject({ name: 'Dos' });
    const foreign = projects.createChatProjectFolder({ projectId: two.id, name: 'Ajena' });
    for (const id of ['r-missing', 'r-foreign', 'r-project']) addConversation(a, id, id);
    a.pragma('foreign_keys = OFF');
    const write = a.prepare('INSERT INTO research_chat_placements (conversation_id, project_id, folder_id, pinned_at, updated_at) VALUES (?, ?, ?, NULL, ?)');
    write.run('r-missing', one.id, 'no-such-folder', '2026-01-01T00:00:00.000Z');
    write.run('r-foreign', one.id, foreign.id, '2026-01-01T00:00:00.000Z');
    write.run('r-project', 'no-such-project', null, '2026-01-01T00:00:00.000Z');
    a.pragma('foreign_keys = ON');
    const repaired = repairAllChatPlacements(a);
    assert.deepEqual(repaired, { folders: 2, projects: 1, removed: 1 }, 'two folders cleared, one project cleared (its now empty row removed)');
    assert.deepEqual(placementOf(a, 'r-missing'), { projectId: one.id, folderId: null });
    assert.deepEqual(placementOf(a, 'r-foreign'), { projectId: one.id, folderId: null });
    assert.deepEqual(placementOf(a, 'r-project'), { projectId: null, folderId: null });
    assert.ok(a.prepare("SELECT updated_at FROM research_chat_placements WHERE conversation_id = 'r-missing'").get().updated_at > '2026-01-01', 'a repair is stamped so it travels');
    assert.deepEqual(repairAllChatPlacements(a), { folders: 0, projects: 0, removed: 0 }, 'a second pass finds nothing');
    assert.ok(CHAT_HISTORY_TABLES.some((tables) => tables.placements === 'research_chat_placements'), 'research chat is repaired');
    a.close();
  }

  console.log('Chat history folders converge across devices: moves and renames travel, a deleted folder wins over a concurrent filing in every order, and no chat is hidden.');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;

  const databaseStub = path.join(userDataPath, 'stub-database.js');
  fs.writeFileSync(
    databaseStub,
    'const { SCHEMA_VERSION } = require(' + JSON.stringify(path.join(repoRoot, 'electron/db/migrations.ts')) + ');\n' +
      'exports.getDb = () => globalThis.__syncTestDb;\n' +
      'exports.closeDb = () => {};\n' +
      'exports.SCHEMA_VERSION = SCHEMA_VERSION;\n'
  );

  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (v) => Buffer.from(String(v), 'utf8'), decryptString: (v) => Buffer.from(v).toString('utf8') },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };

  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    const resolved = originalResolveFilename.call(this, request, parent, isMain, options);
    if (resolved === path.join(repoRoot, 'electron/db/database.ts')) return databaseStub;
    return resolved;
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}
