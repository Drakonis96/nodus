// The processing log's stored model and its file: retention, grouping, filtering, ordering,
// the text export, and the local-only boundary.
//
// The two modules under test are deliberately Electron-free (the store takes its file in the
// constructor and its limits per call), so everything here is driven directly instead of
// through the app: a temp file, a fake clock, and no database anywhere.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-pipeline-logs-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

function load(entry, name) {
  const bundle = path.join(dir, `${name}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [entry, '--bundle', '--platform=node', '--format=cjs', '--target=es2022', '--alias:@shared=./shared', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  return require(bundle);
}

const logs = load('shared/pipelineLogs.ts', 'logs');
const store = load('electron/logging/pipelineLogStore.ts', 'store');

const NOW = Date.parse('2026-09-15T10:00:00.000Z');
const DAY = 86_400_000;
const LIMITS = { retention: '10d', maxEntries: 5_000 };

/** A line as the pipeline emits it: a catalogue id plus its values, never prose. */
function entry(id, at, extra = {}) {
  return {
    id,
    at: new Date(at).toISOString(),
    level: 'error',
    category: 'json',
    scope: 'indexing',
    message: {
      id: 'logFailed',
      params: { subject: { id: 'subjectIndexing' }, detail: 'model returned invalid JSON' },
    },
    code: 'invalid_json',
    detail: 'Unexpected token < in JSON at position 0',
    repeat: 1,
    ...extra,
  };
}

test('a corrupt or missing file never breaks the log', () => {
  const file = path.join(dir, 'corrupt.json');
  writeFileSync(file, '{ this is not json');
  const repository = new store.PipelineLogRepository(file, 0);
  assert.equal(repository.query({}, LIMITS, NOW).total, 0);
  assert.equal(repository.stats(LIMITS).entries, 0);
  // And an entry can still be recorded afterwards, which is the point of surviving it.
  repository.record(entry('after-corrupt', NOW), LIMITS);
  assert.equal(repository.query({}, LIMITS, NOW).total, 1);

  const missing = new store.PipelineLogRepository(path.join(dir, 'nope', 'absent.json'), 0);
  assert.equal(missing.query({}, LIMITS, NOW).total, 0);
});

test('unusable entries are dropped on read instead of poisoning the store', () => {
  const normalized = logs.normalizePipelineLogStore({
    version: 1,
    revision: 'nonsense',
    entries: [
      { id: '', at: new Date(NOW).toISOString() },
      null,
      5,
      { id: 'no-time', at: 'not-a-date', level: 'error', category: 'json', scope: 'indexing', message: { id: 'logFailed' } },
      { id: 'bad-level', at: new Date(NOW).toISOString(), level: 'chatty', category: 'json', scope: 'indexing', message: { id: 'logFailed' } },
      { id: 'bad-category', at: new Date(NOW).toISOString(), level: 'error', category: 'nope', scope: 'indexing', message: { id: 'logFailed' } },
      { id: 'bad-message', at: new Date(NOW).toISOString(), level: 'error', category: 'json', scope: 'indexing', message: { id: 'notInTheCatalogue' } },
      entry('good', NOW),
    ],
  });
  assert.equal(normalized.revision, 0);
  assert.deepEqual(normalized.entries.map((item) => item.id), ['good']);
});

test('identical lines inside the window group into one row with a count', () => {
  let state = logs.emptyPipelineLogStore();
  state = logs.appendPipelineLogEntries(state, [entry('a', NOW)], LIMITS, NOW);
  state = logs.appendPipelineLogEntries(state, [entry('b', NOW + 1_000)], LIMITS, NOW + 1_000);
  state = logs.appendPipelineLogEntries(state, [entry('c', NOW + 4_000)], LIMITS, NOW + 4_000);
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0].repeat, 3);
  assert.equal(state.entries[0].firstAt, new Date(NOW).toISOString());
  // A provider outage must not bury everything else, but a DIFFERENT failure still gets a row.
  state = logs.appendPipelineLogEntries(state, [entry('d', NOW + 4_100, { code: 'timeout', detail: 'timed out' })], LIMITS, NOW + 4_100);
  assert.equal(state.entries.length, 2);
  // Past the window the same failure is a new row again.
  state = logs.appendPipelineLogEntries(state, [entry('e', NOW + 20_000)], LIMITS, NOW + 20_000);
  assert.equal(state.entries.length, 3);
});

test('a burst collapses into one discard summary instead of thousands of rows', () => {
  let state = logs.emptyPipelineLogStore();
  for (let index = 0; index < 300; index += 1) {
    state = logs.appendPipelineLogEntries(
      state,
      [entry(`burst-${index}`, NOW + index, { code: `code-${index}`, detail: `failure ${index}` })],
      LIMITS,
      NOW + index,
    );
  }
  const summary = state.entries.filter((item) => item.message.id === 'burstDiscarded');
  assert.equal(summary.length, 1, 'one summary line, not one per discarded entry');
  assert.equal(summary[0].level, 'warning');
  assert.equal(summary[0].message.params.count, 300 - logs.PIPELINE_LOG_BURST_LIMIT);
  assert.ok(state.entries.length <= logs.PIPELINE_LOG_BURST_LIMIT + 2);
});

test('retention is enforced by age and by the hard entry cap', () => {
  let state = logs.emptyPipelineLogStore();
  // Seeded with `forever` so the write path does not prune what this test wants to inspect.
  const unfiltered = { retention: 'forever', maxEntries: 5_000 };
  for (const age of [0, 2, 9, 11, 40]) {
    state = logs.appendPipelineLogEntries(state, [entry(`age-${age}`, NOW - age * DAY)], unfiltered, NOW);
  }
  assert.equal(state.entries.length, 5);
  const fresh = logs.prunePipelineLogs(state, { retention: '10d', maxEntries: 5_000 }, NOW);
  assert.deepEqual(fresh.entries.map((item) => item.id).sort(), ['age-0', 'age-2', 'age-9']);
  assert.deepEqual(
    logs.prunePipelineLogs(state, { retention: '1d', maxEntries: 5_000 }, NOW).entries.map((item) => item.id),
    ['age-0'],
  );
  assert.equal(logs.prunePipelineLogs(state, { retention: 'forever', maxEntries: 5_000 }, NOW).entries.length, 5);
  // A write under a 10-day policy drops the stale rows immediately, so a log left untouched
  // for weeks cannot come back with entries the policy has already expired.
  const underPolicy = logs.appendPipelineLogEntries(state, [entry('fresh-write', NOW, { code: 'auth', detail: 'invalid key' })], LIMITS, NOW);
  assert.deepEqual(underPolicy.entries.map((item) => item.id).sort(), ['age-0', 'age-2', 'age-9', 'fresh-write']);
  // An unknown window must never be read as "keep everything" or as "delete everything".
  assert.equal(logs.normalizePipelineLogRetention('2d'), '10d');
  assert.equal(logs.normalizePipelineLogMaxEntries('lots'), 5_000);
  const capped = Array.from({ length: 40 }, (_, index) => entry(`many-${index}`, NOW - index * 1_000, { code: `c${index}` }))
    .reduce((accumulator, item, index) => logs.appendPipelineLogEntries(accumulator, [item], { retention: 'forever', maxEntries: 10 }, NOW + index), state);
  assert.equal(capped.entries.length, 10, 'the cap holds even when nothing is stale');
});

test('filtering, facets and ordering cover what the modal offers', () => {
  let state = logs.emptyPipelineLogStore();
  const seed = [
    entry('one', NOW, { vaultId: 'v1', vaultName: 'Tesis', nodusId: 'w1', documentTitle: 'Historia contemporánea', model: 'gpt-4o', provider: 'openai' }),
    entry('two', NOW - DAY, { level: 'success', category: 'indexing', scope: 'indexing', code: null, detail: null, vaultId: 'v2', vaultName: 'Docencia', message: { id: 'documentIndexed', params: { title: 'Otra obra', sections: 12, vectors: 40 } } }),
    entry('three', NOW - 3 * DAY, { level: 'warning', category: 'provider', code: 'rate_limit', scope: 'scan', detail: 'rate limited', vaultId: 'v1', vaultName: 'Tesis' }),
    entry('four', NOW - 3 * DAY + 60_000, { level: 'error', category: 'connection', code: 'timeout', scope: 'embeddings', detail: 'timed out', vaultId: null, vaultName: null }),
  ];
  for (const [index, item] of seed.entries()) {
    state = logs.appendPipelineLogEntries(state, [item], LIMITS, NOW - index);
  }

  assert.deepEqual(logs.queryPipelineLogs(state, {}).entries.map((item) => item.id), ['one', 'two', 'four', 'three']);
  assert.deepEqual(logs.queryPipelineLogs(state, { sort: 'oldest' }).entries.map((item) => item.id), ['three', 'four', 'two', 'one']);
  assert.deepEqual(logs.queryPipelineLogs(state, { filter: { levels: ['error'] } }).entries.map((item) => item.id), ['one', 'four']);
  assert.deepEqual(logs.queryPipelineLogs(state, { filter: { categories: ['provider', 'connection'] } }).total, 2);
  assert.deepEqual(logs.queryPipelineLogs(state, { filter: { scopes: ['scan'] } }).entries.map((item) => item.id), ['three']);
  assert.deepEqual(logs.queryPipelineLogs(state, { filter: { vaultIds: ['v1'] } }).entries.map((item) => item.id), ['one', 'three']);
  // The day filter works on the reader's own calendar day, which is what the facets offer.
  const today = logs.localDayKey(NOW);
  assert.deepEqual(logs.queryPipelineLogs(state, { filter: { days: [today] } }).entries.map((item) => item.id), ['one']);
  // Search only ever touches language-neutral fields: codes, models, ids and provider prose.
  assert.deepEqual(logs.queryPipelineLogs(state, { filter: { search: 'gpt-4o' } }).entries.map((item) => item.id), ['one']);
  assert.deepEqual(logs.queryPipelineLogs(state, { filter: { search: 'rate_limit' } }).entries.map((item) => item.id), ['three']);
  assert.deepEqual(logs.queryPipelineLogs(state, { filter: { search: 'one' } }).entries.map((item) => item.id), ['one']);
  assert.deepEqual(logs.queryPipelineLogs(state, { filter: { ids: ['three'] } }).entries.map((item) => item.id), ['three']);

  const facets = logs.pipelineLogFacets(state);
  assert.equal(facets.total, 4);
  // Canonical enum order, so the numbers beside a filter never shuffle between reloads.
  assert.deepEqual(facets.levels.map((item) => item.value), ['success', 'error', 'warning']);
  assert.equal(facets.levels.find((item) => item.value === 'error').count, 2);
  assert.deepEqual(facets.vaults.map((vault) => vault.id), ['v1', 'v2']);
  assert.equal(facets.vaults[0].label, 'Tesis');
  // Facets never depend on the active filter, or the counts beside a filter would lie.
  assert.deepEqual(logs.pipelineLogFacets(logs.deletePipelineLogs(state, { levels: ['error'] })).total, 2);

  // Paging, so a long log does not have to be loaded whole.
  assert.deepEqual(logs.queryPipelineLogs(state, { limit: 2 }).entries.map((item) => item.id), ['one', 'two']);
  assert.deepEqual(logs.queryPipelineLogs(state, { limit: 2, offset: 2 }).entries.map((item) => item.id), ['four', 'three']);
  assert.equal(logs.queryPipelineLogs(state, { limit: 2 }).total, 4);
});

test('the renderer’s filter is re-validated, not trusted', () => {
  const clean = logs.sanitizePipelineLogFilter({
    levels: ['error', 'not-a-level'],
    categories: ['json', 7],
    days: ['2026-09-15', 'yesterday'],
    search: 'x'.repeat(500),
    ids: ['a', 'b'],
  });
  assert.deepEqual(clean.levels, ['error']);
  assert.deepEqual(clean.categories, ['json']);
  assert.deepEqual(clean.days, ['2026-09-15']);
  assert.ok(clean.search.length <= 200);
  assert.deepEqual(clean.ids, ['a', 'b']);
  // An unknown value must narrow the selection to nothing, never widen it to the whole log.
  assert.equal(logs.sanitizePipelineLogFilter({ levels: ['nope'] }).levels, undefined);
  assert.deepEqual(logs.sanitizePipelineLogFilter('delete everything'), {});
  const query = logs.sanitizePipelineLogQuery({ sort: 'sideways', limit: 10_000, offset: -4 });
  assert.equal(query.sort, 'newest');
  assert.equal(query.limit, logs.MAX_PIPELINE_LOG_LIMIT);
  assert.equal(query.offset, 0);
  assert.equal(logs.sanitizePipelineLogQuery(undefined).limit, logs.DEFAULT_PIPELINE_LOG_LIMIT);
});

test('deleting by filter is precise and reports what it removed', () => {
  let state = logs.emptyPipelineLogStore();
  for (const [index, item] of [
    entry('keep', NOW),
    entry('drop-a', NOW - 1_000, { code: 'timeout' }),
    entry('drop-b', NOW - 2_000, { code: 'auth' }),
  ].entries()) {
    state = logs.appendPipelineLogEntries(state, [item], LIMITS, NOW - index);
  }
  const removed = logs.deletePipelineLogs(state, { categories: ['json'] });
  assert.equal(removed.entries.length, 0);
  const one = logs.deletePipelineLogEntry(state, 'drop-a');
  assert.deepEqual(one.entries.map((item) => item.id).sort(), ['drop-b', 'keep']);
});

test('the exported text carries the numbers, the ids and the provider’s own words', () => {
  const text = logs.formatPipelineLogsText(
    [
      entry('one', NOW, {
        vaultName: 'Tesis',
        documentTitle: 'Historia contemporánea',
        model: 'gpt-4o',
        provider: 'openai',
        httpStatus: 429,
        attempts: 3,
        durationMs: 1_500,
      }),
      entry('two', NOW - 1_000, { repeat: 5, firstAt: new Date(NOW - 60_000).toISOString(), level: 'success', category: 'indexing', code: null }),
    ],
    {
      translate: (message) => `TRANSLATED(${message.id})`,
      generatedAt: '2026-09-15T10:00:00.000Z',
      shown: 2,
      total: 9,
      filters: ['types=json', 'days=2026-09-15'],
      logLanguage: 'en',
      appVersion: '5.4.4',
    },
  );
  assert.match(text, /^Nodus processing logs/);
  assert.match(text, /Generated: 2026-09-15T10:00:00\.000Z · Nodus 5\.4\.4/);
  assert.match(text, /Entries: 2 of 9/);
  assert.match(text, /Log language: en/);
  assert.match(text, /Filters: types=json · days=2026-09-15/);
  assert.match(text, /ERROR {4}json {2}\[invalid_json\]/);
  assert.match(text, /http=429 · model=gpt-4o · provider=openai · attempts=3 · duration=1500ms/);
  assert.match(text, /vault="Tesis" · document="Historia contemporánea"/);
  assert.match(text, /TRANSLATED\(logFailed\)/);
  assert.match(text, /detail: Unexpected token < in JSON at position 0/);
  assert.match(text, /×5 \(first 2026-09-15T09:59:00\.000Z\)/);
  // Fields the entry does not carry are simply not printed: no empty `nodus=` scaffolding.
  assert.match(text, /scope=indexing/);
  assert.ok(!text.includes('nodus='));
  assert.ok(!text.includes('job='));
});

test('entries are grouped and capped on write, and flushed to disk on demand', () => {
  const file = path.join(dir, 'store.json');
  const repository = new store.PipelineLogRepository(file, 60_000);
  repository.record(entry('one', NOW), LIMITS);
  repository.record(entry('two', NOW + 500), LIMITS);
  // Writes are coalesced, so the file only appears when the timer fires or the app flushes.
  repository.flushSync();
  const written = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(written.version, 1);
  assert.equal(written.entries.length, 1);
  assert.equal(written.entries[0].repeat, 2);
  assert.equal(repository.stats(LIMITS).entries, 1);
  assert.ok(repository.stats(LIMITS).bytes > 0);
  assert.ok(repository.stats(LIMITS).newestAt);
  repository.clear();
  repository.flushSync();
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).entries.length, 0);
});

test('the log is local diagnostics: no backup, no sync, no vault data', () => {
  // The same boundary the Browser history asserts. A log quotes provider errors and document
  // titles, and it exists to be pasted into an issue, so it must not travel with a vault.
  const exportImport = readFileSync(path.join(repoRoot, 'electron/export/exportImport.ts'), 'utf8');
  assert.ok(!/nodus-logs/.test(exportImport), 'the log must not be listed as a global auxiliary file');
  for (const file of ['electron/db/database.ts', 'electron/db/migrations.ts']) {
    const source = readFileSync(path.join(repoRoot, file), 'utf8');
    assert.ok(!/pipeline_logs|pipelineLogs/.test(source), `${file} must not store the log in a vault database`);
  }
  const host = readFileSync(path.join(repoRoot, 'electron/logging/pipelineLogHost.ts'), 'utf8');
  assert.match(host, /app\.getPath\('userData'\)/, 'the log lives in userData, shared by every vault');
});
