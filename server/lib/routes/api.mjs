// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

// The /api/v1 control plane: authentication for replicas, capability negotiation, the
// snapshot channel, assets, vectors and the mutation ledger. Corpus reads live next door in
// corpus.mjs; this file owns everything that writes or that decides who may.

import { digest, token } from '../store.mjs';
import { can } from '../roles.mjs';
import { REPLICA_TOKEN_DAYS } from '../auth.mjs';
import * as ledger from '../ledger.mjs';
import {
  assetExists, collectAssetGarbage, hashBytes, isValidAssetHash, readAsset, snapshotAssetHashes, sniffImageMime, writeAsset,
} from '../assets.mjs';
import {
  collectLibraryPackageGarbage, hashLibraryPackage, isValidLibraryPackageHash,
  inspectLibraryPackage, libraryPackageExists, looksLikeZip, readLibraryPackage, snapshotLibraryPackageHashes,
  spaceLibraryPackageBytes, writeLibraryPackage,
} from '../libraryPackages.mjs';
import { MAX_MUTATION_BATCH, validateMutation } from '../core/mutations.mjs';
import {
  MAX_NODI_NOTES, mergeNodiNotes, notesSince, validateNodiNote,
} from '../core/nodiNotes.mjs';
import { decodeVectorSet, embeddingMatches } from '../core/vectors.mjs';
import { searchVectorsOffThread } from '../core/vectorSearchPool.mjs';
import { lexicalSearch } from '../core/search.mjs';
import { rows } from '../core/snapshot.mjs';
import { NODUS_LICENSE, NODUS_SOURCE_URL, NODUS_VERSION } from '../version.mjs';

const AUTH_BODY_BYTES = 32 * 1024;
const TICKET_TTL_MS = 5 * 60_000;
const VECTOR_QUERY_BYTES = 256 * 1024;
const SHARED_BLOB_CHUNK_BYTES = 1024 * 1024;

/**
 * A size a person can act on, in the unit that distinguishes it from its neighbours.
 *
 * `mib()` is right for an image ceiling of 8 MiB and useless here: a 187 KiB report and a
 * 256 KiB limit both render as "0.2 MiB", so the sentence meant to end the guessing would have
 * printed the same number twice.
 */
function sizeLabel(bytes) {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
/** Matches the desktop research assistant's ceiling (electron/ai/researchAssistant.ts). */
const MAX_CONTEXT_CHARS = 600_000;

export function createApiRoutes(ctx) {
  const {
    store, authorize, json, body, jsonBody, readSnapshot, invalidateSnapshot, expandSnapshot,
    publicUrl, resourceMap, language, rateLimit, clearRateLimit, limits, corpus, mib,
  } = ctx;

  const vectorCache = new Map();
  const mutationListeners = new Map();
  const presenceBySpace = new Map();

  function notifyMutationListeners(spaceId, cursor) {
    const encoded = `event: mutation\ndata: ${JSON.stringify({ cursor })}\n\n`;
    for (const response of mutationListeners.get(spaceId) ?? []) {
      try { response.write(encoded); } catch { /* close handler removes it */ }
    }
  }

  function notifyPresenceListeners(spaceId, count) {
    const encoded = `event: presence\ndata: ${JSON.stringify({ count })}\n\n`;
    for (const response of mutationListeners.get(spaceId) ?? []) {
      try { response.write(encoded); } catch { /* close handler removes it */ }
    }
  }

  function livePresence(spaceId) {
    const now = Date.now();
    const entries = presenceBySpace.get(spaceId) ?? new Map();
    for (const [key, value] of entries) if (value.expiresAt <= now) entries.delete(key);
    if (!entries.size) presenceBySpace.delete(spaceId);
    return entries;
  }

  async function updatePresence(req, res, space, auth) {
    const key = auth.device?.hash || `oauth:${auth.user.id}`;
    const entries = livePresence(space.id);
    if (req.method === 'DELETE') {
      entries.delete(key); notifyPresenceListeners(space.id, entries.size);
      json(res, 200, { ok: true }); return true;
    }
    if (req.method === 'GET') {
      json(res, 200, { participants: [...entries.values()].map(({ expiresAt, ...entry }) => entry) }); return true;
    }
    const input = await jsonBody(req, 16 * 1024);
    const cursor = input.cursor && typeof input.cursor === 'object' ? {
      anchor: Math.max(0, Math.floor(Number(input.cursor.anchor) || 0)),
      head: Math.max(0, Math.floor(Number(input.cursor.head) || 0)),
    } : null;
    const entry = {
      id: key.slice(0, 24), userId: auth.user.id, name: String(auth.device?.deviceName || auth.user.email).slice(0, 120),
      pageId: String(input.pageId || '').slice(0, 240) || null,
      blockId: String(input.blockId || '').slice(0, 240) || null,
      cursor, color: /^#[0-9a-f]{6}$/i.test(String(input.color || '')) ? String(input.color) : null,
      updatedAt: new Date().toISOString(), expiresAt: Date.now() + 45_000,
    };
    entries.set(key, entry); presenceBySpace.set(space.id, entries);
    notifyPresenceListeners(space.id, entries.size);
    json(res, 200, { ok: true, participant: { ...entry, expiresAt: undefined } }); return true;
  }

  function mutationEvents(req, res, space) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'private, no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(`event: ready\ndata: ${JSON.stringify({ cursor: Number(space.mutationCursor || 0) })}\n\n`);
    let listeners = mutationListeners.get(space.id);
    if (!listeners) { listeners = new Set(); mutationListeners.set(space.id, listeners); }
    listeners.add(res);
    const heartbeat = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch { /* close follows */ } }, 25_000);
    heartbeat.unref?.();
    req.on('close', () => {
      clearInterval(heartbeat); listeners.delete(res); if (!listeners.size) mutationListeners.delete(space.id);
    });
    return true;
  }

  function spacesFor(user) {
    return store.state.memberships
      .filter((entry) => entry.userId === user.id)
      .map((entry) => {
        const space = store.state.spaces.find((candidate) => candidate.id === entry.spaceId);
        if (!space) return null;
        return {
          id: space.id,
          name: space.name,
          description: space.description ?? '',
          role: entry.role,
          vault: space.vault ?? null,
          updatedAt: space.updatedAt,
          revision: space.revision ?? '',
          schemaVersion: space.schemaVersion ?? 0,
          // How far the owner has acknowledged. A sender keeps the cursor its own POST
          // returned and compares, which is what lets a phone say "delivered" rather than
          // only "on the server". Readable by any member, and it reveals nothing but a
          // count. Only meaningful because nextSeq is seeded from this same value.
          mutationCursor: Number(space.mutationCursor || 0),
          hasSnapshot: Boolean(space.updatedAt),
        };
      })
      .filter(Boolean);
  }

  function capabilities() {
    return {
      api: 'v1',
      // The release this server is running. The desktop, the phone and this process ship as
      // one version, so a client that shows both side by side turns "it stopped working" into
      // "these two are not the same release".
      version: NODUS_VERSION,
      license: NODUS_LICENSE,
      sourceCodeUrl: NODUS_SOURCE_URL,
      server: { name: store.state.settings.name, publicUrl: publicUrl(), language: language(), version: NODUS_VERSION, license: NODUS_LICENSE, sourceCodeUrl: NODUS_SOURCE_URL },
      snapshotVersions: [1, 2],
      assets: true,
      libraryDocuments: true,
      mutations: true,
      documentUpdates: 'content-addressed-binary',
      sharedBlobs: { transport: 'resumable-chunks', chunkBytes: SHARED_BLOB_CHUNK_BYTES, maxBytes: limits.maxLibraryPackageBytes },
      vectors: true,
      resources: resourceMap(),
      maxAssetBytes: limits.maxAssetBytes,
      maxSpaceAssetBytes: limits.maxSpaceAssetBytes,
      maxLibraryPackageBytes: limits.maxLibraryPackageBytes,
      maxSpaceLibraryBytes: limits.maxSpaceLibraryBytes,
      maxSnapshotBytes: limits.maxSnapshotBytes,
      maxSnapshotJsonBytes: limits.maxSnapshotJsonBytes,
      maxMutationBatch: MAX_MUTATION_BATCH,
      // Published so a client can measure a row before spending twenty minutes generating it.
      // Their absence is why the only way to discover this limit was to be refused by it.
      maxMutationBytes: limits.maxMutationBytes,
      maxMutationBatchBytes: limits.maxMutationBatchBytes,
      maxLedgerBytes: limits.maxLedgerBytes,
      mutationEvents: 'sse',
      presence: { transport: 'ephemeral-sse', ttlSeconds: 45 },
    };
  }

  // ── Replica authentication ────────────────────────────────────────────────
  // The pairing code stays for publishers: an owner should not type their password into the
  // desktop app. A reader creating a replica has no administrator to ask for a code, so they
  // sign in. Two steps, because the client cannot know the space ids in advance.

  async function login(req, res) {
    if (!rateLimit(req, res, 'device-login-global', 240, 5 * 60_000, 'all')) return true;
    if (!rateLimit(req, res, 'device-login-ip', 60, 15 * 60_000)) return true;
    const input = await jsonBody(req, AUTH_BODY_BYTES);
    const identity = digest(String(input.email || '').trim().toLowerCase());
    if (!rateLimit(req, res, 'device-login-account', 10, 10 * 60_000, identity)) return true;
    const user = store.authenticate(input.email, input.password);
    if (!user) {
      json(res, 401, { error: 'invalid_credentials', error_description: 'That email and password do not match an account.' });
      return true;
    }
    clearRateLimit('device-login-account', identity);
    store.cleanup();
    const raw = token(24);
    store.state.authTickets.push({ hash: digest(raw), userId: user.id, expiresAt: new Date(Date.now() + TICKET_TTL_MS).toISOString(), usedAt: null });
    store.save();
    json(res, 200, {
      ticket: raw,
      expiresIn: Math.floor(TICKET_TTL_MS / 1000),
      user: { id: user.id, email: user.email, role: user.role },
      spaces: spacesFor(user),
      server: capabilities().server,
    });
    return true;
  }

  async function createDeviceToken(req, res) {
    if (!rateLimit(req, res, 'device-login-global', 240, 5 * 60_000, 'all')) return true;
    const input = await jsonBody(req, AUTH_BODY_BYTES);
    store.cleanup();
    const ticket = store.state.authTickets.find((entry) => entry.hash === digest(String(input.ticket || '')) && !entry.usedAt);
    if (!ticket) {
      json(res, 401, { error: 'invalid_ticket', error_description: 'That sign-in ticket has expired or was already used.' });
      return true;
    }
    const spaceId = String(input.spaceId || '');
    const membership = store.state.memberships.find((entry) => entry.userId === ticket.userId && entry.spaceId === spaceId);
    const space = store.state.spaces.find((entry) => entry.id === spaceId);
    if (!membership || !space) {
      json(res, 403, { error: 'forbidden', error_description: 'You do not have access to that space.' });
      return true;
    }
    ticket.usedAt = new Date().toISOString();
    const raw = token();
    store.state.deviceTokens.push({
      hash: digest(raw),
      userId: ticket.userId,
      spaceId: space.id,
      kind: 'replica',
      deviceName: String(input.deviceName || 'Nodus replica').slice(0, 120),
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      expiresAt: new Date(Date.now() + REPLICA_TOKEN_DAYS * 86400_000).toISOString(),
      grandfathered: false,
    });
    store.save();
    json(res, 200, {
      deviceToken: raw,
      space: { id: space.id, name: space.name, vault: space.vault ?? null, updatedAt: space.updatedAt, revision: space.revision ?? '' },
      role: membership.role,
      capabilities: capabilities(),
    });
    return true;
  }

  // ── Assets ────────────────────────────────────────────────────────────────

  function referencedAssets(spaceId) {
    const snapshot = readSnapshot(spaceId);
    const referenced = snapshot ? snapshotAssetHashes(snapshot) : new Set();
    for (const hash of ledger.pendingAssetHashes(store, spaceId)) referenced.add(hash);
    return referenced;
  }

  function documentUpdateExists(spaceId, hash) {
    return isValidAssetHash(hash) && ctx.fs.existsSync(store.documentUpdatePath(spaceId, hash));
  }

  async function uploadDocumentUpdate(req, res, space, hash) {
    if (!isValidAssetHash(hash)) {
      json(res, 400, { error: 'bad_hash' });
      return true;
    }
    const target = store.documentUpdatePath(space.id, hash);
    if (ctx.fs.existsSync(target)) {
      json(res, 200, { ok: true, deduplicated: true });
      return true;
    }
    const bytes = await body(req, limits.maxAssetBytes);
    if (hashBytes(bytes) !== hash) {
      json(res, 400, { error: 'hash_mismatch' });
      return true;
    }
    ctx.fs.mkdirSync(ctx.path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    ctx.fs.writeFileSync(temporary, bytes, { mode: 0o600 });
    ctx.fs.renameSync(temporary, target);
    json(res, 200, { ok: true, deduplicated: false, bytes: bytes.length });
    return true;
  }

  function downloadDocumentUpdate(req, res, space, hash) {
    if (!documentUpdateExists(space.id, hash)) {
      json(res, 404, { error: 'not_found' });
      return true;
    }
    const bytes = ctx.fs.readFileSync(store.documentUpdatePath(space.id, hash));
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes.length),
      'cache-control': 'private, immutable, max-age=31536000',
      etag: `"${hash}"`,
    });
    if (req.method === 'HEAD') res.end(); else res.end(bytes);
    return true;
  }

  function sharedBlobExists(spaceId, hash) {
    return isValidAssetHash(hash) && ctx.fs.existsSync(store.sharedBlobPath(spaceId, hash));
  }

  function sharedBlobStatus(req, res, space, hash) {
    if (!isValidAssetHash(hash)) { json(res, 400, { error: 'bad_hash' }); return true; }
    const complete = sharedBlobExists(space.id, hash);
    const uploadDir = store.sharedBlobUploadDir(space.id, hash);
    let manifest = null;
    try { manifest = JSON.parse(ctx.fs.readFileSync(ctx.path.join(uploadDir, 'manifest.json'), 'utf8')); } catch { /* no partial upload */ }
    const received = [];
    if (!complete && manifest) {
      for (let index = 0; index < Number(manifest.totalChunks || 0); index += 1) {
        if (ctx.fs.existsSync(ctx.path.join(uploadDir, `${index}.part`))) received.push(index);
      }
    }
    json(res, 200, { complete, received, chunkBytes: SHARED_BLOB_CHUNK_BYTES, totalChunks: manifest?.totalChunks ?? null, totalBytes: manifest?.totalBytes ?? null });
    return true;
  }

  async function uploadSharedBlobChunk(req, res, space, hash, indexText) {
    const index = Number(indexText);
    const totalChunks = Number(req.headers['x-nodus-total-chunks']);
    const totalBytes = Number(req.headers['x-nodus-total-bytes']);
    const chunkHash = String(req.headers['x-nodus-chunk-sha256'] || '');
    if (!isValidAssetHash(hash) || !Number.isInteger(index) || index < 0
      || !Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > Math.ceil(limits.maxLibraryPackageBytes / SHARED_BLOB_CHUNK_BYTES)
      || index >= totalChunks || !Number.isInteger(totalBytes) || totalBytes < 0 || totalBytes > limits.maxLibraryPackageBytes
      || !isValidAssetHash(chunkHash)) {
      json(res, 400, { error: 'bad_chunk_metadata' }); return true;
    }
    if (sharedBlobExists(space.id, hash)) { json(res, 200, { ok: true, complete: true }); return true; }
    const bytes = await body(req, SHARED_BLOB_CHUNK_BYTES);
    if (hashBytes(bytes) !== chunkHash) { json(res, 400, { error: 'chunk_hash_mismatch' }); return true; }
    const expectedBytes = index === totalChunks - 1 ? totalBytes - index * SHARED_BLOB_CHUNK_BYTES : SHARED_BLOB_CHUNK_BYTES;
    if (bytes.length !== expectedBytes) { json(res, 400, { error: 'bad_chunk_size', expectedBytes }); return true; }
    const dir = store.sharedBlobUploadDir(space.id, hash);
    ctx.fs.mkdirSync(dir, { recursive: true });
    const manifestFile = ctx.path.join(dir, 'manifest.json');
    let manifest = null;
    try { manifest = JSON.parse(ctx.fs.readFileSync(manifestFile, 'utf8')); } catch { /* first chunk */ }
    if (manifest && (Number(manifest.totalChunks) !== totalChunks || Number(manifest.totalBytes) !== totalBytes)) {
      json(res, 409, { error: 'upload_shape_changed' }); return true;
    }
    if (!manifest) ctx.fs.writeFileSync(manifestFile, JSON.stringify({ hash, totalChunks, totalBytes }), { mode: 0o600 });
    const target = ctx.path.join(dir, `${index}.part`);
    const temporary = `${target}.tmp-${process.pid}`;
    ctx.fs.writeFileSync(temporary, bytes, { mode: 0o600 });
    ctx.fs.renameSync(temporary, target);
    json(res, 200, { ok: true, index, bytes: bytes.length });
    return true;
  }

  function completeSharedBlob(req, res, space, hash) {
    if (!isValidAssetHash(hash)) { json(res, 400, { error: 'bad_hash' }); return true; }
    if (sharedBlobExists(space.id, hash)) { json(res, 200, { ok: true, deduplicated: true }); return true; }
    const dir = store.sharedBlobUploadDir(space.id, hash);
    let manifest;
    try { manifest = JSON.parse(ctx.fs.readFileSync(ctx.path.join(dir, 'manifest.json'), 'utf8')); }
    catch { json(res, 409, { error: 'upload_not_started' }); return true; }
    const parts = [];
    for (let index = 0; index < Number(manifest.totalChunks); index += 1) {
      try { parts.push(ctx.fs.readFileSync(ctx.path.join(dir, `${index}.part`))); }
      catch { json(res, 409, { error: 'missing_chunks', missing: [index] }); return true; }
    }
    const bytes = Buffer.concat(parts);
    if (bytes.length !== Number(manifest.totalBytes) || hashBytes(bytes) !== hash) {
      json(res, 400, { error: 'blob_checksum_mismatch' }); return true;
    }
    const target = store.sharedBlobPath(space.id, hash);
    ctx.fs.mkdirSync(ctx.path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp-${process.pid}`;
    ctx.fs.writeFileSync(temporary, bytes, { mode: 0o600 });
    ctx.fs.renameSync(temporary, target);
    ctx.fs.rmSync(dir, { recursive: true, force: true });
    json(res, 200, { ok: true, deduplicated: false, bytes: bytes.length });
    return true;
  }

  function downloadSharedBlob(req, res, space, hash) {
    if (!sharedBlobExists(space.id, hash)) { json(res, 404, { error: 'not_found' }); return true; }
    const file = store.sharedBlobPath(space.id, hash);
    const bytes = ctx.fs.readFileSync(file);
    let start = 0; let end = bytes.length - 1; let status = 200;
    const range = String(req.headers.range || '').match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      start = Number(range[1]); end = range[2] ? Math.min(bytes.length - 1, Number(range[2])) : bytes.length - 1;
      if (!Number.isInteger(start) || start < 0 || start > end || start >= bytes.length) {
        res.writeHead(416, { 'content-range': `bytes */${bytes.length}` }); res.end(); return true;
      }
      status = 206;
    }
    const slice = bytes.subarray(start, end + 1);
    res.writeHead(status, {
      'content-type': 'application/octet-stream', 'content-length': String(slice.length),
      'accept-ranges': 'bytes', ...(status === 206 ? { 'content-range': `bytes ${start}-${end}/${bytes.length}` } : {}),
      etag: `"${hash}"`, 'cache-control': 'private, immutable, max-age=31536000',
    });
    if (req.method === 'HEAD') res.end(); else res.end(slice);
    return true;
  }

  async function negotiateAssets(req, res, space) {
    const input = await jsonBody(req, 1024 * 1024);
    const wanted = Array.isArray(input.assets) ? input.assets : [];
    const missing = [];
    for (const asset of wanted) {
      const hash = String(asset?.hash ?? '');
      if (!isValidAssetHash(hash)) continue;
      if (Number(asset?.bytes) > limits.maxAssetBytes) continue;
      if (!assetExists(store, space.id, hash)) missing.push(hash);
    }
    json(res, 200, { missing: [...new Set(missing)] });
    return true;
  }

  async function uploadAsset(req, res, space, hash) {
    if (!isValidAssetHash(hash)) {
      json(res, 400, { error: 'bad_hash', error_description: 'An asset is addressed by the lowercase hex sha256 of its bytes.' });
      return true;
    }
    if (assetExists(store, space.id, hash)) {
      json(res, 200, { ok: true, deduplicated: true });
      return true;
    }
    const announced = Number(req.headers['content-length'] || 0);
    if (announced > limits.maxAssetBytes) {
      json(res, 413, { error: 'too_large', error_description: `This server accepts images of up to ${mib(limits.maxAssetBytes)} (NODUS_MAX_ASSET_BYTES).`, limitBytes: limits.maxAssetBytes });
      return true;
    }
    if (Number(space.assetBytes || 0) + announced > limits.maxSpaceAssetBytes) {
      json(res, 507, { error: 'space_full', error_description: `This space has reached its image budget of ${mib(limits.maxSpaceAssetBytes)} (NODUS_MAX_SPACE_ASSET_BYTES).`, limitBytes: limits.maxSpaceAssetBytes });
      return true;
    }
    const bytes = await body(req, limits.maxAssetBytes);
    if (hashBytes(bytes) !== hash) {
      json(res, 400, { error: 'hash_mismatch', error_description: 'The uploaded bytes do not hash to the address they were sent to.' });
      return true;
    }
    // The client is not trusted about what it is sending. Only four image formats get in,
    // and the RIFF check reads bytes 8..12 so a WAV cannot pass itself off as a WEBP.
    const mime = sniffImageMime(bytes);
    if (!mime) {
      json(res, 415, { error: 'unsupported_media_type', error_description: 'Only PNG, JPEG, WEBP and GIF images may be published. Documents and audio never travel to the server.' });
      return true;
    }
    writeAsset(store, space.id, hash, bytes);
    space.assetBytes = Number(space.assetBytes || 0) + bytes.length;
    store.save();
    json(res, 200, { ok: true, deduplicated: false, mime, bytes: bytes.length });
    return true;
  }

  // ── Published global library ─────────────────────────────────────────────

  function libraryManifest(spaceId) {
    const value = readSnapshot(spaceId)?.library;
    return value?.format === 'nodus.server-library' && Number(value?.formatVersion) === 1
      ? value
      : null;
  }

  async function negotiateLibraryPackages(req, res, space) {
    const input = await jsonBody(req, 1024 * 1024);
    const wanted = Array.isArray(input.packages) ? input.packages : [];
    const missing = [];
    for (const entry of wanted) {
      const hash = String(entry?.hash ?? '');
      const bytes = Number(entry?.bytes ?? 0);
      if (!isValidLibraryPackageHash(hash) || bytes <= 0 || bytes > limits.maxLibraryPackageBytes) continue;
      if (!libraryPackageExists(store, space.id, hash)) missing.push(hash);
    }
    json(res, 200, { missing: [...new Set(missing)] });
    return true;
  }

  async function uploadLibraryPackage(req, res, space, hash) {
    if (!isValidLibraryPackageHash(hash)) {
      json(res, 400, { error: 'bad_hash', error_description: 'A library package is addressed by the lowercase hex sha256 of its bytes.' });
      return true;
    }
    if (libraryPackageExists(store, space.id, hash)) {
      json(res, 200, { ok: true, deduplicated: true });
      return true;
    }
    const announced = Number(req.headers['content-length'] || 0);
    if (announced > limits.maxLibraryPackageBytes) {
      json(res, 413, { error: 'too_large', error_description: `This server accepts one library reading package of up to ${mib(limits.maxLibraryPackageBytes)} (NODUS_MAX_LIBRARY_PACKAGE_BYTES).`, limitBytes: limits.maxLibraryPackageBytes });
      return true;
    }
    if (Number(space.libraryPackageBytes || 0) + announced > limits.maxSpaceLibraryBytes) {
      json(res, 507, { error: 'space_full', error_description: `This space has reached its published-library budget of ${mib(limits.maxSpaceLibraryBytes)} (NODUS_MAX_SPACE_LIBRARY_BYTES).`, limitBytes: limits.maxSpaceLibraryBytes });
      return true;
    }
    const bytes = await body(req, limits.maxLibraryPackageBytes);
    if (Number(space.libraryPackageBytes || 0) + bytes.length > limits.maxSpaceLibraryBytes) {
      json(res, 507, { error: 'space_full', error_description: `This space has reached its published-library budget of ${mib(limits.maxSpaceLibraryBytes)} (NODUS_MAX_SPACE_LIBRARY_BYTES).`, limitBytes: limits.maxSpaceLibraryBytes });
      return true;
    }
    if (hashLibraryPackage(bytes) !== hash) {
      json(res, 400, { error: 'hash_mismatch', error_description: 'The uploaded bytes do not hash to the address they were sent to.' });
      return true;
    }
    if (!looksLikeZip(bytes)) {
      json(res, 415, { error: 'unsupported_media_type', error_description: 'A published library document must be a ZIP containing Clean Markdown and/or one supported original.' });
      return true;
    }
    const inspection = inspectLibraryPackage(bytes);
    if (!inspection.ok) {
      json(res, 415, { error: 'invalid_library_package', error_description: inspection.reason });
      return true;
    }
    writeLibraryPackage(store, space.id, hash, bytes);
    space.libraryPackageBytes = Number(space.libraryPackageBytes || 0) + bytes.length;
    store.save();
    json(res, 200, { ok: true, deduplicated: false, bytes: bytes.length });
    return true;
  }

  function libraryUnavailable(res) {
    json(res, 409, { error: 'library_not_published', error_description: 'The owner has not enabled library publication for this space.' });
    return true;
  }

  function librarySummary(req, res, space) {
    const library = libraryManifest(space.id);
    if (!library) {
      json(res, 200, {
        published: false, generatedAt: null, collections: 0, documents: 0,
        downloadableDocuments: 0, packageBytes: 0,
      });
      return true;
    }
    const documents = Array.isArray(library.documents) ? library.documents : [];
    json(res, 200, {
      published: true,
      generatedAt: library.generatedAt,
      collections: Array.isArray(library.collections) ? library.collections.length : 0,
      documents: documents.length,
      downloadableDocuments: documents.filter((document) => document?.cleanAvailable || document?.originalAvailable).length,
      packageBytes: documents.reduce((sum, document) => sum + Math.max(0, Number(document?.packageBytes) || 0), 0),
    });
    return true;
  }

  function validatePublishedLibrary(spaceId, library) {
    if (library == null) return null;
    if (library?.format !== 'nodus.server-library' || Number(library?.formatVersion) !== 1
        || !Array.isArray(library.collections) || !Array.isArray(library.documents)) {
      return { status: 400, error: 'invalid_library', error_description: 'The published library manifest is malformed.' };
    }
    const ids = new Set();
    for (const document of library.documents) {
      const id = String(document?.id ?? '');
      if (!id || ids.has(id)) return { status: 400, error: 'invalid_library', error_description: 'Every published library document needs a unique id.' };
      ids.add(id);
      const hash = String(document?.packageHash ?? '');
      const needsPackage = Boolean(document?.cleanAvailable || document?.originalAvailable);
      if (needsPackage && (!isValidLibraryPackageHash(hash) || !libraryPackageExists(store, spaceId, hash))) {
        return { status: 409, error: 'package_unavailable', error_description: `The published reading package for ${id} has not reached the server.` };
      }
      if (hash && !isValidLibraryPackageHash(hash)) return { status: 400, error: 'invalid_library', error_description: `The package fingerprint for ${id} is invalid.` };
      if (needsPackage) {
        const packageBytes = readLibraryPackage(store, spaceId, hash);
        const inspection = packageBytes ? inspectLibraryPackage(packageBytes) : null;
        if (!inspection?.ok || String(inspection.manifest?.documentId ?? '') !== id) {
          return { status: 409, error: 'package_mismatch', error_description: `The reading package for ${id} is invalid or belongs to a different document.` };
        }
        if (Number(inspection.manifest?.formatVersion) >= 2
            && (Boolean(document?.cleanAvailable) !== Boolean(inspection.hasMarkdown)
              || Boolean(document?.originalAvailable) !== Boolean(inspection.hasOriginal))) {
          return { status: 409, error: 'package_mismatch', error_description: `The reading formats declared for ${id} do not match its package.` };
        }
      }
    }
    return null;
  }

  function libraryCollections(req, res, space) {
    const library = libraryManifest(space.id);
    if (!library) return libraryUnavailable(res);
    json(res, 200, { collections: Array.isArray(library.collections) ? library.collections : [], generatedAt: library.generatedAt });
    return true;
  }

  function libraryDocuments(req, res, space, url) {
    const library = libraryManifest(space.id);
    if (!library) return libraryUnavailable(res);
    const query = String(url.searchParams.get('q') || '').trim().toLocaleLowerCase();
    const collectionId = String(url.searchParams.get('collectionId') || '');
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const all = (Array.isArray(library.documents) ? library.documents : []).filter((document) => {
      if (collectionId && !(Array.isArray(document?.collectionIds) && document.collectionIds.includes(collectionId))) return false;
      if (!query) return true;
      return [document?.title, document?.abstract, ...(Array.isArray(document?.creators) ? document.creators : []), ...(Array.isArray(document?.tags) ? document.tags : [])]
        .filter(Boolean).join('\n').toLocaleLowerCase().includes(query);
    });
    json(res, 200, { items: all.slice(offset, offset + limit), total: all.length, limit, offset, hasMore: offset + limit < all.length, generatedAt: library.generatedAt });
    return true;
  }

  function libraryDocument(req, res, space, documentId) {
    const library = libraryManifest(space.id);
    if (!library) return libraryUnavailable(res);
    const document = (Array.isArray(library.documents) ? library.documents : []).find((entry) => String(entry?.id) === documentId);
    if (!document) {
      json(res, 404, { error: 'document_not_found' });
      return true;
    }
    json(res, 200, { document, generatedAt: library.generatedAt });
    return true;
  }

  function downloadLibraryDocument(req, res, space, documentId) {
    const library = libraryManifest(space.id);
    if (!library) return libraryUnavailable(res);
    const document = (Array.isArray(library.documents) ? library.documents : []).find((entry) => String(entry?.id) === documentId);
    if (!document) {
      json(res, 404, { error: 'document_not_found' });
      return true;
    }
    const hash = String(document.packageHash ?? '');
    const bytes = readLibraryPackage(store, space.id, hash);
    if (!bytes) {
      json(res, 409, { error: 'package_unavailable', error_description: 'The reading package has not reached the server yet.' });
      return true;
    }
    const title = String(document.title || 'document').replace(/[\\/\r\n";]/g, ' ').trim().slice(0, 120) || 'document';
    const encodedTitle = encodeURIComponent(`${title}.zip`).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    const tag = `"${hash}"`;
    if (req.headers['if-none-match'] === tag) {
      res.writeHead(304, { etag: tag }); res.end(); return true;
    }
    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-length': String(bytes.length),
      // filename is the conservative ASCII fallback; filename* carries the real Unicode title.
      'content-disposition': `attachment; filename="document.zip"; filename*=UTF-8''${encodedTitle}`,
      'cache-control': 'private, max-age=31536000, immutable',
      etag: tag,
    });
    if (req.method === 'HEAD') res.end(); else res.end(bytes);
    return true;
  }

  function downloadAsset(req, res, space, hash) {
    const asset = readAsset(store, space.id, hash);
    if (!asset) {
      json(res, 404, { error: 'not_found' });
      return true;
    }
    const tag = `"${hash}"`;
    if (req.headers['if-none-match'] === tag) {
      res.writeHead(304, { etag: tag });
      res.end();
      return true;
    }
    res.writeHead(200, {
      'content-type': asset.mime,
      'content-length': String(asset.bytes.length),
      etag: tag,
      // Content-addressed, so the bytes behind a URL can never change.
      'cache-control': 'private, max-age=31536000, immutable',
      'content-disposition': 'attachment',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'referrer-policy': 'no-referrer',
    });
    if (req.method === 'HEAD') res.end();
    else res.end(asset.bytes);
    return true;
  }

  // ── Vectors and semantic search ───────────────────────────────────────────

  function loadVectors(spaceId, kind) {
    const file = store.vectorsPath(spaceId, kind);
    const fs = ctx.fs;
    if (!fs.existsSync(file)) return null;
    const stat = fs.statSync(file);
    const cached = vectorCache.get(`${spaceId}:${kind}`);
    if (cached?.mtimeMs === stat.mtimeMs) return cached.set;
    try {
      const set = decodeVectorSet(fs.readFileSync(file));
      vectorCache.set(`${spaceId}:${kind}`, { mtimeMs: stat.mtimeMs, set });
      return set;
    } catch {
      return null;
    }
  }

  async function uploadVectors(req, res, space) {
    const kind = String(new URL(req.url, publicUrl()).searchParams.get('kind') || 'ideas');
    let bytes = await body(req, limits.maxVectorBytes);
    // The matrix is highly compressible and the desktop sends it gzipped, exactly like a
    // snapshot. Decoding the raw body would fail on the header before saying anything useful.
    if (req.headers['content-encoding'] === 'gzip') {
      try { bytes = ctx.gunzip(bytes, limits.maxVectorBytes); }
      catch {
        json(res, 400, { error: 'bad_vectors', error_description: 'The payload declares gzip but could not be decompressed.' });
        return true;
      }
    }
    let set;
    try { set = decodeVectorSet(bytes); }
    catch (error) {
      json(res, 400, { error: 'bad_vectors', error_description: error instanceof Error ? error.message : String(error) });
      return true;
    }
    if (set.header.kind !== kind) {
      json(res, 400, { error: 'kind_mismatch', error_description: `The payload declares kind "${set.header.kind}" but the request asked for "${kind}".` });
      return true;
    }
    ctx.fs.writeFileSync(store.vectorsPath(space.id, kind), bytes, { mode: 0o600 });
    vectorCache.delete(`${space.id}:${kind}`);
    json(res, 200, { ok: true, kind, count: set.count, dim: set.dim, provider: set.header.provider, model: set.header.model });
    return true;
  }

  async function semanticSearch(req, res, space) {
    if (!rateLimit(req, res, 'semantic-search', 30, 60_000)) return true;
    const input = await jsonBody(req, VECTOR_QUERY_BYTES);
    const kind = String(input.kind || 'ideas');
    const snapshot = readSnapshot(space.id);
    if (!snapshot) {
      json(res, 409, { error: 'not_published' });
      return true;
    }
    const set = loadVectors(space.id, kind);
    const requested = { provider: String(input.provider || ''), model: String(input.model || ''), dim: Number(input.dim || 0) };

    // An empty list is never allowed to stand in for "this space has no index" or "your
    // provider does not match mine". Reporting absence of evidence from a search that never
    // ran is the exact failure the desktop contract already forbids.
    if (!set) {
      json(res, 200, {
        results: lexicalSearch(snapshot, input.query, Math.min(50, Number(input.limit) || 20)),
        indexed: false,
        reason: 'no_vectors',
        fallback: 'lexical',
        warning: 'This space has not published semantic vectors, so these results come from a literal text search. An empty result does NOT mean the corpus lacks the topic.',
      });
      return true;
    }
    if (!embeddingMatches(set.header, requested)) {
      json(res, 200, {
        results: lexicalSearch(snapshot, input.query, Math.min(50, Number(input.limit) || 20)),
        indexed: false,
        reason: 'provider_mismatch',
        expected: { provider: set.header.provider, model: set.header.model, dim: set.dim },
        received: requested,
        fallback: 'lexical',
        warning: 'This space is indexed with a different embedding provider or model, so its vectors cannot be compared with yours. These results come from a literal text search instead.',
      });
      return true;
    }
    const vector = Array.isArray(input.vector) ? input.vector : [];
    if (vector.length !== set.dim) {
      json(res, 400, { error: 'bad_vector', error_description: `This space is indexed at ${set.dim} dimensions and the query vector has ${vector.length}.` });
      return true;
    }
    // Off the event loop: the dot products are the one piece of work here that is measured in
    // hundreds of milliseconds, and every other request on the server waits behind it.
    const matches = await searchVectorsOffThread(set, vector, {
      limit: Math.max(1, Math.min(100, Number(input.limit) || 20)),
      threshold: Number.isFinite(Number(input.threshold)) ? Number(input.threshold) : 0,
    });
    const source = kind === 'ideas'
      ? { table: 'ideas', idColumn: 'global_id' }
      : kind === 'documents'
        ? { table: 'document_vectors', idColumn: 'vector_id' }
        : { table: 'passages', idColumn: 'passage_id' };
    const { table, idColumn } = source;
    const byId = new Map(rows(snapshot, table).map((row) => [String(row[idColumn]), row]));
    json(res, 200, {
      results: matches.map((match) => ({ id: match.id, score: match.score, row: byId.get(String(match.id)) ?? null })),
      indexed: true,
      kind,
      indexable: set.count,
      embedding: { provider: set.header.provider, model: set.header.model, dim: set.dim },
    });
    return true;
  }

  /**
   * The retrieval package for a client-side chat.
   *
   * The phone calls its own provider with its own key; the server never sees that key and
   * must not, or state.json becomes the first place in this project to hold a third-party
   * credential. So what comes back is the material and the budget, not an answer.
   */
  async function contextPackage(req, res, space) {
    const input = await jsonBody(req, VECTOR_QUERY_BYTES);
    const snapshot = readSnapshot(space.id);
    if (!snapshot) {
      json(res, 409, { error: 'not_published' });
      return true;
    }
    const budget = Math.min(MAX_CONTEXT_CHARS, Math.max(1000, Number(input.budget) || MAX_CONTEXT_CHARS));
    const sections = [];
    let used = 0;
    let truncated = false;

    const push = (kind, items) => {
      const kept = [];
      for (const item of items) {
        const cost = JSON.stringify(item).length;
        if (used + cost > budget) { truncated = true; break; }
        used += cost;
        kept.push(item);
      }
      if (kept.length) sections.push({ kind, items: kept });
    };

    const wanted = new Set(Array.isArray(input.include) && input.include.length ? input.include : [
      'ideas', 'passages', 'themes', 'gaps', 'works',
      'document_profile_versions', 'document_profile_fields', 'document_sections',
    ]);
    const hits = lexicalSearch(snapshot, input.query, 200);
    const hitIds = new Set(hits.map((hit) => String(hit.id)));

    if (wanted.has('ideas')) push('ideas', rows(snapshot, 'ideas').filter((row) => hitIds.has(String(row.global_id))));
    if (wanted.has('passages')) push('passages', rows(snapshot, 'passages').filter((row) => hitIds.has(String(row.passage_id))));
    if (wanted.has('themes')) push('themes', rows(snapshot, 'themes'));
    if (wanted.has('gaps')) push('gaps', rows(snapshot, 'gaps').filter((row) => hitIds.has(String(row.id))));
    if (wanted.has('works')) push('works', rows(snapshot, 'works').filter((row) => hitIds.has(String(row.nodus_id))));
    if (wanted.has('document_profile_versions')) push('document_profile_versions', rows(snapshot, 'document_profile_versions').filter((row) => hitIds.has(String(row.version_id))));
    if (wanted.has('document_profile_fields')) push('document_profile_fields', rows(snapshot, 'document_profile_fields').filter((row) => hitIds.has(String(row.field_id))));
    if (wanted.has('document_sections')) push('document_sections', rows(snapshot, 'document_sections').filter((row) => hitIds.has(String(row.section_id))));

    json(res, 200, {
      sections,
      stats: { chars: used, budget, truncated, matched: hits.length },
      vault: snapshot.vault ?? null,
      revision: space.revision,
      // A citation always resolves against real corpus rows, never against model output.
      citationScheme: { idea: 'nodus://idea/<global_id>', passage: 'nodus://passage/<passage_id>', work: 'nodus://work/<nodus_id>' },
      documentProfilePolicy: 'orientation_only',
    });
    return true;
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  async function postMutations(req, res, space) {
    // The one write route that had no rate limit, which was tolerable only while a mutation
    // could not be large. It can now, and the body this accepts is measured in megabytes.
    if (!rateLimit(req, res, 'mutations', 120, 60_000)) return true;
    const input = await jsonBody(req, limits.maxMutationBatchBytes);
    const batch = Array.isArray(input.mutations) ? input.mutations : [];
    if (batch.length === 0) {
      json(res, 400, { error: 'empty_batch' });
      return true;
    }
    if (batch.length > MAX_MUTATION_BATCH) {
      json(res, 413, { error: 'batch_too_large', error_description: `At most ${MAX_MUTATION_BATCH} mutations per request.`, limit: MAX_MUTATION_BATCH });
      return true;
    }
    const snapshot = readSnapshot(space.id);
    const hasAsset = (hash) => assetExists(store, space.id, hash);
    const hasDocumentUpdate = (hash) => documentUpdateExists(space.id, hash);
    const hasSharedBlob = (hash) => sharedBlobExists(space.id, hash);
    const accepted = [];
    const duplicate = [];
    const rejected = [];
    const missingAssets = new Set();

    for (const mutation of batch) {
      if (mutation?.id && ledger.has(store, space.id, String(mutation.id))) {
        duplicate.push(mutation.id);
        continue;
      }
      const verdict = validateMutation(mutation, { snapshot, hasAsset, hasDocumentUpdate, hasSharedBlob, maxBytes: limits.maxMutationBytes });
      if (!verdict.ok) {
        if (verdict.missing) missingAssets.add(verdict.missing);
        if (verdict.missingDocumentUpdate) missingAssets.add(verdict.missingDocumentUpdate);
        if (verdict.missingSharedBlob) missingAssets.add(verdict.missingSharedBlob);
        // Only `too_large` carries numbers, and only because they are the whole difference
        // between a dead end and an explanation. Every other reason stays a bare code.
        rejected.push(verdict.reason === 'too_large'
          ? { id: mutation?.id ?? null, reason: verdict.reason, bytes: verdict.bytes, limitBytes: verdict.limit, error_description: `This row is ${sizeLabel(verdict.bytes)} and this server accepts up to ${sizeLabel(verdict.limit)} per row (NODUS_MAX_MUTATION_BYTES).` }
          : { id: mutation?.id ?? null, reason: verdict.reason });
        continue;
      }
      accepted.push({
        id: String(mutation.id),
        clientId: String(mutation.clientId || ''),
        kind: mutation.kind,
        table: mutation.table,
        key: mutation.key,
        row: mutation.kind === 'upsert' ? mutation.row : null,
        assets: Array.isArray(mutation.assets) ? mutation.assets : [],
        schemaVersion: Number(mutation.schemaVersion) || 0,
        createdAt: String(mutation.createdAt || new Date().toISOString()),
        actorId: String(mutation.actorId || ''),
        deviceId: String(mutation.deviceId || mutation.clientId || ''),
        hlc: String(mutation.hlc || ''),
        documentHash: mutation.documentHash ? String(mutation.documentHash) : null,
        blobHash: mutation.blobHash ? String(mutation.blobHash) : null,
        userId: null,
      });
    }

    if (missingAssets.size > 0) {
      json(res, 409, { error: 'missing_assets', missing: [...missingAssets], error_description: 'Upload the referenced images before sending the mutations that point at them.' });
      return true;
    }

    // A full ledger is a temporary condition, not a bad request: it fills because the owner
    // has not opened Nodus, and it empties when they do. So this refuses the batch whole and
    // keeps nothing, which leaves the sender's queue intact to retry — deliberately unlike a
    // rejection, which would throw away a colleague's work over the owner's holiday.
    const incoming = accepted.reduce((total, entry) => total + Buffer.byteLength(JSON.stringify(entry)) + 1, 0);
    if (ledger.bytes(store, space.id) + incoming > limits.maxLedgerBytes) {
      json(res, 507, {
        error: 'ledger_full',
        error_description: `This space is holding ${mib(limits.maxLedgerBytes)} of changes that its owner has not collected yet. Nothing was lost. Send again once they have opened Nodus.`,
        limitBytes: limits.maxLedgerBytes,
      });
      return true;
    }

    const stamped = ledger.append(store, space.id, accepted);
    if (stamped.length) notifyMutationListeners(space.id, Number(stamped.at(-1).seq));
    json(res, 200, {
      accepted: stamped.map((entry) => entry.id),
      duplicate,
      rejected,
      cursor: stamped.length ? Number(stamped.at(-1).seq) : null,
    });
    return true;
  }

  function getMutations(req, res, space, url, auth) {
    const explicit = url.searchParams.get('since');
    const cursor = explicit == null ? Number(auth.device?.mutationCursor || space.mutationCursor || 0) : Number(explicit || 0);
    const limit = Math.max(1, Math.min(MAX_MUTATION_BATCH, Number(url.searchParams.get('limit')) || MAX_MUTATION_BATCH));
    // Bounded by bytes as well as by count, so a page of large rows cannot become a response
    // this process is unable to serialize. Callers follow `hasMore`; a short page is normal.
    const page = ledger.since(store, space.id, cursor, limit, limits.maxMutationBatchBytes);
    json(res, 200, { ...page, spaceSchemaVersion: space.schemaVersion ?? 0 });
    return true;
  }

  async function ackMutations(req, res, space, auth) {
    const input = await jsonBody(req, AUTH_BODY_BYTES);
    const cursor = Number(input.cursor || 0);
    if (auth.device) auth.device.mutationCursor = Math.max(Number(auth.device.mutationCursor || 0), cursor);
    const devices = store.state.deviceTokens.filter((entry) => entry.spaceId === space.id
      && (!entry.expiresAt || Date.parse(entry.expiresAt) > Date.now()));
    const compactTo = devices.length ? Math.min(...devices.map((entry) => Number(entry.mutationCursor || 0))) : 0;
    const remaining = compactTo > Number(space.mutationCursor || 0) ? ledger.compact(store, space.id, compactTo) : ledger.readAll(store, space.id).length;
    space.mutationCursor = Math.max(Number(space.mutationCursor || 0), compactTo);
    store.save();
    // Anything the acknowledged mutations were holding alive may now be collectable.
    collectAssetGarbage(store, space.id, referencedAssets(space.id), limits.assetGraceMs);
    json(res, 200, { ok: true, cursor: space.mutationCursor, pending: remaining });
    return true;
  }

  // ── Snapshot channel ──────────────────────────────────────────────────────

  async function putSnapshot(req, res, space, device) {
    if (!rateLimit(req, res, 'snapshot-publish', 60, 5 * 60_000)) return true;
    if (req.headers['content-encoding'] !== 'gzip') {
      json(res, 415, { error: 'The publication must be gzip-compressed.' });
      return true;
    }
    const revision = String(req.headers['x-nodus-revision'] || '');
    if (revision && revision === space.revision) {
      json(res, 200, { ok: true, unchanged: true, updatedAt: space.updatedAt });
      return true;
    }
    const announced = Number(req.headers['content-length'] || 0);
    if (announced > limits.maxSnapshotBytes) {
      json(res, 413, { error: `The compressed publication is ${mib(announced)} and this server accepts uploads of up to ${mib(limits.maxSnapshotBytes)} (NODUS_MAX_SNAPSHOT_BYTES).`, limitBytes: limits.maxSnapshotBytes, uploadBytes: announced });
      return true;
    }
    const bytes = await body(req, limits.maxSnapshotBytes);
    const expanded = expandSnapshot(bytes);
    if (expanded.reason === 'too-large') {
      const size = expanded.expanded === null ? 'past the limit' : `to ${mib(expanded.expanded)}`;
      json(res, 413, { error: `The publication expands ${size} and this server accepts up to ${mib(limits.maxSnapshotJsonBytes)} of expanded data (NODUS_MAX_SNAPSHOT_JSON_BYTES).`, limitBytes: limits.maxSnapshotJsonBytes, expandedBytes: expanded.expanded });
      return true;
    }
    if (expanded.reason) {
      json(res, 400, { error: 'The compressed publication is not readable: the body must be gzipped JSON.' });
      return true;
    }
    const snapshot = expanded.value;
    const formatVersion = Number(snapshot?.formatVersion);
    if (snapshot?.format !== 'nodus.server-snapshot' || !capabilities().snapshotVersions.includes(formatVersion)) {
      json(res, 400, { error: 'Unsupported publication format.' });
      return true;
    }
    const libraryProblem = validatePublishedLibrary(space.id, snapshot.library);
    if (libraryProblem) {
      json(res, libraryProblem.status, { error: libraryProblem.error, error_description: libraryProblem.error_description });
      return true;
    }
    store.writeSnapshot(space.id, bytes);
    invalidateSnapshot(space.id);
    space.updatedAt = new Date().toISOString();
    space.revision = revision || snapshot.revision || '';
    space.vault = snapshot.vault;
    if (snapshot?.vault?.type) space.vaultType = String(snapshot.vault.type);
    space.bytes = bytes.length;
    space.schemaVersion = Number(snapshot.schemaVersion) || 0;
    space.snapshotFormatVersion = formatVersion;
    if (device) device.lastUsedAt = space.updatedAt;
    store.save();
    // A republication is the moment an image can stop being referenced. The grace window in
    // collectAssetGarbage is what keeps it from racing an upload that is still in flight.
    const removed = collectAssetGarbage(store, space.id, referencedAssets(space.id), limits.assetGraceMs);
    const removedLibraryPackages = collectLibraryPackageGarbage(
      store, space.id, snapshotLibraryPackageHashes(snapshot), limits.assetGraceMs,
    );
    if (removed.length) {
      space.assetBytes = Math.max(0, Number(space.assetBytes || 0));
      store.save();
    }
    if (removedLibraryPackages.length) {
      space.libraryPackageBytes = spaceLibraryPackageBytes(store, space.id);
      store.save();
    }
    json(res, 200, { ok: true, unchanged: false, updatedAt: space.updatedAt, bytes: bytes.length, assetsCollected: removed.length, libraryPackagesCollected: removedLibraryPackages.length });
    return true;
  }

  function getSnapshot(req, res, space) {
    const file = store.snapshotPath(space.id);
    if (!ctx.fs.existsSync(file)) {
      json(res, 409, { error: 'not_published' });
      return true;
    }
    const tag = `W/"${space.revision || space.updatedAt || 'none'}"`;
    if (req.headers['if-none-match'] === tag) {
      res.writeHead(304, { etag: tag });
      res.end();
      return true;
    }
    const bytes = ctx.fs.readFileSync(file);
    res.writeHead(200, {
      'content-type': 'application/vnd.nodus.snapshot+json',
      'content-encoding': 'gzip',
      'content-length': String(bytes.length),
      etag: tag,
      'cache-control': 'private, no-cache',
      'x-nodus-revision': space.revision || '',
    });
    if (req.method === 'HEAD') res.end();
    else res.end(bytes);
    return true;
  }

  // ── Nodi's quick notes ────────────────────────────────────────────────────

  const NODI_NOTES_BODY_BYTES = 8 * 1024 * 1024;

  /** `?since=` in epoch milliseconds, so a client can ask only for what changed. */
  function sinceParam(url) {
    const raw = url.searchParams.get('since');
    if (raw === null || raw === '') return Number.NaN;
    const value = Number(raw);
    return Number.isFinite(value) ? value : Number.NaN;
  }

  function getNodiNotes(req, res, url) {
    const auth = authorize(req, res, { via: ['device', 'oauth'], resource: 'api', scope: 'materials.read' });
    if (!auth) return true;
    const notes = store.readNodiNotes(auth.user.id);
    json(res, 200, {
      notes: notesSince(notes, sinceParam(url)),
      total: notes.filter((note) => note.deletedAt === null).length,
      // The client's clock is not the server's, and `since` is compared against the
      // server's. Handing back the reference it should send next time is what keeps a
      // skewed device from re-reading everything or, worse, missing a note.
      serverTime: Date.now(),
    });
    return true;
  }

  async function postNodiNotes(req, res, url) {
    const auth = authorize(req, res, { via: ['device', 'oauth'], resource: 'api', scope: 'materials.write' });
    if (!auth) return true;
    // One person's own notes, so the limit is about a runaway client rather than abuse.
    if (!rateLimit(req, res, 'nodi-notes', 120, 60_000)) return true;

    const input = await jsonBody(req, NODI_NOTES_BODY_BYTES);
    const incoming = Array.isArray(input?.notes) ? input.notes : null;
    if (!incoming) {
      json(res, 400, { error: 'malformed', error_description: 'Send { notes: [...] }.' });
      return true;
    }
    if (incoming.length > MAX_NODI_NOTES) {
      json(res, 413, { error: 'too_many', error_description: `At most ${MAX_NODI_NOTES} notes per request.` });
      return true;
    }

    const now = Date.now();
    const accepted = [];
    const rejected = [];
    for (const value of incoming) {
      const { note, error } = validateNodiNote(value, now);
      if (note) accepted.push(note);
      else rejected.push({ id: String(value?.id ?? ''), reason: error });
    }

    const merged = mergeNodiNotes(store.readNodiNotes(auth.user.id), accepted, now);
    store.writeNodiNotes(auth.user.id, merged);
    json(res, 200, {
      notes: notesSince(merged, sinceParam(url)),
      total: merged.filter((note) => note.deletedAt === null).length,
      rejected,
      serverTime: now,
    });
    return true;
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────

  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/v1')) return false;
    const segments = url.pathname.slice('/api/v1'.length).split('/').filter(Boolean);

    if (segments.length === 1 && segments[0] === 'capabilities' && req.method === 'GET') {
      json(res, 200, capabilities());
      return true;
    }
    if (segments.length === 2 && segments[0] === 'auth' && segments[1] === 'login' && req.method === 'POST') return login(req, res);
    if (segments.length === 2 && segments[0] === 'auth' && segments[1] === 'device' && req.method === 'POST') return createDeviceToken(req, res);

    if (segments.length === 1 && segments[0] === 'me' && req.method === 'GET') {
      const auth = authorize(req, res, { via: ['device', 'oauth'], resource: 'api', scope: 'materials.read' });
      if (!auth) return true;
      json(res, 200, {
        user: { id: auth.user.id, email: auth.user.email, role: auth.user.role },
        spaces: spacesFor(auth.user),
        device: auth.device ? { name: auth.device.deviceName, kind: auth.device.kind ?? 'publisher', spaceId: auth.device.spaceId, expiresAt: auth.device.expiresAt ?? null } : null,
        server: capabilities().server,
      });
      return true;
    }

    // ── Nodi's quick notes ────────────────────────────────────────────────
    //
    // The only resource here that is not a space. Nodi is the companion, and its notes are
    // shared across every vault a person opens, so they hang off the account: the same
    // device token authorises them, by the user it was issued to rather than by the space
    // it was scoped to.
    if (segments.length === 2 && segments[0] === 'nodi' && segments[1] === 'notes') {
      if (req.method === 'GET') return getNodiNotes(req, res, url);
      if (req.method === 'POST') return postNodiNotes(req, res, url);
      json(res, 405, { error: 'method_not_allowed' });
      return true;
    }

    if (segments[0] !== 'spaces' || segments.length < 2) return false;
    const spaceId = decodeURIComponent(segments[1]);
    const rest = segments.slice(2);
    const head = rest[0];

    // The publish channel keeps the device-only door it has always had; everything else
    // accepts an OAuth token too, because that is how the mobile app arrives.
    if (head === 'snapshot' && req.method === 'PUT') {
      const auth = authorize(req, res, { spaceId, need: 'own', via: ['device'], resource: 'api' });
      if (!auth) return true;
      return putSnapshot(req, res, auth.space, auth.device);
    }

    const need = mutatingNeed(req.method, head, rest);
    const auth = authorize(req, res, {
      spaceId,
      need,
      via: ['device', 'oauth'],
      resource: 'api',
      scope: need === 'read' ? 'materials.read' : 'materials.write',
    });
    if (!auth) return true;
    const space = auth.space;

    if (head === 'snapshot' && (req.method === 'GET' || req.method === 'HEAD')) return getSnapshot(req, res, space);

    if (head === 'assets') {
      if (rest[1] === 'negotiate' && req.method === 'POST') return negotiateAssets(req, res, space);
      const hash = rest[1] ? decodeURIComponent(rest[1]) : '';
      if (req.method === 'POST' || req.method === 'PUT') return uploadAsset(req, res, space, hash);
      if (req.method === 'GET' || req.method === 'HEAD') return downloadAsset(req, res, space, hash);
      json(res, 405, { error: 'method_not_allowed' });
      return true;
    }

    if (head === 'document-updates') {
      const hash = rest[1] ? decodeURIComponent(rest[1]) : '';
      if (req.method === 'PUT') return uploadDocumentUpdate(req, res, space, hash);
      if (req.method === 'GET' || req.method === 'HEAD') return downloadDocumentUpdate(req, res, space, hash);
      json(res, 405, { error: 'method_not_allowed' });
      return true;
    }

    if (head === 'blobs') {
      const hash = rest[1] ? decodeURIComponent(rest[1]) : '';
      if (rest[2] === 'status' && req.method === 'GET') return sharedBlobStatus(req, res, space, hash);
      if (rest[2] === 'chunks' && rest[3] != null && req.method === 'PUT') return uploadSharedBlobChunk(req, res, space, hash, rest[3]);
      if (rest[2] === 'complete' && req.method === 'POST') return completeSharedBlob(req, res, space, hash);
      if (!rest[2] && (req.method === 'GET' || req.method === 'HEAD')) return downloadSharedBlob(req, res, space, hash);
      json(res, 405, { error: 'method_not_allowed' }); return true;
    }

    if (head === 'library') {
      if (rest[1] === 'negotiate' && req.method === 'POST') return negotiateLibraryPackages(req, res, space);
      if (rest[1] === 'packages' && rest[2] && req.method === 'PUT') return uploadLibraryPackage(req, res, space, decodeURIComponent(rest[2]));
      if (!rest[1] && req.method === 'GET') return librarySummary(req, res, space);
      if (rest[1] === 'collections' && req.method === 'GET') return libraryCollections(req, res, space);
      if (rest[1] === 'documents' && !rest[2] && req.method === 'GET') return libraryDocuments(req, res, space, url);
      if (rest[1] === 'documents' && rest[2] && rest[3] === 'download.zip' && (req.method === 'GET' || req.method === 'HEAD')) return downloadLibraryDocument(req, res, space, decodeURIComponent(rest[2]));
      if (rest[1] === 'documents' && rest[2] && req.method === 'GET') return libraryDocument(req, res, space, decodeURIComponent(rest[2]));
      json(res, 405, { error: 'method_not_allowed' });
      return true;
    }

    if (head === 'vectors' && req.method === 'PUT') return uploadVectors(req, res, space);
    if (head === 'search' && rest[1] === 'semantic' && req.method === 'POST') return semanticSearch(req, res, space);
    if (head === 'context' && req.method === 'POST') return contextPackage(req, res, space);

    if (head === 'mutations') {
      if (rest[1] === 'events' && req.method === 'GET') return mutationEvents(req, res, space);
      if (rest[1] === 'ack' && req.method === 'POST') return ackMutations(req, res, space, auth);
      if (req.method === 'POST') return postMutations(req, res, space);
      if (req.method === 'GET') return getMutations(req, res, space, url, auth);
      json(res, 405, { error: 'method_not_allowed' });
      return true;
    }

    if (head === 'presence' && ['GET', 'POST', 'DELETE'].includes(req.method)) return updatePresence(req, res, space, auth);

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      json(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    return corpus.handle(req, res, { json, url, space, segments: rest });
  }

  /**
   * What a route demands of the caller's space role.
   *
   * Reading and acknowledging the shared operation stream is `read`; every device keeps its
   * own cursor, so acknowledging no longer drains another replica's queue.
   */
  function mutatingNeed(method, head, rest) {
    if (head === 'mutations') return method === 'POST' && rest[1] !== 'ack' ? 'write' : 'read';
    if (head === 'vectors') return 'own';
    if (head === 'assets') return method === 'POST' || method === 'PUT' ? 'write' : 'read';
    if (head === 'document-updates') return method === 'PUT' ? 'write' : 'read';
    if (head === 'blobs') return method === 'PUT' || method === 'POST' ? 'write' : 'read';
    if (head === 'library') return method === 'POST' || method === 'PUT' ? 'own' : 'read';
    return 'read';
  }

  return { handle, capabilities, spacesFor, mutatingNeed };
}

export { can };
