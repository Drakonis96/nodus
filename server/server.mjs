import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { constants as bufferLimits } from 'node:buffer';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Store, digest, token } from './lib/store.mjs';
import { body, contentSecurityPolicy, cookies, escapeHtml, form, html, json, jsonBody, redirect } from './lib/http.mjs';
import { normalizeServerLanguage, serverTranslator } from './lib/i18n.mjs';
import { helpTip, languagePicker, nodusMark, WEB_STYLES } from './lib/webUi.mjs';
import { can as canRole, isSpaceRole, normalizeSpaceRole, SPACE_ROLES } from './lib/roles.mjs';
import { createAuthorizer } from './lib/auth.mjs';
import { createApiRoutes } from './lib/routes/api.mjs';
import { createCorpusRoutes } from './lib/routes/corpus.mjs';

// A zero, a `200m`-style unit or a value past what Node can hold in a single buffer
// would otherwise reach zlib and turn every publication into an opaque rejection, so
// an unusable limit stops the server at boot the way a half-configured admin does.
function byteLimit(name, fallback, ceiling) {
  const configured = String(process.env[name] ?? '').trim();
  if (!configured) return fallback;
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < 64 * 1024 || value > ceiling) {
    throw new Error(`${name} must be a whole number of bytes between ${64 * 1024} and ${ceiling}.`);
  }
  return value;
}

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.NODUS_DATA_DIR || path.join(ROOT, 'data');
const PORT = Number(process.env.NODUS_PORT || 7443);
const HOST = process.env.NODUS_HOST || '0.0.0.0';
const SETUP_TOKEN = process.env.NODUS_SETUP_TOKEN || '';
/** How large the gzipped upload may be on the wire. Mirror it in your proxy. */
const MAX_SNAPSHOT_BYTES = byteLimit('NODUS_MAX_SNAPSHOT_BYTES', 100 * 1024 * 1024, bufferLimits.MAX_LENGTH);
// A publication travels gzipped but is expanded into one JSON string before parsing,
// and JSON of this shape shrinks around ten times over: the upload cap says nothing
// about the memory the expanded projection needs, so it gets a ceiling of its own
// rather than borrowing the one meant for the wire. Sharing a single number made a
// perfectly ordinary vault fail as if its upload had been corrupt.
const MAX_SNAPSHOT_JSON_BYTES = byteLimit('NODUS_MAX_SNAPSHOT_JSON_BYTES', 384 * 1024 * 1024, bufferLimits.MAX_STRING_LENGTH);
/** One image. Comfortably above a 1536×1024 render and far below any real PDF or recording. */
const MAX_ASSET_BYTES = byteLimit('NODUS_MAX_ASSET_BYTES', 8 * 1024 * 1024, bufferLimits.MAX_LENGTH);
/** Total image budget for one space, so a shared server cannot be filled from one vault. */
const MAX_SPACE_ASSET_BYTES = byteLimit('NODUS_MAX_SPACE_ASSET_BYTES', 2 * 1024 * 1024 * 1024, bufferLimits.MAX_LENGTH);
const MAX_VECTOR_BYTES = byteLimit('NODUS_MAX_VECTOR_BYTES', 512 * 1024 * 1024, bufferLimits.MAX_LENGTH);
/**
 * How long an unreferenced image survives before the sweeper takes it.
 *
 * Not politeness — it closes a race. A writer uploads an image and then sends the mutation
 * that points at it; a republication landing in between would legitimately not mention that
 * hash yet, and an eager sweep would delete bytes still in flight.
 */
const ASSET_GRACE_MS = 24 * 60 * 60_000;
const store = new Store(DATA_DIR);
const snapshotCache = new Map();
/**
 * A parsed snapshot can be hundreds of megabytes. MCP touched it rarely; the REST API is hit
 * on every screen a phone opens, so the cache needs a ceiling or a server with several large
 * spaces runs itself out of memory.
 */
const MAX_CACHED_SNAPSHOTS = Math.max(1, Number(process.env.NODUS_MAX_CACHED_SNAPSHOTS || 3));
const rateBuckets = new Map();
const SCOPES = new Set(['profile', 'spaces.read', 'materials.read', 'materials.write', 'assets.read']);
const MCP_PROTOCOLS = new Set(['2025-11-25', '2025-06-18', '2025-03-26']);
const AUTH_BODY_BYTES = 32 * 1024;
const MAX_RATE_BUCKETS = 20_000;
const languageContext = new AsyncLocalStorage();

function environmentCredential(name) {
  const direct = process.env[name] || '';
  const file = process.env[`${name}_FILE`] || '';
  if (direct && file) throw new Error(`${name} and ${name}_FILE cannot be used together.`);
  if (!file) return direct;
  try {
    return fs.readFileSync(file, 'utf8').replace(/\r?\n$/, '');
  } catch {
    throw new Error(`Could not read the credential file configured by ${name}_FILE.`);
  }
}

function syncEnvironmentAdmin() {
  const email = environmentCredential('NODUS_ADMIN_EMAIL').trim();
  const password = environmentCredential('NODUS_ADMIN_PASSWORD');
  if (!email && !password) return false;
  if (!email || !password) throw new Error('NODUS_ADMIN_EMAIL and NODUS_ADMIN_PASSWORD must be configured together.');
  const result = store.syncAdminCredentials(email, password);
  const changes = [result.created && 'created', result.emailChanged && 'email updated', result.passwordChanged && 'password rotated'].filter(Boolean);
  console.log(`[nodus-server] environment administrator synchronized${changes.length ? ` (${changes.join(', ')})` : ''}`);
  return true;
}

const ENVIRONMENT_ADMIN_CONFIGURED = syncEnvironmentAdmin();

function language() {
  return normalizeServerLanguage(languageContext.getStore() || store.state.settings.language);
}

function tr(key, variables) {
  return serverTranslator(language())(key, variables);
}

function normalizePublicUrl(value) {
  const parsed = new URL(String(value));
  const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) throw new Error('The public URL must use HTTPS.');
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) throw new Error('The public URL must contain only the domain or subdomain, without a path or credentials.');
  return parsed.origin;
}

function publicUrl() {
  return normalizePublicUrl(process.env.NODUS_PUBLIC_URL || store.state.settings.publicUrl || `http://localhost:${PORT}`);
}

/**
 * Two OAuth protected resources over one origin.
 *
 * MCP and the client API are different surfaces with different powers — an AI client reads,
 * an app reads and writes — so a token minted for one must not open the other. The boundary
 * is the resource identifier plus its scopes, which is enforced in software; a second
 * hostname would cost a second certificate and buy nothing.
 *
 * Before this existed, `oauthAccess()` compared against the MCP resource and nothing else,
 * so any future REST route would have accepted an MCP token, and vice versa.
 */
function resourceMap() {
  return { mcp: `${publicUrl()}/mcp`, api: `${publicUrl()}/api/v1` };
}

function mcpResource() {
  return resourceMap().mcp;
}

function apiResource() {
  return resourceMap().api;
}

function knownResource(value) {
  return Object.values(resourceMap()).includes(String(value));
}

const { authorize, challenge: authChallenge } = createAuthorizer({
  store,
  resourceFor: (key) => resourceMap()[key],
  publicUrl,
});

function page(title, content, options = {}) {
  const picker = languagePicker(language(), { language: tr('language'), apply: tr('applyLanguage') });
  const header = `<header class="site-header">
    <a class="site-brand" href="/" data-testid="nodus-brand">
      ${nodusMark('nodus-header-mark')}
      <span>Nodus Server<small>${tr('administration')}</small></span>
    </a>
    ${picker}
  </header>`;
  const main = options.variant === 'auth'
    ? `<main class="auth-main" data-testid="auth-layout">
        <section class="auth-story">
          ${nodusMark('nodus-auth-mark', 'auth-mark')}
          <p class="brand-kicker">Nodus Server</p>
          <h2>${tr('brandTagline')}</h2>
          <p>${tr('brandIntro')}</p>
          <div class="trust-list">
            <span class="trust-pill">${tr('privateByDesign')}</span>
            <span class="trust-pill">${tr('oauthProtected')}</span>
          </div>
        </section>
        <section class="auth-card">${content}</section>
      </main>`
    : `<main class="app-main">${content}</main>`;
  return `<!doctype html><html lang="${escapeHtml(language())}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#08080d"><title>${escapeHtml(title)} · Nodus Server</title><style>${WEB_STYLES}</style></head><body>${header}${main}<footer class="site-footer">Nodus Server · ${tr('brandTagline')}</footer></body></html>`;
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

function safeEqual(value, expected) {
  const actual = Buffer.from(String(value ?? ''));
  const wanted = Buffer.from(String(expected ?? ''));
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function checkCsrf(current, value) {
  return safeEqual(value, current.session.csrf);
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

function rateLimit(req, res, key, limit, windowMs, identity = clientIp(req)) {
  const now = Date.now();
  const bucketKey = `${key}:${identity}`;
  let bucket = rateBuckets.get(bucketKey);
  if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  rateBuckets.set(bucketKey, bucket);
  if (rateBuckets.size > MAX_RATE_BUCKETS) {
    for (const [candidate, value] of rateBuckets) if (value.resetAt <= now) rateBuckets.delete(candidate);
    while (rateBuckets.size > MAX_RATE_BUCKETS) rateBuckets.delete(rateBuckets.keys().next().value);
  }
  if (bucket.count <= limit) return true;
  json(res, 429, { error: 'rate_limited', error_description: 'Too many attempts. Wait a few minutes and try again.' }, {
    'retry-after': String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))),
  });
  return false;
}

function clearRateLimit(key, identity) {
  rateBuckets.delete(`${key}:${identity}`);
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

function oauthRedirectHeaders(redirectUri) {
  // The consent form posts only to this server. Browsers also apply form-action
  // to every redirect in that navigation, so the validated OAuth callback
  // origin must be present or ChatGPT/Claude cannot receive the code. Keeping
  // the source to the exact registered origin preserves the restrictive CSP.
  const callbackOrigin = new URL(redirectUri).origin;
  return { 'content-security-policy': contentSecurityPolicy(["'self'", callbackOrigin]) };
}

function membership(userId, spaceId) {
  return store.state.memberships.find((entry) => entry.userId === userId && entry.spaceId === spaceId) ?? null;
}

/**
 * The role a device token actually operates with.
 *
 * A token paired before roles existed belongs, by construction, to whoever was publishing
 * that space, so it keeps owner powers. Refusing it would stop every installed desktop from
 * publishing the moment its server was upgraded.
 */
function effectiveRole(device) {
  const entry = membership(device.userId, device.spaceId);
  if (device.grandfathered && (device.kind ?? 'publisher') === 'publisher') return 'owner';
  return entry ? normalizeSpaceRole(entry.role) : null;
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
  json(res, 401, { error: 'unauthorized', error_description: 'Sign in to Nodus to continue.' }, {
    'www-authenticate': `Bearer resource_metadata="${metadata}", scope="${scope}"`,
  });
}

function mib(value) {
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Expanded size a gzip stream declares in its trailer, or null when it is not gzip. */
function declaredGzipSize(bytes) {
  return bytes.length >= 18 && bytes[0] === 0x1f && bytes[1] === 0x8b ? bytes.readUInt32LE(bytes.length - 4) : null;
}

/**
 * Expand an uploaded publication, keeping the two ways it can fail apart: too big to
 * hold in memory, or not readable gzipped JSON at all. The trailer is only a hint —
 * it costs nothing, it names the real size in the rejection, and `maxOutputLength`
 * still enforces the limit when a client lies about it.
 */
function expandSnapshot(bytes) {
  const declared = declaredGzipSize(bytes);
  if (declared !== null && declared > MAX_SNAPSHOT_JSON_BYTES) return { reason: 'too-large', expanded: declared };
  let text;
  try {
    text = gunzipSync(bytes, { maxOutputLength: MAX_SNAPSHOT_JSON_BYTES }).toString('utf8');
  } catch (error) {
    if (error?.code === 'ERR_BUFFER_TOO_LARGE' || error?.code === 'ERR_STRING_TOO_LONG') return { reason: 'too-large', expanded: declared };
    return { reason: 'invalid' };
  }
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { reason: 'invalid' };
  }
}

function readSnapshot(spaceId) {
  const target = store.snapshotPath(spaceId);
  if (!fs.existsSync(target)) return null;
  const stat = fs.statSync(target);
  const cached = snapshotCache.get(spaceId);
  if (cached?.mtimeMs === stat.mtimeMs) return cached.value;
  // Stored publications passed the publish-time limit already, so read them against
  // the hard ceiling: lowering NODUS_MAX_SNAPSHOT_JSON_BYTES must not make a space
  // that is already on disk unreadable to every MCP client.
  const value = JSON.parse(gunzipSync(fs.readFileSync(target), { maxOutputLength: bufferLimits.MAX_STRING_LENGTH }).toString('utf8'));
  snapshotCache.set(spaceId, { mtimeMs: stat.mtimeMs, value });
  // Insertion-ordered Map, so the first key is the least recently loaded. Without this the
  // cache is unbounded, and a server holding several large spaces would grow until the REST
  // API — which reads a snapshot on every request, unlike MCP — exhausted its memory.
  while (snapshotCache.size > MAX_CACHED_SNAPSHOTS) {
    const oldest = snapshotCache.keys().next().value;
    if (oldest === spaceId) break;
    snapshotCache.delete(oldest);
  }
  return value;
}

function invalidateSnapshot(spaceId) {
  snapshotCache.delete(spaceId);
}

function rows(snapshot, table) {
  const value = snapshot?.tables?.[table];
  return Array.isArray(value) ? value : [];
}

const WORLD_ENTITIES = {
  character: { table: 'persons', id: 'person_id', title: 'display_name' },
  place: { table: 'places', id: 'place_id', title: 'name' },
  group: { table: 'world_groups', id: 'group_id', title: 'name' },
  scene: { table: 'world_scenes', id: 'scene_id', title: 'title' },
  article: { table: 'world_articles', id: 'article_id', title: 'title' },
  map: { table: 'world_maps', id: 'map_id', title: 'name' },
  thread: { table: 'world_threads', id: 'thread_id', title: 'title' },
  rule: { table: 'world_rules', id: 'rule_id', title: 'title' },
  question: { table: 'world_questions', id: 'question_id', title: 'question' },
  secret: { table: 'world_secrets', id: 'secret_id', title: 'title' },
  event: { table: 'events', id: 'event_id', title: 'label' },
};

function requireWorldSnapshot(snapshot) {
  if (snapshot?.vault?.type !== 'worldbuilding') {
    return { error: 'This tool only applies to a published Worldbuilding vault.' };
  }
  return null;
}

function worldEntityRows(snapshot, kind) {
  const def = WORLD_ENTITIES[kind];
  if (!def) return [];
  return rows(snapshot, def.table).map((row) => ({
    ...row,
    entityKind: kind,
    id: row[def.id],
    title: row[def.title] ?? '',
  }));
}

function worldEntityDetail(snapshot, kind, id) {
  const def = WORLD_ENTITIES[kind];
  if (!def) return null;
  const entity = rows(snapshot, def.table).find((row) => String(row[def.id]) === String(id));
  if (!entity) return null;
  const related = {};
  if (kind === 'character') {
    related.profile = rows(snapshot, 'character_profiles').find((row) => String(row.person_id) === String(id)) ?? null;
    related.names = rows(snapshot, 'person_names').filter((row) => String(row.person_id) === String(id));
    related.abilities = rows(snapshot, 'character_abilities').filter((row) => String(row.person_id) === String(id));
    related.affiliations = rows(snapshot, 'character_affiliations').filter((row) => String(row.person_id) === String(id));
    related.appearances = rows(snapshot, 'scene_characters').filter((row) => String(row.person_id) === String(id));
    related.eventParticipants = rows(snapshot, 'event_participants').filter((row) => String(row.person_id) === String(id));
    related.ownedSecrets = rows(snapshot, 'world_secrets').filter((row) => String(row.owner_person_id) === String(id));
    related.knownSecrets = rows(snapshot, 'secret_knowers').filter((row) => String(row.person_id) === String(id));
  } else if (kind === 'place') {
    related.profile = rows(snapshot, 'place_profiles').find((row) => String(row.place_id) === String(id)) ?? null;
    related.children = rows(snapshot, 'places').filter((row) => String(row.parent_id) === String(id));
    related.maps = rows(snapshot, 'world_maps').filter((row) => String(row.place_id) === String(id));
    related.markers = rows(snapshot, 'map_markers').filter((row) => String(row.place_id) === String(id));
    related.scenes = rows(snapshot, 'world_scenes').filter((row) => String(row.place_id) === String(id));
    related.inhabitants = rows(snapshot, 'person_places').filter((row) => String(row.place_id) === String(id));
  } else if (kind === 'group') {
    related.affiliations = rows(snapshot, 'character_affiliations').filter((row) => String(row.group_id) === String(id));
    related.threadParties = rows(snapshot, 'thread_parties').filter((row) => row.party_kind === 'group' && String(row.party_id) === String(id));
  } else if (kind === 'scene') {
    related.cast = rows(snapshot, 'scene_characters').filter((row) => String(row.scene_id) === String(id));
    related.manuscript = rows(snapshot, 'world_scene_text').find((row) => String(row.scene_id) === String(id)) ?? null;
    related.day = rows(snapshot, 'world_scene_days').find((row) => String(row.scene_id) === String(id)) ?? null;
    related.beats = rows(snapshot, 'world_beats').filter((row) => String(row.scene_id) === String(id));
    related.questions = rows(snapshot, 'world_questions').filter((row) => row.anchor_kind === 'scene' && String(row.anchor_id) === String(id));
  } else if (kind === 'article') {
    related.links = rows(snapshot, 'world_links').filter((row) => row.source_kind === 'article' && String(row.source_id) === String(id));
    related.backlinks = rows(snapshot, 'world_links').filter((row) => row.target_kind === 'article' && String(row.target_id) === String(id));
  } else if (kind === 'map') {
    related.layers = rows(snapshot, 'map_layers').filter((row) => String(row.map_id) === String(id));
    related.markers = rows(snapshot, 'map_markers').filter((row) => String(row.map_id) === String(id));
    related.travelModes = rows(snapshot, 'map_travel_modes').filter((row) => String(row.map_id) === String(id));
  } else if (kind === 'thread') {
    related.parties = rows(snapshot, 'thread_parties').filter((row) => String(row.thread_id) === String(id));
    related.beats = rows(snapshot, 'world_beats').filter((row) => String(row.thread_id) === String(id));
  } else if (kind === 'rule') {
    related.beats = rows(snapshot, 'world_beats').filter((row) => row.thread_kind === 'rule' && String(row.thread_id) === String(id));
  } else if (kind === 'question') {
    related.options = rows(snapshot, 'world_question_options').filter((row) => String(row.question_id) === String(id));
  } else if (kind === 'secret') {
    related.knowers = rows(snapshot, 'secret_knowers').filter((row) => String(row.secret_id) === String(id));
  } else if (kind === 'event') {
    related.participants = rows(snapshot, 'event_participants').filter((row) => String(row.event_id) === String(id));
    related.worldDate = rows(snapshot, 'event_world_dates').find((row) => String(row.event_id) === String(id)) ?? null;
  }
  return { kind, id, entity, related };
}

function userSpaces(userId) {
  const ids = new Set(store.state.memberships.filter((entry) => entry.userId === userId).map((entry) => entry.spaceId));
  return store.state.spaces.filter((space) => ids.has(space.id));
}

const TOOLS = [
  { name: 'nodus_list_spaces', title: 'List Nodus spaces', description: 'Lists the shared Nodus spaces the authenticated user can read.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'nodus_get_space_summary', title: 'Get space summary', description: 'Returns counts and publication metadata for one authorized Nodus space.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' } }, required: ['spaceId'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'nodus_search', title: 'Search Nodus', description: 'Searches the canonical text available in one authorized shared space, including academic and Worldbuilding corpora.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['spaceId', 'query'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'nodus_get_work', title: 'Get work', description: 'Gets one shared bibliographic work by its Nodus id.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, id: { type: 'string' } }, required: ['spaceId', 'id'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'nodus_get_idea', title: 'Get idea', description: 'Gets one shared idea and its direct relations.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, id: { type: 'string' } }, required: ['spaceId', 'id'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'nodus_world_get_overview', title: 'Get shared world overview', description: 'Returns counts, calendar and manuscript totals for one authorized Worldbuilding space.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' } }, required: ['spaceId'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'nodus_world_search', title: 'Search shared fictional world', description: 'Searches canonical character, place, group, scene, article, rule, question, secret and manuscript text in one authorized Worldbuilding space.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['spaceId', 'query'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'nodus_world_list_entities', title: 'List shared world entities', description: 'Lists one kind of entity from a Worldbuilding space. Kinds: character, place, group, scene, article, map, thread, rule, question, secret, event.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, kind: { type: 'string', enum: Object.keys(WORLD_ENTITIES) }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 }, offset: { type: 'integer', minimum: 0 } }, required: ['spaceId', 'kind'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'nodus_world_get_entity', title: 'Get shared world entity', description: 'Gets one Worldbuilding entity with its directly related profile, cast, links, beats, options or manuscript data.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, kind: { type: 'string', enum: Object.keys(WORLD_ENTITIES) }, id: { type: 'string' } }, required: ['spaceId', 'kind', 'id'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'nodus_world_get_manuscript', title: 'Get shared world manuscript', description: 'Returns ordered scene metadata, current prose and chapter/book starts from a Worldbuilding space.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, includeText: { type: 'boolean' } }, required: ['spaceId'], additionalProperties: false }, annotations: { readOnlyHint: true } },
];

for (const tool of TOOLS) tool.securitySchemes = [{ type: 'oauth2', scopes: ['materials.read'] }];

function toolResult(value, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value, ...(isError ? { isError: true } : {}) };
}

function callTool(auth, name, args) {
  if (name === 'nodus_list_spaces') return toolResult({ spaces: userSpaces(auth.user.id).map(({ id, name, description, updatedAt, vault }) => ({ id, name, description, updatedAt, vault: vault ?? null })) });
  const spaceId = typeof args?.spaceId === 'string' ? args.spaceId : '';
  const space = store.state.spaces.find((entry) => entry.id === spaceId);
  if (!space || !membership(auth.user.id, spaceId)) return toolResult({ error: 'You do not have access to that space.' }, true);
  const snapshot = readSnapshot(spaceId);
  if (!snapshot) return toolResult({ error: 'This space has not received a publication yet.' }, true);
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
      ['persons', ['display_name', 'notes', 'biography']], ['character_profiles', ['species', 'gender', 'pronouns', 'appearance', 'personality', 'backstory']],
      ['places', ['name', 'kind', 'notes']], ['place_profiles', ['appearance', 'atmosphere', 'history']],
      ['world_groups', ['name', 'summary', 'description', 'notes']], ['world_scenes', ['title', 'summary', 'notes']],
      ['world_scene_text', ['text']], ['world_articles', ['title', 'summary', 'body', 'aka', 'notes']],
      ['world_threads', ['title', 'pitch', 'stakes', 'outcome']], ['world_rules', ['title', 'statement', 'cost', 'limits']],
      ['world_questions', ['question']], ['world_secrets', ['title', 'content', 'notes']],
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
    return work ? toolResult({ work }) : toolResult({ error: 'Work not found.' }, true);
  }
  if (name === 'nodus_get_idea') {
    const idea = rows(snapshot, 'ideas').find((entry) => String(entry.global_id ?? entry.id) === String(args.id));
    if (!idea) return toolResult({ error: 'Idea not found.' }, true);
    const id = String(idea.global_id ?? idea.id);
    const relations = rows(snapshot, 'edges').filter((entry) => String(entry.from_id) === id || String(entry.to_id) === id);
    return toolResult({ idea, relations });
  }
  if (name.startsWith('nodus_world_')) {
    const wrongVault = requireWorldSnapshot(snapshot);
    if (wrongVault) return toolResult(wrongVault, true);
  }
  if (name === 'nodus_world_get_overview') {
    const counts = Object.fromEntries(Object.entries(WORLD_ENTITIES).map(([kind, def]) => [kind, rows(snapshot, def.table).length]));
    const calendar = {
      settings: rows(snapshot, 'world_calendar')[0] ?? null,
      eras: rows(snapshot, 'world_calendar_eras'),
      months: rows(snapshot, 'world_calendar_months'),
    };
    const sceneText = rows(snapshot, 'world_scene_text');
    return toolResult({
      vault: snapshot.vault,
      counts,
      calendar,
      manuscript: {
        scenes: rows(snapshot, 'world_scenes').length,
        words: sceneText.reduce((sum, row) => sum + (Number(row.word_count) || 0), 0),
        chapters: rows(snapshot, 'world_chapter_breaks').length,
        books: rows(snapshot, 'world_manuscript_starts').length,
      },
    });
  }
  if (name === 'nodus_world_search') {
    const query = String(args.query ?? '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(100, Number(args.limit) || 30));
    if (!query) return toolResult({ results: [] });
    const definitions = [
      ['character', 'persons', 'person_id', 'display_name', ['display_name', 'notes', 'biography']],
      ['character-profile', 'character_profiles', 'person_id', 'species', ['species', 'gender', 'pronouns', 'appearance', 'personality', 'backstory']],
      ['place', 'places', 'place_id', 'name', ['name', 'kind', 'notes']],
      ['place-profile', 'place_profiles', 'place_id', 'place_id', ['appearance', 'atmosphere', 'history']],
      ['group', 'world_groups', 'group_id', 'name', ['name', 'summary', 'description', 'notes']],
      ['scene', 'world_scenes', 'scene_id', 'title', ['title', 'summary', 'notes']],
      ['manuscript', 'world_scene_text', 'scene_id', 'scene_id', ['text']],
      ['article', 'world_articles', 'article_id', 'title', ['title', 'summary', 'body', 'aka', 'notes']],
      ['thread', 'world_threads', 'thread_id', 'title', ['title', 'pitch', 'stakes', 'outcome']],
      ['rule', 'world_rules', 'rule_id', 'title', ['title', 'statement', 'cost', 'limits']],
      ['question', 'world_questions', 'question_id', 'question', ['question']],
      ['secret', 'world_secrets', 'secret_id', 'title', ['title', 'content', 'notes']],
    ];
    const results = [];
    for (const [kind, table, idField, titleField, fields] of definitions) {
      for (const row of rows(snapshot, table)) {
        const text = fields.map((field) => row[field]).filter((value) => typeof value === 'string').join('\n');
        if (text.toLowerCase().includes(query)) {
          results.push({ kind, id: row[idField], title: row[titleField] ?? '', excerpt: text.slice(0, 800) });
        }
        if (results.length >= limit) return toolResult({ query: args.query, results, truncated: true });
      }
    }
    return toolResult({ query: args.query, results, truncated: false });
  }
  if (name === 'nodus_world_list_entities') {
    const kind = String(args.kind ?? '');
    if (!WORLD_ENTITIES[kind]) return toolResult({ error: 'Unknown world entity kind.' }, true);
    const query = String(args.query ?? '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(200, Number(args.limit) || 100));
    const offset = Math.max(0, Number(args.offset) || 0);
    const all = worldEntityRows(snapshot, kind).filter((row) => !query || JSON.stringify(row).toLowerCase().includes(query));
    return toolResult({ kind, entities: all.slice(offset, offset + limit), total: all.length, limit, offset, hasMore: offset + limit < all.length });
  }
  if (name === 'nodus_world_get_entity') {
    const detail = worldEntityDetail(snapshot, String(args.kind ?? ''), String(args.id ?? ''));
    return detail ? toolResult(detail) : toolResult({ error: 'World entity not found.' }, true);
  }
  if (name === 'nodus_world_get_manuscript') {
    const includeText = args.includeText === true;
    const texts = new Map(rows(snapshot, 'world_scene_text').map((row) => [String(row.scene_id), row]));
    const chapters = new Map(rows(snapshot, 'world_chapter_breaks').map((row) => [String(row.scene_id), row]));
    const books = new Map(rows(snapshot, 'world_manuscript_starts').map((row) => [String(row.scene_id), row]));
    const scenes = [...rows(snapshot, 'world_scenes')]
      .sort((a, b) => (Number(a.narrative_order) || 0) - (Number(b.narrative_order) || 0))
      .map((scene) => {
        const manuscript = texts.get(String(scene.scene_id)) ?? null;
        const text = typeof manuscript?.text === 'string' ? manuscript.text : null;
        return {
          ...scene,
          manuscript: manuscript ? {
            word_count: manuscript.word_count ?? 0,
            updated_at: manuscript.updated_at ?? null,
            ...(includeText ? { text } : { text_snippet: text ? text.slice(0, 800) : null }),
          } : null,
          chapter: chapters.get(String(scene.scene_id)) ?? null,
          book: books.get(String(scene.scene_id)) ?? null,
        };
      });
    return toolResult({ scenes, includeText });
  }
  return toolResult({ error: 'Unknown tool.' }, true);
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
    result = { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'nodus-server', version: '0.1.0', description: 'Read-only access to explicitly shared Nodus vaults, including Worldbuilding spaces.' }, instructions: 'Consult only spaces authorized for this user. Use nodus_list_spaces before querying a space and inspect its vault type. Shared data is read-only; use nodus_world_* tools for Worldbuilding spaces.' };
  } else if (request.method === 'tools/list') result = { tools: TOOLS };
  else if (request.method === 'tools/call') result = callTool(auth, request.params?.name, request.params?.arguments ?? {});
  else return json(res, 200, { jsonrpc: '2.0', id: request.id ?? null, error: { code: -32601, message: 'Method not found' } });
  return json(res, 200, { jsonrpc: '2.0', id: request.id ?? null, result }, { 'mcp-protocol-version': protocolVersion });
}

function setupPage(error = '') {
  return page(tr('setupTitle'), `<p class="eyebrow">${tr('setupTitle')}</p><h1>${tr('setupHeading')}</h1><p class="lead">${tr('setupIntro')}</p>${error ? `<p class="warn">${escapeHtml(error)}</p>` : ''}<form class="card" method="post" action="/setup">
    <div class="field"><div class="label-line"><label for="setup-token">${tr('setupToken')}</label>${helpTip(tr('setupTokenHelp'), tr('moreInformation'))}</div><input id="setup-token" name="setupToken" type="password" maxlength="1024" required></div>
    <div class="field"><label for="server-name">${tr('serverName')}</label><input id="server-name" name="name" value="Nodus Server" maxlength="120" required></div>
    <div class="field"><div class="label-line"><label for="public-url">${tr('publicUrl')}</label>${helpTip(tr('publicUrlHelp'), tr('moreInformation'))}</div><input id="public-url" name="publicUrl" type="url" placeholder="https://nodus.example.com" maxlength="2048" required></div>
    <div class="field"><label for="admin-email">${tr('adminEmail')}</label><input id="admin-email" name="email" type="email" autocomplete="username" maxlength="320" required></div>
    <div class="field"><label for="admin-password">${tr('adminPassword')}</label><input id="admin-password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="1024" required></div>
    <button type="submit">${tr('createServer')}</button>
  </form>`, { variant: 'auth' });
}

function loginPage(next = '/', error = '') {
  return page(tr('loginTitle'), `<p class="eyebrow">${tr('oauthProtected')}</p><h1>${tr('loginHeading')}</h1><p class="lead">${tr('serverReady')}</p>${error ? `<p class="warn">${escapeHtml(error)}</p>` : ''}<form class="card" method="post" action="/login">
    <input type="hidden" name="next" value="${escapeHtml(next)}">
    <div class="field"><label for="login-email">${tr('email')}</label><input id="login-email" name="email" type="email" autocomplete="username" maxlength="320" required autofocus></div>
    <div class="field"><label for="login-password">${tr('password')}</label><input id="login-password" name="password" type="password" autocomplete="current-password" maxlength="1024" required></div>
    <button type="submit">${tr('signIn')}</button>
  </form>`, { variant: 'auth' });
}

function accountPage(current, notice = '', error = '') {
  const adminLink = current.user.role === 'admin' ? `<a class="button-link" href="/">${tr('administration')}</a>` : '';
  return page(tr('accountTitle'), `<div class="page-heading">
    <div><p class="eyebrow">${tr('oauthProtected')}</p><h1>${tr('accountTitle')}</h1><p class="lead">${escapeHtml(current.user.email)}</p></div>
    <div class="heading-actions">${adminLink}<form method="post" action="/logout"><input type="hidden" name="csrf" value="${current.session.csrf}"><button class="secondary" type="submit">${tr('signOut')}</button></form></div>
  </div>
  ${notice ? `<p class="ok">${escapeHtml(notice)}</p>` : ''}${error ? `<p class="warn">${escapeHtml(error)}</p>` : ''}
  <form class="card" method="post" action="/account/password">
    <div class="section-header"><div><h2>${tr('changePassword')}</h2><p>${tr('passwordHelp')}</p></div></div>
    <input type="hidden" name="csrf" value="${current.session.csrf}">
    <div class="grid">
      <div class="field"><label for="current-password">${tr('currentPassword')}</label><input id="current-password" name="currentPassword" type="password" autocomplete="current-password" required></div>
      <div></div>
      <div class="field"><label for="new-password">${tr('newPassword')}</label><input id="new-password" name="newPassword" type="password" autocomplete="new-password" minlength="12" required></div>
      <div class="field"><label for="confirm-password">${tr('repeatPassword')}</label><input id="confirm-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required></div>
    </div>
    <button type="submit">${tr('changePassword')}</button>
  </form>`);
}

function resetPasswordPage(current, user, error = '') {
  return page(tr('resetPassword'), `<div class="page-heading"><div><p class="eyebrow">${tr('usersAccess')}</p><h1>${tr('resetPassword')}</h1><p class="lead">${escapeHtml(user.email)}</p></div><a class="button-link" href="/">${tr('backAdmin')}</a></div>${error ? `<p class="warn">${escapeHtml(error)}</p>` : ''}<form class="card" method="post" action="/admin/users/password">
    <p class="muted">${tr('resetHelp')}</p>
    <input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="userId" value="${user.id}">
    <div class="grid">
      <div class="field"><label for="temporary-password">${tr('temporaryPassword')}</label><input id="temporary-password" name="newPassword" type="password" autocomplete="new-password" minlength="12" required></div>
      <div class="field"><label for="temporary-password-confirm">${tr('repeatPassword')}</label><input id="temporary-password-confirm" name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required></div>
    </div>
    <button type="submit">${tr('resetPassword')}</button>
  </form>`);
}

const ROLE_LABEL_KEYS = { reader: 'roleReader', writer: 'roleWriter', owner: 'roleOwner' };

function roleLabel(role) {
  return tr(ROLE_LABEL_KEYS[normalizeSpaceRole(role)]);
}

function roleOptions(selected) {
  return SPACE_ROLES.map((role) => `<option value="${role}"${role === normalizeSpaceRole(selected) ? ' selected' : ''}>${escapeHtml(roleLabel(role))}</option>`).join('');
}

/**
 * One checkbox plus one role selector per space.
 *
 * The keys are namespaced per space (`space:<id>` / `role:<id>`) rather than repeated under
 * a single name, because `form()` builds a plain object from URLSearchParams and a repeated
 * key would silently collapse to its last value — which is exactly how a multi-space grant
 * would quietly become a single-space one.
 */
function spaceGrantPicker() {
  if (store.state.spaces.length === 0) return `<p class="muted">${tr('noSpacesYet')}</p>`;
  return `<div class="grant-list">${store.state.spaces.map((space) => `<div class="grant-row">
    <label class="grant-name"><input type="checkbox" name="space:${space.id}" value="on"> <span>${escapeHtml(space.name)}</span></label>
    <select name="role:${space.id}" aria-label="${escapeHtml(tr('accessLevel'))}">${roleOptions('reader')}</select>
  </div>`).join('')}</div>`;
}

function readSpaceGrants(values) {
  const grants = [];
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith('space:') || value !== 'on') continue;
    const spaceId = key.slice('space:'.length);
    if (!store.state.spaces.some((space) => space.id === spaceId)) continue;
    grants.push({ spaceId, role: normalizeSpaceRole(values[`role:${spaceId}`]) });
  }
  // The form used to carry a single `spaceId` with an implicit reader role. Anything that
  // still posts that shape keeps working rather than silently creating an account with no
  // access at all, which is the failure mode that would be hardest to notice.
  if (grants.length === 0 && values.spaceId && store.state.spaces.some((space) => space.id === values.spaceId)) {
    grants.push({ spaceId: values.spaceId, role: normalizeSpaceRole(values.role) });
  }
  return grants;
}

function dashboard(current, notice = '') {
  const spaces = store.state.spaces.map((space) => `<tr><td><strong>${escapeHtml(space.name)}</strong>${space.description ? `<div class="muted">${escapeHtml(space.description)}</div>` : ''}</td><td><code>${space.id}</code></td><td>${escapeHtml(space.updatedAt || tr('unpublished'))}</td><td><form method="post" action="/admin/pairing"><input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="spaceId" value="${space.id}"><button class="secondary" type="submit">${tr('createPairing')}</button></form>${space.updatedAt ? `<form method="post" action="/admin/spaces/clear-request"><input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="spaceId" value="${space.id}"><button class="danger" type="submit">${tr('deletePublication')}</button></form>` : ''}</td></tr>`).join('');
  const spaceOptions = store.state.spaces.map((space) => `<option value="${space.id}">${escapeHtml(space.name)}</option>`).join('');
  const users = store.state.users.map((user) => {
    const access = store.state.memberships.filter((entry) => entry.userId === user.id).map((entry) => {
      const space = store.state.spaces.find((candidate) => candidate.id === entry.spaceId);
      // An owner's own membership is neither revocable nor editable here: it is what makes
      // the space publishable at all, and downgrading it from a dropdown would strand it.
      const controls = entry.role === 'owner'
        ? `<span class="role-tag">${escapeHtml(roleLabel(entry.role))}</span>`
        : `<form method="post" action="/admin/access/role"><input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="userId" value="${user.id}"><input type="hidden" name="spaceId" value="${entry.spaceId}"><select name="role" aria-label="${escapeHtml(tr('accessLevel'))}">${roleOptions(entry.role)}</select><button class="secondary" type="submit">${tr('updateRole')}</button></form>`
        + `<form method="post" action="/admin/access/revoke"><input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="userId" value="${user.id}"><input type="hidden" name="spaceId" value="${entry.spaceId}"><button class="secondary" type="submit" title="${tr('revokeAccess')}" aria-label="${tr('revokeAccess')}">×</button></form>`;
      return `<div class="access-chip"><span>${escapeHtml(space?.name || entry.spaceId)}</span>${controls}</div>`;
    }).join('') || '<span class="muted">—</span>';
    const grant = user.role === 'admin' || !spaceOptions ? '' : `<form method="post" action="/admin/access/grant"><input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="userId" value="${user.id}"><select name="spaceId">${spaceOptions}</select><select name="role" aria-label="${escapeHtml(tr('accessLevel'))}">${roleOptions('reader')}</select><button class="secondary">${tr('grantAccess')}</button></form>`;
    const reset = user.role === 'member' ? `<a href="/admin/users/password?userId=${encodeURIComponent(user.id)}">${tr('resetPassword')}</a>` : `<a href="/account">${tr('changeMyPassword')}</a>`;
    return `<tr><td><strong>${escapeHtml(user.email)}</strong></td><td>${escapeHtml(user.role)}</td><td><div class="access-list">${access}</div></td><td>${grant}<p>${reset}</p></td></tr>`;
  }).join('');
  const devices = store.state.deviceTokens.map((device) => {
    const space = store.state.spaces.find((entry) => entry.id === device.spaceId);
    return `<tr><td><strong>${escapeHtml(device.deviceName)}</strong></td><td>${escapeHtml(space?.name || device.spaceId)}</td><td>${escapeHtml(device.lastUsedAt || tr('never'))}</td><td><form method="post" action="/admin/devices/revoke"><input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="tokenHash" value="${device.hash}"><button class="secondary" type="submit">${tr('revokeAccess')}</button></form></td></tr>`;
  }).join('');
  return page(tr('administration'), `<div class="page-heading">
    <div><p class="eyebrow">${tr('administration')}</p><h1>${escapeHtml(store.state.settings.name)}</h1><p class="lead">${tr('serverReady')}</p></div>
    <div class="heading-actions"><a class="button-link" href="/account">${tr('accountTitle')}</a><form method="post" action="/logout"><input type="hidden" name="csrf" value="${current.session.csrf}"><button class="secondary" type="submit">${tr('signOut')}</button></form></div>
  </div>
  <section class="server-overview">
    <div>
      <div class="status-line"><span class="status-dot"></span>${tr('administration')}</div>
      <div class="section-title"><h2>${tr('mcpUrl')}</h2>${helpTip(tr('mcpHelp'), tr('moreInformation'))}</div>
      <div class="endpoint"><code>${escapeHtml(mcpResource())}</code></div>
    </div>
    <div class="metric-grid">
      <div class="metric"><strong>${store.state.spaces.length}</strong><span>${tr('spaces')}</span></div>
      <div class="metric"><strong>${store.state.users.length}</strong><span>${tr('usersAccess')}</span></div>
      <div class="metric"><strong>${store.state.deviceTokens.length}</strong><span>${tr('publisherDevices')}</span></div>
    </div>
  </section>
  ${notice ? `<p class="ok">${escapeHtml(notice)}</p>` : ''}
  <section class="section"><div class="grid">
    <form class="card" method="post" action="/admin/spaces">
      <div class="section-header"><div><div class="section-title"><h2>${tr('newSpace')}</h2>${helpTip(tr('newSpaceHelp'), tr('moreInformation'))}</div></div></div>
      <input type="hidden" name="csrf" value="${current.session.csrf}">
      <div class="field"><label for="space-name">${tr('name')}</label><input id="space-name" name="name" required></div>
      <div class="field"><label for="space-description">${tr('description')}</label><input id="space-description" name="description"></div>
      <button type="submit">${tr('createSpace')}</button>
    </form>
    <form class="card" method="post" action="/admin/users">
      <div class="section-header"><div><div class="section-title"><h2>${tr('newUser')}</h2>${helpTip(tr('newUserHelp'), tr('moreInformation'))}</div></div></div>
      <input type="hidden" name="csrf" value="${current.session.csrf}">
      <div class="field"><label for="reader-email">${tr('email')}</label><input id="reader-email" name="email" type="email" autocomplete="off" required></div>
      <div class="field"><label for="reader-password">${tr('temporaryPasswordLabel')}</label><input id="reader-password" name="password" type="password" autocomplete="new-password" minlength="12" required></div>
      <div class="field"><div class="label-line"><label>${tr('spacesAndRoles')}</label>${helpTip(tr('newUserSpacesHelp'), tr('moreInformation'))}</div>${spaceGrantPicker()}</div>
      <p class="muted role-legend"><strong>${escapeHtml(tr('roleReader'))}:</strong> ${tr('roleReaderHelp')}<br><strong>${escapeHtml(tr('roleWriter'))}:</strong> ${tr('roleWriterHelp')}<br><strong>${escapeHtml(tr('roleOwner'))}:</strong> ${tr('roleOwnerHelp')}</p>
      <button type="submit">${tr('createUser')}</button>
    </form>
  </div></section>
  <section class="section">
    <div class="section-header"><div><div class="section-title"><h2>${tr('spaces')}</h2>${helpTip(tr('spacesHelp'), tr('moreInformation'))}</div></div></div>
    <div class="table-shell"><table><thead><tr><th>${tr('name')}</th><th>ID</th><th>${tr('lastPublication')}</th><th>${tr('actions')}</th></tr></thead><tbody>${spaces || `<tr><td class="empty" colspan="4">${tr('noSpaces')}</td></tr>`}</tbody></table></div>
  </section>
  <section class="section">
    <div class="section-header"><div><div class="section-title"><h2>${tr('usersAccess')}</h2>${helpTip(tr('usersHelp'), tr('moreInformation'))}</div><p>${tr('mcpReadOnly')}</p></div></div>
    <div class="table-shell"><table><thead><tr><th>${tr('email')}</th><th>${tr('account')}</th><th>${tr('access')}</th><th>${tr('actions')}</th></tr></thead><tbody>${users}</tbody></table></div>
  </section>
  <section class="section">
    <div class="section-header"><div><div class="section-title"><h2>${tr('publisherDevices')}</h2>${helpTip(tr('devicesHelp'), tr('moreInformation'))}</div></div></div>
    <div class="table-shell"><table><thead><tr><th>${tr('device')}</th><th>${tr('space')}</th><th>${tr('lastUsed')}</th><th>${tr('actions')}</th></tr></thead><tbody>${devices || `<tr><td class="empty" colspan="4">${tr('noDevices')}</td></tr>`}</tbody></table></div>
  </section>`);
}

function languageReturnPath(req) {
  try {
    const referer = new URL(String(req.headers.referer || ''), publicUrl());
    if (referer.origin === new URL(publicUrl()).origin) return `${referer.pathname}${referer.search}`;
  } catch {
    // A missing or malformed Referer simply returns to the appropriate home page.
  }
  return store.state.users.length === 0 ? '/setup' : '/';
}

const corpusRoutes = createCorpusRoutes({ readSnapshot });

const apiRoutes = createApiRoutes({
  store, authorize, json, body, jsonBody, fs,
  readSnapshot, invalidateSnapshot, expandSnapshot,
  publicUrl, language, rateLimit, clearRateLimit, mib,
  // A function, not a snapshot: the public URL is only settled once /setup has run.
  resourceMap,
  corpus: corpusRoutes,
  limits: {
    maxSnapshotBytes: MAX_SNAPSHOT_BYTES,
    maxSnapshotJsonBytes: MAX_SNAPSHOT_JSON_BYTES,
    maxAssetBytes: MAX_ASSET_BYTES,
    maxSpaceAssetBytes: MAX_SPACE_ASSET_BYTES,
    maxVectorBytes: MAX_VECTOR_BYTES,
    assetGraceMs: ASSET_GRACE_MS,
  },
});

async function route(req, res) {
  const url = new URL(req.url || '/', publicUrl());
  if (url.pathname === '/language' && req.method === 'POST') {
    const values = await form(req, 4 * 1024);
    const selected = normalizeServerLanguage(values.language);
    const secure = publicUrl().startsWith('https:') ? '; Secure' : '';
    return redirect(res, languageReturnPath(req), {
      'set-cookie': `nodus_language=${encodeURIComponent(selected)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`,
    });
  }
  if (url.pathname === '/healthz') return json(res, 200, { ok: true, service: 'nodus-server', version: '0.1.0', language: language() });
  if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp') return json(res, 200, { resource: mcpResource(), authorization_servers: [publicUrl()], scopes_supported: ['profile', 'spaces.read', 'materials.read'], resource_documentation: `${publicUrl()}/` });
  // The client API is a separate protected resource from MCP: an AI client reads the corpus,
  // an app also writes to it, and a token for one must not be accepted by the other.
  if (url.pathname === '/.well-known/oauth-protected-resource/api/v1') return json(res, 200, { resource: apiResource(), authorization_servers: [publicUrl()], scopes_supported: [...SCOPES], resource_documentation: `${publicUrl()}/` });
  if (url.pathname === '/.well-known/oauth-authorization-server' || url.pathname === '/.well-known/openid-configuration') return json(res, 200, { issuer: publicUrl(), authorization_endpoint: `${publicUrl()}/oauth/authorize`, token_endpoint: `${publicUrl()}/oauth/token`, registration_endpoint: `${publicUrl()}/oauth/register`, code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], scopes_supported: [...SCOPES] });
  if (url.pathname === '/mcp') return handleMcp(req, res);

  // The client API answers before the "no users yet" gate below. A machine surface should
  // get a 401 it can act on, not a 303 to an HTML setup page it cannot read. Routes this
  // handler does not recognise fall through untouched.
  if (await apiRoutes.handle(req, res, url)) return;

  if (store.state.users.length === 0) {
    if (url.pathname !== '/setup') return redirect(res, '/setup');
    if (req.method === 'GET') return html(res, 200, setupPage());
    if (!rateLimit(req, res, 'setup-global', 60, 60 * 60_000, 'all')) return;
    if (!rateLimit(req, res, 'setup-ip', 10, 15 * 60_000)) return;
    const values = await form(req, AUTH_BODY_BYTES);
    try {
      if (!SETUP_TOKEN || SETUP_TOKEN.length < 16 || !safeEqual(values.setupToken, SETUP_TOKEN)) throw new Error('The setup token is invalid.');
      store.state.settings = { ...store.state.settings, name: String(values.name).trim(), publicUrl: normalizePublicUrl(values.publicUrl), language: 'en' };
      const user = store.createUser(values.email, values.password, 'admin');
      const raw = store.createSession(user.id);
      return redirect(res, '/', { 'set-cookie': `nodus_session=${encodeURIComponent(raw)}; Path=/; HttpOnly; SameSite=Lax${publicUrl().startsWith('https://') ? '; Secure' : ''}` });
    } catch (error) { return html(res, 400, setupPage(error instanceof Error ? error.message : String(error))); }
  }

  if (url.pathname === '/setup') return redirect(res, '/login');

  if (url.pathname === '/login') {
    if (req.method === 'GET') return html(res, 200, loginPage(url.searchParams.get('next') || '/'));
    if (!rateLimit(req, res, 'login-global', 240, 5 * 60_000, 'all')) return;
    if (!rateLimit(req, res, 'login-ip', 60, 15 * 60_000)) return;
    const values = await form(req, AUTH_BODY_BYTES);
    const accountIdentity = digest(String(values.email || '').trim().toLowerCase());
    if (!rateLimit(req, res, 'login-account', 10, 10 * 60_000, accountIdentity)) return;
    const user = store.authenticate(values.email, values.password);
    if (!user) return html(res, 401, loginPage(values.next || '/', tr('invalidLogin')));
    clearRateLimit('login-account', accountIdentity);
    const raw = store.createSession(user.id);
    const next = String(values.next || '/');
    const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    const destination = safeNext === '/' && user.role !== 'admin' ? '/account' : safeNext;
    return redirect(res, destination, { 'set-cookie': `nodus_session=${encodeURIComponent(raw)}; Path=/; HttpOnly; SameSite=Lax${publicUrl().startsWith('https://') ? '; Secure' : ''}` });
  }

  if (url.pathname === '/account' && req.method === 'GET') {
    const current = requireSession(req, res); if (!current) return;
    return html(res, 200, accountPage(current, url.searchParams.get('notice') || ''));
  }
  if (url.pathname === '/account/password' && req.method === 'POST') {
    const current = requireSession(req, res); if (!current) return;
    if (!rateLimit(req, res, 'password-change', 10, 15 * 60_000)) return;
    const values = await form(req, AUTH_BODY_BYTES);
    if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    if (values.newPassword !== values.confirmPassword) return html(res, 400, accountPage(current, '', 'The new passwords do not match.'));
    try {
      store.changePassword(current.user.id, values.currentPassword, values.newPassword, current.session.hash);
      return redirect(res, '/account?notice=' + encodeURIComponent('Password updated. Your other sessions and OAuth connections have been signed out.'));
    } catch (error) {
      return html(res, 400, accountPage(current, '', error instanceof Error ? error.message : String(error)));
    }
  }

  if (url.pathname === '/admin/users/password' && req.method === 'GET') {
    const current = requireSession(req, res, true); if (!current) return;
    const user = store.state.users.find((entry) => entry.id === url.searchParams.get('userId') && entry.role === 'member');
    if (!user) return html(res, 404, page(tr('error'), `<h1>${tr('readerNotFound')}</h1>`));
    return html(res, 200, resetPasswordPage(current, user));
  }
  if (url.pathname === '/admin/users/password' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    if (!rateLimit(req, res, 'password-reset', 20, 15 * 60_000)) return;
    const values = await form(req, AUTH_BODY_BYTES);
    if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    const user = store.state.users.find((entry) => entry.id === values.userId && entry.role === 'member');
    if (!user) return html(res, 404, page(tr('error'), `<h1>${tr('readerNotFound')}</h1>`));
    if (values.newPassword !== values.confirmPassword) return html(res, 400, resetPasswordPage(current, user, 'The new passwords do not match.'));
    try {
      store.resetPassword(user.id, values.newPassword);
      return redirect(res, '/?notice=' + encodeURIComponent(`Password reset for ${user.email}.`));
    } catch (error) {
      return html(res, 400, resetPasswordPage(current, user, error instanceof Error ? error.message : String(error)));
    }
  }

  if (url.pathname === '/oauth/register' && req.method === 'POST') {
    if (!rateLimit(req, res, 'oauth-register-global', 300, 60 * 60_000, 'all')) return;
    if (!rateLimit(req, res, 'oauth-register', 30, 60 * 60_000)) return;
    if (store.state.oauthClients.length >= 10_000) return json(res, 503, { error: 'registration_capacity_reached' });
    const input = await jsonBody(req, 64 * 1024);
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
    if (!client || !client.redirect_uris.includes(redirectUri) || !knownResource(resource) || url.searchParams.get('response_type') !== 'code' || url.searchParams.get('code_challenge_method') !== 'S256') return html(res, 400, page('OAuth', `<h1>${tr('invalidOauth')}</h1>`));
    const requestedInput = (url.searchParams.get('scope') || 'profile spaces.read materials.read').split(/\s+/).filter((scope) => SCOPES.has(scope));
    const requested = requestedInput.length > 0 ? requestedInput : ['materials.read'];
    const hidden = [...url.searchParams].map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`).join('');
    return html(res, 200, page(tr('authorize'), `<div class="page-heading"><div><p class="eyebrow">${tr('oauthProtected')}</p><h1>${tr('connectClient', { name: escapeHtml(client.client_name) })}</h1><p class="lead">${tr('assignedOnly', { email: escapeHtml(current.user.email) })}</p></div></div><div class="card"><h2>${tr('appCan')}</h2><ul>${requested.map((scope) => `<li>${escapeHtml(scope)}</li>`).join('')}</ul><form method="post" action="/oauth/authorize">${hidden}<input type="hidden" name="csrf" value="${current.session.csrf}"><button type="submit">${tr('authorize')}</button></form></div>`), oauthRedirectHeaders(redirectUri));
  }

  if (url.pathname === '/oauth/authorize' && req.method === 'POST') {
    const current = requireSession(req, res); if (!current) return;
    const values = await form(req, 64 * 1024);
    if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    const client = store.state.oauthClients.find((entry) => entry.client_id === values.client_id);
    const grantedResource = String(values.resource || mcpResource());
    if (!client || !client.redirect_uris.includes(values.redirect_uri) || values.code_challenge_method !== 'S256' || !knownResource(grantedResource)) return html(res, 400, page('OAuth', `<h1>${tr('invalidOauth')}</h1>`));
    const scopeInput = String(values.scope || 'profile spaces.read materials.read').split(/\s+/).filter((scope) => SCOPES.has(scope));
    const scopes = scopeInput.length > 0 ? scopeInput : ['materials.read'];
    const raw = token(24);
    // The code carries the resource it was granted for, and /oauth/token copies it onto the
    // access token, so the surface a client asked for is the only one it can reach.
    store.state.oauthCodes.push({ hash: digest(raw), userId: current.user.id, clientId: client.client_id, redirectUri: values.redirect_uri, codeChallenge: values.code_challenge, scopes, resource: grantedResource, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() });
    store.save();
    const target = new URL(values.redirect_uri); target.searchParams.set('code', raw); if (values.state) target.searchParams.set('state', values.state);
    return redirect(res, target.toString(), oauthRedirectHeaders(values.redirect_uri));
  }

  if (url.pathname === '/oauth/token' && req.method === 'POST') {
    if (!rateLimit(req, res, 'oauth-token-global', 1_000, 60_000, 'all')) return;
    if (!rateLimit(req, res, 'oauth-token', 120, 60_000)) return;
    const values = await form(req, AUTH_BODY_BYTES);
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
    if (!rateLimit(req, res, 'pair-global', 300, 15 * 60_000, 'all')) return;
    if (!rateLimit(req, res, 'pair', 30, 15 * 60_000)) return;
    const input = await jsonBody(req, AUTH_BODY_BYTES);
    store.cleanup();
    const pairing = store.state.pairingCodes.find((entry) => entry.hash === digest(String(input.code || '').toUpperCase()));
    if (!pairing) return json(res, 401, { error: 'Invalid or expired pairing code.' });
    pairing.usedAt = new Date().toISOString();
    const raw = token();
    store.state.deviceTokens.push({ hash: digest(raw), userId: pairing.userId, spaceId: pairing.spaceId, deviceName: String(input.deviceName || 'Nodus Desktop').slice(0, 120), createdAt: new Date().toISOString(), lastUsedAt: null });
    store.save();
    const space = store.state.spaces.find((entry) => entry.id === pairing.spaceId);
    return json(res, 200, { accessToken: raw, space: { id: space.id, name: space.name }, server: { name: store.state.settings.name, publicUrl: publicUrl(), language: language() } });
  }

  if (url.pathname === '/api/v1/settings/language' && req.method === 'PUT') {
    const raw = bearer(req);
    const device = store.state.deviceTokens.find((entry) => entry.hash === digest(raw));
    // The web interface language is server-wide, so only a space owner may change it.
    // A reader's replica must not be able to relabel the administration UI for everyone.
    const role = device ? effectiveRole(device) : null;
    if (!device || !role || !canRole(role, 'own')) return json(res, 401, { error: 'Invalid or revoked device token.' });
    const input = await jsonBody(req, 4 * 1024);
    if (typeof input.language !== 'string' || normalizeServerLanguage(input.language) !== input.language) {
      return json(res, 400, { error: 'Unsupported server language.' });
    }
    store.state.settings.language = input.language;
    device.lastUsedAt = new Date().toISOString();
    store.save();
    return json(res, 200, { language: normalizeServerLanguage(store.state.settings.language) });
  }

  if (url.pathname === '/') {
    const current = requireSession(req, res); if (!current) return;
    if (current.user.role !== 'admin') return redirect(res, '/account');
    return html(res, 200, dashboard(current, url.searchParams.get('notice') || ''));
  }
  if (url.pathname === '/logout' && req.method === 'POST') {
    const current = requireSession(req, res); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    store.state.sessions = store.state.sessions.filter((entry) => entry.hash !== current.session.hash); store.save();
    return redirect(res, '/login', { 'set-cookie': 'nodus_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
  }
  if (url.pathname === '/admin/spaces' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    const space = { id: randomUUID(), name: String(values.name || '').trim(), description: String(values.description || '').trim(), createdAt: new Date().toISOString(), updatedAt: null, revision: '', bytes: 0 };
    if (!space.name) return html(res, 400, dashboard(current, 'The space needs a name.'));
    store.state.spaces.push(space); store.state.memberships.push({ userId: current.user.id, spaceId: space.id, role: 'owner' }); store.save();
    return redirect(res, '/?notice=' + encodeURIComponent('Space created.'));
  }
  if (url.pathname === '/admin/spaces/clear-request' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    const space = store.state.spaces.find((entry) => entry.id === values.spaceId);
    if (!space) return html(res, 404, page(tr('error'), `<h1>${tr('spaceNotFound')}</h1>`));
    return html(res, 200, page(tr('deletePublication'), `<div class="page-heading"><div><p class="eyebrow">${tr('spaces')}</p><h1>${tr('deletePublicationHeading')}</h1></div><a class="button-link" href="/">${tr('cancel')}</a></div><div class="card danger-card"><p>${tr('deletePublicationHelp', { name: `<strong>${escapeHtml(space.name)}</strong>` })}</p><form method="post" action="/admin/spaces/clear"><input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="spaceId" value="${space.id}"><button class="danger" type="submit">${tr('deletePermanently')}</button></form></div>`));
  }
  if (url.pathname === '/admin/spaces/clear' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    const space = store.state.spaces.find((entry) => entry.id === values.spaceId);
    if (!space) return html(res, 404, page(tr('error'), `<h1>${tr('spaceNotFound')}</h1>`));
    store.removeSnapshot(space.id); snapshotCache.delete(space.id);
    // Deleting a publication also revokes its publishers so an open desktop app
    // cannot silently recreate data the administrator has just removed.
    store.state.deviceTokens = store.state.deviceTokens.filter((entry) => entry.spaceId !== space.id);
    store.state.pairingCodes = store.state.pairingCodes.filter((entry) => entry.spaceId !== space.id);
    space.updatedAt = null; space.revision = ''; space.vault = null; space.bytes = 0; store.save();
    return redirect(res, '/?notice=' + encodeURIComponent('Publication deleted from the server.'));
  }
  if (url.pathname === '/admin/users' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    try {
      const user = store.createUser(values.email, values.password, 'member');
      // A researcher is rarely given exactly one space, and their level differs per space:
      // reader on a colleague's corpus, writer on the shared one. Both are set here at once.
      const grants = readSpaceGrants(values);
      for (const grant of grants) store.state.memberships.push({ userId: user.id, spaceId: grant.spaceId, role: grant.role });
      if (grants.length) store.save();
      return redirect(res, '/?notice=' + encodeURIComponent(`User created with access to ${grants.length} space(s).`));
    } catch (error) { return html(res, 400, dashboard(current, error instanceof Error ? error.message : String(error))); }
  }
  if (url.pathname === '/admin/access/role' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    const entry = membership(values.userId, values.spaceId);
    if (!entry || entry.role === 'owner') return html(res, 400, dashboard(current, 'That access cannot be changed here.'));
    if (!isSpaceRole(values.role)) return html(res, 400, dashboard(current, 'Unknown access level.'));
    entry.role = values.role;
    // Nothing else to revoke: authorize() reads the role live on every request, so an
    // already-issued device or OAuth token drops to the new level on its very next call.
    store.save();
    return redirect(res, '/?notice=' + encodeURIComponent('Access level updated.'));
  }
  if (url.pathname === '/admin/access/grant' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    const user = store.state.users.find((entry) => entry.id === values.userId);
    const space = store.state.spaces.find((entry) => entry.id === values.spaceId);
    if (!user || !space) return html(res, 400, dashboard(current, 'Invalid user or space.'));
    const role = isSpaceRole(values.role) ? values.role : 'reader';
    if (!membership(user.id, space.id)) { store.state.memberships.push({ userId: user.id, spaceId: space.id, role }); store.save(); }
    return redirect(res, '/?notice=' + encodeURIComponent(`Access granted (${role}).`));
  }
  if (url.pathname === '/admin/access/revoke' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    const entry = membership(values.userId, values.spaceId);
    if (!entry || entry.role === 'owner') return html(res, 400, dashboard(current, 'That access cannot be revoked here.'));
    store.state.memberships = store.state.memberships.filter((candidate) => candidate !== entry);
    store.state.deviceTokens = store.state.deviceTokens.filter((device) => device.userId !== values.userId || device.spaceId !== values.spaceId);
    store.save();
    return redirect(res, '/?notice=' + encodeURIComponent('Access revoked.'));
  }
  if (url.pathname === '/admin/devices/revoke' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    store.state.deviceTokens = store.state.deviceTokens.filter((entry) => entry.hash !== values.tokenHash); store.save();
    return redirect(res, '/?notice=' + encodeURIComponent('Device revoked.'));
  }
  if (url.pathname === '/admin/pairing' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    if (!membership(current.user.id, values.spaceId)) return html(res, 403, page(tr('error'), '<h1>No access to that space.</h1>'));
    const raw = `${token(4).slice(0, 4)}-${token(4).slice(0, 4)}`.toUpperCase();
    store.state.pairingCodes.push({ hash: digest(raw), userId: current.user.id, spaceId: values.spaceId, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), usedAt: null }); store.save();
    return html(res, 200, page(tr('createPairing'), `<div class="page-heading"><div><p class="eyebrow">${tr('publisherDevices')}</p><h1>${tr('connectDesktop')}</h1></div><a class="button-link" href="/">${tr('back')}</a></div><div class="card code-panel"><p>${tr('pairingHelp')}</p><h2><code>${raw}</code></h2><p class="muted">${tr('pairingExpiry')}</p></div>`));
  }
  return json(res, 404, { error: 'not_found' });
}

const server = http.createServer((req, res) => {
  const requestLanguage = normalizeServerLanguage(cookies(req).nodus_language || store.state.settings.language);
  languageContext.run(requestLanguage, () => {
    Promise.resolve(route(req, res)).catch((error) => {
      console.error('[server]', error);
      if (!res.headersSent) json(res, Number(error?.statusCode) || 500, { error: Number(error?.statusCode) ? error.message : tr('internalError') });
      else res.end();
    });
  });
});

server.requestTimeout = 5 * 60_000;
server.headersTimeout = 65_000;
server.maxHeadersCount = 100;
server.maxRequestsPerSocket = 1_000;
server.listen(PORT, HOST, () => {
  console.log(`[nodus-server] listening on http://${HOST}:${PORT}`);
  console.log(`[nodus-server] public URL: ${publicUrl()}`);
  if (!ENVIRONMENT_ADMIN_CONFIGURED && store.state.users.length === 0 && (!SETUP_TOKEN || SETUP_TOKEN.length < 16)) console.warn('[nodus-server] Configure NODUS_ADMIN_EMAIL + NODUS_ADMIN_PASSWORD, or provide a temporary NODUS_SETUP_TOKEN with at least 16 characters.');
});
