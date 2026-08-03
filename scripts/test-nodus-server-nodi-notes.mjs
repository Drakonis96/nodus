// Nodi's quick notes: the one resource on the server that belongs to a person rather than
// to a space.
//
// What is worth pinning here is exactly the part that is easy to get wrong when a note can
// be written from two devices at once: the merge. Newest wins, a deletion wins a tie, a
// tombstone keeps travelling so an offline device learns that something is gone, and a
// device with a clock running fast cannot win every merge for the length of its skew.
//
// The route half is pinned against a REAL server process, because the interesting properties
// there — that a space-scoped device token authorises a resource with no space in its URL,
// and that one person cannot read another's notes — live in the authorizer, not in a pure
// function.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_NODI_NOTES, TOMBSTONE_TTL_MS, mergeNodiNotes, newer, notesSince, validateNodiNote,
} from '../server/lib/core/nodiNotes.mjs';
import { withServer } from './lib/nodusServerHarness.mjs';

const NOW = 1_800_000_000_000;

function note(overrides = {}) {
  return {
    id: 'n-1', title: 'Una nota', titleExplicit: true, content: 'Cuerpo.',
    createdAt: NOW - 1000, updatedAt: NOW - 1000, deletedAt: null, ...overrides,
  };
}

// ── The merge ───────────────────────────────────────────────────────────────

test('the newer edit wins', () => {
  const older = note({ content: 'Vieja', updatedAt: NOW - 2000 });
  const newest = note({ content: 'Nueva', updatedAt: NOW - 10 });
  assert.equal(newer(older, newest).content, 'Nueva');
  assert.equal(newer(newest, older).content, 'Nueva');
});

test('at an identical timestamp a deletion wins, because resurrecting is the worse mistake', () => {
  const edit = note({ content: 'Editada', updatedAt: NOW });
  const removal = note({ content: '', updatedAt: NOW, deletedAt: NOW });
  assert.equal(newer(edit, removal).deletedAt, NOW);
  assert.equal(newer(removal, edit).deletedAt, NOW);
});

test('a deletion travels as a tombstone, so an offline device learns of it', () => {
  // Through the validator, because that is what the route runs before it merges.
  const { note: tombstone } = validateNodiNote(note({ updatedAt: NOW, deletedAt: NOW }), NOW);
  const merged = mergeNodiNotes([note()], [tombstone], NOW);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].deletedAt, NOW);
  assert.equal(merged[0].content, '', 'a tombstone carries no content');
});

test('a tombstone is forgotten once no device could still be behind it', () => {
  const ancient = note({ updatedAt: NOW - TOMBSTONE_TTL_MS - 1, deletedAt: NOW - TOMBSTONE_TTL_MS - 1 });
  assert.deepEqual(mergeNodiNotes([ancient], [], NOW), []);
  const recent = note({ updatedAt: NOW - 1000, deletedAt: NOW - 1000 });
  assert.equal(mergeNodiNotes([recent], [], NOW).length, 1);
});

test('the cap drops the oldest live notes and never a tombstone', () => {
  const live = Array.from({ length: MAX_NODI_NOTES + 10 }, (_, index) =>
    note({ id: `n-${index}`, updatedAt: NOW - index })
  );
  const removed = note({ id: 'gone', updatedAt: NOW - 5000, deletedAt: NOW - 5000 });
  const merged = mergeNodiNotes([...live, removed], [], NOW);
  assert.equal(merged.filter((entry) => entry.deletedAt === null).length, MAX_NODI_NOTES);
  assert.ok(merged.some((entry) => entry.id === 'gone'), 'the tombstone must survive the cap');
  assert.ok(!merged.some((entry) => entry.id === `n-${MAX_NODI_NOTES + 9}`), 'the oldest goes first');
});

test('a clock running fast is clamped, or one device would win every merge', () => {
  const { note: clamped } = validateNodiNote(note({ updatedAt: NOW + 86_400_000 }), NOW);
  assert.equal(clamped.updatedAt, NOW);
});

test('what a client sends is validated rather than coerced', () => {
  assert.equal(validateNodiNote(null, NOW).error, 'malformed');
  assert.equal(validateNodiNote({ ...note(), id: '../escape' }, NOW).error, 'bad_id');
  assert.equal(validateNodiNote({ ...note(), createdAt: 'ayer' }, NOW).error, 'malformed');
  assert.equal(validateNodiNote({ ...note(), content: 'x'.repeat(70_000) }, NOW).error, 'too_large');
});

test('`since` answers only what changed, so a phone does not re-read the lot', () => {
  const all = [note({ id: 'a', updatedAt: NOW - 10 }), note({ id: 'b', updatedAt: NOW - 5000 })];
  assert.deepEqual(notesSince(all, NOW - 1000).map((entry) => entry.id), ['a']);
  assert.equal(notesSince(all, Number.NaN).length, 2, 'no `since` means everything');
});

// ── The routes, against a real server ───────────────────────────────────────

test('a device token scoped to a space still reaches the notes, which have no space', async () => {
  await withServer({ label: 'nodi-notes' }, async (context) => {
    const spaceId = await context.createSpace('Principal');
    const { deviceToken: token } = await context.deviceToken(context.adminEmail, context.adminPassword, spaceId);

    const empty = await context.api(token, 'GET', '/api/v1/nodi/notes');
    assert.equal(empty.status, 200);
    assert.deepEqual((await empty.json()).notes, []);

    const written = await context.api(token, 'POST', '/api/v1/nodi/notes', {
      json: { notes: [note({ id: 'n-a', content: 'Desde el móvil' })] },
    });
    assert.equal(written.status, 200);
    const body = await written.json();
    assert.equal(body.total, 1);
    assert.deepEqual(body.rejected, []);
    assert.equal(body.notes[0].content, 'Desde el móvil');

    const reread = await context.api(token, 'GET', '/api/v1/nodi/notes');
    assert.equal((await reread.json()).notes[0].id, 'n-a');
  });
});

test('one person cannot read another person’s notes', async () => {
  await withServer({ label: 'nodi-notes-privacy' }, async (context) => {
    const spaceId = await context.createSpace('Compartido');
    const { deviceToken: mine } = await context.deviceToken(context.adminEmail, context.adminPassword, spaceId);
    await context.api(mine, 'POST', '/api/v1/nodi/notes', { json: { notes: [note({ id: 'private' })] } });

    await context.createUser('otra@example.test', 'another-long-password-2026', [{ spaceId, role: 'reader' }]);
    const { deviceToken: theirs } = await context.deviceToken('otra@example.test', 'another-long-password-2026', spaceId);

    const response = await context.api(theirs, 'GET', '/api/v1/nodi/notes');
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).notes, [], 'a co-member of the space sees none of them');
  });
});

test('an unauthenticated caller gets nothing', async () => {
  await withServer({ label: 'nodi-notes-anon' }, async (context) => {
    const response = await fetch(`${context.origin}/api/v1/nodi/notes`);
    assert.equal(response.status, 401);
  });
});

test('a malformed body is refused rather than half-applied', async () => {
  await withServer({ label: 'nodi-notes-malformed' }, async (context) => {
    const spaceId = await context.createSpace('Principal');
    const { deviceToken: token } = await context.deviceToken(context.adminEmail, context.adminPassword, spaceId);

    const bad = await context.api(token, 'POST', '/api/v1/nodi/notes', { json: { notes: 'nope' } });
    assert.equal(bad.status, 400);

    // A batch with one bad note keeps the good ones and names what it refused.
    const mixed = await context.api(token, 'POST', '/api/v1/nodi/notes', {
      json: { notes: [note({ id: 'good' }), { id: '' }] },
    });
    assert.equal(mixed.status, 200);
    const body = await mixed.json();
    assert.equal(body.total, 1);
    assert.equal(body.rejected.length, 1);
    assert.equal(body.rejected[0].reason, 'bad_id');
  });
});
