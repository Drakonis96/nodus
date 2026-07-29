import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-live-ai-features')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/audit-live-ai-features.mjs'), '--electron-live-ai-features'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const geminiKey = process.env.NODUS_AUDIT_GEMINI_KEY;
const openRouterKey = process.env.NODUS_AUDIT_OPENROUTER_KEY;
if (!geminiKey || !openRouterKey) throw new Error('Both limited audit keys are required.');
const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-live-ai-features-'));
installRuntimeHooks(userDataPath);

const MODEL = { provider: 'gemini', model: 'gemini-2.5-flash-lite' };
try {
  const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const database = require(path.join(repoRoot, 'electron/db/database.ts'));
  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const settings = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));

  const worldVault = vaults.createVault('World live AI audit', 'worldbuilding');
  vaults.setActiveVault(worldVault.id);
  secrets.setApiKey('gemini', geminiKey);
  configureModels(settings);

  const demo = require(path.join(repoRoot, 'electron/db/worldbuildingDemoData.ts'));
  const continuity = require(path.join(repoRoot, 'electron/db/worldContinuityRepo.ts'));
  const worldChat = require(path.join(repoRoot, 'electron/ai/worldChat.ts'));
  const interview = require(path.join(repoRoot, 'electron/ai/characterInterview.ts'));
  const biography = require(path.join(repoRoot, 'electron/ai/characterBiography.ts'));
  assert.equal(demo.seedWorldbuildingDemoData(), true, 'worldbuilding fixture must seed');

  const findings = continuity.runContinuity();
  const facts = worldChat.buildWorldChatFacts({
    question: '¿Qué sabes de Aurel y qué problemas de continuidad le afectan?',
    focusKeys: ['character:demo-world-char-aurel'],
    model: MODEL,
  });
  assert.equal(facts.focus[0]?.id, 'demo-world-char-aurel');
  assert.ok(facts.prose.length > 0, 'world chat must receive canonical prose');
  assert.ok(Object.keys(facts.computed).length > 0, 'world chat must receive deterministic computed facts');
  assert.ok(findings.length > 0, 'the continuity engine must inspect and report the seeded world');

  let worldStream = '';
  const worldAnswer = await worldChat.streamWorldChat({
    question: '¿Qué sabes de Aurel y qué problemas de continuidad le afectan?',
    focusKeys: ['character:demo-world-char-aurel'],
    model: MODEL,
  }, (delta) => { worldStream += delta; });
  assert.equal(worldAnswer.noMaterial, false);
  assert.ok(worldAnswer.text.trim().length > 40);
  assert.ok(worldStream.trim().length > 0, 'world chat must stream provider output');
  for (const match of worldAnswer.text.matchAll(/nodus:\/\/world\/([^/]+)\/([^)]+)/g)) {
    assert.ok(worldChat.citableKeys().has(`${match[1]}:${decodeURIComponent(match[2])}`), 'world chat citations must resolve to real entries');
  }

  const interviewAnswer = await interview.interviewCharacter(
    'demo-world-char-aurel',
    'Preséntate brevemente con tu nombre y explica qué responsabilidad guía tus decisiones.',
    [],
  );
  assert.ok(interviewAnswer.trim().length > 20);
  assert.match(interviewAnswer, /Aurel/iu, 'the character must retain its identity in the interview');
  assert.doesNotMatch(interviewAnswer, /system prompt|instrucciones del sistema/iu);

  const bio = await biography.generateCharacterBiography('demo-world-char-aurel', 'faithful');
  assert.equal(bio.noMaterial, false);
  assert.equal(bio.proposal, false);
  assert.ok((bio.biography ?? '').length > 100);

  database.closeDb();
  const studyVault = vaults.createVault('Study live AI audit', 'estudio');
  vaults.setActiveVault(studyVault.id);
  secrets.setApiKey('gemini', geminiKey);
  secrets.setApiKey('openrouter', openRouterKey);
  configureModels(settings);

  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const search = require(path.join(repoRoot, 'electron/ai/studySearch.ts'));
  const improve = require(path.join(repoRoot, 'electron/ai/studyImprove.ts'));
  const assistant = require(path.join(repoRoot, 'electron/ai/studyAssistant.ts'));
  const course = org.createStudyCourse({ name: 'Metodología' });
  const subject = org.createStudySubject({ courseId: course.id, name: 'Crítica de fuentes' });
  const document = org.createStudyDocument({
    title: 'Jerarquía de evidencias',
    contentMarkdown: '# Crítica de fuentes\n\nUna fuente primaria testimonia directamente un contexto, pero no es infalible. Debe contrastarse con su autoría, propósito, fecha y transmisión.',
    placement: { courseId: course.id, subjectId: subject.id },
  });

  const original = 'segun “el informe conserva 37 casos”, el total fue 37% en 2024 (García, 2023, p. 8).';
  let improvementStream = '';
  const improved = await improve.improveStudyText({
    documentId: document.id,
    subjectId: subject.id,
    text: original,
    styleId: 'builtin:academic',
    scope: 'selection',
    level: 'minimal',
    length: 'similar',
    mode: 'preserve',
    variables: { language: 'es', subject: 'Metodología', documentType: 'apunte', selectedText: original },
    protectedTerms: ['García'],
    model: MODEL,
  }, (delta) => { improvementStream += delta; });
  assert.equal(improved.modelProvider, 'gemini');
  assert.equal(improved.modelName, 'gemini-2.5-flash-lite');
  assert.ok(improved.text.length > 20 && improvementStream.length > 0);
  for (const protectedValue of ['“el informe conserva 37 casos”', '37%', '2024', '(García, 2023, p. 8)']) {
    assert.ok(improved.text.includes(protectedValue), `protected content must survive: ${protectedValue}`);
  }

  const index = await search.rebuildStudySearchIndex();
  assert.equal(index.embeddedEntries, index.indexedEntries);
  let assistantStream = '';
  const assistantAnswer = await assistant.streamStudyAssistant({
    messages: [{
      id: 'audit-question',
      role: 'user',
      content: '¿Por qué una fuente primaria no debe aceptarse sin crítica?',
      createdAt: new Date().toISOString(),
    }],
    selection: { scope: 'manual', sourceKeys: [`document:${document.id}`], courseId: course.id, subjectId: subject.id, topicId: null },
    task: 'answer',
    level: 'standard',
    tone: 'clear',
    language: 'es',
    allowExternalKnowledge: false,
    model: MODEL,
  }, (delta, kind) => { if (kind !== 'reasoning') assistantStream += delta; });
  assert.equal(assistantAnswer.insufficientInformation, false);
  assert.ok(assistantAnswer.answer.length > 30 && assistantStream.length > 0);
  assert.ok(assistantAnswer.availableCitations.length > 0);
  assert.ok(assistantAnswer.citations.length > 0, 'grounded answer must include a validated corpus citation');
  assert.equal(assistantAnswer.citationWarning, false);
  assert.ok(assistantAnswer.citations.every((citation) => assistantAnswer.availableCitations.some((available) => available.id === citation.id)));

  database.closeDb();
  console.log(JSON.stringify({
    textModel: MODEL.model,
    worldChat: true,
    worldComputedFacts: Object.keys(facts.computed).length,
    continuityFindings: findings.length,
    characterInterview: true,
    characterBiography: true,
    studyImprovement: true,
    protectedSpans: improved.protectedSpanCount,
    studyAssistantGrounded: true,
    validatedCitations: assistantAnswer.citations.length,
  }));
} finally {
  fs.rmSync(userDataPath, { recursive: true, force: true });
}

function configureModels(settings) {
  settings.updateSettings({
    uiLanguage: 'es',
    promptLanguage: 'es',
    extractionModel: MODEL,
    synthesisModel: MODEL,
    summaryModel: MODEL,
    fusionModel: MODEL,
    chatModel: MODEL,
    nodiModel: MODEL,
    deepResearchModel: MODEL,
    immersionModel: MODEL,
    writingModel: MODEL,
    argumentMapModel: MODEL,
    authorModel: MODEL,
    studyModel: MODEL,
    tutorModel: MODEL,
    hypothesisModel: MODEL,
    improveModel: MODEL,
    questionGenModel: MODEL,
    gradingModel: MODEL,
    flashcardModel: MODEL,
    embeddingProvider: 'openrouter',
    embeddingModel: 'baai/bge-m3',
    studyAiEnabled: true,
    studyAiPrivacyMode: 'external',
    studyAiLocalOnly: false,
    studyAiConfirmExternal: false,
    studyAiRetryCount: 0,
  });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-audit', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(String(value)),
      decryptString: (value) => Buffer.from(value).toString(),
    },
    dialog: { showMessageBoxSync: () => 1 },
    shell: {},
    BrowserWindow: class {},
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
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
