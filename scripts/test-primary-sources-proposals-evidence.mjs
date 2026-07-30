import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource } from './ipc-channel-census.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-primary-sources-proposals-test')) {
  const [view, proposalRepo, extraction, prompt, shared, preload, ipc, schema, sync] = [
    'src/views/PrimarySourceDossierView.tsx',
    'electron/db/archiveProposalsRepo.ts',
    'electron/ai/primarySourceProposals.ts',
    'shared/primarySourceProposalPrompts.ts',
    '@api',
    '@bridge',
    '@main',
    'electron/db/migrations.ts',
    'electron/db/syncTables.ts',
  ].map((file) => readSource(file));

  for (const marker of [
    'primary-source-evidence-workspace',
    'Cola de revisión humana',
    'Datos propuestos editables',
    'Papel de la evidencia',
    'Registro de evidencia',
    'Resoluciones reversibles',
    'Aceptar y crear evidencia',
  ]) assert.ok(view.includes(marker), `phase 6 UI contains ${marker}`);
  assert.ok(Number(schema.match(/SCHEMA_VERSION = (\d+)/)[1]) >= 112,
    'the proposals/evidence migration is applied');
  assert.match(schema, /archive_proposal_decisions/);
  assert.match(schema, /idx_archive_proposal_one_acceptance/);
  assert.match(sync, /'archive_proposal_decisions'/);
  assert.match(proposalRepo, /db\.transaction/);
  assert.match(proposalRepo, /original_payload_json/);
  assert.match(proposalRepo, /createPrimarySourceEvidence/);
  assert.match(proposalRepo, /identity_status='provisional'/);
  assert.match(extraction, /canonicalWrites: 0/);
  assert.match(extraction, /createEntityProposal/);
  assert.doesNotMatch(extraction, /createPerson\(/, 'AI extraction does not create canonical persons');
  assert.doesNotMatch(extraction, /createEvent\(/, 'AI extraction does not create canonical events');

  for (const method of [
    'extractPrimarySourceProposals',
    'acceptPrimarySourceProposal',
    'decidePrimarySourceProposal',
    'revertPrimarySourceEntityResolution',
  ]) {
    assert.ok(shared.includes(method), `${method} is typed`);
    assert.ok(preload.includes(method), `${method} is exposed`);
  }
  assert.match(ipc, /primarySources:proposals:extract/);
  assert.match(ipc, /primarySources:proposals:accept/);
  assert.match(ipc, /primarySources:proposals:decide/);
  assert.match(ipc, /primarySources:resolutions:revert/);

  const buildDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-primary-proposals-i18n-'));
  try {
    const evidenceOutput = path.join(buildDir, 'evidence.cjs');
    const promptsOutput = path.join(buildDir, 'prompts.cjs');
    execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
      path.join(repoRoot, 'src/i18n.primarySourcesEvidence.ts'),
      '--bundle', '--platform=node', '--format=cjs', `--outfile=${evidenceOutput}`,
    ], { cwd: repoRoot, stdio: 'inherit' });
    execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
      path.join(repoRoot, 'shared/primarySourceProposalPrompts.ts'),
      '--bundle', '--platform=node', '--format=cjs', `--outfile=${promptsOutput}`,
    ], { cwd: repoRoot, stdio: 'inherit' });
    const translations = require(evidenceOutput).PRIMARY_SOURCES_EVIDENCE_TRANSLATIONS;
    const reference = Object.keys(translations.en).sort();
    assert.ok(reference.length >= 60, 'phase 6 UI translation catalogue is substantive');
    for (const language of ['en', 'fr', 'de', 'pt', 'ptBR', 'it', 'tr']) {
      assert.deepEqual(Object.keys(translations[language]).sort(), reference, `${language} has every phase 6 UI key`);
      assert.ok(Object.values(translations[language]).every(Boolean), `${language} has no blank phase 6 UI copy`);
    }
    const prompts = require(promptsOutput).PRIMARY_SOURCE_PROPOSAL_PROMPTS;
    for (const language of ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr']) {
      assert.ok(prompts[language]?.length > 900, `${language} has a substantive extraction prompt`);
      assert.match(prompts[language], /"persons"/);
      assert.match(prompts[language], /"relations"/);
    }
  } finally {
    await rm(buildDir, { recursive: true, force: true });
  }

  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-primary-sources-proposals-evidence.mjs'), '--electron-primary-sources-proposals-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-primary-proposals-'));
installRuntimeHooks(root);

try {
  const archive = require(path.join(repoRoot, 'electron/db/archiveRepo.ts'));
  const primary = require(path.join(repoRoot, 'electron/db/primarySourcesArchiveRepo.ts'));
  const textRepo = require(path.join(repoRoot, 'electron/db/archiveTextsRepo.ts'));
  const evidenceRepo = require(path.join(repoRoot, 'electron/db/archiveEvidenceRepo.ts'));
  const proposals = require(path.join(repoRoot, 'electron/db/archiveProposalsRepo.ts'));
  const entities = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const { getDb, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/database.ts'));

  assert.ok(SCHEMA_VERSION >= 112);
  const item = archive.createItem({
    title: 'Padrón municipal de 1894',
    kind: 'text',
    fileName: 'padron.txt',
    mimeType: 'text/plain',
    blob: Buffer.from('preserved', 'utf8'),
  });
  primary.ensurePrimarySourceProjection(item.itemId, {
    title: 'Padrón municipal de 1894',
    referenceCode: 'AMP/PAD/1894/7',
  });
  const version = textRepo.createPrimarySourceTextVersion({
    itemId: item.itemId,
    kind: 'transcription',
    languageCode: 'es',
    content: 'Antonio Pérez, padre de Clara Pérez, residía en Cádiz el 3 de mayo de 1894.',
    status: 'reviewed',
    createdBy: 'researcher',
  }).version;
  const excerpt = evidenceRepo.createStableArchiveExcerpt({
    itemId: item.itemId,
    textVersionId: version.textVersionId,
    startOffset: 0,
    endOffset: version.content.length,
    locatorDisplay: 'fol. 7r, líneas 1–2',
    reviewStatus: 'reviewed',
    createdBy: 'researcher',
  });
  const counts = () => ({
    persons: getDb().prepare('SELECT COUNT(*) c FROM persons').get().c,
    places: getDb().prepare('SELECT COUNT(*) c FROM places').get().c,
    events: getDb().prepare('SELECT COUNT(*) c FROM events').get().c,
    relationships: getDb().prepare('SELECT COUNT(*) c FROM relationships').get().c,
    evidence: getDb().prepare("SELECT COUNT(*) c FROM record_evidence WHERE source_kind='archive'").get().c,
  });

  const beforeAi = counts();
  const personInput = {
    itemId: item.itemId,
    excerptId: excerpt.excerptId,
    proposalKind: 'person',
    payload: {
      displayName: 'Antonio Perez',
      originalLabel: 'Antonio Pérez',
      sex: 'male',
      quote: excerpt.quotedText,
      location: excerpt.locatorDisplay,
    },
    matchedTargetId: null,
    confidence: 0.91,
    rationale: 'explicit_person_mention',
    sourceEngine: 'test-provider',
    sourceModel: 'test-model',
  };
  const personProposal = proposals.createEntityProposal(personInput);
  const samePersonProposal = proposals.createEntityProposal(personInput);
  assert.equal(samePersonProposal.proposalId, personProposal.proposalId, 'same extraction fingerprint is reused');
  const wordingVariant = proposals.createEntityProposal({
    ...personInput,
    payload: { ...personInput.payload, quote: 'Redacción equivalente de otra ejecución.', location: 'fol. 7r' },
    dedupeKey: 'person:antonio perez',
  });
  const wordingVariantAgain = proposals.createEntityProposal({
    ...personInput,
    payload: { ...personInput.payload, quote: 'Otra redacción no determinista.', location: 'folio 7 recto' },
    dedupeKey: 'person:antonio perez',
  });
  assert.equal(wordingVariantAgain.proposalId, wordingVariant.proposalId, 'stable extractor identity deduplicates model wording changes');
  assert.deepEqual(counts(), beforeAi, 'creating/rerunning AI proposals never changes canonical records');

  const rejectedInput = { ...personInput, payload: { ...personInput.payload, displayName: 'Fantasma' } };
  const rejected = proposals.createEntityProposal(rejectedInput);
  proposals.decideEntityProposal(rejected.proposalId, 'rejected', {
    note: 'Lectura dudosa',
    payload: { ...rejected.payload, displayName: 'Lectura dudosa' },
  });
  const rejectedAgain = proposals.createEntityProposal(rejectedInput);
  assert.equal(rejectedAgain.proposalId, rejected.proposalId);
  assert.equal(rejectedAgain.status, 'rejected', 'an AI rerun never resets a rejected decision');
  const rejectionDecision = proposals.listProposalDecisions({ proposalId: rejected.proposalId })[0];
  assert.equal(rejectionDecision.originalPayload.displayName, 'Fantasma');
  assert.equal(rejectionDecision.decidedPayload.displayName, 'Lectura dudosa');

  const failureProposal = proposals.createEntityProposal({
    ...personInput,
    payload: { ...personInput.payload, displayName: 'Rollback Person' },
  });
  const beforeFailure = counts();
  getDb().exec(`
    CREATE TRIGGER test_reject_archive_evidence
    BEFORE INSERT ON record_evidence
    WHEN NEW.source_kind='archive'
    BEGIN SELECT RAISE(ABORT, 'forced evidence failure'); END;
  `);
  assert.throws(
    () => proposals.acceptEntityProposal(failureProposal.proposalId, { evidenceRole: 'supports' }),
    /forced evidence failure/
  );
  getDb().exec('DROP TRIGGER test_reject_archive_evidence');
  assert.deepEqual(counts(), beforeFailure, 'entity creation rolls back when evidence creation fails');
  assert.equal(proposals.getEntityProposal(failureProposal.proposalId).status, 'pending');
  assert.equal(proposals.listProposalDecisions({ proposalId: failureProposal.proposalId }).length, 0);

  const acceptedPerson = proposals.acceptEntityProposal(personProposal.proposalId, {
    payload: { ...personProposal.payload, displayName: 'Antonio Pérez' },
    evidenceRole: 'supports',
    certainty: 0.93,
    note: 'Nombre comprobado en la imagen.',
  });
  assert.equal(acceptedPerson.idempotent, false);
  assert.equal(acceptedPerson.evidence.targetKind, 'person');
  assert.equal(acceptedPerson.evidence.excerptId, excerpt.excerptId);
  assert.equal(acceptedPerson.evidence.quote, excerpt.quotedText);
  assert.equal(
    getDb().prepare('SELECT identity_status FROM persons WHERE person_id=?').get(acceptedPerson.decision.materializedTargetId).identity_status,
    'provisional',
    'new extracted persons remain provisional'
  );
  assert.equal(
    getDb().prepare('SELECT COUNT(*) c FROM archive_person_mentions WHERE person_id=?').get(acceptedPerson.decision.materializedTargetId).c,
    1
  );
  assert.equal(acceptedPerson.decision.originalPayload.displayName, 'Antonio Perez');
  assert.equal(acceptedPerson.decision.decidedPayload.displayName, 'Antonio Pérez');
  const afterPerson = counts();
  const acceptedPersonRetry = proposals.acceptEntityProposal(personProposal.proposalId, {
    evidenceRole: 'contradicts',
  });
  assert.equal(acceptedPersonRetry.idempotent, true);
  assert.equal(acceptedPersonRetry.decision.decisionId, acceptedPerson.decision.decisionId);
  assert.deepEqual(counts(), afterPerson, 'repeated acceptance creates neither entity nor evidence');

  const existingPlace = entities.findOrCreatePlace('Cádiz', 'municipality');
  const placeProposal = proposals.createEntityProposal({
    itemId: item.itemId,
    excerptId: excerpt.excerptId,
    proposalKind: 'place',
    payload: { name: 'Cadiz', originalLabel: 'Cádiz', quote: excerpt.quotedText },
    matchedTargetId: existingPlace.placeId,
    confidence: 0.88,
    rationale: 'explicit_place_mention',
    sourceEngine: 'test-provider',
    sourceModel: 'test-model',
  });
  const acceptedPlace = proposals.acceptEntityProposal(placeProposal.proposalId, {
    matchedTargetId: existingPlace.placeId,
    evidenceRole: 'mentions',
  });
  assert.equal(acceptedPlace.decision.materializedTargetId, existingPlace.placeId);
  assert.equal(acceptedPlace.evidence.evidenceRole, 'mentions');
  const resolution = proposals.listEntityResolutions(item.itemId)[0];
  assert.equal(resolution.targetEntityId, existingPlace.placeId);
  assert.equal(resolution.status, 'active');
  assert.equal(proposals.revertEntityResolution(resolution.resolutionId, item.itemId).status, 'reverted');

  const dateProposal = proposals.createEntityProposal({
    itemId: item.itemId,
    excerptId: excerpt.excerptId,
    proposalKind: 'date',
    payload: { date: '3 de mayo de 1894', context: 'Residencia documentada' },
    matchedTargetId: null,
    confidence: null,
    rationale: 'explicit_event_date',
    sourceEngine: 'test-provider',
    sourceModel: 'test-model',
  });
  const acceptedDate = proposals.acceptEntityProposal(dateProposal.proposalId, {
    evidenceRole: 'contextualizes',
  });
  assert.equal(acceptedDate.evidence.targetKind, 'event');
  assert.equal(entities.getEvent(acceptedDate.decision.materializedTargetId).date, '3 de mayo de 1894');

  const clara = entities.createPerson({ displayName: 'Clara Pérez', sex: 'female' });
  const relationProposal = proposals.createEntityProposal({
    itemId: item.itemId,
    excerptId: excerpt.excerptId,
    proposalKind: 'relation',
    payload: {
      subject: 'Antonio Pérez',
      subjectTargetId: acceptedPerson.decision.materializedTargetId,
      relation: 'father',
      object: 'Clara Pérez',
      objectTargetId: clara.personId,
      quote: 'Antonio Pérez, padre de Clara Pérez',
    },
    matchedTargetId: null,
    confidence: 1,
    rationale: 'explicit_kinship_claim',
    sourceEngine: 'test-provider',
    sourceModel: 'test-model',
  });
  const acceptedRelation = proposals.acceptEntityProposal(relationProposal.proposalId, {
    evidenceRole: 'supports',
  });
  assert.equal(acceptedRelation.evidence.targetKind, 'relationship');
  const relationship = getDb().prepare('SELECT * FROM relationships WHERE rel_id=?').get(acceptedRelation.decision.materializedTargetId);
  assert.equal(relationship.type, 'parent');
  assert.equal(relationship.from_person, acceptedPerson.decision.materializedTargetId);
  assert.equal(relationship.to_person, clara.personId);

  const eventProposal = proposals.createEntityProposal({
    itemId: item.itemId,
    excerptId: excerpt.excerptId,
    proposalKind: 'event',
    payload: {
      type: 'residence',
      label: 'Residencia en Cádiz',
      date: '3 de mayo de 1894',
      placeId: existingPlace.placeId,
      participants: [{ name: 'Antonio Pérez', targetId: acceptedPerson.decision.materializedTargetId, role: 'principal' }],
    },
    matchedTargetId: null,
    confidence: 0.85,
    rationale: 'explicit_event',
    sourceEngine: 'test-provider',
    sourceModel: 'test-model',
  });
  const acceptedEvent = proposals.acceptEntityProposal(eventProposal.proposalId, {
    evidenceRole: 'contradicts',
    note: 'Se conserva como contradicción para contrastar otra fecha.',
  });
  assert.equal(acceptedEvent.evidence.evidenceRole, 'contradicts');
  assert.equal(entities.getEvent(acceptedEvent.decision.materializedTargetId).participants.length, 1);

  const dossier = primary.getPrimarySourceDossier(item.itemId);
  assert.ok(dossier.proposals.length >= 7);
  assert.ok(dossier.proposalDecisions.length >= 6);
  assert.ok(dossier.evidence.length >= 5);
  assert.ok(dossier.proposalCandidates.some((set) => set.proposalId === placeProposal.proposalId));
  assert.ok(dossier.resolutions.some((entry) => entry.resolutionId === resolution.resolutionId && entry.status === 'reverted'));
  for (const decision of dossier.proposalDecisions.filter((entry) => entry.decision === 'accepted')) {
    assert.ok(dossier.evidence.some((entry) => entry.evidenceId === decision.evidenceId), 'decision links forward to evidence');
    assert.ok(dossier.proposals.some((entry) => entry.proposalId === decision.proposalId), 'decision links back to proposal');
  }
  assert.ok(dossier.history.some((event) => event.action === 'proposal_materialized'));
  assert.ok(dossier.history.some((event) => event.action === 'proposal_decided'));
  assert.ok(dossier.history.some((event) => event.action === 'entity_resolution_reverted'));
  assert.deepEqual(getDb().pragma('foreign_key_check'), []);

  console.log('Primary Sources proposals and transactional evidence phase test passed!');
} finally {
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
      getVersion: () => '0.0.0-test',
      getAppPath: () => repoRoot,
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(String(value), 'utf8'),
      decryptString: (value) => Buffer.from(value).toString('utf8'),
    },
    protocol: {
      registerSchemesAsPrivileged: () => undefined,
      handle: () => undefined,
    },
    dialog: {},
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
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
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
