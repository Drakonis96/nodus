// Secrets and scenes (schema v96) — the two pieces a writer works with that are neither
// people nor places.
//
// Both exist to answer a question the vault could not answer before:
//
//   - "who could plausibly have said this out loud, and since when?"  → secret_knowers
//   - "what happens in this scene, and where does it sit in the telling?" → world_scenes
//
// The scene design carries the one distinction that matters: `world_day` is WHEN a scene
// happens, `narrative_order` is WHERE it sits in the telling. A prologue set three
// centuries earlier is first in one and near-last in the other, and conflating them makes
// a flashback impossible to file.

import { v4 as uuid } from 'uuid';
import { getDb } from './database';
import { deleteImagesFor } from './worldImagesRepo';
import type {
  SceneAppearance,
  SecretKnower,
  WorldScene,
  WorldSceneInput,
  WorldSecret,
  WorldSecretInput,
} from '@shared/types';

function now(): string {
  return new Date().toISOString();
}
function newId(prefix: string): string {
  return `${prefix}_${uuid()}`;
}

// ── Secrets ──────────────────────────────────────────────────────────────────

interface SecretRow {
  secret_id: string;
  title: string;
  content: string | null;
  owner_person_id: string | null;
  status: string;
  revealed_world_day: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  owner_name: string | null;
}

const SECRET_SELECT = `SELECT s.*, p.display_name AS owner_name
  FROM world_secrets s LEFT JOIN persons p ON p.person_id = s.owner_person_id`;

function rowToSecret(row: SecretRow): WorldSecret {
  return {
    secretId: row.secret_id,
    title: row.title,
    content: row.content,
    ownerPersonId: row.owner_person_id,
    ownerName: row.owner_name,
    status: row.status === 'revealed' ? 'revealed' : 'kept',
    revealedWorldDay: row.revealed_world_day,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listSecrets(): WorldSecret[] {
  return (getDb().prepare(`${SECRET_SELECT} ORDER BY s.created_at`).all() as SecretRow[]).map(rowToSecret);
}

/** The secrets a character owns, plus the ones they merely know. */
export function secretsForCharacter(personId: string): { owned: WorldSecret[]; known: WorldSecret[] } {
  const owned = (
    getDb().prepare(`${SECRET_SELECT} WHERE s.owner_person_id = ? ORDER BY s.created_at`).all(personId) as SecretRow[]
  ).map(rowToSecret);
  const known = (
    getDb()
      .prepare(
        `${SECRET_SELECT} JOIN secret_knowers k ON k.secret_id = s.secret_id
          WHERE k.person_id = ? AND (s.owner_person_id IS NULL OR s.owner_person_id != ?)
          ORDER BY s.created_at`
      )
      .all(personId, personId) as SecretRow[]
  ).map(rowToSecret);
  return { owned, known };
}

export function createSecret(input: WorldSecretInput): WorldSecret {
  const id = newId('sec');
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO world_secrets
        (secret_id, title, content, owner_person_id, status, revealed_world_day, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.title.trim(),
      input.content ?? null,
      input.ownerPersonId ?? null,
      input.status === 'revealed' ? 'revealed' : 'kept',
      input.revealedWorldDay ?? null,
      input.notes ?? null,
      ts,
      ts
    );
  return listSecrets().find((secret) => secret.secretId === id)!;
}

export function updateSecret(secretId: string, patch: Partial<WorldSecretInput>): WorldSecret | null {
  const existing = listSecrets().find((secret) => secret.secretId === secretId);
  if (!existing) return null;
  getDb()
    .prepare(
      `UPDATE world_secrets SET title = ?, content = ?, owner_person_id = ?, status = ?,
         revealed_world_day = ?, notes = ?, updated_at = ? WHERE secret_id = ?`
    )
    .run(
      patch.title?.trim() || existing.title,
      patch.content !== undefined ? patch.content || null : existing.content,
      patch.ownerPersonId !== undefined ? patch.ownerPersonId || null : existing.ownerPersonId,
      patch.status !== undefined ? (patch.status === 'revealed' ? 'revealed' : 'kept') : existing.status,
      patch.revealedWorldDay !== undefined ? patch.revealedWorldDay ?? null : existing.revealedWorldDay,
      patch.notes !== undefined ? patch.notes || null : existing.notes,
      now(),
      secretId
    );
  return listSecrets().find((secret) => secret.secretId === secretId) ?? null;
}

export function deleteSecret(secretId: string): void {
  getDb().prepare('DELETE FROM world_secrets WHERE secret_id = ?').run(secretId);
}

/** Who knows a secret, earliest first. Those who always knew come first of all. */
export function listKnowers(secretId: string): SecretKnower[] {
  return (
    getDb()
      .prepare(
        `SELECT k.*, p.display_name AS person_name
           FROM secret_knowers k JOIN persons p ON p.person_id = k.person_id
          WHERE k.secret_id = ?
          ORDER BY (k.since_world_day IS NOT NULL), k.since_world_day, p.display_name`
      )
      .all(secretId) as { id: string; secret_id: string; person_id: string; person_name: string; since_world_day: number | null; how: string | null }[]
  ).map((row) => ({
    id: row.id,
    secretId: row.secret_id,
    personId: row.person_id,
    personName: row.person_name,
    sinceWorldDay: row.since_world_day,
    how: row.how,
  }));
}

export function addKnower(input: {
  secretId: string;
  personId: string;
  sinceWorldDay?: number | null;
  how?: string | null;
}): SecretKnower[] {
  getDb()
    .prepare(
      `INSERT INTO secret_knowers (id, secret_id, person_id, since_world_day, how, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(secret_id, person_id) DO UPDATE SET
         since_world_day = excluded.since_world_day, how = excluded.how`
    )
    .run(newId('knw'), input.secretId, input.personId, input.sinceWorldDay ?? null, input.how ?? null, now());
  return listKnowers(input.secretId);
}

export function removeKnower(id: string): void {
  getDb().prepare('DELETE FROM secret_knowers WHERE id = ?').run(id);
}

/**
 * Who knew this secret at a given moment.
 *
 * The question the table exists for: before writing a line of dialogue, which of these
 * people could possibly have said it. Someone with no date counts as always having known.
 */
export function knowersAt(secretId: string, worldDay: number | null): SecretKnower[] {
  return listKnowers(secretId).filter((knower) => {
    if (worldDay == null) return true;
    if (knower.sinceWorldDay == null) return true;
    return worldDay >= knower.sinceWorldDay;
  });
}

// ── Scenes ───────────────────────────────────────────────────────────────────

interface SceneRow {
  scene_id: string;
  title: string;
  summary: string | null;
  place_id: string | null;
  world_year: number | null;
  world_day: number | null;
  status: string;
  narrative_order: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  place_name: string | null;
}

const SCENE_SELECT = `SELECT s.*, pl.name AS place_name
  FROM world_scenes s LEFT JOIN places pl ON pl.place_id = s.place_id`;

function rowToScene(row: SceneRow): WorldScene {
  return {
    sceneId: row.scene_id,
    title: row.title,
    summary: row.summary,
    placeId: row.place_id,
    placeName: row.place_name,
    worldYear: row.world_year,
    worldDay: row.world_day,
    status: row.status === 'draft' || row.status === 'written' ? row.status : 'outline',
    narrativeOrder: row.narrative_order,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Scenes in one of TWO orders.
 *
 * `narrative` is the default because it is the manuscript's order — the one the writer
 * reads in. `chronological` answers a different question entirely ("what actually
 * happened first"), and a vault with flashbacks gives two genuinely different lists.
 */
export function listScenes(order: 'narrative' | 'chronological' = 'narrative'): WorldScene[] {
  const sql =
    order === 'chronological'
      ? `${SCENE_SELECT} ORDER BY (s.world_year IS NULL), s.world_year,
           (s.world_day IS NULL), s.world_day, s.narrative_order`
      : `${SCENE_SELECT} ORDER BY s.narrative_order, s.created_at`;
  return (getDb().prepare(sql).all() as SceneRow[]).map(rowToScene);
}

export function createScene(input: WorldSceneInput): WorldScene {
  const db = getDb();
  const id = newId('scn');
  const ts = now();
  const nextOrder =
    input.narrativeOrder ??
    ((db.prepare('SELECT MAX(narrative_order) AS m FROM world_scenes').get() as { m: number | null }).m ?? -1) + 1;
  db.prepare(
    `INSERT INTO world_scenes
      (scene_id, title, summary, place_id, world_year, world_day, status, narrative_order, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.title.trim(),
    input.summary ?? null,
    input.placeId ?? null,
    input.worldYear ?? null,
    input.worldDay ?? null,
    input.status ?? 'outline',
    nextOrder,
    input.notes ?? null,
    ts,
    ts
  );
  return listScenes().find((scene) => scene.sceneId === id)!;
}

export function updateScene(sceneId: string, patch: Partial<WorldSceneInput>): WorldScene | null {
  const existing = listScenes().find((scene) => scene.sceneId === sceneId);
  if (!existing) return null;
  getDb()
    .prepare(
      `UPDATE world_scenes SET title = ?, summary = ?, place_id = ?, world_year = ?, world_day = ?,
         status = ?, narrative_order = ?, notes = ?, updated_at = ? WHERE scene_id = ?`
    )
    .run(
      patch.title?.trim() || existing.title,
      patch.summary !== undefined ? patch.summary || null : existing.summary,
      patch.placeId !== undefined ? patch.placeId || null : existing.placeId,
      patch.worldYear !== undefined ? patch.worldYear ?? null : existing.worldYear,
      patch.worldDay !== undefined ? patch.worldDay ?? null : existing.worldDay,
      patch.status ?? existing.status,
      patch.narrativeOrder ?? existing.narrativeOrder,
      patch.notes !== undefined ? patch.notes || null : existing.notes,
      now(),
      sceneId
    );
  return listScenes().find((scene) => scene.sceneId === sceneId) ?? null;
}

export function deleteScene(sceneId: string): void {
  const db = getDb();
  const remove = db.transaction(() => {
    deleteImagesFor('scene', sceneId);
    db.prepare('DELETE FROM world_scenes WHERE scene_id = ?').run(sceneId);
  });
  remove();
}

/** Who appears in a scene. */
export function listSceneCharacters(sceneId: string): SceneAppearance[] {
  return (
    getDb()
      .prepare(
        `SELECT c.id, c.scene_id, c.person_id, c.role, p.display_name AS person_name
           FROM scene_characters c JOIN persons p ON p.person_id = c.person_id
          WHERE c.scene_id = ? ORDER BY p.display_name`
      )
      .all(sceneId) as { id: string; scene_id: string; person_id: string; role: string | null; person_name: string }[]
  ).map((row) => ({
    id: row.id,
    sceneId: row.scene_id,
    personId: row.person_id,
    personName: row.person_name,
    sceneTitle: '',
    role: row.role,
  }));
}

/**
 * The scenes a character appears in, in NARRATIVE order — the character sheet's
 * "Apariciones". Narrative rather than chronological because what a writer checks here is
 * "when does she show up in the book", not "when did this happen to her".
 */
export function appearancesOfCharacter(personId: string): SceneAppearance[] {
  return (
    getDb()
      .prepare(
        `SELECT c.id, c.scene_id, c.person_id, c.role, s.title AS scene_title, p.display_name AS person_name
           FROM scene_characters c
           JOIN world_scenes s ON s.scene_id = c.scene_id
           JOIN persons p ON p.person_id = c.person_id
          WHERE c.person_id = ?
          ORDER BY s.narrative_order, s.created_at`
      )
      .all(personId) as {
      id: string;
      scene_id: string;
      person_id: string;
      role: string | null;
      scene_title: string;
      person_name: string;
    }[]
  ).map((row) => ({
    id: row.id,
    sceneId: row.scene_id,
    personId: row.person_id,
    personName: row.person_name,
    sceneTitle: row.scene_title,
    role: row.role,
  }));
}

export function addSceneCharacter(sceneId: string, personId: string, role: string | null = null): SceneAppearance[] {
  getDb()
    .prepare(
      `INSERT INTO scene_characters (id, scene_id, person_id, role) VALUES (?, ?, ?, ?)
       ON CONFLICT(scene_id, person_id) DO UPDATE SET role = excluded.role`
    )
    .run(newId('scc'), sceneId, personId, role);
  return listSceneCharacters(sceneId);
}

export function removeSceneCharacter(id: string): void {
  getDb().prepare('DELETE FROM scene_characters WHERE id = ?').run(id);
}
