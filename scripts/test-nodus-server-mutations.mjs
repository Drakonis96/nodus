// The mutation ledger: what a writer may send, what the server refuses outright, and how
// the owner drains it.
//
// The design decision this pins is that the server never interprets a mutation. It validates
// the shape and appends; the owner's desktop is still the only thing that writes the vault.
// So the interesting failures are all validation ones — and the neat trick under test is
// that the server checks columns against the last published snapshot, which is the vault's
// schema expressed as data, without the server needing to know any SQL at all.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_MAX_MUTATION_BYTES, MUTABLE_TABLES, rowKey, validateMutation } from '../server/lib/core/mutations.mjs';
import * as ledger from '../server/lib/ledger.mjs';
import { Store } from '../server/lib/store.mjs';
import { academicSnapshot, publish } from './lib/nodusServerFixtures.mjs';
import { withServer } from './lib/nodusServerHarness.mjs';

const NOTE_ROW = {
  id: 'n-new', folder_id: null, title: 'Nota del colaborador', kind: 'markdown',
  content: 'Escrito desde una réplica.', source_json: null, order_idx: 0,
  created_at: '2026-02-02T00:00:00.000Z', updated_at: '2026-02-02T00:00:00.000Z',
};

function mutation(overrides = {}) {
  return {
    id: 'mut-1', clientId: 'client-1', kind: 'upsert', table: 'notes', key: ['n-new'],
    row: NOTE_ROW, schemaVersion: 121, createdAt: '2026-02-02T00:00:00.000Z', ...overrides,
  };
}

function sharedMutation(overrides = {}) {
  return mutation({
    table: 'edge_feedback', key: ['i-a', 'i-b', 'supports'],
    row: {
      from_id: 'i-a', to_id: 'i-b', type: 'supports', verdict: 'accepted', note: '',
      created_at: '2026-02-02T00:00:00.000Z',
    },
    ...overrides,
  });
}

test('the whitelist covers user-authored tables and nothing derived from the corpus', () => {
  const tables = Object.keys(MUTABLE_TABLES);
  for (const allowed of ['notes', 'note_folders', 'writing_saved_drafts', 'writing_draft_annotations', 'immersion_sessions', 'edge_feedback']) {
    assert.ok(tables.includes(allowed), `${allowed} is authored by the user and may travel back`);
  }
  // Everything below is produced by the owner's analysis pipeline, or is not shareable at
  // all. A regression that adds one of these is a data-integrity or a privacy failure.
  for (const forbidden of [
    'works', 'ideas', 'edges', 'evidence', 'passages', 'themes', 'gaps', 'authors',
    'teaching_students', 'teaching_groups', 'teaching_grades',
    'testimony_segments', 'prosop_audit_log', 'settings', 'sync_tombstones',
  ]) {
    assert.ok(!tables.includes(forbidden), `${forbidden} must never be writable from a replica`);
  }
});

test('row keys serialize exactly as the tombstone triggers write them', () => {
  // electron/db/tombstones.ts builds row_key with JSON.stringify over the identity values in
  // identityColumns() order. A key written by SQL and one written here must compare equal or
  // a delete silently fails to match the row it means.
  assert.equal(rowKey('notes', ['n-1']), '["n-1"]');
  assert.equal(rowKey('decorative_images', ['deep_research', 'dr-1']), '["deep_research","dr-1"]');
  assert.equal(rowKey('writing_draft_annotations', ['ann-1']), '["ann-1"]');
  assert.equal(rowKey('edge_feedback', ['i-a', 'i-b', 'contradicts']), '["i-a","i-b","contradicts"]');
  assert.equal(rowKey('notes', [null]), '[null]');
  assert.equal(rowKey('notes', [42]), '["42"]', 'numeric ids are stringified, as SQLite hands them over');
});

test('validation refuses everything the ledger must not carry', () => {
  const { payload } = academicSnapshot();
  const hasAsset = () => true;
  const check = (input) => validateMutation(input, { snapshot: payload, hasAsset });

  assert.equal(check(mutation()).ok, true);

  assert.equal(check(mutation({ table: 'ideas' })).reason, 'table_not_mutable');
  assert.equal(check(mutation({ table: 'teaching_students' })).reason, 'table_not_mutable');
  assert.equal(check(mutation({ kind: 'truncate' })).reason, 'unknown_kind');
  assert.equal(check(mutation({ id: '' })).reason, 'missing_id');
  assert.equal(check(mutation({ key: [] })).reason, 'bad_key');
  assert.equal(check(mutation({ key: ['a', 'b'] })).reason, 'bad_key', 'notes has a single-column identity');
  assert.equal(check(mutation({ row: undefined })).reason, 'missing_row');

  const annotation = mutation({
    table: 'writing_draft_annotations',
    key: ['ann-2'],
    row: {
      id: 'ann-2', draft_id: 'dr-1', scope: 'source', kind: 'comment', color: null,
      start_offset: 2, end_offset: 7, selected_text: 'Texto', prefix: '', suffix: '.',
      comment_text: 'Revisar esta afirmación.',
      created_at: '2026-02-02T00:00:00.000Z', updated_at: '2026-02-02T00:00:00.000Z',
    },
  });
  assert.equal(check(annotation).ok, true, 'a small report annotation travels through the existing ledger');
  const bookmarkId = 'reader-bookmark:dr-1:source';
  const bookmark = mutation({
    id: 'mut-bookmark',
    table: 'writing_draft_annotations',
    key: [bookmarkId],
    row: {
      ...annotation.row,
      id: bookmarkId,
      kind: 'bookmark',
      color: null,
      comment_text: null,
    },
  });
  assert.equal(check(bookmark).ok, true, 'the shared deterministic bookmark row travels');
  assert.equal(check(mutation({ ...bookmark, key: ['another-bookmark'] })).reason, 'constraint');
  assert.equal(check(mutation({ ...annotation, row: { ...annotation.row, kind: 'highlight', color: 'neon' } })).reason, 'constraint');
  assert.equal(check(mutation({ ...annotation, row: { ...annotation.row, kind: 'highlight', color: 'mint' } })).reason, 'constraint', 'highlights cannot smuggle comment text');
  assert.equal(check(mutation({ ...annotation, row: { ...annotation.row, color: 'mint' } })).reason, 'constraint', 'comments have no highlight color');

  // The column check reads the shape of the published snapshot, so a column nobody has ever
  // published cannot be written — without the server knowing any SQL.
  assert.match(check(mutation({ row: { ...NOTE_ROW, secret_flag: 1 } })).reason, /^unknown_column:secret_flag$/);
  assert.equal(check(mutation({ row: { ...NOTE_ROW, content: { nested: true } } })).reason, 'non_scalar_value');
  assert.equal(check(mutation({ row: { ...NOTE_ROW, content: ['a'] } })).reason, 'non_scalar_value');

  // decorative_images is only mutable for a Deep Research illustration.
  assert.equal(check(mutation({ table: 'decorative_images', key: ['deep_research', 'dr-1'], row: { entity_kind: 'deep_research', entity_id: 'dr-1', status: 'ready' } })).ok, true);
  assert.equal(check(mutation({ table: 'decorative_images', key: ['immersion', 'im-1'], row: { entity_kind: 'immersion', entity_id: 'im-1', status: 'ready' } })).reason, 'constraint');

  // A delete carries no row.
  assert.equal(check(mutation({ kind: 'delete', row: null })).ok, true);
  assert.equal(check(mutation({ kind: 'delete', row: NOTE_ROW })).reason, 'delete_has_row');

  // An image referenced before it was uploaded is a retryable 409, not a rejection.
  const missing = validateMutation(mutation({ assets: [{ hash: 'a'.repeat(64) }] }), { snapshot: payload, hasAsset: () => false });
  assert.equal(missing.reason, 'missing_asset');
  assert.equal(missing.missing, 'a'.repeat(64));
  assert.equal(check(mutation({ assets: [{ hash: 'nope' }] })).reason, 'bad_asset');

  // A table that has never been published still has to pass the whitelist; the column check
  // simply cannot run, and permissive there is the right default.
  const empty = validateMutation(mutation({ table: 'saved_searches', key: ['s-1'], row: { id: 's-1', name: 'x' } }), { snapshot: payload, hasAsset });
  assert.equal(empty.ok, true);
});

/** A Deep Research report of `words` words, in the shape the phone and the desktop both send. */
function reportMutation(words, overrides = {}) {
  // Accented Spanish on purpose: these are two bytes each once JSON-escaped, and that is half
  // the reason a report measured far larger than its word count suggested.
  const markdown = Array.from({ length: words }, (_, index) => (index % 7 === 0 ? 'investigación' : 'análisis')).join(' ');
  return mutation({
    id: 'mut-report',
    table: 'writing_saved_drafts',
    key: ['dr-2'],
    row: {
      id: 'dr-2',
      title: 'Omisiones en la literatura y fotografía de viaje',
      brief_json: JSON.stringify({ kind: 'deep_research', objective: 'Omisiones', language: 'es' }),
      selection_json: '{}',
      model_json: '{}',
      draft_json: JSON.stringify({ title: 'Omisiones', draftMarkdown: markdown, bibliography: [] }),
      created_at: '2026-02-02T00:00:00.000Z',
      updated_at: '2026-02-02T00:00:00.000Z',
    },
    ...overrides,
  });
}

test('a Deep Research report fits, and a row that does not says by how much', () => {
  const { payload } = academicSnapshot();
  const hasAsset = () => true;
  const check = (input, maxBytes) => validateMutation(input, { snapshot: payload, hasAsset, ...(maxBytes ? { maxBytes } : {}) });

  // The regression this whole change exists for. Fifteen pages at 450 words a page is what
  // complete evidence-rich reports can exceed 64 KiB and were refused every single time.
  const exhaustive = reportMutation(15 * 450);
  assert.ok(check(exhaustive).bytes > 64 * 1024, 'a real report is larger than the old ceiling');
  assert.equal(check(exhaustive).ok, true, 'and the feature the app ships must fit the limit it ships with');

  // A row past the ceiling reports both numbers, because "too large" alone is a dead end.
  const refused = check(exhaustive, 32 * 1024);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'too_large');
  assert.equal(refused.limit, 32 * 1024);
  assert.ok(refused.bytes > refused.limit);

  // The default is not free to raise alone: it is chosen against the worst batch a client
  // that still counts rows can send. If this product grows, MAX_MUTATION_BATCH_BYTES must too.
  assert.ok(DEFAULT_MAX_MUTATION_BYTES * 200 <= 64 * 1024 * 1024, 'worst-case batch must stay servable');
});

test('the ledger is append-only, idempotent, and compacts on acknowledgement', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-ledger-'));
  try {
    const store = new Store(root);
    const spaceId = 'space-ledger';
    assert.deepEqual(ledger.readAll(store, spaceId), []);

    const first = ledger.append(store, spaceId, [{ id: 'a' }, { id: 'b' }]);
    assert.deepEqual(first.map((entry) => entry.seq), [1, 2]);
    const second = ledger.append(store, spaceId, [{ id: 'c' }]);
    assert.equal(second[0].seq, 3, 'sequence numbers continue across calls');

    assert.equal(ledger.has(store, spaceId, 'a'), true);
    assert.equal(ledger.has(store, spaceId, 'zzz'), false);

    const page = ledger.since(store, spaceId, 0, 2);
    assert.deepEqual(page.mutations.map((entry) => entry.id), ['a', 'b']);
    assert.equal(page.cursor, 2);
    assert.equal(page.hasMore, true);
    assert.equal(ledger.since(store, spaceId, 2, 10).hasMore, false);

    assert.equal(ledger.compact(store, spaceId, 2), 1, 'only what the owner acknowledged is dropped');
    assert.deepEqual(ledger.readAll(store, spaceId).map((entry) => entry.id), ['c']);
    assert.equal(ledger.compact(store, spaceId, 3), 0);
    assert.deepEqual(ledger.readAll(store, spaceId), []);

    // Emptying the ledger DELETES the file, so numbering used to restart at 1 here. That
    // is only invisible while nobody remembers a cursor — and spacesFor now publishes one,
    // so a sender that had been told "delivered up to 3" would read the next three brand
    // new mutations as already delivered. nextSeq is seeded from the acknowledged cursor.
    store.state.spaces.push({ id: spaceId, name: 'Ledger', mutationCursor: 3 });
    const afterCompaction = ledger.append(store, spaceId, [{ id: 'd' }]);
    assert.equal(afterCompaction[0].seq, 4, 'a compacted ledger must not reissue sequence numbers');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a page of mutations is bounded by bytes, and never by so much that it stalls', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-ledger-bytes-'));
  try {
    const store = new Store(root);
    const spaceId = 'space-bytes';
    const filler = (size) => ({ id: `e-${size}`, row: { content: 'x'.repeat(size) } });
    ledger.append(store, spaceId, [filler(4_000), filler(4_001), filler(4_002)]);

    // Counting rows alone could not bound this response, and the response is built as one
    // string: past 512 MiB Node cannot hold it at all.
    const page = ledger.since(store, spaceId, 0, 200, 9_000);
    assert.equal(page.mutations.length, 2, 'the byte budget cuts the page before the count does');
    assert.equal(page.hasMore, true);
    assert.equal(page.cursor, 2, 'the cursor follows what was actually handed over');
    assert.equal(ledger.since(store, spaceId, page.cursor, 200, 9_000).mutations.length, 1);

    // The rule that keeps a big row from becoming a permanently undeliverable one: the owner
    // acknowledges by cursor, so an entry never handed over can never be acknowledged, and
    // the ledger would stop draining at that row forever.
    const alone = ledger.since(store, spaceId, 0, 200, 10);
    assert.equal(alone.mutations.length, 1, 'an entry larger than the whole budget still ships');
    assert.equal(alone.hasMore, true);

    assert.equal(ledger.bytes(store, spaceId) > 12_000, true, 'the quota measures the file, not a parse');
    assert.equal(ledger.bytes(store, 'space-that-never-wrote'), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a writer sends, the owner drains and acknowledges, and a replay changes nothing', { timeout: 60_000 }, async () => {
  await withServer({ label: 'mutations' }, async (server) => {
    const spaceId = await server.createSpace('Corpus');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    await server.createUser('escritor@example.test', 'escritor-account-password', [{ spaceId, role: 'writer' }]);
    const writer = await server.deviceToken('escritor@example.test', 'escritor-account-password', spaceId);
    await publish(server.origin, owner.deviceToken, spaceId, academicSnapshot());

    const sent = await server.api(writer.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, { json: { mutations: [sharedMutation()] } });
    assert.equal(sent.status, 200);
    const accepted = await sent.json();
    assert.deepEqual(accepted.accepted, ['mut-1']);
    assert.deepEqual(accepted.rejected, []);
    assert.equal(accepted.cursor, 1);

    // Replay: the same id is recognised, not stored twice.
    const replayed = await (await server.api(writer.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, { json: { mutations: [sharedMutation()] } })).json();
    assert.deepEqual(replayed.duplicate, ['mut-1']);
    assert.deepEqual(replayed.accepted, []);

    // A rejected mutation reports why, and does not poison its batch-mates.
    const mixed = await (await server.api(writer.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, {
      json: { mutations: [mutation({ id: 'mut-2', table: 'ideas' }), sharedMutation({ id: 'mut-3', key: ['i-b', 'i-c', 'supports'], row: { from_id: 'i-b', to_id: 'i-c', type: 'supports', verdict: 'accepted', note: '', created_at: '2026-02-02T00:00:00.000Z' } })] },
    })).json();
    assert.deepEqual(mixed.accepted, ['mut-3']);
    assert.deepEqual(mixed.rejected, [{ id: 'mut-2', reason: 'table_not_mutable' }]);

    // The owner drains, sees the writer's schema version, and acknowledges.
    const drained = await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/mutations?since=0`)).json();
    assert.deepEqual(drained.mutations.map((entry) => entry.id), ['mut-1', 'mut-3']);
    assert.equal(drained.mutations[0].schemaVersion, 121);
    assert.equal(drained.mutations[0].row.verdict, 'accepted');
    assert.equal(drained.hasMore, false);
    assert.equal(drained.spaceSchemaVersion, 121, 'the owner can compare its own schema against the space');

    const acked = await (await server.api(owner.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations/ack`, { json: { cursor: drained.cursor } })).json();
    assert.equal(acked.pending, 2, 'owner acknowledgement cannot discard operations another replica has not read');
    assert.deepEqual((await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/mutations`)).json()).mutations, []);
    const writerStream = await (await server.api(writer.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/mutations`)).json();
    assert.deepEqual(writerStream.mutations.map((entry) => entry.id), ['mut-1', 'mut-3']);
    const writerAck = await (await server.api(writer.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations/ack`, { json: { cursor: writerStream.cursor } })).json();
    assert.equal(writerAck.pending, 0, 'the relay compacts only after every live device advanced');

    // Batch bounds.
    const empty = await server.api(writer.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, { json: { mutations: [] } });
    assert.equal(empty.status, 400);
    const enormous = await server.api(writer.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, {
      json: { mutations: Array.from({ length: 201 }, (_, index) => mutation({ id: `bulk-${index}` })) },
    });
    assert.equal(enormous.status, 413);
    assert.equal((await enormous.json()).limit, 200);
  });
});

test('reader annotations sync only between devices owned by the same user', { timeout: 60_000 }, async () => {
  await withServer({ label: 'reader-annotation-sync' }, async (server) => {
    const spaceId = await server.createSpace('Corpus');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    await server.createUser('movil@example.test', 'mobile-account-password', [{ spaceId, role: 'writer' }]);
    const mobile = await server.deviceToken('movil@example.test', 'mobile-account-password', spaceId);
    const initial = academicSnapshot();
    await publish(server.origin, owner.deviceToken, spaceId, initial);

    // Published legacy rows are stripped from the shared corpus view.
    const firstRead = await (await server.api(
      mobile.deviceToken,
      'GET',
      `/api/v1/spaces/${spaceId}/deep-research/dr-1`,
    )).json();
    assert.deepEqual(firstRead.annotations ?? [], []);

    const stamp = '2026-08-10T00:00:00.000Z';
    const row = (overrides) => ({
      id: 'mobile-highlight', draft_id: 'dr-1', scope: 'source', kind: 'highlight', color: 'mint',
      start_offset: 0, end_offset: 5, selected_text: 'Texto', prefix: '', suffix: '.',
      comment_text: null, created_at: stamp, updated_at: stamp, ...overrides,
    });
    const mobileRows = [
      row({}),
      row({ id: 'mobile-comment', kind: 'comment', color: null, comment_text: 'Comprobar en la fuente.' }),
      row({ id: 'reader-bookmark:dr-1:source', kind: 'bookmark', color: null, comment_text: null }),
    ];
    const changes = mobileRows.map((annotation, index) => mutation({
      id: `mobile-annotation-${index}`,
      table: 'writing_draft_annotations',
      key: [annotation.id],
      row: annotation,
      schemaVersion: 127,
      createdAt: stamp,
    }));
    const receipt = await (await server.api(
      mobile.deviceToken,
      'POST',
      `/api/v1/spaces/${spaceId}/mutations`,
      { json: { mutations: changes } },
    )).json();
    assert.deepEqual(receipt.accepted, changes.map((change) => change.id));

    // A different account sharing the vault cannot observe a personal row in the ledger.
    const ownerView = await (await server.api(
      owner.deviceToken,
      'GET',
      `/api/v1/spaces/${spaceId}/mutations?since=0`,
    )).json();
    assert.deepEqual(ownerView.mutations, []);
    assert.ok(ownerView.cursor >= changes.length, 'the invisible rows still advance the cursor');

    // A second paired device belonging to the author receives the exact scalar rows.
    const sameUser = await server.deviceToken('movil@example.test', 'mobile-account-password', spaceId);
    const personalView = await (await server.api(
      sameUser.deviceToken,
      'GET',
      `/api/v1/spaces/${spaceId}/mutations?since=0`,
    )).json();
    assert.deepEqual(personalView.mutations.map((change) => change.row), mobileRows);
  });
});

test('every user-scoped mutation table is invisible to every other account', { timeout: 60_000 }, async () => {
  await withServer({ label: 'user-scoped-mutation-matrix' }, async (server) => {
    const spaceId = await server.createSpace('Private transport matrix');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    await server.createUser('private-a@example.test', 'private-a-account-password', [{ spaceId, role: 'writer' }]);
    await server.createUser('private-b@example.test', 'private-b-account-password', [{ spaceId, role: 'writer' }]);
    const author = await server.deviceToken('private-a@example.test', 'private-a-account-password', spaceId);
    const stranger = await server.deviceToken('private-b@example.test', 'private-b-account-password', spaceId);
    await publish(server.origin, owner.deviceToken, spaceId, academicSnapshot());

    const privateTables = Object.entries(MUTABLE_TABLES)
      .filter(([, definition]) => definition.scope === 'user')
      .map(([table]) => table);
    assert.ok(privateTables.length >= 10, 'the matrix must cover the complete personal-data contract');
    const changes = privateTables.map((table, index) => ({
      id: `private-matrix-${index}`,
      clientId: 'private-a-device',
      kind: 'delete',
      table,
      key: MUTABLE_TABLES[table].key.map((column) => `${column}-${index}`),
      schemaVersion: 121,
      createdAt: '2026-08-11T00:00:00.000Z',
    }));
    const receipt = await (await server.api(author.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, {
      json: { mutations: changes },
    })).json();
    assert.deepEqual(receipt.accepted, changes.map((change) => change.id));

    const strangerView = await (await server.api(
      stranger.deviceToken,
      'GET',
      `/api/v1/spaces/${spaceId}/mutations?since=0`,
    )).json();
    assert.deepEqual(strangerView.mutations, [], 'another account sees no private table, including deletes/tombstones');
    assert.ok(strangerView.cursor >= changes.length, 'private rows cannot create head-of-line blocking for another account');

    const sameUserDevice = await server.deviceToken('private-a@example.test', 'private-a-account-password', spaceId);
    const authorView = await (await server.api(
      sameUserDevice.deviceToken,
      'GET',
      `/api/v1/spaces/${spaceId}/mutations?since=0`,
    )).json();
    assert.deepEqual(authorView.mutations.map((change) => change.table), privateTables);
    assert.ok(authorView.mutations.every((change) => change.actorId === author.user.id));
    assert.ok(authorView.mutations.every((change) => /^\d{13}-\d{6}-[A-Za-z0-9._:~-]+$/.test(change.hlc)), 'server-stamped HLCs carry deterministic receive order');

    const authorNote = authorView.mutations.find((change) => change.table === 'notes');
    const sameLocalIdFromAnotherUser = {
      id: 'private-b-same-note-id', clientId: 'private-b-device', kind: 'delete', table: 'notes',
      key: authorNote.key, schemaVersion: 121, createdAt: '2026-08-11T00:00:01.000Z',
    };
    const secondReceipt = await server.api(stranger.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, {
      json: { mutations: [sameLocalIdFromAnotherUser] },
    });
    assert.equal(secondReceipt.status, 200);
    const strangerOwnView = await (await server.api(
      stranger.deviceToken,
      'GET',
      `/api/v1/spaces/${spaceId}/mutations?since=${strangerView.cursor}`,
    )).json();
    assert.deepEqual(strangerOwnView.mutations.map((change) => change.id), ['private-b-same-note-id']);
    assert.notEqual(strangerOwnView.mutations[0].entityId, authorNote.entityId, 'equal local ids in different accounts never collide in provenance');
  });
});

test('note-backed page hierarchies remain private across every member of a shared vault', { timeout: 60_000 }, async () => {
  await withServer({ label: 'private-note-page-hierarchy' }, async (server) => {
    const spaceId = await server.createSpace('Private page hierarchy');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    await server.createUser('private-page@example.test', 'private-page-account-password', [{ spaceId, role: 'writer' }]);
    const author = await server.deviceToken('private-page@example.test', 'private-page-account-password', spaceId);
    await publish(server.origin, owner.deviceToken, spaceId, academicSnapshot());

    const canary = 'PRIVATE-NOTE-BLOCK-MUST-NOT-CROSS-ACCOUNTS';
    const changes = [
      mutation({
        id: 'private-comment-reaction-first', table: 'page_comment_reactions', key: ['private-comment', 'local-actor', 'heart'],
        row: { comment_id: 'private-comment', actor_id: 'local-actor', emoji: 'heart' },
      }),
      mutation({
        id: 'private-comment-before-page', table: 'page_comments', key: ['private-comment'],
        row: { id: 'private-comment', page_id: 'opaque-note-page', content: canary },
      }),
      mutation({
        id: 'private-page-child-first', table: 'page_blocks', key: ['private-block'],
        row: { id: 'private-block', page_id: 'opaque-note-page', type: 'paragraph', content_json: canary },
      }),
      mutation({
        id: 'private-page-parent-second', table: 'pages', key: ['opaque-note-page'],
        row: { id: 'opaque-note-page', note_id: 'private-note-id', title: 'Private note projection' },
      }),
      mutation({
        id: 'private-page-deterministic-child', table: 'page_revisions', key: ['private-revision'],
        row: { id: 'private-revision', page_id: 'note:private-note-id', title: canary },
      }),
    ];
    const receipt = await (await server.api(author.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, { json: { mutations: changes } })).json();
    assert.deepEqual(receipt.accepted, changes.map((entry) => entry.id));

    const ownerView = await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/mutations?since=0`)).json();
    assert.deepEqual(ownerView.mutations, [], 'vault ownership does not reveal a collaborator private page hierarchy');
    assert.ok(ownerView.cursor >= changes.length);

    const sameUser = await server.deviceToken('private-page@example.test', 'private-page-account-password', spaceId);
    const authorView = await (await server.api(sameUser.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/mutations?since=0`)).json();
    assert.deepEqual(authorView.mutations.map((entry) => entry.id), changes.map((entry) => entry.id));
    assert.ok(authorView.mutations.every((entry) => entry.ownerScope === `user:${author.user.id}`));
    assert.equal(JSON.stringify(ownerView).includes(canary), false);
  });
});

test('private page ownership survives more than 32 users sharing the same local page id', { timeout: 120_000 }, async () => {
  await withServer({ label: 'private-page-many-owners' }, async (server) => {
    const spaceId = await server.createSpace('Many private owners');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    await publish(server.origin, owner.deviceToken, spaceId, academicSnapshot());
    const devices = [];
    for (let index = 0; index < 33; index += 1) {
      const email = `private-collision-${index}@example.test`;
      const password = `private-collision-password-${index}`;
      await server.createUser(email, password, [{ spaceId, role: 'writer' }]);
      const device = await server.deviceToken(email, password, spaceId);
      devices.push(device);
      const parent = mutation({
        id: `private-collision-parent-${index}`, table: 'pages', key: ['same-local-page-id'],
        row: { id: 'same-local-page-id', note_id: `private-note-${index}`, title: `Private ${index}` },
      });
      const receipt = await server.api(device.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, { json: { mutations: [parent] } });
      assert.equal(receipt.status, 200);
    }
    const canary = 'THIRTY-THIRD-OWNER-PRIVATE-CHILD';
    const child = mutation({
      id: 'private-collision-child-33', table: 'page_blocks', key: ['last-private-child'],
      row: { id: 'last-private-child', page_id: 'same-local-page-id', type: 'paragraph', content_json: canary },
    });
    const childReceipt = await (await server.api(devices.at(-1).deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, { json: { mutations: [child] } })).json();
    assert.deepEqual(childReceipt.accepted, [child.id]);
    const ownerView = await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/mutations?since=0&limit=200`)).json();
    assert.equal(JSON.stringify(ownerView).includes(canary), false);
    const firstUserView = await (await server.api(devices[0].deviceToken, 'GET', `/api/v1/spaces/${spaceId}/mutations?since=0&limit=200`)).json();
    assert.equal(firstUserView.mutations.some((entry) => entry.id === child.id), false);
    const lastUserView = await (await server.api(devices.at(-1).deviceToken, 'GET', `/api/v1/spaces/${spaceId}/mutations?since=0&limit=200`)).json();
    assert.equal(lastUserView.mutations.some((entry) => entry.id === child.id), true);
  });
});

test('legacy private ledger rows without provable ownership are quarantined', { timeout: 60_000 }, async () => {
  await withServer({ label: 'legacy-private-ledger' }, async (server) => {
    const spaceId = await server.createSpace('Legacy quarantine');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    const ledgerFile = path.join(server.root, 'spaces', spaceId, 'mutations.ndjson');
    fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
    fs.writeFileSync(ledgerFile, `${JSON.stringify({
      seq: 1, id: 'legacy-private-without-owner', kind: 'upsert', table: 'notes', key: ['legacy-note'],
      row: { id: 'legacy-note', title: 'Must remain quarantined', content: 'PRIVATE LEGACY CANARY' },
      schemaVersion: 100, createdAt: '2024-01-01T00:00:00.000Z',
    })}\n`, { mode: 0o600 });
    const view = await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/mutations?since=0`)).json();
    assert.deepEqual(view.mutations, []);
    assert.equal(view.cursor, 1, 'quarantined rows still advance the transport cursor');
    assert.equal(JSON.stringify(view).includes('PRIVATE LEGACY CANARY'), false);
  });
});

test('the size limits are published, explained on refusal, and a full ledger is retryable', { timeout: 60_000 }, async () => {
  await withServer({
    label: 'mutations-limits',
    // The floor byteLimit() enforces is 64 KiB, so these are the smallest testable values.
    env: { NODUS_MAX_MUTATION_BYTES: String(64 * 1024), NODUS_MAX_LEDGER_BYTES: String(64 * 1024) },
  }, async (server) => {
    const spaceId = await server.createSpace('Corpus');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    await server.createUser('escritor@example.test', 'escritor-account-password', [{ spaceId, role: 'writer' }]);
    const writer = await server.deviceToken('escritor@example.test', 'escritor-account-password', spaceId);
    await publish(server.origin, owner.deviceToken, spaceId, academicSnapshot());

    // A client can now learn the limit without being refused by it first.
    const capabilities = await (await server.api(writer.deviceToken, 'GET', '/api/v1/capabilities')).json();
    assert.equal(capabilities.maxMutationBytes, 64 * 1024);
    assert.ok(capabilities.maxMutationBatchBytes > 0);
    assert.ok(capabilities.maxLedgerBytes > 0);

    // And a refusal says which row, how big it was, and how big it may be.
    const refused = await (await server.api(writer.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, {
      json: { mutations: [reportMutation(15 * 450)] },
    })).json();
    assert.deepEqual(refused.accepted, []);
    assert.equal(refused.rejected[0].reason, 'too_large');
    assert.equal(refused.rejected[0].limitBytes, 64 * 1024);
    assert.ok(refused.rejected[0].bytes > 64 * 1024);
    assert.match(refused.rejected[0].error_description, /per row/);
    // Both numbers, and two different numbers. Rendered in MiB to one decimal, a 187 KiB row
    // and a 256 KiB ceiling both read "0.2 MiB", and the sentence written to end the guessing
    // would have printed the same figure twice.
    const figures = refused.rejected[0].error_description.match(/\d+(?:\.\d+)? [KM]iB/g);
    assert.equal(figures.length, 2, 'the sentence states the size and the ceiling');
    assert.notEqual(figures[0], figures[1], 'and they must be distinguishable');

    // Filling the ledger is answered "later", not "no": the batch is refused whole and
    // nothing is stored, so the sender keeps work that would otherwise be lost while the
    // owner is away. Fifty small notes comfortably pass 64 KiB of ledger.
    const notes = Array.from({ length: 50 }, (_, index) => mutation({
      id: `fill-${index}`, key: [`n-fill-${index}`], row: { ...NOTE_ROW, id: `n-fill-${index}`, content: 'x'.repeat(1_200) },
    }));
    let full = null;
    for (let attempt = 0; attempt < 6 && !full; attempt += 1) {
      const response = await server.api(writer.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, {
        json: { mutations: notes.map((entry) => ({ ...entry, id: `${entry.id}-${attempt}`, key: [`${entry.key[0]}-${attempt}`], row: { ...entry.row, id: `${entry.row.id}-${attempt}` } })) },
      });
      if (response.status === 507) full = await response.json();
      else assert.equal(response.status, 200);
    }
    assert.ok(full, 'a ledger nobody drains eventually refuses more');
    assert.equal(full.error, 'ledger_full');
    assert.match(full.error_description, /Nothing was lost/);

    // Draining frees it, which is the whole reason this is a 507 and not a rejection.
    let cursor = 0;
    for (let page = 0; page < 20; page += 1) {
      const drained = await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/mutations?since=${cursor}`)).json();
      cursor = drained.cursor;
      if (!drained.hasMore) break;
    }
    await server.api(owner.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations/ack`, { json: { cursor } });
    const afterDrain = await server.api(writer.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, {
      json: { mutations: [mutation({ id: 'after-drain', key: ['n-after'], row: { ...NOTE_ROW, id: 'n-after' } })] },
    });
    assert.equal(afterDrain.status, 200, 'once the owner has collected, the space accepts again');
  });
});

test('a mutation that names an image the server does not hold is a retryable 409', { timeout: 60_000 }, async () => {
  await withServer({ label: 'mutations-assets' }, async (server) => {
    const spaceId = await server.createSpace('Corpus');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    await server.createUser('escritor@example.test', 'escritor-account-password', [{ spaceId, role: 'writer' }]);
    const writer = await server.deviceToken('escritor@example.test', 'escritor-account-password', spaceId);
    await publish(server.origin, owner.deviceToken, spaceId, academicSnapshot());

    const { PNG_BYTES, sha256 } = await import('./lib/nodusServerFixtures.mjs');
    const hash = sha256(PNG_BYTES);
    const withImage = mutation({ id: 'mut-image', assets: [{ column: 'image_blob', hash }] });

    const refused = await server.api(writer.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, { json: { mutations: [withImage] } });
    assert.equal(refused.status, 409);
    const value = await refused.json();
    assert.deepEqual(value.missing, [hash]);
    // Nothing was written: the whole batch waits for the bytes.
    assert.deepEqual((await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/mutations`)).json()).mutations, []);

    await server.api(writer.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/assets/${hash}`, { body: PNG_BYTES });
    const retried = await server.api(writer.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, { json: { mutations: [withImage] } });
    assert.equal(retried.status, 200);
    assert.deepEqual((await retried.json()).accepted, ['mut-image']);
  });
});

test('Yjs bytes use a verified binary channel and only metadata enters the relay', { timeout: 60_000 }, async () => {
  await withServer({ label: 'mutations-yjs' }, async (server) => {
    const spaceId = await server.createSpace('Páginas colaborativas');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    await server.createUser('yjs-writer@example.test', 'yjs-writer-password', [{ spaceId, role: 'writer' }]);
    const writer = await server.deviceToken('yjs-writer@example.test', 'yjs-writer-password', spaceId);
    await publish(server.origin, owner.deviceToken, spaceId, academicSnapshot());
    const bytes = Buffer.from([1, 2, 3, 4, 5, 250, 251]);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const update = mutation({
      id: 'mut-yjs', table: 'page_document_updates', key: ['update-yjs'], documentHash: hash,
      row: {
        id: 'update-yjs', page_id: 'page-yjs', sequence_no: 1, update_hash: hash,
        actor_id: 'writer', client_id: 'writer-device', created_at: '2026-02-02T00:00:00.000Z',
      }, schemaVersion: 150,
    });
    const missing = await server.api(writer.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, { json: { mutations: [update] } });
    assert.equal(missing.status, 409, 'metadata is not accepted before its binary delta exists');
    assert.deepEqual((await missing.json()).missing, [hash]);

    const uploaded = await server.api(writer.deviceToken, 'PUT', `/api/v1/spaces/${spaceId}/document-updates/${hash}`, { body: bytes });
    assert.equal(uploaded.status, 200);
    const accepted = await server.api(writer.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, { json: { mutations: [update] } });
    assert.equal(accepted.status, 200);
    const relayed = await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/mutations?since=0`)).json();
    assert.equal(relayed.mutations[0].documentHash, hash);
    assert.equal(Object.prototype.hasOwnProperty.call(relayed.mutations[0].row, 'update_blob'), false, 'binary never enters mutation JSON');
    const downloaded = await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/document-updates/${hash}`);
    assert.match(downloaded.headers.get('content-security-policy') || '', /default-src 'none'/);
    assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
  });
});

test('shared files resume missing chunks and verify chunk plus final checksums', { timeout: 60_000 }, async () => {
  await withServer({ label: 'mutations-shared-blobs' }, async (server) => {
    const spaceId = await server.createSpace('Adjuntos compartidos');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    await server.createUser('blob-writer@example.test', 'blob-writer-password', [{ spaceId, role: 'writer' }]);
    const writer = await server.deviceToken('blob-writer@example.test', 'blob-writer-password', spaceId);
    await publish(server.origin, owner.deviceToken, spaceId, academicSnapshot());
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 37);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
    const hash = createHash('sha256').update(bytes).digest('hex');
    const endpoint = `/api/v1/spaces/${spaceId}/blobs/${hash}`;
    const chunks = [bytes.subarray(0, 1024 * 1024), bytes.subarray(1024 * 1024, 2 * 1024 * 1024), bytes.subarray(2 * 1024 * 1024)];
    const upload = (index) => server.api(writer.deviceToken, 'PUT', `${endpoint}/chunks/${index}`, {
      headers: {
        'x-nodus-total-chunks': '3', 'x-nodus-total-bytes': String(bytes.length),
        'x-nodus-chunk-sha256': createHash('sha256').update(chunks[index]).digest('hex'),
      }, body: chunks[index],
    });
    assert.equal((await upload(0)).status, 200);
    assert.equal((await upload(2)).status, 200);
    const partial = await (await server.api(writer.deviceToken, 'GET', `${endpoint}/status`)).json();
    assert.deepEqual(partial.received, [0, 2], 'a reconnect learns exactly which chunks need retrying');
    assert.equal(partial.complete, false);
    assert.equal((await upload(1)).status, 200);
    assert.equal((await server.api(writer.deviceToken, 'POST', `${endpoint}/complete`)).status, 200);
    const complete = await (await server.api(writer.deviceToken, 'GET', `${endpoint}/status`)).json();
    assert.equal(complete.complete, true);
    const range = await server.api(owner.deviceToken, 'GET', endpoint, { headers: { range: 'bytes=1048576-1048612' } });
    assert.equal(range.status, 206);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(1024 * 1024, 1024 * 1024 + 37));
  });
});

test('binary collaboration channels enforce aggregate and partial-upload quotas', { timeout: 60_000 }, async () => {
  await withServer({
    label: 'binary-space-quotas',
    env: {
      NODUS_MAX_SPACE_DOCUMENT_UPDATE_BYTES: String(64 * 1024),
      NODUS_MAX_SPACE_SHARED_BLOB_BYTES: String(128 * 1024),
      NODUS_MAX_SPACE_PARTIAL_BLOB_BYTES: String(64 * 1024),
    },
  }, async (server) => {
    const spaceId = await server.createSpace('Binary quotas');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    const first = Buffer.alloc(40 * 1024, 1); const second = Buffer.alloc(40 * 1024, 2);
    const firstHash = createHash('sha256').update(first).digest('hex');
    const secondHash = createHash('sha256').update(second).digest('hex');
    assert.equal((await server.api(owner.deviceToken, 'PUT', `/api/v1/spaces/${spaceId}/document-updates/${firstHash}`, { body: first })).status, 200);
    const refusedUpdate = await server.api(owner.deviceToken, 'PUT', `/api/v1/spaces/${spaceId}/document-updates/${secondHash}`, { body: second });
    assert.equal(refusedUpdate.status, 507);
    assert.equal((await refusedUpdate.json()).error, 'document_update_quota_exceeded');

    const partial = Buffer.alloc(70 * 1024, 3);
    const blobHash = createHash('sha256').update(partial).digest('hex');
    const chunkHash = createHash('sha256').update(partial).digest('hex');
    const refusedPartial = await server.api(owner.deviceToken, 'PUT', `/api/v1/spaces/${spaceId}/blobs/${blobHash}/chunks/0`, {
      headers: {
        'x-nodus-total-chunks': '1', 'x-nodus-total-bytes': String(partial.length), 'x-nodus-chunk-sha256': chunkHash,
      },
      body: partial,
    });
    assert.equal(refusedPartial.status, 507);
    assert.equal((await refusedPartial.json()).error, 'partial_blob_quota_exceeded');
    const status = await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/blobs/${blobHash}/status`)).json();
    assert.equal(status.complete, false);
    assert.equal(status.totalChunks, null, 'a rejected partial upload leaves no reservation manifest');
  });
});

test('presence and text cursors are authorized, ephemeral, and absent from server backups', { timeout: 60_000 }, async () => {
  await withServer({ label: 'ephemeral-presence' }, async (server) => {
    const spaceId = await server.createSpace('Presencia');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    await server.createUser('presence-reader@example.test', 'presence-reader-password', [{ spaceId, role: 'reader' }]);
    const reader = await server.deviceToken('presence-reader@example.test', 'presence-reader-password', spaceId, 'Lector presente');
    const marker = 'page-presence-must-never-persist';
    const posted = await server.api(reader.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/presence`, {
      json: { pageId: marker, blockId: 'block-1', cursor: { anchor: 3, head: 8 }, color: '#5b7cfa' },
    });
    assert.equal(posted.status, 200, 'a reader may announce presence without gaining write access to content');
    const visible = await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/presence`)).json();
    assert.equal(visible.participants.length, 1);
    assert.deepEqual(visible.participants[0].cursor, { anchor: 3, head: 8 });
    assert.equal(visible.participants[0].pageId, marker);
    assert.equal(JSON.stringify(await server.readState()).includes(marker), false, 'presence is never written to state.json or a backup');
    await server.api(reader.deviceToken, 'DELETE', `/api/v1/spaces/${spaceId}/presence`);
    assert.deepEqual((await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/presence`)).json()).participants, []);
  });
});

test('SSE wakes every authorized replica immediately and polling remains available', { timeout: 60_000 }, async () => {
  await withServer({ label: 'mutation-events' }, async (server) => {
    const spaceId = await server.createSpace('Relay inmediato');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    await server.createUser('stream-writer@example.test', 'stream-writer-password', [{ spaceId, role: 'writer' }]);
    const writer = await server.deviceToken('stream-writer@example.test', 'stream-writer-password', spaceId);
    await publish(server.origin, owner.deviceToken, spaceId, academicSnapshot());
    const aborter = new AbortController();
    try {
      const events = await fetch(`${server.origin}/api/v1/spaces/${spaceId}/mutations/events`, {
        headers: { authorization: `Bearer ${owner.deviceToken}` }, signal: aborter.signal,
      });
      assert.equal(events.status, 200); assert.match(events.headers.get('content-type'), /text\/event-stream/);
      const reader = events.body.getReader(); const decoder = new TextDecoder();
      const ready = decoder.decode((await reader.read()).value); assert.match(ready, /event: ready/);
      const sent = await server.api(writer.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, { json: { mutations: [sharedMutation({ id: 'sse-mut' })] } });
      assert.equal(sent.status, 200);
      let received = '';
      for (let index = 0; index < 4 && !received.includes('event: mutation'); index += 1) {
        const next = await Promise.race([reader.read(), new Promise((_, reject) => setTimeout(() => reject(new Error('SSE timeout')), 3_000))]);
        received += decoder.decode(next.value);
      }
      assert.match(received, /event: mutation/); assert.match(received, /"cursor":1/);
      const polled = await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/mutations?since=0`)).json();
      assert.deepEqual(polled.mutations.map((entry) => entry.id), ['sse-mut']);
    } finally { aborter.abort(); }
  });
});
