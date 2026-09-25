// Research chat projects and pinned chats: alphabetical projects, placements that survive
// a project's deletion, at most five pinned chats, and cleanup when a chat goes away. Then
// the folders inside a project: nesting, the cycle guard, filing, the subtree filter, a
// deletion that unfiles instead of deleting, and a folder never outliving its project.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-chat-projects')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-chat-projects-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
try {
  const db = load('electron/db/database.ts').getDb();
  const projects = load('electron/db/researchChatProjectsRepo.ts');
  const chat = load('electron/db/chatRepo.ts');
  const tree = load('shared/researchChatFolders.ts');

  // Projects list alphabetically, whatever the creation order or case.
  const zeta = projects.createChatProject({ name: 'zeta' });
  const alpha = projects.createChatProject({ name: 'Alpha', icon: 'flask', color: '#3B82F6' });
  projects.createChatProject({ name: 'Ámbar' });
  assert.deepEqual(projects.listChatProjects().map(project => project.name), ['Alpha', 'Ámbar', 'zeta']);
  assert.equal(alpha.color, '#3b82f6');
  assert.equal(zeta.icon, 'folder', 'a new project starts with the folder icon');
  assert.throws(() => projects.createChatProject({ name: '  ' }), /invalid_name/);
  assert.throws(() => projects.updateChatProject(alpha.id, { color: 'red' }), /invalid_color/);
  assert.throws(() => projects.updateChatProject(alpha.id, { icon: '<svg>' }), /invalid_icon/);
  assert.equal(projects.updateChatProject(alpha.id, { name: 'Beta', icon: 'globe' }).icon, 'globe');

  // A conversation can start in a project, move out and back.
  const inProject = chat.createConversation({ title: 'In project', projectId: alpha.id });
  assert.equal(chat.getConversation(inProject.id).projectId, alpha.id);
  projects.setConversationProject(inProject.id, null);
  assert.equal(chat.getConversation(inProject.id).projectId, null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM research_chat_placements').get().n, 0, 'an empty placement leaves no row');
  projects.setConversationProject(inProject.id, alpha.id);
  assert.throws(() => projects.setConversationProject(inProject.id, 'missing'), /project_not_found/);

  // At most five pinned chats; the list carries project and pin in one query.
  const chats = Array.from({ length: 6 }, (_, index) => chat.createConversation({ title: `Chat ${index}` }));
  for (const item of chats.slice(0, 4)) projects.setConversationPinned(item.id, true);
  projects.setConversationPinned(inProject.id, true);
  assert.throws(() => projects.setConversationPinned(chats[5].id, true), /research_chat_pin_limit/);
  projects.setConversationPinned(inProject.id, true);
  const listed = chat.listConversations(false);
  assert.equal(listed.filter(item => item.pinnedAt).length, 5);
  assert.equal(listed.find(item => item.id === inProject.id).projectId, alpha.id, 'pinning keeps the project');

  // Archiving a pinned chat frees its place.
  chat.setArchived(chats[0].id, true);
  assert.equal(chat.getConversation(chats[0].id).pinnedAt, null);
  projects.setConversationPinned(chats[5].id, true);

  // Deleting a project keeps its chats, now outside any project, still pinned if they were.
  projects.deleteChatProject(alpha.id);
  assert.equal(projects.getChatProject(alpha.id), null);
  const released = chat.getConversation(inProject.id);
  assert.ok(released, 'the chat survives its project');
  assert.equal(released.projectId, null);
  assert.ok(released.pinnedAt);

  // Deleting a chat removes its placement.
  chat.deleteConversation(inProject.id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM research_chat_placements WHERE conversation_id=?').get(inProject.id).n, 0);
  assert.throws(() => projects.setConversationPinned(inProject.id, true), /conversation_not_found/);

  // Folders: created at a project's root or inside another folder, siblings in order.
  const thesis = projects.createChatProject({ name: 'Tesis' });
  const other = projects.createChatProject({ name: 'Otro' });
  const chapters = projects.createChatProjectFolder({ projectId: thesis.id, name: 'Capítulos' });
  const sources = projects.createChatProjectFolder({ projectId: thesis.id, name: 'Fuentes' });
  const one = projects.createChatProjectFolder({ projectId: thesis.id, parentId: chapters.id, name: 'Capítulo 1' });
  const archives = projects.createChatProjectFolder({ projectId: thesis.id, parentId: one.id, name: 'Archivos' });
  const foreign = projects.createChatProjectFolder({ projectId: other.id, name: 'Ajena' });
  assert.equal(one.parentId, chapters.id);
  assert.deepEqual([chapters.position, sources.position], [0, 1]);
  assert.throws(() => projects.createChatProjectFolder({ projectId: thesis.id, name: ' ' }), /folder_invalid_name/);
  assert.throws(() => projects.createChatProjectFolder({ projectId: 'missing', name: 'X' }), /project_not_found/);
  assert.throws(() => projects.createChatProjectFolder({ projectId: thesis.id, parentId: foreign.id, name: 'X' }), /folder_wrong_project/, 'a subfolder stays in its parent\'s project');
  assert.equal(projects.renameChatProjectFolder(sources.id, '  Fuentes primarias ').name, 'Fuentes primarias');
  const children = parentId => projects.listChatProjectFolders().filter(folder => folder.projectId === thesis.id && folder.parentId === parentId).map(folder => folder.name);

  // Re-nesting and reordering; a folder never moves into its own subtree.
  assert.throws(() => projects.moveChatProjectFolder(chapters.id, archives.id), /folder_cycle/);
  assert.throws(() => projects.moveChatProjectFolder(chapters.id, chapters.id), /folder_cycle/);
  assert.throws(() => projects.moveChatProjectFolder(sources.id, foreign.id), /folder_wrong_project/);
  assert.equal(projects.getChatProjectFolder(chapters.id).parentId, null, 'a refused move changes nothing');
  projects.moveChatProjectFolder(sources.id, null, 0);
  assert.deepEqual(children(null), ['Fuentes primarias', 'Capítulos'], 'reordered among its siblings');
  projects.moveChatProjectFolder(sources.id, chapters.id, 0);
  assert.deepEqual(children(null), ['Capítulos']);
  assert.deepEqual(children(chapters.id), ['Fuentes primarias', 'Capítulo 1'], 'nested at the chosen place');
  assert.deepEqual(projects.listChatProjectFolders().filter(folder => folder.parentId === chapters.id).map(folder => folder.position), [0, 1]);
  projects.moveChatProjectFolder(sources.id, null);
  assert.deepEqual(children(null), ['Capítulos', 'Fuentes primarias'], 'back at the root, at the end');
  assert.equal(projects.listChatProjectFolders().find(folder => folder.id === one.id).position, 0, 'the old siblings close the gap');

  // Filing: a chat in a folder is in the folder's project; changing project clears its folder.
  const filed = chat.createConversation({ title: 'Filed', projectId: thesis.id, folderId: archives.id });
  const deep = chat.createConversation({ title: 'Deep', projectId: thesis.id });
  const loose = chat.createConversation({ title: 'Loose' });
  chat.createConversation({ title: 'Unfiled', projectId: thesis.id });
  projects.setConversationFolder(deep.id, one.id);
  projects.setConversationFolder(loose.id, sources.id);
  assert.deepEqual([chat.getConversation(filed.id).folderId, chat.getConversation(loose.id).projectId], [archives.id, thesis.id], 'a folder brings its project');
  assert.equal(chat.listConversations(false).find(item => item.id === filed.id).folderId, archives.id, 'the list carries the folder');
  projects.setConversationPinned(loose.id, false);
  assert.equal(chat.getConversation(loose.id).folderId, sources.id, 'pinning keeps the folder');
  projects.setConversationProject(loose.id, thesis.id);
  assert.equal(chat.getConversation(loose.id).folderId, sources.id, 'the same project keeps the folder');
  projects.setConversationProject(loose.id, other.id);
  assert.deepEqual([chat.getConversation(loose.id).projectId, chat.getConversation(loose.id).folderId], [other.id, null], 'another project clears the folder');
  projects.setConversationFolder(loose.id, sources.id);
  projects.setConversationFolder(loose.id, null);
  assert.deepEqual([chat.getConversation(loose.id).projectId, chat.getConversation(loose.id).folderId], [thesis.id, null], 'unfiling keeps the project');
  projects.setConversationFolder(loose.id, sources.id);
  assert.throws(() => projects.setConversationFolder(loose.id, 'missing'), /folder_not_found/);

  // A folder's subtree: the filter a selected folder applies, the same helper the history uses.
  const inSelection = folderId => tree.conversationsInSelection(chat.listConversations(false), projects.listChatProjectFolders(), thesis.id, folderId).map(item => item.title).sort();
  assert.deepEqual(inSelection(chapters.id), ['Deep', 'Filed']);
  assert.deepEqual(inSelection(archives.id), ['Filed']);
  assert.deepEqual(inSelection(tree.UNFILED_FOLDER), ['Unfiled']);
  assert.deepEqual(inSelection(null), ['Deep', 'Filed', 'Loose', 'Unfiled']);
  const folderList = projects.listChatProjectFolders();
  const byId = id => folderList.find(folder => folder.id === id);
  assert.equal(tree.canNestFolder(folderList, byId(chapters.id), archives.id), false, 'the drop targets refuse the subtree too');
  assert.equal(tree.canNestFolder(folderList, byId(chapters.id), foreign.id), false);
  assert.equal(tree.canNestFolder(folderList, byId(sources.id), one.id), true);

  // Deleting a folder takes its subfolders and unfiles, never deletes, every chat below it.
  projects.deleteChatProjectFolder(chapters.id);
  assert.deepEqual(children(null), ['Fuentes primarias']);
  assert.equal(projects.getChatProjectFolder(archives.id), null, 'subfolders cascade');
  for (const id of [filed.id, deep.id]) {
    const survivor = chat.getConversation(id);
    assert.ok(survivor, 'the chat survives its folder');
    assert.deepEqual([survivor.projectId, survivor.folderId], [thesis.id, null], 'unfiled, still in the project');
  }
  assert.equal(chat.getConversation(loose.id).folderId, sources.id, 'other folders keep their chats');
  assert.equal(projects.listChatProjectFolders().find(folder => folder.id === sources.id).position, 0);

  // Deleting a project takes its folders; its chats return to the general history.
  projects.deleteChatProject(thesis.id);
  assert.equal(projects.getChatProjectFolder(sources.id), null);
  assert.deepEqual([chat.getConversation(loose.id).projectId, chat.getConversation(loose.id).folderId], [null, null]);
  assert.equal(projects.listChatProjectFolders().length, 1, 'only the other project\'s folder is left');
  console.log('Chat projects order, validation, placement, pin limit, archive release, non-destructive project deletion, chat cleanup and folders (nesting, cycles, filing, subtree, deletion) passed.');
} finally {
  load('electron/db/database.ts').closeDb();
  fs.rmSync(scratch, { recursive: true, force: true });
}
