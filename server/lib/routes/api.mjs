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
import { MAX_MUTATION_BATCH, validateMutation } from '../core/mutations.mjs';
import {
  MAX_NODI_NOTES, mergeNodiNotes, notesSince, validateNodiNote,
} from '../core/nodiNotes.mjs';
import { decodeVectorSet, embeddingMatches } from '../core/vectors.mjs';
import { searchVectorsOffThread } from '../core/vectorSearchPool.mjs';
import { lexicalSearch } from '../core/search.mjs';
import { rows } from '../core/snapshot.mjs';
import { NODUS_VERSION } from '../version.mjs';

const AUTH_BODY_BYTES = 32 * 1024;
const TICKET_TTL_MS = 5 * 60_000;
const MUTATION_BATCH_BYTES = 2 * 1024 * 1024;
const VECTOR_QUERY_BYTES = 256 * 1024;
/** Matches the desktop research assistant's ceiling (electron/ai/researchAssistant.ts). */
const MAX_CONTEXT_CHARS = 600_000;

export function createApiRoutes(ctx) {
  const {
    store, authorize, json, body, jsonBody, readSnapshot, invalidateSnapshot, expandSnapshot,
    publicUrl, resourceMap, language, rateLimit, clearRateLimit, limits, corpus, mib,
  } = ctx;

  const vectorCache = new Map();

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
      server: { name: store.state.settings.name, publicUrl: publicUrl(), language: language(), version: NODUS_VERSION },
      snapshotVersions: [1, 2],
      assets: true,
      mutations: true,
      vectors: true,
      resources: resourceMap(),
      maxAssetBytes: limits.maxAssetBytes,
      maxSpaceAssetBytes: limits.maxSpaceAssetBytes,
      maxSnapshotBytes: limits.maxSnapshotBytes,
      maxSnapshotJsonBytes: limits.maxSnapshotJsonBytes,
      maxMutationBatch: MAX_MUTATION_BATCH,
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
    const table = kind === 'ideas' ? 'ideas' : 'passages';
    const idColumn = kind === 'ideas' ? 'global_id' : 'passage_id';
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

    const wanted = new Set(Array.isArray(input.include) && input.include.length ? input.include : ['ideas', 'passages', 'themes', 'gaps', 'works']);
    const hits = lexicalSearch(snapshot, input.query, 200);
    const hitIds = new Set(hits.map((hit) => String(hit.id)));

    if (wanted.has('ideas')) push('ideas', rows(snapshot, 'ideas').filter((row) => hitIds.has(String(row.global_id))));
    if (wanted.has('passages')) push('passages', rows(snapshot, 'passages').filter((row) => hitIds.has(String(row.passage_id))));
    if (wanted.has('themes')) push('themes', rows(snapshot, 'themes'));
    if (wanted.has('gaps')) push('gaps', rows(snapshot, 'gaps').filter((row) => hitIds.has(String(row.id))));
    if (wanted.has('works')) push('works', rows(snapshot, 'works').filter((row) => hitIds.has(String(row.nodus_id))));

    json(res, 200, {
      sections,
      stats: { chars: used, budget, truncated, matched: hits.length },
      vault: snapshot.vault ?? null,
      revision: space.revision,
      // A citation always resolves against real corpus rows, never against model output.
      citationScheme: { idea: 'nodus://idea/<global_id>', passage: 'nodus://passage/<passage_id>', work: 'nodus://work/<nodus_id>' },
    });
    return true;
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  async function postMutations(req, res, space) {
    const input = await jsonBody(req, MUTATION_BATCH_BYTES);
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
    const accepted = [];
    const duplicate = [];
    const rejected = [];
    const missingAssets = new Set();

    for (const mutation of batch) {
      if (mutation?.id && ledger.has(store, space.id, String(mutation.id))) {
        duplicate.push(mutation.id);
        continue;
      }
      const verdict = validateMutation(mutation, { snapshot, hasAsset });
      if (!verdict.ok) {
        if (verdict.missing) missingAssets.add(verdict.missing);
        rejected.push({ id: mutation?.id ?? null, reason: verdict.reason });
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
        userId: null,
      });
    }

    if (missingAssets.size > 0) {
      json(res, 409, { error: 'missing_assets', missing: [...missingAssets], error_description: 'Upload the referenced images before sending the mutations that point at them.' });
      return true;
    }

    const stamped = ledger.append(store, space.id, accepted);
    json(res, 200, {
      accepted: stamped.map((entry) => entry.id),
      duplicate,
      rejected,
      cursor: stamped.length ? Number(stamped.at(-1).seq) : null,
    });
    return true;
  }

  function getMutations(req, res, space, url) {
    const cursor = Number(url.searchParams.get('since') || 0);
    const limit = Math.max(1, Math.min(MAX_MUTATION_BATCH, Number(url.searchParams.get('limit')) || MAX_MUTATION_BATCH));
    json(res, 200, { ...ledger.since(store, space.id, cursor, limit), spaceSchemaVersion: space.schemaVersion ?? 0 });
    return true;
  }

  async function ackMutations(req, res, space) {
    const input = await jsonBody(req, AUTH_BODY_BYTES);
    const cursor = Number(input.cursor || 0);
    const remaining = ledger.compact(store, space.id, cursor);
    space.mutationCursor = Math.max(Number(space.mutationCursor || 0), cursor);
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
    store.writeSnapshot(space.id, bytes);
    invalidateSnapshot(space.id);
    space.updatedAt = new Date().toISOString();
    space.revision = revision || snapshot.revision || '';
    space.vault = snapshot.vault;
    space.bytes = bytes.length;
    space.schemaVersion = Number(snapshot.schemaVersion) || 0;
    space.snapshotFormatVersion = formatVersion;
    if (device) device.lastUsedAt = space.updatedAt;
    store.save();
    // A republication is the moment an image can stop being referenced. The grace window in
    // collectAssetGarbage is what keeps it from racing an upload that is still in flight.
    const removed = collectAssetGarbage(store, space.id, referencedAssets(space.id), limits.assetGraceMs);
    if (removed.length) {
      space.assetBytes = Math.max(0, Number(space.assetBytes || 0));
      store.save();
    }
    json(res, 200, { ok: true, unchanged: false, updatedAt: space.updatedAt, bytes: bytes.length, assetsCollected: removed.length });
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

    if (head === 'vectors' && req.method === 'PUT') return uploadVectors(req, res, space);
    if (head === 'search' && rest[1] === 'semantic' && req.method === 'POST') return semanticSearch(req, res, space);
    if (head === 'context' && req.method === 'POST') return contextPackage(req, res, space);

    if (head === 'mutations') {
      if (rest[1] === 'ack' && req.method === 'POST') return ackMutations(req, res, space);
      if (req.method === 'POST') return postMutations(req, res, space);
      if (req.method === 'GET') return getMutations(req, res, space, url);
      json(res, 405, { error: 'method_not_allowed' });
      return true;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      json(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    return corpus.handle(req, res, { json, url, space, segments: rest });
  }

  /**
   * What a route demands of the caller's space role.
   *
   * Reading is `read`; sending a mutation or an image is `write`; taking mutations out of
   * the ledger, replacing the vectors or publishing is `own`, because those are the owner's
   * side of the relay and a writer must not be able to drain the queue that feeds it.
   */
  function mutatingNeed(method, head, rest) {
    if (head === 'mutations') return method === 'POST' && rest[1] !== 'ack' ? 'write' : 'own';
    if (head === 'vectors') return 'own';
    if (head === 'assets') return method === 'POST' || method === 'PUT' ? 'write' : 'read';
    return 'read';
  }

  return { handle, capabilities, spacesFor, mutatingNeed };
}

export { can };
