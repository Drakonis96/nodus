import { HttpError, safeJsonParse } from './util.mjs';

export const R2_ROW_HASH_FIELD = '__nodus_r2_row';
export const R2_ROW_TITLE_FIELD = '__nodus_search_title';
export const R2_ROW_BODY_FIELD = '__nodus_search_body';

function rowObjectKey(spaceId, hash) {
  return `spaces/${spaceId}/rows/${hash}.json`;
}

export async function resolvePublishedRow(env, spaceId, rowJson) {
  const value = safeJsonParse(rowJson, null);
  const hash = value?.[R2_ROW_HASH_FIELD];
  if (!hash) return value;
  if (!/^[0-9a-f]{64}$/.test(String(hash))) throw new HttpError(503, 'row_reference_invalid', 'A published row has an invalid R2 reference.');
  const object = await env.OBJECTS.get(rowObjectKey(spaceId, hash));
  if (!object) throw new HttpError(503, 'row_object_missing', 'A published row is missing from R2.');
  const bytes = await object.arrayBuffer();
  if (bytes.byteLength > 512 * 1024 * 1024) throw new HttpError(503, 'row_object_too_large', 'A published row exceeds the supported recovery size.');
  const row = safeJsonParse(new TextDecoder().decode(bytes), null);
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new HttpError(503, 'row_object_invalid', 'A published R2 row is not valid JSON.');
  return row;
}

export async function resolvePublishedRows(env, spaceId, records) {
  return Promise.all(records.map((record) => resolvePublishedRow(env, spaceId, record.row_json)));
}
