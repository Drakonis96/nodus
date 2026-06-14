import { getDb } from './database';
import { v4 as uuid } from 'uuid';
import type { Theme } from '@shared/types';

const THEME_ALIASES: Record<string, string> = {
  'francoist spain': 'franquismo',
  gender: 'género',
  representation: 'representación',
  spain: 'españa',
  'travel writing': 'escritura de viajes',
  'women travellers': 'viajeras',
  ethics: 'ética',
  'ethics of travel': 'ética del viaje',
  'escape from reality': 'evasión',
  'rural andalusia': 'andalucía rural',
  'national identity': 'identidad nacional',
  tourism: 'turismo',
  colonialism: 'colonialismo',
};

export function normalizeThemeLabel(label: string): string {
  const norm = label.trim().toLowerCase().replace(/\s+/g, ' ');
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
  });
  tx();
}

/**
 * Add themes to a work without dropping the ones it already has. The light scan finds
 * broad "research line" parents (e.g. "literatura de viajes") and the deep scan finds
 * finer families; neither should clobber the other, or sibling ideas end up orphaned
 * from their parent theme node. New labels are prioritised, then existing ones, deduped
 * by normalized label and capped.
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

export function listThemes(): Theme[] {
  return getDb().prepare('SELECT * FROM themes ORDER BY label').all() as Theme[];
}
