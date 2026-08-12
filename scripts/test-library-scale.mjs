// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-library-scale-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-library-scale-'));
installRuntimeHooks(path.join(scratch, 'profile'));
const require = createRequire(import.meta.url);

try {
  const { LibraryCatalog } = require(path.join(repoRoot, 'electron/library/libraryCatalog.ts'));
  const catalog = new LibraryCatalog(path.join(scratch, 'catalog.sqlite'));
  // TypeScript `private` intentionally compiles to an ordinary field. This fixture writes
  // the rebuildable cache directly so the scale gate measures queries, not 50,000 fsyncs.
  const db = catalog.handle;
  const insertCollection = db.prepare(`
    INSERT INTO library_collections
      (id, name, parent_id, position, source, source_library_id, source_key, revision, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, 'nodus', NULL, NULL, 1, '2026-08-10T00:00:00.000Z', NULL)
  `);
  const insertItem = db.prepare(`
    INSERT INTO library_items (
      id, storage_id, folder_name, source, source_library_id, source_key, source_state,
      citation_key, title, item_type, creators_json, abstract, date_value, year, doi,
      isbn_json, issn_json, tags_json, metadata_json, collection_ids_json,
      attachment_count, reader_available, extraction_status, analysis_json,
      revision, updated_at, deleted_at
    ) VALUES (?, ?, ?, 'nodus', NULL, NULL, NULL, ?, ?, 'article-journal', ?, ?, ?, ?, ?,
      '[]', '[]', ?, '{}', ?, 1, 1, 'ready', ?, 1, ?, NULL)
  `);
  const insertFts = db.prepare('INSERT INTO library_items_fts (item_id, title, creators, abstract, tags, identifiers) VALUES (?, ?, ?, ?, ?, ?)');
  const insertMembership = db.prepare('INSERT INTO library_item_collections (item_id, collection_id) VALUES (?, ?)');
  db.transaction(() => {
    for (let index = 0; index < 10_000; index += 1) {
      const id = `collection-${String(index).padStart(5, '0')}`;
      const parent = index === 0 ? null : `collection-${String(Math.floor((index - 1) / 10)).padStart(5, '0')}`;
      insertCollection.run(id, `Collection ${index}`, parent, index % 10);
    }
    for (let index = 0; index < 50_000; index += 1) {
      const suffix = String(index).padStart(5, '0');
      const id = `item-${suffix}`;
      const title = `Synthetic Needle ${suffix}`;
      const creator = JSON.stringify([{ creatorType: 'author', firstName: 'Ada', lastName: `Author ${index % 1000}` }]);
      const abstract = `Synthetic corpus entry ${index} for the Nodus four scale gate.`;
      const date = `${2000 + (index % 26)}-01-01`;
      const year = 2000 + (index % 26);
      const doi = `10.5555/nodus.${index}`;
      const tags = JSON.stringify([`tag-${index % 100}`, index % 2 ? 'odd' : 'even']);
      const collectionId = `collection-${String(index % 10_000).padStart(5, '0')}`;
      const collections = JSON.stringify([collectionId]);
      const analysis = JSON.stringify({ components: { deep: { freshness: index % 3 ? 'current' : 'stale' } } });
      const updated = `2026-08-${String(1 + (index % 10)).padStart(2, '0')}T00:00:${String(index % 60).padStart(2, '0')}.000Z`;
      insertItem.run(id, id, id, `key${suffix}`, title, creator, abstract, date, year, doi, tags, collections, analysis, updated);
      insertFts.run(id, title, `Ada Author ${index % 1000}`, abstract, `tag-${index % 100}`, doi);
      insertMembership.run(id, collectionId);
    }
  })();

  // Warm caches before enforcing the release threshold. Each timed call is the real
  // public catalogue method and includes its exact COUNT + page mapping work.
  catalog.list({ limit: 100, includeFacets: false, sort: [{ field: 'updatedAt', direction: 'desc' }] });
  catalog.list({ search: 'Needle 49999', limit: 20, includeFacets: false });
  catalog.list({ collectionId: 'collection-09999', limit: 100, includeFacets: false });
  catalog.listCollections();

  const hot = (label, operation) => {
    const started = performance.now();
    const result = operation();
    const duration = performance.now() - started;
    assert.ok(duration < 1_000, `${label} took ${duration.toFixed(1)} ms; hot CI queries must remain below one second`);
    return { result, duration };
  };
  const page = hot('50k sorted page', () => catalog.list({
    limit: 100, includeFacets: false, sort: [{ field: 'updatedAt', direction: 'desc' }, { field: 'title', direction: 'asc' }],
  }));
  assert.equal(page.result.total, 50_000);
  assert.equal(page.result.items.length, 100);
  const search = hot('50k full-text lookup', () => catalog.list({ search: 'Needle 49999', limit: 20, includeFacets: false }));
  assert.equal(search.result.total, 1);
  const collection = hot('collection membership lookup', () => catalog.list({ collectionId: 'collection-09999', limit: 100, includeFacets: false }));
  assert.equal(collection.result.total, 5);
  const tree = hot('10k collection tree', () => catalog.listCollections());
  assert.equal(tree.result.length, 10_000);

  console.log(`library scale test passed: ${[page, search, collection, tree].map((entry) => entry.duration.toFixed(1)).join('/')} ms`);
  catalog.close();
} finally {
  await rm(scratch, { recursive: true, force: true });
}
