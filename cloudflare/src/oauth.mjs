import {
  HttpError,
  all,
  first,
  html,
  json,
  nowIso,
  randomId,
  readForm,
  readJson,
  redirect,
  run,
  safeJsonParse,
  sha256Base64Url,
  sha256Hex,
  strictRateLimit,
  clientAddress,
} from './util.mjs';
import { issueOAuthTokens, requireCsrf, sessionUser } from './auth.mjs';

const SCOPES = new Set(['materials.read', 'materials.write']);
const CODE_TTL_MS = 10 * 60_000;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function origin(request) {
  return new URL(request.url).origin;
}

function metadata(request) {
  const base = origin(request);
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    scopes_supported: [...SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  };
}

export function authorizationServerMetadata(request) {
  return json(metadata(request), 200, { 'access-control-allow-origin': '*' });
}

export function protectedResourceMetadata(request, resource = 'mcp') {
  const base = origin(request);
  const resourceUrl = resource === 'mcp' ? `${base}/mcp` : `${base}/api/v1`;
  return json({ resource: resourceUrl, authorization_servers: [base], scopes_supported: [...SCOPES], bearer_methods_supported: ['header'] }, 200, { 'access-control-allow-origin': '*' });
}

function validRedirect(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || ((url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.protocol === 'http:');
  } catch { return false; }
}

export async function registerClient(env, request) {
  if (!await strictRateLimit(env, 'oauth-register', clientAddress(request), 20, 15 * 60_000)) throw new HttpError(429, 'rate_limited', 'Try registering the client again later.');
  const input = await readJson(request, 64 * 1024);
  const redirects = Array.isArray(input.redirect_uris) ? [...new Set(input.redirect_uris.map(String))] : [];
  if (!redirects.length || redirects.length > 10 || redirects.some((entry) => !validRedirect(entry))) {
    throw new HttpError(400, 'invalid_redirect_uri', 'Use HTTPS redirect addresses, or localhost for a desktop callback.');
  }
  if (input.token_endpoint_auth_method && input.token_endpoint_auth_method !== 'none') throw new HttpError(400, 'invalid_client_metadata', 'Nodus supports public PKCE clients only.');
  const id = randomId('client_');
  const name = String(input.client_name || 'MCP client').trim().slice(0, 120) || 'MCP client';
  await run(env.DB, 'INSERT INTO oauth_clients (id, name, redirect_uris_json, created_at) VALUES (?1, ?2, ?3, ?4)', id, name, JSON.stringify(redirects), nowIso());
  return json({ client_id: id, client_name: name, redirect_uris: redirects, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }, 201);
}

async function authorizationInput(env, request, params) {
  const clientId = String(params.get('client_id') || '');
  const client = await first(env.DB, 'SELECT * FROM oauth_clients WHERE id = ?1', clientId);
  const redirectUri = String(params.get('redirect_uri') || '');
  const scopes = String(params.get('scope') || 'materials.read').split(/\s+/).filter(Boolean);
  const resource = String(params.get('resource') || `${origin(request)}/mcp`);
  const challenge = String(params.get('code_challenge') || '');
  if (!client || params.get('response_type') !== 'code' || !safeJsonParse(client.redirect_uris_json, []).includes(redirectUri)
      || !scopes.length || scopes.some((scope) => !SCOPES.has(scope))
      || ![`${origin(request)}/mcp`, `${origin(request)}/api/v1`].includes(resource)
      || params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) {
    throw new HttpError(400, 'invalid_request', 'The OAuth request is invalid or incomplete.');
  }
  return { client, clientId, redirectUri, scope: [...new Set(scopes)].join(' '), resource, challenge, state: String(params.get('state') || '') };
}

export async function authorizePage(env, request) {
  const url = new URL(request.url);
  const input = await authorizationInput(env, request, url.searchParams);
  const session = await sessionUser(env, request);
  if (!session) return redirect(`/admin/login?return=${encodeURIComponent(url.pathname + url.search)}`, 302);
  const csrf = safeJsonParse(JSON.stringify({ value: request.headers.get('cookie') }), {}) && /(?:^|;\s*)nodus_csrf=([^;]+)/.exec(request.headers.get('cookie') || '')?.[1];
  if (!csrf) return redirect(`/admin/login?return=${encodeURIComponent(url.pathname + url.search)}`, 302);
  return html(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect ${escapeHtml(input.client.name)}</title>
  <style>body{font:16px system-ui;max-width:620px;margin:10vh auto;padding:24px;color:#18201d}main{border:1px solid #dce3df;border-radius:18px;padding:28px}button{background:#176b4d;color:white;border:0;border-radius:10px;padding:12px 18px;font-weight:700}code{background:#f3f5f4;padding:2px 5px;border-radius:5px}</style>
  <main><h1>Connect ${escapeHtml(input.client.name)}?</h1><p>This application will be able to consult only the Nodus vaults assigned to <strong>${escapeHtml(session.email)}</strong>.</p>
  <p>Requested permission: <code>${escapeHtml(input.scope)}</code>. Your original local vault and Cloudflare credentials are never shared with the client.</p>
  <form method="post" action="/oauth/authorize">${[...url.searchParams].map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`).join('')}
  <input type="hidden" name="csrf" value="${escapeHtml(decodeURIComponent(csrf))}"><button name="decision" value="allow">Allow connection</button> <button name="decision" value="deny" style="background:#68736f">Cancel</button></form></main></html>`);
}

export async function authorizeDecision(env, request) {
  const form = await readForm(request);
  const input = await authorizationInput(env, request, form);
  const session = await sessionUser(env, request);
  await requireCsrf(env, request, session, form.get('csrf'));
  const destination = new URL(input.redirectUri);
  if (input.state) destination.searchParams.set('state', input.state);
  if (form.get('decision') !== 'allow') {
    destination.searchParams.set('error', 'access_denied');
    return redirect(destination.toString(), 302);
  }
  const code = `${randomId('code_')}${randomId().replaceAll('-', '')}`;
  await run(env.DB, `INSERT INTO oauth_codes
    (code_hash, client_id, user_id, redirect_uri, scope, resource, code_challenge, expires_at, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`, await sha256Hex(code), input.clientId, session.user_id,
  input.redirectUri, input.scope, input.resource, input.challenge, new Date(Date.now() + CODE_TTL_MS).toISOString(), nowIso());
  destination.searchParams.set('code', code);
  return redirect(destination.toString(), 302);
}

export async function tokenEndpoint(env, request) {
  const form = await readForm(request);
  const grant = form.get('grant_type');
  const clientId = String(form.get('client_id') || '');
  if (grant === 'authorization_code') {
    const codeHash = await sha256Hex(String(form.get('code') || ''));
    const row = await first(env.DB, 'SELECT * FROM oauth_codes WHERE code_hash = ?1', codeHash);
    if (!row || row.client_id !== clientId || row.redirect_uri !== String(form.get('redirect_uri') || '') || row.consumed_at || Date.parse(row.expires_at) <= Date.now()) {
      throw new HttpError(400, 'invalid_grant', 'The authorization code is invalid or expired.');
    }
    if (await sha256Base64Url(String(form.get('code_verifier') || '')) !== row.code_challenge) throw new HttpError(400, 'invalid_grant', 'PKCE verification failed.');
    const consumed = await run(env.DB, 'UPDATE oauth_codes SET consumed_at = ?1 WHERE code_hash = ?2 AND consumed_at IS NULL', nowIso(), codeHash);
    if (!Number(consumed?.meta?.changes || 0)) throw new HttpError(400, 'invalid_grant', 'The authorization code was already used.');
    return json(await issueOAuthTokens(env, { clientId, userId: row.user_id, scope: row.scope, resource: row.resource }));
  }
  if (grant === 'refresh_token') {
    const refreshHash = await sha256Hex(String(form.get('refresh_token') || ''));
    const row = await first(env.DB, 'SELECT * FROM oauth_tokens WHERE refresh_hash = ?1', refreshHash);
    if (!row || row.client_id !== clientId || row.revoked_at || !row.refresh_expires_at || Date.parse(row.refresh_expires_at) <= Date.now()) {
      throw new HttpError(400, 'invalid_grant', 'The refresh token is invalid or expired.');
    }
    const revoked = await run(env.DB, 'UPDATE oauth_tokens SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL', nowIso(), row.id);
    if (!Number(revoked?.meta?.changes || 0)) throw new HttpError(400, 'invalid_grant', 'The refresh token was already rotated.');
    return json(await issueOAuthTokens(env, { clientId, userId: row.user_id, scope: row.scope, resource: row.resource }));
  }
  throw new HttpError(400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

export async function oauthCleanup(env) {
  await run(env.DB, 'DELETE FROM oauth_codes WHERE expires_at < ?1', nowIso());
}
