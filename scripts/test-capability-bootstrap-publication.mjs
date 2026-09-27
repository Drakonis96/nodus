import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { verifyPublishedBootstrap } from './lib/published-bootstrap.mjs';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-bootstrap-publication-'));
test.after(() => rm(tmp, { recursive: true, force: true }));
const outfile = path.join(tmp, 'signature.mjs');
await build({ entryPoints: [path.resolve(import.meta.dirname, '../packages/capability-api/src/signature.ts')], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { verifyReleaseManifest } = await import(pathToFileURL(outfile));
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const keys = [{ keyId: 'test01', publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() }];
const asset = { target: 'any', asset: 'chemistry-studio-2.5.7-any.nodus-plugin', bytes: 10, sha256: createHash('sha256').update('test bytes').digest('hex') };
const entry = { id: 'chemistry-studio', version: '2.5.7', releaseUrl: 'https://example.test/release', assets: [asset] };
const release = { schemaVersion: 1, plugin: entry.id, version: entry.version, publisher: { id: 'NodusResearch', keyId: 'test01' }, createdAt: new Date().toISOString(), targets: [asset] };
function source({ published = true, archive = true, size = asset.bytes, version = entry.version, invalidSignature = false } = {}) {
  const bytes = Buffer.from(JSON.stringify({ ...release, version }));
  const signature = invalidSignature ? Buffer.alloc(64) : sign(null, bytes, privateKey);
  return async (url, options) => {
    if (!published) return new Response(null, { status: 404 });
    if (url.endsWith('/release-manifest.json')) return new Response(bytes);
    if (url.endsWith('/release-manifest.sig')) return new Response(signature);
    assert.equal(options.method, 'HEAD');
    return new Response(null, { status: archive ? 200 : 404, headers: { 'content-length': String(size) } });
  };
}
const verify = (pin = entry, options = {}) => verifyPublishedBootstrap(pin, { keys, verifyReleaseManifest, fetcher: source(options) });
test('a published signed release matching the pin passes', () => verify());
test('an unpublished release cannot pass a source-only cross-repo check', () => assert.rejects(verify(entry, { published: false }), /HTTP 404/));
test('the release signature must verify', () => assert.rejects(verify(entry, { invalidSignature: true }), /signature does not verify/));
test('the published version must match the pin', () => assert.rejects(verify(entry, { version: '2.5.6' }), /identity\/version/));
test('a pin cannot substitute a different digest', () => assert.rejects(verify({ ...entry, assets: [{ ...asset, sha256: '0'.repeat(64) }] }), /differs from the signed release/));
test('a signed manifest with no downloadable archive is refused', () => assert.rejects(verify(entry, { archive: false }), /HTTP 404/));
test('the published archive size must match', () => assert.rejects(verify(entry, { size: 11 }), /published size differs/));
