// Space membership used to be binary: `membership(userId, spaceId)` returned a row and
// every caller only checked that it existed. The `owner`/`reader` values were already
// written to state.json but nobody read them, so a reader paired to a space could publish
// over it. These ranks turn that stored value into an actual permission.
//
// Two axes, deliberately separate:
//   users[].role        'admin' | 'member'          → authority over the SERVER (its web admin)
//   memberships[].role  'reader' | 'writer' | 'owner' → authority over ONE SPACE (its data)
// An admin is not automatically the owner of a space; /admin/pairing already required a
// membership, and the API keeps that rule.

export const SPACE_ROLES = ['reader', 'writer', 'owner'];

const ROLE_RANK = { reader: 1, writer: 2, owner: 3 };
const NEED_RANK = { read: 1, write: 2, own: 3 };

export const DEFAULT_SPACE_ROLE = 'reader';

/** Unknown or absent values fall to the least privileged role, never the most. */
export function normalizeSpaceRole(value) {
  const role = String(value ?? '');
  return ROLE_RANK[role] ? role : DEFAULT_SPACE_ROLE;
}

export function isSpaceRole(value) {
  return Boolean(ROLE_RANK[String(value ?? '')]);
}

export function can(role, need) {
  const have = ROLE_RANK[normalizeSpaceRole(role)] ?? 0;
  const wanted = NEED_RANK[String(need ?? '')];
  // An unknown requirement denies rather than allows: a typo in a route definition
  // must never open a door.
  return wanted === undefined ? false : have >= wanted;
}

export const STATE_VERSION = 2;

/**
 * Bring a state.json forward in place.
 *
 * `Store.readState()` builds its result as `{ ...initialState(), ...parsed }`, so the
 * `version: 1` stored on disk overwrites whatever `initialState()` declares. The version
 * bump therefore cannot live in `initialState()` alone — it has to be applied here, after
 * the merge, by a function that is safe to run on every boot.
 *
 * v1 → v2 grants every pre-existing device token `grandfathered: true`. Publishing now
 * requires `own`, and an administrator may well have granted themselves plain `reader`
 * access to a space they later paired: without this flag their desktop would stop
 * publishing the moment they upgraded the server.
 */
export function migrateState(state) {
  const from = Number(state.version) || 1;
  if (from >= STATE_VERSION) return { migrated: false, from, to: from };

  for (const entry of state.memberships ?? []) {
    entry.role = normalizeSpaceRole(entry.role);
  }
  for (const device of state.deviceTokens ?? []) {
    if (device.kind === undefined) device.kind = 'publisher';
    if (device.expiresAt === undefined) device.expiresAt = null;
    if (device.grandfathered === undefined) device.grandfathered = true;
  }
  for (const space of state.spaces ?? []) {
    if (space.schemaVersion === undefined) space.schemaVersion = 0;
    if (space.snapshotFormatVersion === undefined) space.snapshotFormatVersion = 1;
    if (space.mutationCursor === undefined) space.mutationCursor = 0;
    if (space.assetBytes === undefined) space.assetBytes = 0;
  }

  state.version = STATE_VERSION;
  state.migratedAt = new Date().toISOString();
  return { migrated: true, from, to: STATE_VERSION };
}
