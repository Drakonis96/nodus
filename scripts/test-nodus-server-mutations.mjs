// The mutation ledger: what a writer may send, what the server refuses outright, and how
// the owner drains it.
//
// The design decision this pins is that the server never interprets a mutation. It validates
// the shape and appends; the owner's desktop is still the only thing that writes the vault.
// So the interesting failures are all validation ones — and the neat trick under test is
// that the server checks columns against the last published snapshot, which is the vault's
// schema expressed as data, without the server needing to know any SQL at all.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MUTABLE_TABLES, rowKey, validateMutation } from '../server/lib/core/mutations.mjs';
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

test('the whitelist covers user-authored tables and nothing derived from the corpus', () => {
  const tables = Object.keys(MUTABLE_TABLES);
  for (const allowed of ['notes', 'note_folders', 'writing_saved_drafts', 'immersion_sessions', 'edge_feedback']) {
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

    const sent = await server.api(writer.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, { json: { mutations: [mutation()] } });
    assert.equal(sent.status, 200);
    const accepted = await sent.json();
    assert.deepEqual(accepted.accepted, ['mut-1']);
    assert.deepEqual(accepted.rejected, []);
    assert.equal(accepted.cursor, 1);

    // Replay: the same id is recognised, not stored twice.
    const replayed = await (await server.api(writer.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, { json: { mutations: [mutation()] } })).json();
    assert.deepEqual(replayed.duplicate, ['mut-1']);
    assert.deepEqual(replayed.accepted, []);

    // A rejected mutation reports why, and does not poison its batch-mates.
    const mixed = await (await server.api(writer.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, {
      json: { mutations: [mutation({ id: 'mut-2', table: 'ideas' }), mutation({ id: 'mut-3', key: ['n-other'], row: { ...NOTE_ROW, id: 'n-other' } })] },
    })).json();
    assert.deepEqual(mixed.accepted, ['mut-3']);
    assert.deepEqual(mixed.rejected, [{ id: 'mut-2', reason: 'table_not_mutable' }]);

    // The owner drains, sees the writer's schema version, and acknowledges.
    const drained = await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/mutations?since=0`)).json();
    assert.deepEqual(drained.mutations.map((entry) => entry.id), ['mut-1', 'mut-3']);
    assert.equal(drained.mutations[0].schemaVersion, 121);
    assert.equal(drained.mutations[0].row.title, 'Nota del colaborador');
    assert.equal(drained.hasMore, false);
    assert.equal(drained.spaceSchemaVersion, 121, 'the owner can compare its own schema against the space');

    const acked = await (await server.api(owner.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations/ack`, { json: { cursor: drained.cursor } })).json();
    assert.equal(acked.pending, 0);
    assert.deepEqual((await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/mutations`)).json()).mutations, []);

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
