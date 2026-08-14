import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const base = (process.env.NODUS_CLOUDFLARE_LOCAL_URL || 'http://127.0.0.1:8799').replace(/\/$/, '');
const bootstrapSecret = process.env.NODUS_CLOUDFLARE_LOCAL_SECRET || 'final-local-secret';
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function json(path, init = {}, expected = 200) {
  const response = await fetch(`${base}${path}`, init); const value = await response.json().catch(() => ({}));
  assert.equal(response.status, expected, `${path}: ${response.status} ${JSON.stringify(value)}`); return { response, value };
}

const health = await json('/health'); assert.equal(health.value.service, 'nodus-cloudflare');
const capabilities = await json('/api/v3/capabilities'); assert.equal(capabilities.value.protocolVersion, 3);
assert.deepEqual(capabilities.value.storage.vectorizeDimensions, []);
const initialized = (await json('/api/v3/bootstrap', {
  method: 'POST', headers: { authorization: `Bootstrap ${bootstrapSecret}`, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'owner@example.test', password: 'correct horse cloud', serverName: 'Nodus local verification', vault: { id: 'verify-vault', name: 'Verification', type: 'academic' }, deviceName: 'Verification' }),
}, 201)).value;
assert.ok(initialized.deviceToken && initialized.recoveryKey && initialized.installationId);
assert.equal(initialized.recoveryKey, crypto.createHash('sha256').update(`nodus-recovery-v1:${bootstrapSecret}`).digest('base64url'));
const auth = { authorization: `Bearer ${initialized.deviceToken}` };
const spaceId = initialized.space.id;
await json('/api/v3/bootstrap', {
  method: 'POST', headers: { authorization: `Bootstrap ${bootstrapSecret}`, 'content-type': 'application/json' }, body: '{}',
}, 409);
await json('/api/v1/settings/language', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ language: 'es' }) });
const compatibleCapabilities = await json('/api/v1/capabilities');
assert.equal(compatibleCapabilities.value.server.language, 'es');
const login = (await json('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.test', password: 'correct horse cloud' }) })).value;
const exchanged = await json('/api/v1/auth/device', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket: login.ticket, spaceId, deviceName: 'Replay verification' }) });
assert.ok(exchanged.value.deviceToken);
await json('/api/v1/auth/device', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket: login.ticket, spaceId, deviceName: 'Replay attempt' }) }, 401);

const note = { id: 'note-sync-1', title: 'Newest', titleExplicit: true, content: 'D1 atomic note', createdAt: 1_000, updatedAt: 2_000, deletedAt: null };
await json('/api/v1/nodi/notes', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ notes: [note] }) });
await json('/api/v1/nodi/notes', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ notes: [{ ...note, title: 'Older', content: 'must not win', updatedAt: 1_500 }] }) });
const synchronizedNotes = await json('/api/v1/nodi/notes', { headers: auth });
assert.equal(synchronizedNotes.value.notes.find((entry) => entry.id === note.id)?.content, note.content);

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const assetHash = sha(png);
const snapshot = Buffer.from(JSON.stringify({ format: 'nodus.server-snapshot', formatVersion: 2, vault: { id: 'verify-vault', name: 'Verification', type: 'academic' }, tables: {} }));
const snapshotHash = sha(snapshot);
const dim = 1537; const ids = Buffer.from(JSON.stringify(['idea-1']));
const vectorHeader = Buffer.from(JSON.stringify({ format: 'nodus.vectors', version: 1, kind: 'ideas', provider: 'verify', model: 'verify-1537', dim, quant: 'int8-l2', count: 1 }));
const vectors = Buffer.alloc(4 + vectorHeader.length + 4 + ids.length + dim); vectors.writeUInt32LE(vectorHeader.length, 0); vectorHeader.copy(vectors, 4);
vectors.writeUInt32LE(ids.length, 4 + vectorHeader.length); ids.copy(vectors, 8 + vectorHeader.length); vectors.fill(1, 8 + vectorHeader.length + ids.length);
const vectorHash = sha(vectors);
const largeRow = { id: 'note-1', title: 'Oversized row', content: 'oversized recovery evidence '.repeat(24_000) };
const largeRowBytes = Buffer.from(JSON.stringify(largeRow));
const largeRowHash = sha(largeRowBytes);
const largeRowKey = '["note-1"]';
const revision = sha('local-verification');
const manifest = {
  protocolVersion: 3, revision, schemaVersion: 1, vault: { id: 'verify-vault', name: 'Verification', type: 'academic' }, capabilities: {},
  counts: { works: 1, ideas: 1, notes: 1 }, assets: [{ hash: assetHash, bytes: png.length }], library: null,
  rowObjects: [{ hash: largeRowHash, bytes: largeRowBytes.length, table: 'notes', key: largeRowKey }],
  snapshot: { bytes: snapshot.length, sha256: snapshotHash, contentEncoding: 'identity' },
  vectors: [{ kind: 'ideas', provider: 'verify', model: 'verify-1537', dimensions: dim, count: 1, sha256: vectorHash, bytes: vectors.length, mode: 'r2-exact' }],
};
const publication = (await json(`/api/v3/spaces/${spaceId}/publications`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(manifest) }, 201)).value;
for (const [table, rows] of Object.entries({
  works: [{ key: '["work-1"]', row: { id: 'work-1', title: 'Cloud verification work' } }],
  ideas: [{ key: '["idea-1"]', row: { global_id: 'idea-1', title: 'Cloud verification idea', text: 'persistent semantic evidence' } }],
  notes: [{ key: largeRowKey, row: { __nodus_r2_row: largeRowHash, __nodus_search_title: largeRow.title, __nodus_search_body: largeRow.content.slice(0, 100_000) } }],
})) await json(`/api/v3/spaces/${spaceId}/publications/${publication.id}/tables/${table}`, { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ rows }) });
await json(`/api/v3/spaces/${spaceId}/objects/row/${largeRowHash}?publicationId=${publication.id}`, { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: largeRowBytes });

// A missing object rejects the complete mutation batch before its first valid row persists.
const mutationBatch = { mutations: [
  { id: 'mutation-valid', clientId: 'verify', kind: 'upsert', table: 'notes', key: ['note-1'], row: { id: 'note-1', title: 'Changed', content: 'Local' }, createdAt: new Date().toISOString() },
  { id: 'mutation-asset', clientId: 'verify', kind: 'upsert', table: 'notes', key: ['note-2'], row: { id: 'note-2', title: 'Image', content: 'Reference' }, assets: [{ hash: assetHash }], createdAt: new Date().toISOString() },
] };
const missing = await json(`/api/v3/spaces/${spaceId}/mutations`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(mutationBatch) }, 409);
assert.deepEqual(missing.value.missing, [assetHash]);
const emptyLedger = await json(`/api/v3/spaces/${spaceId}/mutations?since=0`, { headers: auth }); assert.equal(emptyLedger.value.mutations.length, 0);

await json(`/api/v3/spaces/${spaceId}/objects/asset/${assetHash}?publicationId=${publication.id}`, { method: 'PUT', headers: { ...auth, 'content-type': 'image/png' }, body: png });
const accepted = await json(`/api/v3/spaces/${spaceId}/mutations`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(mutationBatch) });
assert.deepEqual(accepted.value.accepted.sort(), ['mutation-asset', 'mutation-valid']);

const multipartZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(1024, 7)]);
const multipartHash = sha(multipartZip);
async function uploadMultipart(declaredHash, expectedCompleteStatus) {
  const started = (await json(`/api/v3/spaces/${spaceId}/publications/${publication.id}/uploads`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ purpose: 'library', hash: declaredHash, bytes: multipartZip.length, mime: 'application/zip' }),
  }, 201)).value;
  const part = (await json(`/api/v3/spaces/${spaceId}/uploads/${started.id}/parts/1`, {
    method: 'PUT', headers: { ...auth, 'content-type': 'application/octet-stream', 'x-nodus-part-sha256': sha(multipartZip) }, body: multipartZip,
  })).value;
  assert.ok(part.etag);
  return json(`/api/v3/spaces/${spaceId}/uploads/${started.id}/complete`, { method: 'POST', headers: auth }, expectedCompleteStatus);
}
await uploadMultipart(multipartHash, 200);
const corruptMultipart = await uploadMultipart(sha('wrong-multipart-address'), 400);
assert.equal(corruptMultipart.value.error, 'hash_mismatch');
await json(`/api/v3/spaces/${spaceId}/objects/snapshot/${snapshotHash}?publicationId=${publication.id}`, { method: 'PUT', headers: { ...auth, 'content-type': 'application/vnd.nodus.snapshot+json' }, body: snapshot });
await json(`/api/v3/spaces/${spaceId}/publications/${publication.id}/vectors/ideas/exact`, { method: 'PUT', headers: { ...auth, 'content-type': 'application/vnd.nodus.vectors' }, body: vectors });
await json(`/api/v3/spaces/${spaceId}/publications/${publication.id}/commit`, { method: 'POST', headers: auth });

// A library publication cannot activate if its document/package mapping is incomplete.
const absentPackageHash = sha('missing-library-package');
const invalidLibrary = (await json(`/api/v3/spaces/${spaceId}/publications`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({
    protocolVersion: 3, revision: sha('invalid-library-publication'), schemaVersion: 1,
    vault: manifest.vault, capabilities: {}, counts: {}, assets: [], snapshot: null, vectors: [],
    library: { format: 'nodus.server-library', formatVersion: 1, collections: [],
      documents: [{ id: 'doc-1', packageHash: absentPackageHash, packageBytes: 128 }], packages: [] },
  }),
}, 201)).value;
const invalidLibraryCommit = await json(`/api/v3/spaces/${spaceId}/publications/${invalidLibrary.id}/commit`, { method: 'POST', headers: auth }, 409);
assert.equal(invalidLibraryCommit.value.error, 'library_package_missing');

const search = await json(`/api/v3/spaces/${spaceId}/search?q=semantic`, { headers: auth }); assert.ok(search.value.results.length >= 1);
const restoredLargeRow = await json(`/api/v3/spaces/${spaceId}/notes/note-1`, { headers: auth });
assert.equal(restoredLargeRow.value.note.content.length, largeRow.content.length);
const semantic = await json(`/api/v3/spaces/${spaceId}/search/semantic`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'ideas', query: 'evidence', vector: Array(dim).fill(1), provider: 'verify', model: 'verify-1537', dim, limit: 5 }) });
assert.equal(semantic.value.backend, 'r2-exact'); assert.equal(semantic.value.results[0].row.global_id, 'idea-1');
const downloaded = await fetch(`${base}/api/v3/spaces/${spaceId}/snapshot`, { headers: auth });
assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), snapshot);
assert.equal(downloaded.headers.get('etag'), `W/"${revision}"`);
const unchanged = await fetch(`${base}/api/v3/spaces/${spaceId}/snapshot`, { headers: { ...auth, 'if-none-match': downloaded.headers.get('etag') } });
assert.equal(unchanged.status, 304);

const recoveryHeaders = { authorization: `Recovery ${initialized.recoveryKey}`, 'x-nodus-installation-id': initialized.installationId };
const recoveryIndex = await json('/recovery/index.json', { headers: recoveryHeaders }); assert.equal(recoveryIndex.value.spaces[0].id, spaceId);
const recoveryManifest = await json(`/recovery/${spaceId}/manifest.json`, { headers: recoveryHeaders }); assert.equal(recoveryManifest.value.publication.snapshotSha256, snapshotHash);
const recoveredAssetRecord = recoveryManifest.value.objects.find((entry) => entry.kind === 'asset' && entry.hash === assetHash);
assert.ok(recoveredAssetRecord?.downloadUrl);
const recoveredAsset = await fetch(recoveredAssetRecord.downloadUrl, { headers: recoveryHeaders });
assert.equal(recoveredAsset.status, 200); assert.deepEqual(Buffer.from(await recoveredAsset.arrayBuffer()), png);
const recoveredRows = await fetch(`${base}/recovery/${spaceId}/rows.ndjson`, { headers: recoveryHeaders });
const recoveredRowsText = await recoveredRows.text(); assert.match(recoveredRowsText, /Cloud verification work/); assert.match(recoveredRowsText, /oversized recovery evidence/);
const recoveredSnapshot = await fetch(`${base}/recovery/${spaceId}/snapshot`, { headers: recoveryHeaders }); assert.deepEqual(Buffer.from(await recoveredSnapshot.arrayBuffer()), snapshot);

const badRecovery = await fetch(`${base}/recovery/index.json`, { headers: { authorization: 'Recovery wrong', 'x-nodus-installation-id': initialized.installationId } }); assert.equal(badRecovery.status, 401);
const oauthMetadata = await json('/.well-known/oauth-authorization-server'); assert.ok(oauthMetadata.value.code_challenge_methods_supported.includes('S256'));
console.log(JSON.stringify({ ok: true, spaceId, publication: publication.id, recovery: true, recoveryObjects: true, oversizedRows: true, semantic: true, mutationAtomicity: true, multipartIntegrity: true, nodiAtomicity: true, oneTimeCredentials: true, libraryIntegrity: true, compatibility: true }));
