import { getDb } from './database';
import { v4 as uuid } from 'uuid';
import type { ManagedTheme, Theme } from '@shared/types';

export const MIN_GRAPH_THEME_WORKS = 2;
export const MAX_GRAPH_THEMES = 24;

const THEME_ALIASES: Record<string, string> = {
  'francoist spain': 'franquismo',
  gender: 'género',
  'gender studies': 'género',
  'estudios de género': 'género',
  representation: 'representación',
  spain: 'españa',
  'travel writing': 'escritura de viajes',
  'relatos de viaje': 'literatura de viajes',
  'relato de viaje': 'literatura de viajes',
  'guías de viaje': 'literatura de viajes',
  viajes: 'literatura de viajes',
  'women travellers': 'viajeras',
  ethics: 'ética',
  'ethics of travel': 'ética del viaje',
  'escape from reality': 'evasión',
  'rural andalusia': 'andalucía rural',
  'national identity': 'identidad nacional',
  tourism: 'turismo',
  'turismo y viajes': 'turismo',
  'viajes y turismo': 'turismo',
  colonialism: 'colonialismo',
  'historia contemporánea de españa': 'historia de españa',
  'historia social de españa': 'historia de españa',
};

export function normalizeThemeLabel(label: string): string {
  const norm = label
    .trim()
    .toLowerCase()
    .replace(/[“”"'.:;]+/g, '')
    .replace(/\s+/g, ' ');
  return THEME_ALIASES[norm] ?? norm;
}

export function getOrCreateTheme(label: string): string {
  const db = getDb();
  const norm = normalizeThemeLabel(label);
  const existing = db.prepare('SELECT theme_id FROM themes WHERE label = ?').get(norm) as { theme_id: string } | undefined;
  if (existing) return existing.theme_id;
  const theme_id = uuid();
  db.prepare('INSERT INTO themes (theme_id, label, created_at) VALUES (?, ?, ?)').run(
    theme_id,
    norm,
    new Date().toISOString()
  );
  return theme_id;
}

export function setWorkThemes(nodusId: string, labels: string[]): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM work_themes WHERE nodus_id = ?').run(nodusId);
    for (const label of labels) {
      if (!label.trim()) continue;
      const theme_id = getOrCreateTheme(normalizeThemeLabel(label));
      db.prepare('INSERT OR IGNORE INTO work_themes (nodus_id, theme_id) VALUES (?, ?)').run(nodusId, theme_id);
    }
    // Prune orphan auto-themes, but keep user-curated (pinned) ones so they survive a
    // reprocess even before any work is assigned to them.
    db.prepare(
      'DELETE FROM themes WHERE pinned = 0 AND theme_id NOT IN (SELECT DISTINCT theme_id FROM work_themes)'
    ).run();
  });
  tx();
}

/**
 * Add a small number of deep-scan families without dropping the broad light-scan
 * parents already assigned to the work. New labels are prioritised, then existing
 * ones, deduped by normalized label and capped.
 */
export function unionWorkThemes(nodusId: string, newLabels: string[], cap = 8): void {
  const existing = getWorkThemeLabels(nodusId);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const label of [...newLabels, ...existing]) {
    if (!label || !label.trim()) continue;
    const norm = normalizeThemeLabel(label);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(label);
  }
  if (out.length > 0) setWorkThemes(nodusId, out.slice(0, cap));
}

export function getWorkThemeLabels(nodusId: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT t.label FROM work_themes wt JOIN themes t ON t.theme_id = wt.theme_id WHERE wt.nodus_id = ? ORDER BY t.label`
    )
    .all(nodusId) as { label: string }[];
  return rows.map((r) => r.label);
}

export function setIdeaThemeLinks(
  nodusId: string,
  globalId: string,
  labels: string[],
  confidence: number,
  basis: 'explicit' | 'inferred' = 'explicit'
): void {
  const db = getDb();
  const seen = new Set<string>();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM idea_theme_links WHERE nodus_id = ? AND global_id = ?').run(nodusId, globalId);
    for (const label of labels) {
      const norm = normalizeThemeLabel(label);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      const themeId = getOrCreateTheme(norm);
      db.prepare(
        `INSERT OR REPLACE INTO idea_theme_links (nodus_id, global_id, theme_id, confidence, basis)
         VALUES (?, ?, ?, ?, ?)`
      ).run(nodusId, globalId, themeId, confidence, basis);
    }
  });
  tx();
}

export function listThemes(): Theme[] {
  return getDb().prepare('SELECT * FROM themes ORDER BY label').all() as Theme[];
}

/** Every theme label currently known — the curated universe used when scans are locked. */
export function listThemeLabels(): string[] {
  return (getDb().prepare('SELECT label FROM themes ORDER BY label').all() as { label: string }[]).map((r) => r.label);
}

/**
 * All themes with their usage counts and curated flag, for the "Temas principales"
 * manager. Includes pinned themes that have no works/ideas yet.
 */
export function listManagedThemes(): ManagedTheme[] {
  const rows = getDb()
    .prepare(
      `SELECT
         t.theme_id,
         t.label,
         t.created_at,
         t.pinned,
         COUNT(DISTINCT CASE WHEN w.archived = 0 THEN wt.nodus_id END) AS work_count,
         COUNT(DISTINCT CASE WHEN w.archived = 0 THEN io.global_id END) AS idea_count
       FROM themes t
       LEFT JOIN work_themes wt ON wt.theme_id = t.theme_id
       LEFT JOIN works w ON w.nodus_id = wt.nodus_id
       LEFT JOIN idea_occurrences io ON io.nodus_id = wt.nodus_id
       GROUP BY t.theme_id
       ORDER BY t.pinned DESC, idea_count DESC, work_count DESC, t.label ASC`
    )
    .all() as { theme_id: string; label: string; created_at: string; pinned: number; work_count: number; idea_count: number }[];
  return rows.map((r) => ({
    theme_id: r.theme_id,
    label: r.label,
    created_at: r.created_at,
    pinned: r.pinned === 1,
    work_count: r.work_count,
    idea_count: r.idea_count,
  }));
}

/** Create (or pin an existing) user-curated main theme. Returns its id. */
export function addManualTheme(label: string): string {
  const db = getDb();
  const norm = normalizeThemeLabel(label);
  if (!norm) throw new Error('El tema no puede estar vacío.');
  const existing = db.prepare('SELECT theme_id FROM themes WHERE label = ?').get(norm) as { theme_id: string } | undefined;
  if (existing) {
    db.prepare('UPDATE themes SET pinned = 1 WHERE theme_id = ?').run(existing.theme_id);
    return existing.theme_id;
  }
  const theme_id = uuid();
  db.prepare('INSERT INTO themes (theme_id, label, created_at, pinned) VALUES (?, ?, ?, 1)').run(
    theme_id,
    norm,
    new Date().toISOString()
  );
  return theme_id;
}

export function setThemePinned(themeId: string, pinned: boolean): void {
  getDb().prepare('UPDATE themes SET pinned = ? WHERE theme_id = ?').run(pinned ? 1 : 0, themeId);
  if (!pinned) {
    // An unpinned theme with no works is just clutter — drop it like an auto-theme.
    getDb()
      .prepare(
        'DELETE FROM themes WHERE theme_id = ? AND pinned = 0 AND theme_id NOT IN (SELECT DISTINCT theme_id FROM work_themes)'
      )
      .run(themeId);
  }
}

export function renameTheme(themeId: string, label: string): void {
  const db = getDb();
  const norm = normalizeThemeLabel(label);
  if (!norm) throw new Error('El tema no puede estar vacío.');
  const clash = db.prepare('SELECT theme_id FROM themes WHERE label = ? AND theme_id <> ?').get(norm, themeId) as
    | { theme_id: string }
    | undefined;
  const tx = db.transaction(() => {
    if (clash) {
      // Merge into the existing theme with that label: move links, then drop this one.
      db.prepare('UPDATE OR IGNORE work_themes SET theme_id = ? WHERE theme_id = ?').run(clash.theme_id, themeId);
      db.prepare('DELETE FROM work_themes WHERE theme_id = ?').run(themeId);
      db.prepare('UPDATE OR IGNORE idea_theme_links SET theme_id = ? WHERE theme_id = ?').run(clash.theme_id, themeId);
      db.prepare('DELETE FROM idea_theme_links WHERE theme_id = ?').run(themeId);
      db.prepare('UPDATE themes SET pinned = 1 WHERE theme_id = ?').run(clash.theme_id);
      db.prepare('DELETE FROM themes WHERE theme_id = ?').run(themeId);
    } else {
      db.prepare('UPDATE themes SET label = ? WHERE theme_id = ?').run(norm, themeId);
    }
  });
  tx();
}

/** Delete a theme and all of its node connections (work + idea links). Ideas are untouched. */
export function deleteTheme(themeId: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM work_themes WHERE theme_id = ?').run(themeId);
    db.prepare('DELETE FROM idea_theme_links WHERE theme_id = ?').run(themeId);
    db.prepare('DELETE FROM themes WHERE theme_id = ?').run(themeId);
  });
  tx();
}

export interface GraphTheme extends Theme {
  work_count: number;
  idea_count: number;
}

/**
 * Themes used as visible graph hubs. Once the idea layer exists, only themes that
 * actually group ideas are promoted to graph nodes; before that, show supported
 * light-scan themes so a new library still has a coarse map.
 */
export function listGraphThemes(): GraphTheme[] {
  const db = getDb();
  const hasIdeas = ((db.prepare('SELECT COUNT(*) as c FROM ideas').get() as { c: number }).c ?? 0) > 0;
  // Curated (pinned) themes are always graph-hub candidates so the user's chosen main
  // themes never get capped out by auto-themes.
  const supportClause = `(pinned = 1 OR ${hasIdeas ? 'idea_count > 0' : 'work_count >= @minWorks'})`;
  const stmt = db.prepare(
    `
      SELECT * FROM (
        SELECT
          t.theme_id,
          t.label,
          t.created_at,
          t.pinned,
          COUNT(DISTINCT CASE WHEN w.archived = 0 THEN wt.nodus_id END) AS work_count,
          COUNT(DISTINCT CASE WHEN w.archived = 0 THEN io.global_id END) AS idea_count
        FROM themes t
        LEFT JOIN work_themes wt ON wt.theme_id = t.theme_id
        LEFT JOIN works w ON w.nodus_id = wt.nodus_id
        LEFT JOIN idea_occurrences io ON io.nodus_id = wt.nodus_id
        GROUP BY t.theme_id
      )
      WHERE ${supportClause}
      ORDER BY pinned DESC, idea_count DESC, work_count DESC, label ASC
      LIMIT @maxThemes
      `
  );
  const params = hasIdeas
    ? { maxThemes: MAX_GRAPH_THEMES }
    : { minWorks: MIN_GRAPH_THEME_WORKS, maxThemes: MAX_GRAPH_THEMES };
  const rows = stmt.all(params) as GraphTheme[];

  return rows;
}
