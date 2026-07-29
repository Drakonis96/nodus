import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-primary-sources-performance-test')) {
  const workspaceSource = fs.readFileSync(
    path.join(repoRoot, 'electron/db/primarySourcesArchiveRepo.ts'),
    'utf8',
  );
  const archiveSource = fs.readFileSync(
    path.join(repoRoot, 'electron/db/archiveRepo.ts'),
    'utf8',
  );
  const fileSource = fs.readFileSync(
    path.join(repoRoot, 'electron/db/archiveFilesRepo.ts'),
    'utf8',
  );
  const listImplementation = workspaceSource.slice(
    workspaceSource.indexOf('function queryPrimarySourceArchiveRows'),
    workspaceSource.indexOf('export function getPrimarySourceDossier'),
  );
  assert.doesNotMatch(listImplementation, /tv\.content|content_blob|\bblob\b/i);
  assert.match(archiveSource, /NULL AS extracted_text/);
  assert.match(fileSource, /\(content_blob IS NOT NULL\) AS has_content/);

  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [
      path.join(repoRoot, 'scripts/test-primary-sources-performance.mjs'),
      '--electron-primary-sources-performance-test',
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit',
    },
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-primary-performance-'));
installRuntimeHooks(root);

try {
  const { getDb, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const workspaceRepo = require(path.join(repoRoot, 'electron/db/primarySourcesArchiveRepo.ts'));
  const researchRepo = require(path.join(repoRoot, 'electron/db/primarySourceResearchRepo.ts'));
  const db = getDb();
  assert.equal(SCHEMA_VERSION, 116);
  vaults.setVaultType(vaults.getActiveVault().id, 'primary_sources');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec('ANALYZE');

  const ts = '2026-01-01T00:00:00.000Z';
  db.prepare(
    `INSERT INTO archive_repositories (
      repository_id, name, short_name, identifier, created_at, updated_at
    ) VALUES ('perf-repo', 'Archivo de rendimiento ficticio', 'ARF', 'ARF', ?, ?)`,
  ).run(ts, ts);
  db.prepare(
    `INSERT INTO archive_description_units (
      unit_id, repository_id, parent_unit_id, level, reference_code, title,
      title_type, date_certainty, language_codes_json, script_codes_json,
      position, metadata_json, created_at, updated_at
    ) VALUES (
      'perf-root', 'perf-repo', NULL, 'fonds', 'ARF', 'Fondo de rendimiento',
      'formal', 'exact', '["es"]', '["Latn"]', 0, '{}', ?, ?
    )`,
  ).run(ts, ts);

  const insertUnit = db.prepare(
    `INSERT INTO archive_description_units (
      unit_id, repository_id, parent_unit_id, level, reference_code, title,
      title_type, date_display, date_start_sort, date_end_sort, date_certainty,
      creator_display, scope_content, language_codes_json, script_codes_json,
      position, metadata_json, created_at, updated_at
    ) VALUES (?, 'perf-repo', 'perf-root', 'item', ?, ?, 'formal', '1900',
      '1900-01-01', '1900-12-31', 'year', 'Institución ficticia',
      ?, '["es"]', '["Latn"]', ?, '{}', ?, ?)`,
  );
  const insertItem = db.prepare(
    `INSERT INTO archive_items (
      item_id, title, kind, file_name, mime_type, bytes, blob, extracted_text,
      description, content_hash, created_at, updated_at
    ) VALUES (?, ?, 'document', NULL, 'image/tiff', 0, NULL, NULL, ?, NULL, ?, ?)`,
  );
  const insertLink = db.prepare(
    `INSERT INTO archive_item_units (
      item_id, unit_id, relation_kind, position, created_at
    ) VALUES (?, ?, 'describes', 0, ?)`,
  );
  const insertProfile = db.prepare(
    `INSERT INTO archive_item_profiles (
      item_id, date_certainty, access_status, sensitivity, processing_status,
      description_status, analysis_status, citation_status, metadata_json,
      created_at, updated_at
    ) VALUES (?, 'year', 'open', 'normal', 'described', 'complete',
      'not_started', 'ready', '{}', ?, ?)`,
  );
  const insertFile = db.prepare(
    `INSERT INTO archive_item_files (
      file_id, item_id, parent_file_id, role, version_no, sequence_no,
      page_label, original_file_name, mime_type, byte_size, content_blob,
      external_path, content_hash, hash_algorithm, transformation_json,
      capture_metadata_json, created_by, created_at, verified_at,
      verification_status, superseded_at
    ) VALUES (?, ?, NULL, 'master', 1, ?, ?, ?, 'image/tiff', 0, NULL,
      ?, NULL, NULL, NULL, '{"benchmark":true}', 'performance_fixture',
      ?, NULL, 'pending', NULL)`,
  );
  const insertText = db.prepare(
    `INSERT INTO archive_text_versions (
      text_version_id, item_id, file_id, parent_version_id, kind, language_code,
      content, status, engine, model, confidence, editorial_conventions,
      created_by, created_at, updated_at, reviewed_at
    ) VALUES (?, ?, NULL, NULL, 'transcription', 'es', ?, 'reviewed',
      'performance_fixture', NULL, 1, 'diplomatic', 'performance_fixture',
      ?, ?, ?)`,
  );

  const seedSources = db.transaction((from, to, pagesPerSource, includeText) => {
    for (let index = from; index < to; index += 1) {
      const suffix = String(index).padStart(6, '0');
      const itemId = `perf-item-${suffix}`;
      const unitId = `perf-unit-${suffix}`;
      const title = `Unidad documental de rendimiento ${suffix}`;
      const scope = index === 4_242
        ? 'Descripción benchmark con aguja-medio-4242'
        : `Descripción benchmark de la unidad ${suffix}`;
      insertUnit.run(
        unitId,
        `ARF/SER/${suffix}`,
        title,
        scope,
        index + 1,
        ts,
        ts,
      );
      insertItem.run(itemId, title, scope, ts, ts);
      insertLink.run(itemId, unitId, ts);
      insertProfile.run(itemId, ts, ts);
      if (includeText) {
        insertText.run(
          `perf-text-${suffix}`,
          itemId,
          index === 4_242
            ? 'Transcripción benchmark aguja-medio-4242 de una fuente ficticia.'
            : `Transcripción benchmark de la fuente ficticia ${suffix}.`,
          ts,
          ts,
          ts,
        );
      }
      for (let page = 0; page < pagesPerSource; page += 1) {
        insertFile.run(
          `perf-file-${suffix}-${page}`,
          itemId,
          page,
          `p. ${page + 1}`,
          `ARF_${suffix}_${page + 1}.tif`,
          `/fixture/not-materialized/${suffix}/${page + 1}.tif`,
          ts,
        );
      }
    }
  });

  seedSources(0, 100, 5, true);
  assert.equal(count('archive_description_units') - 1, 100, 'small corpus has 100 units');
  assert.equal(count('archive_item_files'), 500, 'small corpus has 500 files/pages');
  const smallPage = workspaceRepo.getPrimarySourceArchiveWorkspace('', 0, 200);
  assert.equal(smallPage.page.total, 100);
  assert.equal(smallPage.page.hasMore, false);

  seedSources(100, 10_000, 5, true);
  db.exec('ANALYZE');
  assert.equal(count('archive_description_units') - 1, 10_000, 'medium corpus has 10,000 units');
  assert.equal(count('archive_item_files'), 50_000, 'medium corpus has 50,000 pages');

  const initial = measure(() => workspaceRepo.getPrimarySourceArchiveWorkspace('', 0, 200));
  assert.ok(initial.elapsedMs < 1_500, `medium initial list took ${initial.elapsedMs.toFixed(1)} ms`);
  assert.equal(initial.value.rows.length, 200);
  assert.equal(initial.value.page.total, 10_000);
  assert.equal(initial.value.page.hasMore, true);
  assert.equal(initial.value.page.unitsTruncated, true);
  assert.ok(initial.value.rows.every((row) => row.item.extractedText === null));

  const filtered = measure(() =>
    workspaceRepo.getPrimarySourceArchiveWorkspace('aguja-medio-4242', 0, 200),
  );
  assert.ok(filtered.elapsedMs < 300, `medium metadata filter took ${filtered.elapsedMs.toFixed(1)} ms`);
  assert.equal(filtered.value.page.total, 1);

  const dossier = measure(() => workspaceRepo.getPrimarySourceDossier('perf-item-004242'));
  assert.ok(dossier.elapsedMs < 500, `medium dossier took ${dossier.elapsedMs.toFixed(1)} ms`);
  assert.equal(dossier.value.files.length, 5);
  assert.equal(dossier.value.files.every((file) => file.hasContent === false), true);

  const search = measure(() => researchRepo.searchPrimarySourceCorpus({
    query: '"aguja-medio-4242"',
    limit: 100,
  }));
  assert.ok(search.elapsedMs < 1_000, `medium text search took ${search.elapsedMs.toFixed(1)} ms`);
  assert.ok(search.value.results.some((result) => result.itemId === 'perf-item-004242'));

  seedSources(10_000, 100_000, 0, false);
  db.exec('ANALYZE');
  assert.equal(count('archive_description_units') - 1, 100_000, 'large corpus has 100,000 metadata units');
  assert.equal(count('archive_item_files'), 50_000, 'large corpus keeps a bounded file subset');
  const largePage = measure(() => workspaceRepo.getPrimarySourceArchiveWorkspace('', 0, 200));
  assert.equal(largePage.value.rows.length, 200);
  assert.equal(largePage.value.page.total, 100_000);
  assert.equal(largePage.value.page.hasMore, true);
  assert.equal(largePage.value.page.unitsTruncated, true);
  assert.ok(largePage.value.units.length <= 2_000);
  assert.ok(
    Buffer.byteLength(JSON.stringify(largePage.value), 'utf8') < 5_000_000,
    'large-corpus listing payload remains bounded below 5 MB',
  );

  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
  console.log(JSON.stringify({
    small: { units: 100, files: 500 },
    medium: {
      units: 10_000,
      pages: 50_000,
      initialListMs: round(initial.elapsedMs),
      metadataFilterMs: round(filtered.elapsedMs),
      dossierMs: round(dossier.elapsedMs),
      textSearchMs: round(search.elapsedMs),
    },
    large: {
      units: 100_000,
      fileSubset: 50_000,
      initialListMs: round(largePage.elapsedMs),
      payloadBytes: Buffer.byteLength(JSON.stringify(largePage.value), 'utf8'),
    },
  }, null, 2));
  console.log('Primary Sources performance budgets passed!');

  function count(table) {
    return Number(db.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get().value);
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

function measure(operation) {
  const started = performance.now();
  const value = operation();
  return { value, elapsedMs: performance.now() - started };
}

function round(value) {
  return Math.round(value * 10) / 10;
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
      getLocale: () => 'es',
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(String(value), 'utf8'),
      decryptString: (value) => Buffer.from(value).toString('utf8'),
    },
    protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    }
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
