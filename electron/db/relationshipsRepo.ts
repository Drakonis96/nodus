// Kinship layer (genealogy): explicit parent/spouse relationships between persons,
// the specialisation the family tree is built on. Siblings are derived (shared
// parent), never stored. Provenance ('user_asserted' | 'ai_confirmed') is tracked so
// every tree edge is auditable back to who asserted it.

import { getDb } from './database';
import { v4 as uuid } from 'uuid';
import { getPerson } from './entitiesRepo';
import type { Kin, Person, Relationship, RelationshipProvenance, RelationshipType } from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

interface RelRow {
  rel_id: string;
  from_person: string;
  to_person: string;
  type: RelationshipType;
  provenance: RelationshipProvenance;
  notes: string | null;
}

function rowToRel(row: RelRow): Relationship {
  return {
    relId: row.rel_id,
    fromPerson: row.from_person,
    toPerson: row.to_person,
    type: row.type,
    provenance: row.provenance,
    notes: row.notes,
  };
}

/**
 * Add a relationship. For 'parent', direction matters (from = parent, to = child).
 * For the symmetric 'spouse', the pair is normalised (smaller id first) so (A,B) and
 * (B,A) collapse onto one row. Idempotent on the unique (from,to,type) triple.
 */
export function addRelationship(
  fromPerson: string,
  toPerson: string,
  type: RelationshipType,
  provenance: RelationshipProvenance = 'user_asserted',
  notes: string | null = null
): Relationship | null {
  if (fromPerson === toPerson) return null;
  let a = fromPerson;
  let b = toPerson;
  if (type === 'spouse' && a > b) [a, b] = [b, a];

  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM relationships WHERE from_person = ? AND to_person = ? AND type = ?')
    .get(a, b, type) as RelRow | undefined;
  if (existing) {
    // Upgrade provenance/notes if re-asserted (e.g. AI suggestion later user-confirmed).
    db.prepare('UPDATE relationships SET provenance = ?, notes = COALESCE(?, notes) WHERE rel_id = ?').run(
      provenance,
      notes,
      existing.rel_id
    );
    return getRelationship(existing.rel_id);
  }
  const id = `rel_${uuid()}`;
  db.prepare(
    'INSERT INTO relationships (rel_id, from_person, to_person, type, provenance, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, a, b, type, provenance, notes, now());
  return getRelationship(id);
}

export function getRelationship(relId: string): Relationship | null {
  const row = getDb().prepare('SELECT * FROM relationships WHERE rel_id = ?').get(relId) as RelRow | undefined;
  return row ? rowToRel(row) : null;
}

export function removeRelationship(relId: string): void {
  getDb().prepare('DELETE FROM relationships WHERE rel_id = ?').run(relId);
}

export function allRelationships(): Relationship[] {
  return (getDb().prepare('SELECT * FROM relationships').all() as RelRow[]).map(rowToRel);
}

export function listRelationshipsForPerson(personId: string): Relationship[] {
  return (
    getDb()
      .prepare('SELECT * FROM relationships WHERE from_person = ? OR to_person = ?')
      .all(personId, personId) as RelRow[]
  ).map(rowToRel);
}

function persons(ids: string[]): Person[] {
  const out: Person[] = [];
  for (const id of ids) {
    const p = getPerson(id);
    if (p) out.push(p);
  }
  return out;
}

export function parentIdsOf(personId: string): string[] {
  return (
    getDb()
      .prepare("SELECT from_person FROM relationships WHERE type = 'parent' AND to_person = ?")
      .all(personId) as { from_person: string }[]
  ).map((r) => r.from_person);
}

export function childIdsOf(personId: string): string[] {
  return (
    getDb()
      .prepare("SELECT to_person FROM relationships WHERE type = 'parent' AND from_person = ?")
      .all(personId) as { to_person: string }[]
  ).map((r) => r.to_person);
}

export function spouseIdsOf(personId: string): string[] {
  return (
    getDb()
      .prepare("SELECT from_person, to_person FROM relationships WHERE type = 'spouse' AND (from_person = ? OR to_person = ?)")
      .all(personId, personId) as { from_person: string; to_person: string }[]
  ).map((r) => (r.from_person === personId ? r.to_person : r.from_person));
}

/** Siblings = persons who share at least one parent, excluding self. */
export function siblingIdsOf(personId: string): string[] {
  const parents = parentIdsOf(personId);
  if (parents.length === 0) return [];
  const placeholders = parents.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT to_person FROM relationships
       WHERE type = 'parent' AND from_person IN (${placeholders}) AND to_person != ?`
    )
    .all(...parents, personId) as { to_person: string }[];
  return rows.map((r) => r.to_person);
}

/** A person's immediate kin, resolved to Person objects, for the ficha and the tree. */
export function kinOf(personId: string): Kin {
  return {
    parents: persons(parentIdsOf(personId)),
    children: persons(childIdsOf(personId)),
    spouses: persons(spouseIdsOf(personId)),
    siblings: persons(siblingIdsOf(personId)),
  };
}
