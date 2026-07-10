// Evidence → exact PDF page: exercises the REAL shared/pageLocation parser and
// the REAL zoteroClient.resolvePdfAttachmentKey with global fetch intercepted,
// so no live Zotero is needed. Locks in the URL contract (open-pdf needs the
// ATTACHMENT key, select uses the item key) and the fallback semantics.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-pdf-jump-'));

try {
  const pageOut = path.join(tmp, 'pageLocation.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'shared/pageLocation.ts')],
    outfile: pageOut,
    bundle: true,
    format: 'esm',
    platform: 'node',
  });
  const zoteroOut = path.join(tmp, 'zoteroClient.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/zotero/zoteroClient.ts')],
    outfile: zoteroOut,
    bundle: true,
    format: 'esm',
    platform: 'node',
    alias: { '@shared': path.join(repoRoot, 'shared') },
  });

  const { parsePageNumber, zoteroOpenPdfUrl, zoteroSelectUrl } = await import(pathToFileURL(pageOut).href);

  // ── Page parsing: every extractor/citation shape we produce ────────────────
  assert.equal(parsePageNumber('p. 12'), 12);
  assert.equal(parsePageNumber('P. 7'), 7);
  assert.equal(parsePageNumber('pp. 12-14'), 12, 'ranges open at the first page');
  assert.equal(parsePageNumber('página 34'), 34);
  assert.equal(parsePageNumber('pág. 5'), 5);
  assert.equal(parsePageNumber('[[p. 3]]'), 3, 'raw extractor marker');
  assert.equal(parsePageNumber('12'), 12, 'bare number');
  assert.equal(parsePageNumber('  p. 101  '), 101, 'whitespace tolerated');
  assert.equal(parsePageNumber('página vii'), null, 'roman numerals → fallback');
  assert.equal(parsePageNumber('cap. 2'), null, 'chapters are not pages');
  assert.equal(parsePageNumber('introducción'), null);
  assert.equal(parsePageNumber(''), null);
  assert.equal(parsePageNumber(null), null);
  assert.equal(parsePageNumber(undefined), null);
  assert.equal(parsePageNumber('p. 0'), null, 'pages are 1-based');

  // ── URL contract ────────────────────────────────────────────────────────────
  assert.equal(zoteroOpenPdfUrl('ATT1', 12), 'zotero://open-pdf/library/items/ATT1?page=12');
  assert.equal(zoteroSelectUrl('ITEM1'), 'zotero://select/library/items/ITEM1');

  // ── Attachment resolution against a scripted Zotero local API ──────────────
  const zotero = await import(pathToFileURL(zoteroOut).href);
  const routes = new Map();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async (url) => {
    fetchCalls += 1;
    const u = String(url);
    for (const [suffix, body] of routes) {
      if (u.endsWith(suffix)) return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };

  try {
    // Parent item with an EPUB and a PDF child → the PDF child's key wins.
    routes.set('/items/PARENT1/children', [
      { data: { itemType: 'attachment', key: 'EPUB1', contentType: 'application/epub+zip', parentItem: 'PARENT1' } },
      { data: { itemType: 'attachment', key: 'PDF1', contentType: 'application/pdf', parentItem: 'PARENT1' } },
      { data: { itemType: 'note', key: 'NOTE1', parentItem: 'PARENT1' } },
    ]);
    assert.equal(await zotero.resolvePdfAttachmentKey('0', 'PARENT1'), 'PDF1', 'first PDF child chosen');

    // REGRESSION: Zotero's local API answers /items/<unknown>/children with a
    // 200 that lists UNRELATED items (observed live on Zotero 7). Those must
    // never resolve, or a stale key would open a random PDF from the library.
    routes.set('/items/GHOST1/children', [
      { data: { itemType: 'attachment', key: 'STRANGER', contentType: 'application/pdf', parentItem: 'OTHER' } },
      { data: { itemType: 'journalArticle', key: 'TOPITEM' } },
    ]);
    routes.set('/items/GHOST1', { data: { itemType: 'journalArticle', key: 'REALLY-NOT-GHOST' } });
    assert.equal(await zotero.resolvePdfAttachmentKey('0', 'GHOST1'), null, 'foreign children never resolve');

    // Standalone PDF attachment (no children): the item IS the attachment.
    routes.set('/items/SOLO1/children', []);
    routes.set('/items/SOLO1', { data: { itemType: 'attachment', key: 'SOLO1', contentType: 'application/pdf' } });
    assert.equal(await zotero.resolvePdfAttachmentKey('0', 'SOLO1'), 'SOLO1', 'standalone PDF resolves to itself');

    // No PDF anywhere → null (caller falls back to zotero://select).
    routes.set('/items/NOPDF1/children', [{ data: { itemType: 'attachment', key: 'DOC1', contentType: 'application/msword', parentItem: 'NOPDF1' } }]);
    routes.set('/items/NOPDF1', { data: { itemType: 'journalArticle', key: 'NOPDF1' } });
    assert.equal(await zotero.resolvePdfAttachmentKey('0', 'NOPDF1'), null, 'no PDF → null');

    // Cache: a second lookup for the same item makes no new requests.
    const before = fetchCalls;
    assert.equal(await zotero.resolvePdfAttachmentKey('0', 'PARENT1'), 'PDF1');
    assert.equal(fetchCalls, before, 'resolution cached per item');

    // Zotero closed (fetch throws): returns null but does NOT poison the cache.
    globalThis.fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    assert.equal(await zotero.resolvePdfAttachmentKey('0', 'LATER1'), null, 'offline → graceful null');
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/items/LATER1/children')) {
        return new Response(
          JSON.stringify([{ data: { itemType: 'attachment', key: 'PDF9', contentType: 'application/pdf', parentItem: 'LATER1' } }]),
          { status: 200 }
        );
      }
      return new Response('not found', { status: 404 });
    };
    assert.equal(await zotero.resolvePdfAttachmentKey('0', 'LATER1'), 'PDF9', 'retry succeeds once Zotero is back');
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('pdf page jump (parser + attachment resolution) test passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
