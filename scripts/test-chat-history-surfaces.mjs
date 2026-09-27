// Every chat history that keeps its own store follows Research Chat's project and folder
// rules: the Databases and Worldbuilding tables, and the Study JSON file (which Teaching
// uses too, in its own vault). The shared contract runs against each store, then the
// boundaries: no history reads or writes another surface's store in the same vault, no
// vault reaches another vault's history, the channels refuse a surface they do not know,
// and the study file repairs a reference that does not resolve the first time it is read.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
import { checkChatHistoryContract } from './lib/chatHistoryContract.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--chat-history-surfaces')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-chat-history-surfaces-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
try {
  const vaults = load('electron/vaults/vaultRegistry.ts');
  const database = load('electron/db/database.ts');
  const databaseChats = load('electron/db/databaseChatRepo.ts');
  const worldChats = load('electron/db/worldChatRepo.ts');
  const researchChats = load('electron/db/chatRepo.ts');
  const researchProjects = load('electron/db/researchChatProjectsRepo.ts');
  const studyChats = load('electron/ai/studyAssistant.ts');
  const studyHistory = load('electron/ai/studyChatHistory.ts');
  const { registerChatHistoryIpc } = load('electron/ipc/chatHistory.ts');
  const open = vault => { vaults.setActiveVault(vault.id); database.closeDb(); database.getDb(); };

  /** A placement no call would write: what an older build or a merge could leave behind. */
  const corruptTable = table => (id, projectId, folderId) => {
    const db = database.getDb();
    db.pragma('foreign_keys = OFF');
    db.prepare(`INSERT INTO ${table} (conversation_id, project_id, folder_id, pinned_at, updated_at) VALUES (?, ?, ?, NULL, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET project_id = excluded.project_id, folder_id = excluded.folder_id`).run(id, projectId, folderId, new Date().toISOString());
    db.pragma('foreign_keys = ON');
  };
  const tableApi = (organizer, placements, conversations) => ({
    ...conversations,
    listProjects: () => organizer.listChatProjects(),
    createProject: input => organizer.createChatProject(input),
    updateProject: (id, patch) => organizer.updateChatProject(id, patch),
    deleteProject: id => organizer.deleteChatProject(id),
    listFolders: () => organizer.listChatProjectFolders(),
    createFolder: input => organizer.createChatProjectFolder(input),
    renameFolder: (id, name) => organizer.renameChatProjectFolder(id, name),
    moveFolder: (id, parentId, index) => organizer.moveChatProjectFolder(id, parentId, index),
    deleteFolder: id => organizer.deleteChatProjectFolder(id),
    setProject: (id, projectId) => organizer.setConversationProject(id, projectId),
    setFolder: (id, folderId) => organizer.setConversationFolder(id, folderId),
    setPinned: (id, pinned) => organizer.setConversationPinned(id, pinned),
    corruptFolder: corruptTable(placements),
    // The initial load: the repair pass runs when the vault's database opens.
    reload: () => { database.closeDb(); database.getDb(); },
  });

  // ══ Databases ═══════════════════════════════════════════════════════════════
  const dataVault = vaults.createVault('Datos', 'databases');
  open(dataVault);
  checkChatHistoryContract(tableApi(databaseChats.databaseChatOrganizer, 'database_chat_placements', {
    createConversation: (title, placement = {}) => databaseChats.createDatabaseChatConversation({ title, databaseIds: [], ...placement }).id,
    deleteConversation: id => databaseChats.deleteDatabaseChatConversation(id),
    conversation: id => databaseChats.getDatabaseChatConversation(id),
    listConversations: includeArchived => databaseChats.listDatabaseChatConversations(includeArchived),
    setArchived: (id, archived) => databaseChats.setDatabaseChatConversationArchived(id, archived),
    rename: (id, title) => databaseChats.renameDatabaseChatConversation(id, title),
  }), 'databases');

  // ══ Worldbuilding ═══════════════════════════════════════════════════════════
  const worldVault = vaults.createVault('Mundo', 'worldbuilding');
  open(worldVault);
  const blank = { scope: 'auto', entryKeys: [], keepFocus: false };
  checkChatHistoryContract(tableApi(worldChats.worldChatOrganizer, 'world_chat_placements', {
    createConversation: (title, placement = {}) => worldChats.createWorldChatConversation({ title, selection: blank, model: null, ...placement }).id,
    deleteConversation: id => worldChats.deleteWorldChatConversation(id),
    conversation: id => worldChats.getWorldChatConversation(id),
    listConversations: includeArchived => worldChats.listWorldChatConversations(includeArchived),
    setArchived: (id, archived) => worldChats.setWorldChatConversationArchived(id, archived),
    rename: (id, title) => worldChats.renameWorldChatConversation(id, title),
  }), 'worldbuilding');

  // ══ Study and Teaching: the JSON file ═══════════════════════════════════════
  const studyApi = {
    createConversation: (title, placement = {}) => studyChats.createStudyAssistantConversation({ title, ...placement }).id,
    deleteConversation: id => studyChats.deleteStudyAssistantConversation(id),
    conversation: id => studyChats.getStudyAssistantConversation(id),
    listConversations: includeArchived => studyChats.listStudyAssistantConversations(includeArchived),
    setArchived: (id, archived) => studyChats.updateStudyAssistantConversation(id, { archived }),
    rename: (id, title) => studyChats.updateStudyAssistantConversation(id, { title }),
    listProjects: () => studyHistory.listStudyChatProjects(),
    createProject: input => studyHistory.createStudyChatProject(input),
    updateProject: (id, patch) => studyHistory.updateStudyChatProject(id, patch),
    deleteProject: id => studyHistory.deleteStudyChatProject(id),
    listFolders: () => studyHistory.listStudyChatFolders(),
    createFolder: input => studyHistory.createStudyChatFolder(input),
    renameFolder: (id, name) => studyHistory.renameStudyChatFolder(id, name),
    moveFolder: (id, parentId, index) => studyHistory.moveStudyChatFolder(id, parentId, index),
    deleteFolder: id => studyHistory.deleteStudyChatFolder(id),
    setProject: (id, projectId) => studyHistory.setStudyChatConversationProject(id, projectId),
    setFolder: (id, folderId) => studyHistory.setStudyChatConversationFolder(id, folderId),
    setPinned: (id, pinned) => studyHistory.setStudyChatConversationPinned(id, pinned),
    corruptFolder: (id, projectId, folderId) => {
      const file = studyHistory.studyChatStorePath();
      const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
      Object.assign(stored.conversations.find(conversation => conversation.id === id), { projectId, folderId });
      fs.writeFileSync(file, JSON.stringify(stored));
    },
    // The initial load of a JSON history is its first read.
    reload: () => studyHistory.readStudyChatStore(),
  };
  const studyVault = vaults.createVault('Estudio', 'estudio');
  open(studyVault);
  checkChatHistoryContract(studyApi, 'study');
  const teachingVault = vaults.createVault('Docencia', 'docencia');
  open(teachingVault);
  checkChatHistoryContract(studyApi, 'teaching');

  // The folder id travels inside the conversation's own record.
  open(studyVault);
  const tp = studyHistory.createStudyChatProject({ name: 'Tema' });
  const tf = studyHistory.createStudyChatFolder({ projectId: tp.id, name: 'Lecturas' });
  const travelling = studyChats.createStudyAssistantConversation({ title: 'Viaja', projectId: tp.id, folderId: tf.id });
  const record = JSON.parse(fs.readFileSync(studyHistory.studyChatStorePath(), 'utf8')).conversations.find(item => item.id === travelling.id);
  assert.deepEqual([record.projectId, record.folderId], [tp.id, tf.id], 'the record in the file carries its project and folder');
  studyChats.updateStudyAssistantConversation(travelling.id, { projectId: null, folderId: 'x', pinnedAt: 'now' });
  const unmoved = studyChats.getStudyAssistantConversation(travelling.id);
  assert.deepEqual([unmoved.projectId, unmoved.folderId, unmoved.pinnedAt], [tp.id, tf.id, null], 'a generic update cannot move or pin a chat');

  // The repair on first read, written back to disk: a folder whose parent sits in another
  // project goes to its project's root, a folder of a missing project goes, a cycle breaks.
  {
    const file = studyHistory.studyChatStorePath();
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    const other = studyHistory.createStudyChatProject({ name: 'Otro' });
    const reread = JSON.parse(fs.readFileSync(file, 'utf8'));
    reread.folders.push(
      { id: 'orphan', projectId: 'gone', parentId: null, name: 'Huérfana', position: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 'cross', projectId: tp.id, parentId: 'foreign-parent', name: 'Cruzada', position: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 'foreign-parent', projectId: other.id, parentId: null, name: 'Ajena', position: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 'loop-a', projectId: tp.id, parentId: 'loop-b', name: 'A', position: 2, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 'loop-b', projectId: tp.id, parentId: 'loop-a', name: 'B', position: 3, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    );
    reread.conversations.find(item => item.id === travelling.id).folderId = 'orphan';
    fs.writeFileSync(file, JSON.stringify(reread));
    const folders = studyHistory.listStudyChatFolders();
    assert.ok(!folders.some(folder => folder.id === 'orphan'), 'a folder of a missing project is dropped');
    assert.equal(folders.find(folder => folder.id === 'cross').parentId, null, 'a folder under another project\'s folder returns to its root');
    assert.deepEqual(['loop-a', 'loop-b'].map(id => folders.find(folder => folder.id === id).parentId), [null, null], 'a cycle is broken, not lost');
    assert.deepEqual([studyChats.getStudyAssistantConversation(travelling.id).projectId, studyChats.getStudyAssistantConversation(travelling.id).folderId], [tp.id, null],
      'the chat of a folder that is gone stays in its project, unfiled');
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(onDisk.conversations.find(item => item.id === travelling.id).folderId, null, 'the repair is written back');
    assert.ok(stored.conversations.length > 0);
  }

  // ══ No history reaches another surface's store in the same vault ══════════
  open(dataVault);
  const researchProject = researchProjects.createChatProject({ name: 'Proyecto de investigación' });
  const researchFolder = researchProjects.createChatProjectFolder({ projectId: researchProject.id, name: 'Carpeta de investigación' });
  const researchChat = researchChats.createConversation({ title: 'Chat de investigación' });
  const dataChat = databaseChats.createDatabaseChatConversation({ title: 'Chat de datos', databaseIds: [] });
  const dataProject = databaseChats.databaseChatOrganizer.createChatProject({ name: 'Proyecto de datos' });
  assert.ok(!databaseChats.databaseChatOrganizer.listChatProjects().some(project => project.id === researchProject.id), 'the database history does not list research projects');
  assert.ok(!researchProjects.listChatProjects().some(project => project.id === dataProject.id), 'nor the research history database projects');
  assert.ok(!worldChats.worldChatOrganizer.listChatProjects().some(project => [researchProject.id, dataProject.id].includes(project.id)), 'nor the world history either');
  assert.throws(() => databaseChats.databaseChatOrganizer.setConversationFolder(dataChat.id, researchFolder.id), /research_chat_folder_not_found/, 'a research folder is not a database folder');
  assert.throws(() => databaseChats.databaseChatOrganizer.setConversationProject(researchChat.id, dataProject.id), /research_chat_conversation_not_found/, 'a research chat is not a database chat');
  assert.throws(() => researchProjects.setConversationProject(dataChat.id, researchProject.id), /research_chat_conversation_not_found/, 'and the other way round');
  assert.throws(() => worldChats.worldChatOrganizer.setConversationPinned(dataChat.id, true), /research_chat_conversation_not_found/);

  // ══ No vault reaches another vault's history ═══════════════════════════════
  const otherData = vaults.createVault('Otros datos', 'databases');
  open(otherData);
  assert.deepEqual(databaseChats.databaseChatOrganizer.listChatProjects(), [], 'a new vault starts with no projects');
  assert.deepEqual(databaseChats.listDatabaseChatConversations(true), [], 'and no chats');
  assert.throws(() => databaseChats.databaseChatOrganizer.setConversationProject(dataChat.id, null), /research_chat_conversation_not_found/, 'another vault\'s chat cannot be placed');
  assert.throws(() => databaseChats.databaseChatOrganizer.createChatProjectFolder({ projectId: dataProject.id, name: 'X' }), /research_chat_project_not_found/, 'nor another vault\'s project used');
  const otherStudy = vaults.createVault('Otro estudio', 'estudio');
  open(otherStudy);
  assert.deepEqual(studyHistory.listStudyChatProjects(), [], 'a study vault has its own file');
  assert.throws(() => studyHistory.setStudyChatConversationFolder(travelling.id, null), /research_chat_conversation_not_found/, 'another study vault\'s chat is out of reach');
  open(teachingVault);
  assert.ok(!studyHistory.listStudyChatProjects().some(project => project.id === tp.id), 'the teaching vault does not see the study vault\'s projects');
  open(studyVault);
  assert.ok(studyHistory.listStudyChatProjects().some(project => project.id === tp.id), 'and the study vault still has them');

  // ══ The channels name their surface and refuse any other ════════════════════
  const handlers = new Map();
  registerChatHistoryIpc({ h: (channel, listener) => handlers.set(channel, listener) });
  for (const surface of ['research', 'bogus', undefined, 'constructor', '__proto__']) {
    await assert.rejects(() => handlers.get('chatHistory:projects:list')({}, surface), /chat_history_unknown_surface/, `the ${String(surface)} surface is refused`);
  }
  await assert.rejects(() => handlers.get('chatHistory:notebooks:list')({}, 'study'), /chat_history_unknown_surface/, 'study keeps no notebooks of its own');
  assert.ok((await handlers.get('chatHistory:projects:list')({}, 'study')).some(project => project.id === tp.id), 'the study channel reaches the active study vault');
  open(dataVault);
  assert.ok((await handlers.get('chatHistory:projects:list')({}, 'database')).some(project => project.id === dataProject.id), 'the database channel reaches the active vault\'s tables');

  // ══ Notebooks of a surface: chats return to the general history when one goes ══
  const notebook = databaseChats.databaseChatOrganizer.createChatNotebook({ name: 'Ventas', selection: { databaseIds: ['db-1'] } });
  assert.deepEqual(notebook.selection, { databaseIds: ['db-1'] });
  const inNotebook = databaseChats.createDatabaseChatConversation({ title: 'En el cuaderno', databaseIds: ['db-1'], notebookId: notebook.id });
  assert.equal(databaseChats.getDatabaseChatConversation(inNotebook.id).notebookId, notebook.id);
  databaseChats.databaseChatOrganizer.setConversationProject(inNotebook.id, dataProject.id);
  assert.deepEqual(databaseChats.databaseChatOrganizer.updateChatNotebook(notebook.id, { name: 'Ventas 2026', icon: 'chartBar', selection: { databaseIds: ['db-2'] } }).selection, { databaseIds: ['db-2'] });
  assert.throws(() => databaseChats.databaseChatOrganizer.createChatNotebook({ name: 'Mal', selection: [] }), /invalid_selection/);
  databaseChats.databaseChatOrganizer.deleteChatNotebook(notebook.id);
  assert.ok(databaseChats.getDatabaseChatConversation(inNotebook.id), 'a notebook takes none of its chats with it');
  assert.equal(databaseChats.getDatabaseChatConversation(inNotebook.id).notebookId, null);

  console.log('Databases, Worldbuilding, Study and Teaching histories follow the shared project, folder, pin and archive contract, repair on load, and stay inside their surface and vault.');
} finally {
  load('electron/db/database.ts').closeDb();
  fs.rmSync(scratch, { recursive: true, force: true });
}
