import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-prosop-sources-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-prosopography-sources.mjs'), '--electron-prosop-sources-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' },
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-prosop-sources-'));
installRuntimeHooks(root);

try {
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const sources = require(path.join(repoRoot, 'electron/db/prosopSourcesRepo.ts'));
  const capture = require(path.join(repoRoot, 'electron/db/prosopCaptureRepo.ts'));
  const observations = require(path.join(repoRoot, 'electron/db/prosopFactoidsRepo.ts'));
  const identities = require(path.join(repoRoot, 'electron/db/prosopIdentityRepo.ts'));
  const studyRepo = require(path.join(repoRoot, 'electron/db/prosopStudyRepo.ts'));
  const questionnaireRepo = require(path.join(repoRoot, 'electron/db/prosopQuestionnaireRepo.ts'));
  const memberships = require(path.join(repoRoot, 'electron/db/prosopMembershipRepo.ts'));
  const analyses = require(path.join(repoRoot, 'electron/db/prosopAnalysisRepo.ts'));
  const networks = require(path.join(repoRoot, 'electron/db/prosopNetworksRepo.ts'));
  const search = require(path.join(repoRoot, 'electron/db/prosopSearchRepo.ts'));
  const interchange = require(path.join(repoRoot, 'electron/db/prosopInterchangeRepo.ts'));
  const prompts = require(path.join(repoRoot, 'shared/prosopographyPrompts.ts'));
  const demo = require(path.join(repoRoot, 'electron/db/prosopDemoRepo.ts'));
  const parser = require(path.join(repoRoot, 'shared/prosopographyCapture.ts'));

  const parsed = parser.parseProsopDelimited('nombre;folio;nota\r\n"Ana; María";12r;"dijo ""sí"""\r\n');
  assert.deepEqual(parsed.headers, ['nombre', 'folio', 'nota']);
  assert.equal(parsed.rows[0].nombre, 'Ana; María');
  assert.equal(parsed.rows[0].nota, 'dijo "sí"');

  getDb().exec('SAVEPOINT prosop_demo_test');
  const seededDemo = demo.seedProsopDemo();
  assert.equal(seededDemo.seeded, true);
  assert.equal(demo.seedProsopDemo().seeded, false, 'demo seed is idempotent');
  assert.equal(getDb().prepare("SELECT COUNT(*) AS c FROM prosop_factoids WHERE status='reviewed'").get().c, 1);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS c FROM prosop_cohorts WHERE kind='frozen'").get().c, 1);
  getDb().exec('ROLLBACK TO prosop_demo_test');
  getDb().exec('RELEASE prosop_demo_test');

  const source = sources.saveProsopSource({
    title: 'Actas de la Academia', sourceKind: 'acta', citation: 'AHM, Actas 12',
    repository: 'Archivo Histórico', referenceCode: 'AHM-12',
    date: { display: '1640–1645', startSort: 1640, endSort: 1645 },
    coverageNotes: 'Sesiones conservadas de forma desigual.',
    reliabilityNotes: 'Copia coetánea.', accessStatus: 'open',
  });
  const segment = sources.saveProsopSourceSegment({
    sourceId: source.sourceId, locatorDisplay: 'fol. 12r',
    locator: { folio: '12r' }, quotedText: 'Doña Ana leyó sus versos.',
    transcriptionStatus: 'literal', language: 'es',
  });
  assert.equal(segment.quotedText, 'Doña Ana leyó sus versos.');

  const template = capture.saveProsopCaptureTemplate({
    name: 'Actas con folio', sourceKind: 'acta',
    fields: [{ key: 'nombre', label: 'Nombre literal' }, { key: 'folio', label: 'Folio' }],
    mapping: { locator: 'folio', literalName: 'nombre' },
  });
  const text = 'nombre,folio,ocupación\nAna de Carvajal,12r,poeta\nAna de Carvajal,13v,secretaria\n';
  const first = capture.importProsopDelimited({
    sourceId: source.sourceId, templateId: template.templateId,
    fileName: 'actas.csv', text, locatorColumn: 'folio', createdBy: 'investigadora',
  });
  assert.equal(first.status, 'staging');
  assert.equal(first.rows.length, 2);
  assert.equal(first.rows[0].status, 'pending');
  assert.equal(first.rows[0].raw.nombre, 'Ana de Carvajal');
  assert.equal(first.rows[0].locatorDisplay, '12r');
  assert.equal(getDb().prepare('SELECT COUNT(*) AS c FROM prosop_person_profiles').get().c, 0,
    'capturing mentions must not create or merge persons');
  assert.equal(getDb().prepare('SELECT COUNT(*) AS c FROM prosop_factoids').get().c, 0,
    'staging rows must not become observations without review');

  const second = capture.importProsopDelimited({
    sourceId: source.sourceId, templateId: template.templateId,
    fileName: 'actas-copy.csv', text, locatorColumn: 'folio',
  });
  assert.equal(second.contentHash, first.contentHash, 'content identity uses a stable SHA-256 hash');
  const reviewed = capture.reviewProsopCaptureRow(first.rows[0].captureRowId, 'accepted');
  assert.equal(reviewed.status, 'accepted');
  assert.equal(capture.getProsopSourcesWorkspace().batches.find((item) => item.batchId === first.batchId).acceptedCount, 1);
  assert.throws(() => sources.deleteProsopSource(source.sourceId), /lotes/);

  const documented = observations.saveProsopFactoid({
    sourceId: source.sourceId, sourceSegmentId: segment.segmentId, captureRowId: first.rows[0].captureRowId,
    factoidKind: 'occupation', summary: 'Dos ocupaciones atribuidas en el mismo pasaje',
    status: 'reviewed', reviewedBy: 'investigadora', extractionCertainty: 'high',
    statements: [
      {
        statementType: 'occupation', literalValue: 'poeta', value: { kind: 'text', text: 'Poeta' },
        readingCertainty: 'high', sourceAssertionCertainty: 'high', interpretationCertainty: 'medium',
        entities: [{ entityKind: 'person', entityId: 'person_ana', role: 'subject', position: 0 }],
      },
      {
        statementType: 'occupation', literalValue: 'secretaria', value: { kind: 'text', text: 'Secretaria' },
        readingCertainty: 'high', sourceAssertionCertainty: 'medium', interpretationCertainty: 'medium',
        entities: [{ entityKind: 'person', entityId: 'person_ana', role: 'subject', position: 0 }],
      },
    ],
  });
  assert.equal(documented.statements.length, 2, 'one passage creates several atomic statements');
  assert.equal(documented.statements[0].literalValue, 'poeta', 'literal is preserved beside normalized value');
  assert.equal(documented.sourceTitle, source.title);
  assert.equal(documented.locatorDisplay, 'fol. 12r');
  assert.equal(documented.status, 'reviewed');
  assert.throws(() => observations.saveProsopFactoid({
    sourceId: source.sourceId, sourceSegmentId: 'wrong-segment', factoidKind: 'occupation',
    statements: [{ statementType: 'occupation', literalValue: 'poeta', value: { kind: 'text', text: 'Poeta' } }],
  }), /segmento/);
  assert.throws(() => observations.saveProsopFactoid({
    sourceId: source.sourceId, sourceSegmentId: segment.segmentId, factoidKind: 'occupation',
    statements: [{ statementType: 'occupation', literalValue: '', value: { kind: 'text', text: 'Poeta' } }],
  }), /literal/);
  const missingValue = observations.saveProsopMissingValue({
    personId: 'person_ana', variableId: 'variable_birth', questionnaireVersionId: 'qv_1',
    reason: 'source_silent', sourceScope: { sourceIds: [source.sourceId] }, note: 'Revisadas las actas.',
  });
  assert.equal(missingValue.reason, 'source_silent');
  const resolution = observations.saveProsopResolution({
    personId: 'person_ana', variableId: 'variable_occupation', resolutionKind: 'preferred',
    resolvedValue: { kind: 'text', text: 'Poeta' }, statementIds: documented.statements.map((item) => item.statementId),
    rationale: 'La mención de poeta es contemporánea y explícita.', status: 'reviewed',
  });
  assert.equal(resolution.statementIds.length, 2, 'resolution cites alternatives instead of deleting them');
  assert.equal(observations.getProsopObservationsWorkspace().factoids[0].statements.length, 2,
    'contradictory alternatives remain after resolution');

  const anaPoet = identities.createProsopPerson({ displayName: 'Ana de Carvajal', preferredNameBasis: 'Actas, fol. 12r' });
  const anaMerchant = identities.createProsopPerson({ displayName: 'Ana de Carvajal', preferredNameBasis: 'Padrón, fol. 8v' });
  const variant = identities.saveProsopNameAttestation({
    sourceId: source.sourceId, sourceSegmentId: segment.segmentId, factoidId: documented.factoidId,
    literalName: 'D.ª Ana Caruajal', context: 'Lee versos en la sesión.', roleOrTitle: 'poeta',
  });
  const homonym = identities.saveProsopNameAttestation({
    literalName: 'Ana de Carvajal', context: 'Mercadera avecindada.', roleOrTitle: 'mercadera',
  });
  assert.ok(identities.searchProsopIdentityCandidates('Ana Caruajal').length >= 2,
    'candidate search surfaces historical spelling variants without merging');
  assert.equal(identities.getProsopIdentityWorkspace().persons.filter((item) => item.displayName === 'Ana de Carvajal').length, 2,
    'homonyms remain separate people');
  const same = identities.saveProsopIdentityHypothesis({
    leftKind: 'attestation', leftId: variant.attestationId, rightKind: 'person', rightId: anaPoet.personId,
    relation: 'same_as', rationale: 'Mismo contexto institucional, título y secuencia documental.',
    factoidIds: [documented.factoidId],
  });
  identities.decideProsopIdentityHypothesis(same.hypothesisId, 'accepted', 'investigadora');
  assert.equal(identities.getProsopIdentityWorkspace().attestations.find((item) => item.attestationId === variant.attestationId).personId, anaPoet.personId);
  const different = identities.saveProsopIdentityHypothesis({
    leftKind: 'attestation', leftId: homonym.attestationId, rightKind: 'person', rightId: anaPoet.personId,
    relation: 'different_from', rationale: 'Oficio, parroquia y unidad doméstica incompatibles.',
  });
  identities.decideProsopIdentityHypothesis(different.hypothesisId, 'accepted', 'investigadora');
  assert.equal(identities.getProsopIdentityWorkspace().attestations.find((item) => item.attestationId === homonym.attestationId).personId, null,
    'different-from never attaches the homonym');
  identities.saveProsopNameAttestation({ literalName: 'Ana C.', personId: anaMerchant.personId, context: 'Mención abreviada.' });
  const mergeId = identities.mergeProsopPersons(anaPoet.personId, anaMerchant.personId, 'Fusión de prueba reversible.', 'investigadora');
  assert.equal(identities.getProsopIdentityWorkspace().persons.find((item) => item.personId === anaMerchant.personId).identityStatus, 'merged');
  identities.reverseProsopPersonMerge(mergeId, 'investigadora');
  assert.equal(identities.getProsopIdentityWorkspace().persons.find((item) => item.personId === anaMerchant.personId).identityStatus, 'resolved');
  identities.saveProsopAuthorityId({
    entityKind: 'person', entityId: anaPoet.personId, scheme: 'VIAF', externalId: '12345',
    uri: 'https://viaf.org/viaf/12345', labelSnapshot: 'Ana de Carvajal', factoidId: documented.factoidId,
  });
  const academy = identities.saveProsopOrganization({
    preferredName: 'Academia de Madrid', kind: 'academy',
    names: [{ id: 'name_academy', name: 'Academia Matritense', kind: 'variant', language: 'es', validFrom: null, validTo: null }],
  });
  assert.equal(academy.names[0].name, 'Academia Matritense');

  studyRepo.updateProsopStudy({
    populationDefinition: 'Personas con actividad documentada en la Academia de Madrid.',
    researchQuestion: '¿Cómo se articuló la actividad de sus integrantes?',
  });
  const methodDraft = studyRepo.createProsopMethodologyDraft('investigadora');
  const criteria = studyRepo.replaceProsopCriteria(methodDraft.versionId, [
    { kind: 'include', label: 'Actividad documentada en la Academia', required: true, weight: 1 },
  ]);
  studyRepo.publishProsopMethodology(methodDraft.versionId, 'Criterios del corpus', 'investigadora');
  const questionnaireDraft = questionnaireRepo.createProsopQuestionnaireDraft({ title: 'Cuestionario de prueba' });
  const occupationVariable = questionnaireRepo.saveProsopVariableRevision(questionnaireDraft.questionnaireVersionId, {
    key: 'occupation', label: 'Ocupación', question: '¿Qué ocupación documenta la fuente?', valueType: 'text',
  });
  questionnaireRepo.publishProsopQuestionnaire(questionnaireDraft.questionnaireVersionId, 'Primera versión', 'investigadora');
  memberships.saveProsopMembership({
    personId: anaPoet.personId, methodologyVersionId: methodDraft.versionId, status: 'included',
    decision: 'included', rationale: 'Cumple el criterio con evidencia directa.', decidedBy: 'investigadora',
    assessments: [{ criterionId: criteria[0].criterionId, result: 'met', factoidId: documented.factoidId }],
  });
  memberships.saveProsopMembership({
    personId: anaMerchant.personId, methodologyVersionId: methodDraft.versionId, status: 'excluded',
    decision: 'excluded', rationale: 'No consta actividad en la Academia.', decidedBy: 'investigadora',
    assessments: [{ criterionId: criteria[0].criterionId, result: 'not_met', note: 'Homónima del padrón.' }],
  });
  const dynamic = memberships.saveProsopCohort({
    name: 'Miembros incluidos', kind: 'dynamic',
    filter: { conjunction: 'and', rules: [{ field: 'membershipStatus', operator: 'eq', value: 'included' }] },
    methodologyVersionId: methodDraft.versionId, questionnaireVersionId: questionnaireDraft.questionnaireVersionId,
  });
  assert.deepEqual(dynamic.memberIds, [anaPoet.personId]);
  const frozen = memberships.saveProsopCohort({
    name: 'Corte publicado', kind: 'frozen',
    filter: { conjunction: 'and', rules: [{ field: 'membershipStatus', operator: 'eq', value: 'included' }] },
    methodologyVersionId: methodDraft.versionId, questionnaireVersionId: questionnaireDraft.questionnaireVersionId,
  });
  assert.ok(frozen.frozenAt);
  assert.throws(() => memberships.saveProsopCohort({ ...frozen, name: 'Modificada' }), /inmutable/);
  assert.equal(memberships.getProsopMembershipWorkspace().coverage.excluded, 1);
  const analyzable = observations.saveProsopFactoid({
    sourceId: source.sourceId, sourceSegmentId: segment.segmentId, factoidKind: 'occupation', status: 'reviewed',
    statements: [{
      statementType: 'occupation', variableId: occupationVariable.variableId, variableRevisionId: occupationVariable.revisionId,
      literalValue: 'poeta', value: { kind: 'text', text: 'Poeta' },
      entities: [{ entityKind: 'person', entityId: anaPoet.personId, role: 'subject', position: 0 }],
    }],
  });
  assert.equal(analyzable.status, 'reviewed');
  const frequencyRun = analyses.runProsopAnalysis({
    title: 'Ocupaciones', analysisKind: 'frequency', variableIds: [occupationVariable.variableId],
  });
  assert.equal(frequencyRun.populationCount, 1);
  assert.equal(frequencyRun.includedCount, 1);
  assert.equal(frequencyRun.result.frequency.knownN, 1);
  assert.equal(frequencyRun.result.frequency.items[0].personIds[0], anaPoet.personId, 'result retains drill-down cases');
  assert.ok(frequencyRun.inputFingerprint);
  const repeatRun = analyses.runProsopAnalysis({
    analysisId: frequencyRun.analysisId, title: 'Ocupaciones', analysisKind: 'frequency',
    variableIds: [occupationVariable.variableId],
  });
  assert.equal(repeatRun.inputFingerprint, frequencyRun.inputFingerprint, 'same cut of canonical inputs is reproducible');
  const trajectoryRun = analyses.runProsopAnalysis({
    title: 'Trayectoria profesional', analysisKind: 'trajectory', variableIds: [occupationVariable.variableId],
  });
  assert.equal(trajectoryRun.result.points[0].statementId, analyzable.statements[0].statementId,
    'trajectory points return to statement evidence');
  const relationFactoid = observations.saveProsopFactoid({
    sourceId: source.sourceId, sourceSegmentId: segment.segmentId, factoidKind: 'relationship', status: 'reviewed',
    statements: [{
      statementType: 'correspondence', literalValue: 'escribió a', value: { kind: 'person', personId: anaMerchant.personId, literal: 'doña Ana' },
      entities: [
        { entityKind: 'person', entityId: anaPoet.personId, role: 'subject', position: 0 },
        { entityKind: 'person', entityId: anaMerchant.personId, role: 'object', position: 1 },
      ],
    }],
  });
  const explicitLayer = networks.saveProsopNetworkLayer({ name: 'Correspondencia documentada', kind: 'relationship', color: '#2563eb' });
  const explicitEdge = networks.saveProsopNetworkEdge({
    layerId: explicitLayer.layerId, sourcePersonId: anaPoet.personId, targetPersonId: anaMerchant.personId,
    origin: 'explicit', factoidIds: [relationFactoid.factoidId], weight: 1,
  });
  assert.equal(explicitEdge.origin, 'explicit');
  assert.throws(() => networks.saveProsopNetworkEdge({
    layerId: explicitLayer.layerId, sourcePersonId: anaPoet.personId, targetPersonId: anaMerchant.personId,
    origin: 'derived', factoidIds: [],
  }), /huella/);
  const derivedLayer = networks.saveProsopNetworkLayer({
    name: 'Copresencia', kind: 'cooccurrence', derivationRule: { kind: 'shared_factoid' }, color: '#f59e0b',
  });
  networks.deriveProsopCooccurrenceLayer(derivedLayer.layerId);
  const networkWorkspace = networks.getProsopNetworksWorkspace();
  assert.equal(networkWorkspace.metrics.byOrigin.explicit, 1);
  assert.equal(networkWorkspace.metrics.byOrigin.derived, 1);
  assert.equal(networkWorkspace.layers.find((item) => item.layerId === derivedLayer.layerId).edges[0].factoidIds[0], relationFactoid.factoidId);
  const searchHits = search.searchProsopography('poeta');
  assert.ok(searchHits.some((item) => item.kind === 'statement' && item.factoidId === analyzable.factoidId));
  assert.match(searchHits.find((item) => item.kind === 'statement').deepLink, /^nodus:\/\/prosop\/factoid\//);
  const proposal = search.createProsopProposal({
    proposalKind: 'term_normalization', targetKind: 'statement', targetId: analyzable.statements[0].statementId,
    payload: { proposedTerm: 'poeta' }, confidence: 0.91, rationale: 'Coincidencia con vocabulario controlado.',
    producerKind: 'ai', producerId: 'test-model',
  });
  assert.equal(proposal.status, 'pending');
  search.decideProsopProposal(proposal.proposalId, 'accepted', 'investigadora', 'Revisada contra el literal.');
  assert.equal(observations.getProsopObservationsWorkspace().factoids.find((item) => item.factoidId === analyzable.factoidId).statements[0].literalValue, 'poeta',
    'accepting a proposal does not mutate reviewed canonical data');
  assert.throws(() => search.createProsopProposal({
    proposalKind: 'merge', targetKind: 'canonical_write', payload: {}, rationale: 'Unsafe',
    producerKind: 'ai', producerId: 'test-model',
  }), /solo puede crear propuestas/);
  const restrictedPerson = identities.createProsopPerson({ displayName: 'Persona reservada', privacyStatus: 'restricted' });
  identities.saveProsopNameAttestation({ literalName: 'Nombre reservado', personId: restrictedPerson.personId });
  const restrictedFactoid = observations.saveProsopFactoid({
    sourceId: source.sourceId, sourceSegmentId: segment.segmentId, factoidKind: 'sensitive', status: 'reviewed',
    statements: [{ statementType: 'attribute', literalValue: 'dato reservado', value: { kind: 'text', text: 'Reservado' },
      entities: [{ entityKind: 'person', entityId: restrictedPerson.personId, role: 'subject', position: 0 }] }],
  });
  assert.equal(search.searchProsopography('Persona reservada').length, 0, 'restricted people are excluded by backend search');
  assert.throws(() => search.createProsopProposal({
    proposalKind: 'attribute', targetKind: 'person', targetId: restrictedPerson.personId,
    payload: { text: 'unsafe' }, rationale: 'Should be blocked', producerKind: 'ai', producerId: 'test-model',
  }), /restringida/);
  const noteLink = search.saveProsopNoteLink({ nodusId: 'note_method', targetKind: 'factoid', targetId: analyzable.factoidId });
  assert.equal(noteLink.targetId, analyzable.factoidId);
  const longRows = interchange.exportProsopLongRows();
  assert.ok(longRows.some((row) => row.statement_id === analyzable.statements[0].statementId && row.locator_display === 'fol. 12r'));
  assert.ok(!longRows.some((row) => row.statement_id === restrictedFactoid.statements[0].statementId), 'restricted people are excluded by backend export');
  const ipif = interchange.exportProsopIpif();
  assert.equal(ipif.type, 'ProsopographyDataset');
  assert.ok(ipif.persons.length >= 2 && ipif.sources.length >= 1 && ipif.factoids.length >= 1 && ipif.statements.length >= 1);
  assert.ok(!ipif.persons.some((item) => item.id === restrictedPerson.personId));
  const integrity = interchange.auditProsopIntegrity();
  assert.equal(integrity.ok, true);
  assert.ok(integrity.syncCoverage.included.prosopography.includes('prosop_statements'));
  assert.equal(integrity.syncCoverage.unclassified.filter((name) => name.startsWith('prosop_')).length, 0);
  for (const language of ['es','en','fr','de','pt','pt-BR','it','tr']) {
    const pack = prompts.prosopographyPromptPack(language);
    assert.match(pack, language === 'es' ? /mención no equivale/i : /mention|Nennung|menção|menzione|geçişi/i);
  }

  const [ipc, preload, api, view, panel, personsView, cohortsPanel, analysisView, networksView, searchView, mcpTools] = await Promise.all([
    readFile(path.join(repoRoot, 'electron/ipc.ts'), 'utf8'),
    readFile(path.join(repoRoot, 'electron/preload.ts'), 'utf8'),
    readFile(path.join(repoRoot, 'shared/types.ts'), 'utf8'),
    readFile(path.join(repoRoot, 'src/views/ProsopSourcesView.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/components/ProsopObservationsPanel.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/views/ProsopPersonsView.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/components/ProsopCohortsPanel.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/views/ProsopAnalysisView.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/views/ProsopNetworksView.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/views/ProsopSearchView.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'electron/mcp/tools.ts'), 'utf8'),
  ]);
  for (const channel of [
    'prosop:sources:workspace', 'prosop:sources:save', 'prosop:sources:saveSegment',
    'prosop:capture:saveTemplate', 'prosop:capture:importDelimited', 'prosop:capture:reviewRow',
  ]) {
    assert.match(ipc, new RegExp(channel.replaceAll(':', '\\:')));
    assert.match(preload, new RegExp(channel.replaceAll(':', '\\:')));
  }
  assert.match(api, /getProsopSourcesWorkspace/);
  assert.match(api, /getProsopObservationsWorkspace/);
  assert.match(view, /data-testid="prosop-sources-view"/);
  assert.match(panel, /data-testid="prosop-observations-panel"/);
  assert.match(panel, /dark:/);
  assert.match(personsView, /data-testid="prosop-persons-view"/);
  assert.match(personsView, /searchProsopIdentityCandidates/);
  assert.match(cohortsPanel, /data-testid="prosop-cohorts-panel"/);
  assert.match(cohortsPanel, /data-testid="prosop-coverage-panel"/);
  assert.match(analysisView, /data-testid="prosop-analysis-view"/);
  assert.match(analysisView, /inputFingerprint/);
  assert.match(networksView, /data-testid="prosop-networks-view"/);
  assert.match(networksView, /strokeDasharray/);
  assert.match(searchView, /data-testid="prosop-search-view"/);
  assert.match(mcpTools, /nodus_prosop_get_design/);
  assert.match(mcpTools, /nodus_prosop_create_proposal/);
  assert.ok(view.includes('accept=".csv,.tsv,.txt"'));
  assert.match(view, /dark:/);

  closeDb();
  console.log('Prosopography sources and capture phase tests passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(String(value), 'utf8'),
      decryptString: (value) => Buffer.from(value).toString('utf8'),
    },
    dialog: {}, shell: {}, BrowserWindow: class {},
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
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
