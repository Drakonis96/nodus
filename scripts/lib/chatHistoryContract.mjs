// The behaviour every chat history with projects and folders shares, checked the same way
// against each store (Research Chat's tables, the Databases and Worldbuilding tables, the
// Study JSON file). A surface passes an adapter over its own repository; the checks below
// never reach past it.
//
//   createConversation(title, placement?) → id     deleteConversation(id)
//   conversation(id) → { projectId, folderId, pinnedAt, archived } | null
//   listConversations(includeArchived) → summaries  setArchived(id, archived)
//   listProjects() createProject(input) updateProject(id, patch) deleteProject(id)
//   listFolders() createFolder(input) renameFolder(id, name) moveFolder(id, parentId, index?) deleteFolder(id)
//   setProject(id, projectId) setFolder(id, folderId) setPinned(id, pinned)
//   corruptFolder(conversationId, projectId, folderId): writes a placement no API call would write
//   reload(): whatever the surface does on its initial load (reopen the database, read the file)
import assert from 'node:assert/strict';

/** The pin limit and its refusal are one contract across every chat history. */
export const PIN_LIMIT = 5;
export const PIN_LIMIT_ERROR = /^research_chat_pin_limit$/;

export function checkChatHistoryContract(api, label) {
  const at = message => `${label}: ${message}`;
  const placement = id => { const found = api.conversation(id); return found && { projectId: found.projectId, folderId: found.folderId }; };

  // ── Projects ───────────────────────────────────────────────────────────────
  const zeta = api.createProject({ name: 'zeta' });
  const alpha = api.createProject({ name: 'Alpha', icon: 'flask', color: '#3B82F6' });
  api.createProject({ name: 'Ámbar' });
  assert.deepEqual(api.listProjects().map(project => project.name), ['Alpha', 'Ámbar', 'zeta'], at('projects list alphabetically'));
  assert.equal(alpha.color, '#3b82f6', at('a colour is normalised'));
  assert.equal(zeta.icon, 'folder', at('a new project starts with the folder icon'));
  assert.throws(() => api.createProject({ name: '  ' }), /research_chat_project_invalid_name/, at('an empty name is refused'));
  assert.throws(() => api.updateProject(alpha.id, { color: 'red' }), /invalid_color/, at('a colour is validated'));
  assert.throws(() => api.updateProject(alpha.id, { icon: '<svg>' }), /invalid_icon/, at('an icon is validated'));
  const renamed = api.updateProject(alpha.id, { name: 'Beta', icon: 'globe', color: null });
  assert.deepEqual([renamed.name, renamed.icon, renamed.color], ['Beta', 'globe', null], at('name, icon and colour edit'));

  // ── Moving between projects ───────────────────────────────────────────────
  const inProject = api.createConversation('In project', { projectId: alpha.id });
  assert.equal(placement(inProject).projectId, alpha.id, at('a chat can start in a project'));
  api.setProject(inProject, null);
  assert.deepEqual(placement(inProject), { projectId: null, folderId: null }, at('and leave it'));
  api.setProject(inProject, alpha.id);
  assert.throws(() => api.setProject(inProject, 'missing'), /research_chat_project_not_found/, at('an unknown project is refused'));

  // ── Pins: the same limit and the same refusal ─────────────────────────────
  const chats = Array.from({ length: PIN_LIMIT + 1 }, (_, index) => api.createConversation(`Chat ${index}`));
  for (const id of chats.slice(0, PIN_LIMIT - 1)) api.setPinned(id, true);
  api.setPinned(inProject, true);
  assert.throws(() => api.setPinned(chats[PIN_LIMIT], true), error => PIN_LIMIT_ERROR.test(error.message), at(`a pin beyond ${PIN_LIMIT} is refused`));
  api.setPinned(inProject, true);
  assert.equal(api.listConversations(false).filter(item => item.pinnedAt).length, PIN_LIMIT, at('re-pinning a pinned chat is not a new pin'));
  assert.equal(api.conversation(inProject).projectId, alpha.id, at('pinning keeps the project'));

  // ── Archive: out of the normal history, and out of the pins ───────────────
  api.setArchived(chats[0], true);
  assert.ok(!api.listConversations(false).some(item => item.id === chats[0]), at('an archived chat leaves the normal history'));
  assert.equal(api.listConversations(true).find(item => item.id === chats[0])?.archived, true, at('and shows among the archived'));
  assert.equal(api.conversation(chats[0]).pinnedAt, null, at('archiving frees its pin'));
  api.setPinned(chats[PIN_LIMIT], true);
  api.setArchived(chats[0], false);
  assert.equal(api.conversation(chats[0]).archived, false, at('unarchiving brings it back'));

  // ── Deleting a project never deletes its chats ────────────────────────────
  api.deleteProject(alpha.id);
  assert.ok(!api.listProjects().some(project => project.id === alpha.id));
  const released = api.conversation(inProject);
  assert.ok(released, at('the chat survives its project'));
  assert.deepEqual([released.projectId, released.folderId], [null, null], at('back in the general history'));
  assert.ok(released.pinnedAt, at('still pinned'));

  // ── Folders ───────────────────────────────────────────────────────────────
  const thesis = api.createProject({ name: 'Tesis' });
  const other = api.createProject({ name: 'Otro' });
  const chapters = api.createFolder({ projectId: thesis.id, name: 'Capítulos' });
  const sources = api.createFolder({ projectId: thesis.id, name: 'Fuentes' });
  const one = api.createFolder({ projectId: thesis.id, parentId: chapters.id, name: 'Capítulo 1' });
  const archives = api.createFolder({ projectId: thesis.id, parentId: one.id, name: 'Archivos' });
  const foreign = api.createFolder({ projectId: other.id, name: 'Ajena' });
  assert.deepEqual([one.parentId, chapters.position, sources.position], [chapters.id, 0, 1], at('folders nest, siblings in order'));
  assert.throws(() => api.createFolder({ projectId: thesis.id, name: ' ' }), /research_chat_folder_invalid_name/);
  assert.throws(() => api.createFolder({ projectId: 'missing', name: 'X' }), /research_chat_project_not_found/);
  assert.throws(() => api.createFolder({ projectId: thesis.id, parentId: foreign.id, name: 'X' }), /research_chat_folder_wrong_project/, at('a subfolder stays in its parent\'s project'));
  assert.equal(api.renameFolder(sources.id, '  Fuentes primarias ').name, 'Fuentes primarias');
  assert.throws(() => api.moveFolder(chapters.id, archives.id), /research_chat_folder_cycle/, at('never into its own subtree'));
  assert.throws(() => api.moveFolder(chapters.id, chapters.id), /research_chat_folder_cycle/);
  assert.throws(() => api.moveFolder(sources.id, foreign.id), /research_chat_folder_wrong_project/);
  api.moveFolder(sources.id, chapters.id, 0);
  const children = parentId => api.listFolders().filter(folder => folder.projectId === thesis.id && folder.parentId === parentId).sort((a, b) => a.position - b.position).map(folder => folder.name);
  assert.deepEqual(children(chapters.id), ['Fuentes primarias', 'Capítulo 1'], at('nested at the chosen place'));
  api.moveFolder(sources.id, null);
  assert.deepEqual(children(null), ['Capítulos', 'Fuentes primarias'], at('back at the root, at the end'));

  // ── Filing: a folder brings its project; another project clears the folder ─
  const filed = api.createConversation('Filed', { projectId: thesis.id, folderId: archives.id });
  const deep = api.createConversation('Deep', { projectId: thesis.id });
  const loose = api.createConversation('Loose');
  const unfiled = api.createConversation('Unfiled', { projectId: thesis.id });
  api.setFolder(deep, one.id);
  api.setFolder(loose, sources.id);
  assert.deepEqual(placement(filed), { projectId: thesis.id, folderId: archives.id }, at('a chat can start in a folder'));
  assert.deepEqual(placement(loose), { projectId: thesis.id, folderId: sources.id }, at('a folder brings its project'));
  assert.equal(api.listConversations(false).find(item => item.id === filed)?.folderId, archives.id, at('the list carries the folder'));
  api.setProject(loose, thesis.id);
  assert.equal(placement(loose).folderId, sources.id, at('the same project keeps the folder'));
  api.setProject(loose, other.id);
  assert.deepEqual(placement(loose), { projectId: other.id, folderId: null }, at('changing project clears the folder'));
  api.setFolder(loose, sources.id);
  api.setFolder(loose, null);
  assert.deepEqual(placement(loose), { projectId: thesis.id, folderId: null }, at('removing it from its folder keeps the project'));
  assert.throws(() => api.setFolder(loose, 'missing'), /research_chat_folder_not_found/);

  // ── Rule 3: creating a folder never moves an existing chat into it ─────────
  const before = new Map(api.listConversations(true).map(item => [item.id, [item.projectId ?? null, item.folderId ?? null]]));
  const fresh = api.createFolder({ projectId: thesis.id, name: 'Nueva' });
  api.createFolder({ projectId: thesis.id, parentId: chapters.id, name: 'Nueva dentro' });
  for (const item of api.listConversations(true)) assert.deepEqual([item.projectId ?? null, item.folderId ?? null], before.get(item.id), at(`creating a folder left ${item.title} where it was`));
  assert.ok(!api.listConversations(true).some(item => item.folderId === fresh.id), at('a new folder starts empty'));

  // ── Rule 1: deleting a folder unfiles its chats; it never deletes one ──────
  api.deleteFolder(chapters.id);
  assert.ok(!api.listFolders().some(folder => [chapters.id, one.id, archives.id].includes(folder.id)), at('its subfolders go with it'));
  for (const id of [filed, deep]) {
    assert.ok(api.conversation(id), at('the chat survives its folder'));
    assert.deepEqual(placement(id), { projectId: thesis.id, folderId: null }, at('unfiled, still in the project'));
  }
  assert.deepEqual(placement(unfiled), { projectId: thesis.id, folderId: null }, at('an unfiled chat is untouched'));

  // ── Rule 2: deleting a chat removes its folder membership ─────────────────
  api.setFolder(deep, sources.id);
  api.deleteConversation(deep);
  assert.equal(api.conversation(deep), null, at('the chat is gone'));
  assert.ok(!api.listConversations(true).some(item => item.id === deep), at('and so is its membership'));
  assert.throws(() => api.setPinned(deep, true), /research_chat_conversation_not_found/, at('a deleted chat cannot be placed again'));

  // ── The repair pass on load: no reference that does not resolve survives ───
  const ghost = api.createConversation('Ghost folder', { projectId: thesis.id });
  const stray = api.createConversation('Stray folder', { projectId: thesis.id });
  const lost = api.createConversation('Lost project');
  api.corruptFolder(ghost, thesis.id, 'folder-that-never-existed');
  api.corruptFolder(stray, thesis.id, foreign.id);
  api.corruptFolder(lost, 'project-that-never-existed', null);
  api.reload();
  assert.deepEqual(placement(ghost), { projectId: thesis.id, folderId: null }, at('a folder that does not exist is cleared on load'));
  assert.deepEqual(placement(stray), { projectId: thesis.id, folderId: null }, at('a folder of another project is cleared on load'));
  assert.deepEqual(placement(lost), { projectId: null, folderId: null }, at('a project that does not exist is cleared on load'));
  assert.equal(placement(loose).projectId, thesis.id, at('sound placements are left alone'));
  for (const id of [ghost, stray, lost]) assert.ok(api.listConversations(false).some(item => item.id === id), at('a repaired chat stays visible'));

  // ── Deleting a project takes its folders and keeps its chats ──────────────
  api.setFolder(loose, sources.id);
  api.deleteProject(thesis.id);
  assert.ok(!api.listFolders().some(folder => folder.projectId === thesis.id), at('a project takes its folders'));
  assert.deepEqual(placement(loose), { projectId: null, folderId: null }, at('and returns their chats to the general history'));
  assert.equal(api.listFolders().length, 1, at('only the other project\'s folder is left'));
}
