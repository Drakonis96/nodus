// Retrieval-only Deep Research audit. It exercises the production section retriever
// against an isolated vault clone and an externally supplied plan. It never invokes
// a text-generation model: the only network-capable operation is the configured
// embedding provider. Semantic judgement is deliberately left to an independent
// actor over the saved JSON artefact.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const FLAG = '--electron-retrieval-audit';
const argOf = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const snapshotDir = path.resolve(argOf('--snapshot', path.join(os.tmpdir(), 'nodus-dr-professional-audit-1c35')));
const planPath = path.resolve(argOf('--plan-file', ''));
const outputPath = path.resolve(argOf('--out', path.join(repoRoot, 'reports/deep-research-professional/retrieval-audit.json')));
const onlySection = argOf('--section', '').trim();
const questionIndex = Number(argOf('--question-index', '-1'));
const passageLimitOverride = Number(argOf('--passages', '0'));
const ideaLimitOverride = Number(argOf('--ideas', '0'));
const excludeFromPath = argOf('--exclude-from', '').trim();

assert.ok(planPath && fs.existsSync(planPath), 'Pass an existing --plan-file.');
assert.ok(fs.existsSync(path.join(snapshotDir, 'nodus.sqlite')), `Missing isolated snapshot: ${snapshotDir}`);

if (!process.argv.includes(FLAG)) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [...process.argv.slice(1), FLAG], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
  process.exit(0);
}

installRuntimeHooks(snapshotDir);
let closeDb = () => undefined;
try {
  const { getApiKey } = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const { getSettings, updateSettings } = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const { getDb, closeDb: close } = require(path.join(repoRoot, 'electron/db/database.ts'));
  closeDb = close;
  const { retrieveSectionMaterial } = require(path.join(repoRoot, 'electron/ai/writingWorkshop.ts'));
  const { SECTION_RETRIEVAL_LIMITS, MAX_COVERAGE_QUESTIONS } = require(path.join(repoRoot, 'electron/ai/deepResearchCore.ts'));

  assert.notEqual(snapshotDir, path.resolve(process.env.HOME ?? '', 'Library/Application Support/nodus'), 'Refusing the real Nodus profile.');
  assert.ok(getApiKey('openrouter'), 'The isolated clone has no OpenRouter key.');
  // Writes, if any provider metadata changes, remain inside the explicitly supplied
  // clone. Generation models are nulled so this harness cannot spend Gemini tokens.
  updateSettings({
    embeddingProvider: 'openrouter',
    embeddingModel: 'baai/bge-m3',
    deepResearchModel: null,
    synthesisModel: null,
    documentIndexingEnabled: false,
    syncMode: 'manual',
    mcpEnabled: false,
    nodusServerEnabled: false,
    localServerEnabled: false,
  });
  const settings = getSettings();
  assert.equal(settings.embeddingProvider, 'openrouter');
  assert.equal(settings.embeddingModel, 'baai/bge-m3');

  const raw = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const plan = raw.plan ?? raw;
  assert.ok(Array.isArray(plan.sections) && plan.sections.length > 0, 'Plan has no sections.');
  const objective = String(raw.objective ?? plan.objective ?? inferObjective(planPath));
  assert.ok(objective.trim(), 'Plan audit needs an objective.');
  const coverageCount = new Set(plan.sections.flatMap((section) => section.coverageQuestions ?? [])).size;
  assert.ok(coverageCount <= MAX_COVERAGE_QUESTIONS, `Plan exceeds ${MAX_COVERAGE_QUESTIONS} atomic questions.`);
  const auditLimits = {
    ideas: ideaLimitOverride > 0 ? ideaLimitOverride : SECTION_RETRIEVAL_LIMITS.ideas,
    passages: passageLimitOverride > 0 ? passageLimitOverride : SECTION_RETRIEVAL_LIMITS.passages,
  };

  const previous = excludeFromPath
    ? JSON.parse(fs.readFileSync(path.resolve(excludeFromPath), 'utf8'))
    : null;
  const selectedSections = onlySection ? plan.sections.filter((section) => section.id === onlySection) : plan.sections;
  assert.ok(selectedSections.length > 0, `Unknown section: ${onlySection}`);
  const sections = [];
  for (const section of selectedSections) {
    const allCoverageQuestions = section.coverageQuestions ?? [];
    const coverageQuestions = Number.isInteger(questionIndex) && questionIndex >= 0
      ? allCoverageQuestions.slice(questionIndex, questionIndex + 1)
      : allCoverageQuestions;
    const priorSection = previous?.sections?.find((candidate) => candidate.id === section.id);
    const excludePassageIds = priorSection?.passages?.map((passage) => passage.id) ?? [];
    const retrieved = await retrieveSectionMaterial({
      objective,
      sectionTitle: section.title,
      purpose: section.purpose,
      keyClaims: section.keyClaims ?? [],
      coverageQuestions,
      excludeIdeaIds: [],
      excludePassageIds,
      limits: auditLimits,
    });
    const workIds = new Set([
      ...retrieved.ideas.flatMap((idea) => idea.works?.map((work) => work.nodus_id) ?? []),
      ...retrieved.passages.map((passage) => passage.nodus_id),
    ].filter(Boolean));
    sections.push({
      id: section.id,
      title: section.title,
      purpose: section.purpose,
      keyClaims: section.keyClaims ?? [],
      coverageQuestions,
      works: [...workIds],
      ideas: retrieved.ideas.map((idea) => ({
        id: idea.id,
        label: idea.label,
        summary: idea.summary,
        works: idea.works?.map((work) => ({ nodusId: work.nodus_id, title: work.title })) ?? [],
      })),
      passages: retrieved.passages.map((passage) => ({
        id: passage.id,
        nodusId: passage.nodus_id,
        label: passage.label,
        pageLabel: passage.pageLabel,
        summary: passage.summary,
        reason: passage.reason,
      })),
      evidencePacks: retrieved.evidencePacks ?? [],
    });
    console.log(`[retrieval] ${section.id}: ${retrieved.ideas.length} ideas, ${retrieved.passages.length} passages, ${workIds.size} works`);
  }

  const passageIds = sections.flatMap((section) => section.passages.map((passage) => passage.id));
  const auditedCoverageCount = new Set(sections.flatMap((section) => section.coverageQuestions ?? [])).size;
  const atomicEvidenceCandidates = sections
    .flatMap((section) => section.evidencePacks ?? [])
    .reduce((sum, pack) => sum + pack.passageIds.length, 0);
  const packedPassageIds = sections.flatMap((section) =>
    (section.evidencePacks ?? []).flatMap((pack) => pack.passageIds));
  const result = {
    generatedAt: new Date().toISOString(),
    isolation: { snapshotDir, realVaultOpened: false },
    providers: { generation: 'none', embeddings: 'openrouter/baai/bge-m3' },
    planPath,
    objective,
    coverageQuestions: auditedCoverageCount,
    planCoverageQuestions: coverageCount,
    limits: auditLimits,
    metrics: {
      sections: sections.length,
      uniqueIdeas: new Set(sections.flatMap((section) => section.ideas.map((idea) => idea.id))).size,
      uniquePassages: new Set(passageIds).size,
      uniqueWorks: new Set(sections.flatMap((section) => section.works)).size,
      repeatedPassageAssignments: passageIds.length - new Set(passageIds).size,
      atomicEvidenceCandidates,
      meanCandidatesPerQuestion: auditedCoverageCount > 0 ? atomicEvidenceCandidates / auditedCoverageCount : 0,
      evidencePackUniquePassages: new Set(packedPassageIds).size,
      evidencePackRepeatedAssignments: packedPassageIds.length - new Set(packedPassageIds).size,
    },
    sections,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  // Confirm the handle belongs to the clone before closing it. This assertion is
  // intentionally based on SQLite itself, not only on process configuration.
  const openedPath = getDb().prepare('PRAGMA database_list').all().find((row) => row.name === 'main')?.file;
  assert.equal(fs.realpathSync(openedPath), fs.realpathSync(path.join(snapshotDir, 'nodus.sqlite')));
  console.log(JSON.stringify({ outputPath, ...result.metrics, coverageQuestions: auditedCoverageCount, realVaultOpened: false }, null, 2));
} finally {
  try { closeDb(); } catch { /* best effort */ }
}

function inferObjective(file) {
  const name = path.basename(file);
  if (name.startsWith('tourism-plan-')) {
    return 'Analizar el turismo como aparato de propaganda y legitimación durante el franquismo, atendiendo a la organización, competencias y evolución de la Dirección General de Turismo y del Ministerio de Información y Turismo hasta la etapa de Manuel Fraga; la producción, catalogación y distribución gratuita de material fotográfico a autores y editoriales extranjeras; la creación de itinerarios, Paradores, guías, oficinas en el extranjero y campañas internacionales; y el debate historiográfico sobre la eficacia real de estos dispositivos, sin presuponer control total de la recepción.';
  }
  return '';
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-retrieval-audit',
      getAppPath: () => repoRoot,
      isPackaged: false,
      getName: () => 'Nodus',
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
    net: {},
  };
  Module._resolveFilename = function resolve(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  for (const ext of ['.ts', '.tsx']) {
    require.extensions[ext] = (module, filename) => {
      const source = fs.readFileSync(filename, 'utf8');
      const output = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
          jsx: ts.JsxEmit.ReactJSX,
        },
        fileName: filename,
      }).outputText;
      module._compile(output, filename);
    };
  }
}
