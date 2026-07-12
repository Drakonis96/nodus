// Read/write access to the primary-source records ontology (persons, places,
// events, participants) and its polymorphic evidence. Mirrors the conventions of
// the other repos: getDb() + prepared statements, ISO timestamps, uuid ids.
//
// Dates are stored twice — a human display form and a sortable key derived by the
// shared historical-date parser — so the timeline can order fuzzy dates.

import { getDb } from './database';
import { v4 as uuid } from 'uuid';
import { parseHistoricalDate } from '@shared/genealogyDates';
import type {
  EventInput,
  EventParticipant,
  HistoricalEvent,
  HistoricalEventType,
  ParticipantRole,
  Person,
  PersonInput,
  PersonName,
  PortraitFocus,
  Place,
  PlaceInput,
  PersonSex,
  RecordEvidence,
  RecordEvidenceInput,
  RecordEvidenceTargetKind,
  RecordSourceKind,
} from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${uuid()}`;
}

// ── Persons ──────────────────────────────────────────────────────────────────

interface PersonRow {
  person_id: string;
  display_name: string;
  sex: PersonSex;
  birth_date: string | null;
  death_date: string | null;
  notes: string | null;
  frame_style: string | null;
  biography: string | null;
  biography_at: string | null;
  pf_focus_x: number | null;
  pf_focus_y: number | null;
  pf_scale: number | null;
  created_at: string;
  updated_at: string;
}

const PERSON_SELECT = `SELECT p.*, pp.focus_x AS pf_focus_x, pp.focus_y AS pf_focus_y, pp.scale AS pf_scale
  FROM persons p LEFT JOIN person_portraits pp ON pp.person_id = p.person_id`;

function personNames(personId: string): PersonName[] {
  return (
    getDb()
      .prepare('SELECT name, kind FROM person_names WHERE person_id = ? ORDER BY name')
      .all(personId) as { name: string; kind: string | null }[]
  ).map((r) => ({ name: r.name, kind: r.kind }));
}

function rowToPerson(row: PersonRow): Person {
  return {
    personId: row.person_id,
    displayName: row.display_name,
    sex: row.sex,
    birthDate: row.birth_date,
    deathDate: row.death_date,
    notes: row.notes,
    names: personNames(row.person_id),
    portrait:
      row.pf_focus_x != null
        ? { focusX: row.pf_focus_x, focusY: row.pf_focus_y ?? 0.5, scale: row.pf_scale ?? 1 }
        : null,
    frameStyle: row.frame_style ?? null,
    biography: row.biography ?? null,
    biographyAt: row.biography_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Set (or clear with null) a person's wooden tree-frame override. */
export function setPersonFrame(personId: string, frameStyle: string | null): void {
  getDb().prepare('UPDATE persons SET frame_style = ?, updated_at = ? WHERE person_id = ?').run(frameStyle, now(), personId);
}

export function setPersonBiography(personId: string, biography: string | null): void {
  getDb()
    .prepare('UPDATE persons SET biography = ?, biography_at = ?, updated_at = ? WHERE person_id = ?')
    .run(biography, biography ? now() : null, now(), personId);
}

export function createPerson(input: PersonInput): Person {
  const db = getDb();
  const id = newId('per');
  const ts = now();
  const birth = parseHistoricalDate(input.birthDate);
  const death = parseHistoricalDate(input.deathDate);
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO persons
        (person_id, display_name, sex, birth_date, birth_date_sort, death_date, death_date_sort, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.displayName.trim(),
      input.sex ?? 'unknown',
      input.birthDate ?? null,
      birth.sortKey,
      input.deathDate ?? null,
      death.sortKey,
      input.notes ?? null,
      ts,
      ts
    );
    for (const n of input.names ?? []) addPersonNameInternal(id, n.name, n.kind ?? null);
  });
  tx();
  return getPerson(id)!;
}

export function updatePerson(personId: string, patch: Partial<PersonInput>): Person | null {
  const existing = getPerson(personId);
  if (!existing) return null;
  const displayName = patch.displayName?.trim() ?? existing.displayName;
  const sex = patch.sex ?? existing.sex;
  const birthDate = patch.birthDate !== undefined ? patch.birthDate : existing.birthDate;
  const deathDate = patch.deathDate !== undefined ? patch.deathDate : existing.deathDate;
  const notes = patch.notes !== undefined ? patch.notes : existing.notes;
  getDb()
    .prepare(
      `UPDATE persons SET display_name = ?, sex = ?, birth_date = ?, birth_date_sort = ?,
        death_date = ?, death_date_sort = ?, notes = ?, updated_at = ? WHERE person_id = ?`
    )
    .run(
      displayName,
      sex,
      birthDate,
      parseHistoricalDate(birthDate).sortKey,
      deathDate,
      parseHistoricalDate(deathDate).sortKey,
      notes,
      now(),
      personId
    );
  return getPerson(personId);
}

export function getPerson(personId: string): Person | null {
  const row = getDb().prepare(`${PERSON_SELECT} WHERE p.person_id = ?`).get(personId) as PersonRow | undefined;
  return row ? rowToPerson(row) : null;
}

/** List persons for the Personas view, optionally filtered by a name substring. */
export function listPersons(opts: { search?: string } = {}): Person[] {
  const search = (opts.search ?? '').trim();
  const rows = search
    ? (getDb()
        .prepare(
          `${PERSON_SELECT}
           LEFT JOIN person_names n ON n.person_id = p.person_id
           WHERE p.display_name LIKE ? OR n.name LIKE ?
           GROUP BY p.person_id
           ORDER BY p.display_name`
        )
        .all(`%${search}%`, `%${search}%`) as PersonRow[])
    : (getDb().prepare(`${PERSON_SELECT} ORDER BY p.display_name`).all() as PersonRow[]);
  return rows.map(rowToPerson);
}

export function deletePerson(personId: string): void {
  // Cascades remove person_names and event_participants; drop the person's own evidence too.
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM record_evidence WHERE target_kind = ? AND target_id = ?').run('person', personId);
    db.prepare('DELETE FROM persons WHERE person_id = ?').run(personId);
  });
  tx();
}

function addPersonNameInternal(personId: string, name: string, kind: string | null): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  getDb()
    .prepare('INSERT OR IGNORE INTO person_names (id, person_id, name, kind) VALUES (?, ?, ?, ?)')
    .run(newId('pn'), personId, trimmed, kind);
}

export function addPersonName(personId: string, name: string, kind: string | null = null): void {
  addPersonNameInternal(personId, name, kind);
}

// ── Portraits ─────────────────────────────────────────────────────────────────

export function setPersonPortrait(
  personId: string,
  blob: Uint8Array,
  mime = 'image/jpeg',
  focus: PortraitFocus = { focusX: 0.5, focusY: 0.5, scale: 1 }
): void {
  getDb()
    .prepare(
      `INSERT INTO person_portraits (person_id, blob, mime, focus_x, focus_y, scale, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(person_id) DO UPDATE SET blob = excluded.blob, mime = excluded.mime,
         focus_x = excluded.focus_x, focus_y = excluded.focus_y, scale = excluded.scale, updated_at = excluded.updated_at`
    )
    .run(personId, Buffer.from(blob), mime, focus.focusX, focus.focusY, focus.scale, now());
}

export function updatePortraitFocus(personId: string, focus: PortraitFocus): void {
  getDb()
    .prepare('UPDATE person_portraits SET focus_x = ?, focus_y = ?, scale = ?, updated_at = ? WHERE person_id = ?')
    .run(focus.focusX, focus.focusY, focus.scale, now(), personId);
}

export function getPersonPortrait(personId: string): { blob: Buffer; mime: string } | null {
  const row = getDb().prepare('SELECT blob, mime FROM person_portraits WHERE person_id = ?').get(personId) as
    | { blob: Buffer; mime: string }
    | undefined;
  return row ? { blob: row.blob, mime: row.mime } : null;
}

export function clearPersonPortrait(personId: string): void {
  getDb().prepare('DELETE FROM person_portraits WHERE person_id = ?').run(personId);
}

// ── Places ───────────────────────────────────────────────────────────────────

interface PlaceRow {
  place_id: string;
  name: string;
  parent_id: string | null;
  kind: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
}

function rowToPlace(row: PlaceRow): Place {
  return {
    placeId: row.place_id,
    name: row.name,
    parentId: row.parent_id,
    kind: row.kind,
    latitude: row.latitude,
    longitude: row.longitude,
    notes: row.notes,
  };
}

export function createPlace(input: PlaceInput): Place {
  const id = newId('plc');
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO places (place_id, name, parent_id, kind, latitude, longitude, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.name.trim(),
      input.parentId ?? null,
      input.kind ?? null,
      input.latitude ?? null,
      input.longitude ?? null,
      input.notes ?? null,
      ts,
      ts
    );
  return getPlace(id)!;
}

export function getPlace(placeId: string): Place | null {
  const row = getDb().prepare('SELECT * FROM places WHERE place_id = ?').get(placeId) as PlaceRow | undefined;
  return row ? rowToPlace(row) : null;
}

export function listPlaces(): Place[] {
  return (getDb().prepare('SELECT * FROM places ORDER BY name').all() as PlaceRow[]).map(rowToPlace);
}

export function updatePlace(placeId: string, patch: Partial<PlaceInput>): Place | null {
  const existing = getPlace(placeId);
  if (!existing) return null;
  const name = patch.name?.trim() ?? existing.name;
  const kind = patch.kind !== undefined ? patch.kind : existing.kind;
  const latitude = patch.latitude !== undefined ? patch.latitude : existing.latitude;
  const longitude = patch.longitude !== undefined ? patch.longitude : existing.longitude;
  const notes = patch.notes !== undefined ? patch.notes : existing.notes;
  getDb()
    .prepare('UPDATE places SET name = ?, kind = ?, latitude = ?, longitude = ?, notes = ?, updated_at = ? WHERE place_id = ?')
    .run(name, kind, latitude, longitude, notes, now(), placeId);
  return getPlace(placeId);
}

/** Find a place by exact name (case-insensitive), or create it. Used by extraction to de-dupe. */
export function findOrCreatePlace(name: string, kind: string | null = null): Place {
  const trimmed = name.trim();
  const existing = getDb()
    .prepare('SELECT * FROM places WHERE lower(name) = lower(?) LIMIT 1')
    .get(trimmed) as PlaceRow | undefined;
  if (existing) return rowToPlace(existing);
  return createPlace({ name: trimmed, kind });
}

// ── Events + participants ─────────────────────────────────────────────────────

interface EventRow {
  event_id: string;
  type: HistoricalEventType;
  label: string | null;
  date: string | null;
  date_sort: string | null;
  place_id: string | null;
  place_name: string | null;
  notes: string | null;
}

function eventParticipants(eventId: string): EventParticipant[] {
  return (
    getDb()
      .prepare(
        `SELECT ep.person_id, ep.role, p.display_name
         FROM event_participants ep
         LEFT JOIN persons p ON p.person_id = ep.person_id
         WHERE ep.event_id = ?
         ORDER BY ep.role`
      )
      .all(eventId) as { person_id: string; role: ParticipantRole; display_name: string | null }[]
  ).map((r) => ({ personId: r.person_id, role: r.role, displayName: r.display_name ?? undefined }));
}

function rowToEvent(row: EventRow): HistoricalEvent {
  return {
    eventId: row.event_id,
    type: row.type,
    label: row.label,
    date: row.date,
    sortKey: row.date_sort,
    placeId: row.place_id,
    placeName: row.place_name,
    notes: row.notes,
    participants: eventParticipants(row.event_id),
  };
}

const EVENT_SELECT = `SELECT e.event_id, e.type, e.label, e.date, e.date_sort, e.place_id, e.notes, pl.name AS place_name
  FROM events e LEFT JOIN places pl ON pl.place_id = e.place_id`;

export function createEvent(input: EventInput): HistoricalEvent {
  const db = getDb();
  const id = newId('evt');
  const ts = now();
  const parsed = parseHistoricalDate(input.date);
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO events (event_id, type, label, date, date_sort, date_end_sort, place_id, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.type,
      input.label ?? null,
      input.date ?? null,
      parsed.sortKey,
      parsed.endSortKey,
      input.placeId ?? null,
      input.notes ?? null,
      ts,
      ts
    );
    for (const part of input.participants ?? []) addParticipantInternal(id, part.personId, part.role);
  });
  tx();
  return getEvent(id)!;
}

export function updateEvent(eventId: string, patch: Partial<EventInput>): HistoricalEvent | null {
  const existing = getEvent(eventId);
  if (!existing) return null;
  const type = patch.type ?? existing.type;
  const label = patch.label !== undefined ? patch.label : existing.label;
  const date = patch.date !== undefined ? patch.date : existing.date;
  const placeId = patch.placeId !== undefined ? patch.placeId : existing.placeId;
  const notes = patch.notes !== undefined ? patch.notes : existing.notes;
  const parsed = parseHistoricalDate(date);
  getDb()
    .prepare(
      `UPDATE events SET type = ?, label = ?, date = ?, date_sort = ?, date_end_sort = ?, place_id = ?, notes = ?, updated_at = ?
       WHERE event_id = ?`
    )
    .run(type, label, date, parsed.sortKey, parsed.endSortKey, placeId, notes, now(), eventId);
  return getEvent(eventId);
}

export function getEvent(eventId: string): HistoricalEvent | null {
  const row = getDb().prepare(`${EVENT_SELECT} WHERE e.event_id = ?`).get(eventId) as EventRow | undefined;
  return row ? rowToEvent(row) : null;
}

export function deleteEvent(eventId: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM record_evidence WHERE target_kind = ? AND target_id = ?').run('event', eventId);
    db.prepare('DELETE FROM events WHERE event_id = ?').run(eventId);
  });
  tx();
}

/**
 * Timeline query: events ordered chronologically (undated events sort last), with
 * optional filters by participating person, event type, and a sort-key window.
 */
export function listEvents(
  opts: { personId?: string; type?: HistoricalEventType; from?: string; to?: string } = {}
): HistoricalEvent[] {
  const where: string[] = [];
  const params: unknown[] = [];
  let join = '';
  if (opts.personId) {
    join = 'JOIN event_participants ep ON ep.event_id = e.event_id';
    where.push('ep.person_id = ?');
    params.push(opts.personId);
  }
  if (opts.type) {
    where.push('e.type = ?');
    params.push(opts.type);
  }
  if (opts.from) {
    where.push('e.date_sort >= ?');
    params.push(opts.from);
  }
  if (opts.to) {
    where.push('e.date_sort <= ?');
    params.push(opts.to);
  }
  const sql = `SELECT e.event_id, e.type, e.label, e.date, e.date_sort, e.place_id, e.notes, pl.name AS place_name
    FROM events e ${join} LEFT JOIN places pl ON pl.place_id = e.place_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY (e.date_sort IS NULL), e.date_sort, e.created_at`;
  const rows = getDb().prepare(sql).all(...params) as EventRow[];
  return rows.map(rowToEvent);
}

function addParticipantInternal(eventId: string, personId: string, role: ParticipantRole): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO event_participants (id, event_id, person_id, role) VALUES (?, ?, ?, ?)')
    .run(newId('epa'), eventId, personId, role);
}

export function addParticipant(eventId: string, personId: string, role: ParticipantRole = 'principal'): void {
  addParticipantInternal(eventId, personId, role);
}

export function removeParticipant(eventId: string, personId: string, role: ParticipantRole): void {
  getDb()
    .prepare('DELETE FROM event_participants WHERE event_id = ? AND person_id = ? AND role = ?')
    .run(eventId, personId, role);
}

// ── Evidence ──────────────────────────────────────────────────────────────────

interface EvidenceRow {
  id: string;
  target_kind: RecordEvidenceTargetKind;
  target_id: string;
  nodus_id: string | null;
  source_kind: RecordSourceKind;
  quote: string | null;
  location: string | null;
  confidence: number | null;
}

function rowToEvidence(row: EvidenceRow): RecordEvidence {
  return {
    id: row.id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    nodusId: row.nodus_id,
    sourceKind: row.source_kind,
    quote: row.quote,
    location: row.location,
    confidence: row.confidence,
  };
}

export function addRecordEvidence(input: RecordEvidenceInput): RecordEvidence {
  const id = newId('rev');
  getDb()
    .prepare(
      `INSERT INTO record_evidence (id, target_kind, target_id, nodus_id, source_kind, quote, location, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.targetKind,
      input.targetId,
      input.nodusId ?? null,
      input.sourceKind ?? 'work',
      input.quote ?? null,
      input.location ?? null,
      input.confidence ?? null,
      now()
    );
  const row = getDb().prepare('SELECT * FROM record_evidence WHERE id = ?').get(id) as EvidenceRow;
  return rowToEvidence(row);
}

export function listEvidenceFor(targetKind: RecordEvidenceTargetKind, targetId: string): RecordEvidence[] {
  return (
    getDb()
      .prepare('SELECT * FROM record_evidence WHERE target_kind = ? AND target_id = ? ORDER BY created_at')
      .all(targetKind, targetId) as EvidenceRow[]
  ).map(rowToEvidence);
}

export function deleteRecordEvidence(id: string): void {
  getDb().prepare('DELETE FROM record_evidence WHERE id = ?').run(id);
}

/** Counts for the Personas / Timeline dashboards. */
export function recordCounts(): { persons: number; places: number; events: number } {
  const db = getDb();
  return {
    persons: (db.prepare('SELECT COUNT(*) AS c FROM persons').get() as { c: number }).c,
    places: (db.prepare('SELECT COUNT(*) AS c FROM places').get() as { c: number }).c,
    events: (db.prepare('SELECT COUNT(*) AS c FROM events').get() as { c: number }).c,
  };
}
