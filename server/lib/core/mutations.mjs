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
  decorative_images: { key: ['entity_kind', 'entity_id'], require: { entity_kind: 'deep_research' } },
  immersion_sessions: { key: ['id'] },
  saved_searches: { key: ['id'] },
  research_questions: { key: ['id'] },
  research_subquestions: { key: ['id'] },
  research_coverage_links: { key: ['id'] },
  edge_feedback: { key: ['from_id', 'to_id', 'type'] },
};

export const MUTATION_KINDS = new Set(['upsert', 'delete']);
export const MAX_MUTATION_BYTES = 64 * 1024;
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
export function validateMutation(mutation, { snapshot, hasAsset }) {
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

  if (Buffer.byteLength(JSON.stringify(mutation)) > MAX_MUTATION_BYTES) return fail('too_large');
  return { ok: true, table, definition };
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
