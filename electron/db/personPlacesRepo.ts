// Per-person place records: the log of places associated with a person, which drives
// their individual map and (aggregated across people) the general map. Independent
// from events. Dates are stored with a sortable key (shared fuzzy-date parser) so the
// map's chronological slider and the migration path can order the stops.

import { getDb } from './database';
import { v4 as uuid } from 'uuid';
import { parseHistoricalDate } from '@shared/genealogyDates';
import type { MapPlacePoint, PersonPlace, PersonPlaceInput } from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

interface PersonPlaceRow {
  id: string;
  person_id: string;
  place_id: string;
  label: string | null;
  date: string | null;
  date_sort: string | null;
  notes: string | null;
  place_name: string;
  admin1: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
}

const SELECT = `SELECT pp.id, pp.person_id, pp.place_id, pp.label, pp.date, pp.date_sort, pp.notes,
    pl.name AS place_name, pl.admin1, pl.country, pl.latitude, pl.longitude
  FROM person_places pp JOIN places pl ON pl.place_id = pp.place_id`;

function rowToPersonPlace(row: PersonPlaceRow): PersonPlace {
  return {
    id: row.id,
    personId: row.person_id,
    placeId: row.place_id,
    label: row.label,
    date: row.date,
    sortKey: row.date_sort,
    notes: row.notes,
    placeName: row.place_name,
    admin1: row.admin1,
    country: row.country,
    latitude: row.latitude,
    longitude: row.longitude,
  };
}

export function addPersonPlace(input: PersonPlaceInput): PersonPlace {
  const id = `ppl_${uuid()}`;
  const ts = now();
  const parsed = parseHistoricalDate(input.date ?? null);
  getDb()
    .prepare(
      `INSERT INTO person_places (id, person_id, place_id, label, date, date_sort, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, input.personId, input.placeId, input.label ?? null, input.date ?? null, parsed.sortKey, input.notes ?? null, ts, ts);
  return getPersonPlace(id)!;
}

export function getPersonPlace(id: string): PersonPlace | null {
  const row = getDb().prepare(`${SELECT} WHERE pp.id = ?`).get(id) as PersonPlaceRow | undefined;
  return row ? rowToPersonPlace(row) : null;
}

/** A person's place records, chronologically (undated last). */
export function listPersonPlaces(personId: string): PersonPlace[] {
  const rows = getDb()
    .prepare(`${SELECT} WHERE pp.person_id = ? ORDER BY (pp.date_sort IS NULL), pp.date_sort, pp.created_at`)
    .all(personId) as PersonPlaceRow[];
  return rows.map(rowToPersonPlace);
}

export function updatePersonPlace(id: string, patch: Partial<PersonPlaceInput>): PersonPlace | null {
  const existing = getDb().prepare('SELECT * FROM person_places WHERE id = ?').get(id) as { label: string | null; date: string | null; notes: string | null } | undefined;
  if (!existing) return null;
  const label = patch.label !== undefined ? patch.label : existing.label;
  const date = patch.date !== undefined ? patch.date : existing.date;
  const notes = patch.notes !== undefined ? patch.notes : existing.notes;
  const sort = parseHistoricalDate(date ?? null).sortKey;
  getDb()
    .prepare('UPDATE person_places SET label = ?, date = ?, date_sort = ?, notes = ?, updated_at = ? WHERE id = ?')
    .run(label, date, sort, notes, now(), id);
  return getPersonPlace(id);
}

export function deletePersonPlace(id: string): void {
  getDb().prepare('DELETE FROM person_places WHERE id = ?').run(id);
}

export function personPlaceCount(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM person_places').get() as { n: number }).n;
}

/**
 * Located points for the map: every person_place whose place has coordinates, joined
 * with the person's identity/dates for the thumbnail. Optionally filtered to a set of
 * person ids (the map's person filter). The renderer groups by person for routes and
 * by place for thumbnails.
 */
export function mapPoints(personIds?: string[]): MapPlacePoint[] {
  let sql = `SELECT pp.id AS person_place_id, pp.person_id, p.display_name, p.birth_date, p.death_date,
      (pf.person_id IS NOT NULL) AS has_portrait,
      pp.place_id, pl.name AS place_name, pl.admin1, pl.country, pl.latitude, pl.longitude,
      pp.label, pp.date, pp.date_sort
    FROM person_places pp
    JOIN places pl ON pl.place_id = pp.place_id
    JOIN persons p ON p.person_id = pp.person_id
    LEFT JOIN person_portraits pf ON pf.person_id = pp.person_id
    WHERE pl.latitude IS NOT NULL AND pl.longitude IS NOT NULL`;
  const params: string[] = [];
  if (personIds && personIds.length > 0) {
    sql += ` AND pp.person_id IN (${personIds.map(() => '?').join(', ')})`;
    params.push(...personIds);
  }
  sql += ' ORDER BY (pp.date_sort IS NULL), pp.date_sort';
  const rows = getDb().prepare(sql).all(...params) as Array<{
    person_place_id: string;
    person_id: string;
    display_name: string;
    birth_date: string | null;
    death_date: string | null;
    has_portrait: number;
    place_id: string;
    place_name: string;
    admin1: string | null;
    country: string | null;
    latitude: number;
    longitude: number;
    label: string | null;
    date: string | null;
    date_sort: string | null;
  }>;
  return rows.map((r) => ({
    personPlaceId: r.person_place_id,
    personId: r.person_id,
    personName: r.display_name,
    birthDate: r.birth_date,
    deathDate: r.death_date,
    hasPortrait: !!r.has_portrait,
    placeId: r.place_id,
    placeName: r.place_name,
    admin1: r.admin1,
    country: r.country,
    latitude: r.latitude,
    longitude: r.longitude,
    label: r.label,
    date: r.date,
    sortKey: r.date_sort,
  }));
}
