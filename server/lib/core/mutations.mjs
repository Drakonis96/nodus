// The mutation ledger.
//
// A writer's desktop replica cannot write to the owner's vault; nothing can except the
// owner's own machine. What it can do is append an intent here. The owner's desktop drains
// the ledger on its next tick, applies it to its SQLite through the same newest-wins merge
// that .nodussync packages already use, and republishes. That republication is what makes
// the change visible to everybody — including, deliberately, to its own author.
//
// Two consequences worth stating plainly:
//   • the server never interprets a mutation beyond validating its shape, so it never
//     becomes a second authority on what the vault contains;
//   • a change is not visible until the owner is online. That is a product decision, not
//     an oversight, and the UI says so.

/**
 * Tables a non-owner may change, and how a row in each is identified.
 *
 * The key order must match `identityColumns(table)` on the desktop exactly, because the
 * serialized `row_key` is compared against the one the tombstone triggers write. That
 * agreement is asserted by scripts/test-nodus-server-mutations.mjs rather than trusted.
 *
 * Everything derived from the corpus is absent on purpose: `works`, `ideas`, `edges`,
 * `evidence`, `passages`, `themes` and `gaps` are the product of the owner's analysis
 * pipeline and their identity depends on it. So is everything about students, testimonies
 * and prosopography, which are not shareable material at all.
 */
export const MUTABLE_TABLES = {
  notes: { key: ['id'] },
  note_folders: { key: ['id'] },
  note_links: { key: ['link_id'] },
  writing_saved_drafts: { key: ['id'] },
  writing_draft_annotations: { key: ['id'] },
  decorative_images: { key: ['entity_kind', 'entity_id'], require: { entity_kind: 'deep_research' } },
  immersion_sessions: { key: ['id'] },
  saved_searches: { key: ['id'] },
  research_questions: { key: ['id'] },
  research_subquestions: { key: ['id'] },
  research_coverage_links: { key: ['id'] },
  edge_feedback: { key: ['from_id', 'to_id', 'type'] },
};

export const MUTATION_KINDS = new Set(['upsert', 'delete']);
const ANNOTATION_KINDS = new Set(['highlight', 'comment', 'bookmark']);
const ANNOTATION_COLORS = new Set(['yellow', 'rose', 'blue', 'mint', 'lavender', 'peach']);
/**
 * How large one row may be, by default.
 *
 * It used to be 64 KiB, which predates anything long travelling this channel and turned out to
 * be below the size of the thing it most needed to carry: a Deep Research report is one row of
 * `writing_saved_drafts` whose `draft_json` holds the entire markdown. Five pages of Spanish
 * prose with accented characters escaped into JSON already reach 40-60 KiB, and a real
 * fifteen-page report measured 187 KiB. The feature and the limit were incompatible by design.
 *
 * The number is not free to raise on its own, because until every client batches by bytes the
 * worst request this server can be handed is MAX_MUTATION_BATCH rows of this size. 256 KiB
 * therefore buys comfortable headroom over the largest report anybody has produced while
 * keeping that product at 50 MiB, which is a request a modest machine can still hold.
 * Raise both together or not at all, and see NODUS_MAX_MUTATION_BATCH_BYTES.
 */
export const DEFAULT_MAX_MUTATION_BYTES = 256 * 1024;
export const MAX_MUTATION_BATCH = 200;

export function isMutableTable(table) {
  return Object.prototype.hasOwnProperty.call(MUTABLE_TABLES, String(table ?? ''));
}

/** Serialized the same way electron/db/tombstones.ts:34 does, byte for byte. */
export function rowKey(table, key) {
  return JSON.stringify(key.map((value) => (value === null || value === undefined ? null : String(value))));
}

/**
 * Validate one mutation against the whitelist and against the shape of the last published
 * snapshot.
 *
 * The second half is the neat part: the server has no idea what the vault's SQL schema
 * looks like, but the snapshot it already holds IS that schema, expressed as data. A
 * column nobody has ever published cannot be written.
 */
export function validateMutation(mutation, { snapshot, hasAsset, maxBytes = DEFAULT_MAX_MUTATION_BYTES }) {
  const fail = (reason) => ({ ok: false, reason });

  if (!mutation || typeof mutation !== 'object') return fail('malformed');
  if (typeof mutation.id !== 'string' || !mutation.id) return fail('missing_id');
  if (!MUTATION_KINDS.has(mutation.kind)) return fail('unknown_kind');

  const table = String(mutation.table ?? '');
  const definition = MUTABLE_TABLES[table];
  if (!definition) return fail('table_not_mutable');

  if (!Array.isArray(mutation.key) || mutation.key.length !== definition.key.length) return fail('bad_key');
  for (const value of mutation.key) {
    if (value !== null && typeof value !== 'string' && typeof value !== 'number') return fail('bad_key');
  }

  // A per-table constraint, so `decorative_images` cannot be used to smuggle in an
  // immersion image through a channel meant for Deep Research illustrations.
  if (definition.require) {
    for (const [column, expected] of Object.entries(definition.require)) {
      const index = definition.key.indexOf(column);
      const actual = index >= 0 ? mutation.key[index] : mutation.row?.[column];
      if (String(actual) !== expected) return fail('constraint');
    }
  }

  if (mutation.kind === 'delete') {
    if (mutation.row !== undefined && mutation.row !== null) return fail('delete_has_row');
    return { ok: true, table, definition };
  }

  const row = mutation.row;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return fail('missing_row');

  if (table === 'writing_draft_annotations') {
    const start = Number(row.start_offset);
    const end = Number(row.end_offset);
    const selected = typeof row.selected_text === 'string' ? row.selected_text : '';
    const kind = String(row.kind ?? '');
    if (String(row.id ?? '') !== String(mutation.key[0] ?? '')) return fail('constraint');
    if (typeof row.draft_id !== 'string' || !row.draft_id || typeof row.scope !== 'string' || !row.scope) return fail('constraint');
    if (!ANNOTATION_KINDS.has(kind) || !Number.isInteger(start) || !Number.isInteger(end)
        || start < 0 || end <= start || !selected.trim() || selected.length !== end - start) return fail('constraint');
    if (kind === 'highlight'
        && (!ANNOTATION_COLORS.has(row.color) || row.comment_text !== null)) return fail('constraint');
    if (kind === 'comment'
        && (row.color !== null || typeof row.comment_text !== 'string' || !row.comment_text.trim())) return fail('constraint');
    if (kind === 'bookmark') {
      const expected = `reader-bookmark:${row.draft_id}:${row.scope}`;
      if (row.id !== expected || row.color !== null || row.comment_text !== null) return fail('constraint');
    }
  }

  const known = knownColumns(snapshot, table);
  for (const [column, value] of Object.entries(row)) {
    // Binary and nested values never ride inside a mutation: images go through the asset
    // channel, and anything else that is not a scalar is not a SQLite value.
    if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return fail('non_scalar_value');
    if (known && !known.has(column)) return fail(`unknown_column:${column}`);
  }

  for (const asset of Array.isArray(mutation.assets) ? mutation.assets : []) {
    if (typeof asset?.hash !== 'string' || !/^[0-9a-f]{64}$/.test(asset.hash)) return fail('bad_asset');
    if (!hasAsset(asset.hash)) return { ok: false, reason: 'missing_asset', missing: asset.hash };
  }

  // Measured and reported, not just compared. A rejection that says only "too large" leaves
  // the sender with nothing to act on; the phone showed exactly that, and there was no way
  // from the screen to learn whether the row missed by a kilobyte or by a factor of three.
  const bytes = Buffer.byteLength(JSON.stringify(mutation));
  if (bytes > maxBytes) return { ok: false, reason: 'too_large', bytes, limit: maxBytes };
  return { ok: true, table, definition, bytes };
}

/**
 * The set of columns a table has ever published, or null when the table has never appeared.
 *
 * Null means "cannot check", and the caller treats that as permissive: a brand-new table
 * that the owner has not published yet still has to pass the whitelist, which is the check
 * that actually matters for safety.
 */
export function knownColumns(snapshot, table) {
  const list = snapshot?.tables?.[table];
  if (!Array.isArray(list) || list.length === 0) return null;
  const columns = new Set();
  for (const row of list) for (const column of Object.keys(row ?? {})) columns.add(column);
  return columns;
}

/** Group a validated batch into the `{ table: rows[] }` shape the desktop merge consumes. */
export function toTableRows(mutations) {
  const tables = {};
  const deletions = [];
  for (const mutation of mutations) {
    if (mutation.kind === 'delete') {
      deletions.push({ table: mutation.table, key: mutation.key, rowKey: rowKey(mutation.table, mutation.key), at: mutation.createdAt });
      continue;
    }
    if (!tables[mutation.table]) tables[mutation.table] = [];
    tables[mutation.table].push(mutation.row);
  }
  return { tables, deletions };
}
