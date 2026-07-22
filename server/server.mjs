import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Store, digest, token } from './lib/store.mjs';
import { body, cookies, escapeHtml, form, html, json, jsonBody, redirect } from './lib/http.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.NODUS_DATA_DIR || path.join(ROOT, 'data');
const PORT = Number(process.env.NODUS_PORT || 7443);
const HOST = process.env.NODUS_HOST || '0.0.0.0';
const SETUP_TOKEN = process.env.NODUS_SETUP_TOKEN || '';
const MAX_SNAPSHOT_BYTES = Number(process.env.NODUS_MAX_SNAPSHOT_BYTES || 100 * 1024 * 1024);
const store = new Store(DATA_DIR);
const snapshotCache = new Map();
const rateBuckets = new Map();
const SCOPES = new Set(['profile', 'spaces.read', 'materials.read']);
const MCP_PROTOCOLS = new Set(['2025-11-25', '2025-06-18', '2025-03-26']);

function normalizePublicUrl(value) {
  const parsed = new URL(String(value));
  const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) throw new Error('La URL pública debe utilizar HTTPS.');
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) throw new Error('La URL pública debe ser solo el dominio o subdominio, sin ruta ni credenciales.');
  return parsed.origin;
}

function publicUrl() {
  return normalizePublicUrl(process.env.NODUS_PUBLIC_URL || store.state.settings.publicUrl || `http://localhost:${PORT}`);
}

function mcpResource() {
  return `${publicUrl()}/mcp`;
}

function page(title, content) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Nodus Server</title><style>
  :root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#e5e7eb;background:#09090b}body{max-width:920px;margin:0 auto;padding:40px 20px}a{color:#a5b4fc}h1,h2{color:#fff}.card{background:#18181b;border:1px solid #303038;border-radius:14px;padding:20px;margin:16px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}label{display:block;margin:12px 0 5px;color:#d4d4d8}input,select{box-sizing:border-box;width:100%;padding:10px;border-radius:8px;border:1px solid #3f3f46;background:#09090b;color:#fff}button{margin-top:14px;border:0;border-radius:8px;padding:10px 14px;background:#4f46e5;color:white;font-weight:600;cursor:pointer}.secondary{background:#27272a}.muted{color:#a1a1aa;font-size:.9rem}.ok{color:#6ee7b7}.warn{color:#fbbf24}code{background:#27272a;padding:2px 5px;border-radius:5px;word-break:break-all}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #303038;padding:9px 5px}</style></head><body>${content}</body></html>`;
}

function sessionFor(req) {
  return store.session(cookies(req).nodus_session);
}

function requireSession(req, res, admin = false) {
  const current = sessionFor(req);
  if (!current || (admin && current.user.role !== 'admin')) {
    redirect(res, `/login?next=${encodeURIComponent(req.url || '/')}`);
    return null;
  }
  return current;
}

function checkCsrf(current, value) {
  const actual = Buffer.from(String(value ?? ''));
  const wanted = Buffer.from(current.session.csrf);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function bearer(req) {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((value) => value.trim()).filter(Boolean);
  // Nodus Server is bound to loopback by the Docker recipe. The final address is
  // the one appended by a trusted local reverse proxy, so a client cannot choose it.
  return forwarded.at(-1) || req.socket.remoteAddress || 'unknown';
}

function rateLimit(req, res, key, limit, windowMs) {
  const now = Date.now();
  const bucketKey = `${key}:${clientIp(req)}`;
  let bucket = rateBuckets.get(bucketKey);
  if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  rateBuckets.set(bucketKey, bucket);
  if (rateBuckets.size > 10_000) {
    for (const [candidate, value] of rateBuckets) if (value.resetAt <= now) rateBuckets.delete(candidate);
  }
  if (bucket.count <= limit) return true;
  json(res, 429, { error: 'rate_limited', error_description: 'Demasiados intentos. Espera unos minutos.' }, {
    'retry-after': String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))),
  });
  return false;
}

function validRedirectUri(value) {
  try {
    const parsed = new URL(String(value));
    if (parsed.username || parsed.password || parsed.hash) return false;
    if (parsed.protocol === 'https:') return true;
    return parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function membership(userId, spaceId) {
  return store.state.memberships.find((entry) => entry.userId === userId && entry.spaceId === spaceId) ?? null;
}

function oauthAccess(req, neededScope = 'materials.read') {
  const raw = bearer(req);
  if (!raw) return null;
  store.cleanup();
  const entry = store.state.accessTokens.find((candidate) => candidate.hash === digest(raw));
  if (!entry || entry.resource !== mcpResource() || !entry.scopes.includes(neededScope)) return null;
  const user = store.state.users.find((candidate) => candidate.id === entry.userId);
  return user ? { token: entry, user } : null;
}

function oauthChallenge(res, scope = 'materials.read') {
  const metadata = `${publicUrl()}/.well-known/oauth-protected-resource`;
  json(res, 401, { error: 'unauthorized', error_description: 'Inicia sesión en Nodus para continuar.' }, {
    'www-authenticate': `Bearer resource_metadata="${metadata}", scope="${scope}"`,
  });
}

function readSnapshot(spaceId) {
  const target = store.snapshotPath(spaceId);
  if (!fs.existsSync(target)) return null;
  const stat = fs.statSync(target);
  const cached = snapshotCache.get(spaceId);
  if (cached?.mtimeMs === stat.mtimeMs) return cached.value;
  const value = JSON.parse(gunzipSync(fs.readFileSync(target), { maxOutputLength: MAX_SNAPSHOT_BYTES }).toString('utf8'));
  snapshotCache.set(spaceId, { mtimeMs: stat.mtimeMs, value });
  return value;
}

function rows(snapshot, table) {
  const value = snapshot?.tables?.[table];
  return Array.isArray(value) ? value : [];
}

function userSpaces(userId) {
  const ids = new Set(store.state.memberships.filter((entry) => entry.userId === userId).map((entry) => entry.spaceId));
  return store.state.spaces.filter((space) => ids.has(space.id));
}

const TOOLS = [
  { name: 'nodus_list_spaces', title: 'List Nodus spaces', description: 'Lists the shared Nodus spaces the authenticated user can read.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'nodus_get_space_summary', title: 'Get space summary', description: 'Returns counts and publication metadata for one authorized Nodus space.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' } }, required: ['spaceId'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'nodus_search', title: 'Search Nodus', description: 'Searches works, ideas, themes, gaps, notes and passages in one authorized shared space.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['spaceId', 'query'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'nodus_get_work', title: 'Get work', description: 'Gets one shared bibliographic work by its Nodus id.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, id: { type: 'string' } }, required: ['spaceId', 'id'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'nodus_get_idea', title: 'Get idea', description: 'Gets one shared idea and its direct relations.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, id: { type: 'string' } }, required: ['spaceId', 'id'], additionalProperties: false }, annotations: { readOnlyHint: true } },
];

for (const tool of TOOLS) tool.securitySchemes = [{ type: 'oauth2', scopes: ['materials.read'] }];

function toolResult(value, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value, ...(isError ? { isError: true } : {}) };
}

function callTool(auth, name, args) {
  if (name === 'nodus_list_spaces') return toolResult({ spaces: userSpaces(auth.user.id).map(({ id, name, description, updatedAt }) => ({ id, name, description, updatedAt })) });
  const spaceId = typeof args?.spaceId === 'string' ? args.spaceId : '';
  const space = store.state.spaces.find((entry) => entry.id === spaceId);
  if (!space || !membership(auth.user.id, spaceId)) return toolResult({ error: 'No tienes acceso a ese espacio.' }, true);
  const snapshot = readSnapshot(spaceId);
  if (!snapshot) return toolResult({ error: 'Este espacio todavía no ha recibido una publicación.' }, true);
  if (name === 'nodus_get_space_summary') {
    return toolResult({ space: { id: space.id, name: space.name, description: space.description, updatedAt: space.updatedAt }, vault: snapshot.vault, generatedAt: snapshot.generatedAt, counts: Object.fromEntries(Object.entries(snapshot.tables ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])) });
  }
  if (name === 'nodus_search') {
    const query = String(args.query ?? '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(50, Number(args.limit) || 20));
    if (!query) return toolResult({ results: [] });
    const definitions = [
      ['works', ['title', 'abstract', 'citation']], ['ideas', ['label', 'statement']], ['themes', ['label', 'description']],
      ['gaps', ['text', 'description']], ['notes', ['title', 'content']], ['passages', ['text']],
    ];
    const results = [];
    for (const [table, fields] of definitions) {
      for (const row of rows(snapshot, table)) {
        const text = fields.map((field) => row[field]).filter((value) => typeof value === 'string').join('\n');
        if (text.toLowerCase().includes(query)) results.push({ type: table, id: row.id ?? row.nodus_id ?? row.global_id ?? row.passage_id, title: row.title ?? row.label ?? text.slice(0, 120), excerpt: text.slice(0, 600) });
        if (results.length >= limit) return toolResult({ results });
      }
    }
    return toolResult({ results });
  }
  if (name === 'nodus_get_work') {
    const work = rows(snapshot, 'works').find((entry) => String(entry.nodus_id ?? entry.id) === String(args.id));
    return work ? toolResult({ work }) : toolResult({ error: 'Obra no encontrada.' }, true);
  }
  if (name === 'nodus_get_idea') {
    const idea = rows(snapshot, 'ideas').find((entry) => String(entry.global_id ?? entry.id) === String(args.id));
    if (!idea) return toolResult({ error: 'Idea no encontrada.' }, true);
    const id = String(idea.global_id ?? idea.id);
    const relations = rows(snapshot, 'edges').filter((entry) => String(entry.from_id) === id || String(entry.to_id) === id);
    return toolResult({ idea, relations });
  }
  return toolResult({ error: 'Herramienta desconocida.' }, true);
}

async function handleMcp(req, res) {
  const auth = oauthAccess(req);
  if (!auth) return oauthChallenge(res);
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' }, { allow: 'POST' });
  const request = await jsonBody(req, 2 * 1024 * 1024);
  if (request.method === 'notifications/initialized') return json(res, 202, {});
  let result;
  let protocolVersion = MCP_PROTOCOLS.has(req.headers['mcp-protocol-version']) ? req.headers['mcp-protocol-version'] : '2025-11-25';
  if (request.method === 'initialize') {
    protocolVersion = MCP_PROTOCOLS.has(request.params?.protocolVersion) ? request.params.protocolVersion : '2025-11-25';
    result = { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'nodus-server', version: '0.1.0', description: 'Read-only access to explicitly shared Nodus academic spaces.' }, instructions: 'Consult only spaces authorized for this user. Use nodus_list_spaces before querying a space. Shared data is read-only.' };
  } else if (request.method === 'tools/list') result = { tools: TOOLS };
  else if (request.method === 'tools/call') result = callTool(auth, request.params?.name, request.params?.arguments ?? {});
  else return json(res, 200, { jsonrpc: '2.0', id: request.id ?? null, error: { code: -32601, message: 'Method not found' } });
  return json(res, 200, { jsonrpc: '2.0', id: request.id ?? null, result }, { 'mcp-protocol-version': protocolVersion });
}

function setupPage(error = '') {
  return page('Configuración inicial', `<h1>Configurar Nodus Server</h1><p class="muted">Haz esta configuración antes de publicar el servidor en Internet.</p>${error ? `<p class="warn">${escapeHtml(error)}</p>` : ''}<form class="card" method="post" action="/setup"><label>Código de instalación</label><input name="setupToken" type="password" required><label>Nombre del servidor</label><input name="name" value="Nodus Server" required><label>URL pública</label><input name="publicUrl" placeholder="https://nodus.ejemplo.es" required><label>Correo del administrador</label><input name="email" type="email" required><label>Contraseña del administrador</label><input name="password" type="password" minlength="12" required><button>Crear servidor</button></form>`);
}

function loginPage(next = '/', error = '') {
  return page('Entrar', `<h1>Entrar en Nodus Server</h1>${error ? `<p class="warn">${escapeHtml(error)}</p>` : ''}<form class="card" method="post" action="/login"><input type="hidden" name="next" value="${escapeHtml(next)}"><label>Correo</label><input name="email" type="email" required><label>Contraseña</label><input name="password" type="password" required><button>Entrar</button></form>`);
}

function dashboard(current, notice = '') {
  const spaces = store.state.spaces.map((space) => `<tr><td>${escapeHtml(space.name)}</td><td><code>${space.id}</code></td><td>${escapeHtml(space.updatedAt || 'Sin publicar')}</td><td><form method="post" action="/admin/pairing"><input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="spaceId" value="${space.id}"><button class="secondary">Crear código para Nodus</button></form>${space.updatedAt ? `<form method="post" action="/admin/spaces/clear-request"><input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="spaceId" value="${space.id}"><button class="secondary">Borrar publicación</button></form>` : ''}</td></tr>`).join('');
  const spaceOptions = store.state.spaces.map((space) => `<option value="${space.id}">${escapeHtml(space.name)}</option>`).join('');
  const users = store.state.users.map((user) => {
    const access = store.state.memberships.filter((entry) => entry.userId === user.id).map((entry) => {
      const space = store.state.spaces.find((candidate) => candidate.id === entry.spaceId);
      const remove = entry.role === 'owner' ? '' : `<form method="post" action="/admin/access/revoke" style="display:inline"><input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="userId" value="${user.id}"><input type="hidden" name="spaceId" value="${entry.spaceId}"><button class="secondary" title="Revocar acceso">×</button></form>`;
      return `<div>${escapeHtml(space?.name || entry.spaceId)} · ${escapeHtml(entry.role)} ${remove}</div>`;
    }).join('') || '—';
    const grant = user.role === 'admin' || !spaceOptions ? '' : `<form method="post" action="/admin/access/grant"><input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="userId" value="${user.id}"><select name="spaceId">${spaceOptions}</select><button class="secondary">Dar acceso lector</button></form>`;
    return `<tr><td>${escapeHtml(user.email)}</td><td>${escapeHtml(user.role)}</td><td>${access}</td><td>${grant}</td></tr>`;
  }).join('');
  const devices = store.state.deviceTokens.map((device) => {
    const space = store.state.spaces.find((entry) => entry.id === device.spaceId);
    return `<tr><td>${escapeHtml(device.deviceName)}</td><td>${escapeHtml(space?.name || device.spaceId)}</td><td>${escapeHtml(device.lastUsedAt || 'Nunca')}</td><td><form method="post" action="/admin/devices/revoke"><input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="tokenHash" value="${device.hash}"><button class="secondary">Revocar</button></form></td></tr>`;
  }).join('');
  return page('Administración', `<div style="display:flex;gap:16px;align-items:center"><h1 style="flex:1">${escapeHtml(store.state.settings.name)}</h1><form method="post" action="/logout"><input type="hidden" name="csrf" value="${current.session.csrf}"><button class="secondary">Salir</button></form></div><p class="muted">URL MCP: <code>${escapeHtml(mcpResource())}</code></p>${notice ? `<p class="ok">${escapeHtml(notice)}</p>` : ''}<div class="grid"><form class="card" method="post" action="/admin/spaces"><h2>Nuevo espacio</h2><input type="hidden" name="csrf" value="${current.session.csrf}"><label>Nombre</label><input name="name" required><label>Descripción</label><input name="description"><button>Crear espacio</button></form><form class="card" method="post" action="/admin/users"><h2>Nuevo usuario</h2><input type="hidden" name="csrf" value="${current.session.csrf}"><label>Correo</label><input name="email" type="email" required><label>Contraseña temporal</label><input name="password" type="password" minlength="12" required><label>Espacio</label><select name="spaceId">${spaceOptions}</select><button>Crear usuario lector</button></form></div><div class="card"><h2>Espacios</h2><table><tr><th>Nombre</th><th>ID</th><th>Última publicación</th><th></th></tr>${spaces || '<tr><td colspan="4">Todavía no hay espacios.</td></tr>'}</table></div><div class="card"><h2>Usuarios y acceso</h2><p class="muted">La versión actual publica herramientas MCP de consulta. No expone calificaciones ni escritura remota.</p><table><tr><th>Correo</th><th>Cuenta</th><th>Acceso</th><th>Añadir</th></tr>${users}</table></div><div class="card"><h2>Dispositivos publicadores</h2><table><tr><th>Dispositivo</th><th>Espacio</th><th>Último uso</th><th></th></tr>${devices || '<tr><td colspan="4">No hay dispositivos emparejados.</td></tr>'}</table></div>`);
}

async function route(req, res) {
  const url = new URL(req.url || '/', publicUrl());
  if (url.pathname === '/healthz') return json(res, 200, { ok: true, service: 'nodus-server', version: '0.1.0' });
  if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp') return json(res, 200, { resource: mcpResource(), authorization_servers: [publicUrl()], scopes_supported: [...SCOPES], resource_documentation: `${publicUrl()}/` });
  if (url.pathname === '/.well-known/oauth-authorization-server' || url.pathname === '/.well-known/openid-configuration') return json(res, 200, { issuer: publicUrl(), authorization_endpoint: `${publicUrl()}/oauth/authorize`, token_endpoint: `${publicUrl()}/oauth/token`, registration_endpoint: `${publicUrl()}/oauth/register`, code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], scopes_supported: [...SCOPES] });
  if (url.pathname === '/mcp') return handleMcp(req, res);

  if (store.state.users.length === 0) {
    if (url.pathname !== '/setup') return redirect(res, '/setup');
    if (req.method === 'GET') return html(res, 200, setupPage());
    if (!rateLimit(req, res, 'setup', 10, 15 * 60_000)) return;
    const values = await form(req);
    try {
      if (!SETUP_TOKEN || SETUP_TOKEN.length < 16 || values.setupToken !== SETUP_TOKEN) throw new Error('El código de instalación no es válido.');
      store.state.settings = { name: String(values.name).trim(), publicUrl: normalizePublicUrl(values.publicUrl) };
      const user = store.createUser(values.email, values.password, 'admin');
      const raw = store.createSession(user.id);
      return redirect(res, '/', { 'set-cookie': `nodus_session=${encodeURIComponent(raw)}; Path=/; HttpOnly; SameSite=Lax${publicUrl().startsWith('https://') ? '; Secure' : ''}` });
    } catch (error) { return html(res, 400, setupPage(error instanceof Error ? error.message : String(error))); }
  }

  if (url.pathname === '/login') {
    if (req.method === 'GET') return html(res, 200, loginPage(url.searchParams.get('next') || '/'));
    if (!rateLimit(req, res, 'login', 12, 15 * 60_000)) return;
    const values = await form(req);
    const user = store.authenticate(values.email, values.password);
    if (!user) return html(res, 401, loginPage(values.next || '/', 'Correo o contraseña incorrectos.'));
    const raw = store.createSession(user.id);
    const next = String(values.next || '/');
    return redirect(res, next.startsWith('/') && !next.startsWith('//') ? next : '/', { 'set-cookie': `nodus_session=${encodeURIComponent(raw)}; Path=/; HttpOnly; SameSite=Lax${publicUrl().startsWith('https://') ? '; Secure' : ''}` });
  }

  if (url.pathname === '/oauth/register' && req.method === 'POST') {
    if (!rateLimit(req, res, 'oauth-register', 30, 60 * 60_000)) return;
    const input = await jsonBody(req);
    const redirects = Array.isArray(input.redirect_uris) ? [...new Set(input.redirect_uris.filter((value) => typeof value === 'string' && validRedirectUri(value)))].slice(0, 10) : [];
    if (redirects.length === 0) return json(res, 400, { error: 'invalid_redirect_uri' });
    const client = { client_id: `client_${token(18)}`, client_name: String(input.client_name || 'MCP client').slice(0, 120), redirect_uris: redirects, createdAt: new Date().toISOString() };
    store.state.oauthClients.push(client); store.save();
    return json(res, 201, { ...client, token_endpoint_auth_method: 'none' });
  }

  if (url.pathname === '/oauth/authorize' && req.method === 'GET') {
    const current = sessionFor(req);
    if (!current) return redirect(res, `/login?next=${encodeURIComponent(req.url || '/')}`);
    const client = store.state.oauthClients.find((entry) => entry.client_id === url.searchParams.get('client_id'));
    const redirectUri = url.searchParams.get('redirect_uri') || '';
    const resource = url.searchParams.get('resource') || mcpResource();
    if (!client || !client.redirect_uris.includes(redirectUri) || resource !== mcpResource() || url.searchParams.get('response_type') !== 'code' || url.searchParams.get('code_challenge_method') !== 'S256') return html(res, 400, page('OAuth', '<h1>Solicitud OAuth no válida</h1>'));
    const requestedInput = (url.searchParams.get('scope') || 'profile spaces.read materials.read').split(/\s+/).filter((scope) => SCOPES.has(scope));
    const requested = requestedInput.length > 0 ? requestedInput : ['materials.read'];
    const hidden = [...url.searchParams].map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`).join('');
    return html(res, 200, page('Autorizar', `<h1>Conectar ${escapeHtml(client.client_name)}</h1><div class="card"><p>La aplicación podrá:</p><ul>${requested.map((scope) => `<li>${escapeHtml(scope)}</li>`).join('')}</ul><p class="muted">Solo tendrá acceso a los espacios asignados a ${escapeHtml(current.user.email)}.</p><form method="post" action="/oauth/authorize">${hidden}<input type="hidden" name="csrf" value="${current.session.csrf}"><button>Autorizar</button></form></div>`));
  }

  if (url.pathname === '/oauth/authorize' && req.method === 'POST') {
    const current = requireSession(req, res); if (!current) return;
    const values = await form(req);
    if (!checkCsrf(current, values.csrf)) return html(res, 403, page('Error', '<h1>La sesión ha caducado.</h1>'));
    const client = store.state.oauthClients.find((entry) => entry.client_id === values.client_id);
    if (!client || !client.redirect_uris.includes(values.redirect_uri) || values.code_challenge_method !== 'S256' || String(values.resource || mcpResource()) !== mcpResource()) return html(res, 400, page('OAuth', '<h1>Solicitud OAuth no válida.</h1>'));
    const scopeInput = String(values.scope || 'profile spaces.read materials.read').split(/\s+/).filter((scope) => SCOPES.has(scope));
    const scopes = scopeInput.length > 0 ? scopeInput : ['materials.read'];
    const raw = token(24);
    store.state.oauthCodes.push({ hash: digest(raw), userId: current.user.id, clientId: client.client_id, redirectUri: values.redirect_uri, codeChallenge: values.code_challenge, scopes, resource: mcpResource(), expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() });
    store.save();
    const target = new URL(values.redirect_uri); target.searchParams.set('code', raw); if (values.state) target.searchParams.set('state', values.state);
    return redirect(res, target.toString());
  }

  if (url.pathname === '/oauth/token' && req.method === 'POST') {
    if (!rateLimit(req, res, 'oauth-token', 120, 60_000)) return;
    const values = await form(req);
    if (values.grant_type === 'authorization_code') {
      store.cleanup();
      const index = store.state.oauthCodes.findIndex((entry) => entry.hash === digest(values.code));
      const code = store.state.oauthCodes[index];
      const verifierHash = createHash('sha256').update(String(values.code_verifier || '')).digest('base64url');
      if (!code || code.clientId !== values.client_id || code.redirectUri !== values.redirect_uri || code.codeChallenge !== verifierHash || values.resource !== code.resource) return json(res, 400, { error: 'invalid_grant' });
      store.state.oauthCodes.splice(index, 1);
      const access = token(); const refresh = token();
      store.state.accessTokens.push({ hash: digest(access), userId: code.userId, clientId: code.clientId, scopes: code.scopes, resource: code.resource, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() });
      store.state.refreshTokens.push({ hash: digest(refresh), userId: code.userId, clientId: code.clientId, scopes: code.scopes, resource: code.resource, expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() });
      store.save();
      return json(res, 200, { access_token: access, token_type: 'Bearer', expires_in: 900, refresh_token: refresh, scope: code.scopes.join(' ') });
    }
    if (values.grant_type === 'refresh_token') {
      store.cleanup();
      const index = store.state.refreshTokens.findIndex((entry) => entry.hash === digest(values.refresh_token));
      const previous = store.state.refreshTokens[index];
      if (!previous || previous.clientId !== values.client_id || values.resource !== previous.resource) return json(res, 400, { error: 'invalid_grant' });
      store.state.refreshTokens.splice(index, 1);
      const access = token(); const refresh = token();
      store.state.accessTokens.push({ ...previous, hash: digest(access), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() });
      store.state.refreshTokens.push({ ...previous, hash: digest(refresh), expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() });
      store.save();
      return json(res, 200, { access_token: access, token_type: 'Bearer', expires_in: 900, refresh_token: refresh, scope: previous.scopes.join(' ') });
    }
    return json(res, 400, { error: 'unsupported_grant_type' });
  }

  if (url.pathname === '/api/v1/pair' && req.method === 'POST') {
    if (!rateLimit(req, res, 'pair', 30, 15 * 60_000)) return;
    const input = await jsonBody(req);
    store.cleanup();
    const pairing = store.state.pairingCodes.find((entry) => entry.hash === digest(String(input.code || '').toUpperCase()));
    if (!pairing) return json(res, 401, { error: 'Código inválido o caducado.' });
    pairing.usedAt = new Date().toISOString();
    const raw = token();
    store.state.deviceTokens.push({ hash: digest(raw), userId: pairing.userId, spaceId: pairing.spaceId, deviceName: String(input.deviceName || 'Nodus Desktop').slice(0, 120), createdAt: new Date().toISOString(), lastUsedAt: null });
    store.save();
    const space = store.state.spaces.find((entry) => entry.id === pairing.spaceId);
    return json(res, 200, { accessToken: raw, space: { id: space.id, name: space.name }, server: { name: store.state.settings.name, publicUrl: publicUrl() } });
  }

  const snapshotMatch = url.pathname.match(/^\/api\/v1\/spaces\/([^/]+)\/snapshot$/);
  if (snapshotMatch && req.method === 'PUT') {
    const raw = bearer(req);
    const device = store.state.deviceTokens.find((entry) => entry.hash === digest(raw) && entry.spaceId === snapshotMatch[1]);
    if (!device) return json(res, 401, { error: 'Token de dispositivo no válido.' });
    const space = store.state.spaces.find((entry) => entry.id === device.spaceId);
    if (!space || !membership(device.userId, space.id)) return json(res, 403, { error: 'Sin permiso para publicar este espacio.' });
    if (req.headers['content-encoding'] !== 'gzip') return json(res, 415, { error: 'La publicación debe enviarse comprimida con gzip.' });
    const revision = String(req.headers['x-nodus-revision'] || '');
    if (revision && revision === space.revision) return json(res, 200, { ok: true, unchanged: true, updatedAt: space.updatedAt });
    const bytes = await body(req, MAX_SNAPSHOT_BYTES);
    let snapshot;
    try { snapshot = JSON.parse(gunzipSync(bytes, { maxOutputLength: MAX_SNAPSHOT_BYTES }).toString('utf8')); } catch { return json(res, 400, { error: 'La publicación comprimida no es válida o supera el tamaño permitido.' }); }
    if (snapshot?.format !== 'nodus.server-snapshot' || snapshot?.formatVersion !== 1) return json(res, 400, { error: 'Formato de publicación no compatible.' });
    store.writeSnapshot(space.id, bytes); snapshotCache.delete(space.id);
    space.updatedAt = new Date().toISOString(); space.revision = revision || snapshot.revision || ''; space.vault = snapshot.vault; space.bytes = bytes.length;
    device.lastUsedAt = space.updatedAt; store.save();
    return json(res, 200, { ok: true, unchanged: false, updatedAt: space.updatedAt, bytes: bytes.length });
  }

  if (url.pathname === '/') {
    const current = requireSession(req, res, true); if (!current) return;
    return html(res, 200, dashboard(current, url.searchParams.get('notice') || ''));
  }
  if (url.pathname === '/logout' && req.method === 'POST') {
    const current = requireSession(req, res); if (!current) return;
    const values = await form(req); if (!checkCsrf(current, values.csrf)) return html(res, 403, page('Error', '<h1>Sesión caducada.</h1>'));
    store.state.sessions = store.state.sessions.filter((entry) => entry.hash !== current.session.hash); store.save();
    return redirect(res, '/login', { 'set-cookie': 'nodus_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
  }
  if (url.pathname === '/admin/spaces' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req); if (!checkCsrf(current, values.csrf)) return html(res, 403, page('Error', '<h1>Sesión caducada.</h1>'));
    const space = { id: randomUUID(), name: String(values.name || '').trim(), description: String(values.description || '').trim(), createdAt: new Date().toISOString(), updatedAt: null, revision: '', bytes: 0 };
    if (!space.name) return html(res, 400, dashboard(current, 'El espacio necesita un nombre.'));
    store.state.spaces.push(space); store.state.memberships.push({ userId: current.user.id, spaceId: space.id, role: 'owner' }); store.save();
    return redirect(res, '/?notice=' + encodeURIComponent('Espacio creado.'));
  }
  if (url.pathname === '/admin/spaces/clear-request' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req); if (!checkCsrf(current, values.csrf)) return html(res, 403, page('Error', '<h1>Sesión caducada.</h1>'));
    const space = store.state.spaces.find((entry) => entry.id === values.spaceId);
    if (!space) return html(res, 404, page('Error', '<h1>Espacio no encontrado.</h1>'));
    return html(res, 200, page('Borrar publicación', `<h1>Borrar publicación</h1><div class="card"><p>Se eliminará del servidor la copia publicada de <strong>${escapeHtml(space.name)}</strong>. El vault local no se modifica.</p><form method="post" action="/admin/spaces/clear"><input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="spaceId" value="${space.id}"><button>Borrar definitivamente</button></form><p><a href="/">Cancelar</a></p></div>`));
  }
  if (url.pathname === '/admin/spaces/clear' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req); if (!checkCsrf(current, values.csrf)) return html(res, 403, page('Error', '<h1>Sesión caducada.</h1>'));
    const space = store.state.spaces.find((entry) => entry.id === values.spaceId);
    if (!space) return html(res, 404, page('Error', '<h1>Espacio no encontrado.</h1>'));
    store.removeSnapshot(space.id); snapshotCache.delete(space.id);
    // Deleting a publication also revokes its publishers so an open desktop app
    // cannot silently recreate data the administrator has just removed.
    store.state.deviceTokens = store.state.deviceTokens.filter((entry) => entry.spaceId !== space.id);
    store.state.pairingCodes = store.state.pairingCodes.filter((entry) => entry.spaceId !== space.id);
    space.updatedAt = null; space.revision = ''; space.vault = null; space.bytes = 0; store.save();
    return redirect(res, '/?notice=' + encodeURIComponent('Publicación eliminada del servidor.'));
  }
  if (url.pathname === '/admin/users' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req); if (!checkCsrf(current, values.csrf)) return html(res, 403, page('Error', '<h1>Sesión caducada.</h1>'));
    try { const user = store.createUser(values.email, values.password, 'member'); if (values.spaceId) { store.state.memberships.push({ userId: user.id, spaceId: values.spaceId, role: 'reader' }); store.save(); } return redirect(res, '/?notice=' + encodeURIComponent('Usuario creado.')); }
    catch (error) { return html(res, 400, dashboard(current, error instanceof Error ? error.message : String(error))); }
  }
  if (url.pathname === '/admin/access/grant' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req); if (!checkCsrf(current, values.csrf)) return html(res, 403, page('Error', '<h1>Sesión caducada.</h1>'));
    const user = store.state.users.find((entry) => entry.id === values.userId);
    const space = store.state.spaces.find((entry) => entry.id === values.spaceId);
    if (!user || !space) return html(res, 400, dashboard(current, 'Usuario o espacio no válido.'));
    if (!membership(user.id, space.id)) { store.state.memberships.push({ userId: user.id, spaceId: space.id, role: 'reader' }); store.save(); }
    return redirect(res, '/?notice=' + encodeURIComponent('Acceso lector concedido.'));
  }
  if (url.pathname === '/admin/access/revoke' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req); if (!checkCsrf(current, values.csrf)) return html(res, 403, page('Error', '<h1>Sesión caducada.</h1>'));
    const entry = membership(values.userId, values.spaceId);
    if (!entry || entry.role === 'owner') return html(res, 400, dashboard(current, 'Ese acceso no puede revocarse desde aquí.'));
    store.state.memberships = store.state.memberships.filter((candidate) => candidate !== entry);
    store.state.deviceTokens = store.state.deviceTokens.filter((device) => device.userId !== values.userId || device.spaceId !== values.spaceId);
    store.save();
    return redirect(res, '/?notice=' + encodeURIComponent('Acceso revocado.'));
  }
  if (url.pathname === '/admin/devices/revoke' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req); if (!checkCsrf(current, values.csrf)) return html(res, 403, page('Error', '<h1>Sesión caducada.</h1>'));
    store.state.deviceTokens = store.state.deviceTokens.filter((entry) => entry.hash !== values.tokenHash); store.save();
    return redirect(res, '/?notice=' + encodeURIComponent('Dispositivo revocado.'));
  }
  if (url.pathname === '/admin/pairing' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req); if (!checkCsrf(current, values.csrf)) return html(res, 403, page('Error', '<h1>Sesión caducada.</h1>'));
    if (!membership(current.user.id, values.spaceId)) return html(res, 403, page('Error', '<h1>Sin acceso al espacio.</h1>'));
    const raw = `${token(4).slice(0, 4)}-${token(4).slice(0, 4)}`.toUpperCase();
    store.state.pairingCodes.push({ hash: digest(raw), userId: current.user.id, spaceId: values.spaceId, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), usedAt: null }); store.save();
    return html(res, 200, page('Código de conexión', `<h1>Conectar Nodus Desktop</h1><div class="card"><p>Introduce este código en Ajustes → Servidor:</p><h2><code>${raw}</code></h2><p class="muted">Caduca en 15 minutos y solo puede utilizarse una vez.</p><p><a href="/">Volver</a></p></div>`));
  }
  return json(res, 404, { error: 'not_found' });
}

const server = http.createServer((req, res) => {
  Promise.resolve(route(req, res)).catch((error) => {
    console.error('[server]', error);
    if (!res.headersSent) json(res, Number(error?.statusCode) || 500, { error: Number(error?.statusCode) ? error.message : 'Error interno del servidor.' });
    else res.end();
  });
});

server.requestTimeout = 5 * 60_000;
server.headersTimeout = 65_000;
server.listen(PORT, HOST, () => {
  console.log(`[nodus-server] listening on http://${HOST}:${PORT}`);
  console.log(`[nodus-server] public URL: ${publicUrl()}`);
  if (store.state.users.length === 0 && (!SETUP_TOKEN || SETUP_TOKEN.length < 16)) console.warn('[nodus-server] NODUS_SETUP_TOKEN must contain at least 16 characters before setup can complete.');
});
