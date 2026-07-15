import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-zotero-groups-'));
const attachmentPath = path.join(root, 'group-paper.pdf');
await writeFile(attachmentPath, '%PDF-1.4 mock');

const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Last-Modified-Version', '17');
  const url = request.url ?? '';
  if (url.startsWith('/api/users/0/groups')) return response.end(JSON.stringify([{ id: 42, data: { name: 'Research team' } }]));
  if (url.startsWith('/api/groups/42/collections/top')) return response.end(JSON.stringify([{ key: 'COLL', data: { key: 'COLL', name: 'Shared sources', parentCollection: false }, meta: { numItems: 1, numCollections: 0 } }]));
  if (url.startsWith('/api/groups/42/collections/COLL/items/top')) { response.setHeader('Total-Results', '1'); return response.end(JSON.stringify([{ key: 'ITEM', data: { key: 'ITEM', version: 3, itemType: 'journalArticle', title: 'A shared paper', date: '2025', creators: [{ firstName: 'Ada', lastName: 'Lovelace', creatorType: 'author' }], collections: ['COLL'], tags: [] } }])); }
  if (url.startsWith('/api/groups/42/items/ITEM/children')) return response.end(JSON.stringify([{ key: 'ATT', data: { key: 'ATT', parentItem: 'ITEM', itemType: 'attachment', title: 'Full text', contentType: 'application/pdf', linkMode: 'imported_file', filename: 'group-paper.pdf' } }]));
  if (url.startsWith('/api/groups/42/items/ATT/file')) { response.statusCode = 302; response.setHeader('Location', new URL(`file://${attachmentPath}`).href); return response.end(); }
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
  assert.equal(collections[0].key, 'groups:42:COLL');
  assert.equal(collections[0].library.name, 'Research team');
  const items = await client.collectionItems('0', collections[0].key);
  assert.equal(items[0].key, 'groups:42:ITEM');
  assert.deepEqual(items[0].collections, ['groups:42:COLL']);
  const attachments = await client.itemAttachments('0', items[0].key, group);
  assert.equal(attachments[0].key, 'groups:42:ATT');
  assert.equal(await client.attachmentFilePath('0', attachments[0].key, group), attachmentPath);
  assert.equal(await client.libraryVersion('0', group), 17);
  console.log('Zotero group library tests passed!');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
