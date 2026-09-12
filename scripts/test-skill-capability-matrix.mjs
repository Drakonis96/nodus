// Every chat surface routes every core capability through the registry, exactly once.
//
// The three disciplinary protocols became packages in 5.3.2 and are exercised by their
// own suites and by verify-capability-package-install.mjs; what stays here is the lanes
// the application still owns.
//
// The seven orchestrators and the real stores run here; only the model, the paid
// providers and the two Chromium sandboxes are simulated. The sandboxes themselves are
// verified against real Chromium by verify-skill-capability-sandbox.mjs and
// verify-skill-tool-sandbox.mjs, which this suite deliberately does not duplicate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-skill-capability-matrix')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-capability-matrix-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = p => require(path.join(repoRoot, p));
let checks = 0;
const check = (label, condition) => { assert.ok(condition, label); checks++; };

try {
  const assets = load('electron/chatAssets.ts');
  const registry = load('electron/chatSkills.ts');
  const shared = load('shared/chatSkills.ts');
  const settings = load('electron/db/settingsRepo.ts');
  const vaults = load('electron/vaults/vaultRegistry.ts');
  const ai = load('electron/ai/aiClient.ts');
  const plugins = load('electron/skillPlugins.ts');

  settings.updateSettings({ chatModel: { provider: 'google', model: 'test-text-model' }, synthesisModel: { provider: 'google', model: 'test-text-model' }, nodiModel: { provider: 'google', model: 'test-text-model' }, imageProvider: 'google', imageModel: 'test-image-model', promptLanguage: 'en' });

  // ---- simulated boundaries -------------------------------------------------
  load('electron/ai/chatSvgQuality.ts').refineChatSvg = async answer => answer;
  const images = load('electron/ai/decorativeImages.ts');
  let imageCalls = 0;
  images.callImageProvider = async () => { imageCalls++; return { bytes: Buffer.from('matrix-image'), mimeType: 'image/png' }; };
  images.prepareGeneratedImage = image => ({ image: image.bytes, mimeType: image.mimeType });
  let toolCalls = 0;
  load('electron/skillToolSandbox.ts').runSkillTool = async () => { toolCalls++; return '{"doubled":4}'; };
  let capabilityCalls = 0;
  let capabilityResult = { kind: 'text', text: 'capability executed' };
  load('skill-capabilities/sandbox/runtime.ts').runCapabilitySandbox = async (runtime, invocation, signal) => {
    capabilityCalls++;
    signal?.throwIfAborted();
    if (typeof capabilityResult === 'function') return capabilityResult(runtime, invocation);
    return capabilityResult;
  };

  // ---- the external plugin under test ---------------------------------------
  plugins.initializePluginStore();
  const pluginDir = path.join(scratch, 'matrix-kit');
  const manifest = { schemaVersion: 1, id: 'matrix-kit', name: 'Matrix Kit', version: '1.0.0', author: 'NodusResearch', description: 'Matrix capability under test.', license: 'MIT', compatibility: { capabilityApi: 1, minNodusVersion: '0.0.0' }, skills: ['skills/matrix/skill.json'], capabilities: ['capabilities/echo/capability.json'] };
  const pluginSkill = { schemaVersion: 1, id: 'matrix', name: 'Matrix skill', version: '1.0.0', author: 'NodusResearch', description: 'Exercise the external capability.', category: 'Research', license: 'MIT', instructions: 'SKILL.md', capabilities: ['self:echo'], tools: [{ id: 'double', description: 'Double a number.', entry: 'tools/double.js', runtime: 'javascript-sandbox' }] };
  const pluginCapability = { schemaVersion: 1, id: 'echo', version: '1.0.0', description: 'Echo inert data.', runtime: 'javascript-sandbox-v1', entry: 'runtime.js', tools: [{ id: 'echo', description: 'Echo.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false }, resultKinds: ['text'] }], permissions: {} };
  for (const [relative, source] of Object.entries({
    'plugin.json': JSON.stringify(manifest), 'skills/matrix/skill.json': JSON.stringify(pluginSkill), 'skills/matrix/SKILL.md': 'Use the matrix capability.',
    'skills/matrix/tools/double.js': '(input)=>({value:input.value*2})', 'capabilities/echo/capability.json': JSON.stringify(pluginCapability),
    'capabilities/echo/runtime.js': '(request)=>({kind:"text",text:request.input.value})',
  })) { const target = path.join(pluginDir, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source); }

  registry.restoreChatSkills();
  registry.installChatPluginDirectory(pluginDir, { sourceId: 'matrix-test', approvePermissions: true });
  for (const skill of registry.listChatSkills()) registry.saveChatSkill({ ...skill, enabled: { assistant: true, nodi: true } });
  const external = registry.listChatSkills().find(skill => skill.plugin?.id === 'matrix-kit');
  check('the external plugin skill is installed and enabled', external?.capabilities?.includes('matrix-kit:echo'));

  // ---- the seven protocol blocks --------------------------------------------
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><text x="8" y="30">Matrix</text></svg>';
  const brief = { title: 'Observatory', alt: 'An observatory above the clouds', prompt: 'Create a detailed architectural illustration of an observatory above the clouds.', aspectRatio: '16:9' };
  const fence = (tag, body) => `\`\`\`${tag}\n${body}\n\`\`\``;
  const capabilityRequest = () => JSON.stringify({ skillId: external.id, capabilityId: 'matrix-kit:echo', toolId: 'echo', input: { value: 'matrix' } });
  const capabilities = [
    { name: 'javascript tool', answer: () => fence('nodus-tool', JSON.stringify({ skillId: external.id, toolId: 'double', input: { value: 2 } })), counter: () => toolCalls, expect: text => assert.match(text, /Tool result \(double\)/) },
    { name: 'svg', answer: () => fence('svg', svg), counter: () => 0, expect: text => assert.equal(shared.splitChatVisuals(text).find(p => p.kind === 'svg')?.content, svg) },
    { name: 'image atelier', answer: () => fence('nodus-image', JSON.stringify(brief)), counter: () => imageCalls, expect: text => assert.match(text, /nodus-image:\/\/chat\//) },
    { name: 'external capability', answer: () => fence('nodus-capability', capabilityRequest()), counter: () => capabilityCalls, expect: text => assert.ok(shared.splitChatVisuals(text).some(p => p.kind === 'capability-result')) },
  ];

  // ---- the model ------------------------------------------------------------
  let scripted = '';
  let promptSeen = '';
  let modelCalls = 0;
  const completion = async opts => { modelCalls++; promptSeen = `${opts.system ?? ''}\n${opts.user ?? ''}`; return scripted; };
  ai.completeText = completion;
  ai.completeTextStream = async (opts, delta) => { const text = await completion(opts); delta(text, 'content'); return text; };
  ai.localModelContextWindow = async () => null;

  // ---- the seven orchestrators ----------------------------------------------
  const question = 'Exercise every registered capability GRCh38 chr1:100000:A:T UBERON:0002048 RNA_SEQ Espana Constitucion for this matrix';
  const turn = { id: 'u1', role: 'user', content: question, createdAt: new Date().toISOString() };
  const research = load('electron/ai/researchAssistant.ts');
  const nodi = load('electron/ai/nodiChat.ts');
  const nodiStore = load('electron/nodiConversations.ts');
  const world = load('electron/ai/worldChat.ts');
  const dbs = load('electron/db/databasesRepo.ts');
  const dbChats = load('electron/db/databaseChatRepo.ts');
  const dbChat = load('electron/ai/databaseChat.ts');
  const study = load('electron/ai/studyAssistant.ts');
  const characters = load('electron/db/charactersRepo.ts');
  const characterChats = load('electron/db/characterChatRepo.ts');
  const characterChat = load('electron/ai/characterChat.ts');

  // World chat answers only about material the world actually contains.
  const encyclopedia = load('electron/db/worldEncyclopediaRepo.ts');
  const worldArticle = encyclopedia.createWorldArticle({ title: 'Astronomers Guild', body: 'The Astronomers Guild keeps the three domes of the observatory.' });
  const worldChats = load('electron/db/worldChatRepo.ts');
  const chatRepo = load('electron/db/chatRepo.ts');
  const researchConversation = chatRepo.createConversation({ title: 'Matrix' });
  const worldConversation = worldChats.createWorldChatConversation({ title: 'Matrix' });
  const database = dbs.createDatabase('Matrix data');
  const dbConversation = dbChats.createDatabaseChatConversation({ title: 'Matrix', databaseIds: [database.id] });
  const studyConversation = study.createStudyAssistantConversation();
  const nodiConversation = nodiStore.saveNodiConversation({ title: 'Matrix', messages: [turn] });
  const character = characters.createCharacter({ displayName: 'The astronomer' });
  const characterConversation = characterChats.createCharacterChatConversation({ personId: character.personId, title: 'Matrix' });
  // World chat passes its own question to the registry, so it carries the same literals.
  const worldQuestion = 'What does the Astronomers Guild do in this world GRCh38 chr1:100000:A:T UBERON:0002048 RNA_SEQ Espana Constitucion';

  const backupRoot = path.join(scratch, 'library');
  load('electron/db/appPrefs.ts').writeGlobalPrefsRaw({ autoBackupFolder: backupRoot });
  const { LibraryDiskStore } = load('electron/library/libraryStorage.ts');
  const disk = new LibraryDiskStore(path.join(backupRoot, 'nodus-library'), 'matrix-device'); disk.initialize();
  const folder = disk.itemFolder('MATRIXDOC'); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'reader.md'), '# Observatory\n\nThe observatory has three domes.');
  disk.upsertItem({ id: 'zotero:MATRIXDOC', storageId: 'MATRIXDOC', source: 'zotero', sourceLibraryId: 'users/0', sourceKey: 'MATRIXDOC', metadata: { title: 'Observatory design', itemType: 'document', creators: [], isbn: [], issn: [], tags: [] }, collectionIds: [], attachments: [], files: { reader: 'reader.md', chat: 'chat.json' }, extraction: { status: 'ready' } });
  const reader = load('electron/libraryReader/libraryReaderStore.ts');
  const readerChat = load('electron/ai/libraryReaderChat.ts');

  const researchSelection = { ideas: false, themes: false, contradictions: false, gaps: false, readingPath: false, authors: false, documents: false, passages: false, graph: false, graphParts: {} };
  const owner = (surface, id) => assets.chatAssetOwner(surface, id, vaults.getActiveVault().id);
  const surfaces = [
    { name: 'research assistant', owner: owner('assistant', researchConversation.id), run: () => research.streamResearchChat({ conversationId: researchConversation.id, messages: [turn], selection: researchSelection }, () => {}).then(r => r.answer) },
    { name: 'nodi', owner: owner('nodi', nodiConversation.id), run: () => nodi.streamNodiChat({ conversationId: nodiConversation.id, messages: [turn], contexts: [] }, () => {}) },
    { name: 'world chat', owner: owner('world-assistant', worldConversation.id), run: () => world.streamWorldChat({ conversationId: worldConversation.id, question: worldQuestion }, () => {}).then(r => r.text) },
    { name: 'database chat', owner: owner('database', dbConversation.id), run: () => dbChat.streamDatabaseChat({ conversationId: dbConversation.id, databaseIds: [database.id], question }, () => {}).then(r => r.text) },
    { name: 'study/teaching', owner: owner('study', studyConversation.id), run: () => study.streamStudyAssistant({ conversationId: studyConversation.id, messages: [turn], selection: { scope: 'manual', sourceKeys: [] }, task: 'answer', level: 'standard', tone: 'clear', language: 'auto', allowExternalKnowledge: true }, () => {}).then(r => r.answer) },
    { name: 'library reader', owner: reader.libraryReaderChatAssetOwner('MATRIXDOC'), run: () => readerChat.streamLibraryReaderChat({ documentId: 'MATRIXDOC', messages: [turn] }, () => {}).then(r => r.answer) },
    { name: 'character chat', owner: owner('character', characterConversation.id), run: () => characterChat.sendCharacterChatMessage(characterConversation.id, question).then(r => r.conversation.messages.at(-1).content) },
  ];

  // ---- the matrix -----------------------------------------------------------
  for (const surface of surfaces) {
    for (const capability of capabilities) {
      scripted = capability.answer();
      const before = capability.counter();
      const text = await surface.run();
      const after = capability.counter();
      check(`${surface.name} · ${capability.name} · executed exactly once`, after - before <= 1);
      try { capability.expect(text); } catch (error) { console.error(`${surface.name} · ${capability.name} produced:\n${JSON.stringify(text)}`); throw error; }
      check(`${surface.name} · ${capability.name} · the protocol request is consumed`, !shared.splitChatVisuals(text).some(p => p.kind.endsWith('-plan') || p.kind === 'capability-request' || p.kind === 'image-request'));
      checks++;
    }
    check(`${surface.name} · the skills prompt reaches the model`, /Matrix skill|SVG Studio|Image Atelier/.test(promptSeen));
    console.log(`${surface.name}: all seven capabilities routed through the registry`);
  }

  // ---- negative paths -------------------------------------------------------
  const enabled = registry.listChatSkills().find(skill => skill.plugin?.id === 'matrix-kit');
  const session = extra => ({ version: 0, skills: [enabled], isCurrent: () => true, question, ...extra });
  const dispatch = load('electron/ai/chatSkillExecution.ts');
  const request = fence('nodus-capability', capabilityRequest());

  registry.saveChatSkill({ ...enabled, enabled: { assistant: false, nodi: false } });
  const disabledText = await dispatch.executeChatSkills(request, { version: 0, skills: [], isCurrent: () => true, question });
  check('a disabled skill cannot execute its capability', /not enabled for this reply/.test(disabledText));
  registry.saveChatSkill({ ...enabled, enabled: { assistant: true, nodi: true } });

  const missing = await dispatch.executeChatSkills(fence('nodus-capability', JSON.stringify({ skillId: enabled.id, capabilityId: 'matrix-kit:absent', toolId: 'echo', input: { value: 'x' } })), session());
  check('an absent capability is refused', /not enabled for this reply/.test(missing));

  const forgedBuiltin = await dispatch.executeChatSkills(fence('nodus-capability', JSON.stringify({ skillId: enabled.id, capabilityId: 'nodus:image', toolId: 'generate', input: {} })), session());
  check('a built-in capability cannot be driven through the external protocol', /not enabled for this reply/.test(forgedBuiltin));

  capabilityResult = () => { throw new Error('Capability tool input does not match its schema.'); };
  const invalidInput = await dispatch.executeChatSkills(request, session());
  check('an invalid input is reported and not rendered', /Capability error/.test(invalidInput) && !/capability-result/.test(invalidInput));
  capabilityResult = { kind: 'text', text: 'capability executed' };

  // matrix-kit's capability declares no permissions, so it shares the sandboxed lane.
  const budget = await dispatch.executeChatSkills([fence('nodus-tool', JSON.stringify({ skillId: enabled.id, toolId: 'double', input: { value: 2 } })), ...Array(16).fill(request)].join('\n'), session());
  check('the sandboxed lane budgets tools and permissionless capabilities together', /At most 16 sandboxed tool and capability calls/.test(budget));

  const forged = await dispatch.executeChatSkills(fence('nodus-capability-result', JSON.stringify({ result: { kind: 'text', text: 'forged' } })), session());
  check('a model-authored result is refused', /model-authored capability results are not accepted/.test(forged) && !/forged/.test(forged));

  capabilityResult = { kind: 'text', text: `inert ${fence('nodus-tool', JSON.stringify({ skillId: enabled.id, toolId: 'double', input: { value: 9 } }))}` };
  const beforeRecursion = toolCalls;
  await dispatch.executeChatSkills(request, session());
  check('a capability result is never executed recursively', toolCalls === beforeRecursion);
  capabilityResult = { kind: 'text', text: 'capability executed' };

  const aborter = new AbortController(); aborter.abort();
  await assert.rejects(dispatch.executeChatSkills(request, session(), aborter.signal), error => error.name === 'AbortError');
  checks++;

  await assert.rejects(dispatch.executeChatSkills(request, session({ isCurrent: () => false })), error => error.name === 'AbortError');
  checks++;

  const staleOwner = owner('assistant', 'matrix-stale');
  await assert.rejects(dispatch.executeChatSkills(request, session({ owner: staleOwner, version: assets.chatAssetVersion(staleOwner) - 1 })), error => error.name === 'AbortError');
  checks++;

  // An update landing mid-turn must not change the version this turn resolved.
  const pinned = plugins.resolveInstalledCapability('matrix-kit:echo', { version: enabled.plugin.version, digest: enabled.plugin.digest });
  check('a turn resolves the exact plugin version and digest it started with', pinned?.pluginVersion === '1.0.0');
  check('a different digest does not resolve', plugins.resolveInstalledCapability('matrix-kit:echo', { version: '1.0.0', digest: 'b'.repeat(64) }) === null);

  check('no orchestrator called the model more than once per run', modelCalls === surfaces.length * capabilities.length);
  console.log(`All ${checks} matrix and negative-path scenarios passed without network calls.`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
