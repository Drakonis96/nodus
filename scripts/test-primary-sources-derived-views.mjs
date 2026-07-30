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

if (!process.argv.includes('--electron-primary-sources-derived-test')) {
  const files = Object.fromEntries([
    'timeline', 'map', 'relations', 'app', 'repo', 'schema', 'sync', 'shared',
    'preload', 'ipc',
  ].map((name, index) => [name, readSource([
    'src/views/PrimarySourcesTimelineView.tsx',
    'src/views/PrimarySourcesMapView.tsx',
    'src/views/PrimarySourcesRelationsView.tsx',
    '@shell',
    'electron/db/primarySourceDerivedViewsRepo.ts',
    'electron/db/migrations.ts',
    'electron/db/syncTables.ts',
    '@api',
    '@bridge',
    '@main',
  ][index])]));

  for (const marker of [
    'Fecha e intervalo',
    'Mostrar hipótesis sin evidencia',
    'Propuestas de fecha conservadas',
    'Todos los repositorios',
    'Evidencia ordenada',
    'primary-sources-map-table',
    'Mapa de procedencia',
    'Lugar de procedencia',
    'Las ciudades mencionadas en su contenido no aparecen en este mapa',
    'Todas las colecciones',
    'primary-sources-relations-table',
    'Arista confirmada con evidencia',
    'Apoyo y contradicción',
  ]) {
    assert.ok(
      files.timeline.includes(marker) || files.map.includes(marker) || files.relations.includes(marker),
      `phase 8 UI contains ${marker}`
    );
  }
  assert.match(files.app, /isPrimarySources\s*\? <PrimarySourcesTimelineView \/>/);
  assert.match(files.app, /isPrimarySources\s*\? <PrimarySourcesMapView \/>/);
  assert.match(files.app, /isPrimarySources\s*\? <PrimarySourcesRelationsView \/>/);
  assert.ok(Number(files.schema.match(/SCHEMA_VERSION = (\d+)/)[1]) >= 121,
    'the derived-views migration is applied');
  assert.match(files.schema, /provenance_place_id/);
  assert.match(files.schema, /archive_place_resolution_decisions/);
  assert.match(files.schema, /idx_archive_place_resolution_one_active/);
  assert.match(files.sync, /'archive_place_resolution_decisions'/);
  assert.match(files.repo, /safeCoordinates/);
  assert.match(files.repo, /status: traces\.length \? 'confirmed' : 'proposal'/);
  assert.match(files.repo, /hypothesis: traces\.length === 0/);
  assert.match(files.repo, /evidenceRole|evidence_role/);

  for (const method of [
    'getPrimarySourceTimelineWorkspace',
    'getPrimarySourceMapWorkspace',
    'resolvePrimarySourceToponym',
    'revertPrimarySourceToponymResolution',
    'getPrimarySourceRelationsWorkspace',
  ]) {
    assert.ok(files.shared.includes(method), `${method} is typed`);
    assert.ok(files.preload.includes(method), `${method} is exposed`);
  }
  for (const channel of [
    'primarySources:timeline:workspace',
    'primarySources:map:workspace',
    'primarySources:map:resolveToponym',
    'primarySources:map:revertToponym',
    'primarySources:relations:workspace',
  ]) assert.ok(files.ipc.includes(channel), `${channel} is registered`);

  const buildDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-primary-derived-i18n-'));
  try {
    const output = path.join(buildDir, 'derived.cjs');
    execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
      path.join(repoRoot, 'src/i18n.primarySourcesDerived.ts'),
      '--bundle', '--platform=node', '--format=cjs', `--outfile=${output}`,
    ], { cwd: repoRoot, stdio: 'inherit' });
    const translations = require(output).PRIMARY_SOURCES_DERIVED_TRANSLATIONS;
    const reference = Object.keys(translations.en).sort();
    assert.ok(reference.length >= 120, 'phase 8 translation catalogue is substantive');
    for (const language of ['en', 'fr', 'de', 'pt', 'ptBR', 'it', 'tr']) {
      assert.deepEqual(Object.keys(translations[language]).sort(), reference, `${language} has every phase 8 key`);
      assert.ok(Object.values(translations[language]).every(Boolean), `${language} has no blank phase 8 copy`);
    }
  } finally {
    await rm(buildDir, { recursive: true, force: true });
  }

  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-primary-sources-derived-views.mjs'), '--electron-primary-sources-derived-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-primary-derived-'));
installRuntimeHooks(root);

try {
  const archive = require(path.join(repoRoot, 'electron/db/archiveRepo.ts'));
  const primary = require(path.join(repoRoot, 'electron/db/primarySourcesArchiveRepo.ts'));
  const textRepo = require(path.join(repoRoot, 'electron/db/archiveTextsRepo.ts'));
  const evidenceRepo = require(path.join(repoRoot, 'electron/db/archiveEvidenceRepo.ts'));
  const proposals = require(path.join(repoRoot, 'electron/db/archiveProposalsRepo.ts'));
  const entities = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const social = require(path.join(repoRoot, 'electron/db/socialRepo.ts'));
  const derived = require(path.join(repoRoot, 'electron/db/primarySourceDerivedViewsRepo.ts'));
  const hierarchy = require(path.join(repoRoot, 'electron/db/archiveHierarchyRepo.ts'));
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const repository = hierarchy.createArchiveRepository({
    name: 'Archivo de pruebas derivadas',
    identifier: 'APD',
  });
  const mapCollection = archive.createFolder('Colección de lugares');

  function createSource(number, content) {
    const item = archive.createItem({
      title: `Fuente derivada ${number}`,
      kind: 'text',
      fileName: `derivada-${number}.txt`,
      mimeType: 'text/plain',
      blob: Buffer.from(content),
    });
    primary.ensurePrimarySourceProjection(item.itemId, {
      title: `Fuente derivada ${number}`,
      referenceCode: `ARC/DV/${number}`,
      repositoryId: repository.repositoryId,
    });
    const version = textRepo.createPrimarySourceTextVersion({
      itemId: item.itemId,
      kind: 'transcription',
      languageCode: 'es',
      content,
      status: 'reviewed',
      createdBy: 'researcher',
    }).version;
    const excerpt = evidenceRepo.createStableArchiveExcerpt({
      itemId: item.itemId,
      textVersionId: version.textVersionId,
      startOffset: 0,
      endOffset: content.length,
      locatorDisplay: `folio ${number}r`,
      reviewStatus: 'reviewed',
      createdBy: 'researcher',
    });
    return { item, version, excerpt, content };
  }

  function proposal(source, kind, payload, matchedTargetId = null, role = 'supports') {
    const created = proposals.createEntityProposal({
      itemId: source.item.itemId,
      excerptId: source.excerpt.excerptId,
      proposalKind: kind,
      payload,
      matchedTargetId,
      confidence: 0.88,
      rationale: `explicit_${kind}`,
      sourceEngine: 'phase8-test',
      sourceModel: 'fixture',
    });
    return proposals.acceptEntityProposal(created.proposalId, {
      matchedTargetId,
      evidenceRole: role,
      reviewer: 'researcher',
    });
  }

  const personA = entities.createPerson({ displayName: 'María del Archivo' });
  const personB = entities.createPerson({ displayName: 'Tomás el Notario' });
  const basePlace = entities.findOrCreatePlace('Santa Maria del Río');
  const eventSource = createSource(1, 'El traslado ocurrió entre 1894 y 1896 en Santa María.');
  const acceptedEvent = proposal(eventSource, 'event', {
    type: 'migration',
    label: 'Traslado documentado',
    date: 'entre 1894 y 1896',
    notes: 'El intervalo se conserva.',
    placeId: basePlace.placeId,
    participants: [{ name: personA.displayName, targetId: personA.personId, role: 'principal' }],
  });
  const eventId = acceptedEvent.decision.materializedTargetId;
  const conflictingDateSource = createSource(2, 'Otra declaración sitúa el traslado en 1898.');
  proposal(conflictingDateSource, 'date', {
    date: '1898',
    context: 'Fecha alternativa del traslado',
  }, eventId, 'contradicts');
  const hypothesisEvent = entities.createEvent({
    type: 'other',
    label: 'Hipótesis manual no documentada',
    date: 'c. 1900',
  });

  const timeline = derived.getPrimarySourceTimelineWorkspace();
  const documentedEvent = timeline.events.find((event) => event.eventId === eventId);
  assert.ok(documentedEvent);
  assert.equal(documentedEvent.hypothesis, false);
  assert.equal(documentedEvent.dateStartSort, '1894-01-01');
  assert.equal(documentedEvent.dateEndSort, '1896-12-31');
  assert.equal(documentedEvent.dateCertainty, 'between');
  assert.equal(documentedEvent.reviewStatus, 'reviewed');
  assert.equal(documentedEvent.evidence.length, 2);
  assert.equal(documentedEvent.hasContradiction, true);
  assert.ok(documentedEvent.dateAlternatives.some((entry) => entry.dateDisplay === '1898'));
  assert.ok(documentedEvent.evidence.every((trace) =>
    trace.excerptId && trace.quote && trace.locator
  ), 'every confirmed timeline fact opens an exact excerpt');
  assert.equal(timeline.events.find((event) => event.eventId === hypothesisEvent.eventId).hypothesis, true);
  assert.ok(timeline.events.filter((event) => !event.hypothesis).every((event) => event.evidence.length > 0));
  assert.ok(timeline.repositories.some((entry) => entry.label === repository.name));

  const placeSource = createSource(3, 'El legajo estuvo en custodia en Sancta Maria del Río.');
  archive.setItemFolders(placeSource.item.itemId, [mapCollection.folderId]);
  const acceptedPlace = proposal(placeSource, 'place', {
    name: 'Santa Maria del Río',
    originalLabel: 'Sancta Maria del Río',
    role: 'custody',
  });
  const placeId = acceptedPlace.decision.materializedTargetId;
  const mentionId = getDb().prepare(
    'SELECT mention_id FROM archive_place_mentions WHERE place_id=?'
  ).get(placeId).mention_id;
  let map = derived.getPrimarySourceMapWorkspace();
  assert.equal(
    map.points.some((point) => point.mentionId === mentionId),
    false,
    'a place mentioned in the text never appears as source provenance',
  );
  assert.ok(
    map.unassignedSources.some((source) => source.id === placeSource.item.itemId),
    'the source is listed as unassigned until its record receives a provenance place',
  );
  const placeRow = primary.getPrimarySourceArchiveRow(placeSource.item.itemId);
  primary.updatePrimarySourceArchiveRecord(placeSource.item.itemId, {
    expectedRevision: placeRow.revision,
    profile: { provenancePlaceId: placeId },
  });
  map = derived.getPrimarySourceMapWorkspace();
  let placePoint = map.points.find((point) => point.sourceIds.includes(placeSource.item.itemId));
  assert.ok(placePoint);
  assert.equal(placePoint.sourceTitle, placeSource.item.title);
  assert.equal(placePoint.originalLabel, 'Santa Maria del Río');
  assert.equal(placePoint.normalizedName, 'Santa Maria del Río');
  assert.equal(placePoint.role, 'provenance');
  assert.equal(placePoint.layer, 'provenance');
  assert.equal(placePoint.hypothesis, false);
  assert.equal(placePoint.evidence.length, 0);
  assert.ok(map.repositories.some((entry) => entry.label === repository.name));
  assert.ok(map.collections.some((entry) => entry.id === mapCollection.folderId));
  assert.ok(map.sourceTypes.length > 0);
  assert.deepEqual(map.persons, []);
  assert.deepEqual(map.events, []);

  const selectedCandidate = {
    gazetteerId: 'geonames:phase8-1',
    name: 'Santa María del Río',
    admin1: 'Provincia histórica',
    country: 'España',
    countryCode: 'ES',
    latitude: 40.4168,
    longitude: -3.7038,
    population: 1000,
  };
  const alternativeCandidate = {
    ...selectedCandidate,
    gazetteerId: 'geonames:phase8-2',
    name: 'Santa María de Río',
    latitude: 41.1,
    longitude: -4.2,
  };
  const alreadyCanonical = entities.findOrCreateGazetteerPlace(selectedCandidate);
  assert.notEqual(alreadyCanonical.placeId, placeId);
  const resolution = derived.resolvePrimarySourceToponym({
    placeId,
    mentionId,
    selectedCandidate,
    alternatives: [selectedCandidate, alternativeCandidate],
    coordinatePrecision: 'municipality',
    historicalContext: 'Jurisdicción del antiguo partido.',
    validFromDisplay: 'siglo XIX',
    validToDisplay: '1899',
    rationale: 'Coinciden jurisdicción y contexto del documento.',
    createdBy: 'researcher',
  });
  assert.equal(resolution.alternatives.length, 1);
  map = derived.getPrimarySourceMapWorkspace();
  placePoint = map.points.find((point) => point.sourceIds.includes(placeSource.item.itemId));
  assert.equal(placePoint.originalLabel, 'Santa María del Río');
  assert.equal(placePoint.normalizedName, 'Santa María del Río');
  assert.equal(placePoint.latitude, 40.4168);
  assert.equal(placePoint.coordinatePrecision, 'municipality');
  assert.equal(placePoint.authority.gazetteerId, 'geonames:phase8-1');
  assert.equal(placePoint.authority.canonicalPlaceId, alreadyCanonical.placeId);
  assert.equal(placePoint.resolution.alternatives[0].gazetteerId, 'geonames:phase8-2');

  derived.revertPrimarySourceToponymResolution(resolution.resolutionId);
  map = derived.getPrimarySourceMapWorkspace();
  placePoint = map.points.find((point) => point.sourceIds.includes(placeSource.item.itemId));
  assert.equal(placePoint.originalLabel, 'Santa Maria del Río');
  assert.equal(placePoint.normalizedName, 'Santa Maria del Río');
  assert.equal(placePoint.latitude, null);
  assert.equal(
    getDb().prepare('SELECT status FROM archive_place_resolution_decisions WHERE resolution_id=?')
      .get(resolution.resolutionId).status,
    'reverted'
  );
  assert.equal(
    getDb().prepare(
      `SELECT COUNT(*) AS count FROM archive_audit_log
       WHERE action IN ('toponym_resolved', 'toponym_resolution_reverted')`
    ).get().count,
    2
  );
  assert.ok(map.points.every((point) =>
    point.role === 'provenance' && point.mentionId === null && point.evidence.length === 0
  ));

  const relationSource = createSource(4, 'Tomás actuó como notario de María entre 1888 y 1891.');
  const acceptedRelation = proposal(relationSource, 'relation', {
    subject: personA.displayName,
    subjectTargetId: personA.personId,
    relation: 'cliente de',
    object: personB.displayName,
    objectTargetId: personB.personId,
    direction: 'directed',
    date: 'entre 1888 y 1891',
    notes: 'Relación profesional documentada.',
  });
  assert.equal(acceptedRelation.decision.materializedTargetKind, 'social_relation');
  const edgeId = acceptedRelation.decision.materializedTargetId;
  const contradictionSource = createSource(5, 'Una nota niega que Tomás fuese notario de María.');
  evidenceRepo.createPrimarySourceEvidence({
    targetKind: 'social_relation',
    targetId: edgeId,
    itemId: contradictionSource.item.itemId,
    excerptId: contradictionSource.excerpt.excerptId,
    evidenceRole: 'contradicts',
    certainty: 0.76,
    reviewStatus: 'reviewed',
    sourceVersionId: contradictionSource.version.textVersionId,
    quote: contradictionSource.excerpt.quotedText,
    location: contradictionSource.excerpt.locatorDisplay,
    createdBy: 'researcher',
  });
  const proposalEdge = social.createSocialRelation({
    personId: personA.personId,
    targetKind: 'person',
    targetId: personB.personId,
    role: 'posible amistad',
    status: 'proposal',
    direction: 'mutual',
  });

  const relations = derived.getPrimarySourceRelationsWorkspace();
  const confirmedEdge = relations.edges.find((edge) => edge.edgeId === edgeId);
  assert.ok(confirmedEdge);
  assert.equal(confirmedEdge.status, 'confirmed');
  assert.equal(confirmedEdge.hypothesis, false);
  assert.equal(confirmedEdge.dateStartSort, '1888-01-01');
  assert.equal(confirmedEdge.dateEndSort, '1891-12-31');
  assert.equal(confirmedEdge.evidence.length, 2);
  assert.equal(confirmedEdge.hasContradiction, true);
  assert.ok(confirmedEdge.evidence.every((trace) => trace.excerptId && trace.quote));
  assert.equal(
    relations.edges.find((edge) => edge.edgeId === proposalEdge.relationId).hypothesis,
    true
  );
  assert.ok(relations.edges.filter((edge) => !edge.hypothesis).every((edge) => edge.evidence.length > 0));
  assert.deepEqual(getDb().pragma('foreign_key_check'), []);

  console.log('Primary Sources derived views phase test passed!');
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
