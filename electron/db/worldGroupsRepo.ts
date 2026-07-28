// Factions, cultures, religions, houses and orders (schema v94).
//
// ONE entity with a `kind`, not five tables: they share every field a writer fills in —
// name, description, image, members, period — so the sidebar sections are filtered views
// of this collection. Adding "Religiones" later costs a vocabulary entry and a nav row.
//
// Affiliations are directional in time rather than a plain membership flag: a character
// holds a rank in a group BETWEEN two world days, and may hold several over a life. That
// is what lets the sheet answer "what was she when this happened", which is the question
// a writer actually asks.

import { v4 as uuid } from 'uuid';
import { getDb } from './database';
import { deletePartiesForEntity } from './worldThreadsRepo';
import type {
  CharacterAffiliation,
  CharacterAffiliationInput,
  WorldGroup,
  WorldGroupInput,
  WorldGroupKind,
  WorldGroupStatus,
} from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${uuid()}`;
}

const GROUP_KINDS = new Set<WorldGroupKind>([
  'faction',
  'culture',
  'religion',
  'house',
  'order',
  'species',
  'language',
]);

const GROUP_STATUSES = new Set<WorldGroupStatus>(['active', 'extinct', 'dormant']);

function groupKind(value: string | null | undefined): WorldGroupKind {
  return value && GROUP_KINDS.has(value as WorldGroupKind) ? (value as WorldGroupKind) : 'faction';
}

function groupStatus(value: string | null | undefined): WorldGroupStatus | null {
  return value && GROUP_STATUSES.has(value as WorldGroupStatus) ? (value as WorldGroupStatus) : null;
}

interface GroupRow {
  group_id: string;
  kind: string;
  name: string;
  summary: string | null;
  description: string | null;
  visual_seed: string | null;
  accent: string | null;
  status: string | null;
  parent_id: string | null;
  seat_place_id: string | null;
  founded_year: number | null;
  ended_year: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToGroup(row: GroupRow): WorldGroup {
  return {
    groupId: row.group_id,
    kind: groupKind(row.kind),
    name: row.name,
    summary: row.summary,
    description: row.description,
    visualSeed: row.visual_seed,
    accent: row.accent,
    status: groupStatus(row.status),
    parentId: row.parent_id,
    seatPlaceId: row.seat_place_id,
    foundedYear: row.founded_year,
    endedYear: row.ended_year,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Every group, or only those of one kind — which is how Facciones and Culturas differ. */
export function listWorldGroups(kind?: WorldGroupKind): WorldGroup[] {
  const db = getDb();
  const rows = kind
    ? (db.prepare('SELECT * FROM world_groups WHERE kind = ? ORDER BY name').all(kind) as GroupRow[])
    : (db.prepare('SELECT * FROM world_groups ORDER BY kind, name').all() as GroupRow[]);
  return rows.map(rowToGroup);
}

export function getWorldGroup(groupId: string): WorldGroup | null {
  const row = getDb().prepare('SELECT * FROM world_groups WHERE group_id = ?').get(groupId) as GroupRow | undefined;
  return row ? rowToGroup(row) : null;
}

export function createWorldGroup(input: WorldGroupInput): WorldGroup {
  const id = newId('grp');
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO world_groups
        (group_id, kind, name, summary, description, visual_seed, accent, status, parent_id,
         seat_place_id, founded_year, ended_year, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      groupKind(input.kind),
      input.name.trim(),
      input.summary ?? null,
      input.description ?? null,
      input.visualSeed ?? null,
      input.accent ?? null,
      groupStatus(input.status),
      input.parentId ?? null,
      input.seatPlaceId ?? null,
      input.foundedYear ?? null,
      input.endedYear ?? null,
      input.notes ?? null,
      ts,
      ts
    );
  return getWorldGroup(id)!;
}

export function updateWorldGroup(groupId: string, patch: Partial<WorldGroupInput>): WorldGroup | null {
  const existing = getWorldGroup(groupId);
  if (!existing) return null;
  const pick = <K extends keyof WorldGroup>(key: K, value: WorldGroup[K] | undefined) =>
    value !== undefined ? value : existing[key];
  // A group cannot be its own parent; a deeper cycle is prevented by the same check the
  // places tree uses, applied by the caller before it gets here.
  const parentId = patch.parentId !== undefined ? (patch.parentId === groupId ? null : patch.parentId) : existing.parentId;
  getDb()
    .prepare(
      `UPDATE world_groups SET kind = ?, name = ?, summary = ?, description = ?, visual_seed = ?,
         accent = ?, status = ?, parent_id = ?, seat_place_id = ?, founded_year = ?,
         ended_year = ?, notes = ?, updated_at = ? WHERE group_id = ?`
    )
    .run(
      patch.kind !== undefined ? groupKind(patch.kind) : existing.kind,
      patch.name?.trim() || existing.name,
      pick('summary', patch.summary !== undefined ? patch.summary || null : undefined),
      pick('description', patch.description !== undefined ? patch.description || null : undefined),
      pick('visualSeed', patch.visualSeed !== undefined ? patch.visualSeed || null : undefined),
      pick('accent', patch.accent !== undefined ? patch.accent || null : undefined),
      patch.status !== undefined ? groupStatus(patch.status) : existing.status,
      parentId,
      pick('seatPlaceId', patch.seatPlaceId !== undefined ? patch.seatPlaceId || null : undefined),
      pick('foundedYear', patch.foundedYear !== undefined ? patch.foundedYear ?? null : undefined),
      pick('endedYear', patch.endedYear !== undefined ? patch.endedYear ?? null : undefined),
      pick('notes', patch.notes !== undefined ? patch.notes || null : undefined),
      now(),
      groupId
    );
  return getWorldGroup(groupId);
}

/**
 * Delete a group. Affiliations cascade from the foreign key; the gallery does NOT, for the
 * same reason as characters — `world_images.entity_id` is polymorphic and has no FK.
 */
export function deleteWorldGroup(groupId: string): void {
  const db = getDb();
  const remove = db.transaction(() => {
    db.prepare("DELETE FROM world_images WHERE entity_kind = 'group' AND entity_id = ?").run(groupId);
    deletePartiesForEntity('group', groupId);
    db.prepare('DELETE FROM world_groups WHERE group_id = ?').run(groupId);
  });
  remove();
}

// ── Affiliations ─────────────────────────────────────────────────────────────

interface AffiliationRow {
  affiliation_id: string;
  person_id: string;
  group_id: string;
  rank: string | null;
  from_world_day: number | null;
  to_world_day: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  group_name: string | null;
  group_kind: string | null;
  person_name: string | null;
}

function rowToAffiliation(row: AffiliationRow): CharacterAffiliation {
  return {
    affiliationId: row.affiliation_id,
    personId: row.person_id,
    groupId: row.group_id,
    groupName: row.group_name ?? '?',
    groupKind: groupKind(row.group_kind),
    personName: row.person_name ?? '?',
    rank: row.rank,
    fromWorldDay: row.from_world_day,
    toWorldDay: row.to_world_day,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const AFFILIATION_SELECT = `SELECT a.*, g.name AS group_name, g.kind AS group_kind, p.display_name AS person_name
  FROM character_affiliations a
  LEFT JOIN world_groups g ON g.group_id = a.group_id
  LEFT JOIN persons p ON p.person_id = a.person_id`;

/**
 * A character's affiliations, oldest first. Undated ones sort LAST rather than first:
 * SQLite puts NULLs first, which would park every membership the author has not placed in
 * time at the top of the sheet.
 */
export function listAffiliationsForCharacter(personId: string): CharacterAffiliation[] {
  return (
    getDb()
      .prepare(
        `${AFFILIATION_SELECT} WHERE a.person_id = ?
         ORDER BY (a.from_world_day IS NULL), a.from_world_day, a.created_at`
      )
      .all(personId) as AffiliationRow[]
  ).map(rowToAffiliation);
}

/** Everyone who belongs to a group — the membership list on its own sheet. */
export function listAffiliationsForGroup(groupId: string): CharacterAffiliation[] {
  return (
    getDb()
      .prepare(
        `${AFFILIATION_SELECT} WHERE a.group_id = ?
         ORDER BY (a.from_world_day IS NULL), a.from_world_day, a.created_at`
      )
      .all(groupId) as AffiliationRow[]
  ).map(rowToAffiliation);
}

export function addAffiliation(input: CharacterAffiliationInput): CharacterAffiliation {
  const id = newId('aff');
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO character_affiliations
        (affiliation_id, person_id, group_id, rank, from_world_day, to_world_day, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.personId,
      input.groupId,
      input.rank ?? null,
      input.fromWorldDay ?? null,
      input.toWorldDay ?? null,
      input.notes ?? null,
      ts,
      ts
    );
  return listAffiliationsForCharacter(input.personId).find((entry) => entry.affiliationId === id)!;
}

export function updateAffiliation(
  affiliationId: string,
  patch: Partial<CharacterAffiliationInput>
): CharacterAffiliation | null {
  const row = getDb()
    .prepare(`${AFFILIATION_SELECT} WHERE a.affiliation_id = ?`)
    .get(affiliationId) as AffiliationRow | undefined;
  if (!row) return null;
  const current = rowToAffiliation(row);
  getDb()
    .prepare(
      `UPDATE character_affiliations SET rank = ?, from_world_day = ?, to_world_day = ?, notes = ?, updated_at = ?
       WHERE affiliation_id = ?`
    )
    .run(
      patch.rank !== undefined ? patch.rank || null : current.rank,
      patch.fromWorldDay !== undefined ? patch.fromWorldDay ?? null : current.fromWorldDay,
      patch.toWorldDay !== undefined ? patch.toWorldDay ?? null : current.toWorldDay,
      patch.notes !== undefined ? patch.notes || null : current.notes,
      now(),
      affiliationId
    );
  const updated = getDb()
    .prepare(`${AFFILIATION_SELECT} WHERE a.affiliation_id = ?`)
    .get(affiliationId) as AffiliationRow;
  return rowToAffiliation(updated);
}

export function deleteAffiliation(affiliationId: string): void {
  getDb().prepare('DELETE FROM character_affiliations WHERE affiliation_id = ?').run(affiliationId);
}

/**
 * The groups a character belonged to at a given world day — what the sheet uses to answer
 * "what was she when this happened". An affiliation with no dates counts as always true:
 * the author simply has not placed it, and hiding it would be worse than showing it.
 */
export function affiliationsAt(personId: string, worldDay: number | null): CharacterAffiliation[] {
  return listAffiliationsForCharacter(personId).filter((entry) => {
    if (worldDay == null) return true;
    if (entry.fromWorldDay == null && entry.toWorldDay == null) return true;
    if (entry.fromWorldDay != null && worldDay < entry.fromWorldDay) return false;
    if (entry.toWorldDay != null && worldDay > entry.toWorldDay) return false;
    return true;
  });
}
