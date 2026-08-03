import { deepResearchReportInput, renderProfessionalReportHtml } from '../core/generated/deepResearchReport.mjs';
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

/**
 * Resource collections that are a plain filtered projection of one table.
 *
 * Grouped by the vault type they belong to, but the dispatcher does not gate on type: a
 * table a space never published simply is not in its snapshot, and the endpoint answers an
 * empty page. Gating instead would mean a client had to know the type before it could ask,
 * and would turn "this vault has no people" into a 404 that reads like a broken route.
 */
const COLLECTIONS = {
  // Academic
  works: { table: 'works', key: 'works', id: 'nodus_id' },
  ideas: { table: 'ideas', key: 'ideas', id: 'global_id' },
  themes: { table: 'themes', key: 'themes', id: 'theme_id' },
  gaps: { table: 'gaps', key: 'gaps', id: 'id' },
  authors: { table: 'authors', key: 'authors', id: 'author_id' },
  passages: { table: 'passages', key: 'passages', id: 'passage_id' },
  // Genealogy and prosopography
  persons: { table: 'persons', key: 'persons', id: 'person_id' },
  places: { table: 'places', key: 'places', id: 'place_id' },
  events: { table: 'events', key: 'events', id: 'event_id' },
  relationships: { table: 'relationships', key: 'relationships', id: 'id' },
  // Study.
  //
  // Every one of these is keyed on `id`, not on `<thing>_id`. The study and teaching
  // migrations name their primary key `id` throughout (migrations.ts:1573 onwards), and
  // declaring `subject_id`, `card_id` or `exam_id` here named a column none of these tables
  // has. On this side the detail lookup fell through to `candidate.id` and worked by
  // accident; on the client, where the same table is the contract, it meant an exam had no id
  // to enrich by and no study row listed inside another dossier could be opened at all.
  'study-subjects': { table: 'study_subjects', key: 'subjects', id: 'id' },
  'study-courses': { table: 'study_courses', key: 'courses', id: 'id' },
  'study-topics': { table: 'study_topics', key: 'topics', id: 'id' },
  'study-docs': { table: 'study_docs', key: 'docs', id: 'id' },
  'study-materials': { table: 'study_materials', key: 'materials', id: 'id' },
  'study-flashcards': { table: 'study_flashcards', key: 'flashcards', id: 'id' },
  'study-questions': { table: 'study_questions', key: 'questions', id: 'id' },
  // What the week actually holds. `study_plan_blocks` has no collection of its own: a block
  // outside its plan is a title and a timestamp, so it arrives inside the plan and inside the
  // agenda instead of as a list nobody would browse.
  'study-plans': { table: 'study_plans', key: 'plans', id: 'id' },
  'study-goals': { table: 'study_goals', key: 'goals', id: 'id' },
  'study-calendar': { table: 'study_calendar_events', key: 'events', id: 'id' },
  // Teaching materials. Rosters, groups and grades are not published at all, so there is
  // deliberately no collection that could ever serve them.
  'teaching-exams': { table: 'teaching_exams', key: 'exams', id: 'id' },
  'teaching-rubrics': { table: 'teaching_rubrics', key: 'rubrics', id: 'id' },
  // Databases
  databases: { table: 'db_databases', key: 'databases', id: 'id' },
};

/**
 * One saved draft, rendered as the styled document.
 *
 * The cover image is inlined as a `data:` URL: the document has to be printable by a client
 * that may not be able to fetch anything else, and a page whose cover is a broken link is
 * worse than one with no cover.
 *
 * The snapshot's asset entry carries a hash and no bytes — that is the whole point of the
 * asset channel — so the bytes are read from the store here. Reading `image.dataUrl`, a field
 * a snapshot asset has never had, is why every report the phone printed came out with the
 * fallback motif where the desktop puts the illustration.
 */
function renderReportDocument(draft, image, readAssetBytes) {
  return renderProfessionalReportHtml(deepResearchReportInput(draft, coverImage(image, readAssetBytes)));
}

function coverImage(image, readAssetBytes) {
  const empty = { dataUrl: null, credit: null };
  if (!image?.hash || typeof readAssetBytes !== 'function') return empty;
  const asset = readAssetBytes(image.hash);
  if (!asset?.bytes) return empty;
  return { dataUrl: `data:${asset.mime};base64,${asset.bytes.toString('base64')}`, credit: null };
}

export function createCorpusRoutes({ readSnapshot, readAssetBytes }) {
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

      if (head === 'persons') {
        if (notModified(req, res, json, space, url, key)) return true;
        const personId = String(row.person_id);
        const involved = (table, column) => rows(snapshot, table).filter((entry) => String(entry[column]) === personId);
        const eventIds = new Set(involved('event_participants', 'person_id').map((entry) => String(entry.event_id)));
        return send(res, json, {
          person: row,
          names: involved('person_names', 'person_id'),
          places: involved('person_places', 'person_id'),
          // `from_person`/`to_person`, which is what migration 1154 actually creates. Filtering
          // on `*_person_id` matched nothing, so every person in every genealogy and
          // prosopography vault came back with an empty relationships list.
          relationships: rows(snapshot, 'relationships').filter((entry) => String(entry.from_person) === personId || String(entry.to_person) === personId),
          events: rows(snapshot, 'events').filter((entry) => eventIds.has(String(entry.event_id))),
          // Metadata only: the portrait's bytes live on the asset channel.
          portrait: rows(snapshot, 'person_portraits').find((entry) => String(entry.person_id) === personId) ?? null,
          revision: space.revision,
        });
      }

      if (head === 'databases') {
        if (notModified(req, res, json, space, url, key)) return true;
        const databaseId = String(row.id);
        const byPosition = (a, b) => (Number(a.position) || 0) - (Number(b.position) || 0);
        // The user's own order, not the snapshot's. It matters twice over for rows: the page
        // is cut *after* this sort, so serving snapshot order would make page two a different
        // set of rows from the one the desktop shows.
        const columns = rows(snapshot, 'db_columns').filter((entry) => String(entry.database_id) === databaseId).sort(byPosition);
        const dbRows = rows(snapshot, 'db_rows').filter((entry) => String(entry.database_id) === databaseId).sort(byPosition);
        const limit = readLimit(url.searchParams.get('limit'));
        const offset = readOffset(url.searchParams.get('offset'));
        const page = dbRows.slice(offset, offset + limit);
        const pageIds = new Set(page.map((entry) => String(entry.id)));

        // Which attachment's bytes actually travelled, by hash. An `attachment` column takes
        // whatever the user dropped on it, and only images ride the asset channel
        // (`ASSET_SOURCES` in electron/serverSync/serverSnapshot.ts) — so a row with a PDF
        // still says it has a PDF, and says it has no image to show.
        const images = new Map(
          (Array.isArray(snapshot.assets) ? snapshot.assets : [])
            .filter((asset) => asset.kind === 'db_attachment')
            .map((asset) => [String(asset.key?.[0] ?? ''), asset])
        );
        const attachments = rows(snapshot, 'db_attachments')
          .filter((entry) => pageIds.has(String(entry.row_id)))
          .sort(byPosition)
          .map((entry) => {
            const asset = images.get(String(entry.id)) ?? null;
            // `extracted_text` is the whole of a scanned document's text and nothing here
            // renders it, so it stays in the snapshot — where the offline copy still has it —
            // rather than riding along with every page of a gallery.
            const { extracted_text: _text, ...rest } = entry;
            return {
              ...rest,
              hash: asset?.hash ?? null,
              // The grid draws the thumbnail and the row draws the full image; sending both
              // hashes means a page of forty photographs costs forty thumbnails, not forty
              // originals.
              thumbHash: asset?.thumbHash ?? null,
              imageMime: asset?.mime ?? null,
            };
          });

        return send(res, json, {
          database: row,
          columns,
          views: rows(snapshot, 'db_views').filter((entry) => String(entry.database_id) === databaseId).sort(byPosition),
          options: rows(snapshot, 'db_select_options').filter((entry) => columns.some((column) => String(column.id) === String(entry.column_id))).sort(byPosition),
          rows: page,
          // Only the cells of the page being served: a database with fifty thousand rows
          // would otherwise ship every value it has to render twenty of them.
          cells: rows(snapshot, 'db_cells').filter((entry) => pageIds.has(String(entry.row_id))),
          // Same rule, same reason. A relation cell is a list of rows in `db_relations`, and
          // without them a relation column renders as nothing at all.
          relations: rows(snapshot, 'db_relations').filter((entry) => pageIds.has(String(entry.row_id))).sort(byPosition),
          attachments,
          total: dbRows.length,
          limit,
          offset,
          hasMore: offset + page.length < dbRows.length,
          revision: space.revision,
        });
      }

      // An exam is its questions. Without them the detail is a title, a language and a
      // target count — which is what a teacher opening an exam on a phone got.
      if (head === 'teaching-exams') {
        if (notModified(req, res, json, space, url, key)) return true;
        const examId = String(row.id);
        const questions = rows(snapshot, 'teaching_exam_questions')
          .filter((entry) => String(entry.exam_id) === examId)
          .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
        return send(res, json, {
          exam: row,
          questions,
          // The two names the header prints. Sending the ids alone would make the client
          // fetch two more rows to render one line.
          subject: rows(snapshot, 'study_subjects').find((entry) => String(entry.id) === String(row.subject_id)) ?? null,
          course: rows(snapshot, 'study_courses').find((entry) => String(entry.id) === String(row.course_id)) ?? null,
          // `examTotalPoints` (shared/teachingExams.ts:290) to the letter: a `section` is a
          // shared statement, not a question, and its mark is the sum of the sub-questions
          // hanging from it. Counting its own points would print an exam worth more than it is.
          points: questions.reduce(
            (total, question) => (question.type === 'section' ? total : total + (Number(question.points) || 0)),
            0
          ),
          revision: space.revision,
        });
      }

      // A plan is its blocks, in the order they happen — not in snapshot order, which for a
      // calendar is no order at all.
      if (head === 'study-plans') {
        if (notModified(req, res, json, space, url, key)) return true;
        const planId = String(row.id);
        return send(res, json, {
          plan: row,
          blocks: rows(snapshot, 'study_plan_blocks')
            .filter((entry) => String(entry.plan_id) === planId)
            .sort((a, b) => String(a.starts_at ?? '').localeCompare(String(b.starts_at ?? ''))),
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
      let draft = null;
      try { draft = JSON.parse(row.draft_json || 'null'); } catch { draft = null; }

      // ── The styled document ───────────────────────────────────────────────
      //
      // `.../deep-research/<id>/document.html` is the report laid out the way the desktop
      // lays it out for print: cover, contents, section rules, traceability matrix, `@page`
      // box. The design is `shared/professionalReport.ts`, compiled into
      // `lib/core/generated/` so this process needs no dependency and no build to serve it.
      //
      // HTML rather than PDF because printing needs a browser, and this server is a hundred
      // and fifty megabytes of Alpine and Node with nothing else in it. The client that asks
      // for this has a browser engine already; it prints the page it is given.
      if (rest[1] === 'document.html') {
        if (!draft) return missing(res, json);
        const image = assets.get(wanted) ?? null;
        let html;
        try {
          html = renderReportDocument(draft, image, (hash) => readAssetBytes?.(space.id, hash));
        } catch (error) {
          // A draft written by an older Nodus, or by something that is not Nodus, can be
          // missing a field the layout reads. That is a document this server cannot lay out,
          // not a broken server — and saying so is what stops the client showing "could not
          // build the PDF" with a stack trace inside it.
          json(res, 422, {
            error: 'unrenderable_draft',
            error_description: `This report cannot be laid out for printing: ${error.message}`,
          });
          return true;
        }
        const bytes = Buffer.from(html, 'utf8');
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-length': bytes.length,
          'cache-control': 'private, max-age=0, must-revalidate',
          etag: `W/"${space.revision}|${wanted}|document"`,
        });
        if (req.method === 'HEAD') res.end();
        else res.end(bytes);
        return true;
      }

      if (notModified(req, res, json, space, url, key)) return true;
      return send(res, json, {
        report: { ...draftSummary(row), draft },
        image: assets.get(wanted) ?? null,
        translations: rows(snapshot, 'content_translations').filter((entry) => entry.entity_kind === 'deep_research' && String(entry.entity_id) === wanted),
        revision: space.revision,
      });
    }

    // ── The agenda ────────────────────────────────────────────────────────────
    //
    // `GET .../study-agenda?from=&to=` — what a study or teaching vault actually has on,
    // from the two tables that carry a moment in time: the calendar and the blocks of a
    // study plan.
    //
    // A resource rather than two collections, for two reasons. A collection answers in
    // snapshot order, which for a calendar is no order at all; and a phone asking "what have
    // I got this fortnight" should not download every block ever planned to find out. Both
    // lists come back sorted by `starts_at` and cut to the window.
    //
    // The subjects ride along because every row here names one by id and nothing else, and
    // one small table beside the answer is cheaper than a request per row — the same reason
    // an author's works travel inside the author.
    if (head === 'study-agenda' && rest.length === 0) {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      if (notModified(req, res, json, space, url, key)) return true;

      // ISO-8601 sorts and compares lexicographically, which is the whole reason these
      // columns are stored as text.
      const from = url.searchParams.get('from') || '';
      const to = url.searchParams.get('to') || '';
      const inWindow = (value) => {
        const at = String(value ?? '');
        if (!at) return false;
        return (!from || at >= from) && (!to || at <= to);
      };
      const byStart = (a, b) => String(a.starts_at ?? '').localeCompare(String(b.starts_at ?? ''));
      const limit = readLimit(url.searchParams.get('limit'));

      const events = rows(snapshot, 'study_calendar_events').filter((row) => inWindow(row.starts_at)).sort(byStart);
      const blocks = rows(snapshot, 'study_plan_blocks').filter((row) => inWindow(row.starts_at)).sort(byStart);
      return send(res, json, {
        events: events.slice(0, limit),
        blocks: blocks.slice(0, limit),
        subjects: rows(snapshot, 'study_subjects').map((row) => ({ id: row.id, name: row.name, color: row.color ?? null })),
        total: events.length + blocks.length,
        hasMore: events.length > limit || blocks.length > limit,
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
