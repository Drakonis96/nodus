// Reading where characters are, from the three places the vault already records it.
//
// There is deliberately NO presence table: see shared/worldPresence.ts. This repo's whole
// job is the UNION, and its whole risk is doing it in N queries instead of three — a cast
// of forty characters would otherwise be forty round-trips before the map draws a frame.

import { getDb } from './database';
import type { Presence } from '@shared/worldPresence';

interface SceneRow {
  person_id: string;
  person_name: string;
  place_id: string;
  place_name: string | null;
  world_day: number | null;
  world_year: number | null;
  narrative_order: number;
  scene_id: string;
  title: string;
}

interface EventRow {
  person_id: string;
  person_name: string;
  place_id: string;
  place_name: string | null;
  world_day: number | null;
  world_year: number | null;
  world_order: number;
  event_id: string;
  label: string | null;
  type: string;
}

interface ResidenceRow {
  person_id: string;
  person_name: string;
  place_id: string;
  place_name: string | null;
  id: string;
  label: string | null;
}

/**
 * Every recorded presence in the vault, in three queries.
 *
 * Scenes and events carry a moment; residences do not, and that is by design — a
 * residence is where someone is when nothing else says otherwise, not an occurrence. It
 * arrives with a null day, sorts last, and never generates a journey.
 *
 * Rows without a place are skipped rather than defaulted: a scene with no `place_id` has
 * not been placed yet, and putting it anywhere would be an invention.
 */
export function listPresences(): Presence[] {
  const db = getDb();
  const presences: Presence[] = [];

  for (const row of db
    .prepare(
      `SELECT sc.person_id, p.display_name AS person_name, s.place_id,
              pl.name AS place_name, s.world_day, s.world_year, s.narrative_order,
              s.scene_id, s.title
         FROM scene_characters sc
         JOIN world_scenes s ON s.scene_id = sc.scene_id
         JOIN persons p      ON p.person_id = sc.person_id
         LEFT JOIN places pl ON pl.place_id = s.place_id
        WHERE s.place_id IS NOT NULL`
    )
    .all() as SceneRow[]) {
    presences.push({
      personId: row.person_id,
      personName: row.person_name,
      placeId: row.place_id,
      placeName: row.place_name,
      worldDay: row.world_day,
      worldYear: row.world_year,
      // A scene with no calendar still has a place in the telling, and that is a far
      // better tie-break than insertion order.
      worldOrder: row.narrative_order,
      source: 'scene',
      sourceId: row.scene_id,
      label: row.title,
    });
  }

  for (const row of db
    .prepare(
      `SELECT ep.person_id, p.display_name AS person_name, e.place_id,
              pl.name AS place_name, wd.world_day, wd.world_year,
              COALESCE(wd.world_order, 0) AS world_order, e.event_id, e.label, e.type
         FROM event_participants ep
         JOIN events e       ON e.event_id = ep.event_id
         JOIN persons p      ON p.person_id = ep.person_id
         LEFT JOIN event_world_dates wd ON wd.event_id = e.event_id
         LEFT JOIN places pl ON pl.place_id = e.place_id
        WHERE e.place_id IS NOT NULL`
    )
    .all() as EventRow[]) {
    presences.push({
      personId: row.person_id,
      personName: row.person_name,
      placeId: row.place_id,
      placeName: row.place_name,
      worldDay: row.world_day,
      worldYear: row.world_year,
      worldOrder: row.world_order,
      source: 'event',
      sourceId: row.event_id,
      label: row.label || row.type,
    });
  }

  for (const row of db
    .prepare(
      // `label` is what person_places actually calls it ("residencia", "nacimiento");
      // there is no `role` column, and assuming one throws at runtime rather than build.
      `SELECT pp.person_id, p.display_name AS person_name, pp.place_id,
              pl.name AS place_name, pp.id, pp.label
         FROM person_places pp
         JOIN persons p      ON p.person_id = pp.person_id
         LEFT JOIN places pl ON pl.place_id = pp.place_id`
    )
    .all() as ResidenceRow[]) {
    presences.push({
      personId: row.person_id,
      personName: row.person_name,
      placeId: row.place_id,
      placeName: row.place_name,
      worldDay: null,
      worldYear: null,
      worldOrder: 0,
      source: 'residence',
      sourceId: row.id,
      label: row.label,
    });
  }

  return presences;
}
