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

if (!process.argv.includes('--electron-primary-sources-files-test')) {
  const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const [view, archiveView, protocol, fileRepo, shared, preload, ipc, schema, sync] = [
    'src/views/PrimarySourceDossierView.tsx',
    'src/views/PrimarySourcesArchiveView.tsx',
    'electron/archiveProtocol.ts',
    'electron/db/archiveFilesRepo.ts',
    'shared/types.ts',
    'electron/preload.ts',
    'electron/ipc.ts',
    'electron/db/migrations.ts',
    'electron/db/syncTables.ts',
  ].map((file) => fs.readFileSync(path.join(repoRoot, file), 'utf8'));
  for (const marker of [
    'primary-source-image-viewer',
    'primary-source-pdf-viewer',
    'primary-source-audio-viewer',
    'primary-source-video-viewer',
    'primary-source-text-viewer',
    'primary-source-table-viewer',
    'primary-source-unsupported-viewer',
    'Range: `bytes=0-${limit - 1}`',
    'Nueva versión',
    'Regenerar miniatura',
    'Historial auditable',
  ]) assert.ok(view.includes(marker), `deep dossier contains ${marker}`);
  assert.match(archiveView, /<PrimarySourceDossierView/);
  assert.match(archiveView, /<ArchiveGalleryPreview row=\{row\}/);
  assert.match(archiveView, /src=\{archiveFileUrl\(file\)\}/);
  for (const directive of ['img-src', 'media-src', 'connect-src', 'frame-src']) {
    assert.match(indexHtml, new RegExp(`${directive}[^;]*nodus-archive:`), `${directive} permits preserved previews`);
  }
  assert.match(fileRepo, /substr\(content_blob/);
  assert.match(protocol, /Content-Range/);
  assert.match(protocol, /Accept-Ranges/);
  assert.match(protocol, /status: parsed \? 206 : 200/);
  for (const method of [
    'getPrimarySourceDossier',
    'addPrimarySourceFiles',
    'verifyPrimarySourceFiles',
    'regeneratePrimarySourceThumbnail',
    'savePrimarySourceFile',
    'openPrimarySourceFileExternal',
  ]) {
    assert.ok(shared.includes(method), `${method} is typed`);
    assert.ok(preload.includes(method), `${method} is exposed`);
  }
  assert.match(ipc, /primarySources:files:verifyAll/);
  assert.match(ipc, /primarySources:files:thumbnail/);
  assert.ok(Number(schema.match(/SCHEMA_VERSION = (\d+)/)[1]) >= 109,
    'the files-viewer migration is applied');
  assert.match(schema, /CREATE TABLE archive_audit_log/);
  assert.match(sync, /'archive_audit_log'/);

  const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-primary-files-i18n-'));
  try {
    const output = path.join(outDir, 'translations.cjs');
    execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
      path.join(repoRoot, 'src/i18n.primarySourcesFiles.ts'),
      '--bundle',
      '--platform=node',
      '--format=cjs',
      `--outfile=${output}`,
    ], { cwd: repoRoot, stdio: 'inherit' });
    const translations = require(output).PRIMARY_SOURCES_FILES_TRANSLATIONS;
    const reference = Object.keys(translations.en).sort();
    for (const language of ['en', 'fr', 'de', 'pt', 'ptBR', 'it', 'tr']) {
      assert.deepEqual(Object.keys(translations[language]).sort(), reference, `${language} has every preservation key`);
      assert.ok(Object.values(translations[language]).every(Boolean), `${language} has no blank preservation copy`);
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }

  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-primary-sources-files-viewer.mjs'), '--electron-primary-sources-files-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-primary-files-'));
const protocolHandlers = new Map();
installRuntimeHooks(root, protocolHandlers);

try {
  const sharp = require('sharp');
  const archive = require(path.join(repoRoot, 'electron/db/archiveRepo.ts'));
  const primary = require(path.join(repoRoot, 'electron/db/primarySourcesArchiveRepo.ts'));
  const files = require(path.join(repoRoot, 'electron/db/archiveFilesRepo.ts'));
  const audit = require(path.join(repoRoot, 'electron/db/archiveAuditRepo.ts'));
  const archiveProtocol = require(path.join(repoRoot, 'electron/archiveProtocol.ts'));
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const sync = require(path.join(repoRoot, 'electron/db/syncTables.ts'));

  const originalPng = await sharp({
    create: { width: 900, height: 600, channels: 3, background: '#7c3aed' },
  }).png().toBuffer();
  const legacy = archive.createItem({
    title: 'Placa de vidrio',
    kind: 'image',
    fileName: 'placa.png',
    mimeType: 'image/png',
    blob: originalPng,
  });
  primary.ensurePrimarySourceProjection(legacy.itemId, {
    title: 'Placa de vidrio del puerto',
    referenceCode: 'AP/IMG/12',
  });
  const firstDossier = primary.getPrimarySourceDossier(legacy.itemId);
  assert.equal(firstDossier.files.length, 1);
  const originalMaster = firstDossier.files[0];
  assert.equal(originalMaster.role, 'master');
  assert.ok(files.getArchiveFileBlob(originalMaster.fileId).equals(originalPng));
  assert.ok(firstDossier.history.some((event) => event.action === 'file_created'), 'pre-audit masters get visible history');

  const accessPath = path.join(root, 'placa-access.jpg');
  const accessBytes = await sharp(originalPng).resize(450).jpeg({ quality: 72 }).toBuffer();
  fs.writeFileSync(accessPath, accessBytes);
  const [access] = files.createArchiveFilesFromPaths({
    itemId: legacy.itemId,
    paths: [accessPath],
    role: 'access',
    parentFileId: originalMaster.fileId,
    sequenceNo: 0,
    transformation: {
      operation: 'resize_and_compress',
      engine: 'sharp',
      parameters: { width: 450, quality: 72 },
    },
  });
  assert.equal(access.parentFileId, originalMaster.fileId);
  assert.equal(access.role, 'access');
  assert.equal(access.transformation.operation, 'resize_and_compress');
  assert.ok(files.getArchiveFileBlob(access.fileId).equals(accessBytes));
  assert.throws(
    () => files.createArchiveFilesFromPaths({
      itemId: legacy.itemId,
      paths: [accessPath],
      role: 'derivative',
      transformation: { operation: 'crop' },
    }),
    /archivo del que proceden/,
    'derived representations cannot be orphaned'
  );

  const oldExpectedHash = originalMaster.contentHash;
  const replacementPath = path.join(root, 'placa-rescan.png');
  const replacementBytes = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: '#0f766e' },
  }).png().toBuffer();
  fs.writeFileSync(replacementPath, replacementBytes);
  const [newMaster] = files.createArchiveFilesFromPaths({
    itemId: legacy.itemId,
    paths: [replacementPath],
    role: 'master',
    supersedesFileId: originalMaster.fileId,
    sequenceNo: 0,
  });
  assert.equal(newMaster.versionNo, 2);
  assert.ok(files.getArchiveFile(originalMaster.fileId).supersededAt, 'old master is marked, never replaced');
  assert.ok(files.getArchiveFileBlob(originalMaster.fileId).equals(originalPng), 'old master bytes remain exact');
  assert.ok(files.getArchiveFileBlob(newMaster.fileId).equals(replacementBytes), 'new version has independent bytes');
  assert.notEqual(newMaster.contentHash, oldExpectedHash);

  const slice = files.getArchiveFileBlobSlice(newMaster.fileId, 17, 143);
  assert.ok(slice.equals(replacementBytes.subarray(17, 143)), 'SQLite BLOB ranges return only the requested bytes');
  assert.deepEqual(archiveProtocol.parseArchiveByteRange('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepEqual(archiveProtocol.parseArchiveByteRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.equal(archiveProtocol.parseArchiveByteRange('bytes=100-200', 100), 'invalid');

  archiveProtocol.registerArchiveProtocol();
  const handler = protocolHandlers.get('nodus-archive');
  assert.equal(typeof handler, 'function');
  const rangeResponse = await handler(new Request(
    `nodus-archive://file/${encodeURIComponent(newMaster.fileId)}?v=${newMaster.contentHash}`,
    { headers: { Range: 'bytes=20-119' } }
  ));
  assert.equal(rangeResponse.status, 206);
  assert.equal(rangeResponse.headers.get('accept-ranges'), 'bytes');
  assert.equal(rangeResponse.headers.get('content-range'), `bytes 20-119/${replacementBytes.byteLength}`);
  assert.ok(Buffer.from(await rangeResponse.arrayBuffer()).equals(replacementBytes.subarray(20, 120)));

  const thumbnail = await files.regenerateArchiveThumbnail(newMaster.fileId);
  assert.equal(thumbnail.role, 'thumbnail');
  assert.equal(thumbnail.parentFileId, newMaster.fileId);
  assert.equal(thumbnail.transformation.regenerable, true);
  assert.ok(['image/jpeg', 'image/svg+xml'].includes(thumbnail.mimeType));
  const thumbMetadata = await sharp(files.getArchiveFileBlob(thumbnail.fileId)).metadata();
  assert.ok(Math.max(thumbMetadata.width, thumbMetadata.height) <= 480);
  const secondThumbnail = await files.regenerateArchiveThumbnail(newMaster.fileId);
  assert.ok(files.getArchiveFile(thumbnail.fileId).supersededAt, 'regeneration preserves and supersedes the prior thumbnail');
  assert.equal(secondThumbnail.versionNo, thumbnail.versionNo + 1);
  const galleryRow = primary.getPrimarySourceArchiveRow(legacy.itemId);
  assert.equal(galleryRow.previewFile.fileId, secondThumbnail.fileId, 'gallery prefers the current generated thumbnail');
  assert.equal(galleryRow.previewFile.hasContent, true);

  const secondPagePath = path.join(root, 'placa-page-2.png');
  fs.writeFileSync(secondPagePath, originalPng);
  const [secondPage] = files.createArchiveFilesFromPaths({
    itemId: legacy.itemId,
    paths: [secondPagePath],
    role: 'master',
    sequenceNo: 1,
    pageLabel: 'Placa 2',
  });
  files.reorderArchiveFileGroups(legacy.itemId, [secondPage.fileId, newMaster.fileId]);
  assert.equal(files.getArchiveFile(secondPage.fileId).sequenceNo, 0);
  assert.equal(files.getArchiveFile(newMaster.fileId).sequenceNo, 1);
  assert.equal(files.getArchiveFile(originalMaster.fileId).sequenceNo, 1, 'superseded versions follow their active group');
  assert.equal(files.getArchiveFile(access.fileId).sequenceNo, 1, 'derivatives follow the parent representation group');
  assert.equal(files.getArchiveFile(secondThumbnail.fileId).sequenceNo, 1, 'regenerated thumbnails follow the parent group');

  // Corrupt the bytes deliberately: verification must record the mismatch and must
  // never bless corruption by replacing the expected checksum.
  const tampered = Buffer.from(replacementBytes);
  tampered[Math.floor(tampered.length / 2)] ^= 0xff;
  getDb().prepare('UPDATE archive_item_files SET content_blob=? WHERE file_id=?').run(tampered, newMaster.fileId);
  const verified = files.verifyArchiveFile(newMaster.fileId);
  assert.equal(verified.verificationStatus, 'mismatch');
  assert.equal(verified.contentHash, newMaster.contentHash, 'expected checksum remains immutable');
  const check = getDb().prepare(
    'SELECT expected_hash, observed_hash, status FROM archive_integrity_checks WHERE file_id=? ORDER BY checked_at DESC LIMIT 1'
  ).get(newMaster.fileId);
  assert.equal(check.expected_hash, newMaster.contentHash);
  assert.notEqual(check.observed_hash, check.expected_hash);
  assert.equal(check.status, 'mismatch');

  const dossier = primary.getPrimarySourceDossier(legacy.itemId);
  assert.equal(dossier.integrity.mismatch, 1);
  assert.equal(dossier.integrity.orphanDerivatives, 0);
  assert.ok(dossier.history.some((event) => event.action === 'master_version_added'));
  assert.ok(dossier.history.some((event) => event.action === 'thumbnail_regenerated'));
  assert.ok(dossier.history.some((event) => event.action === 'integrity_checked'));
  assert.ok(audit.listArchiveAudit(legacy.itemId).length >= 8);
  assert.ok(sync.describeSyncCoverage().included.genealogy.includes('archive_audit_log'));
  assert.deepEqual(sync.describeSyncCoverage().unmergeable, []);
  assert.deepEqual(getDb().pragma('foreign_key_check'), []);

  console.log('Primary Sources files/viewer phase test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath, protocolHandlers) {
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
      handle: (scheme, handler) => protocolHandlers.set(scheme, handler),
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
