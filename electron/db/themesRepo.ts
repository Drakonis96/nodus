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

export function listThemes(): Theme[] {
  return getDb().prepare('SELECT * FROM themes ORDER BY label').all() as Theme[];
}
