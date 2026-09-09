import { genomicsFixture, genomicsPlan, genomicsQuestion } from './lib/genomicsFixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-genomics-surfaces')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-genomics-surfaces-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = p => require(path.join(repoRoot, p));
let checks = 0;
try {
  // Real stores and orchestrators; only model calls and the separately tested SVG QA window are simulated.
  const assets = load('electron/chatAssets.ts');
  const registry = load('electron/chatSkills.ts');
  const shared = load('shared/chatSkills.ts');
  const settings = load('electron/db/settingsRepo.ts');
  const vaults = load('electron/vaults/vaultRegistry.ts');
  const ai = load('electron/ai/aiClient.ts');
  const images = load('electron/ai/decorativeImages.ts');
  load('electron/ai/chatSvgQuality.ts').refineChatSvg = async answer => answer;
  settings.updateSettings({ chatModel: { provider: 'google', model: 'test-text-model' }, imageProvider: 'google', imageModel: 'selected-image-model', promptLanguage: 'en' });
  const defaults = registry.restoreChatSkills();
  for (const skill of defaults) registry.saveChatSkill({ ...skill, enabled: { assistant: skill.builtin === 'genomics', nodi: skill.builtin === 'genomics' } });
  const genomics = load('shared/genomics.ts');
  const provider = load('electron/genomics.ts');
  let calls = 0;
  provider.predictGenomics = async (plan) => { assert.deepEqual(plan, genomicsPlan); calls++; return genomicsFixture(genomics); };
  const answer = shared.serializeChatVisualPart({ kind: 'genomics-plan', content: JSON.stringify(genomicsPlan), complete: true });
  const complete = async opts => { assert.match(opts.system, /AlphaGenome/); assert.match(opts.user, /GENOMICS TOOL IS AVAILABLE/); return answer; };
  ai.completeText = complete;
  ai.completeTextStream = async (opts, delta) => { const text = await complete(opts); delta(text, 'content'); return text; };
  ai.localModelContextWindow = async () => null;
  const dbs = load('electron/db/databasesRepo.ts');
  const dbChats = load('electron/db/databaseChatRepo.ts');
  const dbChat = load('electron/ai/databaseChat.ts');
  const study = load('electron/ai/studyAssistant.ts');
  const characters = load('electron/db/charactersRepo.ts');
  const characterChats = load('electron/db/characterChatRepo.ts');
  const characterChat = load('electron/ai/characterChat.ts');
  const database = dbs.createDatabase('Skills test data');
  const dbConversation = dbChats.createDatabaseChatConversation({ title: 'Visual analysis', databaseIds: [database.id] });
  const studyConversation = study.createStudyAssistantConversation();
  const character = characters.createCharacter({ displayName: 'The astronomer' });
  const characterConversation = characterChats.createCharacterChatConversation({ personId: character.personId, title: 'The observatory' });
  const backupRoot = path.join(scratch, 'backups');
  load('electron/db/appPrefs.ts').writeGlobalPrefsRaw({ autoBackupFolder: backupRoot });
  const { LibraryDiskStore } = load('electron/library/libraryStorage.ts');
  const disk = new LibraryDiskStore(path.join(backupRoot, 'nodus-library'), 'skills-test-device'); disk.initialize();
  const folder = disk.itemFolder('SKILLDOC'); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'reader.md'), '# Observatory\n\nThe observatory has three domes and a central courtyard.');
  disk.upsertItem({ id: 'zotero:SKILLDOC', storageId: 'SKILLDOC', source: 'zotero', sourceLibraryId: 'users/0', sourceKey: 'SKILLDOC', metadata: { title: 'Observatory design', itemType: 'document', creators: [], isbn: [], issn: [], tags: [] }, collectionIds: [], attachments: [], files: { reader: 'reader.md', chat: 'chat.json' }, extraction: { status: 'ready' } });
  const reader = load('electron/libraryReader/libraryReaderStore.ts');
  const readerChat = load('electron/ai/libraryReaderChat.ts');
  const question = genomicsQuestion;
  const turn = { id: 'u1', role: 'user', content: question, createdAt: new Date().toISOString() };
  const owner = (surface, id) => assets.chatAssetOwner(surface, id, vaults.getActiveVault().id);
  const studyRequest = { conversationId: studyConversation.id, messages: [turn], selection: { scope: 'manual', sourceKeys: [] }, task: 'answer', level: 'standard', tone: 'clear', language: 'auto', allowExternalKnowledge: true };
  const researchRepo = load('electron/db/chatRepo.ts'), research = load('electron/ai/researchAssistant.ts');
  const researchConversation = researchRepo.createConversation({ title: 'Genomics QA' });
  const nodiRepo = load('electron/nodiConversations.ts'), nodi = load('electron/ai/nodiChat.ts');
  const nodiConversation = nodiRepo.saveNodiConversation({ title: 'Genomics QA', messages: [], contexts: [] });
  const worldRepo = load('electron/db/worldChatRepo.ts'), world = load('electron/ai/worldChat.ts');
  const article = load('electron/db/worldEncyclopediaRepo.ts').createWorldArticle({ title: 'Research observatory', body: 'A fictional observatory where researchers study genetics.', category: 'other' });
  const worldConversation = worldRepo.createWorldChatConversation({ title: 'Genomics QA', selection: { scope: 'auto', entryKeys: [], keepFocus: false }, model: null });
  const cases = [
    { name: 'research assistant', run: () => research.streamResearchChat({ conversationId: researchConversation.id, model: { provider: 'google', model: 'test-text-model' }, messages: [turn], selection: { ideas: false, themes: false, contradictions: false, gaps: false, readingPath: false, authors: false, documents: false, passages: false, graph: false, graphParts: {} } }, () => {}).then(r => r.answer), remove: () => researchRepo.deleteConversation(researchConversation.id) },
    { name: 'Nodi', run: () => nodi.streamNodiChat({ conversationId: nodiConversation.id, messages: [turn], contexts: [] }, () => {}), remove: () => nodiRepo.deleteNodiConversation(nodiConversation.id) },
    { name: 'world chat', run: () => world.streamWorldChat({ conversationId: worldConversation.id, question, focusKeys: ['article:' + article.articleId] }, () => {}).then(r => r.text), remove: () => worldRepo.deleteWorldChatConversation(worldConversation.id) },
    { name: 'database', run: () => dbChat.streamDatabaseChat({ conversationId: dbConversation.id, databaseIds: [database.id], question }, () => {}).then(r => r.text), owner: owner('database', dbConversation.id), save: text => dbChats.saveDatabaseChatConversation(dbConversation.id, [turn, { role: 'assistant', content: text }], [database.id]), read: () => dbChats.getDatabaseChatConversation(dbConversation.id).messages, prune: () => dbChats.saveDatabaseChatConversation(dbConversation.id, [turn], [database.id]), remove: () => dbChats.deleteDatabaseChatConversation(dbConversation.id) },
    { name: 'study/teaching', run: () => study.streamStudyAssistant(studyRequest, () => {}).then(r => r.answer), owner: owner('study', studyConversation.id), save: text => study.updateStudyAssistantConversation(studyConversation.id, { messages: [turn, { ...turn, id: 'a1', role: 'assistant', content: text }] }), read: () => study.getStudyAssistantConversation(studyConversation.id).messages, prune: () => study.updateStudyAssistantConversation(studyConversation.id, { messages: [turn] }), remove: () => study.deleteStudyAssistantConversation(studyConversation.id) },
    { name: 'library reader', run: () => readerChat.streamLibraryReaderChat({ documentId: 'SKILLDOC', messages: [turn] }, () => {}).then(r => r.answer), owner: reader.libraryReaderChatAssetOwner('SKILLDOC'), save: text => reader.saveLibraryReaderChatMessages('zotero:SKILLDOC', [turn, { ...turn, id: 'a1', role: 'assistant', content: text }]), read: () => reader.listLibraryReaderChatMessages('SKILLDOC'), prune: () => reader.saveLibraryReaderChatMessages('SKILLDOC', [turn]), remove: () => reader.clearLibraryReaderChat('zotero:SKILLDOC') },
    { name: 'character', run: () => characterChat.sendCharacterChatMessage(characterConversation.id, question).then(r => r.conversation.messages.at(-1).content), owner: owner('character', characterConversation.id), save: () => {}, read: () => characterChats.getCharacterChatConversation(characterConversation.id).messages, remove: () => characterChats.deleteCharacterChatConversation(characterConversation.id) },
  ];
  for (const c of cases) {
    const text = await c.run();
    const part = shared.splitChatVisuals(text).find(p => p.kind === 'genomics-result');
    assert.ok(part, c.name + ': ' + text);
    assert.deepEqual(assets.getGenomicsResult(part.content), genomicsFixture(genomics), c.name);
    assert.doesNotMatch(text, /reference|alternate|SYNTHETIC/);
    if (c.save) { c.save(text); assert.ok(c.read().some(m => m.content.includes(part.content)), c.name + ' persistence'); }
    c.remove(); assert.equal(assets.getGenomicsResult(part.content), null, c.name + ' cleanup');
    checks++; console.log(c.name + ': AlphaGenome executed, rendered handle returned and asset cleanup passed');
  }
  assert.equal(calls, cases.length);
  const g = registry.listChatSkills().find(s => s.builtin === 'genomics');
  registry.saveChatSkill({ ...g, enabled: { assistant: true, nodi: false } });
  ai.completeTextStream = async () => answer;
  const disabled = await nodi.streamNodiChat({ messages: [turn], contexts: [] }, () => {}, undefined, { skills: [], owner: undefined, question, version: 0, isCurrent: () => true });
  assert.match(disabled, /enable the skill/); assert.equal(calls, cases.length);
  load('electron/db/database.ts').closeDb();
  console.log('All ' + checks + ' real chat orchestrators passed with synthetic API responses; no live AlphaGenome request.');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
