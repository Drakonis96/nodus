import {
  HttpError,
  MAX_MUTATION_BATCH,
  MAX_MUTATION_BYTES,
  all,
  clampInteger,
  clientAddress,
  first,
  nowIso,
  readJson,
  run,
  safeJsonParse,
  sha256Hex,
  strictRateLimit,
} from './util.mjs';
import { MUTABLE_TABLES } from './generated/mutableTables.mjs';

const MAX_LEDGER_BYTES = 50 * 1024 * 1024;
const MUTATION_BODY_INLINE_BYTES = 96 * 1024;
const MAX_NODI_NOTES = 500;
const MAX_NODI_NOTE_BYTES = 64 * 1024;
const TOMBSTONE_TTL_MS = 90 * 86400_000;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;

function utf8Bytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

function rowKey(key) {
  return JSON.stringify(key.map((value) => value == null ? null : String(value)));
}

function validateAnnotation(mutation) {
  const row = mutation.row;
  const kinds = new Set(['highlight', 'comment', 'bookmark']);
  const colors = new Set(['yellow', 'rose', 'blue', 'mint', 'lavender', 'peach']);
  const start = Number(row.start_offset);
  const end = Number(row.end_offset);
  const selected = typeof row.selected_text === 'string' ? row.selected_text : '';
  if (String(row.id ?? '') !== String(mutation.key[0] ?? '') || !row.draft_id || !row.scope
      || !kinds.has(String(row.kind ?? '')) || !Number.isInteger(start) || !Number.isInteger(end)
      || start < 0 || end <= start || !selected.trim() || selected.length !== end - start) return false;
  if (row.kind === 'highlight' && (!colors.has(row.color) || row.comment_text !== null)) return false;
  if (row.kind === 'comment' && (row.color !== null || typeof row.comment_text !== 'string' || !row.comment_text.trim())) return false;
  if (row.kind === 'bookmark' && (row.id !== `reader-bookmark:${row.draft_id}:${row.scope}` || row.color !== null || row.comment_text !== null)) return false;
  if (row.target_json == null) return true;
  let target;
  try { target = JSON.parse(String(row.target_json)); } catch { return false; }
  const attachment = typeof target?.attachmentId === 'string' ? target.attachmentId : '';
  const text = target?.type === 'text' && attachment && attachment.length <= 512
    && (target.page == null || Number.isInteger(target.page) && target.page > 0)
    && (target.chapterId == null || typeof target.chapterId === 'string' && target.chapterId.length <= 512);
  const region = target?.type === 'region' && attachment && attachment.length <= 512
    && [target.x, target.y, target.width, target.height].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    && target.width > 0 && target.height > 0 && target.x + target.width <= 1.000001 && target.y + target.height <= 1.000001;
  return Boolean(text || region);
}

function validateMutation(mutation, knownColumns, existingAssets) {
  const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
  if (!mutation || typeof mutation !== 'object') return fail('malformed');
  if (typeof mutation.id !== 'string' || !ID.test(mutation.id)) return fail('bad_id');
  if (!['upsert', 'delete'].includes(mutation.kind)) return fail('unknown_kind');
  const table = String(mutation.table ?? '');
  const definition = MUTABLE_TABLES[table];
  if (!definition) return fail('table_not_mutable');
  if (!Array.isArray(mutation.key) || mutation.key.length !== definition.key.length
      || mutation.key.some((value) => value !== null && !['string', 'number'].includes(typeof value))) return fail('bad_key');
  if (definition.require) for (const [column, expected] of Object.entries(definition.require)) {
    const index = definition.key.indexOf(column);
    if (String(index >= 0 ? mutation.key[index] : mutation.row?.[column]) !== expected) return fail('constraint');
  }
  if (mutation.kind === 'delete') {
    if (mutation.row != null) return fail('delete_has_row');
  } else {
    if (!mutation.row || typeof mutation.row !== 'object' || Array.isArray(mutation.row)) return fail('missing_row');
    if (table === 'writing_draft_annotations' && !validateAnnotation(mutation)) return fail('constraint');
    for (const [column, value] of Object.entries(mutation.row)) {
      if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) return fail('non_scalar_value');
      const columns = knownColumns.get(table);
      if (columns && !columns.has(column)) return fail(`unknown_column:${column}`);
    }
  }
  for (const asset of Array.isArray(mutation.assets) ? mutation.assets : []) {
    if (!/^[0-9a-f]{64}$/.test(String(asset?.hash || ''))) return fail('bad_asset');
    if (!existingAssets.has(asset.hash)) return fail('missing_asset', { missing: asset.hash });
  }
  const bytes = utf8Bytes(JSON.stringify(mutation));
  if (bytes > MAX_MUTATION_BYTES) return fail('too_large', { bytes, limit: MAX_MUTATION_BYTES });
  return { ok: true, table, bytes };
}

async function validationContext(env, spaceId, batch) {
  const assets = [...new Set(batch.flatMap((mutation) => Array.isArray(mutation?.assets)
    ? mutation.assets.map((asset) => String(asset?.hash || '')).filter(Boolean) : []))];
  let existingAssets = new Set();
  if (assets.length) {
    const placeholders = assets.map((_, index) => `?${index + 2}`).join(',');
    const rows = await all(env.DB, `SELECT hash FROM objects WHERE space_id = ?1 AND kind = 'asset' AND hash IN (${placeholders})`, spaceId, ...assets);
    existingAssets = new Set(rows.map((row) => row.hash));
  }
  const current = await first(env.DB, 'SELECT active_generation FROM spaces WHERE id = ?1', spaceId);
  const knownColumns = new Map();
  if (current?.active_generation != null) {
    const rows = await all(env.DB, `SELECT table_name, row_json FROM published_rows
      WHERE space_id = ?1 AND generation = ?2 AND table_name IN (${Object.keys(MUTABLE_TABLES).map((_, index) => `?${index + 3}`).join(',')})
      GROUP BY table_name`, spaceId, current.active_generation, ...Object.keys(MUTABLE_TABLES));
    for (const row of rows) knownColumns.set(row.table_name, new Set(Object.keys(safeJsonParse(row.row_json, {}))));
  }
  return { existingAssets, knownColumns };
}

export async function postMutations(env, auth, request) {
  const input = await readJson(request, 8 * 1024 * 1024);
  const batch = Array.isArray(input.mutations) ? input.mutations : [];
  if (!batch.length) throw new HttpError(400, 'empty_batch', 'Send at least one mutation.');
  if (batch.length > MAX_MUTATION_BATCH) throw new HttpError(413, 'batch_too_large', `Send at most ${MAX_MUTATION_BATCH} mutations per request.`);
  const pending = await first(env.DB, `SELECT COALESCE(SUM(LENGTH(body_json)), 0) AS bytes FROM mutations
    WHERE space_id = ?1 AND acknowledged_at IS NULL`, auth.space_id);
  const incomingBytes = utf8Bytes(JSON.stringify(batch));
  if (Number(pending?.bytes || 0) + incomingBytes > MAX_LEDGER_BYTES) {
    throw new HttpError(507, 'ledger_full', 'The owner must open Nodus before more changes can be accepted.', { limitBytes: MAX_LEDGER_BYTES });
  }
  const context = await validationContext(env, auth.space_id, batch);
  const accepted = [];
  const duplicate = [];
  const rejected = [];
  const missing = new Set();
  const valid = [];
  for (const mutation of batch) {
    const verdict = validateMutation(mutation, context.knownColumns, context.existingAssets);
    if (!verdict.ok) {
      if (verdict.missing) missing.add(verdict.missing);
      rejected.push({ id: mutation?.id ?? null, reason: verdict.reason, ...(verdict.bytes ? { bytes: verdict.bytes, limitBytes: verdict.limit } : {}) });
      continue;
    }
    valid.push({ mutation, verdict });
  }
  if (missing.size) throw new HttpError(409, 'missing_assets', 'Upload referenced images before their mutations.', { missing: [...missing] });
  for (const { mutation, verdict } of valid) {
    const body = JSON.stringify({
      id: String(mutation.id), clientId: String(mutation.clientId || ''), kind: mutation.kind,
      table: verdict.table, key: mutation.key, row: mutation.kind === 'upsert' ? mutation.row : null,
      assets: Array.isArray(mutation.assets) ? mutation.assets : [], schemaVersion: Number(mutation.schemaVersion) || 0,
      createdAt: String(mutation.createdAt || nowIso()), userId: auth.user_id,
    });
    let bodyJson = body;
    let bodyObjectKey = null;
    if (utf8Bytes(body) > MUTATION_BODY_INLINE_BYTES) {
      bodyObjectKey = `spaces/${auth.space_id}/mutations/${await sha256Hex(body)}.json`;
      await env.OBJECTS.put(bodyObjectKey, body, { httpMetadata: { contentType: 'application/json' } });
      bodyJson = null;
    }
    const result = await run(env.DB, `INSERT OR IGNORE INTO mutations
      (id, space_id, client_id, user_id, kind, table_name, row_key, body_json, body_object_key, schema_version, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    String(mutation.id), auth.space_id, String(mutation.clientId || ''), auth.user_id, mutation.kind, verdict.table,
    rowKey(mutation.key), bodyJson, bodyObjectKey, Number(mutation.schemaVersion) || 0, String(mutation.createdAt || nowIso()));
    if (Number(result?.meta?.changes || 0)) accepted.push(String(mutation.id));
    else duplicate.push(String(mutation.id));
  }
  const cursor = accepted.length ? await first(env.DB, 'SELECT MAX(sequence) AS value FROM mutations WHERE space_id = ?1', auth.space_id) : null;
  return { accepted, duplicate, rejected, cursor: cursor?.value == null ? null : Number(cursor.value) };
}

async function mutationBody(env, row) {
  if (row.body_json) return safeJsonParse(row.body_json, null);
  if (!row.body_object_key) return null;
  const object = await env.OBJECTS.get(row.body_object_key);
  if (!object) return null;
  return safeJsonParse(await object.text(), null);
}

export async function getMutations(env, auth, request) {
  const url = new URL(request.url);
  const since = Math.max(0, Number(url.searchParams.get('since') || 0));
  const limit = clampInteger(url.searchParams.get('limit'), 1, MAX_MUTATION_BATCH, MAX_MUTATION_BATCH);
  const rows = await all(env.DB, `SELECT * FROM mutations WHERE space_id = ?1 AND sequence > ?2
    ORDER BY sequence LIMIT ?3`, auth.space_id, since, limit + 1);
  const selected = rows.slice(0, limit);
  const mutations = [];
  for (const row of selected) {
    const body = await mutationBody(env, row);
    if (body) mutations.push({ seq: Number(row.sequence), ...body });
  }
  const space = await first(env.DB, 'SELECT schema_version FROM spaces WHERE id = ?1', auth.space_id);
  return { mutations, cursor: mutations.at(-1)?.seq ?? since, hasMore: rows.length > limit, spaceSchemaVersion: Number(space?.schema_version || 0) };
}

export async function ackMutations(env, auth, request) {
  const input = await readJson(request, 64 * 1024);
  const cursor = Math.max(0, Number(input.cursor || 0));
  const rows = await all(env.DB, `SELECT sequence, body_object_key FROM mutations
    WHERE space_id = ?1 AND sequence <= ?2 AND acknowledged_at IS NULL`, auth.space_id, cursor);
  const objectKeys = rows.map((row) => row.body_object_key).filter(Boolean);
  if (objectKeys.length) await env.OBJECTS.delete(objectKeys);
  await run(env.DB, `UPDATE mutations SET acknowledged_at = ?1, body_object_key = NULL
    WHERE space_id = ?2 AND sequence <= ?3 AND acknowledged_at IS NULL`, nowIso(), auth.space_id, cursor);
  const pending = await first(env.DB, 'SELECT COUNT(*) AS count FROM mutations WHERE space_id = ?1 AND acknowledged_at IS NULL', auth.space_id);
  return { ok: true, cursor, pending: Number(pending?.count || 0) };
}

function validateNodiNote(value, now) {
  if (!value || typeof value !== 'object' || !ID.test(String(value.id ?? ''))) return { error: 'malformed' };
  const content = value.content == null ? '' : String(value.content);
  if (utf8Bytes(content) > MAX_NODI_NOTE_BYTES) return { error: 'too_large' };
  const createdAt = Number(value.createdAt);
  const updatedAt = Number(value.updatedAt);
  const deletedAt = value.deletedAt == null ? null : Number(value.deletedAt);
  if (![createdAt, updatedAt].every(Number.isFinite) || deletedAt !== null && !Number.isFinite(deletedAt)) return { error: 'malformed' };
  return { note: { id: String(value.id), title: String(value.title ?? '').slice(0, 100), titleExplicit: value.titleExplicit === true,
    content: deletedAt === null ? content : '', createdAt, updatedAt: Math.min(updatedAt, now), deletedAt } };
}

async function readNodiNotes(env, userId) {
  const rows = await all(env.DB, `SELECT id,title,title_explicit,content,created_ms,updated_ms,deleted_ms
    FROM nodi_notes WHERE user_id = ?1 ORDER BY updated_ms DESC`, userId);
  return rows.map((row) => ({
    id: row.id, title: row.title, titleExplicit: Boolean(row.title_explicit), content: row.content,
    createdAt: Number(row.created_ms), updatedAt: Number(row.updated_ms),
    deletedAt: row.deleted_ms == null ? null : Number(row.deleted_ms),
  }));
}

export async function getNodiNotes(env, auth, request) {
  const notes = await readNodiNotes(env, auth.user_id);
  const raw = new URL(request.url).searchParams.get('since');
  const since = raw == null || raw === '' ? Number.NaN : Number(raw);
  return { notes: Number.isFinite(since) ? notes.filter((note) => note.updatedAt > since) : notes,
    total: notes.filter((note) => note.deletedAt === null).length, serverTime: Date.now() };
}

export async function postNodiNotes(env, auth, request) {
  if (!await strictRateLimit(env, 'nodi-notes', `${auth.user_id}:${clientAddress(request)}`, 120, 60_000)) {
    throw new HttpError(429, 'rate_limited', 'Try synchronizing notes again shortly.');
  }
  const input = await readJson(request, 8 * 1024 * 1024);
  if (!Array.isArray(input.notes)) throw new HttpError(400, 'malformed', 'Send { notes: [...] }.');
  if (input.notes.length > MAX_NODI_NOTES) throw new HttpError(413, 'too_many', `Send at most ${MAX_NODI_NOTES} notes.`);
  const now = Date.now();
  const accepted = [];
  const rejected = [];
  for (const value of input.notes) {
    const verdict = validateNodiNote(value, now);
    if (verdict.note) accepted.push(verdict.note); else rejected.push({ id: String(value?.id ?? ''), reason: verdict.error });
  }
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO nodi_notes
      (user_id,id,title,title_explicit,content,created_ms,updated_ms,deleted_ms)
      SELECT ?1,
        CAST(json_extract(incoming.value, '$.id') AS TEXT),
        CAST(json_extract(incoming.value, '$.title') AS TEXT),
        CASE WHEN json_extract(incoming.value, '$.titleExplicit') THEN 1 ELSE 0 END,
        CAST(json_extract(incoming.value, '$.content') AS TEXT),
        CAST(json_extract(incoming.value, '$.createdAt') AS INTEGER),
        CAST(json_extract(incoming.value, '$.updatedAt') AS INTEGER),
        CAST(json_extract(incoming.value, '$.deletedAt') AS INTEGER)
      FROM json_each(?2) AS incoming WHERE true
      ON CONFLICT(user_id,id) DO UPDATE SET
        title=excluded.title,title_explicit=excluded.title_explicit,content=excluded.content,
        created_ms=MIN(nodi_notes.created_ms,excluded.created_ms),updated_ms=excluded.updated_ms,deleted_ms=excluded.deleted_ms
      WHERE excluded.updated_ms > nodi_notes.updated_ms
        OR (excluded.updated_ms = nodi_notes.updated_ms AND excluded.deleted_ms IS NOT NULL AND nodi_notes.deleted_ms IS NULL)`).bind(
      auth.user_id, JSON.stringify(accepted),
    ),
    env.DB.prepare(`DELETE FROM nodi_notes WHERE user_id = ?1 AND deleted_ms IS NOT NULL AND deleted_ms < ?2`).bind(
      auth.user_id, now - TOMBSTONE_TTL_MS,
    ),
    env.DB.prepare(`DELETE FROM nodi_notes WHERE user_id = ?1 AND deleted_ms IS NULL AND id NOT IN (
      SELECT id FROM nodi_notes WHERE user_id = ?1 AND deleted_ms IS NULL ORDER BY updated_ms DESC LIMIT ?2
    )`).bind(auth.user_id, MAX_NODI_NOTES),
  ]);
  const notes = await readNodiNotes(env, auth.user_id);
  const live = notes.filter((note) => note.deletedAt === null);
  const raw = new URL(request.url).searchParams.get('since');
  const since = raw == null || raw === '' ? Number.NaN : Number(raw);
  return { notes: Number.isFinite(since) ? notes.filter((note) => note.updatedAt > since) : notes,
    total: live.length, rejected, serverTime: now };
}

export async function cleanupSync(env) {
  const old = new Date(Date.now() - 30 * 86400_000).toISOString();
  return run(env.DB, 'DELETE FROM mutations WHERE acknowledged_at IS NOT NULL AND acknowledged_at < ?1', old);
}
