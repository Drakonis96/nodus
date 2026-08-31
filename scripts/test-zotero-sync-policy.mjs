import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
installRuntimeHooks(path.join(os.tmpdir(), 'nodus-zotero-sync-policy-test'));
const require = createRequire(import.meta.url);
const policy = require(path.join(repoRoot, 'electron/sync/zoteroSyncPolicy.ts'));

function item(overrides = {}) {
  return {
    key: 'ITEM0001', itemKey: 'ITEM0001', library: { type: 'user', id: '0', name: 'Mi biblioteca' },
    version: 0, title: 'A stable title', titleMarkup: null,
    creators: [{ firstName: 'Ada', lastName: 'Lovelace', creatorType: 'author' }],
    year: 1843, itemType: 'journalArticle', doi: '10.1000/example', abstract: 'An abstract',
    tags: ['/read', 'history'], collections: ['ROOT', 'CHILD'], publisher: 'Publisher', publicationTitle: 'Journal',
    isbn: null, issn: '0000-0000', url: 'https://example.test', date: '1843', language: 'en', volume: '1', issue: '2',
    pages: '1-20', edition: null, place: 'London', rights: null, extra: null, fields: { archive: 'Example', callNumber: 'A-1' },
    dateAdded: '2026-01-01T00:00:00Z', dateModified: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

function work(overrides = {}) {
  return {
    nodus_id: 'work-1', zotero_key: 'ITEM0001', zotero_version: 5131, zotero_fingerprint: null,
    title: 'A stable title', zotero_title_markup: null, authors_json: JSON.stringify(['Ada Lovelace']), year: 1843,
    item_type: 'journalArticle', doi: '10.1000/example', read_tag: 1, manual_deep: 1, deep_trigger: 'both',
    source_type: 'full_text', light_status: 'done', light_at: null, light_hash: 'light', deep_status: 'done', deep_at: null,
    deep_hash: 'deep', resolved_source_type: 'pdf', resolved_text_hash: 'deep', resolved_text_chars: 100,
    resolved_text_source_count: 1, resolved_has_page_markers: 1, text_block_reason: null, text_resolved_at: null,
    resolved_text_notes: null, deep_error: null, deep_queued: 0, summary_status: 'done', summary_at: null,
    summary_hash: 'summary', summary_error: null, archived: 0, notes: null,
    ...overrides,
  };
}

const context = {
  authors: ['Ada Lovelace'],
  hasReadTag: true,
  lastSuccessfulSyncAt: '2026-02-01T00:00:00Z',
};

test('the header refresh is catalog-only without changing onboarding or realtime automation', () => {
  assert.equal(policy.shouldAutomateAnalysisAfterSync('manual', { catalogOnly: true }), false);
  assert.equal(policy.shouldAutomateAnalysisAfterSync('manual'), true, 'onboarding keeps its configured automation');
  assert.equal(policy.shouldAutomateAnalysisAfterSync('realtime'), true);
});

test('Zotero 10 version zero adopts a baseline instead of changing the whole library', () => {
  assert.equal(policy.classifyZoteroItemChange(work(), item(), context), 'baseline');
  assert.equal(policy.persistedZoteroVersion(work(), 0), 5131, 'a sentinel zero never overwrites a useful revision');
});

test('the baseline transition still detects a real edit made after the last sync', () => {
  assert.equal(
    policy.classifyZoteroItemChange(work(), item({ dateModified: '2026-02-02T00:00:00Z' }), context),
    'changed',
  );
  assert.equal(
    policy.classifyZoteroItemChange(work(), item({ title: 'A genuinely changed title' }), context),
    'changed',
  );
});

test('fingerprints detect later zero-version edits and ignore unordered metadata order', () => {
  const original = item();
  const fingerprint = policy.zoteroItemFingerprint(original);
  const reordered = item({
    tags: [...original.tags].reverse(),
    collections: [...original.collections].reverse(),
    fields: { callNumber: 'A-1', archive: 'Example' },
  });
  assert.equal(policy.zoteroItemFingerprint(reordered), fingerprint);
  const persisted = work({ zotero_version: 0, zotero_fingerprint: fingerprint });
  assert.equal(policy.classifyZoteroItemChange(persisted, reordered, context), 'unchanged');
  assert.equal(policy.classifyZoteroItemChange(persisted, item({ abstract: 'A revised abstract' }), context), 'changed');
});

test('normalizing Zotero rich-text titles does not create a false metadata change', () => {
  const rawTitle = '<span style="font-variant:small-caps;">CLE</span> peptides in plant-biotic interactions';
  const plainTitle = 'CLE peptides in plant-biotic interactions';
  const previousFingerprint = policy.zoteroItemFingerprint(item({ title: rawTitle }));
  const normalized = item({ title: plainTitle, titleMarkup: rawTitle });
  const persisted = work({
    title: plainTitle,
    zotero_title_markup: rawTitle,
    zotero_version: 0,
    zotero_fingerprint: previousFingerprint,
  });
  assert.equal(policy.zoteroItemFingerprint(normalized), previousFingerprint);
  assert.equal(policy.classifyZoteroItemChange(persisted, normalized, context), 'unchanged');
});

test('positive Zotero revisions remain authoritative', () => {
  assert.equal(policy.classifyZoteroItemChange(work(), item({ version: 5131 }), context), 'unchanged');
  assert.equal(policy.classifyZoteroItemChange(work(), item({ version: 5132 }), context), 'changed');
});

test('realtime sync notices a Zotero library revision reset as well as an increase', () => {
  assert.equal(policy.zoteroLibraryVersionsChanged({ 'user:0': 50_271 }, { 'user:0': 38 }), true);
  assert.equal(policy.zoteroLibraryVersionsChanged({ 'user:0': 38 }, { 'user:0': 39 }), true);
  assert.equal(policy.zoteroLibraryVersionsChanged({ 'user:0': 38 }, { 'user:0': 38 }), false);
});

test('the production manual path guards every analysis side effect', async () => {
  const sync = await fs.readFile(path.join(repoRoot, 'electron/sync/syncService.ts'), 'utf8');
  assert.match(sync, /const automateAnalysis = shouldAutomateAnalysisAfterSync\(mode, options\)/);
  assert.match(sync, /if \(automateAnalysis && settings\.autoLightScan/);
  assert.match(sync, /if \(automateAnalysis\) \{[\s\S]*probeWorkTextAvailability[\s\S]*scanQueue\.enqueue\(nodusId, item\.title, 'deep'\)/);
  assert.match(sync, /if \(automateAnalysis && DOCUMENT_INDEX_CONTINUOUS_AVAILABLE/);
  assert.match(sync, /const summary = catalogOnly[\s\S]*catálogo actualizado sin iniciar análisis/);
  const app = await fs.readFile(path.join(repoRoot, 'src/App.tsx'), 'utf8');
  assert.match(app, /window\.nodus\.syncNow\(\{ catalogOnly: true \}\)/);
});
