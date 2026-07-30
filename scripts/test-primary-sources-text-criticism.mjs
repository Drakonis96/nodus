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

if (!process.argv.includes('--electron-primary-sources-text-test')) {
  const [view, archiveView, markdown, appView, textRepo, evidenceRepo, shared, preload, ipc, schema, deepLink] = [
    'src/views/PrimarySourceDossierView.tsx',
    'src/views/PrimarySourcesArchiveView.tsx',
    'src/components/Markdown.tsx',
    'src/App.tsx',
    'electron/db/archiveTextsRepo.ts',
    'electron/db/archiveEvidenceRepo.ts',
    '@api',
    '@bridge',
    '@main',
    'electron/db/migrations.ts',
    'shared/primarySourceDeepLink.ts',
  ].map((file) => readSource(file));

  for (const marker of [
    'primary-source-text-workspace',
    'primary-source-text-editor',
    'primary-source-critical-analysis',
    'Versiones de texto',
    'Segmentos y páginas',
    'Fragmentos citables',
    'Corregir en nueva versión',
    'Crear fragmento citable',
    'Crítica externa',
    'Crítica interna',
  ]) assert.ok(view.includes(marker), `phase 5 UI contains ${marker}`);
  assert.match(textRepo, /createPrimarySourceTextVersion/);
  assert.match(textRepo, /parentPreserved/);
  assert.match(evidenceRepo, /createStableArchiveExcerpt/);
  assert.match(evidenceRepo, /version\.content\.slice\(input\.startOffset, input\.endOffset\)/);
  assert.ok(Number(schema.match(/SCHEMA_VERSION = (\d+)/)[1]) >= 110,
    'the text-criticism migration is applied');
  assert.match(schema, /archive_text_versions_preserve_content/);
  assert.match(schema, /archive_excerpts_preserve_anchor/);
  assert.match(deepLink, /nodus:\/\/primary-source\//);
  assert.match(markdown, /nodus:navigate-primary-source/);
  assert.match(appView, /primarySourceTarget/);
  assert.match(archiveView, /initialExcerptId=\{deepLinkedExcerptId\}/);

  for (const method of [
    'createPrimarySourceTextVersion',
    'setPrimarySourceTextReviewStatus',
    'createPrimarySourceExcerpt',
    'setPrimarySourceExcerptReviewStatus',
    'savePrimarySourceAnalysis',
  ]) {
    assert.ok(shared.includes(method), `${method} is typed`);
    assert.ok(preload.includes(method), `${method} is exposed`);
  }
  assert.match(ipc, /primarySources:text:create/);
  assert.match(ipc, /primarySources:excerpt:create/);
  assert.match(ipc, /primarySources:analysis:save/);

  const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-primary-text-i18n-'));
  try {
    const output = path.join(outDir, 'translations.cjs');
    execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
      path.join(repoRoot, 'src/i18n.primarySourcesText.ts'),
      '--bundle',
      '--platform=node',
      '--format=cjs',
      `--outfile=${output}`,
    ], { cwd: repoRoot, stdio: 'inherit' });
    const translations = require(output).PRIMARY_SOURCES_TEXT_TRANSLATIONS;
    const reference = Object.keys(translations.en).sort();
    assert.ok(reference.length >= 60, 'phase 5 translation catalogue is substantive');
    for (const language of ['en', 'fr', 'de', 'pt', 'ptBR', 'it', 'tr']) {
      assert.deepEqual(Object.keys(translations[language]).sort(), reference, `${language} has every phase 5 key`);
      assert.ok(Object.values(translations[language]).every(Boolean), `${language} has no blank phase 5 copy`);
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }

  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-primary-sources-text-criticism.mjs'), '--electron-primary-sources-text-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-primary-text-'));
installRuntimeHooks(root);

try {
  const archive = require(path.join(repoRoot, 'electron/db/archiveRepo.ts'));
  const primary = require(path.join(repoRoot, 'electron/db/primarySourcesArchiveRepo.ts'));
  const textRepo = require(path.join(repoRoot, 'electron/db/archiveTextsRepo.ts'));
  const evidenceRepo = require(path.join(repoRoot, 'electron/db/archiveEvidenceRepo.ts'));
  const auditRepo = require(path.join(repoRoot, 'electron/db/archiveAuditRepo.ts'));
  const deepLinks = require(path.join(repoRoot, 'shared/primarySourceDeepLink.ts'));
  const { getDb, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/database.ts'));

  assert.ok(SCHEMA_VERSION >= 110);
  const item = archive.createItem({
    title: 'Carta sobre la epidemia',
    kind: 'text',
    fileName: 'carta.txt',
    mimeType: 'text/plain',
    blob: Buffer.from('preserved-file-bytes', 'utf8'),
  });
  primary.ensurePrimarySourceProjection(item.itemId, {
    title: 'Carta sobre la epidemia',
    referenceCode: 'AMPC/FPC/1/3',
  });
  const master = primary.getPrimarySourceDossier(item.itemId).files[0];

  const automaticContent = 'Mi estimado Juan:\nEl colera ha llegado.\fAyer salieron dose cajas al lazareto.';
  const automatic = textRepo.createPrimarySourceTextVersion({
    itemId: item.itemId,
    fileId: master.fileId,
    kind: 'ocr',
    languageCode: 'es',
    content: automaticContent,
    status: 'automatic',
    engine: 'tesseract',
    confidence: 0.88,
    createdBy: 'local_ocr',
  });
  assert.equal(automatic.version.kind, 'ocr');
  assert.equal(automatic.segments.length, 2, 'form-feed input is split into stable pages');
  assert.equal(automatic.segments[0].pageLabel, '1');
  assert.equal(automatic.segments[1].pageLabel, '2');
  assert.equal(
    automatic.version.content.slice(
      automatic.segments[1].startOffset,
      automatic.segments[1].endOffset
    ),
    automatic.segments[1].content
  );

  const correctedContent = 'Mi estimado Juan:\nEl cólera ha llegado.\fAyer salieron doce cajas al lazareto.';
  const corrected = textRepo.createPrimarySourceTextVersion({
    itemId: item.itemId,
    parentVersionId: automatic.version.textVersionId,
    kind: 'diplomatic',
    languageCode: 'es',
    content: correctedContent,
    status: 'in_review',
    editorialConventions: 'Acentuación restituida; grafía documental preservada.',
    createdBy: 'researcher',
  });
  assert.equal(corrected.version.parentVersionId, automatic.version.textVersionId);
  assert.equal(corrected.version.fileId, master.fileId, 'child inherits the source file');
  assert.equal(
    textRepo.getArchiveTextVersion(automatic.version.textVersionId).content,
    automaticContent,
    'correcting creates a child and never rewrites OCR'
  );
  assert.throws(
    () => getDb().prepare(
      'UPDATE archive_text_versions SET content=? WHERE text_version_id=?'
    ).run('silently overwritten', automatic.version.textVersionId),
    /immutable/,
    'database guard rejects accidental source-text overwrite'
  );

  const reviewed = textRepo.setArchiveTextReviewStatus(corrected.version.textVersionId, 'reviewed');
  assert.equal(reviewed.status, 'reviewed');
  assert.equal(reviewed.content, correctedContent, 'review status is mutable without changing text');

  const quoteStart = correctedContent.indexOf('Ayer');
  const quoteEnd = correctedContent.length;
  const secondPage = corrected.segments[1];
  const excerpt = evidenceRepo.createStableArchiveExcerpt({
    itemId: item.itemId,
    textVersionId: corrected.version.textVersionId,
    segmentId: secondPage.segmentId,
    startOffset: quoteStart,
    endOffset: quoteEnd,
    locatorDisplay: 'fol. 3v, líneas 1–2',
    description: 'Movimiento de suministros',
    reviewStatus: 'unreviewed',
    createdBy: 'researcher',
  });
  assert.equal(excerpt.quotedText, correctedContent.slice(quoteStart, quoteEnd));
  assert.deepEqual(excerpt.locator.textRange, { start: quoteStart, end: quoteEnd });
  assert.equal(excerpt.locator.segmentId, secondPage.segmentId);
  assert.equal(excerpt.locator.pageLabel, '2');
  assert.throws(
    () => getDb().prepare(
      'UPDATE archive_excerpts SET quoted_text=? WHERE excerpt_id=?'
    ).run('rewritten quote', excerpt.excerptId),
    /immutable/,
    'database guard rejects changing a cited snapshot'
  );

  const normalized = textRepo.createPrimarySourceTextVersion({
    itemId: item.itemId,
    parentVersionId: corrected.version.textVersionId,
    kind: 'normalized',
    content: correctedContent.replace('Mi estimado', 'Estimado'),
    languageCode: 'es',
    status: 'in_review',
    createdBy: 'researcher',
  });
  assert.equal(normalized.version.parentVersionId, corrected.version.textVersionId);
  assert.equal(
    evidenceRepo.getArchiveExcerpt(excerpt.excerptId).quotedText,
    correctedContent.slice(quoteStart, quoteEnd),
    'later text versions do not rewrite the citation snapshot'
  );

  const link = deepLinks.primarySourceExcerptDeepLink(item.itemId, excerpt.excerptId);
  assert.deepEqual(deepLinks.parsePrimarySourceExcerptDeepLink(link), {
    itemId: item.itemId,
    excerptId: excerpt.excerptId,
  });
  assert.equal(deepLinks.parsePrimarySourceExcerptDeepLink('nodus://idea/example'), null);

  const reviewedExcerpt = evidenceRepo.setArchiveExcerptReviewStatus(excerpt.excerptId, 'reviewed');
  assert.equal(reviewedExcerpt.reviewStatus, 'reviewed');
  assert.equal(reviewedExcerpt.quotedText, excerpt.quotedText);

  const analysis = evidenceRepo.savePrimarySourceAnalysis(item.itemId, {
    originNotes: 'Donación familiar con cadena de custodia documentada.',
    purposeAudience: 'Carta privada dirigida a un intermediario municipal.',
    contentForm: 'Carta manuscrita.',
    perspectiveBias: 'Perspectiva logística del entorno portuario.',
    silencesLimits: 'No incluye testimonios de pacientes.',
    authenticityNotes: 'Soporte y tinta compatibles con la fecha.',
    representativeness: 'Un caso dentro de una serie incompleta.',
    corroboration: 'Coincide con el libro municipal de actas.',
    questions: 'Localizar el parte médico semanal.',
    status: 'reviewed',
  });
  assert.equal(analysis.status, 'reviewed');
  assert.equal(
    getDb().prepare('SELECT analysis_status FROM archive_item_profiles WHERE item_id=?').get(item.itemId).analysis_status,
    'reviewed'
  );

  const dossier = primary.getPrimarySourceDossier(item.itemId);
  assert.equal(dossier.textVersions.length, 3);
  assert.equal(dossier.textSegments.length, 6);
  assert.equal(dossier.excerpts.length, 1);
  assert.equal(dossier.analysis.analysisId, analysis.analysisId);
  assert.ok(dossier.history.some((event) => event.action === 'text_version_created'));
  assert.ok(dossier.history.some((event) => event.action === 'text_review_status_changed'));
  assert.ok(dossier.history.some((event) => event.action === 'excerpt_created'));
  assert.ok(dossier.history.some((event) => event.action === 'excerpt_review_status_changed'));
  assert.ok(dossier.history.some((event) => event.action === 'source_analysis_saved'));
  assert.ok(auditRepo.listArchiveAudit(item.itemId).length >= 7);
  assert.deepEqual(getDb().pragma('foreign_key_check'), []);

  console.log('Primary Sources text, excerpts and criticism phase test passed!');
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
