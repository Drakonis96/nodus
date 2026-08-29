// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

// `/items/top` returns parentless attachments — a PDF dropped into Zotero with no
// bibliographic entry above it — right alongside real references. Nodus dropped them
// unconditionally, and in the library this was measured against that was 603 of 2.155
// top-level entries: a quarter of the shelf never arrived and nothing said so. They
// are opt-in now, and the count is reported either way. This exercises the real
// client against a stub of Zotero's local API, not a re-implementation of the filter.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-zotero-standalone-'));

const page = [
  { key: 'R1', version: 1, data: { key: 'R1', version: 1, itemType: 'journalArticle', title: 'Una referencia normal', creators: [], date: '2020' } },
  { key: 'S1', version: 1, data: { key: 'S1', version: 1, itemType: 'attachment', title: 'Un PDF suelto', linkMode: 'imported_file', filename: 'suelto.pdf', contentType: 'application/pdf' } },
  { key: 'S2', version: 1, data: { key: 'S2', version: 1, itemType: 'attachment', title: 'Un EPUB suelto', linkMode: 'imported_url', filename: 'suelto.epub', contentType: 'application/epub+zip' } },
  // A top-level bookmark: a URL with nothing to read behind it.
  { key: 'S3', version: 1, data: { key: 'S3', version: 1, itemType: 'attachment', title: 'Un marcador', linkMode: 'linked_url', contentType: 'text/html' } },
  { key: 'N1', version: 1, data: { key: 'N1', version: 1, itemType: 'note', note: '<p>suelta</p>' } },
];

const server = createServer((request, response) => {
  response.statusCode = 200;
  response.setHeader('Last-Modified-Version', '7');
  response.setHeader('Total-Results', String(page.length));
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(request.url.includes('/items/top') ? page : []));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

try {
  const output = path.join(scratch, 'zotero-client.mjs');
  await build({ entryPoints: [path.resolve('electron/zotero/zoteroClient.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm' });
  process.env.NODUS_ZOTERO_API_BASE = `http://127.0.0.1:${server.address().port}/api`;
  const client = await import(`${pathToFileURL(output).href}?standalone=${Date.now()}`);
  const library = { type: 'user', id: '0', name: 'Mi biblioteca' };

  const off = await client.libraryItems(library);
  assert.deepEqual(off.items.map((entry) => entry.itemKey), ['R1'], 'by default only bibliographic entries arrive');
  assert.equal(off.standaloneSkipped, 2, 'the two parentless FILES are counted so the dialog can offer the option');

  const on = await client.libraryItems(library, { includeStandaloneFiles: true });
  assert.deepEqual(on.items.map((entry) => entry.itemKey), ['R1', 'S1', 'S2'], 'with the option on, parentless files become works');
  assert.equal(on.standaloneSkipped, 0);
  assert.equal(on.items[1].itemType, 'attachment');
  assert.equal(on.items[1].title, 'Un PDF suelto');

  // A bookmark and a standalone note are never works, whichever way the option is set.
  for (const result of [off, on]) {
    assert.ok(!result.items.some((entry) => entry.itemKey === 'S3'), 'a top-level linked_url has no file to read');
    assert.ok(!result.items.some((entry) => entry.itemKey === 'N1'), 'a standalone note is not a work');
  }
  console.log('Zotero standalone-file import option tests passed!');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
