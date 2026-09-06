import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-chat-skill-surfaces')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-skill-surfaces-'));
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
  const personal = registry.saveChatSkill({ name: 'Cross-chat method', description: 'For every test answer', instructions: 'Include a short source-aware explanation.', enabled: { assistant: true, nodi: false } }).find(s => s.name === 'Cross-chat method');
  for (const skill of defaults) registry.saveChatSkill({ ...skill, enabled: { assistant: skill.builtin === 'svg' || skill.builtin === 'image', nodi: false } });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text x="10" y="40">Signal [S99]  ; exact label</text></svg>';
  const brief = { title: 'Observatory', alt: 'An observatory above the clouds', prompt: 'Create a detailed architectural illustration of an observatory above the clouds.', aspectRatio: '16:9' };
  let answer = `Here is the visual.\n\n\`\`\`svg\n${svg}\n\`\`\`\n\n\`\`\`nodus-image\n${JSON.stringify(brief)}\n\`\`\``;
  let beforeReply = () => {};
  let beforeImage = () => {};
  let calls = 0;
  let imageCalls = 0;
  const completion = async opts => {
    calls++;
    assert.match(opts.system, /SVG Studio/);
    assert.match(opts.system, /Image Atelier/);
    assert.match(opts.system, /Cross-chat method/);
    assert.match(opts.user, /IMAGE TOOL IS AVAILABLE/);
    assert.equal(opts.englishImagePrompts, true);
    beforeReply();
    return answer;
  };
  ai.completeText = completion;
  ai.completeTextStream = async (opts, delta) => { const text = await completion(opts); delta(text, 'content'); return text; };
  ai.localModelContextWindow = async () => null;
  images.callImageProvider = async (provider, model, prompt, signal, ratio) => {
    imageCalls++;
    assert.equal(provider, 'google'); assert.equal(model, 'selected-image-model'); assert.equal(prompt, brief.prompt); assert.equal(ratio, '16:9');
    beforeImage();
    return { bytes: Buffer.from('test-image'), mimeType: 'image/png' };
  };
  images.prepareGeneratedImage = image => ({ image: image.bytes, mimeType: image.mimeType });
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
  const question = 'Create an SVG diagram and an illustration of the observatory.';
  const turn = { id: 'u1', role: 'user', content: question, createdAt: new Date().toISOString() };
  const owner = (surface, id) => assets.chatAssetOwner(surface, id, vaults.getActiveVault().id);
  const studyRequest = { conversationId: studyConversation.id, messages: [turn], selection: { scope: 'manual', sourceKeys: [] }, task: 'answer', level: 'standard', tone: 'clear', language: 'auto', allowExternalKnowledge: true };
  const cases = [
    { name: 'database', run: () => dbChat.streamDatabaseChat({ conversationId: dbConversation.id, databaseIds: [database.id], question }, () => {}).then(r => r.text), owner: owner('database', dbConversation.id), save: text => dbChats.saveDatabaseChatConversation(dbConversation.id, [turn, { role: 'assistant', content: text }], [database.id]), read: () => dbChats.getDatabaseChatConversation(dbConversation.id).messages, prune: () => dbChats.saveDatabaseChatConversation(dbConversation.id, [turn], [database.id]), remove: () => dbChats.deleteDatabaseChatConversation(dbConversation.id) },
    { name: 'study/teaching', run: () => study.streamStudyAssistant(studyRequest, () => {}).then(r => r.answer), owner: owner('study', studyConversation.id), save: text => study.updateStudyAssistantConversation(studyConversation.id, { messages: [turn, { ...turn, id: 'a1', role: 'assistant', content: text }] }), read: () => study.getStudyAssistantConversation(studyConversation.id).messages, prune: () => study.updateStudyAssistantConversation(studyConversation.id, { messages: [turn] }), remove: () => study.deleteStudyAssistantConversation(studyConversation.id) },
    { name: 'library reader', run: () => readerChat.streamLibraryReaderChat({ documentId: 'SKILLDOC', messages: [turn] }, () => {}).then(r => r.answer), owner: reader.libraryReaderChatAssetOwner('SKILLDOC'), save: text => reader.saveLibraryReaderChatMessages('zotero:SKILLDOC', [turn, { ...turn, id: 'a1', role: 'assistant', content: text }]), read: () => reader.listLibraryReaderChatMessages('SKILLDOC'), prune: () => reader.saveLibraryReaderChatMessages('SKILLDOC', [turn]), remove: () => reader.clearLibraryReaderChat('zotero:SKILLDOC') },
    { name: 'character', run: () => characterChat.sendCharacterChatMessage(characterConversation.id, question).then(r => r.conversation.messages.at(-1).content), owner: owner('character', characterConversation.id), save: () => {}, read: () => characterChats.getCharacterChatConversation(characterConversation.id).messages, remove: () => characterChats.deleteCharacterChatConversation(characterConversation.id) },
  ];
  for (const c of cases) {
    const text = await c.run();
    const source = text.match(/nodus-image:\/\/chat\/[a-f0-9]+\/[a-f0-9-]+/)?.[0];
    assert.ok(source?.includes(c.owner), c.name);
    assert.equal(shared.splitChatVisuals(text).find(p => p.kind === 'svg').content, svg, `${c.name} preserves SVG labels`);
    assert.equal(assets.getChatImageMetadata(source).model, 'selected-image-model');
    c.save(text); assert.ok(c.read().some(m => m.content.includes(source)));
    if (c.prune) {
      c.prune(); assert.equal(assets.getChatImageMetadata(source), null, `${c.name} removes pruned assets`);
      const again = await c.run(); c.save(again);
    }
    const version = assets.chatAssetVersion(c.owner);
    c.remove(); assert.equal(fs.existsSync(path.join(scratch, 'chat-assets', c.owner)), false);
    assert.ok(assets.chatAssetVersion(c.owner) > version);
    console.log(`${c.name}: assistant skills, SVG, exact image provider, persistence and cleanup passed`); checks++;
  }
  assert.equal(calls, 7); assert.equal(imageCalls, 7);
  assert.equal(reader.libraryReaderChatAssetOwner('SKILLDOC'), reader.libraryReaderChatAssetOwner('zotero:SKILLDOC'), 'aliases share ownership'); checks++;
  // Clearing the library while text is being generated invalidates the request before a paid image call.
  beforeReply = () => reader.clearLibraryReaderChat('SKILLDOC');
  const priorImageCalls = imageCalls;
  await assert.rejects(readerChat.streamLibraryReaderChat({ documentId: 'SKILLDOC', messages: [turn] }, () => {}), { name: 'AbortError' });
  assert.equal(imageCalls, priorImageCalls); checks++;
  beforeReply = () => {};
  beforeImage = () => reader.clearLibraryReaderChat('SKILLDOC');
  await assert.rejects(readerChat.streamLibraryReaderChat({ documentId: 'SKILLDOC', messages: [turn] }, () => {}), { name: 'AbortError' });
  assert.equal(fs.existsSync(path.join(scratch, 'chat-assets', reader.libraryReaderChatAssetOwner('SKILLDOC'))), false); checks++;
  beforeImage = () => {};
  // Disabled tool skills never call the image provider, even if the text model emits a tool block.
  registry.saveChatSkill({ ...defaults.find(s => s.builtin === 'image'), enabled: { assistant: false, nodi: true } });
  ai.completeTextStream = async () => `\`\`\`nodus-image\n${JSON.stringify(brief)}\n\`\`\``;
  const previousImageCalls = imageCalls;
  const disabled = await readerChat.streamLibraryReaderChat({ documentId: 'SKILLDOC', messages: [turn] }, () => {});
  assert.match(disabled.answer, /nodus-image-error/); assert.equal(imageCalls, previousImageCalls); checks++;
  const strict = await study.streamStudyAssistant({ ...studyRequest, conversationId: undefined, allowExternalKnowledge: false }, () => {});
  assert.equal(strict.insufficientInformation, true, 'skills preserve explicit source-only scope'); checks++;
  registry.deleteChatSkill(personal.id);
  load('electron/db/database.ts').closeDb();
  console.log(`All ${checks} cross-surface scenarios passed without network calls.`);
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
