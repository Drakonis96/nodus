// The gallery of ANY world entity (schema v94): characters, places, groups, scenes.
//
// One table, one repo. The character-specific wrappers in charactersRepo delegate here —
// two implementations of "the images of a thing" would drift, and the avatar rule already
// depends on there being exactly one answer to which bytes belong to what.
//
// entity_id is polymorphic and has NO foreign key, so nothing cascades: every delete path
// must call `deleteImagesFor` itself.

import { v4 as uuid } from 'uuid';
import { getDb } from './database';
import type { CharacterImage, CharacterImageKind, WorldImageEntityKind } from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

interface ImageRow {
  image_id: string;
  entity_id: string;
  kind: string;
  label: string | null;
  mime_type: string;
  bytes: number;
  prompt: string | null;
  provider: string | null;
  model: string | null;
  style: string | null;
  generated: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const IMAGE_KINDS = new Set<CharacterImageKind>(['portrait', 'full_body', 'expression', 'age', 'outfit', 'emblem', 'other']);

export function imageKind(value: string | null | undefined): CharacterImageKind {
  return value && IMAGE_KINDS.has(value as CharacterImageKind) ? (value as CharacterImageKind) : 'other';
}

function rowToImage(row: ImageRow): CharacterImage {
  return {
    imageId: row.image_id,
    personId: row.entity_id,
    kind: imageKind(row.kind),
    label: row.label,
    mimeType: row.mime_type,
    bytes: row.bytes,
    prompt: row.prompt,
    provider: row.provider,
    model: row.model,
    style: row.style,
    generated: !!row.generated,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * One entity's images, WITHOUT the blobs. The bytes are fetched one at a time, because
 * listing them inline would push every byte of every image through the IPC bridge just to
 * draw a row of thumbnails.
 */
export function listWorldImages(entityKind: WorldImageEntityKind, entityId: string): CharacterImage[] {
  return (
    getDb()
      .prepare(
        `SELECT image_id, entity_id, kind, label, mime_type, bytes, prompt, provider, model,
                style, generated, sort_order, created_at, updated_at
           FROM world_images WHERE entity_kind = ? AND entity_id = ?
          ORDER BY sort_order, created_at`
      )
      .all(entityKind, entityId) as ImageRow[]
  ).map(rowToImage);
}

export function getWorldImageBlob(imageId: string): { blob: Buffer; mime: string } | null {
  const row = getDb().prepare('SELECT blob, mime_type FROM world_images WHERE image_id = ?').get(imageId) as
    | { blob: Buffer | null; mime_type: string }
    | undefined;
  return row?.blob ? { blob: row.blob, mime: row.mime_type } : null;
}

export function addWorldImage(input: {
  entityKind: WorldImageEntityKind;
  entityId: string;
  blob: Uint8Array;
  mimeType?: string;
  kind?: CharacterImageKind;
  label?: string | null;
  prompt?: string | null;
  provider?: string | null;
  model?: string | null;
  style?: string | null;
  generated?: boolean;
}): CharacterImage {
  const db = getDb();
  const id = `wim_${uuid()}`;
  const ts = now();
  const nextOrder =
    ((db
      .prepare('SELECT MAX(sort_order) AS m FROM world_images WHERE entity_kind = ? AND entity_id = ?')
      .get(input.entityKind, input.entityId) as { m: number | null }).m ?? -1) + 1;
  const bytes = Buffer.from(input.blob);
  db.prepare(
    `INSERT INTO world_images
      (image_id, entity_kind, entity_id, kind, label, mime_type, bytes, blob, prompt, provider,
       model, style, generated, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.entityKind,
    input.entityId,
    imageKind(input.kind),
    input.label?.trim() || null,
    input.mimeType ?? 'image/jpeg',
    bytes.length,
    bytes,
    input.prompt ?? null,
    input.provider ?? null,
    input.model ?? null,
    input.style ?? null,
    input.generated ? 1 : 0,
    nextOrder,
    ts,
    ts
  );
  return listWorldImages(input.entityKind, input.entityId).find((image) => image.imageId === id)!;
}

export function updateWorldImage(imageId: string, patch: { kind?: CharacterImageKind; label?: string | null }): void {
  const current = getDb().prepare('SELECT kind, label FROM world_images WHERE image_id = ?').get(imageId) as
    | { kind: string; label: string | null }
    | undefined;
  if (!current) return;
  getDb()
    .prepare('UPDATE world_images SET kind = ?, label = ?, updated_at = ? WHERE image_id = ?')
    .run(
      patch.kind !== undefined ? imageKind(patch.kind) : current.kind,
      patch.label !== undefined ? patch.label?.trim() || null : current.label,
      now(),
      imageId
    );
}

export function deleteWorldImage(imageId: string): void {
  getDb().prepare('DELETE FROM world_images WHERE image_id = ?').run(imageId);
}

/** Remove every image of an entity. Call from every delete path: nothing cascades here. */
export function deleteImagesFor(entityKind: WorldImageEntityKind, entityId: string): void {
  getDb().prepare('DELETE FROM world_images WHERE entity_kind = ? AND entity_id = ?').run(entityKind, entityId);
}
