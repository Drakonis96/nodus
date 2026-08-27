// SPDX-License-Identifier: AGPL-3.0-only
// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, repoRoot, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-library-browser-dedup-suite')) process.exit(0);

const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-library-browser-dedup-'));
const require = createRequire(import.meta.url);
installRuntimeHooks(path.join(scratch, 'profile'));
const settings = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
const library = require(path.join(repoRoot, 'electron/library/libraryService.ts'));
const capture = require(path.join(repoRoot, 'electron/browser-connector/libraryCapture.ts'));

try {
  settings.updateSettings({ autoBackupFolder: path.join(scratch, 'backups') });
  const first = await capture.saveBrowserCapture({
    pageUrl: 'https://journal.example/articles/42?utm_source=feed',
    metadataSource: 'generic',
    metadata: {
      title: 'A useful article', itemType: 'webpage', creators: [],
      url: 'https://journal.example/articles/42?utm_source=feed', year: null,
    },
  });
  assert.equal(first.disposition, 'created');
  assert.equal(first.deduplicated, false);

  const second = await capture.saveBrowserCapture({
    pageUrl: 'https://journal.example/articles/42?utm_medium=email',
    metadataSource: 'generic',
    metadata: {
      title: 'A better title from the page', itemType: 'webpage', creators: [],
      abstract: 'A description discovered on the second capture.',
      url: 'https://journal.example/articles/42?utm_medium=email', year: null,
    },
    tags: ['review later'],
  });
  assert.equal(second.itemId, first.itemId);
  assert.equal(second.disposition, 'updated');
  assert.equal(second.deduplicated, true);
  assert.equal(second.matchedBy, 'url');
  const stored = library.getGlobalLibraryItem(first.itemId);
  assert.equal(stored.metadata.title, 'A useful article', 'a better existing title is never overwritten');
  assert.equal(stored.metadata.abstract, 'A description discovered on the second capture.');
  assert.deepEqual(stored.metadata.tags, ['review later']);

  const third = await capture.saveBrowserCapture({
    pageUrl: 'https://journal.example/articles/42?gclid=another',
    metadataSource: 'generic',
    metadata: {
      title: 'A completely different title', itemType: 'webpage', creators: [],
      url: 'https://journal.example/articles/42?gclid=another', year: null,
    },
  });
  assert.equal(third.disposition, 'existing');
  assert.equal(third.itemId, first.itemId);

  const [racedA, racedB] = await Promise.all([
    capture.saveBrowserCapture({
      pageUrl: 'https://journal.example/articles/concurrent-1', metadataSource: 'generic',
      metadata: { title: 'Concurrent capture A', itemType: 'webpage', creators: [], url: 'https://journal.example/articles/concurrent-1', year: null },
    }),
    capture.saveBrowserCapture({
      pageUrl: 'https://journal.example/articles/concurrent-1?utm_campaign=test', metadataSource: 'generic',
      metadata: { title: 'Concurrent capture B', itemType: 'webpage', creators: [], url: 'https://journal.example/articles/concurrent-1?utm_campaign=test', year: null },
    }),
  ]);
  assert.equal(racedA.itemId, racedB.itemId, 'concurrent captures must share one deduplicated record');
  assert.deepEqual(new Set([racedA.disposition, racedB.disposition]), new Set(['created', 'existing']));
  console.log('Browser capture deduplication reuses records, preserves better metadata, and strips tracking URL parameters.');
} finally {
  library.closeGlobalLibrary();
  await rm(scratch, { recursive: true, force: true });
}
