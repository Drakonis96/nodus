// Debates, computed from a published snapshot.
//
// `debates` is not a table: it is a live projection of contradicts/refutes edges built by
// getDebates() in electron/graph/graphService.ts:1067. That function is welded to SQL — the
// `visible_edges` view, getIdeaDetail's six queries per idea, a batched getWorksByIds — and
// the server holds JSON arrays and cannot import TypeScript.
//
// So this is a second implementation, and the thing that keeps the two honest is
// scripts/test-server-debates-parity.mjs, which runs the REAL getDebates() under
// Electron-as-Node and the REAL buildServerSnapshot() over one fixture and asserts the two
// results are deep-equal. Sharing a single core instead would mean handing the desktop a
// core that wants `evidence` and `idea_occurrences` fully in memory, which is precisely
// what DebateSideCache and the lean mode were written to avoid on a large corpus.
//
// `trace` is the one field that cannot be reproduced: getEdgeTrace() reads `edge_traces`,
// which is in NOT_SYNCED_TABLES and never travels. It is always null here, by contract.

import { indexBy, rows, visibleEdges, worksById } from './snapshot.mjs';

const DEBATE_RELATIONS = new Set(['contradicts', 'refutes']);
const DEBATE_TENSION_CLIP = 180;
/** Lean mode keeps one quote per work; the list UI only ever renders the first. */
const DEBATE_LIST_EVIDENCE_PER_WORK = 1;

function clip(value, max) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}…`;
}

function tensionText(relation, a, b) {
  const noun = relation === 'refutes' ? 'refutación' : 'contradicción';
  const left = clip(a.statement || a.label, DEBATE_TENSION_CLIP);
  const right = clip(b.statement || b.label, DEBATE_TENSION_CLIP);
  return `La ${noun} detectada es que «${left}» entra en tensión con «${right}».`;
}

/** Union-find over idea ids, so a multi-sided dispute surfaces as one cluster. */
function clusterDebateEdges(edges) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a, b) => { parent.set(find(a), find(b)); };
  for (const edge of edges) union(String(edge.from_id), String(edge.to_id));

  const clusterId = new Map();
  const clusterSize = new Map();
  for (const edge of edges) {
    const root = find(String(edge.from_id));
    clusterId.set(String(edge.id), root);
    clusterSize.set(root, (clusterSize.get(root) ?? 0) + 1);
  }
  return { clusterId, clusterSize };
}

function supportCounts(visible) {
  const map = new Map();
  for (const edge of visible) {
    if (edge.type !== 'supports') continue;
    const key = String(edge.to_id);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function themesByIdea(snapshot) {
  const labelByTheme = new Map(rows(snapshot, 'themes').map((row) => [String(row.theme_id), row.label]));
  const map = new Map();
  for (const link of rows(snapshot, 'idea_theme_links')) {
    const label = labelByTheme.get(String(link.theme_id));
    if (label === undefined) continue;
    const key = String(link.global_id);
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(label);
  }
  return map;
}

function buildSideAssembler(snapshot, { lean = true } = {}) {
  const ideasById = new Map(rows(snapshot, 'ideas').map((row) => [String(row.global_id), row]));
  const occurrencesByIdea = indexBy(rows(snapshot, 'idea_occurrences'), 'global_id');
  const evidenceByIdea = indexBy(rows(snapshot, 'evidence'), 'global_id');
  const works = worksById(snapshot);
  const cache = new Map();

  return function side(ideaId) {
    const key = String(ideaId);
    if (cache.has(key)) return cache.get(key);

    const idea = ideasById.get(key);
    if (!idea) { cache.set(key, null); return null; }

    // Group the idea's evidence by work first, so lean mode can cap it per work exactly
    // the way assembleDebateSide() does — capping globally would keep a different set.
    const evidenceByWork = new Map();
    for (const item of evidenceByIdea.get(key) ?? []) {
      const workId = String(item.nodus_id);
      if (!evidenceByWork.has(workId)) evidenceByWork.set(workId, []);
      const bucket = evidenceByWork.get(workId);
      if (lean && bucket.length >= DEBATE_LIST_EVIDENCE_PER_WORK) continue;
      bucket.push(item);
    }

    // An occurrence whose work is missing from `works` is dropped, matching
    // getIdeaDetail's filter over the getWorksByIds map.
    const sideWorks = [];
    for (const occurrence of occurrencesByIdea.get(key) ?? []) {
      const work = works.get(String(occurrence.nodus_id));
      if (!work) continue;
      sideWorks.push({
        nodus_id: occurrence.nodus_id,
        title: work.title,
        zotero_key: work.zotero_key,
        authors: work.authors,
        year: work.year,
        role: occurrence.role,
        development: lean ? '' : occurrence.development,
        evidence: evidenceByWork.get(String(occurrence.nodus_id)) ?? [],
      });
    }

    const authors = Array.from(new Set(sideWorks.flatMap((work) => work.authors).filter(Boolean)));
    const years = sideWorks.map((work) => work.year).filter((year) => typeof year === 'number');
    const built = {
      ideaId: idea.global_id,
      type: idea.type,
      label: idea.label,
      statement: idea.statement,
      authors,
      works: sideWorks,
      earliestYear: years.length ? Math.min(...years) : null,
      latestYear: years.length ? Math.max(...years) : null,
    };
    cache.set(key, built);
    return built;
  };
}

/** Side A's works, then side B's, sorted by year with undated works sinking to the end. */
function timeline(sideA, sideB) {
  const entries = [];
  for (const work of sideA.works) entries.push({ year: work.year, side: 'A', nodus_id: work.nodus_id, title: work.title, authors: work.authors });
  for (const work of sideB.works) entries.push({ year: work.year, side: 'B', nodus_id: work.nodus_id, title: work.title, authors: work.authors });
  return entries.sort((x, y) => {
    if (x.year == null && y.year == null) return 0;
    if (x.year == null) return 1;
    if (y.year == null) return -1;
    return x.year - y.year;
  });
}

function assemble(edge, clusterId, clusterSize, support, themes, side) {
  const sideA = side(edge.from_id);
  const sideB = side(edge.to_id);
  if (!sideA || !sideB) return null;

  const themesA = themes.get(String(edge.from_id)) ?? new Set();
  const themesB = themes.get(String(edge.to_id)) ?? new Set();
  const sharedThemes = Array.from(themesA).filter((label) => themesB.has(label));

  const supportA = support.get(String(edge.from_id)) ?? 0;
  const supportB = support.get(String(edge.to_id)) ?? 0;
  let status = 'open';
  let leaningSide = null;
  if (supportA !== supportB) {
    status = 'leaning';
    leaningSide = supportA > supportB ? 'A' : 'B';
  }

  const worksA = new Set(sideA.works.map((work) => String(work.nodus_id)));
  const internal = sideB.works.some((work) => worksA.has(String(work.nodus_id)));

  return {
    id: edge.id,
    relation: edge.type,
    basis: edge.basis,
    confidence: edge.confidence,
    clusterId,
    clusterSize,
    status,
    leaningSide,
    sharedThemes,
    internal,
    sideA,
    sideB,
    timeline: timeline(sideA, sideB),
    tension: tensionText(edge.type, sideA, sideB),
    tensionKey: edge.type === 'refutes' ? 'debate.refutes' : 'debate.contradicts',
    tensionParams: {
      left: clip(sideA.statement || sideA.label, DEBATE_TENSION_CLIP),
      right: clip(sideB.statement || sideB.label, DEBATE_TENSION_CLIP),
    },
    trace: null,
  };
}

export function listDebates(snapshot) {
  const visible = visibleEdges(snapshot);
  const edges = visible.filter((edge) => DEBATE_RELATIONS.has(edge.type));
  if (edges.length === 0) return [];

  const { clusterId, clusterSize } = clusterDebateEdges(edges);
  const support = supportCounts(visible);
  const themes = themesByIdea(snapshot);
  const side = buildSideAssembler(snapshot, { lean: true });

  const debates = [];
  for (const edge of edges) {
    const root = clusterId.get(String(edge.id));
    const built = assemble(edge, root, clusterSize.get(root) ?? 1, support, themes, side);
    if (built) debates.push(built);
  }
  // Multi-sided debates first, then by confidence — the richest disputes lead.
  return debates.sort((a, b) => b.clusterSize - a.clusterSize || b.confidence - a.confidence);
}

/**
 * One debate by edge id, with full evidence and development prose.
 *
 * Mirrors getDebate(): clusterId is the edge's own from_id and clusterSize is 1, because a
 * single-edge lookup does not run the clustering pass.
 */
export function getDebate(snapshot, edgeId) {
  const visible = visibleEdges(snapshot);
  const edge = visible.find((candidate) => String(candidate.id) === String(edgeId) && DEBATE_RELATIONS.has(candidate.type));
  if (!edge) return null;
  const side = buildSideAssembler(snapshot, { lean: false });
  return assemble(edge, edge.from_id, 1, supportCounts(visible), themesByIdea(snapshot), side);
}
