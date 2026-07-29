// Live, isolated audit of every external-AI contract owned by Primary Sources.
// Generation is restricted to Gemini Flash-Lite. Audio transcription is audited
// separately because the user explicitly forbids calling any other live model.
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
const modelId = 'gemini-3.5-flash-lite';
const reportPath = path.resolve(
  process.env.NODUS_PRIMARY_SOURCES_AI_REPORT
    || path.join(os.tmpdir(), 'nodus-primary-sources-ai-shadow-report.json'),
);

if (!process.argv.includes('--electron-primary-sources-ai-shadow')) {
  assert.ok(process.env.GEMINI_API_KEY?.trim(), 'Set GEMINI_API_KEY for this isolated run.');
  assert.ok(process.env.OPENROUTER_API_KEY?.trim(), 'Set OPENROUTER_API_KEY for this isolated run.');
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/verify-primary-sources-ai-shadow.mjs'), '--electron-primary-sources-ai-shadow'],
    {
      cwd: repoRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit',
    },
  );
  process.exit(0);
}

const apiKey = process.env.GEMINI_API_KEY?.trim();
const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
assert.ok(apiKey, 'Gemini key is available only to this isolated process.');
assert.ok(openRouterKey, 'OpenRouter key is available only to this isolated process.');
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-primary-sources-ai-shadow-'));
installRuntimeHooks(root);

let closeDb = () => undefined;
let clearKey = () => undefined;
const startedAt = Date.now();
try {
  const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const providers = require(path.join(repoRoot, 'electron/ai/providers.ts'));
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const demo = require(path.join(repoRoot, 'electron/db/primarySourcesDemoData.ts'));
  const archive = require(path.join(repoRoot, 'electron/db/archiveRepo.ts'));
  const evidence = require(path.join(repoRoot, 'electron/db/archiveEvidenceRepo.ts'));
  const proposalRepo = require(path.join(repoRoot, 'electron/db/archiveProposalsRepo.ts'));
  const textRepo = require(path.join(repoRoot, 'electron/db/archiveTextsRepo.ts'));
  const governanceRepo = require(path.join(repoRoot, 'electron/db/primarySourceGovernanceRepo.ts'));
  const governance = require(path.join(repoRoot, 'electron/primarySources/primarySourceGovernance.ts'));
  const archiveDiscovery = require(path.join(repoRoot, 'electron/archive/archiveDiscovery.ts'));
  const primarySourcesContext = require(path.join(repoRoot, 'electron/ai/primarySourcesChatContext.ts'));
  const nodi = require(path.join(repoRoot, 'electron/ai/nodiChat.ts'));
  const proposalAi = require(path.join(repoRoot, 'electron/ai/primarySourceProposals.ts'));
  const proposalPrompts = require(path.join(repoRoot, 'shared/primarySourceProposalPrompts.ts'));
  const toolkitPrompts = require(path.join(repoRoot, 'shared/primarySourceToolkitPrompts.ts'));
  const database = require(path.join(repoRoot, 'electron/db/database.ts'));
  ({ closeDb } = database);

  const vault = vaults.createVault('Primary Sources AI shadow', 'primary_sources');
  vaults.setActiveVault(vault.id);
  clearKey = () => {
    secrets.clearApiKey('gemini');
    secrets.clearApiKey('openrouter');
  };
  secrets.setApiKey('gemini', apiKey);
  secrets.setApiKey('openrouter', openRouterKey);
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  const [models, embeddingModels] = await Promise.all([
    providers.listModels('gemini', secrets.getApiKey('gemini')),
    providers.listEmbeddingModels('openrouter', secrets.getApiKey('openrouter')),
  ]);
  assert.ok(models.some((model) => model.id === modelId), `${modelId} is available.`);
  const embeddingModelId = 'baai/bge-m3';
  assert.ok(embeddingModels.some((candidate) => candidate.id === embeddingModelId), `${embeddingModelId} is available.`);
  const model = { provider: 'gemini', model: modelId };
  settingsRepo.updateSettings({
    uiLanguage: 'es',
    promptLanguage: 'es',
    modelSettingsMode: 'advanced',
    synthesisModel: model,
    extractionModel: model,
    visionModel: model,
    nodiModel: model,
    chatModel: model,
    embeddingProvider: 'openrouter',
    embeddingModel: embeddingModelId,
    chatReasoning: 'off',
  });
  assert.equal(demo.seedPrimarySourcesDemoData(), true, 'the complete fictional demo was seeded once.');

  const items = archive.listItems();
  assert.equal(items.length, 10, 'the audit starts from the complete ten-source demo.');
  const db = database.getDb();
  const itemIds = {
    letter: 'demo-ps-item-letter',
    minutes: 'demo-ps-item-minutes',
    photograph: 'demo-ps-item-photograph',
    newspaper: 'demo-ps-item-newspaper',
    register: 'demo-ps-item-register',
    restricted: 'demo-ps-item-restricted',
  };

  // The extraction and governed-toolkit prompts exist for all interface locales.
  const locales = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
  for (const locale of locales) {
    assert.ok(proposalPrompts.primarySourceProposalPrompt(locale).length > 250, `${locale} extraction prompt exists.`);
    assert.ok(toolkitPrompts.primarySourceToolkitPrompt(locale, 'critical_questions').length > 200, `${locale} toolkit prompt exists.`);
  }

  // External archive embeddings obey Primary Sources policy. This isolated audit
  // explicitly authorises open demo material; private and restricted sources remain
  // outside the embedding provider.
  governanceRepo.updatePrimarySourcePolicySettings({ requireExternalConfirmation: false });
  const indexResult = await archiveDiscovery.embedArchiveBacklog();
  const openSourceCount = Number(db.prepare(
    "SELECT COUNT(*) AS count FROM archive_item_profiles WHERE access_status='open'"
  ).get().count);
  assert.equal(archiveDiscovery.archiveIndexStatus().indexed, openSourceCount);
  assert.equal(indexResult.indexed, openSourceCount);
  assert.equal(indexResult.skipped, items.length - openSourceCount);
  const retrieved = await primarySourcesContext.buildPrimarySourcesChatContext(
    '¿Qué fuente documenta que la crecida dañó el puente y que Elías trajo cuerda?',
  );
  assert.equal(retrieved.summary.semanticRetrievalAvailable, true);
  assert.ok(retrieved.sources.some((source) => source.sourceId === itemIds.letter));
  assert.ok(retrieved.sources.every((source) => source.sourceId !== itemIds.register && source.sourceId !== itemIds.restricted));

  const nodiDeltas = [];
  const nodiAnswer = await nodi.streamNodiChat({
    messages: [{
      role: 'user',
      content: '¿Qué dice la carta de Clara sobre el puente y quién llevó cuerda? Cita la fuente exacta.',
    }],
    contexts: ['vault'],
    model,
  }, (delta) => { if (delta) nodiDeltas.push(delta); });
  assert.ok(nodiDeltas.length > 0, 'Nodi streams over the Primary Sources corpus.');
  assert.match(nodiAnswer, /puente|crecida/iu);
  assert.match(nodiAnswer, /Elías/iu);
  assert.match(nodiAnswer, /\]\(nodus:\/\/primary-source\//u, 'Nodi returns a validated source or excerpt link.');
  assert.doesNotMatch(nodiAnswer, /parentesco|árbol genealógico/iu, 'Primary Sources no longer receives genealogy context.');

  // Create one fully explicit, fictional excerpt. Extraction must only quarantine
  // proposals; it may not mutate people, places, events, relations or evidence.
  const auditExcerpt = evidence.createArchiveExcerpt({
    itemId: itemIds.minutes,
    fileId: null,
    textVersionId: null,
    segmentId: null,
    locatorDisplay: 'anexo de auditoría, línea 1',
    locator: { page: 1 },
    quotedText: 'El 18 de abril de 1894, en Carmona, Marta Solís declaró: «Mi hijo Tomás Solís entregó harina».',
    languageCode: 'es',
    description: 'Fragmento ficticio creado únicamente para auditar la extracción.',
    reviewStatus: 'reviewed',
    createdBy: 'ai_audit',
  });
  const canonicalCounts = () => Object.fromEntries(
    ['persons', 'places', 'events', 'relationships', 'record_evidence'].map((table) => [
      table,
      Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
    ]),
  );
  const beforeExtraction = canonicalCounts();
  const extracted = await proposalAi.extractPrimarySourceProposals({
    itemId: itemIds.minutes,
    excerptId: auditExcerpt.excerptId,
  });
  assert.ok(extracted.proposals.length >= 2, 'explicit facts produced reviewable proposals.');
  assert.equal(extracted.sourceEngine, 'gemini');
  assert.equal(extracted.sourceModel, modelId);
  assert.deepEqual(canonicalCounts(), beforeExtraction, 'extraction performs zero canonical writes.');
  assert.ok(extracted.proposals.every((proposal) =>
    proposal.status === 'pending'
    && proposal.excerptId === auditExcerpt.excerptId
    && proposal.sourceEngine === 'gemini'
    && proposal.sourceModel === modelId
  ), 'every AI result is pending, anchored and attributed.');

  const repeated = await proposalAi.extractPrimarySourceProposals({
    itemId: itemIds.minutes,
    excerptId: auditExcerpt.excerptId,
  });
  assert.ok(repeated.reused >= 1, 'an equivalent rerun reuses stable proposal identities.');
  assert.equal(
    new Set(proposalRepo.listEntityProposals({ itemId: itemIds.minutes }).map((proposal) => proposal.fingerprint)).size,
    proposalRepo.listEntityProposals({ itemId: itemIds.minutes }).length,
    'the review queue contains no duplicate stable fingerprints.',
  );
  assert.ok(
    repeated.proposals.every((proposal) => proposal.excerptId === auditExcerpt.excerptId),
    'any additional fact discovered by a later run remains anchored to the same excerpt.',
  );
  assert.deepEqual(canonicalCounts(), beforeExtraction, 'the deduplicated rerun also performs zero canonical writes.');

  const acceptedCandidate = extracted.proposals.find((proposal) => proposal.proposalKind === 'person');
  assert.ok(acceptedCandidate, 'the explicit excerpt includes a person proposal.');
  const accepted = proposalRepo.acceptEntityProposal(acceptedCandidate.proposalId, {
    reviewer: 'ai_audit_human',
    note: 'Explicit acceptance in isolated verification.',
  });
  assert.equal(accepted.idempotent, false);
  assert.equal(accepted.proposal.status, 'accepted');
  assert.equal(proposalRepo.acceptEntityProposal(acceptedCandidate.proposalId).idempotent, true, 'acceptance is idempotent.');

  const authorized = (operationId, selected) => ({
    operationId,
    itemIds: selected,
    processingLocation: 'external',
    authorizedItemIds: selected,
  });

  // Privacy is decided before context assembly. Neither explicit authorization nor
  // a configured model can override a hard restriction.
  const restrictedPreview = governance.previewPrimarySourceToolkitOperation(
    authorized('summarize_metadata', [itemIds.restricted]),
  );
  assert.equal(restrictedPreview.canRun, false);
  assert.deepEqual(restrictedPreview.blockedItemIds, [itemIds.restricted]);
  assert.equal(restrictedPreview.contextBytes, 0, 'blocked content contributes no outbound bytes.');

  const privateNeedsConsent = governance.previewPrimarySourceToolkitOperation({
    operationId: 'summarize_metadata',
    itemIds: [itemIds.register],
    processingLocation: 'external',
  });
  assert.equal(privateNeedsConsent.canRun, false);
  assert.deepEqual(privateNeedsConsent.confirmationItemIds, [itemIds.register]);
  const privateAuthorized = governance.previewPrimarySourceToolkitOperation(
    authorized('summarize_metadata', [itemIds.register]),
  );
  assert.equal(
    governanceRepo.getPrimarySourcePolicySettings().allowPrivateExternalAi,
    true,
    'the default vault policy permits private external AI only behind confirmation.',
  );
  assert.equal(privateAuthorized.canRun, true, 'private content needs both vault permission and item consent.');

  // Representative calls cover the shared text, comparison, vision and append-only
  // translation transports. Operation-specific prompts have deterministic tests.
  const summary = await governance.runPrimarySourceToolkitOperation(
    authorized('summarize_metadata', [itemIds.letter, itemIds.newspaper]),
  );
  assert.equal(summary.status, 'completed');
  assert.equal(summary.outputs.length, 2);
  assert.equal(summary.preview.provider, 'gemini');
  assert.equal(summary.preview.model, modelId);
  assert.equal(summary.preview.leavesDevice, true);
  assert.equal(summary.preview.textVersionsSent, 2, 'only the latest selected text version per source is sent.');
  assert.notEqual(
    summary.outputs[0].summary,
    summary.outputs[1].summary,
    'multi-selection results are isolated per source instead of copying one shared answer.',
  );

  const questions = await governance.runPrimarySourceToolkitOperation(
    authorized('critical_questions', [itemIds.letter]),
  );
  assert.equal(questions.status, 'completed');
  const questionsProposal = proposalRepo.getEntityProposal(questions.outputs[0].targetId);
  const criticalReview = String(questionsProposal?.payload?.result ?? '');
  assert.ok(criticalReview.length > 500, 'critical review returns a substantive result.');
  assert.match(
    criticalReview,
    /procedencia|fidelidad|transcrip|autor|crea|prop[oó]sit|audien|destinat|context|afirma|omite/iu,
    'critical review addresses provenance, source fidelity, authorship, purpose, audience or evidentiary limits.',
  );

  const compared = await governance.runPrimarySourceToolkitOperation(
    authorized('compare_documents', [itemIds.minutes, itemIds.newspaper]),
  );
  assert.equal(compared.status, 'completed');
  assert.equal(compared.outputs.length, 2, 'the comparison remains attached to both selected sources.');

  const beforeTranslation = textRepo.listArchiveTextVersions(itemIds.letter);
  const literalBefore = beforeTranslation.find((version) => version.kind === 'diplomatic');
  assert.ok(literalBefore);
  const translated = await governance.runPrimarySourceToolkitOperation(
    authorized('translate_text', [itemIds.letter]),
  );
  assert.equal(translated.status, 'completed');
  const afterTranslation = textRepo.listArchiveTextVersions(itemIds.letter);
  const translation = afterTranslation.find((version) => version.textVersionId === translated.outputs[0].targetId);
  assert.equal(translation.kind, 'translation');
  assert.equal(translation.parentVersionId, literalBefore.textVersionId);
  assert.equal(
    textRepo.getArchiveTextVersion(literalBefore.textVersionId).content,
    literalBefore.content,
    'translation never overwrites the literal source.',
  );

  const described = await governance.runPrimarySourceToolkitOperation(
    authorized('describe_image', [itemIds.photograph]),
  );
  assert.equal(described.status, 'completed');
  assert.equal(described.preview.filesSent, 1);
  assert.ok(described.outputs[0].summary.length > 40, 'Gemini vision returned a substantive description proposal.');
  assert.ok(
    !/se llama|su nombre es|identificad[oa] como/iu.test(described.outputs[0].summary),
    'the visual description does not identify a depicted person.',
  );

  const aiAudit = governanceRepo.listPrimarySourceAiAudit(50);
  const liveRuns = aiAudit.filter((entry) => entry.provider === 'gemini');
  assert.equal(liveRuns.length, 5);
  assert.ok(liveRuns.every((entry) =>
    entry.model === modelId
    && entry.processingLocation === 'external'
    && entry.leftDevice
    && entry.status === 'completed'
    && entry.contextBytes > 0
  ), 'every live operation has a complete, sanitized governance audit row.');
  assert.ok(
    proposalRepo.listEntityProposals({}).filter((proposal) => proposal.sourceEngine === 'gemini').every((proposal) =>
      proposal.status === 'pending' || proposal.status === 'accepted'
    ),
    'AI toolkit output never bypasses proposal review.',
  );

  const extractionAudit = db.prepare(
    "SELECT details_json FROM archive_audit_log WHERE action='proposal_extraction_completed' ORDER BY created_at DESC LIMIT 1"
  ).get();
  assert.equal(JSON.parse(extractionAudit.details_json).canonicalWrites, 0);

  const report = {
    isolated: true,
    cleanedAfterRun: true,
    provider: 'gemini',
    model: modelId,
    embeddingModel: embeddingModelId,
    demoSources: items.length,
    promptLanguages: locales.length,
    extraction: {
      proposals: extracted.proposals.length,
      additionalStableFactsOnRerun: repeated.created,
      duplicateRerunReused: repeated.reused,
      duplicateFingerprints: 0,
      canonicalWrites: 0,
      explicitlyAccepted: 1,
    },
    privacy: {
      restrictedBlocked: restrictedPreview.blockedItemIds.length,
      restrictedOutboundBytes: restrictedPreview.contextBytes,
      privateRequiresVaultPermissionAndConsent: privateAuthorized.canRun,
    },
    toolkit: {
      liveRuns: liveRuns.length,
      textRuns: 3,
      comparisonRuns: 1,
      visionRuns: 1,
      appendOnlyTranslations: 1,
    },
    retrievalAndChat: {
      indexedOpenSources: openSourceCount,
      blockedFromExternalIndex: items.length - openSourceCount,
      semanticRetrievalAvailable: retrieved.summary.semanticRetrievalAvailable,
      groundedPrimarySourceLink: true,
      streamedDeltas: nodiDeltas.length,
    },
    diarization: {
      liveCallSkippedByModelRestriction: true,
      contractVerifiedSeparately: true,
    },
    durationMs: Date.now() - startedAt,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  console.log(`Sanitized report: ${reportPath}`);
  console.log('Live isolated Primary Sources AI verification passed.');
} finally {
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try { clearKey(); } catch { /* the isolated profile is removed below */ }
  try { closeDb(); } catch { /* the database may not have opened */ }
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
      getVersion: () => '0.0.0-primary-sources-ai-shadow',
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
        moduleResolution: ts.ModuleResolutionKind.Node10,
        esModuleInterop: true,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
