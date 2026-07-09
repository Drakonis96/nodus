import { getDb } from './database';
import { v4 as uuid } from 'uuid';
import type { WorkCreator } from '@shared/types';

// ─────────────────────────────────────────────────────────────────────────────
// Canonical author identity
//
// Author nodes are keyed by a normalized identity ("lastname::i") derived from
// Zotero's STRUCTURED creators (lastName + first initial), so the same person
// written three different ways ("Galant, I." / "Ivanne Galant" / "I. Galant")
// collapses into one node. Free-text parsing is only a fallback for legacy rows
// and for works whose structured creators_json has not been synced yet — and in
// those cases the input is the Zotero-formatted "Last, Initial." string from
// authors_json, which parses unambiguously on the comma.
// ─────────────────────────────────────────────────────────────────────────────

function normalize(text: string): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split a free-text display name into surname + given-name parts. */
function parseDisplayName(name: string): { last: string; first: string } {
  const clean = (name || '').trim();
  if (!clean) return { last: '', first: '' };
  const comma = clean.indexOf(',');
  if (comma >= 0) {
    // Zotero form "Surname, Given" — surname may be compound ("Fuentes Vega").
    return { last: clean.slice(0, comma).trim(), first: clean.slice(comma + 1).trim() };
  }
  const tokens = clean.split(/\s+/);
  if (tokens.length === 1) return { last: tokens[0], first: '' };
  // "Given Surname[ Surname2]" — first token is the given name, the rest surname.
  return { first: tokens[0], last: tokens.slice(1).join(' ') };
}

/** Surname + given parts for a creator, whether structured or `name`-only. */
function creatorParts(c: { lastName?: string; firstName?: string; name?: string | null }): {
  last: string;
  first: string;
} {
  if ((c.lastName ?? '').trim() || (c.firstName ?? '').trim()) {
    return { last: (c.lastName ?? '').trim(), first: (c.firstName ?? '').trim() };
  }
  return parseDisplayName(c.name ?? '');
}

/** The dedupe key. Empty string means "no usable identity" (skip). */
function canonicalKey(parts: { last: string; first: string }): string {
  const last = normalize(parts.last);
  const firstInitial = normalize(parts.first).charAt(0);
  if (last) return `${last}::${firstInitial}`;
  const only = normalize(parts.first);
  return only ? `noname::${only}` : '';
}

export function canonicalKeyFromDisplay(name: string): string {
  return canonicalKey(parseDisplayName(name));
}

/** Preferred display name between two candidates for the same person. */
function betterDisplay(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  const ac = a.includes(',');
  const bc = b.includes(',');
  if (ac !== bc) return ac ? a : b; // "Surname, Given" beats "Given Surname"
  return b.length > a.length ? b : a; // otherwise the fuller string
}

function structuredDisplay(c: WorkCreator): string {
  const last = c.lastName.trim();
  const first = c.firstName.trim();
  if (last && first) return `${last}, ${first}`;
  return last || (c.name ?? '').trim() || first;
}

/**
 * Find or create the canonical author for a normalized key, keeping the fullest
 * display name and enriching affiliation. Returns null for an unusable key.
 */
function getOrCreateCanonicalAuthor(key: string, display: string, affiliation: string | null): string | null {
  if (!key) return null;
  const db = getDb();
  const existing = db.prepare('SELECT author_id, name FROM authors WHERE canonical_key = ?').get(key) as
    | { author_id: string; name: string }
    | undefined;
  if (existing) {
    const nextName = betterDisplay(existing.name, display);
    if (nextName !== existing.name || affiliation) {
      db.prepare('UPDATE authors SET name = ?, affiliation = COALESCE(?, affiliation) WHERE author_id = ?').run(
        nextName,
        affiliation,
        existing.author_id
      );
    }
    return existing.author_id;
  }
  const authorId = uuid();
  db.prepare('INSERT INTO authors (author_id, name, affiliation, canonical_key) VALUES (?, ?, ?, ?)').run(
    authorId,
    display.trim() || key,
    affiliation,
    key
  );
  return authorId;
}

export function linkWorkAuthor(nodusId: string, authorId: string, role: 'author' | 'editor' = 'author'): void {
  getDb()
    .prepare(
      `INSERT INTO work_authors (nodus_id, author_id, role) VALUES (?, ?, ?)
       ON CONFLICT(nodus_id, author_id) DO UPDATE SET
         role = CASE WHEN excluded.role = 'author' THEN 'author' ELSE work_authors.role END`
    )
    .run(nodusId, authorId, role);
}

function parseCreatorsJson(value: string | null): WorkCreator[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is WorkCreator => c && typeof c === 'object' && (c.role === 'author' || c.role === 'editor')
    );
  } catch {
    return [];
  }
}

function parseAuthorsJson(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

interface CanonCreator {
  key: string;
  display: string;
  role: 'author' | 'editor';
  affiliation: string | null;
}

/**
 * Build one work's author links from its Zotero creators (the single source of
 * truth). Uses structured creators_json when available (carrying editor roles),
 * otherwise the legacy authors_json strings (all treated as authors). Links the
 * canonical authors and drops any other author node previously linked to this
 * work — this is what removes the AI-extracted name variants.
 *
 * @param createIfMissing when false, a work that has NO existing author links is
 *   left untouched (so ingest never fabricates authors for un-analysed works).
 * @param affiliationByKey optional canonical-key → affiliation map (AI enrichment).
 */
export function linkZoteroAuthors(
  nodusId: string,
  opts: { createIfMissing: boolean; affiliationByKey?: Map<string, string | null> } = { createIfMissing: true }
): void {
  const db = getDb();
  const work = db.prepare('SELECT creators_json, authors_json FROM works WHERE nodus_id = ?').get(nodusId) as
    | { creators_json: string | null; authors_json: string | null }
    | undefined;
  if (!work) return;

  const raw: CanonCreator[] = [];
  const structured = parseCreatorsJson(work.creators_json);
  if (structured.length > 0) {
    for (const c of structured) {
      const key = canonicalKey(creatorParts(c));
      if (!key) continue;
      raw.push({ key, display: structuredDisplay(c), role: c.role, affiliation: opts.affiliationByKey?.get(key) ?? null });
    }
  } else {
    for (const name of parseAuthorsJson(work.authors_json)) {
      const key = canonicalKey(parseDisplayName(name));
      if (!key) continue;
      raw.push({ key, display: name, role: 'author', affiliation: opts.affiliationByKey?.get(key) ?? null });
    }
  }

  // Dedupe by canonical key: author role wins over editor, fullest display wins.
  const byKey = new Map<string, CanonCreator>();
  for (const c of raw) {
    const cur = byKey.get(c.key);
    if (!cur) {
      byKey.set(c.key, c);
    } else {
      cur.display = betterDisplay(cur.display, c.display);
      if (c.role === 'author') cur.role = 'author';
      cur.affiliation = cur.affiliation ?? c.affiliation;
    }
  }
  const canon = [...byKey.values()];

  // No Zotero creators → never strip existing links (protects manual/AI-only works).
  if (canon.length === 0) return;

  const hasExisting =
    (db.prepare('SELECT COUNT(*) AS n FROM work_authors WHERE nodus_id = ?').get(nodusId) as { n: number }).n > 0;
  if (!opts.createIfMissing && !hasExisting) return;

  const keepIds: string[] = [];
  for (const c of canon) {
    const id = getOrCreateCanonicalAuthor(c.key, c.display, c.affiliation);
    if (!id) continue;
    linkWorkAuthor(nodusId, id, c.role);
    keepIds.push(id);
  }

  if (keepIds.length > 0) {
    const placeholders = keepIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM work_authors WHERE nodus_id = ? AND author_id NOT IN (${placeholders})`).run(
      nodusId,
      ...keepIds
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// One-time reconcile of a pre-existing corpus (runs once on upgrade)
//
// Rebuilds the whole author layer from each work's Zotero authors_json, keyed by
// canonical identity, then deletes the orphaned name-variant nodes. This only
// touches DERIVED data (authors, work_authors, author_relations, synthesis
// caches) — ideas, works, edges, evidence, themes and notes are never modified,
// so no research data can be lost. Demo data (demo-% ids) is skipped so the
// curated demo graph is preserved verbatim.
// ─────────────────────────────────────────────────────────────────────────────

const RECONCILE_FLAG = 'author_layer_reconciled';

function readFlag(key: string): string | undefined {
  return (getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
}

function writeFlag(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

export function reconcileAuthorLayerOnce(): void {
  if (readFlag(RECONCILE_FLAG) === '1') return;
  const db = getDb();

  const run = db.transaction(() => {
    // 1. Backfill canonical_key on every existing (non-demo) author row so the
    //    per-work rebuild can match against the right canonical node.
    const authors = db.prepare("SELECT author_id, name FROM authors WHERE author_id NOT LIKE 'demo-%'").all() as {
      author_id: string;
      name: string;
    }[];
    const setKey = db.prepare('UPDATE authors SET canonical_key = ? WHERE author_id = ?');
    for (const a of authors) {
      const key = canonicalKeyFromDisplay(a.name);
      if (key) setKey.run(key, a.author_id);
    }

    // 2. Rebuild links for every non-demo work that currently has author links
    //    (i.e. was analysed). Un-analysed works are left as-is.
    const works = db
      .prepare(
        `SELECT nodus_id FROM works
          WHERE nodus_id NOT LIKE 'demo-%'
            AND nodus_id IN (SELECT DISTINCT nodus_id FROM work_authors)`
      )
      .all() as { nodus_id: string }[];
    for (const w of works) linkZoteroAuthors(w.nodus_id, { createIfMissing: true });

    // 3. Delete now-orphaned (non-demo) author nodes — the dropped name variants.
    db.prepare(
      `DELETE FROM authors
        WHERE author_id NOT LIKE 'demo-%'
          AND author_id NOT IN (SELECT DISTINCT author_id FROM work_authors)`
    ).run();

    // 4. Author ids changed → regenerable synthesis caches must be cleared.
    db.prepare('DELETE FROM author_dossier_synthesis').run();
    db.prepare('DELETE FROM synthesis_matrix_cell').run();

    // 5. Rebuild the derived relations only if we actually touched real works
    //    (a demo-only DB keeps its curated author_relations untouched).
    if (works.length > 0) recomputeAuthorRelations();

    writeFlag(RECONCILE_FLAG, '1');
  });
  run();
}

/**
 * Recompute the DERIVED author-relations layer from the idea graph.
 * Two authors are related when works they (co-)authored are connected by
 * contradicts/extends/supports/refutes edges. Never inferred by the model.
 */
export function recomputeAuthorRelations(): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM author_relations').run();

    const edges = db
      .prepare("SELECT from_id, to_id, type, confidence FROM visible_edges WHERE type IN ('contradicts','extends','supports','refutes')")
      .all() as { from_id: string; to_id: string; type: string; confidence: number }[];

    const weights = new Map<string, { from: string; to: string; type: string; weight: number }>();

    for (const e of edges) {
      const fromAuthors = authorsForIdea(e.from_id);
      const toAuthors = authorsForIdea(e.to_id);
      for (const fa of fromAuthors) {
        for (const ta of toAuthors) {
          if (fa === ta) continue;
          const key = `${fa}::${ta}::${e.type}`;
          const cur = weights.get(key) ?? { from: fa, to: ta, type: e.type, weight: 0 };
          cur.weight += e.confidence;
          weights.set(key, cur);
        }
      }
    }

    const ins = db.prepare(
      'INSERT OR REPLACE INTO author_relations (from_author, to_author, type, weight) VALUES (?, ?, ?, ?)'
    );
    for (const w of weights.values()) ins.run(w.from, w.to, w.type, w.weight);
  });
  tx();
}

function authorsForIdea(globalId: string): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT wa.author_id
       FROM idea_occurrences io
       JOIN work_authors wa ON wa.nodus_id = io.nodus_id
       WHERE io.global_id = ?`
    )
    .all(globalId) as { author_id: string }[];
  return rows.map((r) => r.author_id);
}
