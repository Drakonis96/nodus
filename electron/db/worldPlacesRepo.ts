// Places seen from a worldbuilding vault (schema v95).
//
// The hierarchy and the classifier needed no schema: `places.parent_id` and `places.kind`
// have existed since migration 33. What this adds is the fiction overlay (appearance,
// atmosphere, history, visual seed) and the two guards the tree needs.
//
// The cycle guard runs BEFORE the write, not as a defence in the renderer. "A inside B
// inside A" makes the tree recurse forever, and a hang has no error message to follow.
// The renderer defends itself as well, but only because it must not depend on this being
// correct — not as the real protection.

import { getDb } from './database';
import { createPlace, deletePlaceRow, getPlace, listPlaces, updatePlace } from './entitiesRepo';
import { deleteImagesFor } from './worldImagesRepo';
import { wouldCycle } from '@shared/placeKinds';
import type { PlaceProfile, WorldPlace, WorldPlaceInput } from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

interface ProfileRow {
  place_id: string;
  appearance: string | null;
  atmosphere: string | null;
  history: string | null;
  visual_seed: string | null;
  accent: string | null;
  created_at: string;
  updated_at: string;
}

function defaultProfile(placeId: string): PlaceProfile {
  return {
    placeId,
    appearance: null,
    atmosphere: null,
    history: null,
    visualSeed: null,
    accent: null,
    createdAt: '',
    updatedAt: '',
  };
}

function rowToProfile(row: ProfileRow): PlaceProfile {
  return {
    placeId: row.place_id,
    appearance: row.appearance,
    atmosphere: row.atmosphere,
    history: row.history,
    visualSeed: row.visual_seed,
    accent: row.accent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function upsertProfile(placeId: string, profile: PlaceProfile): void {
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO place_profiles
        (place_id, appearance, atmosphere, history, visual_seed, accent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(place_id) DO UPDATE SET
         appearance = excluded.appearance, atmosphere = excluded.atmosphere,
         history = excluded.history, visual_seed = excluded.visual_seed,
         accent = excluded.accent, updated_at = excluded.updated_at`
    )
    .run(
      placeId,
      profile.appearance,
      profile.atmosphere,
      profile.history,
      profile.visualSeed,
      profile.accent,
      ts,
      ts
    );
}

/**
 * Every place with its overlay attached.
 *
 * The overlay is NEVER assumed to exist — a place created by a genealogy import, by the
 * gazetteer resolver or simply by naming it in an event form has none. Same rule as
 * characters: read with a synthesised default, write with an upsert.
 */
export function listWorldPlaces(): WorldPlace[] {
  const profiles = new Map(
    (getDb().prepare('SELECT * FROM place_profiles').all() as ProfileRow[]).map((row) => [
      row.place_id,
      rowToProfile(row),
    ])
  );
  return listPlaces().map((place) => ({
    ...place,
    profile: profiles.get(place.placeId) ?? defaultProfile(place.placeId),
  }));
}

export function getWorldPlace(placeId: string): WorldPlace | null {
  const place = getPlace(placeId);
  if (!place) return null;
  const row = getDb().prepare('SELECT * FROM place_profiles WHERE place_id = ?').get(placeId) as
    | ProfileRow
    | undefined;
  return { ...place, profile: row ? rowToProfile(row) : defaultProfile(placeId) };
}

export function createWorldPlace(input: WorldPlaceInput): WorldPlace {
  const db = getDb();
  const create = db.transaction(() => {
    const place = createPlace({
      name: input.name,
      kind: input.kind ?? null,
      parentId: input.parentId ?? null,
      notes: input.notes ?? null,
    });
    upsertProfile(place.placeId, {
      ...defaultProfile(place.placeId),
      appearance: input.appearance ?? null,
      atmosphere: input.atmosphere ?? null,
      history: input.history ?? null,
      visualSeed: input.visualSeed ?? null,
      accent: input.accent ?? null,
    });
    return place.placeId;
  });
  return getWorldPlace(create())!;
}

/**
 * Update a place and its overlay together.
 *
 * A reparent that would close a loop is REFUSED — the parent is left as it was rather
 * than the write failing, because the alternative is an unusable tree and there is
 * nothing sensible for the author to do about an error message here.
 */
export function updateWorldPlace(placeId: string, patch: Partial<WorldPlaceInput>): WorldPlace | null {
  const existing = getWorldPlace(placeId);
  if (!existing) return null;
  const db = getDb();
  const parentOf = (id: string) => getPlace(id)?.parentId ?? null;
  const nextParent =
    patch.parentId !== undefined && !wouldCycle(placeId, patch.parentId ?? null, parentOf)
      ? patch.parentId ?? null
      : existing.parentId;

  const update = db.transaction(() => {
    if (patch.name !== undefined || patch.kind !== undefined || patch.notes !== undefined || patch.parentId !== undefined) {
      updatePlace(placeId, {
        name: patch.name,
        kind: patch.kind,
        notes: patch.notes,
      });
      // updatePlace deliberately does not touch parent_id (genealogy never reparents), so
      // the hierarchy is written here, after the cycle check.
      db.prepare('UPDATE places SET parent_id = ?, updated_at = ? WHERE place_id = ?').run(nextParent, now(), placeId);
    }
    upsertProfile(placeId, {
      ...existing.profile,
      appearance: patch.appearance !== undefined ? patch.appearance || null : existing.profile.appearance,
      atmosphere: patch.atmosphere !== undefined ? patch.atmosphere || null : existing.profile.atmosphere,
      history: patch.history !== undefined ? patch.history || null : existing.profile.history,
      visualSeed: patch.visualSeed !== undefined ? patch.visualSeed || null : existing.profile.visualSeed,
      accent: patch.accent !== undefined ? patch.accent || null : existing.profile.accent,
    });
  });
  update();
  return getWorldPlace(placeId);
}

/**
 * Who is recorded at this place.
 *
 * Reads `person_places`, the table genealogy already uses for residences — the character
 * sheet's own Places section writes into it. Building a separate "inhabitants" table would
 * have created a second answer to the same question.
 */
export function inhabitantsOfPlace(placeId: string): { personId: string; displayName: string; role: string | null }[] {
  return getDb()
    .prepare(
      // `label` is what person_places actually calls it ("nacimiento", "residencia");
      // there is no `role` column, and assuming one threw at runtime rather than at build.
      `SELECT DISTINCT pp.person_id AS personId, p.display_name AS displayName, pp.label AS role
         FROM person_places pp JOIN persons p ON p.person_id = pp.person_id
        WHERE pp.place_id = ?
        ORDER BY p.display_name`
    )
    .all(placeId) as { personId: string; displayName: string; role: string | null }[];
}

/**
 * Delete a place. Children are DETACHED rather than deleted (places.parent_id is
 * ON DELETE SET NULL): removing a country must not silently take its cities with it.
 * The gallery has no foreign key, so it goes by hand — same as characters.
 */
export function deleteWorldPlace(placeId: string): void {
  const db = getDb();
  const remove = db.transaction(() => {
    deleteImagesFor('place', placeId);
    deletePlaceRow(placeId);
  });
  remove();
}
