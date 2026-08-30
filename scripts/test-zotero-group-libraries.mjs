import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-zotero-groups-'));
const attachmentPath = path.join(root, 'group-paper.pdf');
await writeFile(attachmentPath, '%PDF-1.4 mock');
const staleDirectory = path.join(root, 'STALE');
const renamedAttachmentPath = path.join(staleDirectory, 'Zotero normalized title.pdf');
await mkdir(staleDirectory);
await writeFile(renamedAttachmentPath, '%PDF-1.4 renamed');
const mismatchDirectory = path.join(root, 'MISMATCH');
await mkdir(mismatchDirectory);
await writeFile(path.join(mismatchDirectory, 'different.epub'), 'epub bytes');
const topRows = [
  { key: 'COLL', data: { key: 'COLL', name: 'Shared sources', parentCollection: false }, meta: { numItems: 1, numCollections: 101 } },
  ...Array.from({ length: 100 }, (_, index) => ({ key: `TOP${String(index + 1).padStart(3, '0')}`, data: { key: `TOP${String(index + 1).padStart(3, '0')}`, name: `Top ${String(index + 1).padStart(3, '0')}`, parentCollection: false }, meta: { numItems: 0, numCollections: 0 } })),
];
const childRows = Array.from({ length: 101 }, (_, index) => ({ key: `CHILD${String(index + 1).padStart(3, '0')}`, data: { key: `CHILD${String(index + 1).padStart(3, '0')}`, name: `Child ${String(index + 1).padStart(3, '0')}`, parentCollection: 'COLL' }, meta: { numItems: 0, numCollections: 0 } }));

const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Last-Modified-Version', '17');
  const url = request.url ?? '';
  if (url.startsWith('/api/users/0/groups')) return response.end(JSON.stringify([{ id: 42, data: { name: 'Research team' } }]));
  if (url.startsWith('/api/groups/42/collections/top')) {
    const start = Number(new URL(`http://127.0.0.1${url}`).searchParams.get('start') ?? 0);
    response.setHeader('Total-Results', String(topRows.length));
    return response.end(JSON.stringify(topRows.slice(start, start + 100)));
  }
  if (url.startsWith('/api/groups/42/collections/COLL/collections')) {
    const start = Number(new URL(`http://127.0.0.1${url}`).searchParams.get('start') ?? 0);
    response.setHeader('Total-Results', String(childRows.length));
    return response.end(JSON.stringify(childRows.slice(start, start + 100)));
  }
  if (url.startsWith('/api/groups/42/collections/COLL/items/top')) { response.setHeader('Total-Results', '1'); return response.end(JSON.stringify([{ key: 'ITEM', data: { key: 'ITEM', version: 3, itemType: 'journalArticle', title: 'A shared paper', date: '2025', creators: [{ firstName: 'Ada', lastName: 'Lovelace', creatorType: 'author' }], collections: ['COLL'], tags: [] } }])); }
  if (url.startsWith('/api/groups/42/items/ITEM/children')) return response.end(JSON.stringify([{ key: 'ATT', data: { key: 'ATT', parentItem: 'ITEM', itemType: 'attachment', title: 'Full text', contentType: 'application/pdf', linkMode: 'imported_file', filename: 'group-paper.pdf' } }]));
  if (url.startsWith('/api/groups/42/items/ATT/file')) { response.statusCode = 302; response.setHeader('Location', new URL(`file://${attachmentPath}`).href); return response.end(); }
  if (url.startsWith('/api/groups/42/items/STALE/file')) { response.statusCode = 302; response.setHeader('Location', new URL(`file://${path.join(staleDirectory, 'obsolete title.pdf')}`).href); return response.end(); }
  if (url.startsWith('/api/groups/42/items/MISSING/file')) { response.statusCode = 302; response.setHeader('Location', new URL(`file://${path.join(root, 'missing', 'absent.pdf')}`).href); return response.end(); }
  if (url.startsWith('/api/groups/42/items/MISMATCH/file')) { response.statusCode = 302; response.setHeader('Location', new URL(`file://${path.join(mismatchDirectory, 'obsolete.pdf')}`).href); return response.end(); }
  response.statusCode = 404; response.end('{}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();

try {
  const output = path.join(root, 'zotero-client.mjs');
  await build({ entryPoints: [path.resolve('electron/zotero/zoteroClient.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm' });
  process.env.NODUS_ZOTERO_API_BASE = `http://127.0.0.1:${address.port}/api`;
  const client = await import(`${new URL(`file://${output}`).href}?test=${Date.now()}`);
  const libraries = await client.libraries();
  assert.deepEqual(libraries.map((library) => [library.type, library.id, library.name]), [['user', '0', 'Mi biblioteca'], ['group', '42', 'Research team']]);
  const group = libraries[1];
  const collections = await client.topCollections('0', group);
  assert.equal(collections.length, 101, 'top-level collections continue past Zotero page size');
  const rootCollection = collections.find((collection) => collection.key === 'groups:42:COLL');
  assert.ok(rootCollection);
  assert.equal(rootCollection.library.name, 'Research team');
  const children = await client.childCollections('0', rootCollection.key);
  assert.equal(children.length, 101, 'child collections continue past Zotero page size');
  const items = await client.collectionItems('0', rootCollection.key);
  assert.equal(items[0].key, 'groups:42:ITEM');
  assert.deepEqual(items[0].collections, ['groups:42:COLL']);
  const attachments = await client.itemAttachments('0', items[0].key, group);
  assert.equal(attachments[0].key, 'groups:42:ATT');
  assert.equal(await client.attachmentFilePath('0', attachments[0].key, group), attachmentPath);
  assert.equal(
    await client.attachmentFilePath('0', 'groups:42:STALE', group),
    renamedAttachmentPath,
    'a unique materialized file is recovered when Zotero advertises an obsolete filename',
  );
  assert.equal(await client.attachmentFilePath('0', 'groups:42:MISSING', group), null, 'a truly absent attachment remains unavailable');
  assert.equal(await client.attachmentFilePath('0', 'groups:42:MISMATCH', group), null, 'a different file type is never guessed from an obsolete filename');
  assert.equal(await client.libraryVersion('0', group), 17);
  console.log('Zotero group library tests passed!');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
