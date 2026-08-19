import { authorize } from './auth.mjs';
import { handleCorpus } from './corpus.mjs';
import { HttpError, all, clampInteger, first, json, readJson, safeJsonParse } from './util.mjs';

const PROTOCOLS = new Set(['2025-11-25', '2025-06-18', '2025-03-26']);
const WORLD_ENTITIES = {
  character: { table: 'persons', id: 'person_id', title: 'display_name' }, place: { table: 'places', id: 'place_id', title: 'name' },
  group: { table: 'world_groups', id: 'group_id', title: 'name' }, scene: { table: 'world_scenes', id: 'scene_id', title: 'title' },
  article: { table: 'world_articles', id: 'article_id', title: 'title' }, map: { table: 'world_maps', id: 'map_id', title: 'name' },
  thread: { table: 'world_threads', id: 'thread_id', title: 'title' }, rule: { table: 'world_rules', id: 'rule_id', title: 'title' },
  question: { table: 'world_questions', id: 'question_id', title: 'question' }, secret: { table: 'world_secrets', id: 'secret_id', title: 'title' },
  event: { table: 'events', id: 'event_id', title: 'label' },
};

const TOOLS = [
  { name: 'nodus_list_spaces', title: 'List Nodus spaces', description: 'Lists the shared Nodus vaults this account can read.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'nodus_get_space_summary', title: 'Get vault summary', description: 'Returns counts and publication metadata for one authorized vault.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' } }, required: ['spaceId'], additionalProperties: false } },
  { name: 'nodus_search', title: 'Search Nodus', description: 'Searches canonical text in one shared vault.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['spaceId', 'query'], additionalProperties: false } },
  { name: 'nodus_get_work', title: 'Get work', description: 'Gets one bibliographic work and its related material.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, id: { type: 'string' } }, required: ['spaceId', 'id'], additionalProperties: false } },
  { name: 'nodus_get_idea', title: 'Get idea', description: 'Gets one idea and its direct relations.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, id: { type: 'string' } }, required: ['spaceId', 'id'], additionalProperties: false } },
  { name: 'nodus_world_get_overview', title: 'Get world overview', description: 'Returns counts and manuscript totals for a Worldbuilding vault.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' } }, required: ['spaceId'], additionalProperties: false } },
  { name: 'nodus_world_search', title: 'Search fictional world', description: 'Searches characters, places, scenes and other canonical world material.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['spaceId', 'query'], additionalProperties: false } },
  { name: 'nodus_world_list_entities', title: 'List world entities', description: 'Lists one world entity kind.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, kind: { type: 'string', enum: Object.keys(WORLD_ENTITIES) }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 }, offset: { type: 'integer', minimum: 0 } }, required: ['spaceId', 'kind'], additionalProperties: false } },
  { name: 'nodus_world_get_entity', title: 'Get world entity', description: 'Gets one Worldbuilding entity.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, kind: { type: 'string', enum: Object.keys(WORLD_ENTITIES) }, id: { type: 'string' } }, required: ['spaceId', 'kind', 'id'], additionalProperties: false } },
  { name: 'nodus_world_get_manuscript', title: 'Get world manuscript', description: 'Returns ordered scene metadata and optional current prose.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, includeText: { type: 'boolean' } }, required: ['spaceId'], additionalProperties: false } },
].map((tool) => ({ ...tool, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, securitySchemes: [{ type: 'oauth2', scopes: ['materials.read'] }] }));

function result(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

async function responseValue(response) {
  const value = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new HttpError(response.status, value.error || 'tool_error', value.error_description || 'The Nodus tool request failed.');
  return value;
}

async function corpusTool(env, auth, request, spaceId, segments, search = {}) {
  const url = new URL(request.url);
  url.pathname = `/api/v1/spaces/${encodeURIComponent(spaceId)}/${segments.map(encodeURIComponent).join('/')}`;
  url.search = new URLSearchParams(search).toString();
  const scoped = await authorize(env, request, { via: ['oauth'], resource: `${new URL(request.url).origin}/mcp`, scope: 'materials.read', spaceId, need: 'reader' });
  return responseValue(await handleCorpus(env, scoped, new Request(url, { method: 'GET', headers: request.headers }), segments));
}

async function worldContext(env, request, spaceId) {
  await authorize(env, request, { via: ['oauth'], resource: `${new URL(request.url).origin}/mcp`, scope: 'materials.read', spaceId, need: 'reader' });
  const space = await first(env.DB, 'SELECT id, active_generation, vault_json FROM spaces WHERE id = ?1', spaceId);
  if (space?.active_generation == null) throw new HttpError(409, 'not_published', 'The vault has not been published.');
  const vault = safeJsonParse(space.vault_json, null);
  if (vault?.type !== 'worldbuilding') throw new HttpError(400, 'wrong_vault_type', 'This tool only applies to a published Worldbuilding vault.');
  return { ...space, vault };
}

async function worldRows(env, space, table, limit = 1000) {
  const records = await all(env.DB, `SELECT row_json FROM published_rows
    WHERE space_id = ?1 AND generation = ?2 AND table_name = ?3 ORDER BY row_key LIMIT ?4`, space.id, space.active_generation, table, limit);
  return records.map((row) => safeJsonParse(row.row_json, {}));
}

async function worldEntityDetail(env, space, kind, id) {
  const definition = WORLD_ENTITIES[kind];
  if (!definition) return null;
  const candidates = await worldRows(env, space, definition.table);
  const entity = candidates.find((row) => String(row[definition.id] ?? '') === String(id));
  if (!entity) return null;
  const load = async (table, predicate) => (await worldRows(env, space, table)).filter(predicate);
  const one = async (table, predicate) => (await load(table, predicate))[0] || null;
  const related = {};
  if (kind === 'character') {
    related.profile = await one('character_profiles', (row) => String(row.person_id) === String(id));
    related.names = await load('person_names', (row) => String(row.person_id) === String(id));
    related.abilities = await load('character_abilities', (row) => String(row.person_id) === String(id));
    related.affiliations = await load('character_affiliations', (row) => String(row.person_id) === String(id));
    related.appearances = await load('scene_characters', (row) => String(row.person_id) === String(id));
    related.eventParticipants = await load('event_participants', (row) => String(row.person_id) === String(id));
    related.ownedSecrets = await load('world_secrets', (row) => String(row.owner_person_id) === String(id));
    related.knownSecrets = await load('secret_knowers', (row) => String(row.person_id) === String(id));
  } else if (kind === 'place') {
    related.profile = await one('place_profiles', (row) => String(row.place_id) === String(id));
    related.children = candidates.filter((row) => String(row.parent_id) === String(id));
    related.maps = await load('world_maps', (row) => String(row.place_id) === String(id));
    related.markers = await load('map_markers', (row) => String(row.place_id) === String(id));
    related.scenes = await load('world_scenes', (row) => String(row.place_id) === String(id));
    related.inhabitants = await load('person_places', (row) => String(row.place_id) === String(id));
  } else if (kind === 'group') {
    related.affiliations = await load('character_affiliations', (row) => String(row.group_id) === String(id));
    related.threadParties = await load('thread_parties', (row) => row.party_kind === 'group' && String(row.party_id) === String(id));
  } else if (kind === 'scene') {
    related.cast = await load('scene_characters', (row) => String(row.scene_id) === String(id));
    related.manuscript = await one('world_scene_text', (row) => String(row.scene_id) === String(id));
    related.day = await one('world_scene_days', (row) => String(row.scene_id) === String(id));
    related.beats = await load('world_beats', (row) => String(row.scene_id) === String(id));
    related.questions = await load('world_questions', (row) => row.anchor_kind === 'scene' && String(row.anchor_id) === String(id));
  } else if (kind === 'article') {
    related.links = await load('world_links', (row) => row.source_kind === 'article' && String(row.source_id) === String(id));
    related.backlinks = await load('world_links', (row) => row.target_kind === 'article' && String(row.target_id) === String(id));
  } else if (kind === 'map') {
    related.layers = await load('map_layers', (row) => String(row.map_id) === String(id));
    related.markers = await load('map_markers', (row) => String(row.map_id) === String(id));
    related.travelModes = await load('map_travel_modes', (row) => String(row.map_id) === String(id));
  } else if (kind === 'thread') {
    related.parties = await load('thread_parties', (row) => String(row.thread_id) === String(id));
    related.beats = await load('world_beats', (row) => String(row.thread_id) === String(id));
  } else if (kind === 'rule') related.beats = await load('world_beats', (row) => row.thread_kind === 'rule' && String(row.thread_id) === String(id));
  else if (kind === 'question') related.options = await load('world_question_options', (row) => String(row.question_id) === String(id));
  else if (kind === 'secret') related.knowers = await load('secret_knowers', (row) => String(row.secret_id) === String(id));
  else if (kind === 'event') {
    related.participants = await load('event_participants', (row) => String(row.event_id) === String(id));
    related.worldDate = await one('event_world_dates', (row) => String(row.event_id) === String(id));
  }
  return { kind, id, entity, related };
}

async function callTool(env, auth, request, name, args) {
  if (name === 'nodus_list_spaces') {
    const spaces = await all(env.DB, `SELECT s.id,s.name,s.description,s.updated_at,s.revision,s.vault_json,m.role FROM memberships m JOIN spaces s ON s.id=m.space_id WHERE m.user_id=?1 ORDER BY s.name`, auth.user_id);
    return { spaces: spaces.map((space) => ({ id: space.id, name: space.name, description: space.description, updatedAt: space.updated_at, revision: space.revision, role: space.role, vault: safeJsonParse(space.vault_json, null) })) };
  }
  const spaceId = String(args?.spaceId || '');
  if (!spaceId) throw new HttpError(400, 'bad_arguments', 'spaceId is required.');
  if (name === 'nodus_get_space_summary') return corpusTool(env, auth, request, spaceId, []);
  if (name === 'nodus_search') return corpusTool(env, auth, request, spaceId, ['search'], { q: String(args.query || ''), limit: String(clampInteger(args.limit, 1, 50, 20)) });
  if (name === 'nodus_get_work') return corpusTool(env, auth, request, spaceId, ['works', String(args.id || '')]);
  if (name === 'nodus_get_idea') return corpusTool(env, auth, request, spaceId, ['ideas', String(args.id || '')]);
  if (name === 'nodus_world_get_overview') {
    const space = await worldContext(env, request, spaceId);
    const counts = {};
    for (const [kind, definition] of Object.entries(WORLD_ENTITIES)) {
      const value = await first(env.DB, `SELECT COUNT(*) AS count FROM published_rows WHERE space_id=?1 AND generation=?2 AND table_name=?3`, space.id, space.active_generation, definition.table);
      counts[kind] = Number(value?.count || 0);
    }
    const [calendar, eras, months, sceneText, chapters, books] = await Promise.all([
      worldRows(env, space, 'world_calendar', 1), worldRows(env, space, 'world_calendar_eras'), worldRows(env, space, 'world_calendar_months'),
      worldRows(env, space, 'world_scene_text', 5000), worldRows(env, space, 'world_chapter_breaks', 5000), worldRows(env, space, 'world_manuscript_starts', 5000),
    ]);
    return { vault: space.vault, counts, calendar: { settings: calendar[0] || null, eras, months }, manuscript: {
      scenes: counts.scene || 0, words: sceneText.reduce((sum, row) => sum + Number(row.word_count || 0), 0), chapters: chapters.length, books: books.length,
    } };
  }
  if (name === 'nodus_world_search') {
    await worldContext(env, request, spaceId);
    return corpusTool(env, auth, request, spaceId, ['search'], { q: String(args.query || ''), limit: String(clampInteger(args.limit, 1, 100, 30)) });
  }
  if (name === 'nodus_world_list_entities') {
    const definition = WORLD_ENTITIES[String(args.kind || '')];
    if (!definition) throw new HttpError(400, 'bad_arguments', 'The entity kind is not supported.');
    const space = await worldContext(env, request, spaceId);
    const query = String(args.query || '').trim().toLowerCase(); const limit = clampInteger(args.limit, 1, 200, 100); const offset = clampInteger(args.offset, 0, 1_000_000, 0);
    const filter = query ? 'AND instr(lower(search_text), ?4) > 0' : '';
    const records = await all(env.DB, `SELECT row_json FROM published_rows WHERE space_id=?1 AND generation=?2 AND table_name=?3 ${filter} ORDER BY row_key LIMIT ?${query ? 5 : 4} OFFSET ?${query ? 6 : 5}`,
    space.id, space.active_generation, definition.table, ...(query ? [query] : []), limit, offset);
    const totalRow = await first(env.DB, `SELECT COUNT(*) AS count FROM published_rows WHERE space_id=?1 AND generation=?2 AND table_name=?3 ${filter}`,
    space.id, space.active_generation, definition.table, ...(query ? [query] : []));
    const entities = records.map((row) => safeJsonParse(row.row_json, {})).map((row) => ({ ...row, entityKind: args.kind, id: row[definition.id], title: row[definition.title] || '' }));
    const total = Number(totalRow?.count || 0);
    return { kind: args.kind, entities, total, limit, offset, hasMore: offset + entities.length < total };
  }
  if (name === 'nodus_world_get_entity') {
    const space = await worldContext(env, request, spaceId);
    const detail = await worldEntityDetail(env, space, String(args.kind || ''), String(args.id || ''));
    if (!detail) throw new HttpError(404, 'not_found', 'The world entity was not found.');
    return detail;
  }
  if (name === 'nodus_world_get_manuscript') {
    const space = await worldContext(env, request, spaceId);
    const [scenes, textRows, chapterRows, bookRows] = await Promise.all([
      worldRows(env, space, 'world_scenes', 5000), worldRows(env, space, 'world_scene_text', 5000),
      worldRows(env, space, 'world_chapter_breaks', 5000), worldRows(env, space, 'world_manuscript_starts', 5000),
    ]);
    const texts = new Map(textRows.map((row) => [String(row.scene_id), row]));
    const chapters = new Map(chapterRows.map((row) => [String(row.scene_id), row])); const books = new Map(bookRows.map((row) => [String(row.scene_id), row]));
    return { scenes: scenes.sort((a, b) => Number(a.narrative_order || 0) - Number(b.narrative_order || 0)).map((scene) => {
      const manuscript = texts.get(String(scene.scene_id)) || null; const text = typeof manuscript?.text === 'string' ? manuscript.text : null;
      return { ...scene, manuscript: manuscript ? { word_count: manuscript.word_count || 0, updated_at: manuscript.updated_at || null,
        ...(args.includeText === true ? { text } : { text_snippet: text ? text.slice(0, 800) : null }) } : null,
      chapter: chapters.get(String(scene.scene_id)) || null, book: books.get(String(scene.scene_id)) || null };
    }), includeText: args.includeText === true };
  }
  throw new HttpError(404, 'tool_not_found', 'The requested Nodus tool does not exist.');
}

export async function handleMcp(env, request) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  const resource = `${new URL(request.url).origin}/mcp`;
  let auth;
  try { auth = await authorize(env, request, { via: ['oauth'], resource, scope: 'materials.read' }); } catch (error) {
    if (error.status === 401) return json({ error: 'unauthorized', error_description: error.message }, 401, { 'www-authenticate': `Bearer resource_metadata="${new URL(request.url).origin}/.well-known/oauth-protected-resource/mcp"` });
    throw error;
  }
  const input = await readJson(request, 1024 * 1024);
  if (input.method === 'notifications/initialized') return new Response(null, { status: 202 });
  const protocol = PROTOCOLS.has(request.headers.get('mcp-protocol-version')) ? request.headers.get('mcp-protocol-version') : '2025-11-25';
  let rpcResult;
  if (input.method === 'initialize') rpcResult = { protocolVersion: PROTOCOLS.has(input.params?.protocolVersion) ? input.params.protocolVersion : protocol,
    capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'nodus-cloudflare', version: String(env.NODUS_VERSION || '1.0.0'), license: 'AGPL-3.0-only', sourceCodeUrl: String(env.NODUS_SOURCE_URL || '') },
    instructions: 'Consult only spaces authorized for this user. Use nodus_list_spaces first. Shared data is read-only; use nodus_world_* tools for Worldbuilding vaults.' };
  else if (input.method === 'tools/list') rpcResult = { tools: TOOLS };
  else if (input.method === 'tools/call') {
    try { rpcResult = result(await callTool(env, auth, request, String(input.params?.name || ''), input.params?.arguments || {})); }
    catch (error) { rpcResult = { isError: true, content: [{ type: 'text', text: error.message || 'The tool failed.' }] }; }
  } else if (input.method === 'ping') rpcResult = {};
  else return json({ jsonrpc: '2.0', id: input.id ?? null, error: { code: -32601, message: 'Method not found' } }, 200, { 'mcp-protocol-version': protocol });
  return json({ jsonrpc: '2.0', id: input.id ?? null, result: rpcResult }, 200, { 'mcp-protocol-version': protocol });
}
