// Social-relations network: a SECOND, independent graph from the kinship tree — the
// connections a person had beyond family (patrons, friends, employers, rivals,
// correspondents...), the material a social/prosopographical historian works with.
// Mirrors relationshipsRepo's conventions (getDb() + prepared statements, ISO
// timestamps, uuid ids) but keeps its own tables: a social_contact is a lightweight
// node for someone known only through a relation, never itself a tree member.

import { getDb } from './database';
import { v4 as uuid } from 'uuid';
import { getPerson } from './entitiesRepo';
import type {
  SocialContact,
  SocialContactInput,
  SocialGraphData,
  SocialGraphNode,
  SocialRelation,
  SocialRelationInput,
  SocialRelationTargetKind,
} from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${uuid()}`;
}

// ── Contacts ─────────────────────────────────────────────────────────────────

interface ContactRow {
  contact_id: string;
  display_name: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToContact(row: ContactRow): SocialContact {
  return {
    contactId: row.contact_id,
    displayName: row.display_name,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSocialContact(input: SocialContactInput): SocialContact {
  const id = newId('contact');
  const ts = now();
  getDb()
    .prepare('INSERT INTO social_contacts (contact_id, display_name, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, input.displayName.trim() || 'Sin nombre', input.notes ?? null, ts, ts);
  return getSocialContact(id)!;
}

export function getSocialContact(contactId: string): SocialContact | null {
  const row = getDb().prepare('SELECT * FROM social_contacts WHERE contact_id = ?').get(contactId) as ContactRow | undefined;
  return row ? rowToContact(row) : null;
}

/** List contacts for the target picker, optionally filtered by a name substring. */
export function listSocialContacts(opts: { search?: string } = {}): SocialContact[] {
  const search = (opts.search ?? '').trim();
  const rows = search
    ? (getDb().prepare('SELECT * FROM social_contacts WHERE display_name LIKE ? ORDER BY display_name').all(`%${search}%`) as ContactRow[])
    : (getDb().prepare('SELECT * FROM social_contacts ORDER BY display_name').all() as ContactRow[]);
  return rows.map(rowToContact);
}

export function updateSocialContact(contactId: string, patch: Partial<SocialContactInput>): SocialContact | null {
  const existing = getSocialContact(contactId);
  if (!existing) return null;
  const displayName = patch.displayName !== undefined ? patch.displayName.trim() || existing.displayName : existing.displayName;
  const notes = patch.notes !== undefined ? patch.notes : existing.notes;
  getDb()
    .prepare('UPDATE social_contacts SET display_name = ?, notes = ?, updated_at = ? WHERE contact_id = ?')
    .run(displayName, notes, now(), contactId);
  return getSocialContact(contactId);
}

/** Deleting a contact also removes every relation that points at them (no FK, since
 *  target is polymorphic — mirrors record_evidence's manual cleanup convention). */
export function deleteSocialContact(contactId: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM social_relations WHERE target_kind = 'contact' AND target_id = ?").run(contactId);
    db.prepare('DELETE FROM social_contacts WHERE contact_id = ?').run(contactId);
  });
  tx();
}

// ── Relations ────────────────────────────────────────────────────────────────

interface RelationRow {
  relation_id: string;
  person_id: string;
  target_kind: SocialRelationTargetKind;
  target_id: string;
  role: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function resolveTargetName(targetKind: SocialRelationTargetKind, targetId: string): string {
  if (targetKind === 'person') return getPerson(targetId)?.displayName ?? '?';
  return getSocialContact(targetId)?.displayName ?? '?';
}

function rowToRelation(row: RelationRow): SocialRelation {
  return {
    relationId: row.relation_id,
    personId: row.person_id,
    personName: getPerson(row.person_id)?.displayName ?? '?',
    targetKind: row.target_kind,
    targetId: row.target_id,
    targetName: resolveTargetName(row.target_kind, row.target_id),
    role: row.role,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSocialRelation(input: SocialRelationInput): SocialRelation {
  const id = newId('srel');
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO social_relations (relation_id, person_id, target_kind, target_id, role, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, input.personId, input.targetKind, input.targetId, input.role.trim() || 'conocido', input.notes ?? null, ts, ts);
  return getSocialRelation(id)!;
}

export function getSocialRelation(relationId: string): SocialRelation | null {
  const row = getDb().prepare('SELECT * FROM social_relations WHERE relation_id = ?').get(relationId) as RelationRow | undefined;
  return row ? rowToRelation(row) : null;
}

/** Only role/notes are mutable; a wrong target is deleted and recreated instead. */
export function updateSocialRelation(relationId: string, patch: Partial<SocialRelationInput>): SocialRelation | null {
  const existing = getDb().prepare('SELECT * FROM social_relations WHERE relation_id = ?').get(relationId) as RelationRow | undefined;
  if (!existing) return null;
  const role = patch.role !== undefined ? patch.role.trim() || existing.role : existing.role;
  const notes = patch.notes !== undefined ? patch.notes : existing.notes;
  getDb()
    .prepare('UPDATE social_relations SET role = ?, notes = ?, updated_at = ? WHERE relation_id = ?')
    .run(role, notes, now(), relationId);
  return getSocialRelation(relationId);
}

export function deleteSocialRelation(relationId: string): void {
  getDb().prepare('DELETE FROM social_relations WHERE relation_id = ?').run(relationId);
}

/** Relations recorded FROM this person's ficha — editable there. */
export function listSocialRelationsForPerson(personId: string): SocialRelation[] {
  return (
    getDb().prepare('SELECT * FROM social_relations WHERE person_id = ? ORDER BY created_at').all(personId) as RelationRow[]
  ).map(rowToRelation);
}

/** Relations recorded by ANOTHER person that name this person as their target —
 *  shown read-only on this ficha; editing happens on the recording person's ficha. */
export function listSocialRelationsTargetingPerson(personId: string): SocialRelation[] {
  return (
    getDb()
      .prepare("SELECT * FROM social_relations WHERE target_kind = 'person' AND target_id = ? ORDER BY created_at")
      .all(personId) as RelationRow[]
  ).map(rowToRelation);
}

/** Every relation naming this contact as its target — the contact's own "mentioned
 *  by" rollup, always read-only (contacts never author relations themselves). */
export function listSocialRelationsTargetingContact(contactId: string): SocialRelation[] {
  return (
    getDb()
      .prepare("SELECT * FROM social_relations WHERE target_kind = 'contact' AND target_id = ? ORDER BY created_at")
      .all(contactId) as RelationRow[]
  ).map(rowToRelation);
}

export function allSocialRelations(): SocialRelation[] {
  return (getDb().prepare('SELECT * FROM social_relations ORDER BY created_at').all() as RelationRow[]).map(rowToRelation);
}

export function socialCounts(): { contacts: number; relations: number } {
  const c = getDb().prepare('SELECT COUNT(*) AS n FROM social_contacts').get() as { n: number };
  const r = getDb().prepare('SELECT COUNT(*) AS n FROM social_relations').get() as { n: number };
  return { contacts: c.n, relations: r.n };
}

/** The whole network as a graph: every tree person + contact who appears in at
 *  least one relation (as recorder or target), and every relation as an edge. */
export function socialGraph(): SocialGraphData {
  const relations = allSocialRelations();
  const nodes = new Map<string, SocialGraphNode>();
  for (const r of relations) {
    if (!nodes.has(r.personId)) {
      nodes.set(r.personId, { id: r.personId, kind: 'person', displayName: getPerson(r.personId)?.displayName ?? '?' });
    }
    if (!nodes.has(r.targetId)) {
      nodes.set(r.targetId, { id: r.targetId, kind: r.targetKind, displayName: r.targetName });
    }
  }
  return {
    nodes: [...nodes.values()],
    edges: relations.map((r) => ({ relationId: r.relationId, fromId: r.personId, toId: r.targetId, role: r.role })),
  };
}
