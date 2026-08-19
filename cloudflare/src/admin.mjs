import {
  HttpError,
  all,
  cookies,
  first,
  html,
  json,
  nowIso,
  randomId,
  readForm,
  redirect,
  run,
  safeJsonParse,
  sha256Hex,
  constantTimeEqual,
  strictRateLimit,
  clientAddress,
} from './util.mjs';
import {
  authenticateWebPassword,
  createPairingCode,
  createWebSession,
  hashPassword,
  requireCsrf,
  sessionUser,
} from './auth.mjs';
import { getObject } from './publications.mjs';
import { resolvePublishedRows } from './rows.mjs';

const RECOVERY_OBJECT_KINDS = new Set(['asset', 'library', 'snapshot', 'vector', 'row', 'backup']);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function page(title, body) {
  return html(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title>
  <style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f4f7f5;color:#17231e;font:15px/1.5 system-ui}header,main,footer{max-width:1050px;margin:auto;padding:24px}header{display:flex;align-items:center;justify-content:space-between}h1,h2{line-height:1.15}section{background:white;border:1px solid #dce5e0;border-radius:16px;padding:22px;margin:18px 0;box-shadow:0 5px 20px #1231}table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid #e7ece9;padding:10px 6px;vertical-align:top}form.inline{display:inline}input,select{border:1px solid #b8c5bf;border-radius:8px;padding:9px;margin:3px;max-width:100%}button,a.button{border:0;border-radius:9px;background:#126b4c;color:white;padding:9px 13px;text-decoration:none;display:inline-block;font-weight:650;cursor:pointer}.muted{color:#63716b}.danger{background:#a53232}code{word-break:break-all}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}</style>
  <header><div><strong>Nodus Cloud</strong><div class="muted">Your knowledge, in your Cloudflare account</div></div></header><main>${body}</main><footer class="muted"><a href="/source" target="_blank" rel="noreferrer">Source code · GNU AGPL v3</a></footer></html>`);
}

function cookie(name, value, options = '') {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax${options}`;
}

async function requireAdmin(env, request) {
  const session = await sessionUser(env, request);
  if (!session || session.role !== 'admin') return null;
  return session;
}

function csrfFromRequest(request) {
  return cookies(request).nodus_csrf || '';
}

export async function loginPage(request, invalid = false) {
  const returnTo = new URL(request.url).searchParams.get('return') || '/admin';
  return page('Sign in', `<section style="max-width:480px;margin:8vh auto"><h1>Sign in to your Nodus Cloud</h1><p class="muted">This page manages the copy stored in your own Cloudflare account.</p>${invalid ? '<p role="alert">The email or password is incorrect.</p>' : ''}
    <form method="post" action="/admin/login"><input type="hidden" name="return" value="${escapeHtml(returnTo)}"><p><label>Email<br><input name="email" type="email" required autocomplete="username" style="width:100%"></label></p><p><label>Password<br><input name="password" type="password" required autocomplete="current-password" style="width:100%"></label></p><button>Sign in</button></form></section>`);
}

export async function login(env, request) {
  if (!await strictRateLimit(env, 'admin-login', clientAddress(request), 10, 15 * 60_000)) {
    throw new HttpError(429, 'rate_limited', 'Try signing in again later.');
  }
  const form = await readForm(request);
  let user;
  try { user = await authenticateWebPassword(env, form.get('email'), form.get('password')); } catch { return loginPage(new Request(`${new URL(request.url).origin}/admin/login?return=${encodeURIComponent(form.get('return') || '/admin')}`), true); }
  const session = await createWebSession(env, user);
  const returnTo = String(form.get('return') || '/admin');
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/admin';
  return new Response(null, { status: 303, headers: [
    ['location', safeReturn],
    ['set-cookie', cookie('nodus_session', session.token, '; Max-Age=43200')],
    ['set-cookie', cookie('nodus_csrf', session.csrf, '; Max-Age=43200')],
  ] });
}

export async function dashboard(env, request, notice = '') {
  const session = await requireAdmin(env, request);
  if (!session) return redirect(`/admin/login?return=${encodeURIComponent('/admin')}`, 302);
  const [installation, spaces, users, devices] = await Promise.all([
    first(env.DB, 'SELECT * FROM installation WHERE id = 1'),
    all(env.DB, `SELECT s.*, COUNT(m.user_id) AS members FROM spaces s LEFT JOIN memberships m ON m.space_id = s.id GROUP BY s.id ORDER BY s.name`),
    all(env.DB, `SELECT u.id, u.email, u.display_name, u.role, u.disabled_at, GROUP_CONCAT(m.space_id || ':' || m.role) AS memberships
      FROM users u LEFT JOIN memberships m ON m.user_id = u.id GROUP BY u.id ORDER BY u.email`),
    all(env.DB, `SELECT d.id, d.device_name, d.device_kind, d.last_seen_at, d.revoked_at, u.email, s.name AS space_name
      FROM device_tokens d JOIN users u ON u.id=d.user_id JOIN spaces s ON s.id=d.space_id ORDER BY d.created_at DESC`),
  ]);
  const csrf = escapeHtml(csrfFromRequest(request));
  const form = (action, inner, className = 'inline') => `<form method="post" action="/admin/action" class="${className}"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="action" value="${action}">${inner}</form>`;
  return page(installation?.name || 'Nodus Cloud', `${notice ? `<section><strong>${escapeHtml(notice)}</strong></section>` : ''}<h1>${escapeHtml(installation?.name || 'Nodus Cloud')}</h1><p>This is the published copy in your Cloudflare account. Your original vault remains on your device.</p>
    <section><h2>Installation</h2>${form('installation-settings', `<div class="grid"><input name="name" required maxlength="100" value="${escapeHtml(installation?.name || 'Nodus Cloud')}" aria-label="Installation name"><select name="language" aria-label="Interface language">${['es','en','fr','de','pt','pt-BR','it','tr'].map((language) => `<option value="${language}"${installation?.language === language ? ' selected' : ''}>${language}</option>`).join('')}</select></div><button>Save settings</button>`, '')}</section>
    <section><h2>Vaults</h2><table><thead><tr><th>Vault</th><th>Publication</th><th>Members</th><th>Actions</th></tr></thead><tbody>${spaces.map((space) => `<tr><td><strong>${escapeHtml(space.name)}</strong><br><span class="muted">${escapeHtml(space.description)}</span></td><td>${space.active_generation == null ? 'Not published' : `Generation ${Number(space.active_generation)}<br><span class="muted">${escapeHtml(space.updated_at)}</span>`}</td><td>${Number(space.members)}</td><td>${form('pair', `<input type="hidden" name="spaceId" value="${escapeHtml(space.id)}"><button>Create connection code</button>`)} <a class="button" href="/admin/recovery/${encodeURIComponent(space.id)}/manifest.json">Recovery manifest</a></td></tr>`).join('')}</tbody></table>
    <h3>Add a vault destination</h3>${form('create-space', '<input name="name" required placeholder="Vault name"><input name="description" placeholder="Description"><button>Create</button>', '')}</section>
    <section><h2>People and access</h2><table><thead><tr><th>Account</th><th>Role</th><th>Vault access</th><th>Actions</th></tr></thead><tbody>${users.map((user) => `<tr><td>${escapeHtml(user.email)}${user.disabled_at ? ' (disabled)' : ''}</td><td>${escapeHtml(user.role)}</td><td>${escapeHtml(user.memberships || '—')}</td><td>${form('reset-user-password', `<input type="hidden" name="userId" value="${escapeHtml(user.id)}"><button>Reset password</button>`)} ${user.id === session.user_id ? '' : form('toggle-user', `<input type="hidden" name="userId" value="${escapeHtml(user.id)}"><button class="danger">${user.disabled_at ? 'Enable' : 'Disable'}</button>`)}</td></tr>`).join('')}</tbody></table>
    <h3>Add an account</h3>${form('create-user', `<div class="grid"><input name="email" type="email" required placeholder="Email"><input name="displayName" placeholder="Name"><select name="spaceId"><option value="">No vault yet</option>${spaces.map((space) => `<option value="${escapeHtml(space.id)}">${escapeHtml(space.name)}</option>`).join('')}</select><select name="spaceRole"><option value="reader">Reader</option><option value="writer">Writer</option><option value="owner">Owner</option></select></div><button>Create account</button>`, '')}
    <h3>Change vault access</h3>${form('membership', `<div class="grid"><select name="userId" required>${users.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.email)}</option>`).join('')}</select><select name="spaceId" required>${spaces.map((space) => `<option value="${escapeHtml(space.id)}">${escapeHtml(space.name)}</option>`).join('')}</select><select name="spaceRole"><option value="reader">Reader</option><option value="writer">Writer</option><option value="owner">Owner</option><option value="remove">Remove access</option></select></div><button>Apply access</button>`, '')}</section>
    <section><h2>Connected devices</h2><table><thead><tr><th>Device</th><th>Owner / vault</th><th>Last used</th><th></th></tr></thead><tbody>${devices.map((device) => `<tr><td>${escapeHtml(device.device_name)}<br><span class="muted">${escapeHtml(device.device_kind)}</span></td><td>${escapeHtml(device.email)}<br>${escapeHtml(device.space_name)}</td><td>${escapeHtml(device.last_seen_at || 'Never')}</td><td>${device.revoked_at ? 'Revoked' : form('revoke-device', `<input type="hidden" name="deviceId" value="${escapeHtml(device.id)}"><button class="danger">Revoke</button>`)}</td></tr>`).join('')}</tbody></table></section>
    <section><h2>Your password</h2>${form('change-password', '<div class="grid"><input name="currentPassword" type="password" required autocomplete="current-password" placeholder="Current password"><input name="newPassword" type="password" required minlength="12" autocomplete="new-password" placeholder="New password"><input name="confirmPassword" type="password" required minlength="12" autocomplete="new-password" placeholder="Repeat new password"></div><button>Change password</button>', '')}</section>
    <section><h2>Recovery</h2><p>Each vault has a portable snapshot and a paginated structured-data export. D1 Time Travel remains the fastest way to undo a recent database mistake; open it directly from your Cloudflare dashboard. Nodus does not receive access to your Cloudflare account.</p><p><a href="https://developers.cloudflare.com/d1/reference/time-travel/" target="_blank" rel="noreferrer">Official D1 recovery documentation</a></p></section>
    ${form('logout', '<button class="danger">Sign out</button>')}`);
}

function temporaryPassword() {
  return `Nodus-${crypto.randomUUID().replaceAll('-', '').slice(0, 18)}!`;
}

export async function adminAction(env, request) {
  const session = await requireAdmin(env, request);
  if (!session) return redirect('/admin/login', 302);
  const form = await readForm(request);
  await requireCsrf(env, request, session, form.get('csrf'));
  const action = String(form.get('action') || '');
  if (action === 'logout') {
    await run(env.DB, 'DELETE FROM sessions WHERE id = ?1', session.id);
    return new Response(null, { status: 303, headers: [['location', '/admin/login'], ['set-cookie', cookie('nodus_session', '', '; Max-Age=0')], ['set-cookie', cookie('nodus_csrf', '', '; Max-Age=0')]] });
  }
  if (action === 'installation-settings') {
    const name = String(form.get('name') || '').trim().slice(0, 100);
    const language = String(form.get('language') || '');
    if (!name || !['es','en','fr','de','pt','pt-BR','it','tr'].includes(language)) throw new HttpError(400, 'invalid_settings', 'The installation settings are invalid.');
    await run(env.DB, 'UPDATE installation SET name=?1,language=?2,updated_at=?3 WHERE id=1', name, language, nowIso());
    return dashboard(env, request, 'Installation settings saved.');
  }
  if (action === 'change-password') {
    await authenticateWebPassword(env, session.email, form.get('currentPassword'));
    const password = String(form.get('newPassword') || '');
    if (password.length < 12 || password !== String(form.get('confirmPassword') || '')) throw new HttpError(400, 'weak_password', 'The new passwords must match and contain at least 12 characters.');
    const record = await hashPassword(password);
    await run(env.DB, `UPDATE users SET password_hash=?1,password_salt=?2,password_scheme=?3,updated_at=?4 WHERE id=?5`, record.hash, record.salt, record.scheme, nowIso(), session.user_id);
    return dashboard(env, request, 'Your password was changed.');
  }
  if (action === 'create-space') {
    const id = randomId('spc_'); const now = nowIso();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO spaces (id,name,description,created_at,updated_at) VALUES (?1,?2,?3,?4,?4)`).bind(id, String(form.get('name') || '').trim().slice(0, 200), String(form.get('description') || '').trim().slice(0, 1000), now),
      env.DB.prepare(`INSERT INTO memberships (user_id,space_id,role,created_at,updated_at) VALUES (?1,?2,'owner',?3,?3)`).bind(session.user_id, id, now),
    ]);
    return dashboard(env, request, 'Vault destination created.');
  }
  if (action === 'create-user') {
    const email = String(form.get('email') || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'bad_email', 'Enter a valid email.');
    const password = temporaryPassword(); const record = await hashPassword(password); const id = randomId('usr_'); const now = nowIso();
    const statements = [env.DB.prepare(`INSERT INTO users (id,email,display_name,role,password_hash,password_salt,password_scheme,created_at,updated_at)
      VALUES (?1,?2,?3,'user',?4,?5,?6,?7,?7)`).bind(id, email, String(form.get('displayName') || '').slice(0, 100), record.hash, record.salt, record.scheme, now)];
    const spaceRole = ['reader', 'writer', 'owner'].includes(String(form.get('spaceRole'))) ? String(form.get('spaceRole')) : 'reader';
    if (form.get('spaceId')) statements.push(env.DB.prepare(`INSERT INTO memberships (user_id,space_id,role,created_at,updated_at) VALUES (?1,?2,?3,?4,?4)`).bind(id, String(form.get('spaceId')), spaceRole, now));
    await env.DB.batch(statements);
    return dashboard(env, request, `Account created. Temporary password: ${password}`);
  }
  if (action === 'membership') {
    const userId = String(form.get('userId') || ''); const spaceId = String(form.get('spaceId') || ''); const role = String(form.get('spaceRole') || '');
    const [user, space, current, owners] = await Promise.all([
      first(env.DB, 'SELECT id FROM users WHERE id=?1', userId), first(env.DB, 'SELECT id FROM spaces WHERE id=?1', spaceId),
      first(env.DB, 'SELECT role FROM memberships WHERE user_id=?1 AND space_id=?2', userId, spaceId),
      first(env.DB, `SELECT COUNT(*) AS count FROM memberships WHERE space_id=?1 AND role='owner'`, spaceId),
    ]);
    if (!user || !space || !['reader', 'writer', 'owner', 'remove'].includes(role)) throw new HttpError(400, 'bad_membership', 'The requested vault access is invalid.');
    if (current?.role === 'owner' && role !== 'owner' && Number(owners?.count || 0) <= 1) throw new HttpError(409, 'last_owner', 'A vault must keep at least one owner.');
    if (role === 'remove') await run(env.DB, 'DELETE FROM memberships WHERE user_id=?1 AND space_id=?2', userId, spaceId);
    else await run(env.DB, `INSERT INTO memberships (user_id,space_id,role,created_at,updated_at) VALUES (?1,?2,?3,?4,?4)
      ON CONFLICT(user_id,space_id) DO UPDATE SET role=excluded.role,updated_at=excluded.updated_at`, userId, spaceId, role, nowIso());
    return dashboard(env, request, 'Vault access updated.');
  }
  if (action === 'toggle-user') {
    const userId = String(form.get('userId') || '');
    if (!userId || userId === session.user_id) throw new HttpError(400, 'bad_user', 'You cannot disable the account currently in use.');
    const user = await first(env.DB, 'SELECT disabled_at FROM users WHERE id=?1', userId);
    if (!user) throw new HttpError(404, 'user_not_found', 'The account does not exist.');
    const disabledAt = user.disabled_at ? null : nowIso();
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET disabled_at=?1,updated_at=?2 WHERE id=?3').bind(disabledAt, nowIso(), userId),
      ...(disabledAt ? [env.DB.prepare('UPDATE device_tokens SET revoked_at=?1 WHERE user_id=?2 AND revoked_at IS NULL').bind(disabledAt, userId), env.DB.prepare('UPDATE oauth_tokens SET revoked_at=?1 WHERE user_id=?2 AND revoked_at IS NULL').bind(disabledAt, userId)] : []),
    ]);
    return dashboard(env, request, disabledAt ? 'Account disabled and its credentials revoked.' : 'Account enabled.');
  }
  if (action === 'reset-user-password') {
    const userId = String(form.get('userId') || ''); const user = await first(env.DB, 'SELECT id FROM users WHERE id=?1', userId);
    if (!user) throw new HttpError(404, 'user_not_found', 'The account does not exist.');
    const password = temporaryPassword(); const record = await hashPassword(password);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET password_hash=?1,password_salt=?2,password_scheme=?3,updated_at=?4 WHERE id=?5').bind(record.hash, record.salt, record.scheme, nowIso(), userId),
      env.DB.prepare('UPDATE sessions SET expires_at=?1 WHERE user_id=?2 AND id<>?3').bind(nowIso(), userId, session.id),
    ]);
    return dashboard(env, request, `Password reset. Temporary password: ${password}`);
  }
  if (action === 'pair') {
    const spaceId = String(form.get('spaceId') || '');
    const membership = await first(env.DB, 'SELECT role FROM memberships WHERE user_id=?1 AND space_id=?2', session.user_id, spaceId);
    if (membership?.role !== 'owner') throw new HttpError(403, 'forbidden', 'Only a vault owner can connect a publisher.');
    const value = await createPairingCode(env, session.user_id, spaceId);
    return dashboard(env, request, `Connection code: ${value.code} (valid for 15 minutes)`);
  }
  if (action === 'revoke-device') {
    await run(env.DB, 'UPDATE device_tokens SET revoked_at=?1 WHERE id=?2', nowIso(), String(form.get('deviceId') || ''));
    return dashboard(env, request, 'The device can no longer connect.');
  }
  throw new HttpError(400, 'unknown_action', 'That administration action is not supported.');
}

export async function recoveryManifest(env, request, spaceId) {
  const session = await requireAdmin(env, request);
  if (!session) return redirect(`/admin/login?return=${encodeURIComponent(new URL(request.url).pathname)}`, 302);
  const membership = await first(env.DB, 'SELECT role FROM memberships WHERE user_id=?1 AND space_id=?2', session.user_id, spaceId);
  if (!membership) throw new HttpError(403, 'forbidden', 'This account cannot recover that vault.');
  const [space, publication, counts, objects, vectors] = await Promise.all([
    first(env.DB, 'SELECT * FROM spaces WHERE id=?1', spaceId),
    first(env.DB, `SELECT * FROM publications WHERE space_id=?1 AND status='active'`, spaceId),
    all(env.DB, `SELECT table_name, COUNT(*) AS count FROM published_rows WHERE space_id=?1 AND generation=(SELECT active_generation FROM spaces WHERE id=?1) GROUP BY table_name`, spaceId),
    all(env.DB, 'SELECT hash,kind,mime,bytes,created_at FROM objects WHERE space_id=?1', spaceId),
    all(env.DB, `SELECT kind,provider,model,dimensions,vector_count,mode,created_at FROM vector_sets WHERE space_id=?1 AND generation=(SELECT active_generation FROM spaces WHERE id=?1)`, spaceId),
  ]);
  if (!space) throw new HttpError(404, 'space_not_found', 'The vault does not exist.');
  const base = new URL(request.url).origin;
  await run(env.DB, `INSERT INTO recovery_events (id,actor_user_id,space_id,kind,detail_json,created_at) VALUES (?1,?2,?3,'manifest',?4,?5)`, randomId('rec_'), session.user_id, spaceId, '{}', nowIso());
  return json({ format: 'nodus.cloudflare-recovery', formatVersion: 1, createdAt: nowIso(), space: { id: space.id, name: space.name, revision: space.revision, generation: space.active_generation, schemaVersion: space.schema_version, vault: safeJsonParse(space.vault_json, null) },
    publication: publication ? { id: publication.id, revision: publication.revision, committedAt: publication.committed_at, snapshotSha256: publication.snapshot_sha256, snapshotBytes: publication.snapshot_bytes, snapshotUrl: `${base}/api/v1/spaces/${encodeURIComponent(spaceId)}/snapshot` } : null,
    structuredData: { counts: Object.fromEntries(counts.map((row) => [row.table_name, Number(row.count)])), ndjsonPages: `${base}/admin/recovery/${encodeURIComponent(spaceId)}/rows.ndjson?after=&limit=500` },
    objects: objects.map((object) => ({ ...object, downloadUrl: `${base}/admin/recovery/${encodeURIComponent(spaceId)}/objects/${encodeURIComponent(object.kind)}/${object.hash}` })), vectors,
    recovery: { d1TimeTravel: 'https://developers.cloudflare.com/d1/reference/time-travel/', note: 'Use the portable snapshot for a complete vault restore; use the NDJSON pages for an auditable structured-data export.' } }, 200, { 'content-disposition': `attachment; filename="nodus-${spaceId}-recovery.json"` });
}

export async function recoveryObject(env, request, spaceId, kind, hash) {
  const session = await requireAdmin(env, request);
  if (!session) return redirect(`/admin/login?return=${encodeURIComponent(new URL(request.url).pathname)}`, 302);
  const membership = await first(env.DB, 'SELECT role FROM memberships WHERE user_id=?1 AND space_id=?2', session.user_id, spaceId);
  if (!membership) throw new HttpError(403, 'forbidden', 'This account cannot recover that vault.');
  if (!RECOVERY_OBJECT_KINDS.has(kind)) throw new HttpError(400, 'bad_purpose', 'The recovery object kind is invalid.');
  return getObject(env, spaceId, hash, request, kind);
}

export async function recoveryRows(env, request, spaceId) {
  const session = await requireAdmin(env, request);
  if (!session) return redirect(`/admin/login?return=${encodeURIComponent(new URL(request.url).pathname + new URL(request.url).search)}`, 302);
  const membership = await first(env.DB, 'SELECT role FROM memberships WHERE user_id=?1 AND space_id=?2', session.user_id, spaceId);
  if (!membership) throw new HttpError(403, 'forbidden', 'This account cannot recover that vault.');
  const url = new URL(request.url); const after = String(url.searchParams.get('after') || ''); const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') || 500)));
  const rows = await all(env.DB, `SELECT table_name,row_key,row_json FROM published_rows WHERE space_id=?1
    AND generation=(SELECT active_generation FROM spaces WHERE id=?1) AND (table_name || char(0) || row_key) > ?2
    ORDER BY table_name,row_key LIMIT ?3`, spaceId, after, limit + 1);
  const selected = rows.slice(0, limit); const next = rows.length > limit ? `${selected.at(-1).table_name}\0${selected.at(-1).row_key}` : null;
  const resolved = await resolvePublishedRows(env, spaceId, selected);
  const lines = selected.map((row, index) => JSON.stringify({ table: row.table_name, key: row.row_key, row: resolved[index] }));
  lines.push(JSON.stringify({ _meta: { next, complete: next === null } }));
  return new Response(`${lines.join('\n')}\n`, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'content-disposition': `attachment; filename="nodus-${spaceId}-rows.ndjson"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

async function requireRecoveryKey(env, request) {
  if (!await strictRateLimit(env, 'recovery', clientAddress(request), 10_000, 15 * 60_000)) throw new HttpError(429, 'rate_limited', 'Try recovery again later.');
  const match = /^Recovery\s+(.+)$/i.exec(request.headers.get('authorization') || '');
  const installationId = String(request.headers.get('x-nodus-installation-id') || '');
  if (!match?.[1] || !installationId) throw new HttpError(401, 'recovery_credentials_required', 'The recovery key and installation id are required.');
  const object = await env.OBJECTS.get(`recovery/${installationId}.json`);
  const record = object ? safeJsonParse(await object.text(), null) : null;
  const supplied = await sha256Hex(match[1].trim());
  if (!record?.recoveryHash || !constantTimeEqual(supplied, record.recoveryHash)) throw new HttpError(401, 'invalid_recovery_key', 'The recovery key is invalid.');
  return { installationId, administrator: record.administrator };
}

export async function recoveryKeyIndex(env, request) {
  const recovery = await requireRecoveryKey(env, request);
  const installation = await first(env.DB, 'SELECT installation_id,name,worker_version,created_at FROM installation WHERE id=1');
  if (!installation || installation.installation_id !== recovery.installationId) throw new HttpError(401, 'invalid_recovery_key', 'The recovery key does not belong to this installation.');
  const spaces = await all(env.DB, `SELECT s.id,s.name,s.revision,s.schema_version,s.active_generation,p.snapshot_sha256,p.snapshot_bytes,p.committed_at
    FROM spaces s LEFT JOIN publications p ON p.space_id=s.id AND p.generation=s.active_generation ORDER BY s.name`);
  const base = new URL(request.url).origin;
  return json({ format: 'nodus.cloudflare-recovery-index', formatVersion: 1, createdAt: nowIso(), installation,
    spaces: spaces.map((space) => ({ ...space, manifestUrl: `${base}/recovery/${encodeURIComponent(space.id)}/manifest.json`, rowsUrl: `${base}/recovery/${encodeURIComponent(space.id)}/rows.ndjson`, snapshotUrl: `${base}/recovery/${encodeURIComponent(space.id)}/snapshot` })) }, 200, { 'cache-control': 'no-store' });
}

async function recoverySpace(env, request, spaceId) {
  await requireRecoveryKey(env, request);
  const space = await first(env.DB, 'SELECT * FROM spaces WHERE id=?1', spaceId);
  if (!space) throw new HttpError(404, 'space_not_found', 'The vault does not exist.');
  return space;
}

export async function recoveryKeyManifest(env, request, spaceId) {
  const space = await recoverySpace(env, request, spaceId);
  const [publication, counts, objects, vectors] = await Promise.all([
    first(env.DB, 'SELECT * FROM publications WHERE space_id=?1 AND generation=?2', spaceId, space.active_generation),
    all(env.DB, 'SELECT table_name,COUNT(*) AS count FROM published_rows WHERE space_id=?1 AND generation=?2 GROUP BY table_name', spaceId, space.active_generation),
    all(env.DB, 'SELECT hash,kind,mime,bytes FROM objects WHERE space_id=?1', spaceId),
    all(env.DB, 'SELECT kind,provider,model,dimensions,vector_count,mode FROM vector_sets WHERE space_id=?1 AND generation=?2', spaceId, space.active_generation),
  ]);
  const base = new URL(request.url).origin;
  return json({ format: 'nodus.cloudflare-recovery', formatVersion: 1, createdAt: nowIso(), space: { id: space.id, name: space.name, revision: space.revision, generation: space.active_generation, schemaVersion: space.schema_version, vault: safeJsonParse(space.vault_json, null) },
    publication: publication ? { revision: publication.revision, snapshotSha256: publication.snapshot_sha256, snapshotBytes: publication.snapshot_bytes } : null,
    structuredData: { counts: Object.fromEntries(counts.map((row) => [row.table_name, Number(row.count)])) },
    objects: objects.map((object) => ({ ...object, downloadUrl: `${base}/recovery/${encodeURIComponent(spaceId)}/objects/${encodeURIComponent(object.kind)}/${object.hash}` })), vectors }, 200, { 'cache-control': 'no-store' });
}

export async function recoveryKeyObject(env, request, spaceId, kind, hash) {
  await recoverySpace(env, request, spaceId);
  if (!RECOVERY_OBJECT_KINDS.has(kind)) throw new HttpError(400, 'bad_purpose', 'The recovery object kind is invalid.');
  return getObject(env, spaceId, hash, request, kind);
}

export async function recoveryKeyRows(env, request, spaceId) {
  const space = await recoverySpace(env, request, spaceId);
  const url = new URL(request.url); const after = String(url.searchParams.get('after') || ''); const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') || 500)));
  const rows = await all(env.DB, `SELECT table_name,row_key,row_json FROM published_rows WHERE space_id=?1 AND generation=?2
    AND (table_name || char(0) || row_key)>?3 ORDER BY table_name,row_key LIMIT ?4`, spaceId, space.active_generation, after, limit + 1);
  const selected = rows.slice(0, limit); const next = rows.length > limit ? `${selected.at(-1).table_name}\0${selected.at(-1).row_key}` : null;
  const resolved = await resolvePublishedRows(env, spaceId, selected);
  return new Response(`${selected.map((row, index) => JSON.stringify({ table: row.table_name, key: row.row_key, row: resolved[index] })).concat(JSON.stringify({ _meta: { next, complete: next === null } })).join('\n')}\n`, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="nodus-${spaceId}-rows.ndjson"` } });
}

export async function recoveryKeySnapshot(env, request, spaceId) {
  const space = await recoverySpace(env, request, spaceId);
  const publication = await first(env.DB, 'SELECT * FROM publications WHERE space_id=?1 AND generation=?2', spaceId, space.active_generation);
  if (!publication?.snapshot_key) throw new HttpError(404, 'snapshot_not_found', 'This vault has no portable snapshot.');
  const object = await env.OBJECTS.get(publication.snapshot_key); if (!object) throw new HttpError(503, 'snapshot_unavailable', 'The snapshot object is unavailable.');
  return new Response(object.body, { headers: { 'content-type': 'application/vnd.nodus.snapshot+json', 'content-encoding': publicationManifestEncoding(publication), 'etag': `"${publication.snapshot_sha256}"`, 'cache-control': 'no-store', 'content-disposition': `attachment; filename="nodus-${spaceId}-snapshot.json"` } });
}

function publicationManifestEncoding(publication) {
  return safeJsonParse(publication.manifest_json, {})?.snapshot?.contentEncoding === 'gzip' ? 'gzip' : 'identity';
}
