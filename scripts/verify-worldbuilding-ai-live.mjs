// Live, isolated end-to-end audit for every text/vision AI surface of a
// worldbuilding vault. Credentials exist only in the parent environment and the
// ephemeral secret store. The report contains no keys and the temporary vault is
// removed even when an assertion fails.
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
    || path.join(os.tmpdir(), 'nodus-worldbuilding-ai-live-report.json')
);

if (!process.argv.includes('--electron-worldbuilding-ai-live')) {
  assert.ok(process.env.GEMINI_API_KEY?.trim(), 'Set GEMINI_API_KEY for this isolated run.');
  assert.ok(process.env.OPENROUTER_API_KEY?.trim(), 'Set OPENROUTER_API_KEY for this isolated run.');
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/verify-worldbuilding-ai-live.mjs'), '--electron-worldbuilding-ai-live'],
    {
      cwd: repoRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit',
    }
  );
  process.exit(0);
}

const geminiKey = process.env.GEMINI_API_KEY?.trim();
const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
assert.ok(geminiKey && openRouterKey);

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-worldbuilding-ai-live-'));
installRuntimeHooks(root);
let closeDb = () => undefined;
const startedAt = Date.now();
const cases = [];
const record = (id, details = {}) => cases.push({ id, passed: true, ...details });
const chatModelId = 'gemini-2.5-flash-lite';
const embeddingModelId = 'baai/bge-m3';

try {
  const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const providers = require(path.join(repoRoot, 'electron/ai/providers.ts'));
  const settings = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const database = require(path.join(repoRoot, 'electron/db/database.ts'));
  const demo = require(path.join(repoRoot, 'electron/db/worldbuildingDemoData.ts'));
  const aiClient = require(path.join(repoRoot, 'electron/ai/aiClient.ts'));
  const worldChat = require(path.join(repoRoot, 'electron/ai/worldChat.ts'));
  const nodi = require(path.join(repoRoot, 'electron/ai/nodiChat.ts'));
  const characters = require(path.join(repoRoot, 'electron/db/charactersRepo.ts'));
  const characterInterview = require(path.join(repoRoot, 'electron/ai/characterInterview.ts'));
  const characterBiography = require(path.join(repoRoot, 'electron/ai/characterBiography.ts'));
  const characterChatRepo = require(path.join(repoRoot, 'electron/db/characterChatRepo.ts'));
  const characterChat = require(path.join(repoRoot, 'electron/ai/characterChat.ts'));
  const encyclopedia = require(path.join(repoRoot, 'electron/db/worldEncyclopediaRepo.ts'));
  const articleDraft = require(path.join(repoRoot, 'electron/ai/worldArticleDraft.ts'));
  const missingEntries = require(path.join(repoRoot, 'electron/ai/worldMissingEntries.ts'));
  const worldRulesRepo = require(path.join(repoRoot, 'electron/db/worldRulesRepo.ts'));
  const worldRules = require(path.join(repoRoot, 'electron/ai/worldRules.ts'));
  const questionsRepo = require(path.join(repoRoot, 'electron/db/worldQuestionsRepo.ts'));
  const questionOptions = require(path.join(repoRoot, 'electron/ai/worldQuestionOptions.ts'));
  const story = require(path.join(repoRoot, 'electron/db/worldStoryRepo.ts'));
  const manuscript = require(path.join(repoRoot, 'electron/db/worldManuscriptRepo.ts'));
  const threads = require(path.join(repoRoot, 'electron/db/worldThreadsRepo.ts'));
  const proseReview = require(path.join(repoRoot, 'electron/ai/worldProseReview.ts'));
  const continuity = require(path.join(repoRoot, 'electron/db/worldContinuityRepo.ts'));
  const mapsRepo = require(path.join(repoRoot, 'electron/db/worldMapsRepo.ts'));
  const mapGeneration = require(path.join(repoRoot, 'electron/maps/mapGeneration.ts'));
  const archiveRepo = require(path.join(repoRoot, 'electron/db/archiveRepo.ts'));
  const archiveDiscovery = require(path.join(repoRoot, 'electron/archive/archiveDiscovery.ts'));
  ({ closeDb } = database);

  secrets.setApiKey('gemini', geminiKey);
  secrets.setApiKey('openrouter', openRouterKey);
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  const [chatModels, embeddingModels] = await Promise.all([
    providers.listModels('gemini', secrets.getApiKey('gemini')),
    providers.listEmbeddingModels('openrouter', secrets.getApiKey('openrouter')),
  ]);
  assert.ok(chatModels.some((item) => item.id === chatModelId), `${chatModelId} is available`);
  assert.ok(embeddingModels.some((item) => item.id === embeddingModelId), `${embeddingModelId} is available`);
  record('provider_catalogues', { chatModel: chatModelId, embeddingModel: embeddingModelId });

  const model = { provider: 'gemini', model: chatModelId };
  settings.updateSettings({
    uiLanguage: 'es',
    promptLanguage: 'es',
    modelSettingsMode: 'advanced',
    extractionModel: model,
    synthesisModel: model,
    chatModel: model,
    nodiModel: model,
    visionModel: model,
    embeddingProvider: 'openrouter',
    embeddingModel: embeddingModelId,
  });

  const vectors = await retryOnce(() => aiClient.embedMany([
    'Ilyra es una cartógrafa que busca a su hermana Nara.',
    'Una navegante traza mapas marítimos para encontrar a una familiar desaparecida.',
    'La receta hornea pan con harina y levadura.',
  ]));
  assert.equal(vectors.length, 3);
  for (const vector of vectors) {
    assert.ok(Array.isArray(vector) && vector.length > 100);
    assert.ok(vector.every(Number.isFinite));
    assert.ok(vector.some((value) => value !== 0));
  }
  assert.equal(vectors[0].length, vectors[1].length);
  assert.equal(vectors[0].length, vectors[2].length);
  assert.ok(cosine(vectors[0], vectors[1]) > cosine(vectors[0], vectors[2]));
  record('openrouter_bge_m3_embeddings', {
    dimensions: vectors[0].length,
    relevantScore: round(cosine(vectors[0], vectors[1])),
    irrelevantScore: round(cosine(vectors[0], vectors[2])),
  });

  const created = vaults.createVault('Auditoría IA Worldbuilding', 'worldbuilding');
  vaults.setActiveVault(created.id);
  database.getDb();
  settings.updateSettings({
    uiLanguage: 'es',
    promptLanguage: 'es',
    modelSettingsMode: 'advanced',
    extractionModel: model,
    synthesisModel: model,
    chatModel: model,
    nodiModel: model,
    visionModel: model,
    embeddingProvider: 'openrouter',
    embeddingModel: embeddingModelId,
  });
  assert.equal(demo.seedWorldbuildingDemoData(), true);
  record('isolated_world_seed');

  const loreDocument = archiveRepo.createItem({
    title: 'Cuaderno de rutas de Ilyra',
    kind: 'text',
    extractedText: 'Ilyra Venn, cartógrafa de la Casa del Faro, busca una ruta marítima para encontrar a su hermana Nara.',
    docType: 'other',
  });
  archiveRepo.createItem({
    title: 'Recetario del puerto',
    kind: 'text',
    extractedText: 'Harina, levadura, sal y agua para cocer pan en un horno de piedra.',
    docType: 'other',
  });
  const archiveIndex = await retryOnce(() => archiveDiscovery.embedArchiveBacklog());
  assert.equal(archiveIndex.indexed, 2);
  assert.deepEqual(archiveDiscovery.archiveIndexStatus(), { indexed: 2, total: 2 });
  const archiveQuery = await retryOnce(() => aiClient.embed('cartógrafa que navega para encontrar a su hermana'));
  assert.ok(archiveQuery?.length);
  const retrieved = await archiveRepo.findArchiveItemsSimilar(archiveQuery, { limit: 2, minSimilarity: 0 });
  assert.equal(retrieved[0]?.itemId, loreDocument.itemId);
  record('embedding_indexing_and_semantic_retrieval', {
    indexed: archiveIndex.indexed,
    retrieved: retrieved.length,
    topSimilarity: round(retrieved[0].similarity),
  });

  const findings = continuity.runContinuityUnfiltered();
  const summary = continuity.continuitySummary();
  assert.ok(findings.length > 0, 'demo contains deliberate continuity findings');
  assert.ok(summary.families > 0 && summary.checks > 0 && summary.facts > 0);
  assert.ok(new Set(findings.map((finding) => finding.family)).size > 1);
  record('deterministic_continuity_and_contradictions', {
    findings: findings.length,
    families: summary.families,
    checks: summary.checks,
    facts: summary.facts,
  });

  const chatRequest = {
    question: '¿Qué busca Ilyra Venn y qué sabemos de su hermana?',
    focusKeys: ['character:demo-world-char-ilyra'],
    history: [
      { role: 'user', content: 'Hablemos de la protagonista.' },
      { role: 'assistant', content: 'De acuerdo; usaré únicamente su ficha.' },
    ],
    model,
  };
  const facts = worldChat.buildWorldChatFacts(chatRequest);
  assert.equal(facts.focus[0]?.id, 'demo-world-char-ilyra');
  assert.equal(facts.history.length, 2);
  const worldDeltas = [];
  const worldAnswer = await retryOnce(() =>
    worldChat.streamWorldChat(chatRequest, (delta) => { if (delta) worldDeltas.push(delta); })
  );
  assert.ok(worldDeltas.length > 0);
  assert.match(worldAnswer.text, /Ilyra|Nara/i);
  assert.match(worldAnswer.text, /nodus:\/\/world\/character\/demo-world-char-ilyra/);
  assert.doesNotMatch(worldAnswer.text, /nodus:\/\/world\/[^)\s]+\/invent/i);
  record('world_chat_grounding_streaming_history_and_citations', {
    focusCount: worldAnswer.focus.length,
    streamedChunks: worldDeltas.length,
  });
  await pace();

  const nodiDeltas = [];
  const nodiAnswer = await retryOnce(() =>
    nodi.streamNodiChat(
      {
        messages: [{ role: 'user', content: '¿Qué busca Ilyra Venn?' }],
        contexts: ['vault'],
        model,
      },
      (delta) => { if (delta) nodiDeltas.push(delta); }
    )
  );
  assert.ok(nodiDeltas.length > 0);
  assert.match(nodiAnswer, /Ilyra|Nara|hermana/i);
  assert.match(nodiAnswer, /nodus:\/\/world\/character\/demo-world-char-(?:ilyra|nara)/);
  assert.doesNotMatch(nodiAnswer, /nodus:\/\/world\/[^)\s]+\/invent/i);
  record('nodi_world_context_streaming_and_citations', { streamedChunks: nodiDeltas.length });
  await pace();

  const ilyra = characters.getCharacter('demo-world-char-ilyra');
  assert.ok(ilyra);
  const interview = await retryOnce(() =>
    characterInterview.interviewCharacter(
      ilyra.personId,
      '¿Qué oficio tienes y a quién buscas?',
      [{ role: 'author', content: 'Responde sin salir de tu propia ficha.' }]
    )
  );
  assert.match(interview, /map|cart[oó]graf|Nara|hermana/i);
  record('character_interview_grounding');
  await pace();

  const conversation = characterChatRepo.createCharacterChatConversation({
    personId: ilyra.personId,
    title: 'Auditoría persistente',
    imageEnabled: false,
  });
  const sent = await retryOnce(() =>
    characterChat.sendCharacterChatMessage(conversation.id, '¿A quién buscas y qué oficio tienes?')
  );
  assert.equal(sent.imageError, null);
  assert.equal(sent.conversation.messages.length, 2);
  assert.deepEqual(sent.conversation.messages.map((message) => message.role), ['author', 'character']);
  assert.match(sent.conversation.messages[1].content, /Nara|hermana/i);
  assert.match(sent.conversation.messages[1].content, /map|cart[oó]graf/i);
  record('persistent_character_chat_and_history');
  await pace();

  const acceptedBiographyBefore = ilyra.biography;
  const faithful = await retryOnce(() =>
    characterBiography.generateCharacterBiography(ilyra.personId, 'faithful')
  );
  assert.equal(faithful.proposal, false);
  assert.equal(faithful.noMaterial, false);
  assert.ok(faithful.biography?.trim());
  const faithfulStored = characters.getCharacter(ilyra.personId);
  assert.equal(faithfulStored.biography, faithful.biography);
  const proposed = await retryOnce(() =>
    characterBiography.generateCharacterBiography(ilyra.personId, 'propose')
  );
  assert.equal(proposed.proposal, true);
  assert.ok(proposed.biography?.trim());
  const proposedStored = characters.getCharacter(ilyra.personId);
  assert.equal(proposedStored.biography, faithful.biography);
  assert.equal(proposedStored.profile.biographyProposed, proposed.biography);
  assert.notEqual(proposedStored.profile.biographyProposed, acceptedBiographyBefore);
  record('character_biography_faithful_and_proposal_quarantine');
  await pace();

  const article = encyclopedia.getWorldArticle('demo-world-article-flux');
  assert.ok(article?.body);
  const canonicalArticleBody = article.body;
  const drafted = await retryOnce(() =>
    articleDraft.draftWorldArticle(article.articleId, 'expand')
  );
  assert.equal(drafted.noMaterial, false);
  assert.ok(drafted.body?.trim());
  const articleAfter = encyclopedia.getWorldArticle(article.articleId);
  assert.equal(articleAfter.body, canonicalArticleBody);
  assert.equal(articleAfter.proposedBody, drafted.body);
  record('world_article_expansion_proposal_quarantine');
  await pace();

  const rule = worldRulesRepo.listWorldRules().find((item) => item.ruleId === 'demo-world-rule-shadow')
    || worldRulesRepo.listWorldRules()[0];
  assert.ok(rule);
  const canonicalRule = rule.statement;
  const ruleDraft = await retryOnce(() => worldRules.draftWorldRule(rule.ruleId));
  assert.equal(ruleDraft.noMaterial, false);
  assert.ok(ruleDraft.text?.trim());
  const ruleAfter = worldRulesRepo.getWorldRule(rule.ruleId);
  assert.equal(ruleAfter.statement, canonicalRule);
  assert.equal(ruleAfter.proposedText, ruleDraft.text);
  record('world_rule_proposal_quarantine');
  await pace();

  const canonicalProposalCount = encyclopedia.listEntryProposals().length;
  const proposals = await retryOnce(() => missingEntries.analyzeMissingEntries());
  assert.ok(proposals.length > 0);
  assert.ok(proposals.some((proposal) => proposal.source === 'unresolved_link'));
  assert.ok(encyclopedia.listEntryProposals().length >= canonicalProposalCount);
  record('missing_entry_detection_and_classification', { proposals: proposals.length });
  await pace();

  const question = questionsRepo.getWorldQuestion('demo-world-question-nara');
  assert.ok(question);
  const existingOptions = question.options.length;
  const options = await retryOnce(() => questionOptions.proposeQuestionOptions(question.questionId));
  assert.equal(options.noMaterial, false);
  assert.ok(options.options.length > 0 && options.options.length <= 3);
  const questionAfter = questionsRepo.getWorldQuestion(question.questionId);
  assert.equal(questionAfter.status, question.status);
  assert.equal(questionAfter.chosenOptionId, question.chosenOptionId);
  assert.equal(questionAfter.options.length, existingOptions + options.options.length);
  assert.ok(options.options.every((option) => option.origin === 'ai' && option.appliedAt === null));
  record('question_option_generation_and_quarantine', { generated: options.options.length });
  await pace();

  const scene = story.listScenes('narrative').find((item) =>
    manuscript.getSceneText(item.sceneId).text.trim() && threads.beatsForScene(item.sceneId).length
  );
  assert.ok(scene);
  const review = await retryOnce(() => proseReview.reviewWorldProse(scene.sceneId));
  assert.equal(review.noMaterial, false);
  assert.equal(review.beats.length, threads.beatsForScene(scene.sceneId).length);
  assert.ok(review.beats.every((beat) => beat.present === null || typeof beat.present === 'boolean'));
  record('manuscript_prose_review', { beats: review.beats.length });
  await pace();

  const map = mapsRepo.listWorldMaps().find((item) => item.imageId);
  assert.ok(map);
  const markers = await retryOnce(() => mapGeneration.suggestMapMarkers(map.mapId));
  assert.ok(markers.length <= 30);
  assert.ok(markers.every((marker) =>
    marker.name.trim()
    && marker.x >= 0 && marker.x <= 1
    && marker.y >= 0 && marker.y <= 1
  ));
  record('gemini_flash_lite_map_vision', { suggestions: markers.length });

  const report = {
    isolated: true,
    cleanedAfterRun: true,
    models: { chatAndVision: chatModelId, embeddings: embeddingModelId },
    cases,
    totals: { passed: cases.length, failed: 0 },
    durationMs: Date.now() - startedAt,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  console.log(`Sanitized report: ${reportPath}`);
  console.log('Live isolated worldbuilding AI audit passed.');
} finally {
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try { secretsForCleanup()?.clearApiKey('gemini'); } catch { /* temporary profile is the backstop */ }
  try { secretsForCleanup()?.clearApiKey('openrouter'); } catch { /* temporary profile is the backstop */ }
  try { closeDb(); } catch { /* DB may not have opened */ }
  await rm(root, { recursive: true, force: true });
}

function secretsForCleanup() {
  try {
    return require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  } catch {
    return null;
  }
}

function cosine(left, right) {
  assert.equal(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function round(value) {
  return Math.round(value * 10_000) / 10_000;
}

async function retryOnce(operation) {
  try {
    return await operation();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    return operation();
  }
}

async function pace() {
  await new Promise((resolve) => setTimeout(resolve, 1_200));
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-worldbuilding-ai-live',
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
