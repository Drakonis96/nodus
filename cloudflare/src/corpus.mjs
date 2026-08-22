import { getDebate, listDebates } from './generated/debates.mjs';
import {
  workspaceArgumentRoutes,
  workspaceAuthorDossier,
  workspaceAuthorPage,
  workspaceIdeaPage,
  workspaceSynthesisMatrix,
} from './generated/academicWorkspace.mjs';
import { deepResearchReportInput, renderProfessionalReportHtml } from './generated/deepResearchReport.mjs';
import {
  HttpError,
  all,
  clampInteger,
  first,
  html,
  json,
  problem,
  safeJsonParse,
} from './util.mjs';
import { getObject } from './publications.mjs';
import { resolvePublishedRows } from './rows.mjs';

const COLLECTIONS = {
  works: { table: 'works', key: 'works', id: 'nodus_id' },
  ideas: { table: 'ideas', key: 'ideas', id: 'global_id' },
  themes: { table: 'themes', key: 'themes', id: 'theme_id' },
  gaps: { table: 'gaps', key: 'gaps', id: 'id' },
  authors: { table: 'authors', key: 'authors', id: 'author_id' },
  passages: { table: 'passages', key: 'passages', id: 'passage_id' },
  persons: { table: 'persons', key: 'persons', id: 'person_id' },
  places: { table: 'places', key: 'places', id: 'place_id' },
  events: { table: 'events', key: 'events', id: 'event_id' },
  relationships: { table: 'relationships', key: 'relationships', id: 'id' },
  'study-subjects': { table: 'study_subjects', key: 'subjects', id: 'id' },
  'study-courses': { table: 'study_courses', key: 'courses', id: 'id' },
  'study-topics': { table: 'study_topics', key: 'topics', id: 'id' },
  'study-docs': { table: 'study_docs', key: 'docs', id: 'id' },
  'study-materials': { table: 'study_materials', key: 'materials', id: 'id' },
  'study-flashcards': { table: 'study_flashcards', key: 'flashcards', id: 'id' },
  'study-questions': { table: 'study_questions', key: 'questions', id: 'id' },
  'study-plans': { table: 'study_plans', key: 'plans', id: 'id' },
  'study-goals': { table: 'study_goals', key: 'goals', id: 'id' },
  'study-calendar': { table: 'study_calendar_events', key: 'events', id: 'id' },
  'teaching-exams': { table: 'teaching_exams', key: 'exams', id: 'id' },
  'teaching-rubrics': { table: 'teaching_rubrics', key: 'rubrics', id: 'id' },
  databases: { table: 'db_databases', key: 'databases', id: 'id' },
};

const ACADEMIC_WORKSPACE_TABLES = [
  'works', 'authors', 'work_authors', 'zotero_tags', 'work_zotero_tags', 'themes',
  'ideas', 'idea_occurrences', 'idea_theme_links', 'evidence', 'edges', 'edge_feedback',
  'author_relations', 'author_dossier_synthesis', 'synthesis_matrix_cell',
];

const SEARCH_KEYS = {
  works: 'nodus_id', ideas: 'global_id', themes: 'theme_id', gaps: 'id', notes: 'id', passages: 'passage_id',
  persons: 'person_id', character_profiles: 'person_id', places: 'place_id', place_profiles: 'place_id',
  world_groups: 'group_id', world_scenes: 'scene_id', world_scene_text: 'scene_id', world_articles: 'article_id',
  world_threads: 'thread_id', world_rules: 'rule_id', world_questions: 'question_id', world_secrets: 'secret_id',
};

async function activeSpace(env, spaceId) {
  const space = await first(env.DB, 'SELECT * FROM spaces WHERE id = ?1', spaceId);
  if (!space) throw new HttpError(404, 'space_not_found', 'The vault does not exist.');
  if (space.active_generation == null) throw new HttpError(409, 'not_published', 'This vault has not received a publication yet.');
  return space;
}

async function tableRows(env, space, table, options = {}) {
  const limit = clampInteger(options.limit, 1, options.ceiling || 1000, options.fallback || 100);
  const offset = clampInteger(options.offset, 0, Number.MAX_SAFE_INTEGER, 0);
  const query = String(options.query || '').trim();
  let records;
  if (query) {
    const match = query.split(/\s+/).filter(Boolean).slice(0, 8).map((token) => `"${token.replace(/"/g, '""')}"*`).join(' AND ');
    records = await all(env.DB, `SELECT r.row_json FROM published_search f
      JOIN published_rows r ON r.space_id = f.space_id AND CAST(r.generation AS TEXT) = f.generation
        AND r.table_name = f.table_name AND r.row_key = f.row_key
      WHERE f.space_id = ?1 AND f.generation = ?2 AND f.table_name = ?3 AND published_search MATCH ?4
      LIMIT ?5 OFFSET ?6`, space.id, String(space.active_generation), table, match, limit, offset);
  } else {
    records = await all(env.DB, `SELECT row_json FROM published_rows
      WHERE space_id = ?1 AND generation = ?2 AND table_name = ?3 ORDER BY row_key LIMIT ?4 OFFSET ?5`,
      space.id, space.active_generation, table, limit, offset);
  }
  return resolvePublishedRows(env, space.id, records);
}

async function tableCount(env, space, table, query = '') {
  if (!query) {
    const row = await first(env.DB, `SELECT COUNT(*) AS count FROM published_rows
      WHERE space_id = ?1 AND generation = ?2 AND table_name = ?3`, space.id, space.active_generation, table);
    return Number(row?.count || 0);
  }
  const match = String(query).split(/\s+/).filter(Boolean).slice(0, 8).map((token) => `"${token.replace(/"/g, '""')}"*`).join(' AND ');
  const row = await first(env.DB, `SELECT COUNT(*) AS count FROM published_search
    WHERE space_id = ?1 AND generation = ?2 AND table_name = ?3 AND published_search MATCH ?4`, space.id, String(space.active_generation), table, match);
  return Number(row?.count || 0);
}

async function tableRow(env, space, table, idColumn, wanted) {
  // row_key is deliberately opaque and may contain a compound key. JSON extraction is
  // indexed only by the primary access pattern through table+generation; detail pages are
  // bounded to one table and avoid trusting a caller-supplied SQL identifier.
  const records = await all(env.DB, `SELECT row_json FROM published_rows
    WHERE space_id = ?1 AND generation = ?2 AND table_name = ?3`, space.id, space.active_generation, table);
  return (await resolvePublishedRows(env, space.id, records)).find((row) => String(row?.[idColumn] ?? row?.id ?? '') === String(wanted)) ?? null;
}

async function rowsWhere(env, space, table, predicate, ceiling = 20_000) {
  const rows = await tableRows(env, space, table, { limit: ceiling, ceiling, fallback: ceiling });
  return rows.filter(predicate);
}

function responseEtag(space, request) {
  return `W/"${space.revision || 'none'}|${new URL(request.url).pathname}|${new URL(request.url).searchParams.toString()}"`;
}

function cachedJson(space, request, value) {
  const etag = responseEtag(space, request);
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag, 'cache-control': 'private, max-age=0, must-revalidate' } });
  return json(value, 200, { etag, 'cache-control': 'private, max-age=0, must-revalidate' });
}

async function snapshotForTables(env, space, tables) {
  const entries = await Promise.all([...new Set(tables)].map(async (table) => [table, await tableRows(env, space, table, { limit: 100_000, ceiling: 100_000, fallback: 100_000 })]));
  return { tables: Object.fromEntries(entries) };
}

async function academicWorkspace(env, space) {
  return snapshotForTables(env, space, ACADEMIC_WORKSPACE_TABLES);
}

function page(key, items, total, limit, offset) {
  return { [key]: items, total, limit, offset, hasMore: offset + items.length < total };
}

function folderSubtree(folders, rootId) {
  if (!rootId) return null;
  const found = new Set([String(rootId)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      const id = String(folder.id || ''); const parent = String(folder.parent_id || '');
      if (id && found.has(parent) && !found.has(id)) { found.add(id); changed = true; }
    }
  }
  return found;
}

async function listCollection(env, space, request, collection) {
  const url = new URL(request.url);
  const limit = clampInteger(url.searchParams.get('limit'), 1, 200, 100);
  const offset = clampInteger(url.searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER, 0);
  const query = url.searchParams.get('q') || '';
  if (url.searchParams.get('surface') === 'workspace' && collection.table === 'ideas') {
    const result = workspaceIdeaPage(await academicWorkspace(env, space), {
      offset, limit, search: query, type: url.searchParams.get('type') || '', sort: url.searchParams.get('sort') || 'label',
    });
    const { items, ...pageResult } = result;
    return cachedJson(space, request, { ideas: items, ...pageResult, revision: space.revision });
  }
  if (url.searchParams.get('surface') === 'workspace' && collection.table === 'authors') {
    const result = workspaceAuthorPage(await academicWorkspace(env, space), {
      offset, limit, query, synthesis: url.searchParams.get('synthesis') || 'all', sort: url.searchParams.get('sort') || 'surname',
    });
    const { items, ...pageResult } = result;
    return cachedJson(space, request, { authors: items, ...pageResult, revision: space.revision });
  }
  const [items, total] = await Promise.all([
    tableRows(env, space, collection.table, { limit, offset, query, ceiling: 200 }),
    tableCount(env, space, collection.table, query),
  ]);
  return cachedJson(space, request, { ...page(collection.key, items, total, limit, offset), revision: space.revision });
}

async function ideaDetail(env, space, request, idea) {
  const id = String(idea.global_id);
  const snapshot = await snapshotForTables(env, space, ['edges', 'edge_feedback', 'idea_occurrences', 'evidence', 'themes', 'idea_theme_links']);
  const rejected = new Set(snapshot.tables.edge_feedback.filter((row) => row.verdict === 'rejected').flatMap((row) => [
    `${row.type}\0${row.from_id}\0${row.to_id}`, `${row.type}\0${row.to_id}\0${row.from_id}`,
  ]));
  const relations = snapshot.tables.edges.filter((edge) =>
    (String(edge.from_id) === id || String(edge.to_id) === id) && !rejected.has(`${edge.type}\0${edge.from_id}\0${edge.to_id}`));
  const themeLabels = new Map(snapshot.tables.themes.map((theme) => [String(theme.theme_id), theme.label]));
  const themes = snapshot.tables.idea_theme_links.filter((link) => String(link.global_id) === id).map((link) => themeLabels.get(String(link.theme_id))).filter(Boolean);
  return cachedJson(space, request, {
    idea,
    relations,
    occurrences: snapshot.tables.idea_occurrences.filter((row) => String(row.global_id) === id),
    evidence: snapshot.tables.evidence.filter((row) => String(row.global_id) === id),
    themes: [...new Set(themes)],
    revision: space.revision,
  });
}

async function ideaGraph(env, space, request, seed) {
  const url = new URL(request.url);
  const depth = clampInteger(url.searchParams.get('depth'), 1, 3, 1);
  const limit = clampInteger(url.searchParams.get('limit'), 1, 200, 200);
  const snapshot = await snapshotForTables(env, space, ['ideas', 'edges', 'edge_feedback']);
  const rejected = new Set(snapshot.tables.edge_feedback.filter((row) => row.verdict === 'rejected').flatMap((row) => [
    `${row.type}\0${row.from_id}\0${row.to_id}`, `${row.type}\0${row.to_id}\0${row.from_id}`,
  ]));
  const edges = snapshot.tables.edges.filter((edge) => !rejected.has(`${edge.type}\0${edge.from_id}\0${edge.to_id}`));
  const adjacency = new Map();
  for (const edge of edges) {
    for (const node of [String(edge.from_id), String(edge.to_id)]) {
      if (!adjacency.has(node)) adjacency.set(node, []);
      adjacency.get(node).push(edge);
    }
  }
  const seen = new Set([String(seed)]);
  let frontier = [String(seed)];
  for (let level = 0; level < depth && seen.size < limit; level += 1) {
    const next = [];
    for (const node of frontier) for (const edge of adjacency.get(node) || []) for (const candidate of [String(edge.from_id), String(edge.to_id)]) {
      if (!seen.has(candidate) && seen.size < limit) { seen.add(candidate); next.push(candidate); }
    }
    frontier = next;
  }
  return cachedJson(space, request, {
    seedId: String(seed), depth,
    ideas: snapshot.tables.ideas.filter((idea) => seen.has(String(idea.global_id))),
    edges: edges.filter((edge) => seen.has(String(edge.from_id)) && seen.has(String(edge.to_id))),
    truncated: seen.size >= limit,
    revision: space.revision,
  });
}

async function workDetail(env, space, request, work) {
  const id = String(work.nodus_id);
  const [occurrences, ideas, summaries, passageCount] = await Promise.all([
    rowsWhere(env, space, 'idea_occurrences', (row) => String(row.nodus_id) === id),
    tableRows(env, space, 'ideas', { limit: 100_000, ceiling: 100_000, fallback: 100_000 }),
    rowsWhere(env, space, 'work_summaries', (row) => String(row.nodus_id) === id),
    tableCount(env, space, 'passages'),
  ]);
  const ideaIds = new Set(occurrences.map((row) => String(row.global_id)));
  let authors = [];
  try { authors = JSON.parse(work.authors_json || '[]'); } catch { authors = []; }
  const ownPassages = passageCount ? (await rowsWhere(env, space, 'passages', (row) => String(row.nodus_id) === id)).length : 0;
  return cachedJson(space, request, { work: { ...work, authors }, ideas: ideas.filter((idea) => ideaIds.has(String(idea.global_id))), summary: summaries[0] || null, passages: ownPassages, revision: space.revision });
}

async function personDetail(env, space, request, person) {
  const id = String(person.person_id);
  const [names, places, relationships, participants, events, portraits] = await Promise.all([
    rowsWhere(env, space, 'person_names', (row) => String(row.person_id) === id),
    rowsWhere(env, space, 'person_places', (row) => String(row.person_id) === id),
    rowsWhere(env, space, 'relationships', (row) => String(row.from_person) === id || String(row.to_person) === id),
    rowsWhere(env, space, 'event_participants', (row) => String(row.person_id) === id),
    tableRows(env, space, 'events', { limit: 100_000, ceiling: 100_000, fallback: 100_000 }),
    rowsWhere(env, space, 'person_portraits', (row) => String(row.person_id) === id),
  ]);
  const eventIds = new Set(participants.map((row) => String(row.event_id)));
  return cachedJson(space, request, { person, names, places, relationships, events: events.filter((row) => eventIds.has(String(row.event_id))), portrait: portraits[0] || null, revision: space.revision });
}

async function authorDetail(env, space, request, author) {
  const id = String(author.author_id);
  const [links, works, relations, synthesis] = await Promise.all([
    rowsWhere(env, space, 'work_authors', (row) => String(row.author_id) === id),
    tableRows(env, space, 'works', { limit: 100_000, ceiling: 100_000, fallback: 100_000 }),
    rowsWhere(env, space, 'author_relations', (row) => String(row.from_author) === id || String(row.to_author) === id),
    rowsWhere(env, space, 'author_dossier_synthesis', (row) => String(row.author_id) === id),
  ]);
  const workIds = new Set(links.map((row) => String(row.nodus_id)));
  return cachedJson(space, request, { author, works: works.filter((work) => workIds.has(String(work.nodus_id))), relations, synthesis: synthesis[0] || null, revision: space.revision });
}

async function databaseDetail(env, space, request, database) {
  const url = new URL(request.url);
  const id = String(database.id);
  const limit = clampInteger(url.searchParams.get('limit'), 1, 200, 100);
  const offset = clampInteger(url.searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER, 0);
  const byPosition = (a, b) => Number(a.position || 0) - Number(b.position || 0);
  const [columns, views, options, allRows, cells, relations, attachments] = await Promise.all([
    rowsWhere(env, space, 'db_columns', (row) => String(row.database_id) === id),
    rowsWhere(env, space, 'db_views', (row) => String(row.database_id) === id),
    tableRows(env, space, 'db_select_options', { limit: 100_000, ceiling: 100_000, fallback: 100_000 }),
    rowsWhere(env, space, 'db_rows', (row) => String(row.database_id) === id, 100_000),
    tableRows(env, space, 'db_cells', { limit: 200_000, ceiling: 200_000, fallback: 200_000 }),
    tableRows(env, space, 'db_relations', { limit: 200_000, ceiling: 200_000, fallback: 200_000 }),
    tableRows(env, space, 'db_attachments', { limit: 100_000, ceiling: 100_000, fallback: 100_000 }),
  ]);
  columns.sort(byPosition); views.sort(byPosition); allRows.sort(byPosition);
  const selected = allRows.slice(offset, offset + limit);
  const rowIds = new Set(selected.map((row) => String(row.id)));
  const columnIds = new Set(columns.map((row) => String(row.id)));
  const publication = await first(env.DB, 'SELECT manifest_json FROM publications WHERE space_id = ?1 AND generation = ?2', space.id, space.active_generation);
  const images = new Map((safeJsonParse(publication?.manifest_json, {})?.assets || [])
    .filter((asset) => asset.kind === 'db_attachment').map((asset) => [String(asset.key?.[0] || ''), asset]));
  return cachedJson(space, request, {
    database, columns, views, options: options.filter((row) => columnIds.has(String(row.column_id))).sort(byPosition),
    rows: selected, cells: cells.filter((row) => rowIds.has(String(row.row_id))), relations: relations.filter((row) => rowIds.has(String(row.row_id))).sort(byPosition),
    attachments: attachments.filter((row) => rowIds.has(String(row.row_id))).map(({ extracted_text: _ignored, ...row }) => {
      const asset = images.get(String(row.id));
      return { ...row, hash: asset?.hash || null, thumbHash: asset?.thumbHash || null, imageMime: asset?.mime || null };
    }).sort(byPosition),
    total: allRows.length, limit, offset, hasMore: offset + selected.length < allRows.length, revision: space.revision,
  });
}

async function notesRoute(env, space, request, rest) {
  const url = new URL(request.url);
  const folders = await tableRows(env, space, 'note_folders', { limit: 10_000, ceiling: 10_000, fallback: 10_000 });
  const notes = (await tableRows(env, space, 'notes', { limit: 100_000, ceiling: 100_000, fallback: 100_000 })).filter((note) => !note.trashed_at);
  if (rest[0]) {
    const note = notes.find((entry) => String(entry.id) === decodeURIComponent(rest[0]));
    return note ? cachedJson(space, request, { note, revision: space.revision }) : problem(404, 'not_found');
  }
  const folder = url.searchParams.get('folderId');
  const kind = url.searchParams.get('kind');
  const query = String(url.searchParams.get('q') || '').toLowerCase();
  const limit = clampInteger(url.searchParams.get('limit'), 1, 200, 100);
  const offset = clampInteger(url.searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER, 0);
  const folderIds = url.searchParams.get('recursive') === '1' ? folderSubtree(folders, folder) : null;
  const filtered = notes.filter((note) => !folder || (folderIds ? folderIds.has(String(note.folder_id || '')) : String(note.folder_id || '') === folder))
    .filter((note) => !kind || String(note.kind || 'markdown') === kind)
    .filter((note) => !query || Object.values(note).some((value) => typeof value === 'string' && value.toLowerCase().includes(query)))
    .map((note) => ({ ...note, content: undefined, snippet: String(note.content || '').replace(/\s+/g, ' ').slice(0, 240) }));
  return cachedJson(space, request, { ...page('notes', filtered.slice(offset, offset + limit), filtered.length, limit, offset), folders, counts: { notes: notes.filter((note) => note.kind !== 'idea').length, ideas: notes.filter((note) => note.kind === 'idea').length }, revision: space.revision });
}

export async function lexicalSearch(env, space, query, limit = 20) {
  const needle = String(query || '').trim();
  if (!needle) return [];
  const match = needle.split(/\s+/).filter(Boolean).slice(0, 8).map((token) => `"${token.replace(/"/g, '""')}"*`).join(' AND ');
  const hits = await all(env.DB, `SELECT table_name, row_key, title, snippet(published_search, 5, '', '', ' … ', 24) AS excerpt
    FROM published_search WHERE space_id = ?1 AND generation = ?2 AND published_search MATCH ?3 LIMIT ?4`,
  space.id, String(space.active_generation), match, clampInteger(limit, 1, 50, 20));
  return hits.map((hit) => ({ type: hit.table_name, id: safeJsonParse(hit.row_key, [hit.row_key])?.[0] ?? hit.row_key, title: hit.title || hit.excerpt.slice(0, 120), excerpt: hit.excerpt }));
}

async function debatesRoute(env, space, request, rest) {
  const snapshot = await snapshotForTables(env, space, ['edges', 'edge_feedback', 'themes', 'idea_theme_links', 'ideas', 'idea_occurrences', 'evidence', 'works']);
  if (rest[0]) {
    const debate = getDebate(snapshot, decodeURIComponent(rest[0]));
    return debate ? cachedJson(space, request, { debate, revision: space.revision }) : problem(404, 'not_found');
  }
  const url = new URL(request.url);
  const limit = clampInteger(url.searchParams.get('limit'), 1, 200, 100);
  const offset = clampInteger(url.searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER, 0);
  const debates = listDebates(snapshot);
  return cachedJson(space, request, { ...page('debates', debates.slice(offset, offset + limit), debates.length, limit, offset), revision: space.revision });
}

async function libraryRoute(env, space, request, rest) {
  const publication = await first(env.DB, `SELECT manifest_json FROM publications WHERE space_id = ?1 AND generation = ?2`, space.id, space.active_generation);
  const library = safeJsonParse(publication?.manifest_json, {})?.library || null;
  if (!rest[0]) {
    const documents = Array.isArray(library?.documents) ? library.documents : [];
    return json({ published: Boolean(library), generatedAt: library?.generatedAt || null, collections: library?.collections?.length || 0, documents: documents.length, downloadableDocuments: documents.filter((doc) => doc.cleanAvailable || doc.originalAvailable).length, packageBytes: documents.reduce((sum, doc) => sum + Number(doc.packageBytes || 0), 0) });
  }
  if (!library) return problem(409, 'library_not_published', 'The owner has not enabled library publication.');
  if (rest[0] === 'collections') return cachedJson(space, request, { collections: library.collections || [], generatedAt: library.generatedAt });
  if (rest[0] !== 'documents') return problem(404, 'not_found');
  const documents = Array.isArray(library.documents) ? library.documents : [];
  if (!rest[1]) {
    const url = new URL(request.url);
    const query = String(url.searchParams.get('q') || '').toLowerCase();
    const collectionId = url.searchParams.get('collectionId');
    const limit = clampInteger(url.searchParams.get('limit'), 1, 200, 50);
    const offset = clampInteger(url.searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER, 0);
    const filtered = documents.filter((doc) => !collectionId || doc.collectionIds?.includes(collectionId)).filter((doc) => !query || JSON.stringify(doc).toLowerCase().includes(query));
    return cachedJson(space, request, { ...page('items', filtered.slice(offset, offset + limit), filtered.length, limit, offset), generatedAt: library.generatedAt });
  }
  const document = documents.find((entry) => String(entry.id) === decodeURIComponent(rest[1]));
  if (!document) return problem(404, 'document_not_found');
  if (rest[2] === 'download.zip') return getObject(env, space.id, document.packageHash, request, 'library');
  return cachedJson(space, request, { document, generatedAt: library.generatedAt });
}

function researchDraft(row) {
  const brief = safeJsonParse(row.brief_json, {});
  return brief?.kind === 'deep_research' ? { row, brief, draft: safeJsonParse(row.draft_json, null) } : null;
}

function researchSummary(value) {
  return { id: value.row.id, title: value.row.title, kind: 'deep_research', objective: value.brief.objective ?? null,
    language: value.brief.language ?? null, created_at: value.row.created_at, updated_at: value.row.updated_at };
}

async function bytesDataUrl(object, mime) {
  const bytes = new Uint8Array(await object.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}

async function deepResearchRoute(env, space, request, rest) {
  const rows = await tableRows(env, space, 'writing_saved_drafts', { limit: 20_000, ceiling: 20_000, fallback: 20_000 });
  const reads = await tableRows(env, space, 'writing_draft_reads', { limit: 20_000, ceiling: 20_000, fallback: 20_000 });
  const readAt = new Map(reads.map((entry) => [String(entry.draft_id), entry.updated_at ?? null]));
  const reports = rows.map(researchDraft).filter(Boolean);
  const publication = await first(env.DB, 'SELECT manifest_json FROM publications WHERE space_id=?1 AND generation=?2', space.id, space.active_generation);
  const assets = new Map((safeJsonParse(publication?.manifest_json, {})?.assets || []).filter((asset) => asset.kind === 'deep_research_image').map((asset) => [String(asset.key?.[1] ?? ''), asset]));
  if (!rest[0]) {
    const url = new URL(request.url); const limit = clampInteger(url.searchParams.get('limit'), 1, 200, 100); const offset = clampInteger(url.searchParams.get('offset'), 0, 1_000_000, 0);
    const listed = reports.map((value) => ({ ...researchSummary(value), read_at: readAt.get(String(value.row.id)) ?? null, image: assets.get(String(value.row.id)) || null }));
    return cachedJson(space, request, { ...page('reports', listed.slice(offset, offset + limit), listed.length, limit, offset), revision: space.revision });
  }
  const wanted = decodeURIComponent(rest[0]); const report = reports.find((value) => String(value.row.id) === wanted);
  if (!report) return problem(404, 'not_found');
  const image = assets.get(wanted) || null;
  if (rest[1] === 'document.html') {
    if (!report.draft) return problem(422, 'unrenderable_draft', 'The report does not contain a readable draft.');
    let cover = { dataUrl: null, credit: null };
    if (image?.hash) {
      const record = await first(env.DB, `SELECT object_key,mime FROM objects WHERE space_id=?1 AND kind='asset' AND hash=?2`, space.id, image.hash);
      const object = record ? await env.OBJECTS.get(record.object_key) : null;
      if (object && Number(object.size || 0) <= 8 * 1024 * 1024) cover = { dataUrl: await bytesDataUrl(object, record.mime), credit: null };
    }
    try {
      return html(renderProfessionalReportHtml(deepResearchReportInput(report.draft, cover)), 200, { etag: `W/"${space.revision}|${wanted}|document"`, 'cache-control': 'private, max-age=0, must-revalidate' });
    } catch (error) { return problem(422, 'unrenderable_draft', `This report cannot be laid out for printing: ${error.message}`); }
  }
  const [translations, annotations] = await Promise.all([
    rowsWhere(env, space, 'content_translations', (entry) => entry.entity_kind === 'deep_research' && String(entry.entity_id) === wanted),
    rowsWhere(env, space, 'writing_draft_annotations', (entry) => String(entry.draft_id) === wanted),
  ]);
  return cachedJson(space, request, { report: { ...researchSummary(report), draft: report.draft, read_at: readAt.get(wanted) ?? null }, image, translations, annotations, revision: space.revision });
}

export async function handleCorpus(env, auth, request, segments) {
  const space = await activeSpace(env, auth.space_id);
  const [head, ...rest] = segments;
  if (!head) {
    const publication = await first(env.DB, 'SELECT manifest_json, committed_at FROM publications WHERE space_id = ?1 AND generation = ?2', space.id, space.active_generation);
    const manifest = safeJsonParse(publication?.manifest_json, {});
    return cachedJson(space, request, {
      space: { id: space.id, name: space.name, description: space.description, updatedAt: space.updated_at, revision: space.revision },
      vault: safeJsonParse(space.vault_json, null), schemaVersion: space.schema_version, snapshotFormatVersion: 2,
      generatedAt: publication?.committed_at || null, capabilities: manifest.capabilities || null,
      assets: manifest.assets?.length || 0, counts: manifest.counts || {},
    });
  }
  if (head === 'library') return libraryRoute(env, space, request, rest);
  if (head === 'deep-research') return deepResearchRoute(env, space, request, rest);
  if (head === 'search' && rest.length === 0) {
    const url = new URL(request.url);
    return cachedJson(space, request, { results: await lexicalSearch(env, space, url.searchParams.get('q'), url.searchParams.get('limit')), mode: 'lexical', revision: space.revision });
  }
  if (head === 'notes') return notesRoute(env, space, request, rest);
  if (head === 'debates') return debatesRoute(env, space, request, rest);
  if (head === 'study-agenda') {
    const url = new URL(request.url);
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    const inside = (row) => Boolean(row.starts_at) && (!from || String(row.starts_at) >= from) && (!to || String(row.starts_at) <= to);
    const limit = clampInteger(url.searchParams.get('limit'), 1, 200, 100);
    const [events, blocks, subjects] = await Promise.all([
      tableRows(env, space, 'study_calendar_events', { limit: 100_000, ceiling: 100_000, fallback: 100_000 }),
      tableRows(env, space, 'study_plan_blocks', { limit: 100_000, ceiling: 100_000, fallback: 100_000 }),
      tableRows(env, space, 'study_subjects', { limit: 10_000, ceiling: 10_000, fallback: 10_000 }),
    ]);
    const selectedEvents = events.filter(inside).sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
    const selectedBlocks = blocks.filter(inside).sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
    return cachedJson(space, request, { events: selectedEvents.slice(0, limit), blocks: selectedBlocks.slice(0, limit), subjects: subjects.map(({ id, name, color }) => ({ id, name, color: color || null })), total: selectedEvents.length + selectedBlocks.length, hasMore: selectedEvents.length > limit || selectedBlocks.length > limit, revision: space.revision });
  }
  if (head === 'immersion') {
    const sessions = await tableRows(env, space, 'immersion_sessions', { limit: 20_000, ceiling: 20_000, fallback: 20_000 });
    if (rest[0]) {
      const row = sessions.find((entry) => String(entry.id) === decodeURIComponent(rest[0]));
      if (!row) return problem(404, 'not_found');
      return cachedJson(space, request, { session: { ...row, progress_json: undefined, plan: safeJsonParse(row.plan_json, null) }, revision: space.revision });
    }
    const url = new URL(request.url);
    const limit = clampInteger(url.searchParams.get('limit'), 1, 200, 100);
    const offset = clampInteger(url.searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER, 0);
    const listed = sessions.map((row) => ({ id: row.id, topic: row.topic, title: row.title, language: row.language, minutes: row.minutes, stats: safeJsonParse(row.stats_json, null), created_at: row.created_at, updated_at: row.updated_at }));
    return cachedJson(space, request, { ...page('sessions', listed.slice(offset, offset + limit), listed.length, limit, offset), revision: space.revision });
  }
  const collection = COLLECTIONS[head];
  if (!collection) return problem(404, 'not_found');
  if (!rest[0]) return listCollection(env, space, request, collection);
  if (head === 'ideas' && rest[0] === 'routes') {
    return cachedJson(space, request, { routes: workspaceArgumentRoutes(await academicWorkspace(env, space)), revision: space.revision });
  }
  if (head === 'authors' && rest[0] === 'matrix') {
    return cachedJson(space, request, { matrix: workspaceSynthesisMatrix(await academicWorkspace(env, space)), revision: space.revision });
  }
  const wanted = decodeURIComponent(rest[0]);
  const row = await tableRow(env, space, collection.table, collection.id, wanted);
  if (!row) return problem(404, 'not_found');
  if (head === 'ideas' && rest[1] === 'graph') return ideaGraph(env, space, request, wanted);
  if (head === 'ideas') return ideaDetail(env, space, request, row);
  if (head === 'works') return workDetail(env, space, request, row);
  if (head === 'persons') return personDetail(env, space, request, row);
  if (head === 'authors' && rest[1] === 'dossier') {
    const dossier = workspaceAuthorDossier(await academicWorkspace(env, space), wanted);
    return dossier ? cachedJson(space, request, { dossier, revision: space.revision }) : problem(404, 'not_found');
  }
  if (head === 'authors') return authorDetail(env, space, request, row);
  if (head === 'databases') return databaseDetail(env, space, request, row);
  if (head === 'teaching-exams') {
    const questions = (await rowsWhere(env, space, 'teaching_exam_questions', (entry) => String(entry.exam_id) === String(row.id))).sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
    const [subject, course] = await Promise.all([
      tableRow(env, space, 'study_subjects', 'id', row.subject_id), tableRow(env, space, 'study_courses', 'id', row.course_id),
    ]);
    return cachedJson(space, request, { exam: row, questions, subject, course, points: questions.reduce((sum, question) => question.type === 'section' ? sum : sum + Number(question.points || 0), 0), revision: space.revision });
  }
  if (head === 'study-plans') {
    const blocks = (await rowsWhere(env, space, 'study_plan_blocks', (entry) => String(entry.plan_id) === String(row.id))).sort((a, b) => String(a.starts_at || '').localeCompare(String(b.starts_at || '')));
    return cachedJson(space, request, { plan: row, blocks, revision: space.revision });
  }
  return cachedJson(space, request, { [head.replace(/s$/, '')]: row, revision: space.revision });
}

export async function contextPackage(env, auth, request, input) {
  const space = await activeSpace(env, auth.space_id);
  const budget = clampInteger(input.budget, 1000, 200_000, 60_000);
  const hits = await lexicalSearch(env, space, input.query, 50);
  const wanted = new Set(Array.isArray(input.include) && input.include.length ? input.include : ['ideas', 'passages', 'themes', 'gaps', 'works']);
  const hitByTable = new Map();
  for (const hit of hits) {
    if (!hitByTable.has(hit.type)) hitByTable.set(hit.type, new Set());
    hitByTable.get(hit.type).add(String(hit.id));
  }
  const sections = [];
  let used = 0;
  let truncated = false;
  for (const table of wanted) {
    const key = SEARCH_KEYS[table] || 'id';
    const ids = hitByTable.get(table) || new Set();
    const rows = (await tableRows(env, space, table, { limit: 10_000, ceiling: 10_000, fallback: 10_000 })).filter((row) => ids.has(String(row[key] ?? row.id)));
    const kept = [];
    for (const row of rows) {
      const cost = JSON.stringify(row).length;
      if (used + cost > budget) { truncated = true; break; }
      used += cost; kept.push(row);
    }
    if (kept.length) sections.push({ kind: table, items: kept });
  }
  return { sections, stats: { chars: used, budget, truncated, matched: hits.length }, vault: safeJsonParse(space.vault_json, null), revision: space.revision, citationScheme: { idea: 'nodus://idea/<global_id>', passage: 'nodus://passage/<passage_id>', work: 'nodus://work/<nodus_id>' } };
}
