import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DESKTOP_AUTHORITY_MODE, DESKTOP_PUBLISHED_STORAGE_KIND, NativeVaultError,
  NATIVE_STORAGE_KIND, SERVER_AUTHORITY_MODE, NativeVaultStore,
} from '../nativeVaultStore.mjs';

function errorStatus(error) {
  if (!(error instanceof NativeVaultError)) return 500;
  if (new Set(['csrf_failed', 'owner_required']).has(error.code)) return 403;
  return new Set(['revision_conflict', 'idempotency_conflict', 'content_constraint', 'vault_exists']).has(error.code) ? 409
    : new Set(['vault_not_found', 'command_not_found', 'content_not_found', 'content_table_not_found']).has(error.code) ? 404 : 400;
}

function view(space, native = true) {
  if (!space) return null;
  return {
    id: space.id, name: space.name, description: space.description || '', vaultType: space.vaultType || space.vault?.type || 'academic',
    storageKind: native ? (space.storageKind || NATIVE_STORAGE_KIND) : DESKTOP_PUBLISHED_STORAGE_KIND,
    authorityMode: native ? (space.authorityMode || SERVER_AUTHORITY_MODE) : DESKTOP_AUTHORITY_MODE,
    schemaVersion: Number(space.schemaVersion || 0), revision: Number(space.revision || 0),
    initializationState: space.initializationState || (native ? 'ready' : 'published'),
    createdAt: space.createdAt || null, updatedAt: space.updatedAt || null,
    role: space.role || null,
  };
}

function ensureSessionMutation(auth, req, checkCsrf, sameOrigin) {
  if (auth?.principal?.kind !== 'session') return true;
  if (typeof sameOrigin !== 'function' || !sameOrigin(req)) throw new NativeVaultError('csrf_failed', 'A same-origin request is required.');
  const supplied = req.headers['x-csrf-token'] || req.headers['x-csrf'] || '';
  if (!checkCsrf || !checkCsrf(auth.principal.session, supplied)) throw new NativeVaultError('csrf_failed', 'A valid CSRF token is required.');
  return true;
}

// Only collection-style reads are projected while a native vault has no
// published snapshot. Private annotations, operational state, and mutation
// endpoints must continue through api.mjs so their access controls and
// persistence semantics remain intact.
const SAFE_LEGACY_READ_HEADS = new Set([
  'academic', 'authors', 'works', 'archive-items', 'archive-repositories', 'archive-units', 'archive-excerpts',
  'databases', 'database-pages', 'debates', 'deep-research', 'dictionary', 'events', 'gaps', 'graph',
  'ideas', 'library', 'notes', 'passages', 'persons', 'places', 'primary-sources', 'projects',
  'reading-path', 'relationships', 'search', 'source-analyses', 'state-of-art', 'study-agenda',
  'study-courses', 'study-ideas', 'study-materials', 'study-questions', 'study-plans', 'study-schedule',
  'teaching-exams', 'teaching-rubrics', 'testimony-codes', 'testimony-contrasts', 'testimony-interviews',
  'testimony-transcripts', 'themes', 'world-articles', 'world-entries', 'world-groups', 'world-maps',
  'world-questions', 'world-rules', 'world-scenes', 'world-threads', 'writing',
]);

const LEGACY_CONTENT_TABLES = Object.freeze({
  notes: 'notes', 'note-folders': 'note_folders', ideas: 'ideas', works: 'works', authors: 'authors', passages: 'passages', themes: 'themes', gaps: 'gaps', persons: 'persons', places: 'places', events: 'events', relationships: 'relationships',
  'world-groups': 'world_groups', 'world-scenes': 'world_scenes', 'world-maps': 'world_maps', 'world-articles': 'world_articles', 'world-entries': 'world_articles',
  'world-threads': 'world_threads', 'world-rules': 'world_rules', 'world-questions': 'world_questions',
  'study-courses': 'study_courses', 'study-subjects': 'study_subjects', 'study-topics': 'study_topics', 'study-materials': 'study_materials',
  'study-docs': 'study_docs', 'study-questions': 'study_questions', 'study-flashcards': 'study_flashcards', 'study-plans': 'study_plans',
  'study-calendar': 'study_calendar_events', 'study-goals': 'study_goals', 'study-schedule': 'study_schedule_periods',
  'teaching-exams': 'teaching_exams', 'teaching-rubrics': 'teaching_rubrics', 'archive-items': 'archive_items', 'archive-folders': 'archive_folders',
  'archive-repositories': 'archive_repositories', 'archive-units': 'archive_description_units', 'archive-excerpts': 'archive_excerpts',
  'source-analyses': 'archive_source_analyses', 'testimony-interviews': 'testimony_interviews', 'testimony-transcripts': 'testimony_transcripts',
  'testimony-codes': 'testimony_codes', 'testimony-contrasts': 'testimony_contrasts', databases: 'db_databases', 'database-pages': 'pages',
});

// Native read-throughs must retain the named dossier keys consumed by the Web
// readers. Returning only `{ table, row }` makes a record technically reachable
// but renders it as an empty generic detail (and drops its domain title).
const LEGACY_DETAIL_KEYS = Object.freeze({
  persons: 'person', places: 'place', events: 'event', relationships: 'relationship',
  'world-groups': 'group', 'world-scenes': 'scene', 'world-maps': 'map', 'world-articles': 'article', 'world-entries': 'entry',
  'world-threads': 'thread', 'world-rules': 'rule', 'world-questions': 'question',
  'study-courses': 'course', 'study-materials': 'material', 'study-docs': 'document', 'study-questions': 'question', 'study-plans': 'plan',
  'study-flashcards': 'card', 'study-calendar': 'event', 'study-schedule': 'period',
  'teaching-exams': 'exam', 'teaching-rubrics': 'rubric', 'archive-items': 'item', 'archive-repositories': 'repository',
  'archive-units': 'unit', 'archive-excerpts': 'excerpt', 'source-analyses': 'analysis',
  'testimony-interviews': 'interview', 'testimony-transcripts': 'transcript', 'testimony-codes': 'code', 'testimony-contrasts': 'contrast',
  databases: 'database', 'database-pages': 'page', ideas: 'idea', works: 'work', authors: 'author', passages: 'passage', themes: 'theme', gaps: 'gap',
});

/** Server-native vault lifecycle and typed command boundary. */
export function createNativeVaultRoutes({ store, authorize, json, jsonBody, body, checkCsrf, sameOrigin, root }) {
  const native = new NativeVaultStore(root);

  async function allVisible(user) {
    const old = store.state.spaces.filter((space) => store.state.memberships.some((entry) => entry.userId === user.id && entry.spaceId === space.id))
      .map((space) => ({ ...space, role: store.state.memberships.find((entry) => entry.userId === user.id && entry.spaceId === space.id)?.role }));
    const known = new Set(old.map((space) => space.id));
    return [...old.map((space) => view(space, space.storageKind === NATIVE_STORAGE_KIND)), ...(await native.list()).filter((space) => !known.has(space.id)).map((space) => {
      const membership = store.state.memberships.find((entry) => entry.userId === user.id && entry.spaceId === space.id);
      return membership ? view({ ...space, role: membership.role }) : null;
    }).filter(Boolean)];
  }

  function authFor(req, res, spaceId, need) {
    return authorize(req, res, { spaceId, need, via: ['session', 'device', 'oauth'], resource: 'api', scope: need === 'read' ? 'materials.read' : 'materials.write' });
  }

  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/v2/vaults')) return false;
    let segments;
    try { segments = url.pathname.slice('/api/v2/vaults'.length).split('/').filter(Boolean).map(decodeURIComponent); }
    catch { json(res, 400, { error: 'bad_path' }); return true; }

    if (!segments.length) {
      const auth = authorize(req, res, { via: ['session', 'device', 'oauth'], resource: 'api', scope: 'materials.read' });
      if (!auth) return true;
      if (req.method === 'GET') { json(res, 200, { vaults: await allVisible(auth.user) }); return true; }
      if (req.method !== 'POST') { json(res, 405, { error: 'method_not_allowed' }); return true; }
      if (auth.user.role !== 'admin') { json(res, 403, { error: 'admin_required' }); return true; }
      try {
        ensureSessionMutation(auth, req, checkCsrf, sameOrigin);
        const created = await native.create(await jsonBody(req, 64 * 1024));
        store.state.spaces.push({ ...created, vaultType: created.vaultType, updatedAt: created.updatedAt, revision: created.revision, storageKind: NATIVE_STORAGE_KIND, authorityMode: SERVER_AUTHORITY_MODE, initializationState: created.initializationState });
        store.state.memberships.push({ userId: auth.user.id, spaceId: created.id, role: 'owner' });
        try { store.save(); } catch (error) { store.state.spaces = store.state.spaces.filter((entry) => entry.id !== created.id); store.state.memberships = store.state.memberships.filter((entry) => entry.spaceId !== created.id); await native.delete(created.id); throw error; }
        json(res, 201, { vault: view({ ...created, role: 'owner' }) });
      } catch (error) { json(res, errorStatus(error), { error: error.code || 'vault_create_failed', error_description: error.message }); }
      return true;
    }

    const id = segments[0]; let operation = segments[1];
    const space = store.state.spaces.find((entry) => entry.id === id);
    const nativeSpace = await native.get(id).catch(() => null);
    if (!space && !nativeSpace) { json(res, 404, { error: 'vault_not_found' }); return true; }
    // Legacy desktop-published spaces remain readable through the new listing contract but
    // cannot be mutated by a server-native lifecycle operation.
    const legacy = !nativeSpace;
    const auth = authFor(req, res, id, operation === 'commands' && req.method === 'POST' ? 'write' : 'read');
    if (!auth) return true;
    // Generic, direct authoring boundary. It uses only canonical Desktop tables and the
    // existing server_native_commands ledger; no server-only content tables are invented.
    if (operation === 'content' && segments[2]) {
      if (legacy) { json(res, 409, { error: 'desktop_published_read_only' }); return true; }
      const table = segments[2]; const keyPart = segments[3];
      if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) { json(res, 405, { error: 'method_not_allowed' }); return true; }
      const needWrite = ['POST', 'PATCH', 'DELETE'].includes(req.method);
      const contentAuth = needWrite ? authorize(req, res, { spaceId: id, need: 'write', via: ['session', 'device', 'oauth'], resource: 'api', scope: 'materials.write' }) : auth;
      if (!contentAuth) return true;
      try {
        const metadata = nativeSpace || space;
        if (req.method === 'GET') {
          if (keyPart) {
            const contract = await native.contentContract(id, metadata.vaultType || metadata.vault?.type || 'academic');
            const definition = contract.tables[table]; if (!definition) throw new NativeVaultError('content_table_not_found', 'This content table is not available.');
            let key = {};
            if (url.searchParams.has('key')) { try { key = JSON.parse(url.searchParams.get('key')); } catch { throw new NativeVaultError('invalid_content_key', 'The key query parameter must be JSON.'); } }
            else if (definition.key.length === 1) key = { [definition.key[0]]: keyPart };
            else throw new NativeVaultError('invalid_content_key', 'A composite content key must be supplied as JSON.');
            const result = await native.getContent(id, table, metadata.vaultType || metadata.vault?.type || 'academic', key);
            if (!result) throw new NativeVaultError('content_not_found', 'The content record does not exist.');
            json(res, 200, result); return true;
          }
          json(res, 200, await native.listContent(id, table, metadata.vaultType || metadata.vault?.type || 'academic', Object.fromEntries(url.searchParams))); return true;
        }
        ensureSessionMutation(contentAuth, req, checkCsrf, sameOrigin);
        const input = await jsonBody(req, 512 * 1024);
        // URL keys are collection-specific (`item_id`, `person_id`, `group_id`,
        // etc.), never universally `id`.  Resolve the canonical key from the
        // same contract used by GET details; composite keys must remain explicit
        // in the JSON body rather than silently duplicating one path segment.
        let pathKey;
        if (keyPart && !input.key) {
          const contentContract = await native.contentContract(id, metadata.vaultType || metadata.vault?.type || 'academic');
          const definition = contentContract.tables[table];
          if (definition?.key?.length === 1) pathKey = { [definition.key[0]]: keyPart };
        }
        const result = await native.mutateContent(id, table, metadata.vaultType || metadata.vault?.type || 'academic', req.method === 'POST' ? 'create' : req.method === 'PATCH' ? 'update' : 'delete', { ...input, key: input.key || pathKey }, contentAuth.user.id);
        json(res, result.duplicate ? 200 : req.method === 'POST' ? 201 : 200, result); return true;
      } catch (error) { json(res, errorStatus(error), { error: error.code || 'content_operation_failed', error_description: error.message, ...(error.details || {}) }); return true; }
    }
    if (operation === 'content-contract' && req.method === 'GET') {
      if (legacy) { json(res, 409, { error: 'desktop_published_read_only' }); return true; }
      const metadata = nativeSpace || space; json(res, 200, await native.contentContract(id, metadata.vaultType || metadata.vault?.type || 'academic')); return true;
    }
    if (req.method === 'GET' && !operation) { json(res, 200, { vault: view({ ...(nativeSpace || space), role: auth.role }, !legacy) }); return true; }
    if (!operation && req.method === 'PATCH') operation = 'rename';
    if (!operation && req.method === 'DELETE') operation = 'delete';
    if (!operation) { json(res, 405, { error: 'method_not_allowed' }); return true; }
    if (legacy && ['rename', 'duplicate', 'reset', 'import', 'export', 'delete', 'commands'].includes(operation)) { json(res, 409, { error: 'desktop_published_read_only' }); return true; }
    try {
      if (operation === 'rename' || (operation === undefined && req.method === 'PATCH')) {
        ensureSessionMutation(auth, req, checkCsrf, sameOrigin); if (auth.role !== 'owner') throw new NativeVaultError('owner_required', 'Only a vault owner may rename it.');
        const input = await jsonBody(req, 64 * 1024); const result = await native.mutateMetadata(id, input.expectedRevision, { name: input.name });
        Object.assign(space || {}, result); if (space) store.save(); json(res, 200, { vault: view({ ...result, role: auth.role }) }); return true;
      }
      if (operation === 'duplicate' && req.method === 'POST') {
        ensureSessionMutation(auth, req, checkCsrf, sameOrigin); if (auth.role !== 'owner') throw new NativeVaultError('owner_required', 'Only a vault owner may duplicate it.');
        const result = await native.duplicate(id, await jsonBody(req, 64 * 1024));
        store.state.spaces.push({ ...result, storageKind: NATIVE_STORAGE_KIND, authorityMode: SERVER_AUTHORITY_MODE, initializationState: result.initializationState }); store.state.memberships.push({ userId: auth.user.id, spaceId: result.id, role: 'owner' });
        try { store.save(); } catch (error) { store.state.spaces = store.state.spaces.filter((entry) => entry.id !== result.id); store.state.memberships = store.state.memberships.filter((entry) => entry.spaceId !== result.id); await native.delete(result.id); throw error; }
        json(res, 201, { vault: view({ ...result, role: 'owner' }) }); return true;
      }
      if (operation === 'reset' && req.method === 'POST') {
        ensureSessionMutation(auth, req, checkCsrf, sameOrigin); if (auth.role !== 'owner') throw new NativeVaultError('owner_required', 'Only a vault owner may reset it.');
        const input = await jsonBody(req, 64 * 1024); const result = await native.reset(id, input.expectedRevision); Object.assign(space || {}, result); if (space) store.save(); json(res, 200, { vault: view({ ...result, role: auth.role }) }); return true;
      }
      if (operation === 'delete' && req.method === 'DELETE') {
        ensureSessionMutation(auth, req, checkCsrf, sameOrigin); if (auth.role !== 'owner') throw new NativeVaultError('owner_required', 'Only a vault owner may delete it.');
        const input = url.searchParams.get('expectedRevision'); await native.delete(id, input == null ? undefined : Number(input));
        store.state.spaces = store.state.spaces.filter((entry) => entry.id !== id); store.state.memberships = store.state.memberships.filter((entry) => entry.spaceId !== id); store.save(); json(res, 200, { ok: true, id }); return true;
      }
      if (operation === 'export' && req.method === 'GET') {
        if (auth.role !== 'owner') throw new NativeVaultError('owner_required', 'Only a vault owner may export it.');
        const bytes = await native.exportFile(id); res.writeHead(200, { 'content-type': 'application/vnd.sqlite3', 'content-length': String(bytes.length), 'content-disposition': `attachment; filename="nodus-${id}.sqlite"` }); res.end(bytes); return true;
      }
      if (operation === 'import' && req.method === 'POST') {
        ensureSessionMutation(auth, req, checkCsrf, sameOrigin); if (auth.role !== 'owner') throw new NativeVaultError('owner_required', 'Only a vault owner may import it.');
        const contentType = String(req.headers['content-type'] || '').toLowerCase();
        let input = {}; let bytes;
        if (contentType.includes('json')) {
          input = await jsonBody(req, 128 * 1024 * 1024);
          const encoded = String(input.base64 || input.database || input.data || '');
          if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new NativeVaultError('invalid_import', 'A valid base64 SQLite database is required.');
          bytes = Buffer.from(encoded, 'base64');
        } else {
          bytes = await body(req, 128 * 1024 * 1024);
          input.expectedRevision = url.searchParams.get('expectedRevision') == null ? undefined : Number(url.searchParams.get('expectedRevision'));
        }
        if (!bytes || bytes.length < 100) throw new NativeVaultError('invalid_import', 'The import is empty or is not a SQLite database.');
        const temporary = path.join(root, `.native-import-${process.pid}-${randomUUID()}.sqlite`); try { fs.writeFileSync(temporary, bytes, { mode: 0o600 }); const result = await native.importFile(id, temporary, input.expectedRevision); Object.assign(space || {}, result); if (space) store.save(); json(res, 200, { vault: view({ ...result, role: auth.role }) }); } finally { fs.rmSync(temporary, { force: true }); } return true;
      }
      if (operation === 'commands' && segments[2] && req.method === 'GET') { const command = await native.getCommand(id, segments[2]); if (!command || (command.actorUserId !== auth.user.id && auth.role !== 'owner')) throw new NativeVaultError('command_not_found', 'Command not found.'); json(res, 200, { command }); return true; }
      if (operation === 'commands') {
        if (req.method === 'GET') { const commands = (await native.listCommands(id)).filter((entry) => entry.actorUserId === auth.user.id || auth.role === 'owner'); json(res, 200, { commands }); return true; }
        if (req.method === 'POST') { ensureSessionMutation(auth, req, checkCsrf, sameOrigin); const command = await native.createCommand(id, await jsonBody(req, 512 * 1024), auth.user.id); json(res, command.duplicate ? 200 : 201, { command, duplicate: command.duplicate }); return true; }
      }
      json(res, 405, { error: 'method_not_allowed' });
    } catch (error) { json(res, errorStatus(error), { error: error.code || 'vault_operation_failed', error_description: error.message, ...(error.details || {}) }); }
    return true;
  }

  /**
   * Read-through for the existing desktop web contract. A new server-owned vault has a real
   * SQLite schema but no published snapshot yet; returning an empty projection lets Home and
   * every collection open while typed commands populate it, without manufacturing a desktop
   * publication or touching legacy snapshot files.
   */
  async function handleLegacyRead(req, res, url) {
    if (!url.pathname.startsWith('/api/v1/spaces/') || !['GET', 'HEAD'].includes(req.method)) return false;
    const segments = url.pathname.slice('/api/v1/spaces/'.length).split('/').filter(Boolean).map(decodeURIComponent);
    if (!segments[0]) return false;
    // Leave private and operational subroutes to the existing API router. In
    // particular, intercepting personal-annotations would turn a private
    // request into an unauthenticated empty projection.
    if (segments.length > 1) {
      const head = segments[1];
      if (!SAFE_LEGACY_READ_HEADS.has(head)) return false;
      if (head === 'search' && segments[2] === 'semantic') return false;
      if (head === 'library' && segments.length > 2) return false;
      if (head === 'databases' && !(segments[2] && segments[3] === 'analysis' && segments.length === 4)) return false;
    }
    const metadata = await native.get(segments[0]).catch(() => null);
    if (!metadata) return false;
    const auth = authorize(req, res, { spaceId: segments[0], need: 'read', via: ['session', 'device', 'oauth'], resource: 'api', scope: 'materials.read' });
    if (!auth) return true;
    const nativeType = metadata.vaultType || metadata.vault?.type || 'academic';
    // Database Analysis is a browser-capable read surface rather than a normal
    // collection route. Native databases have no published snapshot for the
    // corpus router to consume, so provide the same safe normalized projection
    // directly from the native SQLite file.
    if (segments[1] === 'databases' && segments[2] && segments[3] === 'analysis' && segments.length === 4 && nativeType === 'databases') {
      try {
        const result = await native.databaseAnalysis(metadata.id, nativeType, segments[2]);
        json(res, 200, result);
      } catch (error) {
        if (error instanceof NativeVaultError && error.code === 'content_not_found') json(res, 404, { error: error.code, error_description: error.message });
        else throw error;
      }
      return true;
    }
    const legacyTable = segments.length > 1 ? LEGACY_CONTENT_TABLES[segments[1]] : null;
    if (legacyTable && segments.length <= 2) {
      try {
        const listed = await native.listContent(metadata.id, legacyTable, nativeType, Object.fromEntries(url.searchParams));
        json(res, 200, listed); return true;
      } catch (error) {
        // A denied/private table must not turn into an apparently valid empty projection.
        // Prosopography's legacy route is intentionally kept routable for old clients,
        // but its identity-bearing collection is an explicit empty response, never a
        // generic table projection (the aggregate contract is served elsewhere).
        if (error instanceof NativeVaultError && error.code === 'content_table_denied' && nativeType === 'prosopography') {
          const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 100));
          const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
          json(res, 200, { items: [], total: 0, limit, offset, hasMore: false, revision: metadata.revision, vault: { type: metadata.vaultType, name: metadata.name } }); return true;
        }
        if (error instanceof NativeVaultError && error.code === 'content_table_not_found') {
          const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 100));
          const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
          json(res, 200, { items: [], total: 0, limit, offset, hasMore: false, revision: metadata.revision, vault: { type: metadata.vaultType, name: metadata.name } }); return true;
        }
        if (error instanceof NativeVaultError && error.code === 'content_table_denied') return false;
        throw error;
      }
    }
    if (legacyTable && segments.length === 3) {
      try {
        const contract = await native.contentContract(metadata.id, nativeType); const definition = contract.tables[legacyTable];
        if (!definition) return false;
        if (definition.key.length !== 1) return false;
        const result = await native.getContent(metadata.id, legacyTable, nativeType, { [definition.key[0]]: segments[2] });
        if (!result) return false;
        const dossierKey = LEGACY_DETAIL_KEYS[segments[1]];
        json(res, 200, dossierKey ? { [dossierKey]: result.row, revision: result.revision } : result);
        return true;
      } catch (error) { if (error instanceof NativeVaultError) return false; throw error; }
    }
    if (segments.length === 1) {
      json(res, 200, { space: { id: metadata.id, name: metadata.name, description: metadata.description, updatedAt: metadata.updatedAt, revision: metadata.revision }, vault: { type: metadata.vaultType, name: metadata.name }, schemaVersion: metadata.schemaVersion, snapshotFormatVersion: null, generatedAt: null, capabilities: null, assets: 0, counts: {} });
    } else {
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 100));
      const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
      json(res, 200, { items: [], total: 0, limit, offset, hasMore: false, revision: metadata.revision, vault: { type: metadata.vaultType, name: metadata.name } });
    }
    return true;
  }

  return { handle, handleLegacyRead, native };
}
