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

if (!process.argv.includes('--electron-primary-sources-archive-test')) {
  const view = fs.readFileSync(path.join(repoRoot, 'src/views/PrimarySourcesArchiveView.tsx'), 'utf8');
  const app = fs.readFileSync(path.join(repoRoot, 'src/App.tsx'), 'utf8');
  const shared = fs.readFileSync(path.join(repoRoot, 'shared/types.ts'), 'utf8');
  const preload = fs.readFileSync(path.join(repoRoot, 'electron/preload.ts'), 'utf8');
  const ipc = fs.readFileSync(path.join(repoRoot, 'electron/ipc.ts'), 'utf8');

  for (const contract of [
    "type DisplayMode = 'table' | 'gallery' | 'hierarchy'",
    "'Ubicación archivística'",
    "'Colecciones de trabajo'",
    'ARCHIVE_SIDEBAR_SESSION_KEY',
    'primary-sources-archive-sidebar',
    'primary-sources-archive-sidebar-toggle',
    "'Ocultar panel lateral'",
    "'Mostrar panel lateral'",
    'BulkEditModal',
    'previewPrimarySourceBulkEdit',
    'PrimarySourceDossierView',
    'primary-source-dossier-modal',
    'primary-sources-archive-grid',
    'ArchiveTablePreview',
    'DocumentIconPicker',
    'DocTypeSelect',
    'UnitModal',
    'IngestModal',
  ]) {
    assert.ok(view.includes(contract), `Archive workspace contains ${contract}`);
  }
  assert.doesNotMatch(
    view,
    /if\s*\(editing\)\s*return\s*<PrimarySourceDossierView/,
    'opening a document keeps the Archive mounted behind the modal'
  );
  assert.match(app, /isPrimarySources[\s\S]*?<PrimarySourcesArchiveView/);
  for (const method of [
    'getPrimarySourcesWorkspace',
    'ingestPrimarySources',
    'createPrimarySourceUnit',
    'previewPrimarySourceBulkEdit',
    'applyPrimarySourceBulkEdit',
  ]) {
    assert.ok(shared.includes(method), `${method} is typed`);
    assert.ok(preload.includes(method), `${method} is exposed`);
  }
  assert.match(ipc, /primarySources:ingest/);
  assert.match(ipc, /ingestArchiveFile/);
  assert.match(ipc, /ensurePrimarySourceProjection/);
  assert.match(ipc, /metadata:\s*input\.documentMetadata/);

  const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-primary-sources-archive-i18n-'));
  try {
    const output = path.join(outDir, 'translations.cjs');
    const baseOutput = path.join(outDir, 'base-translations.cjs');
    execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
      path.join(repoRoot, 'src/i18n.primarySourcesArchive.ts'),
      '--bundle',
      '--platform=node',
      '--format=cjs',
      `--outfile=${output}`,
    ], { cwd: repoRoot, stdio: 'inherit' });
    execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
      path.join(repoRoot, 'src/i18n.primarySources.ts'),
      '--bundle',
      '--platform=node',
      '--format=cjs',
      `--outfile=${baseOutput}`,
    ], { cwd: repoRoot, stdio: 'inherit' });
    const translations = require(output).PRIMARY_SOURCES_ARCHIVE_TRANSLATIONS;
    const baseTranslations = require(baseOutput).PRIMARY_SOURCES_TRANSLATIONS;
    const languages = ['en', 'fr', 'de', 'pt', 'ptBR', 'it', 'tr'];
    const referenceKeys = Object.keys(translations.en).sort();
    for (const language of languages) {
      assert.ok(Object.keys(translations[language]).length >= 120, `${language} has the complete Archive catalogue`);
      assert.deepEqual(Object.keys(translations[language]).sort(), referenceKeys, `${language} has the same Archive keys`);
      assert.ok(Object.values(translations[language]).every(Boolean), `${language} has no blank Archive translations`);
    }
    assert.ok(baseTranslations.en['Añadir fuentes'], 'the shell catalogue is composed with the Archive catalogue');
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }

  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-primary-sources-archive.mjs'), '--electron-primary-sources-archive-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-primary-sources-archive-'));
installRuntimeHooks(root);

try {
  const archive = require(path.join(repoRoot, 'electron/db/archiveRepo.ts'));
  const hierarchy = require(path.join(repoRoot, 'electron/db/archiveHierarchyRepo.ts'));
  const primaryArchive = require(path.join(repoRoot, 'electron/db/primarySourcesArchiveRepo.ts'));
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const sync = require(path.join(repoRoot, 'electron/db/syncTables.ts'));

  const repository = hierarchy.createArchiveRepository({
    name: 'Archivo de la Ciudad',
    shortName: 'AC',
    identifier: 'ES-AC',
  });
  const fonds = primaryArchive.createDescriptionOnlyUnit({
    title: 'Fondo Ayuntamiento',
    level: 'fonds',
    repositoryId: repository.repositoryId,
    referenceCode: 'AC/FA',
  });
  const series = primaryArchive.createDescriptionOnlyUnit({
    title: 'Correspondencia',
    level: 'series',
    parentUnitId: fonds.unitId,
    referenceCode: 'AC/FA/1',
  });
  const session = hierarchy.createCaptureSession({
    title: 'Consulta de verano',
    repositoryId: repository.repositoryId,
    sessionKind: 'consultation',
  });
  const collection = archive.createFolder('Epidemias');

  const masterBytes = Buffer.from('MASTER-BYTES-NEVER-OVERWRITE');
  const item = archive.createItem({
    title: 'carta-001.tif',
    kind: 'image',
    fileName: 'carta-001.tif',
    mimeType: 'image/tiff',
    blob: masterBytes,
    extractedText: 'La epidemia llegó al puerto.',
    tags: ['cólera'],
  });
  const projected = primaryArchive.ensurePrimarySourceProjection(item.itemId, {
    title: 'Carta sobre la epidemia',
    description: 'Correspondencia municipal sobre sanidad.',
    repositoryId: repository.repositoryId,
    parentUnitId: series.unitId,
    referenceCode: 'AC/FA/1/7',
    creatorDisplay: 'Alcaldía',
    dateDisplay: '12 de mayo de 1892',
    dateCertainty: 'exact',
    captureSessionId: session.sessionId,
    collectionIds: [collection.folderId],
    accessStatus: 'restricted',
    sensitivity: 'personal',
    templateId: 'builtin_letter',
    documentIcon: 'chat',
  });
  assert.equal(projected.unit.parentUnitId, series.unitId);
  assert.equal(projected.unit.referenceCode, 'AC/FA/1/7');
  assert.equal(projected.profile.captureSessionId, session.sessionId);
  assert.equal(projected.profile.metadata.documentIcon, 'chat');
  assert.deepEqual(projected.item.folderIds, [collection.folderId]);
  assert.equal(projected.masterCount, 1);
  assert.equal(projected.textVersionCount, 1);
  assert.ok(
    getDb().prepare('SELECT content_blob FROM archive_item_files WHERE item_id=?').get(item.itemId).content_blob.equals(masterBytes),
    'ingest promotion preserves exact master bytes'
  );

  const secondProjection = primaryArchive.ensurePrimarySourceProjection(item.itemId, {
    parentUnitId: series.unitId,
    collectionIds: [collection.folderId],
  });
  assert.equal(secondProjection.masterCount, 1, 'duplicate promotion is idempotent');
  assert.equal(
    getDb().prepare('SELECT COUNT(*) AS count FROM archive_item_units WHERE item_id=?').get(item.itemId).count,
    1
  );

  const classified = archive.updateItem(item.itemId, {
    docType: 'letter',
    metadata: { remitente: 'Archivo de la Ciudad' },
  });
  assert.equal(classified.docType, 'letter');
  assert.equal(classified.metadata.remitente, 'Archivo de la Ciudad');
  const classifiedRow = primaryArchive.getPrimarySourceArchiveRow(item.itemId);
  assert.equal(classifiedRow.profile.metadata.documentIcon, 'chat', 'the custom icon survives catalogue edits');

  const workspace = primaryArchive.getPrimarySourceArchiveWorkspace('epidemia');
  assert.equal(workspace.rows.length, 1, 'metadata search finds the archival unit title');
  assert.equal(workspace.rows[0].item.extractedText, null, 'the list never loads extracted full text');
  assert.ok(workspace.units.some((unit) => unit.unitId === series.unitId));
  assert.ok(workspace.templates.length >= 4, 'built-in description profiles are available');
  assert.equal(workspace.collections[0].name, 'Epidemias');

  const customTemplate = primaryArchive.createDescriptionTemplate({
    name: 'Fotografía de prensa',
    documentType: 'photograph',
    unitDefaults: { titleType: 'supplied' },
    profileDefaults: { accessStatus: 'open' },
  });
  assert.equal(customTemplate.builtin, false);

  const preview = primaryArchive.previewPrimarySourceBulkEdit([item.itemId, 'missing']);
  assert.equal(preview.affected, 1);
  assert.deepEqual(preview.missing, ['missing']);
  const updated = primaryArchive.applyPrimarySourceBulkEdit({
    itemIds: [item.itemId],
    patch: { accessStatus: 'open', addTags: ['revisada'] },
    expectedRevisions: preview.revisions,
  });
  assert.equal(updated[0].profile.accessStatus, 'open');
  assert.ok(updated[0].item.tags.includes('revisada'));
  assert.throws(
    () => primaryArchive.applyPrimarySourceBulkEdit({
      itemIds: [item.itemId],
      patch: { sensitivity: 'normal' },
      expectedRevisions: preview.revisions,
    }),
    /cambió desde la vista previa/,
    'stale bulk edits abort atomically'
  );

  const edited = primaryArchive.updatePrimarySourceArchiveRecord(item.itemId, {
    expectedRevision: updated[0].revision,
    unit: { title: 'Carta sanitaria de mayo', scopeContent: 'Descripción revisada.' },
    profile: { descriptionStatus: 'described' },
  });
  assert.equal(edited.unit.title, 'Carta sanitaria de mayo');
  assert.equal(archive.getItem(item.itemId).title, 'Carta sanitaria de mayo', 'legacy projection changes transactionally');
  assert.equal(archive.getItem(item.itemId).description, 'Descripción revisada.');
  assert.ok(archive.getItemBlob(item.itemId).equals(masterBytes), 'description edits never overwrite old master bytes');

  const coverage = sync.describeSyncCoverage();
  assert.ok(coverage.included.genealogy.includes('archive_description_templates'));
  assert.deepEqual(coverage.unmergeable, []);
  assert.deepEqual(getDb().pragma('foreign_key_check'), []);

  console.log('Primary Sources Archive phase test passed!');
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
