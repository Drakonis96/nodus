import type {
  DecorativeImage,
  DecorativeImageEntityKind,
  DecorativeImageSource,
  DecorativeImageStatus,
  DecorativeImageStyle,
  ImageProvider,
} from '@shared/types';
import { DEFAULT_DECORATIVE_IMAGE_STYLE } from '@shared/imageStyles';
import { getDb } from './database';

interface ImageRow {
  entity_kind: DecorativeImageEntityKind;
  entity_id: string;
  requested: number;
  status: DecorativeImageStatus;
  provider: ImageProvider | null;
  model: string | null;
  style: DecorativeImageStyle;
  visual_context: string | null;
  prompt: string | null;
  asset_ref: string | null;
  mime_type: string | null;
  image_blob: Buffer | null;
  thumbnail_blob: Buffer | null;
  error: string | null;
  source: DecorativeImageSource | null;
  prev_image_blob: Buffer | null;
  created_at: string;
  updated_at: string;
}

function toImage(row: ImageRow): DecorativeImage {
  return {
    entityKind: row.entity_kind,
    entityId: row.entity_id,
    requested: row.requested === 1,
    status: row.status,
    provider: row.provider,
    model: row.model,
    style: row.style || DEFAULT_DECORATIVE_IMAGE_STYLE,
    visualContext: row.visual_context,
    prompt: row.prompt,
    assetRef: row.asset_ref,
    mimeType: row.mime_type,
    error: row.error,
    source: row.source,
    hasPrevious: row.prev_image_blob != null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ASSET_REF = (entityKind: DecorativeImageEntityKind, entityId: string): string =>
  `db:decorative-image:${entityKind}:${entityId}`;

/** Copy the current ready image into the single previous-image snapshot slot.
 *  A no-op unless a real image is present, so a failed retry never wipes the
 *  snapshot the user may still want to restore. */
function snapshotCurrentAsPrevious(entityKind: DecorativeImageEntityKind, entityId: string): void {
  getDb()
    .prepare(
      `UPDATE decorative_images SET
         prev_image_blob = image_blob, prev_thumbnail_blob = thumbnail_blob,
         prev_mime_type = mime_type, prev_style = style,
         prev_visual_context = visual_context, prev_prompt = prompt,
         prev_provider = provider, prev_model = model, prev_source = source
       WHERE entity_kind = ? AND entity_id = ? AND status = 'ready' AND image_blob IS NOT NULL`
    )
    .run(entityKind, entityId);
}

export function getDecorativeImage(entityKind: DecorativeImageEntityKind, entityId: string): DecorativeImage | null {
  const row = getDb()
    .prepare('SELECT * FROM decorative_images WHERE entity_kind = ? AND entity_id = ?')
    .get(entityKind, entityId) as ImageRow | undefined;
  // Pending work lives only in this Electron process. If the app was closed or
  // crashed mid-call, recover into a manual-retry state instead of displaying a
  // spinner forever. The provider timeout is two minutes, so five minutes is a
  // conservative interruption threshold.
  if (row?.status === 'pending' && Date.parse(row.updated_at) < Date.now() - 5 * 60_000) {
    const now = new Date().toISOString();
    const error = 'La generación se interrumpió al cerrar la aplicación. Puedes reintentarlo manualmente.';
    getDb()
      .prepare(
        `UPDATE decorative_images SET status = 'failed', error = ?, updated_at = ?
         WHERE entity_kind = ? AND entity_id = ? AND status = 'pending'`
      )
      .run(error, now, entityKind, entityId);
    row.status = 'failed';
    row.error = error;
    row.updated_at = now;
  }
  return row ? toImage(row) : null;
}

export function getDecorativeImageData(
  entityKind: DecorativeImageEntityKind,
  entityId: string,
  thumbnail = false
): { bytes: Buffer; mimeType: string } | null {
  const column = thumbnail ? 'thumbnail_blob' : 'image_blob';
  const row = getDb()
    .prepare(`SELECT ${column} AS bytes, mime_type FROM decorative_images WHERE entity_kind = ? AND entity_id = ? AND status = 'ready'`)
    .get(entityKind, entityId) as { bytes: Buffer | null; mime_type: string | null } | undefined;
  return row?.bytes ? { bytes: row.bytes, mimeType: row.mime_type ?? 'image/jpeg' } : null;
}

export function markDecorativeImageNotRequested(
  entityKind: DecorativeImageEntityKind,
  entityId: string,
  style: DecorativeImageStyle
): DecorativeImage {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO decorative_images (
         entity_kind, entity_id, requested, status, style, created_at, updated_at
       ) VALUES (?, ?, 0, 'not_requested', ?, ?, ?)
       ON CONFLICT(entity_kind, entity_id) DO UPDATE SET
         requested = 0, status = 'not_requested', style = excluded.style,
         provider = NULL, model = NULL, visual_context = NULL, prompt = NULL,
         asset_ref = NULL, mime_type = NULL, image_blob = NULL,
         thumbnail_blob = NULL, error = NULL, updated_at = excluded.updated_at`
    )
    .run(entityKind, entityId, style, now, now);
  return getDecorativeImage(entityKind, entityId)!;
}

export function markDecorativeImagePending(input: {
  entityKind: DecorativeImageEntityKind;
  entityId: string;
  provider: ImageProvider;
  model: string;
  style: DecorativeImageStyle;
  preserveContext: boolean;
  preservePrompt: boolean;
}): DecorativeImage {
  const now = new Date().toISOString();
  const current = getDecorativeImage(input.entityKind, input.entityId);
  const context = input.preserveContext ? current?.visualContext ?? null : null;
  const prompt = input.preservePrompt ? current?.prompt ?? null : null;
  // Preserve the current image before the pending state clears its bytes, so a
  // regeneration can be undone from the design modal.
  snapshotCurrentAsPrevious(input.entityKind, input.entityId);
  getDb()
    .prepare(
      `INSERT INTO decorative_images (
         entity_kind, entity_id, requested, status, provider, model, style,
         visual_context, prompt, created_at, updated_at
       ) VALUES (?, ?, 1, 'pending', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_kind, entity_id) DO UPDATE SET
         requested = 1, status = 'pending', provider = excluded.provider,
         model = excluded.model, style = excluded.style,
         visual_context = excluded.visual_context, prompt = excluded.prompt,
         asset_ref = NULL, mime_type = NULL, image_blob = NULL,
         thumbnail_blob = NULL, error = NULL, updated_at = excluded.updated_at`
    )
    .run(
      input.entityKind,
      input.entityId,
      input.provider,
      input.model,
      input.style,
      context,
      prompt,
      now,
      now
    );
  return getDecorativeImage(input.entityKind, input.entityId)!;
}

export function saveDecorativeImagePrompt(
  entityKind: DecorativeImageEntityKind,
  entityId: string,
  visualContext: string,
  prompt: string
): void {
  getDb()
    .prepare('UPDATE decorative_images SET visual_context = ?, prompt = ?, updated_at = ? WHERE entity_kind = ? AND entity_id = ?')
    .run(visualContext, prompt, new Date().toISOString(), entityKind, entityId);
}

export function saveDecorativeImageReady(
  entityKind: DecorativeImageEntityKind,
  entityId: string,
  image: Buffer,
  thumbnail: Buffer
): DecorativeImage {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE decorative_images SET
         status = 'ready', source = 'ai', asset_ref = ?, mime_type = 'image/jpeg',
         image_blob = ?, thumbnail_blob = ?, error = NULL, updated_at = ?
       WHERE entity_kind = ? AND entity_id = ?`
    )
    .run(ASSET_REF(entityKind, entityId), image, thumbnail, now, entityKind, entityId);
  return getDecorativeImage(entityKind, entityId)!;
}

/** Store a user-uploaded (already compressed) image, snapshotting the current
 *  one so the upload can be undone. Creates the row if the entity had none. */
export function saveCustomDecorativeImageReady(
  entityKind: DecorativeImageEntityKind,
  entityId: string,
  image: Buffer,
  thumbnail: Buffer,
  style: DecorativeImageStyle = DEFAULT_DECORATIVE_IMAGE_STYLE
): DecorativeImage {
  const now = new Date().toISOString();
  const save = getDb().transaction(() => {
    snapshotCurrentAsPrevious(entityKind, entityId);
    getDb()
      .prepare(
        `INSERT INTO decorative_images (
           entity_kind, entity_id, requested, status, source, style,
           asset_ref, mime_type, image_blob, thumbnail_blob, created_at, updated_at
         ) VALUES (?, ?, 1, 'ready', 'custom', ?, ?, 'image/jpeg', ?, ?, ?, ?)
         ON CONFLICT(entity_kind, entity_id) DO UPDATE SET
           requested = 1, status = 'ready', source = 'custom',
           asset_ref = excluded.asset_ref, mime_type = 'image/jpeg',
           image_blob = excluded.image_blob, thumbnail_blob = excluded.thumbnail_blob,
           provider = NULL, model = NULL, prompt = NULL, error = NULL,
           updated_at = excluded.updated_at`
      )
      .run(entityKind, entityId, style, ASSET_REF(entityKind, entityId), image, thumbnail, now, now);
  });
  save();
  return getDecorativeImage(entityKind, entityId)!;
}

/** Restore the previous-image snapshot as the current image and clear the slot. */
export function restorePreviousDecorativeImage(
  entityKind: DecorativeImageEntityKind,
  entityId: string
): DecorativeImage {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE decorative_images SET
         requested = 1, status = 'ready',
         image_blob = prev_image_blob, thumbnail_blob = prev_thumbnail_blob,
         mime_type = COALESCE(prev_mime_type, 'image/jpeg'), asset_ref = ?,
         style = COALESCE(prev_style, style), visual_context = prev_visual_context,
         prompt = prev_prompt, provider = prev_provider, model = prev_model,
         source = prev_source, error = NULL,
         prev_image_blob = NULL, prev_thumbnail_blob = NULL, prev_mime_type = NULL,
         prev_style = NULL, prev_visual_context = NULL, prev_prompt = NULL,
         prev_provider = NULL, prev_model = NULL, prev_source = NULL,
         updated_at = ?
       WHERE entity_kind = ? AND entity_id = ? AND prev_image_blob IS NOT NULL`
    )
    .run(ASSET_REF(entityKind, entityId), now, entityKind, entityId);
  return getDecorativeImage(entityKind, entityId)!;
}

export function saveDecorativeImageFailure(
  entityKind: DecorativeImageEntityKind,
  entityId: string,
  error: string
): DecorativeImage {
  getDb()
    .prepare(
      `UPDATE decorative_images SET status = 'failed', image_blob = NULL,
       thumbnail_blob = NULL, asset_ref = NULL, mime_type = NULL, error = ?, updated_at = ?
       WHERE entity_kind = ? AND entity_id = ?`
    )
    .run(error.slice(0, 1000), new Date().toISOString(), entityKind, entityId);
  return getDecorativeImage(entityKind, entityId)!;
}

/** UI removal keeps the audit row and its requested=false state. */
export function removeDecorativeImage(entityKind: DecorativeImageEntityKind, entityId: string): DecorativeImage {
  const current = getDecorativeImage(entityKind, entityId);
  return markDecorativeImageNotRequested(entityKind, entityId, current?.style ?? DEFAULT_DECORATIVE_IMAGE_STYLE);
}

/** Owner deletion removes the metadata row as well. */
export function deleteDecorativeImageRow(entityKind: DecorativeImageEntityKind, entityId: string): void {
  getDb().prepare('DELETE FROM decorative_images WHERE entity_kind = ? AND entity_id = ?').run(entityKind, entityId);
}
