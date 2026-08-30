// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-zotero-inventory-'));
const attachmentPath = path.join(scratch, 'attachment.pdf');
await writeFile(attachmentPath, '%PDF-1.4 inventory fixture');

const groups = Array.from({ length: 205 }, (_, index) => ({ id: index, data: { name: `Group ${index}` } }));
const initialGroups = Array.from({ length: 205 }, (_, index) => ({ id: index + 1, data: { name: `Group ${index + 1}` } }));
const collections = Array.from({ length: 205 }, (_, index) => ({
  key: `C${index}`,
  data: { key: `C${index}`, name: `Collection ${index}`, parentCollection: false },
  meta: { numItems: 0, numCollections: 0 },
}));
const rawItems = [
  ...Array.from({ length: 100 }, (_, index) => ({
    key: `T${index}`,
    data: {
      key: `T${index}`, version: 1, itemType: 'journalArticle', title: `Top ${index}`, creators: [], collections: [],
      tags: index === 0 ? [{ tag: 'typed', type: 1 }] : [],
      ...(index === 0 ? { shortTitle: 'Short', citationKey: 'sourceKey2026', bookTitle: 'Source container', relations: { 'dc:relation': ['https://example.test'] } } : {}),
    },
  })),
  ...Array.from({ length: 100 }, (_, index) => ({
    key: `A${index}`,
    data: { key: `A${index}`, version: 2, itemType: 'attachment', parentItem: 'T0', title: `Attachment ${index}`, filename: `${index}.pdf`, contentType: 'application/pdf', linkMode: 'imported_file' },
  })),
  ...Array.from({ length: 100 }, (_, index) => ({
    key: `N${index}`,
    data: { key: `N${index}`, version: 3, itemType: 'note', parentItem: 'T0', note: `<p>Note ${index}</p>` },
  })),
  { key: 'S1', data: { key: 'S1', version: 4, itemType: 'attachment', title: 'Standalone', filename: 'standalone.pdf', contentType: 'application/pdf', linkMode: 'imported_file' } },
  { key: 'URL1', data: { key: 'URL1', version: 4, itemType: 'attachment', title: 'Bookmark', contentType: 'text/html', linkMode: 'linked_url' } },
];
const children = Array.from({ length: 205 }, (_, index) => index % 2 === 0 ? ({
  key: `CA${index}`,
  data: { key: `CA${index}`, version: index, itemType: 'attachment', parentItem: 'PARENT', filename: `${index}.pdf`, contentType: 'application/pdf', linkMode: 'imported_file' },
}) : ({
  key: `CN${index}`,
  data: { key: `CN${index}`, version: index, itemType: 'note', parentItem: 'PARENT', note: `<p>${index}</p>` },
}));

let versionMode = 'retry-once';
let versionChecks = 0;
let pageVersion = 10;
let itemPages = 0;
let collectionPages = 0;
let childPages = 0;
let groupPages = 0;
let groupRacePending = true;

function jsonPage(response, rows, url) {
  const start = Number(url.searchParams.get('start') ?? 0);
  const limit = Number(url.searchParams.get('limit') ?? 100);
  response.setHeader('Total-Results', String(rows.length));
  response.end(JSON.stringify(rows.slice(start, start + limit)));
}

const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');

  if (url.pathname === '/api/users/0/groups') {
    groupPages += 1;
    if (groupRacePending) {
      groupRacePending = false;
      return jsonPage(response, initialGroups, url);
    }
    return jsonPage(response, groups, url);
  }

  if (url.pathname === '/api/groups/204/items' && url.searchParams.get('limit') === '1' && !url.searchParams.has('start')) {
    versionChecks += 1;
    if (versionMode === 'retry-once') pageVersion = versionChecks === 1 ? 10 : 11;
    else if (versionMode === 'stable') pageVersion = 11;
    else pageVersion += 1;
    response.setHeader('Last-Modified-Version', String(pageVersion));
    return response.end('[]');
  }

  response.setHeader('Last-Modified-Version', String(pageVersion));
  if (url.pathname === '/api/groups/204/items') {
    itemPages += 1;
    return jsonPage(response, rawItems, url);
  }
  if (url.pathname === '/api/groups/204/collections') {
    collectionPages += 1;
    return jsonPage(response, collections, url);
  }
  if (url.pathname === '/api/groups/204/items/PARENT/children') {
    childPages += 1;
    return jsonPage(response, children, url);
  }
  if (url.pathname === '/api/groups/204/items/A0/file') {
    response.statusCode = 302;
    response.setHeader('Location', pathToFileURL(attachmentPath).href);
    return response.end();
  }
  response.statusCode = 404;
  response.end('{}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

try {
  const output = path.join(scratch, 'zotero-client.mjs');
  await build({ entryPoints: [path.resolve('electron/zotero/zoteroClient.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm' });
  process.env.NODUS_ZOTERO_API_BASE = `http://127.0.0.1:${server.address().port}/api`;
  const client = await import(`${pathToFileURL(output).href}?inventory=${Date.now()}`);

  const available = await client.libraries();
  assert.equal(available.length, 206, 'the personal library and every group are returned');
  assert.equal(new Set(available.filter(({ type }) => type === 'group').map(({ id }) => id)).size, 205, 'a shifting page never duplicates a group');
  assert.ok(available.some(({ type, id }) => type === 'group' && id === '0'), 'a group inserted across the first traversal is present in the stable snapshot');
  assert.deepEqual(available.slice(-2).map(({ id }) => id), ['203', '204']);
  assert.equal(groupPages, 9, 'an inconsistent traversal is discarded and two stable snapshots are required');

  const library = available.at(-1);
  const progress = [];
  const inventory = await client.libraryInventory(library, { onProgress: (loaded, total) => progress.push([loaded, total]) });
  assert.equal(inventory.attempts, 2, 'a version change discards the first complete read');
  assert.equal(inventory.version, 11);
  assert.equal(inventory.items.length, 101, 'all references and the standalone file are importable by default');
  assert.equal(inventory.total, 101);
  assert.equal(inventory.standaloneSkipped, 0);
  assert.equal(inventory.collections.length, 205);
  assert.equal(inventory.attachments.length, 102, 'child files, standalone files and linked URLs remain visible in the ledger');
  assert.equal(inventory.notes.length, 100);
  assert.equal(inventory.attachments[0].parentItem, 'T0');
  assert.equal(inventory.notes[0].parentItem, 'T0');
  assert.equal(inventory.notes[0].key, 'groups:204:N0');
  const mappedTop = inventory.items.find((entry) => entry.itemKey === 'T0');
  assert.equal(mappedTop.fields.citationKey, 'sourceKey2026');
  assert.equal(mappedTop.fields.shortTitle, 'Short');
  assert.equal(mappedTop.fields.bookTitle, 'Source container');
  assert.equal(mappedTop.fields.relations, JSON.stringify({ 'dc:relation': ['https://example.test'] }));
  assert.equal(mappedTop.fields.tags, JSON.stringify([{ tag: 'typed', type: 1 }]));
  assert.ok(progress.some(([loaded, total]) => loaded === 300 && total === rawItems.length));
  assert.equal(itemPages, 8, 'all four item pages were read again after the inconsistent snapshot');
  assert.equal(collectionPages, 6, 'all three collection pages were read again after the inconsistent snapshot');

  versionMode = 'stable';
  const withoutStandalone = await client.libraryInventory(library, { includeStandaloneFiles: false });
  assert.equal(withoutStandalone.items.length, 100);
  assert.equal(withoutStandalone.total, 101);
  assert.equal(withoutStandalone.standaloneSkipped, 1);

  const attachments = await client.itemChildren('0', 'groups:204:PARENT');
  const notes = await client.itemNotes('0', 'groups:204:PARENT', library);
  assert.equal(attachments.length, 103, 'attachments are not truncated by the child endpoint default');
  assert.equal(notes.length, 102, 'notes are not truncated by the child endpoint default');
  assert.equal(childPages, 6);
  assert.equal(await client.attachmentFilePath('0', 'groups:204:A0', library), attachmentPath);

  const canceled = new AbortController();
  canceled.abort();
  await assert.rejects(client.itemChildren('0', 'groups:204:PARENT', canceled.signal), { name: 'AbortError' });
  await assert.rejects(client.itemNotes('0', 'groups:204:PARENT', library, canceled.signal), { name: 'AbortError' });
  await assert.rejects(client.itemAttachments('0', 'groups:204:PARENT', library, canceled.signal), { name: 'AbortError' });
  await assert.rejects(client.attachmentFilePath('0', 'groups:204:A0', library, canceled.signal), { name: 'AbortError' });

  versionMode = 'always-changing';
  versionChecks = 0;
  pageVersion = 20;
  await assert.rejects(
    client.libraryInventory(library, { maxAttempts: 2 }),
    (error) => error.name === 'ZoteroInventoryChangedError' && error.retryable === true && error.attempts === 2,
  );

  console.log('Zotero exhaustive inventory and pagination tests passed!');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
