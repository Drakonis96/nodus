// Nodi's quick notes, relayed between a person's devices.
//
// These are the one thing on the server that does not belong to a space. Nodi is the
// companion, not a vault: a jot made while reading one corpus is still there when the next
// one is open, and moving it into a vault's SQLite would tie it to a publication it has
// nothing to do with. So they hang off the *user*, and a device token authorises them by the
// account it was issued to rather than by the space it was scoped to.
//
// The merge is newest-wins on `updatedAt`, the same rule the vault's own `.nodussync`
// packages use, with one asymmetry: at an identical timestamp a deletion wins. A tie means
// two devices acted in the same millisecond, and resurrecting something a person deleted is
// the worse of the two mistakes.
//
// Deletions are tombstones rather than removals, kept for `TOMBSTONE_TTL_MS`, because a
// device that has been offline for a week must learn that a note is gone — an absent row is
// indistinguishable from one it has not heard about yet.

export const MAX_NODI_NOTES = 500;
/** One note. Generous for Markdown, small enough that the file stays a file. */
export const MAX_NODI_NOTE_BYTES = 64 * 1024;
export const MAX_NODI_TITLE_CHARS = 100;
/** How long a deletion is remembered. A device offline longer than this re-syncs whole. */
export const TOMBSTONE_TTL_MS = 90 * 86400_000;

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * Validate one note as it arrives from a client.
 *
 * Returns `{ note }` or `{ error }`. Nothing is coerced silently: a client that sends a
 * number where a string belongs has a bug, and accepting it would hide the bug in data.
 */
export function validateNodiNote(value, now = Date.now()) {
  if (!value || typeof value !== 'object') return { error: 'malformed' };
  const id = String(value.id ?? '');
  if (!ID.test(id)) return { error: 'bad_id' };

  const deletedAt = value.deletedAt == null ? null : Number(value.deletedAt);
  if (deletedAt !== null && !Number.isFinite(deletedAt)) return { error: 'malformed' };

  const content = value.content == null ? '' : String(value.content);
  if (Buffer.byteLength(content, 'utf8') > MAX_NODI_NOTE_BYTES) return { error: 'too_large' };

  const createdAt = Number(value.createdAt);
  const updatedAt = Number(value.updatedAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return { error: 'malformed' };

  return {
    note: {
      id,
      title: String(value.title ?? '').slice(0, MAX_NODI_TITLE_CHARS),
      titleExplicit: value.titleExplicit === true,
      // A tombstone carries no content: what was deleted should stop travelling with it.
      content: deletedAt === null ? content : '',
      createdAt,
      // A clock ahead of the server's is clamped, or one device with a wrong date would
      // win every merge for as long as its skew lasts.
      updatedAt: Math.min(updatedAt, now),
      deletedAt,
    },
  };
}

/** Newest wins; a deletion wins a tie. */
export function newer(existing, incoming) {
  if (!existing) return incoming;
  if (incoming.updatedAt > existing.updatedAt) return incoming;
  if (incoming.updatedAt < existing.updatedAt) return existing;
  if (incoming.deletedAt !== null && existing.deletedAt === null) return incoming;
  return existing;
}

/**
 * Merge what a client sent into what the server holds.
 *
 * Live notes past the cap are dropped oldest-first, exactly as the desktop's own store does,
 * so the two agree on what "the last 500" means. Tombstones are not counted against the cap
 * and are pruned by age instead.
 */
export function mergeNodiNotes(existing, incoming, now = Date.now()) {
  const byId = new Map(existing.map((note) => [note.id, note]));
  for (const note of incoming) byId.set(note.id, newer(byId.get(note.id), note));

  const all = [...byId.values()].filter(
    (note) => note.deletedAt === null || now - note.deletedAt <= TOMBSTONE_TTL_MS
  );
  const live = all.filter((note) => note.deletedAt === null).sort((a, b) => b.updatedAt - a.updatedAt);
  const tombstones = all.filter((note) => note.deletedAt !== null);

  return [...live.slice(0, MAX_NODI_NOTES), ...tombstones].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** What a client asking `?since=` should receive. */
export function notesSince(notes, since) {
  if (!Number.isFinite(since)) return notes;
  return notes.filter((note) => note.updatedAt > since);
}
