import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-primary-sources-governance-test')) {
  const files = Object.fromEntries([
    ['app', 'src/App.tsx'],
    ['schema', 'electron/db/migrations.ts'],
    ['sync', 'electron/db/syncTables.ts'],
    ['preload', 'electron/preload.ts'],
    ['ipc', 'electron/ipc.ts'],
    ['governance', 'electron/primarySources/primarySourceGovernance.ts'],
    ['export', 'electron/primarySources/primarySourceExport.ts'],
    ['backup', 'electron/export/exportImport.ts'],
    ['types', 'shared/types.ts'],
  ].map(([name, relative]) => [name, fs.readFileSync(path.join(repoRoot, relative), 'utf8')]));

  assert.doesNotMatch(files.app, /PrimarySourcesToolkitView/);
  assert.match(files.app, /view === 'toolkit'[\s\S]{0,120}<ToolkitView/);
  assert.match(files.schema, /SCHEMA_VERSION = 116/);
  for (const table of [
    'primary_source_policies',
    'primary_source_citation_settings',
    'primary_source_operation_runs',
    'primary_source_export_manifests',
    'primary_source_restore_reports',
  ]) {
    assert.ok(files.schema.includes(`CREATE TABLE ${table}`), `${table} is migrated`);
    assert.ok(files.sync.includes(`'${table}'`), `${table} is synchronised`);
  }
  for (const method of [
    'getPrimarySourceGovernanceWorkspace',
    'previewPrimarySourceToolkitOperation',
    'runPrimarySourceToolkitOperation',
    'buildPrimarySourceCitation',
    'previewPrimarySourceExport',
    'exportPrimarySourceResearchPackage',
    'validatePrimarySourceResearchPackage',
    'restorePrimarySourceResearchPackage',
  ]) {
    assert.ok(files.types.includes(method), `${method} is typed`);
    assert.ok(files.preload.includes(method), `${method} is exposed`);
  }
  for (const channel of [
    'primarySources:governance:workspace',
    'primarySources:toolkit:preview',
    'primarySources:toolkit:run',
    'primarySources:citations:build',
    'primarySources:export:preview',
    'primarySources:export:package',
    'primarySources:export:validate',
    'primarySources:export:restore',
  ]) assert.ok(files.ipc.includes(channel), `${channel} is registered`);
  assert.match(files.export, /db\.exec\('VACUUM'\)/);
  assert.match(files.export, /foreign_key_check/);
  assert.match(files.export, /safeEntryName/);
  assert.match(files.backup, /sqlite_master/);
  assert.match(files.governance, /policySummary/);
  assert.match(files.governance, /kind: 'translation'/);
  assert.match(files.governance, /nodus-page-segmentation/);

  const buildDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-primary-governance-i18n-'));
  try {
    const promptOutput = path.join(buildDir, 'prompts.cjs');
    execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
      path.join(repoRoot, 'shared/primarySourceToolkitPrompts.ts'),
      '--bundle', '--platform=node', '--format=cjs', `--outfile=${promptOutput}`,
    ], { cwd: repoRoot, stdio: 'inherit' });
    const { primarySourceToolkitPrompt } = require(promptOutput);
    for (const language of ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr']) {
      const prompt = primarySourceToolkitPrompt(language, 'translate_text');
      assert.ok(prompt.length > 350, `${language} has a substantive safety prompt`);
      assert.match(prompt, /proposal|propuesta|proposition|Vorschlag|proposta|öneri|öner|revis/i);
    }
  } finally {
    await rm(buildDir, { recursive: true, force: true });
  }

  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-primary-sources-governance-export.mjs'), '--electron-primary-sources-governance-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-primary-governance-'));
installRuntimeHooks(root);

try {
  const AdmZip = require('adm-zip');
  const Database = require('better-sqlite3');
  const archive = require(path.join(repoRoot, 'electron/db/archiveRepo.ts'));
  const primary = require(path.join(repoRoot, 'electron/db/primarySourcesArchiveRepo.ts'));
  const filesRepo = require(path.join(repoRoot, 'electron/db/archiveFilesRepo.ts'));
  const textRepo = require(path.join(repoRoot, 'electron/db/archiveTextsRepo.ts'));
  const evidenceRepo = require(path.join(repoRoot, 'electron/db/archiveEvidenceRepo.ts'));
  const entitiesRepo = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const hierarchy = require(path.join(repoRoot, 'electron/db/archiveHierarchyRepo.ts'));
  const settings = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const governanceRepo = require(path.join(repoRoot, 'electron/db/primarySourceGovernanceRepo.ts'));
  const researchRepo = require(path.join(repoRoot, 'electron/db/primarySourceResearchRepo.ts'));
  const governance = require(path.join(repoRoot, 'electron/primarySources/primarySourceGovernance.ts'));
  const archiveDiscovery = require(path.join(repoRoot, 'electron/archive/archiveDiscovery.ts'));
  const researchExport = require(path.join(repoRoot, 'electron/primarySources/primarySourceExport.ts'));
  const syncPackage = require(path.join(repoRoot, 'electron/export/syncPackage.ts'));
  const vaultRegistry = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const { getDb, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const db = getDb();
  assert.equal(SCHEMA_VERSION, 116);
  vaultRegistry.setVaultType(vaultRegistry.getActiveVault().id, 'primary_sources');

  settings.updateSettings({
    uiLanguage: 'en',
    extractionModel: { provider: 'openai', model: 'phase10-no-call' },
  });

  const repository = hierarchy.createArchiveRepository({
    name: 'Archivo de la Prueba Diez',
    identifier: 'APT10',
  });

  function source(name, access, sensitivity, secret) {
    const item = archive.createItem({
      title: name,
      kind: 'report',
      fileName: `${name.replace(/\W+/g, '-').toLowerCase()}.txt`,
      mimeType: 'text/plain',
      blob: Buffer.from(secret),
      description: `Descripción ${name}`,
    });
    primary.ensurePrimarySourceProjection(item.itemId, {
      title: name,
      referenceCode: `APT10/${name.slice(0, 3).toUpperCase()}`,
      repositoryId: repository.repositoryId,
      creatorDisplay: `Creador ${name}`,
      dateDisplay: '1892',
    });
    db.prepare(
      `UPDATE archive_item_profiles
          SET access_status=?, sensitivity=?, citation_status='ready'
        WHERE item_id=?`
    ).run(access, sensitivity, item.itemId);
    const master = filesRepo.listArchiveFiles(item.itemId).find((file) => file.role === 'master');
    const text = textRepo.createPrimarySourceTextVersion({
      itemId: item.itemId,
      fileId: master?.fileId ?? null,
      kind: 'diplomatic',
      languageCode: 'es',
      content: `Página 1\n${secret}\nPágina 2\ncontinuación literal`,
      status: 'reviewed',
      engine: 'human',
    }).version;
    return { item, master, text };
  }

  const open = source('Fuente abierta', 'open', 'normal', 'OPEN-CONTENT-PHASE10');
  const privateSource = source('Fuente privada', 'private', 'personal', 'PRIVATE-CONTENT-PHASE10');
  const unknown = source('UNKNOWN-TITLE-PHASE10', 'unknown', 'normal', 'UNKNOWN-CONTENT-PHASE10');
  const restricted = source('RESTRICTED-TITLE-PHASE10', 'restricted', 'highly_sensitive', 'RESTRICTED-CONTENT-PHASE10');
  assert.ok(open.master);

  const guardedIndex = await archiveDiscovery.embedArchiveBacklog();
  assert.equal(guardedIndex.indexed, 0, 'external background indexing sends nothing while confirmation is required');
  assert.equal(guardedIndex.skipped, 4, 'every source remains available for a later authorised/local indexing pass');

  // Equal-size representations must be summed independently, never collapsed by
  // SUM(DISTINCT byte_size).
  filesRepo.createArchiveFile({
    itemId: open.item.itemId,
    role: 'supplement',
    sequenceNo: 1,
    originalFileName: 'same-a.bin',
    mimeType: 'application/octet-stream',
    content: Buffer.from('1234'),
  });
  filesRepo.createArchiveFile({
    itemId: open.item.itemId,
    role: 'supplement',
    sequenceNo: 2,
    originalFileName: 'same-b.bin',
    mimeType: 'application/octet-stream',
    content: Buffer.from('5678'),
  });
  const itemSummary = governanceRepo.listPrimarySourceToolkitItems()
    .find((candidate) => candidate.itemId === open.item.itemId);
  const exactBytes = db.prepare(
    'SELECT SUM(byte_size) AS value FROM archive_item_files WHERE item_id=? AND superseded_at IS NULL'
  ).get(open.item.itemId).value;
  assert.equal(itemSummary.byteSize, exactBytes);

  const restrictedOnly = governance.previewPrimarySourceToolkitOperation({
    operationId: 'summarize_metadata',
    itemIds: [restricted.item.itemId],
    processingLocation: 'external',
    authorizedItemIds: [restricted.item.itemId],
  });
  assert.equal(restrictedOnly.canRun, false);
  assert.deepEqual(restrictedOnly.blockedItemIds, [restricted.item.itemId]);
  assert.deepEqual(restrictedOnly.includedItemIds, []);

  const incompatibleVision = governance.previewPrimarySourceToolkitOperation({
    operationId: 'describe_image',
    itemIds: [open.item.itemId],
    processingLocation: 'external',
    authorizedItemIds: [open.item.itemId],
  });
  assert.equal(incompatibleVision.canRun, false, 'vision cannot run against a text-only source');
  assert.deepEqual(incompatibleVision.incompatibleItemIds, [open.item.itemId]);
  assert.equal(incompatibleVision.filesSent, 0);

  const incompatibleTranscription = governance.previewPrimarySourceToolkitOperation({
    operationId: 'transcribe',
    itemIds: [open.item.itemId],
    processingLocation: 'external',
    authorizedItemIds: [open.item.itemId],
  });
  assert.equal(incompatibleTranscription.canRun, false, 'transcription cannot run against a text-only source');
  assert.deepEqual(incompatibleTranscription.incompatibleItemIds, [open.item.itemId]);
  assert.equal(incompatibleTranscription.filesSent, 0);

  const outbound = governance.previewPrimarySourceToolkitOperation({
    operationId: 'summarize_metadata',
    itemIds: [open.item.itemId, restricted.item.itemId],
    processingLocation: 'external',
  });
  assert.deepEqual(outbound.confirmationItemIds, [open.item.itemId]);
  assert.deepEqual(outbound.blockedItemIds, [restricted.item.itemId]);
  const outboundAuthorized = governance.previewPrimarySourceToolkitOperation({
    ...outbound.request,
    authorizedItemIds: [open.item.itemId, restricted.item.itemId],
  });
  assert.equal(outboundAuthorized.canRun, true);
  assert.deepEqual(outboundAuthorized.includedItemIds, [open.item.itemId]);
  governanceRepo.updatePrimarySourcePolicySettings({ allowPrivateExternalAi: false });
  const privateExternalOff = governance.previewPrimarySourceToolkitOperation({
    operationId: 'summarize_metadata',
    itemIds: [privateSource.item.itemId],
    processingLocation: 'external',
    authorizedItemIds: [privateSource.item.itemId],
  });
  assert.deepEqual(privateExternalOff.blockedItemIds, [privateSource.item.itemId]);
  assert.equal(privateExternalOff.canRun, false);
  governanceRepo.updatePrimarySourcePolicySettings({ allowPrivateExternalAi: true });

  const originalTitle = db.prepare('SELECT title FROM archive_items WHERE item_id=?').get(open.item.itemId).title;
  const localResult = await governance.runPrimarySourceToolkitOperation({
    operationId: 'summarize_metadata',
    itemIds: [open.item.itemId],
    processingLocation: 'local',
  });
  assert.equal(localResult.status, 'completed');
  assert.equal(localResult.outputs.length, 1);
  assert.equal(localResult.outputs[0].targetKind, 'proposal');
  assert.equal(db.prepare('SELECT title FROM archive_items WHERE item_id=?').get(open.item.itemId).title, originalTitle);
  const auditRow = db.prepare(
    'SELECT * FROM primary_source_operation_runs WHERE run_id=?'
  ).get(localResult.runId);
  assert.equal(auditRow.selection_count, 1);
  assert.match(auditRow.selected_ids_hash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(auditRow), /Fuente abierta|OPEN-CONTENT|primary-governance/);
  assert.doesNotMatch(auditRow.policy_decision, new RegExp(open.item.itemId));
  const auditColumns = db.prepare('PRAGMA table_info(primary_source_operation_runs)').all().map((row) => row.name);
  for (const forbidden of ['text', 'title', 'path', 'prompt', 'response', 'item_id']) {
    assert.ok(!auditColumns.some((column) => column === forbidden), `audit omits ${forbidden}`);
  }

  const segmented = await governance.runPrimarySourceToolkitOperation({
    operationId: 'segment_pages',
    itemIds: [open.item.itemId],
    processingLocation: 'local',
  });
  assert.equal(segmented.status, 'completed');
  assert.equal(segmented.outputs[0].targetKind, 'text_version');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS value FROM archive_text_segments WHERE text_version_id=?')
      .get(segmented.outputs[0].targetId).value,
    2
  );
  assert.equal(
    db.prepare('SELECT content FROM archive_text_versions WHERE text_version_id=?').get(open.text.textVersionId).content,
    open.text.content
  );

  const excerptStart = open.text.content.indexOf('OPEN-CONTENT');
  const excerpt = evidenceRepo.createStableArchiveExcerpt({
    itemId: open.item.itemId,
    fileId: open.master.fileId,
    textVersionId: open.text.textVersionId,
    startOffset: excerptStart,
    endOffset: excerptStart + 'OPEN-CONTENT-PHASE10'.length,
    locatorDisplay: 'folio 7r, líneas 2–3',
    reviewStatus: 'reviewed',
    createdBy: 'phase10-test',
  });
  const dossierPerson = entitiesRepo.createPerson({
    displayName: 'Persona probatoria fase 10',
    sex: 'unknown',
    names: [{ name: 'P. Probatoria', kind: 'documentary_variant' }],
  });
  const dossierEvidence = evidenceRepo.createPrimarySourceEvidence({
    targetKind: 'person',
    targetId: dossierPerson.personId,
    itemId: open.item.itemId,
    excerptId: excerpt.excerptId,
    evidenceRole: 'supports',
    certainty: 0.8,
    reviewStatus: 'reviewed',
    sourceVersionId: open.text.textVersionId,
    quote: excerpt.quotedText,
    location: excerpt.locatorDisplay,
    createdBy: 'phase10-test',
  });
  assert.equal(dossierEvidence.targetId, dossierPerson.personId);
  const exactCitation = governance.buildPrimarySourceCitation({
    itemId: open.item.itemId,
    excerptId: excerpt.excerptId,
    accessedAt: '2026-07-29T00:00:00.000Z',
  });
  assert.equal(exactCitation.assessment.status, 'ready');
  assert.equal(exactCitation.structured.locator, 'folio 7r, líneas 2–3');
  assert.match(exactCitation.deepLink, /^nodus:\/\/primary-source\//);
  const editedCitation = governance.buildPrimarySourceCitation({
    itemId: open.item.itemId,
    excerptId: excerpt.excerptId,
    customText: 'Cita editorial corregida',
  });
  assert.equal(editedCitation.text, 'Cita editorial corregida');
  assert.equal(editedCitation.editedText, true);
  assert.deepEqual(editedCitation.structured, exactCitation.structured);
  governanceRepo.updatePrimarySourceCitationSettings({
    requiredFields: ['title', 'master'],
    repositoryAliases: { [repository.repositoryId]: 'APT10' },
  });
  const configuredGeneral = governance.buildPrimarySourceCitation({
    itemId: open.item.itemId,
  });
  assert.equal(configuredGeneral.assessment.status, 'ready');
  assert.equal(configuredGeneral.structured.repository, 'APT10');
  assert.equal(configuredGeneral.structured.locator, undefined);

  const openNote = researchRepo.createPrimarySourceNote({
    title: 'Nota exportable fase 10',
    content: 'OPEN-NOTE-CONTENT-PHASE10',
    accessStatus: 'open',
  });
  const privateNote = researchRepo.createPrimarySourceNote({
    title: 'Nota privada fase 10',
    content: 'PRIVATE-NOTE-CONTENT-PHASE10',
  });
  const restrictedNote = researchRepo.createPrimarySourceNote({
    title: 'Nota restringida fase 10',
    content: 'RESTRICTED-NOTE-CONTENT-PHASE10',
    accessStatus: 'restricted',
    sensitivity: 'highly_sensitive',
  });
  assert.equal(privateNote.profile.accessStatus, 'private', 'derived notes default to private');
  for (const note of [openNote, privateNote, restrictedNote]) {
    researchRepo.addPrimarySourceNoteLink({
      noteId: note.id,
      targetKind: 'source',
      targetId: open.item.itemId,
      relationKind: 'interprets',
    });
  }
  const privateSyncOff = syncPackage.buildSyncPackage('2.7.0-phase10-test', 'phase10-passphrase');
  assert.equal(privateSyncOff.counts.archive_items, 1);
  assert.equal(privateSyncOff.counts.notes, 1);
  assert.equal(privateSyncOff.counts.primary_source_operation_runs, 0);
  governanceRepo.updatePrimarySourcePolicySettings({ allowPrivateSync: true });
  const privateSyncOn = syncPackage.buildSyncPackage('2.7.0-phase10-test', 'phase10-passphrase');
  assert.equal(privateSyncOn.counts.archive_items, 2);
  assert.equal(privateSyncOn.counts.notes, 2);
  governanceRepo.updatePrimarySourcePolicySettings({ allowPrivateSync: false });

  const request = {
    profile: 'source_package',
    itemIds: [
      open.item.itemId,
      privateSource.item.itemId,
      unknown.item.itemId,
      restricted.item.itemId,
    ],
    inventoryFormat: 'json',
    includeFiles: true,
    includeTextVersions: true,
    includeNotes: true,
    includeDerivatives: false,
    noteIds: [openNote.id, privateNote.id, restrictedNote.id],
  };
  governanceRepo.updatePrimarySourcePolicySettings({ exportPrivateFiles: false });
  const privateExportOff = researchExport.previewPrimarySourceExport({
    ...request,
    itemIds: [privateSource.item.itemId],
    noteIds: [],
  });
  assert.deepEqual(privateExportOff.excludedByRestriction, [privateSource.item.itemId]);
  assert.deepEqual(privateExportOff.confirmationRequired, []);
  governanceRepo.updatePrimarySourcePolicySettings({ exportPrivateFiles: true });
  const firstPreview = researchExport.previewPrimarySourceExport(request);
  assert.deepEqual(firstPreview.excludedByRestriction, [restricted.item.itemId]);
  assert.deepEqual(new Set(firstPreview.confirmationRequired), new Set([
    privateSource.item.itemId,
    unknown.item.itemId,
  ]));
  assert.deepEqual(firstPreview.includedNoteIds, [openNote.id]);
  assert.deepEqual(firstPreview.confirmationNoteIds, [privateNote.id]);
  assert.deepEqual(firstPreview.excludedNoteIds, [restrictedNote.id]);
  assert.equal(firstPreview.canExport, false);
  const authorizedRequest = {
    ...request,
    authorizedItemIds: [privateSource.item.itemId, unknown.item.itemId, restricted.item.itemId],
    authorizedNoteIds: [privateNote.id, restrictedNote.id],
  };
  const preview = researchExport.previewPrimarySourceExport(authorizedRequest);
  assert.equal(preview.canExport, true);
  assert.ok(preview.includedItemIds.includes(open.item.itemId));
  assert.ok(preview.includedItemIds.includes(privateSource.item.itemId));
  assert.ok(preview.includedItemIds.includes(unknown.item.itemId));
  assert.ok(!preview.includedItemIds.includes(restricted.item.itemId));
  assert.deepEqual(preview.metadataRedacted, [unknown.item.itemId]);

  const packageResult = await researchExport.createPrimarySourceResearchPackage({
    request: authorizedRequest,
    tempDir: root,
    appVersion: '2.7.0-phase10-test',
  });
  const validation = researchExport.validatePrimarySourceResearchPackage(packageResult.buffer);
  assert.equal(validation.valid, true);
  assert.equal(validation.manifest.verification.status, 'verified');
  assert.equal(validation.manifest.selection.included, 3);
  assert.equal(validation.manifest.selection.excluded, 1);
  assert.ok(validation.manifest.exclusions[0].itemId.startsWith('sha256:'));
  assert.notEqual(validation.manifest.exclusions[0].itemId, restricted.item.itemId);

  const csvPackage = await researchExport.createPrimarySourceResearchPackage({
    request: {
      profile: 'inventory',
      itemIds: [open.item.itemId],
      inventoryFormat: 'csv',
      includeFiles: false,
      includeTextVersions: false,
      includeNotes: false,
    },
    tempDir: root,
    appVersion: '2.7.0-phase10-test',
  });
  const csvEntry = new AdmZip(csvPackage.buffer).getEntry('data/inventory.csv');
  assert.ok(csvEntry.getData().toString('utf8').includes('unitId,itemIds,sourceCount,title,repository'));
  assert.equal(researchExport.validatePrimarySourceResearchPackage(csvPackage.buffer).valid, true);

  const xlsxPackage = await researchExport.createPrimarySourceResearchPackage({
    request: {
      profile: 'inventory',
      itemIds: [open.item.itemId],
      inventoryFormat: 'xlsx',
      includeFiles: false,
      includeTextVersions: false,
      includeNotes: false,
    },
    tempDir: root,
    appVersion: '2.7.0-phase10-test',
  });
  const xlsxEntry = new AdmZip(xlsxPackage.buffer).getEntry('data/inventory.xlsx');
  assert.ok(new AdmZip(xlsxEntry.getData()).getEntry('xl/worksheets/sheet1.xml'));
  assert.equal(researchExport.validatePrimarySourceResearchPackage(xlsxPackage.buffer).valid, true);

  const secondRepresentation = source(
    'Segunda representación de la misma unidad',
    'open',
    'normal',
    'SECOND-REPRESENTATION-PHASE10'
  );
  const openUnitId = db.prepare(
    "SELECT unit_id FROM archive_item_units WHERE item_id=? AND relation_kind='describes' ORDER BY position LIMIT 1"
  ).get(open.item.itemId).unit_id;
  db.prepare(
    "UPDATE archive_item_units SET unit_id=? WHERE item_id=? AND relation_kind='describes'"
  ).run(openUnitId, secondRepresentation.item.itemId);
  const groupedInventoryPackage = await researchExport.createPrimarySourceResearchPackage({
    request: {
      profile: 'inventory',
      itemIds: [open.item.itemId, secondRepresentation.item.itemId],
      inventoryFormat: 'json',
      includeFiles: false,
      includeTextVersions: false,
      includeNotes: false,
    },
    tempDir: root,
    appVersion: '2.7.0-phase10-test',
  });
  const groupedInventory = JSON.parse(
    new AdmZip(groupedInventoryPackage.buffer).getEntry('data/inventory.json').getData().toString('utf8')
  );
  assert.equal(groupedInventory.length, 1, 'inventory emits one row per descriptive unit');
  assert.equal(groupedInventory[0].sourceCount, 2);
  assert.equal(groupedInventory[0].unitId, openUnitId);

  for (const profile of ['evidence_dossier', 'interoperable']) {
    const extraPackage = await researchExport.createPrimarySourceResearchPackage({
      request: {
        profile,
        itemIds: [open.item.itemId],
        inventoryFormat: 'json',
        includeFiles: false,
        includeTextVersions: true,
        includeNotes: false,
      },
      tempDir: root,
      appVersion: '2.7.0-phase10-test',
    });
    const extraZip = new AdmZip(extraPackage.buffer);
    assert.equal(researchExport.validatePrimarySourceResearchPackage(extraPackage.buffer).valid, true);
    if (profile === 'interoperable') {
      assert.ok(extraZip.getEntry('data/places.geojson'));
      assert.ok(extraZip.getEntry('data/graph.json'));
    } else {
      assert.ok(extraZip.getEntry('data/evidence.json'));
    }
  }

  const targetDossierPreview = researchExport.previewPrimarySourceExport({
    profile: 'evidence_dossier',
    itemIds: [],
    evidenceTarget: { kind: 'person', id: dossierPerson.personId },
    inventoryFormat: 'json',
    includeFiles: false,
    includeTextVersions: true,
    includeNotes: false,
  });
  assert.deepEqual(targetDossierPreview.includedItemIds, [open.item.itemId]);
  assert.equal(targetDossierPreview.canExport, true);
  const targetDossier = await researchExport.createPrimarySourceResearchPackage({
    request: targetDossierPreview.request,
    tempDir: root,
    appVersion: '2.7.0-phase10-test',
  });
  const targetZip = new AdmZip(targetDossier.buffer);
  const targetEntry = targetZip.getEntry('data/evidence-target.json');
  assert.ok(targetEntry);
  assert.equal(
    JSON.parse(targetEntry.getData().toString('utf8')).entity.person_id,
    dossierPerson.personId
  );
  assert.deepEqual(targetDossier.manifest.selection.evidenceTarget, {
    kind: 'person',
    id: dossierPerson.personId,
  });
  const targetEvidence = JSON.parse(targetZip.getEntry('data/evidence.json').getData().toString('utf8'));
  assert.deepEqual(targetEvidence.evidence.map((row) => row.id), [dossierEvidence.evidenceId]);
  assert.equal(researchExport.validatePrimarySourceResearchPackage(targetDossier.buffer).valid, true);

  const packageZip = new AdmZip(packageResult.buffer);
  for (const entry of packageZip.getEntries()) {
    const bytes = entry.getData();
    for (const forbidden of [
      restricted.item.itemId,
      'RESTRICTED-TITLE-PHASE10',
      'RESTRICTED-CONTENT-PHASE10',
      'UNKNOWN-TITLE-PHASE10',
      'RESTRICTED-NOTE-CONTENT-PHASE10',
    ]) {
      assert.equal(bytes.includes(Buffer.from(forbidden)), false, `${forbidden} is absent from ${entry.entryName}`);
    }
  }
  const snapshotEntry = packageZip.getEntry('restore/research.sqlite');
  assert.ok(snapshotEntry);
  const snapshotPath = path.join(root, 'phase10-snapshot.sqlite');
  fs.writeFileSync(snapshotPath, snapshotEntry.getData());
  const snapshot = new Database(snapshotPath, { readonly: true });
  try {
    assert.equal(snapshot.pragma('quick_check', { simple: true }), 'ok');
    assert.deepEqual(snapshot.pragma('foreign_key_check'), []);
    assert.equal(snapshot.prepare('SELECT COUNT(*) AS value FROM archive_items WHERE item_id=?').get(restricted.item.itemId).value, 0);
    assert.equal(snapshot.prepare('SELECT title FROM archive_items WHERE item_id=?').get(unknown.item.itemId).title, '[Metadatos redactados]');
    assert.equal(snapshot.prepare('SELECT COUNT(*) AS value FROM archive_item_units WHERE item_id=?').get(unknown.item.itemId).value, 0);
    assert.equal(snapshot.prepare('SELECT extracted_text FROM archive_items WHERE item_id=?').get(open.item.itemId).extracted_text, null);
    assert.equal(snapshot.prepare('SELECT COUNT(*) AS value FROM primary_source_operation_runs').get().value, 0);
    assert.equal(snapshot.prepare('SELECT COUNT(*) AS value FROM notes').get().value, 2);
    assert.equal(snapshot.prepare('SELECT COUNT(*) AS value FROM notes WHERE id=?').get(restrictedNote.id).value, 0);
  } finally {
    snapshot.close();
  }

  const damagedZip = new AdmZip();
  for (const entry of packageZip.getEntries()) {
    damagedZip.addFile(
      entry.entryName,
      entry.entryName === 'data/sources.json' ? Buffer.from('tampered') : entry.getData()
    );
  }
  const damaged = damagedZip.toBuffer();
  const damagedValidation = researchExport.validatePrimarySourceResearchPackage(damaged);
  assert.equal(damagedValidation.valid, false);
  assert.ok(damagedValidation.mismatchedEntries.includes('data/sources.json'));

  const activeBefore = vaultRegistry.getActiveVault();
  const vaultCountBefore = vaultRegistry.listVaults().length;
  const restore = researchExport.restorePrimarySourceResearchPackage({
    buffer: packageResult.buffer,
    tempDir: root,
    name: 'Restauración segura fase 10',
  });
  assert.equal(restore.status, 'restored');
  assert.equal(restore.missingFiles, 0);
  assert.notEqual(restore.resultVaultId, activeBefore.id);
  assert.equal(vaultRegistry.getActiveVault().id, activeBefore.id);
  assert.equal(vaultRegistry.listVaults().length, vaultCountBefore + 1);
  const restoredVault = vaultRegistry.getVault(restore.resultVaultId);
  const restoredDb = new Database(restoredVault.path, { readonly: true });
  try {
    assert.equal(restoredDb.pragma('quick_check', { simple: true }), 'ok');
    assert.deepEqual(restoredDb.pragma('foreign_key_check'), []);
    assert.equal(restoredDb.prepare(
      'SELECT COUNT(*) AS value FROM archive_item_files WHERE content_hash IS NOT NULL AND content_blob IS NULL'
    ).get().value, 0);
    assert.equal(restoredDb.prepare('SELECT COUNT(*) AS value FROM archive_items WHERE item_id=?').get(restricted.item.itemId).value, 0);
    assert.equal(restoredDb.prepare('SELECT COUNT(*) AS value FROM notes').get().value, 2);
  } finally {
    restoredDb.close();
  }

  const originalHash = open.master.contentHash;
  db.prepare('UPDATE archive_item_files SET content_blob=? WHERE file_id=?')
    .run(Buffer.from('CORRUPTED-AFTER-PACKAGE'), open.master.fileId);
  const checked = filesRepo.verifyArchiveFile(open.master.fileId);
  assert.equal(checked.verificationStatus, 'mismatch');
  assert.equal(checked.contentHash, originalHash);
  const incident = db.prepare(
    'SELECT expected_hash, observed_hash, status FROM archive_integrity_checks WHERE file_id=? ORDER BY checked_at DESC LIMIT 1'
  ).get(open.master.fileId);
  assert.equal(incident.status, 'mismatch');
  assert.equal(incident.expected_hash, originalHash);
  assert.notEqual(incident.observed_hash, originalHash);

  governanceRepo.updatePrimarySourcePolicySettings({ retainAutomaticResultsDays: 0 });
  const workspace = governanceRepo.getPrimarySourceGovernanceWorkspace();
  assert.equal(workspace.inventory.schemaVersion, 116);
  assert.deepEqual(workspace.inventory.unclassifiedPrimarySourceTables, []);
  assert.ok(workspace.recentAiAudit.some((entry) => entry.runId === localResult.runId));
  assert.ok(workspace.recentExports.some((entry) => entry.exportId === packageResult.exportId));
  assert.ok(workspace.recentRestores.some((entry) => entry.reportId === restore.reportId));
  assert.ok(workspace.evidenceTargets.some((entry) =>
    entry.kind === 'person' && entry.id === dossierPerson.personId
  ));
  assert.ok(workspace.retentionReviewDue.textVersions >= 1);
  assert.ok(workspace.retentionReviewDue.proposals >= 1);
  assert.deepEqual(db.pragma('foreign_key_check'), []);

  console.log('Primary Sources governance, export and recovery phase test passed!');
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
      getVersion: () => '2.7.0-test',
      getAppPath: () => repoRoot,
      getLocale: () => 'en',
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
