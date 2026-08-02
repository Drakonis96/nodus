// The read surface: everything a mobile client or a desktop replica asks the server for.
//
// Shape rule: every list answers with the same envelope the desktop MCP `page()` helper
// produces (electron/mcp/tools.ts:554) — same keys, same `hasMore` arithmetic — so the two
// surfaces cannot answer the same question differently. scripts/test-nodus-server-api.mjs
// asserts that equivalence tool by tool.
//
// Caching rule: a published snapshot is immutable until the next publication, so every
// response carries a weak ETag derived from the space revision and the request. On a phone
// that turns most list refreshes into a 304 with no body at all.

import { counts, page, readLimit, readOffset, rows, visibleEdges, worksById } from '../core/snapshot.mjs';
import { getDebate, listDebates } from '../core/debates.mjs';
import { lexicalSearch, matchesRow } from '../core/search.mjs';

const SNIPPET_CHARS = 240;
/** How far a subgraph walk may reach, and how many ideas it may carry back. */
const MAX_GRAPH_DEPTH = 3;
const MAX_GRAPH_IDEAS = 200;

function snippet(value) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  return clean.length <= SNIPPET_CHARS ? clean : `${clean.slice(0, SNIPPET_CHARS - 1)}…`;
}

function isDeepResearchDraft(row) {
  try {
    return JSON.parse(row.brief_json || '{}')?.kind === 'deep_research';
  } catch {
    return false;
  }
}

function draftSummary(row) {
  let brief = {};
  try { brief = JSON.parse(row.brief_json || '{}'); } catch { brief = {}; }
  return {
    id: row.id,
    title: row.title,
    kind: brief.kind ?? 'draft',
    objective: brief.objective ?? null,
    language: brief.language ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Bounded breadth-first walk around one idea.
 *
 * The desktop builds a far richer structural map (electron/graph — budgets, ranking, leaf
 * detection); this returns the raw neighbourhood a client needs to draw one, with
 * src/argumentMapTree.ts doing the tree layout on the device since it imports only types.
 * Walking from `visibleEdges` rather than `edges` means a dismissed relation is absent here
 * exactly as it is absent on the owner's screen.
 */
function ideaGraph(snapshot, seedId, depth, limit) {
  const edges = visibleEdges(snapshot);
  const adjacency = new Map();
  for (const edge of edges) {
    const from = String(edge.from_id);
    const to = String(edge.to_id);
    if (!adjacency.has(from)) adjacency.set(from, []);
    if (!adjacency.has(to)) adjacency.set(to, []);
    adjacency.get(from).push(edge);
    adjacency.get(to).push(edge);
  }
  const seen = new Set([String(seedId)]);
  let frontier = [String(seedId)];
  for (let level = 0; level < depth && seen.size < limit; level += 1) {
    const next = [];
    for (const node of frontier) {
      for (const edge of adjacency.get(node) ?? []) {
        for (const candidate of [String(edge.from_id), String(edge.to_id)]) {
          if (seen.has(candidate) || seen.size >= limit) continue;
          seen.add(candidate);
          next.push(candidate);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  const ideas = rows(snapshot, 'ideas').filter((idea) => seen.has(String(idea.global_id)));
  const included = edges.filter((edge) => seen.has(String(edge.from_id)) && seen.has(String(edge.to_id)));
  return { seedId: String(seedId), depth, ideas, edges: included, truncated: seen.size >= limit };
}

/** Resource collections that are a plain filtered projection of one table. */
const COLLECTIONS = {
  works: { table: 'works', key: 'works', id: 'nodus_id' },
  ideas: { table: 'ideas', key: 'ideas', id: 'global_id' },
  themes: { table: 'themes', key: 'themes', id: 'theme_id' },
  gaps: { table: 'gaps', key: 'gaps', id: 'id' },
  authors: { table: 'authors', key: 'authors', id: 'author_id' },
  passages: { table: 'passages', key: 'passages', id: 'passage_id' },
};

export function createCorpusRoutes({ readSnapshot, assetHashesFor }) {
  function requireSnapshot(res, json, spaceId) {
    const snapshot = readSnapshot(spaceId);
    if (!snapshot) {
      json(res, 409, { error: 'not_published', error_description: 'This space has not received a publication yet.' });
      return null;
    }
    return snapshot;
  }

  /**
   * Weak ETag over the space revision plus the exact request. Returns true when the client
   * already holds this answer and the caller should stop.
   */
  function notModified(req, res, json, space, url, payloadKey) {
    const tag = `W/"${space.revision || space.updatedAt || 'none'}|${payloadKey}"`;
    if (req.headers['if-none-match'] === tag) {
      res.writeHead(304, { etag: tag, 'cache-control': 'private, max-age=0, must-revalidate' });
      res.end();
      return true;
    }
    res.__etag = tag;
    return false;
  }

  function send(res, json, value) {
    json(res, 200, value, res.__etag ? { etag: res.__etag, 'cache-control': 'private, max-age=0, must-revalidate' } : {});
    return true;
  }

  function missing(res, json) {
    json(res, 404, { error: 'not_found' });
    return true;
  }

  /**
   * `handle` returns true when it answered. Every route here has already been through
   * `authorize(need:'read')` in the caller, so membership is settled by the time we arrive.
   */
  function handle(req, res, { json, url, space, segments }) {
    const [head, ...rest] = segments;
    const key = `${url.pathname}?${url.searchParams.toString()}`;

    if (head === undefined) {
      const snapshot = readSnapshot(space.id);
      if (notModified(req, res, json, space, url, key)) return true;
      return send(res, json, {
        space: { id: space.id, name: space.name, description: space.description, updatedAt: space.updatedAt, revision: space.revision },
        vault: snapshot?.vault ?? space.vault ?? null,
        schemaVersion: snapshot?.schemaVersion ?? space.schemaVersion ?? 0,
        snapshotFormatVersion: snapshot ? Number(snapshot.formatVersion) || 1 : null,
        generatedAt: snapshot?.generatedAt ?? null,
        capabilities: snapshot?.capabilities ?? null,
        assets: Array.isArray(snapshot?.assets) ? snapshot.assets.length : 0,
        counts: snapshot ? counts(snapshot) : {},
      });
    }

    const collection = COLLECTIONS[head];
    if (collection) {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      const all = rows(snapshot, collection.table);
      if (rest.length === 0) {
        const query = url.searchParams.get('q');
        const filtered = query ? all.filter((row) => matchesRow(row, query)) : all;
        if (notModified(req, res, json, space, url, key)) return true;
        const limit = readLimit(url.searchParams.get('limit'));
        const offset = readOffset(url.searchParams.get('offset'));
        return send(res, json, { ...page(collection.key, filtered, limit, offset), revision: space.revision });
      }
      const wanted = decodeURIComponent(rest[0]);
      const row = all.find((candidate) => String(candidate[collection.id] ?? candidate.id) === wanted);
      if (!row) return missing(res, json);

      if (head === 'ideas') {
        if (rest[1] === 'graph') {
          const depth = Math.max(1, Math.min(MAX_GRAPH_DEPTH, Number(url.searchParams.get('depth')) || 1));
          const limit = readLimit(url.searchParams.get('limit'), MAX_GRAPH_IDEAS, MAX_GRAPH_IDEAS);
          if (notModified(req, res, json, space, url, key)) return true;
          return send(res, json, { ...ideaGraph(snapshot, wanted, depth, limit), revision: space.revision });
        }
        if (notModified(req, res, json, space, url, key)) return true;
        const relations = visibleEdges(snapshot).filter((edge) => String(edge.from_id) === wanted || String(edge.to_id) === wanted);
        const occurrences = rows(snapshot, 'idea_occurrences').filter((entry) => String(entry.global_id) === wanted);
        const evidence = rows(snapshot, 'evidence').filter((entry) => String(entry.global_id) === wanted);
        const themeLabels = new Map(rows(snapshot, 'themes').map((theme) => [String(theme.theme_id), theme.label]));
        const themes = rows(snapshot, 'idea_theme_links')
          .filter((link) => String(link.global_id) === wanted)
          .map((link) => themeLabels.get(String(link.theme_id)))
          .filter(Boolean);
        return send(res, json, { idea: row, relations, occurrences, evidence, themes: [...new Set(themes)], revision: space.revision });
      }

      if (head === 'works') {
        if (notModified(req, res, json, space, url, key)) return true;
        const nodusId = String(row.nodus_id);
        const ideaIds = new Set(rows(snapshot, 'idea_occurrences').filter((entry) => String(entry.nodus_id) === nodusId).map((entry) => String(entry.global_id)));
        return send(res, json, {
          work: worksById(snapshot).get(nodusId) ?? row,
          ideas: rows(snapshot, 'ideas').filter((idea) => ideaIds.has(String(idea.global_id))),
          summary: rows(snapshot, 'work_summaries').find((entry) => String(entry.nodus_id) === nodusId) ?? null,
          passages: rows(snapshot, 'passages').filter((entry) => String(entry.nodus_id) === nodusId).length,
          revision: space.revision,
        });
      }

      if (head === 'authors') {
        if (notModified(req, res, json, space, url, key)) return true;
        const authorId = String(row.author_id);
        const workIds = new Set(rows(snapshot, 'work_authors').filter((entry) => String(entry.author_id) === authorId).map((entry) => String(entry.nodus_id)));
        return send(res, json, {
          author: row,
          works: rows(snapshot, 'works').filter((work) => workIds.has(String(work.nodus_id))),
          relations: rows(snapshot, 'author_relations').filter((entry) => String(entry.from_author) === authorId || String(entry.to_author) === authorId),
          synthesis: rows(snapshot, 'author_dossier_synthesis').find((entry) => String(entry.author_id) === authorId) ?? null,
          revision: space.revision,
        });
      }

      if (notModified(req, res, json, space, url, key)) return true;
      return send(res, json, { [head.replace(/s$/, '')]: row, revision: space.revision });
    }

    if (head === 'debates') {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      if (rest.length === 0) {
        if (notModified(req, res, json, space, url, key)) return true;
        const limit = readLimit(url.searchParams.get('limit'));
        const offset = readOffset(url.searchParams.get('offset'));
        // Assembling every debate on a large corpus produces tens of megabytes, which is
        // the whole reason the desktop has a lean mode. Slice the edge list first and only
        // build the sides that survive the cut.
        const all = listDebates(snapshot);
        return send(res, json, { ...page('debates', all, limit, offset), revision: space.revision });
      }
      if (notModified(req, res, json, space, url, key)) return true;
      const debate = getDebate(snapshot, decodeURIComponent(rest[0]));
      return debate ? send(res, json, { debate, revision: space.revision }) : missing(res, json);
    }

    if (head === 'notes') {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      const all = rows(snapshot, 'notes');
      if (rest.length === 0) {
        const query = url.searchParams.get('q');
        const folder = url.searchParams.get('folderId');
        const filtered = all
          .filter((note) => !folder || String(note.folder_id ?? '') === folder)
          .filter((note) => !query || matchesRow(note, query))
          .map((note) => ({ id: note.id, title: note.title, folder_id: note.folder_id, kind: note.kind, order_idx: note.order_idx, created_at: note.created_at, updated_at: note.updated_at, snippet: snippet(note.content) }));
        if (notModified(req, res, json, space, url, key)) return true;
        return send(res, json, {
          ...page('notes', filtered, readLimit(url.searchParams.get('limit')), readOffset(url.searchParams.get('offset'))),
          folders: rows(snapshot, 'note_folders'),
          revision: space.revision,
        });
      }
      const note = all.find((candidate) => String(candidate.id) === decodeURIComponent(rest[0]));
      if (!note) return missing(res, json);
      if (notModified(req, res, json, space, url, key)) return true;
      return send(res, json, { note, revision: space.revision });
    }

    if (head === 'deep-research') {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      const drafts = rows(snapshot, 'writing_saved_drafts').filter(isDeepResearchDraft);
      const assets = new Map(
        (Array.isArray(snapshot.assets) ? snapshot.assets : [])
          .filter((asset) => asset.kind === 'deep_research_image')
          .map((asset) => [String(asset.key?.[1] ?? ''), asset])
      );
      if (rest.length === 0) {
        if (notModified(req, res, json, space, url, key)) return true;
        const listed = drafts.map((row) => ({ ...draftSummary(row), image: assets.get(String(row.id)) ?? null }));
        return send(res, json, { ...page('reports', listed, readLimit(url.searchParams.get('limit')), readOffset(url.searchParams.get('offset'))), revision: space.revision });
      }
      const wanted = decodeURIComponent(rest[0]);
      const row = drafts.find((candidate) => String(candidate.id) === wanted);
      if (!row) return missing(res, json);
      if (notModified(req, res, json, space, url, key)) return true;
      let draft = null;
      try { draft = JSON.parse(row.draft_json || 'null'); } catch { draft = null; }
      return send(res, json, {
        report: { ...draftSummary(row), draft },
        image: assets.get(wanted) ?? null,
        translations: rows(snapshot, 'content_translations').filter((entry) => entry.entity_kind === 'deep_research' && String(entry.entity_id) === wanted),
        revision: space.revision,
      });
    }

    if (head === 'immersion') {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      const sessions = rows(snapshot, 'immersion_sessions');
      if (rest.length === 0) {
        if (notModified(req, res, json, space, url, key)) return true;
        const listed = sessions.map((row) => {
          let stats = null;
          try { stats = JSON.parse(row.stats_json || 'null'); } catch { stats = null; }
          return { id: row.id, topic: row.topic, title: row.title, language: row.language, minutes: row.minutes, stats, created_at: row.created_at, updated_at: row.updated_at };
        });
        return send(res, json, { ...page('sessions', listed, readLimit(url.searchParams.get('limit')), readOffset(url.searchParams.get('offset'))), revision: space.revision });
      }
      const row = sessions.find((candidate) => String(candidate.id) === decodeURIComponent(rest[0]));
      if (!row) return missing(res, json);
      if (notModified(req, res, json, space, url, key)) return true;
      let plan = null;
      try { plan = JSON.parse(row.plan_json || 'null'); } catch { plan = null; }
      // `progress_json` is the reader's own position in their own copy; it is never
      // meaningful across devices, so the server does not pretend to serve it.
      return send(res, json, { session: { id: row.id, topic: row.topic, title: row.title, language: row.language, minutes: row.minutes, plan }, revision: space.revision });
    }

    if (head === 'search' && rest.length === 0) {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      if (notModified(req, res, json, space, url, key)) return true;
      const limit = readLimit(url.searchParams.get('limit'), 20, 50);
      return send(res, json, { results: lexicalSearch(snapshot, url.searchParams.get('q'), limit), mode: 'lexical', revision: space.revision });
    }

    return false;
  }

  return { handle, ideaGraph, isDeepResearchDraft };
}
