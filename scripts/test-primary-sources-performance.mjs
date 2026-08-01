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
  assert.ok(SCHEMA_VERSION >= 118, 'the primary-sources migrations are part of the schema');
  vaults.setVaultType(vaults.getActiveVault().id, 'primary_sources');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec('ANALYZE');
  const work = installWorkRecorder(db);

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

  const CORPUS_TABLES = [
    'archive_items',
    'archive_description_units',
    'archive_item_units',
    'archive_item_profiles',
    'archive_item_files',
    'archive_text_versions',
    'archive_excerpts',
  ];

  const initial = work.measure('medium initial list', () =>
    workspaceRepo.getPrimarySourceArchiveWorkspace('', 0, 200),
  );
  assert.equal(initial.value.rows.length, 200);
  assert.equal(initial.value.page.total, 10_000);
  assert.equal(initial.value.page.hasMore, true);
  assert.equal(initial.value.page.unitsTruncated, true);
  assert.ok(initial.value.rows.every((row) => row.item.extractedText === null));
  // A listing pages: the detail queries are keyed by the 200 ids on screen plus
  // the bounded hierarchy slice, never by the size of the archive. Dropping the
  // LIMIT or fanning a query out per row is what this number catches.
  assert.ok(
    initial.rowsToJs <= 4_000,
    `medium initial list moved ${initial.rowsToJs} rows into JavaScript`,
  );
  assert.ok(
    initial.statements <= 30,
    `medium initial list issued ${initial.statements} statements`,
  );
  // The COUNT and the paged SELECT each sweep the join — the listing groups and
  // sorts the whole archive to cut one page out of it — so a handful of passes
  // is expected. More than five means another full-corpus query has slipped
  // into opening a screen.
  assert.ok(
    initial.sweptRows <= 5 * 10_000,
    `medium initial list walked ${initial.sweptRows} rows over a 10,000-source archive`,
  );

  const filtered = work.measure('medium metadata filter', () =>
    workspaceRepo.getPrimarySourceArchiveWorkspace('aguja-medio-4242', 0, 200),
  );
  assert.equal(filtered.value.page.total, 1);
  // The metadata filter is a substring LIKE, so SQLite sweeping the join is the
  // design, not the bug. What must never happen is that sweep crossing into
  // JavaScript: only the matches get materialized.
  assert.ok(
    filtered.rowsToJs <= 200,
    `medium metadata filter moved ${filtered.rowsToJs} rows into JavaScript for 1 match`,
  );
  assert.ok(
    filtered.statements <= 30,
    `medium metadata filter issued ${filtered.statements} statements`,
  );

  const dossier = work.measure('medium dossier', () =>
    workspaceRepo.getPrimarySourceDossier('perf-item-004242'),
  );
  assert.equal(dossier.value.files.length, 5);
  assert.equal(dossier.value.files.every((file) => file.hasContent === false), true);
  // Opening one source is the assertion that really means "this query does not
  // read the whole table": every lookup is keyed by item_id or file_id, so not a
  // single row of the 10,000 sources or the 50,000 pages may be walked to build
  // it. Leave any of those tables without an index leading on the key it is
  // looked up by and this trips on the first run, on any machine — verified by
  // dropping them and watching the swept row counts appear in this message.
  assert.equal(
    sweptRowsIn(dossier, ...CORPUS_TABLES),
    0,
    `medium dossier swept ${JSON.stringify(dossier.sweeps.filter((sweep) => sweep.rows > 0))}`,
  );
  assert.ok(
    dossier.rowsToJs <= 100,
    `medium dossier moved ${dossier.rowsToJs} rows into JavaScript for a 5-page source`,
  );

  const search = work.measure('medium text search', () => researchRepo.searchPrimarySourceCorpus({
    query: '"aguja-medio-4242"',
    limit: 100,
  }));
  assert.ok(search.value.results.some((result) => result.itemId === 'perf-item-004242'));
  // The corpus search has no FTS index behind it — `indexStrategy: 'sqlite_like'`
  // is a deliberate, documented choice — so it reads every source once and folds
  // in JavaScript. One sweep per layer is the contract. A query per candidate,
  // or a second pass over the corpus, is the regression.
  assert.ok(
    search.statements <= 20,
    `medium text search issued ${search.statements} statements; a per-candidate query would explode this`,
  );
  assert.ok(
    search.sweptRows <= 5 * 10_000,
    `medium text search walked ${search.sweptRows} rows: more than five passes over a 10,000-source archive`,
  );

  seedSources(10_000, 100_000, 0, false);
  db.exec('ANALYZE');
  assert.equal(count('archive_description_units') - 1, 100_000, 'large corpus has 100,000 metadata units');
  assert.equal(count('archive_item_files'), 50_000, 'large corpus keeps a bounded file subset');

  // ── The same operations against ten times the corpus ──────────────────────
  //
  // This is the comparison the milliseconds were reaching for, done in units
  // that a busy runner cannot perturb: the corpus grew 10×, so any operation
  // whose work grows with it is not paged, and any operation that grows faster
  // than it is quadratic.
  const largePage = work.measure('large initial list', () =>
    workspaceRepo.getPrimarySourceArchiveWorkspace('', 0, 200),
  );
  assert.equal(largePage.value.rows.length, 200);
  assert.equal(largePage.value.page.total, 100_000);
  assert.equal(largePage.value.page.hasMore, true);
  assert.equal(largePage.value.page.unitsTruncated, true);
  assert.ok(largePage.value.units.length <= 2_000);
  assert.ok(
    Buffer.byteLength(JSON.stringify(largePage.value), 'utf8') < 5_000_000,
    'large-corpus listing payload remains bounded below 5 MB',
  );
  assert.equal(
    largePage.statements,
    initial.statements,
    'a listing issues the same statements whatever the archive holds',
  );
  assert.equal(
    largePage.rowsToJs,
    initial.rowsToJs,
    `the listing moved ${initial.rowsToJs} rows at 10,000 sources and ${largePage.rowsToJs} at 100,000: it stopped paging`,
  );
  assert.ok(
    largePage.sweptRows <= 5 * 100_000,
    `large initial list walked ${largePage.sweptRows} rows over a 100,000-source archive`,
  );

  const largeFiltered = work.measure('large metadata filter', () =>
    workspaceRepo.getPrimarySourceArchiveWorkspace('aguja-medio-4242', 0, 200),
  );
  assert.equal(largeFiltered.value.page.total, 1);
  assert.equal(
    largeFiltered.rowsToJs,
    filtered.rowsToJs,
    `the filter moved ${filtered.rowsToJs} rows at 10,000 sources and ${largeFiltered.rowsToJs} at 100,000`,
  );

  const largeDossier = work.measure('large dossier', () =>
    workspaceRepo.getPrimarySourceDossier('perf-item-004242'),
  );
  assert.equal(largeDossier.value.files.length, 5);
  assert.equal(
    sweptRowsIn(largeDossier, ...CORPUS_TABLES),
    0,
    `large dossier swept ${JSON.stringify(largeDossier.sweeps.filter((sweep) => sweep.rows > 0))}`,
  );
  assert.equal(
    largeDossier.statements,
    dossier.statements,
    'opening a source costs the same in a 100,000-source archive as in a 10,000-source one',
  );
  assert.equal(
    largeDossier.rowsToJs,
    dossier.rowsToJs,
    'opening a source reads its own rows and nothing else',
  );

  const largeSearch = work.measure('large text search', () =>
    researchRepo.searchPrimarySourceCorpus({ query: '"aguja-medio-4242"', limit: 100 }),
  );
  assert.ok(largeSearch.value.results.some((result) => result.itemId === 'perf-item-004242'));
  assert.equal(
    largeSearch.statements,
    search.statements,
    'the corpus search issues a fixed number of statements at any size',
  );
  // 10× the sources, so at most 10× the rows read plus a margin. Anything above
  // this is a second pass over the corpus rather than a bigger corpus.
  assert.ok(
    largeSearch.rowsToJs <= search.rowsToJs * 11,
    `the corpus search moved ${search.rowsToJs} rows at 10,000 sources and ${largeSearch.rowsToJs} at 100,000: it is growing faster than the archive`,
  );
  assert.ok(
    largeSearch.sweptRows <= 5 * 100_000,
    `large text search walked ${largeSearch.sweptRows} rows: more than five passes over a 100,000-source archive`,
  );

  // ── The clock, kept only as a backstop ────────────────────────────────────
  //
  // Wide enough that a loaded CI runner can never reach it (the run that broke
  // this suite was 5.8× the local figure and still nowhere near these), narrow
  // enough that an operation that has genuinely gone pathological still trips.
  // If one of these fails, the counters above say which shape changed.
  const backstops = [
    [initial, 5_000], [filtered, 5_000], [dossier, 5_000], [search, 10_000],
    [largePage, 15_000], [largeFiltered, 15_000], [largeDossier, 5_000], [largeSearch, 30_000],
  ];
  for (const [report, ceilingMs] of backstops) {
    // Counters that silently miss a sweep would turn every budget above into a
    // rubber stamp, so the recorder has to account for every table it saw.
    assert.deepEqual(
      report.unresolvedSweeps,
      [],
      `the work recorder could not resolve a swept relation during ${report.label}`,
    );
    assert.ok(
      report.elapsedMs < ceilingMs,
      `${report.label} took ${report.elapsedMs.toFixed(1)} ms, past the ${ceilingMs} ms pathological-regression backstop`,
    );
  }

  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
  console.log(JSON.stringify({
    small: { units: 100, files: 500 },
    medium: {
      units: 10_000,
      pages: 50_000,
      initialList: counters(initial),
      metadataFilter: counters(filtered),
      dossier: counters(dossier),
      textSearch: counters(search),
    },
    large: {
      units: 100_000,
      fileSubset: 50_000,
      initialList: counters(largePage),
      metadataFilter: counters(largeFiltered),
      dossier: counters(largeDossier),
      textSearch: counters(largeSearch),
      payloadBytes: Buffer.byteLength(JSON.stringify(largePage.value), 'utf8'),
    },
  }, null, 2));
  console.log('Primary Sources work budgets passed!');

  function count(table) {
    return Number(db.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get().value);
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

// ── Counting work instead of reading a clock ────────────────────────────────
//
// These budgets used to be raw milliseconds, and a shared GitHub Actions macOS
// runner failed the text search at 1274 ms that the very next run passed. The
// clock of a borrowed machine is not an invariant of this code. The work is:
// how many statements an operation issues, how many rows cross into JavaScript,
// and which tables SQLite sweeps end to end. Those numbers are identical on a
// busy runner and on an idle laptop, and they move the instant somebody loses
// an index, adds a query per row, or stops paging. Milliseconds survive only as
// a backstop set far enough away that runner noise cannot reach it.
//
// The recorder shadows `prepare` on the live connection, so it observes the SQL
// the repositories actually issue rather than a copy of it kept in this file.
// EXPLAIN QUERY PLAN runs afterwards, never inside the timed window.
function installWorkRecorder(db) {
  const prepare = db.prepare.bind(db);
  const scopes = new Map();
  let plans = new Map();
  let tableRows = new Map();
  let log = null;

  db.prepare = function prepareWithCounters(source) {
    const statement = prepare(source);
    for (const method of ['all', 'get', 'run']) {
      const call = statement[method].bind(statement);
      statement[method] = (...params) => {
        const result = call(...params);
        if (log) log.push({ source, params, rows: rowsDelivered(method, result) });
        return result;
      };
    }
    const iterate = statement.iterate.bind(statement);
    statement.iterate = (...params) => {
      const execution = { source, params, rows: 0 };
      if (log) log.push(execution);
      return (function* counted() {
        for (const row of iterate(...params)) {
          execution.rows += 1;
          yield row;
        }
      })();
    };
    return statement;
  };

  function rowsDelivered(method, result) {
    if (Array.isArray(result)) return result.length;
    if (method === 'get') return result === undefined ? 0 : 1;
    return 0;
  }

  // EXPLAIN QUERY PLAN names the alias, not the table: `SCAN iu`, never
  // `SCAN archive_item_units`. Read the aliases straight off the statement, and
  // note the CTEs, so that a sweep whose name resolves to nothing is reported
  // rather than quietly counted as zero rows.
  function scopeOf(source) {
    if (scopes.has(source)) return scopes.get(source);
    const reserved = new Set([
      'on', 'where', 'group', 'order', 'limit', 'left', 'right', 'inner', 'outer',
      'cross', 'natural', 'join', 'union', 'select', 'set', 'values', 'using', 'as',
      'and', 'or', 'having', 'window', 'returning', 'offset',
    ]);
    const tables = new Map();
    for (const match of source.matchAll(
      /\b(?:FROM|JOIN)\s+([A-Za-z_]\w*)(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?/gi,
    )) {
      const [, table, alias] = match;
      tables.set(table.toLowerCase(), table);
      if (alias && !reserved.has(alias.toLowerCase())) tables.set(alias.toLowerCase(), table);
    }
    const ctes = new Set();
    for (const match of source.matchAll(
      /(?:\bWITH\s+(?:RECURSIVE\s+)?|,\s*)([A-Za-z_]\w*)\s*(?:\([^)]*\)\s*)?AS\s*\(/gi,
    )) {
      ctes.add(match[1].toLowerCase());
    }
    const scope = { tables, ctes };
    scopes.set(source, scope);
    return scope;
  }

  function relationExists(name) {
    if (!tableRows.has(name)) {
      const present = prepare(
        "SELECT 1 AS present FROM sqlite_master WHERE type IN ('table','view') AND name=?",
      ).get(name);
      tableRows.set(
        name,
        present ? Number(prepare(`SELECT COUNT(*) AS value FROM "${name}"`).get().value) : null,
      );
    }
    return tableRows.get(name) !== null;
  }

  function rowsIn(name) {
    return relationExists(name) ? tableRows.get(name) : 0;
  }

  function planOf(source, params) {
    const key = `${source} :: ${JSON.stringify(params)}`;
    if (plans.has(key)) return plans.get(key);
    let details = [];
    try {
      details = prepare(`EXPLAIN QUERY PLAN ${source}`).all(...params).map((row) => row.detail);
    } catch {
      details = [];
    }
    plans.set(key, details);
    return details;
  }

  return {
    measure(label, operation) {
      // The corpus grows between phases, so neither the row counts nor the
      // planner's choices from an earlier phase may be reused.
      plans = new Map();
      tableRows = new Map();
      log = [];
      const started = performance.now();
      const value = operation();
      const elapsedMs = performance.now() - started;
      const executions = log;
      log = null;

      const sweeps = [];
      const unresolvedSweeps = [];
      let rowsToJs = 0;
      let indexedSearches = 0;
      let sorts = 0;
      for (const execution of executions) {
        rowsToJs += execution.rows;
        const scope = scopeOf(execution.source);
        for (const detail of planOf(execution.source, execution.params)) {
          const scan = /^SCAN\s+(\S+)/.exec(detail);
          if (scan) {
            const name = scan[1];
            const table = scope.tables.get(name.toLowerCase()) ?? name;
            // A CTE or a derived table sweeps rows that are already accounted
            // for upstream; anything else that names no relation means this
            // recorder failed to read the statement and must say so.
            if (relationExists(table)) sweeps.push({ table, rows: rowsIn(table) });
            else if (!scope.ctes.has(table.toLowerCase()) && !name.startsWith('(')) {
              unresolvedSweeps.push({ name, table, source: execution.source });
            }
          } else if (detail.startsWith('SEARCH')) {
            indexedSearches += 1;
          } else if (detail.startsWith('USE TEMP B-TREE')) {
            sorts += 1;
          }
        }
      }
      return {
        label,
        value,
        elapsedMs,
        statements: executions.length,
        rowsToJs,
        sweeps,
        unresolvedSweeps,
        sweptRows: sweeps.reduce((total, sweep) => total + sweep.rows, 0),
        indexedSearches,
        sorts,
      };
    },
  };
}

// Rows SQLite had to walk through the named tables to answer the operation —
// the figure that says "this query read the whole corpus" out loud.
function sweptRowsIn(report, ...tables) {
  return report.sweeps
    .filter((sweep) => tables.includes(sweep.table))
    .reduce((total, sweep) => total + sweep.rows, 0);
}

function counters(report) {
  return {
    statements: report.statements,
    rowsToJs: report.rowsToJs,
    sweptRows: report.sweptRows,
    indexedSearches: report.indexedSearches,
    sorts: report.sorts,
    observedMs: round(report.elapsedMs),
  };
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
