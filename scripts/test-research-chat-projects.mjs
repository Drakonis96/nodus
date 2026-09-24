// Research chat projects and pinned chats: alphabetical projects, placements that survive
// a project's deletion, at most five pinned chats, and cleanup when a chat goes away.
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
  console.log('Chat projects order, validation, placement, pin limit, archive release, non-destructive project deletion and chat cleanup passed.');
} finally {
  load('electron/db/database.ts').closeDb();
  fs.rmSync(scratch, { recursive: true, force: true });
}
