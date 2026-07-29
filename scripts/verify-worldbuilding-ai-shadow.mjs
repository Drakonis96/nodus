// Live Worldbuilding AI audit against a complete, isolated demo vault.
// Generation is restricted to Gemini Flash-Lite; no image provider is invoked.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const reportPath = path.resolve(
  process.env.NODUS_WORLDBUILDING_AI_REPORT
    || path.join(os.tmpdir(), 'nodus-worldbuilding-ai-shadow-report.json'),
);
const modelId = 'gemini-3.5-flash-lite';

if (!process.argv.includes('--electron-worldbuilding-ai-shadow')) {
  assert.ok(process.env.GEMINI_API_KEY?.trim(), 'Set GEMINI_API_KEY for this isolated run.');
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/verify-worldbuilding-ai-shadow.mjs'), '--electron-worldbuilding-ai-shadow'],
    {
      cwd: repoRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit',
    },
  );
  process.exit(0);
}

const apiKey = process.env.GEMINI_API_KEY?.trim();
assert.ok(apiKey, 'Gemini key is available only to this isolated process.');
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-worldbuilding-ai-shadow-'));
installRuntimeHooks(root);

let closeDb = () => undefined;
let clearKey = () => undefined;
const startedAt = Date.now();
try {
  const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const vault = vaults.createVault('Worldbuilding AI shadow', 'worldbuilding');
  vaults.setActiveVault(vault.id);

  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const demo = require(path.join(repoRoot, 'electron/db/worldbuildingDemoData.ts'));
  const characters = require(path.join(repoRoot, 'electron/db/charactersRepo.ts'));
  const characterChat = require(path.join(repoRoot, 'electron/db/characterChatRepo.ts'));
  const encyclopedia = require(path.join(repoRoot, 'electron/db/worldEncyclopediaRepo.ts'));
  const rules = require(path.join(repoRoot, 'electron/db/worldRulesRepo.ts'));
  const questions = require(path.join(repoRoot, 'electron/db/worldQuestionsRepo.ts'));
  const manuscript = require(path.join(repoRoot, 'electron/db/worldManuscriptRepo.ts'));
  const worldChatHistory = require(path.join(repoRoot, 'electron/db/worldChatRepo.ts'));
  const biographyAi = require(path.join(repoRoot, 'electron/ai/characterBiography.ts'));
  const characterChatAi = require(path.join(repoRoot, 'electron/ai/characterChat.ts'));
  const articleAi = require(path.join(repoRoot, 'electron/ai/worldArticleDraft.ts'));
  const missingAi = require(path.join(repoRoot, 'electron/ai/worldMissingEntries.ts'));
  const ruleAi = require(path.join(repoRoot, 'electron/ai/worldRules.ts'));
  const questionAi = require(path.join(repoRoot, 'electron/ai/worldQuestionOptions.ts'));
  const proseAi = require(path.join(repoRoot, 'electron/ai/worldProseReview.ts'));
  const worldChatAi = require(path.join(repoRoot, 'electron/ai/worldChat.ts'));
  const promptLanguage = require(path.join(repoRoot, 'shared/worldPromptLanguage.ts'));
  ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));

  clearKey = () => secrets.clearApiKey('gemini');
  secrets.setApiKey('gemini', apiKey);
  delete process.env.GEMINI_API_KEY;

  const model = { provider: 'gemini', model: modelId };
  settingsRepo.updateSettings({
    uiLanguage: 'es',
    promptLanguage: 'es',
    modelSettingsMode: 'advanced',
    synthesisModel: model,
    extractionModel: model,
    summaryModel: model,
    chatModel: model,
    writingModel: model,
    chatReasoning: 'off',
  });
  assert.equal(demo.seedWorldbuildingDemoData(), true, 'the complete local demo was seeded once.');

  // Every supported interface language appends a concrete response-language contract.
  for (const locale of ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr']) {
    const localized = promptLanguage.withWorldPromptLanguage('BASE', locale);
    assert.ok(localized.startsWith('BASE\n\n') && localized.length > 12, `${locale} has a world prompt-language directive.`);
  }

  // Character biography: faithful may write canon; propose must remain quarantined.
  const personId = 'demo-world-char-ilyra';
  const initialCharacter = characters.getCharacter(personId);
  assert.ok(initialCharacter?.profile.backstory?.includes('???'), 'the selected character has rich unresolved material.');
  const faithful = await biographyAi.generateCharacterBiography(personId, 'faithful');
  assert.ok(!faithful.noMaterial && !faithful.proposal && faithful.biography?.length > 120);
  const afterFaithful = characters.getCharacter(personId);
  assert.equal(afterFaithful.biography, faithful.biography, 'faithful biography is stored in the accepted field.');

  const acceptedBiography = afterFaithful.biography;
  const proposed = await biographyAi.generateCharacterBiography(personId, 'propose');
  const afterProposal = characters.getCharacter(personId);
  assert.ok(!proposed.noMaterial && proposed.proposal && proposed.biography?.length > 120);
  assert.equal(afterProposal.biography, acceptedBiography, 'proposal generation never overwrites accepted biography.');
  assert.equal(afterProposal.profile.biographyProposed, proposed.biography, 'proposal is stored in its quarantine field.');
  const acceptedProposal = characters.acceptProposedBiography(personId);
  assert.equal(acceptedProposal.biography, proposed.biography, 'explicit acceptance promotes the proposed biography.');
  assert.equal(acceptedProposal.profile.biographyProposed, null, 'accepted proposal leaves no stale quarantine copy.');

  // Persistent in-character chat, without invoking the separate image-generation model.
  const conversation = characterChat.createCharacterChatConversation({
    personId,
    title: 'Auditoría de voz y conocimiento',
    imageEnabled: false,
  });
  const chatResult = await characterChatAi.sendCharacterChatMessage(
    conversation.id,
    '¿Cuál es tu oficio y qué buscas ahora? Responde desde tu ficha y no inventes datos externos.',
  );
  assert.equal(chatResult.imageError, null);
  assert.equal(chatResult.conversation.messageCount, 2, 'author and character turns are persisted.');
  assert.deepEqual(chatResult.conversation.messages.map((message) => message.role), ['author', 'character']);
  assert.ok(chatResult.conversation.messages[1].content.length > 30, 'the character produced a substantive reply.');
  assert.match(
    chatResult.conversation.messages[1].content,
    /cart[oó]graf|mapa|rumbo/i,
    'the answer stays anchored to Ilyra’s cartographer sheet.',
  );
  assert.equal(chatResult.conversation.imageCount, 0, 'image-disabled chat never calls or stores image output.');

  // Encyclopedia drafting: generated prose is quarantined, then accepted explicitly.
  const articleId = 'demo-world-article-thirdmoon';
  const articleBefore = encyclopedia.getWorldArticle(articleId);
  const articleDraft = await articleAi.draftWorldArticle(articleId, 'expand');
  const articleQuarantined = encyclopedia.getWorldArticle(articleId);
  assert.ok(!articleDraft.noMaterial && articleDraft.body?.length > 100);
  assert.equal(articleQuarantined.body, articleBefore.body, 'article generation leaves canonical body untouched.');
  assert.equal(articleQuarantined.proposedBody, articleDraft.body);
  const acceptedArticle = encyclopedia.acceptArticleProposedBody(articleId);
  assert.equal(acceptedArticle.body, articleDraft.body, 'article draft changes canon only after acceptance.');
  assert.equal(acceptedArticle.proposedBody, null);
  encyclopedia.setArticleProposedBody(articleId, 'propuesta que se descarta');
  encyclopedia.setArticleProposedBody(articleId, null);
  assert.equal(encyclopedia.getWorldArticle(articleId).body, articleDraft.body, 'rejecting a later proposal preserves accepted prose.');

  // Missing-entry analysis may classify only terms already found by deterministic scans.
  const knownEntriesBefore = new Set(encyclopedia.listWorldEntries().map((entry) => entry.key));
  const pendingProposals = await missingAi.analyzeMissingEntries();
  assert.ok(pendingProposals.length >= 1, 'the unresolved/frequency scan produced at least one pending proposal.');
  assert.ok(pendingProposals.every((proposal) => proposal.status === 'pending'));
  assert.equal(
    encyclopedia.listWorldEntries().length,
    knownEntriesBefore.size,
    'analysis alone creates no canonical encyclopedia entry.',
  );
  const acceptedEntry = encyclopedia.acceptEntryProposal(pendingProposals[0].proposalId);
  assert.equal(acceptedEntry.origin, 'ai_proposal', 'accepted AI proposal retains provenance.');

  // Rule drafting: statement remains untouched until explicit acceptance.
  const ruleId = 'demo-world-rule-shadow';
  const ruleBefore = rules.getWorldRule(ruleId);
  const ruleDraft = await ruleAi.draftWorldRule(ruleId);
  const ruleQuarantined = rules.getWorldRule(ruleId);
  assert.ok(!ruleDraft.noMaterial && ruleDraft.text?.length > 30);
  assert.equal(ruleQuarantined.statement, ruleBefore.statement);
  assert.equal(ruleQuarantined.proposedText, ruleDraft.text);
  const acceptedRule = rules.acceptRuleProposedText(ruleId);
  assert.equal(acceptedRule.statement, ruleDraft.text);
  assert.equal(acceptedRule.proposedText, null);
  rules.setRuleProposedText(ruleId, 'propuesta descartable');
  rules.setRuleProposedText(ruleId, null);
  assert.equal(rules.getWorldRule(ruleId).statement, ruleDraft.text, 'rejecting a rule draft preserves canon.');

  // AI question options remain non-canon until chosen; apply and undo are lossless.
  const questionId = 'demo-world-question-nara';
  const questionBefore = questions.getWorldQuestion(questionId);
  const anchorBefore = characters.getCharacter('demo-world-char-nara').profile.backstory;
  const optionsResult = await questionAi.proposeQuestionOptions(questionId);
  assert.ok(!optionsResult.noMaterial && optionsResult.options.length >= 1);
  assert.ok(optionsResult.options.every((option) => option.origin === 'ai'));
  assert.equal(questions.getWorldQuestion(questionId).chosenOptionId, questionBefore.chosenOptionId);
  assert.equal(
    characters.getCharacter('demo-world-char-nara').profile.backstory,
    anchorBefore,
    'proposing options does not edit the anchored character sheet.',
  );
  const chosen = optionsResult.options[0];
  const answered = questions.applyQuestionOption(chosen.optionId);
  assert.equal(answered.chosenOptionId, chosen.optionId);
  assert.notEqual(characters.getCharacter('demo-world-char-nara').profile.backstory, anchorBefore);
  const undone = questions.undoQuestionOption(chosen.optionId);
  assert.equal(undone.chosenOptionId, null);
  assert.equal(
    characters.getCharacter('demo-world-char-nara').profile.backstory,
    anchorBefore,
    'undo restores the exact pre-AI source text.',
  );

  // Prose review reads manuscript + declared beats and never rewrites either.
  const sceneId = 'demo-world-scene-heart';
  const manuscriptBefore = manuscript.getSceneText(sceneId).text;
  const review = await proseAi.reviewWorldProse(sceneId);
  assert.ok(!review.noMaterial && review.beats.length >= 1);
  assert.ok(review.beats.every((beat) => beat.present === null || typeof beat.present === 'boolean'));
  assert.equal(manuscript.getSceneText(sceneId).text, manuscriptBefore, 'prose review is strictly read-only.');

  // Unanchored chat refuses to improvise. Anchored chat consumes deterministic
  // continuity findings, streams content, validates links and can be persisted.
  const emptyChat = await worldChatAi.streamWorldChat(
    { question: '¿Qué debería ocurrir después sin referirme a ninguna ficha?', focusKeys: [] },
    () => undefined,
  );
  assert.equal(emptyChat.noMaterial, true);
  assert.equal(emptyChat.text, '');

  const worldQuestion = '¿Qué contradicciones constan sobre Odran Vale y qué debería revisar?';
  const facts = worldChatAi.buildWorldChatFacts({ question: worldQuestion, focusKeys: [] });
  assert.ok(facts.focus.some((ref) => ref.id === 'demo-world-char-odran'));
  assert.ok((facts.computed.findings ?? []).length >= 1, 'continuity contradictions are computed before the model call.');
  const deltas = [];
  const chat = await worldChatAi.streamWorldChat(
    { question: worldQuestion, focusKeys: [], model },
    (delta) => { if (delta) deltas.push(delta); },
  );
  assert.ok(!chat.noMaterial && chat.text.length > 40);
  assert.equal(deltas.join(''), chat.text, 'world chat streaming reconstructs the returned answer.');
  const allowed = new Set(encyclopedia.listWorldEntries().map((entry) => entry.key));
  for (const match of chat.text.matchAll(/nodus:\/\/world\/([a-z]+)\/([^)\s]+)/g)) {
    assert.ok(allowed.has(`${match[1]}:${decodeURIComponent(match[2])}`), 'every surviving world-chat link resolves.');
  }

  const history = worldChatHistory.createWorldChatConversation({
    title: 'Auditoría de continuidad',
    selection: { scope: 'auto', entryKeys: [], keepFocus: false },
    model,
  });
  const savedHistory = worldChatHistory.saveWorldChatConversation(
    history.id,
    [
      { role: 'user', content: worldQuestion },
      { role: 'assistant', content: chat.text },
    ],
    history.selection,
    chat.focus,
    model,
  );
  assert.equal(savedHistory.messageCount, 2);
  assert.deepEqual(savedHistory.focus, chat.focus);
  assert.deepEqual(worldChatHistory.getWorldChatConversation(history.id).messages, savedHistory.messages);

  const report = {
    isolated: true,
    cleanedAfterRun: true,
    provider: 'gemini',
    model: modelId,
    demo: {
      entries: encyclopedia.listWorldEntries().length,
      characters: characters.listCharacters().length,
    },
    characterBiography: {
      faithfulStored: true,
      proposalQuarantined: true,
      proposalAccepted: true,
    },
    characterChat: {
      persistentTurns: chatResult.conversation.messageCount,
      anchoredToSheet: true,
      imageProviderCalls: 0,
    },
    articleDraft: { quarantined: true, accepted: true, rejectedWithoutCanonMutation: true },
    missingEntries: { pending: pendingProposals.length, createsCanonBeforeAcceptance: false, acceptedWithProvenance: true },
    ruleDraft: { quarantined: true, accepted: true, rejectedWithoutCanonMutation: true },
    questionOptions: { generated: optionsResult.options.length, origin: 'ai', applyUndoLossless: true },
    proseReview: { beatsReviewed: review.beats.length, readOnly: true },
    continuity: { computedFindings: facts.computed.findings.length },
    worldChat: {
      unanchoredRefusal: true,
      streamedDeltaEvents: deltas.length,
      validCitations: true,
      persistedTurns: savedHistory.messageCount,
    },
    promptLanguages: 8,
    durationMs: Date.now() - startedAt,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  console.log(`Sanitized report: ${reportPath}`);
  console.log('Live isolated Worldbuilding AI verification passed.');
} finally {
  delete process.env.GEMINI_API_KEY;
  try { clearKey(); } catch { /* the entire profile is deleted below */ }
  try { closeDb(); } catch { /* database may not have opened */ }
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-worldbuilding-ai-shadow',
      getAppPath: () => repoRoot,
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(String(value)),
      decryptString: (value) => Buffer.from(value).toString(),
    },
    dialog: { showMessageBoxSync: () => 1 },
    shell: {},
    BrowserWindow: class {},
    ipcMain: { handle: () => undefined, on: () => undefined },
  };
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function (module, filename) {
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
