// The image channel, and the three layers that keep documents out of it.
//
// The product rule is absolute: PDFs and audio never reach the server. Images do, but only
// a Deep Research illustration or a person's portrait. Two of the three enforcing layers
// live in the desktop client (the ASSET_SOURCES whitelist, and safeValue() dropping every
// Buffer), and a server must not trust a client it does not control — so the third layer,
// tested here, sniffs the bytes themselves.
//
// The case a careless sniffer gets wrong is RIFF: WAV and WEBP share those first four bytes,
// and only the format name at 8..12 separates them. Both are in this fixture on purpose.
import assert from 'node:assert/strict';
import { existsSync, utimesSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectAssetGarbage, listAssetHashes, sniffImageMime, writeAsset } from '../server/lib/assets.mjs';
import { Store } from '../server/lib/store.mjs';
import { academicSnapshot, PDF_BYTES, PNG_BYTES, publish, sha256, WAV_BYTES, WEBP_BYTES } from './lib/nodusServerFixtures.mjs';
import { withServer } from './lib/nodusServerHarness.mjs';

test('the sniffer accepts four image formats and nothing else', () => {
  assert.equal(sniffImageMime(PNG_BYTES), 'image/png');
  assert.equal(sniffImageMime(WEBP_BYTES), 'image/webp');
  assert.equal(sniffImageMime(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)])), 'image/jpeg');
  assert.equal(sniffImageMime(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(16)])), 'image/gif');

  // The two that matter for the product rule.
  assert.equal(sniffImageMime(PDF_BYTES), null);
  assert.equal(sniffImageMime(WAV_BYTES), null, 'WAV shares the RIFF header with WEBP and must still be refused');

  assert.equal(sniffImageMime(Buffer.alloc(4)), null, 'a payload too short to have a header is not an image');
  assert.equal(sniffImageMime(Buffer.from('this is a plain text file at least twelve bytes long')), null);
  assert.equal(sniffImageMime('not a buffer'), null);
});

test('an image round-trips, deduplicates, and refuses everything that is not one', { timeout: 60_000 }, async () => {
  await withServer({ label: 'assets' }, async (server) => {
    const spaceId = await server.createSpace('Corpus');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    const hash = sha256(PNG_BYTES);

    // Negotiate first: this is what makes republishing an unchanged vault cost nothing.
    const negotiate = await server.api(owner.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/assets/negotiate`, {
      json: { assets: [{ hash, bytes: PNG_BYTES.length, mime: 'image/png', kind: 'deep_research_image' }] },
    });
    assert.equal(negotiate.status, 200);
    assert.deepEqual((await negotiate.json()).missing, [hash]);

    const upload = await server.api(owner.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/assets/${hash}`, {
      body: PNG_BYTES, headers: { 'content-type': 'image/png' },
    });
    assert.equal(upload.status, 200);
    const uploaded = await upload.json();
    assert.equal(uploaded.deduplicated, false);
    assert.equal(uploaded.mime, 'image/png');

    // Second negotiation asks for nothing, and a second upload is a no-op.
    const again = await server.api(owner.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/assets/negotiate`, {
      json: { assets: [{ hash, bytes: PNG_BYTES.length }] },
    });
    assert.deepEqual((await again.json()).missing, []);
    const reupload = await server.api(owner.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/assets/${hash}`, { body: PNG_BYTES });
    assert.equal((await reupload.json()).deduplicated, true);

    const download = await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/assets/${hash}`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'image/png');
    assert.equal(download.headers.get('content-disposition'), 'attachment');
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(download.headers.get('cache-control'), 'private, max-age=31536000, immutable');
    assert.ok(Buffer.from(await download.arrayBuffer()).equals(PNG_BYTES));

    const cached = await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/assets/${hash}`, {
      headers: { 'if-none-match': download.headers.get('etag') },
    });
    assert.equal(cached.status, 304, 'content-addressed bytes never change, so revalidation is free');

    // A PDF and a WAV are refused with 415, whatever they claim to be.
    for (const [label, bytes] of [['pdf', PDF_BYTES], ['wav', WAV_BYTES]]) {
      const response = await server.api(owner.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/assets/${sha256(bytes)}`, {
        body: bytes, headers: { 'content-type': 'image/png' },
      });
      assert.equal(response.status, 415, `${label} must be refused even when declared as an image`);
      assert.match((await response.json()).error_description, /Documents and audio never travel/);
    }

    // …and a real WEBP, which shares the RIFF header with the WAV above, is accepted.
    const webp = await server.api(owner.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/assets/${sha256(WEBP_BYTES)}`, { body: WEBP_BYTES });
    assert.equal(webp.status, 200);
    assert.equal((await webp.json()).mime, 'image/webp');

    // Bytes that do not hash to the address they were sent to are a 400, not a silent store.
    const mismatched = await server.api(owner.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/assets/${sha256(WEBP_BYTES)}`, { body: PNG_BYTES });
    assert.equal(mismatched.status, 200, 'that hash already exists, so it deduplicates before reading a body');
    const fresh = await server.api(owner.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/assets/${'0'.repeat(64)}`, { body: PNG_BYTES });
    assert.equal(fresh.status, 400);
    assert.equal((await fresh.json()).error, 'hash_mismatch');

    const badAddress = await server.api(owner.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/assets/not-a-hash`, { body: PNG_BYTES });
    assert.equal(badAddress.status, 400);
    assert.equal((await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/assets/${'1'.repeat(64)}`)).status, 404);
  });
});

test('an image larger than the configured ceiling is refused', { timeout: 60_000 }, async () => {
  await withServer({ label: 'assets-limit', env: { NODUS_MAX_ASSET_BYTES: String(64 * 1024) } }, async (server) => {
    const spaceId = await server.createSpace('Corpus');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    const big = Buffer.concat([PNG_BYTES, Buffer.alloc(128 * 1024, 0x41)]);
    const response = await server.api(owner.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/assets/${sha256(big)}`, { body: big });
    assert.equal(response.status, 413);
    const value = await response.json();
    assert.equal(value.limitBytes, 64 * 1024);
    assert.match(value.error_description, /NODUS_MAX_ASSET_BYTES/, 'the rejection names the switch that would fix it');

    const capabilities = await (await fetch(`${server.origin}/api/v1/capabilities`)).json();
    assert.equal(capabilities.maxAssetBytes, 64 * 1024, 'the client can negotiate the ceiling instead of discovering it by failing');
  });
});

test('a reader may fetch images but never upload one', { timeout: 60_000 }, async () => {
  await withServer({ label: 'assets-roles' }, async (server) => {
    const spaceId = await server.createSpace('Corpus');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    await server.createUser('lector@example.test', 'lector-account-password', [{ spaceId, role: 'reader' }]);
    const reader = await server.deviceToken('lector@example.test', 'lector-account-password', spaceId);
    const hash = sha256(PNG_BYTES);
    await server.api(owner.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/assets/${hash}`, { body: PNG_BYTES });

    assert.equal((await server.api(reader.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/assets/${hash}`)).status, 200);
    const upload = await server.api(reader.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/assets/${sha256(WEBP_BYTES)}`, { body: WEBP_BYTES });
    assert.equal(upload.status, 403);
    assert.equal((await upload.json()).required, 'write');
  });
});

test('the sweeper keeps referenced images and takes orphans once the grace period passes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-asset-gc-'));
  try {
    // A real Store over a real directory: the sweeper walks the two-level fan-out on disk,
    // and stubbing that away would test the arithmetic instead of the traversal.
    const store = new Store(root);
    const spaceId = 'space-gc';
    const now = Date.now();
    const graceMs = 24 * 60 * 60_000;
    const keep = sha256(PNG_BYTES);
    const freshOrphan = sha256(WEBP_BYTES);
    const oldOrphan = sha256(Buffer.concat([PNG_BYTES, Buffer.from('old')]));

    for (const hash of [keep, freshOrphan, oldOrphan]) writeAsset(store, spaceId, hash, PNG_BYTES);
    // Age two of them past the grace window; leave the third minutes old.
    const aged = new Date(now - 10 * graceMs);
    for (const hash of [keep, oldOrphan]) utimesSync(store.assetPath(spaceId, hash), aged, aged);
    const recent = new Date(now - 60_000);
    utimesSync(store.assetPath(spaceId, freshOrphan), recent, recent);

    assert.equal(listAssetHashes(store, spaceId).length, 3, 'the fan-out is walked, not just the top directory');

    const removed = collectAssetGarbage(store, spaceId, new Set([keep]), graceMs, now);
    assert.deepEqual(removed, [oldOrphan]);
    assert.equal(existsSync(store.assetPath(spaceId, keep)), true, 'a referenced image is never swept');
    assert.equal(existsSync(store.assetPath(spaceId, freshOrphan)), true, 'an image uploaded minutes ago survives the sweep that races its mutation');
    assert.equal(existsSync(store.assetPath(spaceId, oldOrphan)), false);

    // Once the grace window has passed for it too, the second orphan goes.
    utimesSync(store.assetPath(spaceId, freshOrphan), aged, aged);
    assert.deepEqual(collectAssetGarbage(store, spaceId, new Set([keep]), graceMs, now), [freshOrphan]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('publishing collects the images the new snapshot no longer points at', { timeout: 60_000 }, async () => {
  await withServer({ label: 'assets-gc', env: {} }, async (server) => {
    const spaceId = await server.createSpace('Corpus');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    const hash = sha256(PNG_BYTES);
    await server.api(owner.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/assets/${hash}`, { body: PNG_BYTES });

    // Referenced by the snapshot: it survives a republication.
    const withImage = academicSnapshot({
      assets: [{ hash, thumbHash: null, mime: 'image/png', thumbMime: null, bytes: PNG_BYTES.length, thumbBytes: null, kind: 'deep_research_image', table: 'decorative_images', key: ['deep_research', 'dr-1'] }],
    });
    await publish(server.origin, owner.deviceToken, spaceId, withImage);
    assert.equal((await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/assets/${hash}`)).status, 200);

    const summary = await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}`)).json();
    assert.equal(summary.assets, 1);

    // The report list carries the image reference, so a phone can request it directly.
    const reports = await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/deep-research`)).json();
    assert.equal(reports.reports[0].image.hash, hash);

    // A republication that drops the reference does NOT delete it immediately: the grace
    // window is what stops a sweep from racing an upload that is still in flight.
    await publish(server.origin, owner.deviceToken, spaceId, academicSnapshot());
    assert.equal((await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/assets/${hash}`)).status, 200);
  });
});
