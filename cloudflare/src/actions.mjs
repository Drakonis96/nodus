import { HttpError, all, clampInteger, first, nowIso, randomId, readJson, run } from './util.mjs';

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const ACTION_KINDS = new Set([
  'deepResearch.generate',
  'deepResearch.saveToNotes',
  'idea.delete',
  'idea.saveToNotes',
  'author.synthesis.generate',
  'authors.matrix.generate',
  'argumentMap.generate',
  'library.importToSpace',
  'academic.recompute',
  'hypothesis.saveToNotes',
  'writing.generate',
  'projects.create',
  'projects.update',
  'projects.section.update',
  'projects.chapter.import',
  'worldbuilding.continuity',
  'worldbuilding.entityDelete',
  'worldbuilding.proseReview',
  'pages.restoreRevision',
  'databases.importCSV',
  'pages.automationRun',
  'toolkit.desktopRun',
]);
const TERMINAL = new Set(['applied', 'refused', 'failed', 'cancelled']);

function view(row) {
  return {
    id: row.id,
    sequence: Number(row.sequence),
    spaceId: row.space_id,
    idempotencyKey: row.idempotency_key,
    kind: row.kind,
    schemaVersion: Number(row.schema_version),
    payload: JSON.parse(row.payload_json),
    actorUserId: row.actor_user_id,
    createdByDevice: row.created_by_device,
    inputRevision: row.input_revision,
    inputFingerprint: row.input_fingerprint,
    status: row.status,
    claimedByDevice: row.claimed_by_device,
    result: row.result_json ? JSON.parse(row.result_json) : null,
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    claimedAt: row.claimed_at,
    finishedAt: row.finished_at,
  };
}

function visible(auth, row) {
  return auth.space_role === 'owner' || row.actor_user_id === auth.user_id;
}

export async function createSpaceAction(env, auth, request) {
  const input = await readJson(request, 512 * 1024);
  const id = String(input.id || randomId('act_'));
  const key = String(input.idempotencyKey || '');
  const kind = String(input.kind || '');
  const schemaVersion = Number(input.schemaVersion);
  if (!ID.test(id) || !ID.test(key)) throw new HttpError(400, 'bad_id', 'Action and idempotency identifiers must be 1–128 safe characters.');
  if (!ACTION_KINDS.has(kind)) throw new HttpError(400, 'unknown_action_kind', 'This action kind is not part of the typed Nodus contract.');
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) throw new HttpError(400, 'bad_schema_version', 'schemaVersion must be a positive integer.');
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) throw new HttpError(400, 'bad_payload', 'payload must be an object.');
  const fingerprint = input.inputFingerprint == null ? null : String(input.inputFingerprint);
  if (fingerprint && !FINGERPRINT.test(fingerprint)) throw new HttpError(400, 'bad_fingerprint', 'inputFingerprint must be a lowercase SHA-256 value.');
  const now = nowIso();
  try {
    await run(env.DB, `INSERT INTO space_actions
      (id,space_id,idempotency_key,kind,schema_version,payload_json,actor_user_id,created_by_device,input_revision,input_fingerprint,status,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'queued',?11,?11)`,
    id, auth.space_id, key, kind, schemaVersion, JSON.stringify(input.payload), auth.user_id, auth.device_id || null,
    input.inputRevision == null ? null : String(input.inputRevision), fingerprint, now);
  } catch (error) {
    const duplicate = await first(env.DB, 'SELECT * FROM space_actions WHERE space_id=?1 AND idempotency_key=?2', auth.space_id, key);
    if (!duplicate) throw error;
    if (duplicate.kind !== kind || Number(duplicate.schema_version) !== schemaVersion || duplicate.payload_json !== JSON.stringify(input.payload)) {
      throw new HttpError(409, 'idempotency_conflict', 'That idempotency key names a different action.');
    }
    return { action: view(duplicate), duplicate: true };
  }
  return { action: view(await first(env.DB, 'SELECT * FROM space_actions WHERE id=?1', id)), duplicate: false };
}

export async function listSpaceActions(env, auth, request) {
  const url = new URL(request.url);
  const since = clampInteger(url.searchParams.get('since'), 0, Number.MAX_SAFE_INTEGER, 0);
  const limit = clampInteger(url.searchParams.get('limit'), 1, 100, 50);
  const rows = auth.space_role === 'owner'
    ? await all(env.DB, 'SELECT * FROM space_actions WHERE space_id=?1 AND sequence>?2 ORDER BY sequence LIMIT ?3', auth.space_id, since, limit + 1)
    : await all(env.DB, 'SELECT * FROM space_actions WHERE space_id=?1 AND actor_user_id=?2 AND sequence>?3 ORDER BY sequence LIMIT ?4', auth.space_id, auth.user_id, since, limit + 1);
  const page = rows.slice(0, limit);
  return { actions: page.map(view), cursor: Number(page.at(-1)?.sequence || since), hasMore: rows.length > limit };
}

export async function getSpaceAction(env, auth, id) {
  const row = await first(env.DB, 'SELECT * FROM space_actions WHERE space_id=?1 AND id=?2', auth.space_id, id);
  if (!row || !visible(auth, row)) throw new HttpError(404, 'action_not_found', 'The action does not exist.');
  return { action: view(row) };
}

export async function cancelSpaceAction(env, auth, id) {
  const row = await first(env.DB, 'SELECT * FROM space_actions WHERE space_id=?1 AND id=?2', auth.space_id, id);
  if (!row || !visible(auth, row)) throw new HttpError(404, 'action_not_found', 'The action does not exist.');
  if (TERMINAL.has(row.status)) return { action: view(row), changed: false };
  if (!['queued', 'claimed'].includes(row.status)) throw new HttpError(409, 'action_running', 'A running action can only be stopped by the Desktop processing it.');
  const now = nowIso();
  await run(env.DB, `UPDATE space_actions SET status='cancelled',updated_at=?1,finished_at=?1
    WHERE space_id=?2 AND id=?3 AND status IN ('queued','claimed')`, now, auth.space_id, id);
  return { action: view(await first(env.DB, 'SELECT * FROM space_actions WHERE id=?1', id)), changed: true };
}

export async function claimSpaceAction(env, auth, request) {
  const input = await readJson(request, 64 * 1024);
  const now = nowIso();
  const requested = input.id == null ? null : String(input.id);
  const candidate = requested
    ? await first(env.DB, `SELECT * FROM space_actions WHERE space_id=?1 AND id=?2 AND status='queued'`, auth.space_id, requested)
    : await first(env.DB, `SELECT * FROM space_actions WHERE space_id=?1 AND status='queued' ORDER BY sequence LIMIT 1`, auth.space_id);
  if (!candidate) return { action: null };
  const claimed = await env.DB.prepare(`UPDATE space_actions SET status='claimed',claimed_by_device=?1,claimed_at=?2,updated_at=?2
    WHERE id=?3 AND status='queued' RETURNING *`).bind(auth.device_id || null, now, candidate.id).first();
  return { action: claimed ? view(claimed) : null };
}

export async function updateSpaceAction(env, auth, id, request) {
  const input = await readJson(request, 512 * 1024);
  const status = String(input.status || '');
  if (!['running', 'applied', 'refused', 'failed'].includes(status)) throw new HttpError(400, 'bad_action_status', 'Desktop may report running, applied, refused or failed.');
  const current = await first(env.DB, 'SELECT * FROM space_actions WHERE space_id=?1 AND id=?2', auth.space_id, id);
  if (!current) throw new HttpError(404, 'action_not_found', 'The action does not exist.');
  if (current.claimed_by_device !== auth.device_id) throw new HttpError(403, 'wrong_action_owner', 'Only the Desktop that claimed this action may update it.');
  if (TERMINAL.has(current.status)) return { action: view(current), changed: false };
  const now = nowIso();
  const finished = status === 'running' ? null : now;
  await run(env.DB, `UPDATE space_actions SET status=?1,result_json=?2,error_code=?3,updated_at=?4,finished_at=?5 WHERE id=?6`,
    status, input.result == null ? null : JSON.stringify(input.result), input.errorCode == null ? null : String(input.errorCode).slice(0, 128), now, finished, id);
  return { action: view(await first(env.DB, 'SELECT * FROM space_actions WHERE id=?1', id)), changed: true };
}
