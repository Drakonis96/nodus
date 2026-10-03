import Database from 'better-sqlite3';
import fs from 'node:fs';
import type { FocusState, FocusVaultContext } from '../../shared/studyFocus';
import { DEFAULT_FOCUS_PREFERENCES, sanitizeFocusLayout } from '../../shared/studyFocus';
import { STUDY_FOCUS_SQL, ensureStudyFocusTaskColumn } from '../db/studyFocusSchema';

/** The profile database reuses the proven interval schema, with vault provenance. */
export function ensureGlobalFocusSchema(db: Database.Database): void {
  db.exec(STUDY_FOCUS_SQL);
  ensureStudyFocusTaskColumn(db);
  for (const [table, names] of [
    ['study_focus_sessions', ['origin_vault_id', 'completed_vault_id', 'subject_vault_id']],
    ['study_focus_intervals', ['vault_id']],
  ] as const) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    for (const name of names) if (!columns.some(column => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} TEXT`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS focus_vaults (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, layout_json TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS focus_legacy_intervals (vault_id TEXT NOT NULL, interval_id INTEGER NOT NULL, PRIMARY KEY(vault_id, interval_id));
    CREATE INDEX IF NOT EXISTS idx_focus_interval_vault_day ON study_focus_intervals(vault_id, day);
  `);
}

type LegacyVault = FocusVaultContext & { path: string };
interface LegacySession {
  id: string; started_at: number; ended_at: number | null; milliseconds: number; status: string;
  subject_id: string | null; subject_name: string | null; completed_day: string | null; task?: string | null;
}
interface LegacyInterval { id: number; session_id: string; started_at: number; milliseconds: number; day: string }
const legacyId = (vaultId: string, id: string) => `legacy:${vaultId}:${id}`;

/** Read-only sources stay intact. A transaction and provenance keys make retries safe. */
export function importLegacyFocus(db: Database.Database, vaults: LegacyVault[], activeVaultId: string): void {
  const seed = !db.prepare('SELECT 1 FROM study_focus_state WHERE id = 1').get();
  const candidates: Array<{ vault: LegacyVault; state: Partial<FocusState>; latest: number }> = [];
  for (const vault of vaults) {
    if (!fs.existsSync(vault.path) || vault.path === db.name) continue;
    let source: Database.Database | undefined;
    try {
      source = new Database(vault.path, { readonly: true, fileMustExist: true });
      if (!source.prepare("SELECT 1 FROM sqlite_master WHERE name = 'study_focus_state'").get()) continue;
      const row = source.prepare('SELECT state_json FROM study_focus_state WHERE id = 1').get() as { state_json: string } | undefined;
      const state = row ? JSON.parse(row.state_json) as Partial<FocusState> : null;
      const sessions = source.prepare('SELECT * FROM study_focus_sessions').all() as LegacySession[];
      const intervals = source.prepare('SELECT * FROM study_focus_intervals').all() as LegacyInterval[];
      db.transaction(() => {
        db.prepare('INSERT OR IGNORE INTO focus_vaults(id, name, type, layout_json) VALUES (?, ?, ?, ?)')
          .run(vault.id, vault.name, vault.type, JSON.stringify(sanitizeFocusLayout(state?.preferences?.layout) ?? {}));
        const insertSession = db.prepare(`INSERT OR IGNORE INTO study_focus_sessions
          (id, started_at, ended_at, milliseconds, status, subject_id, subject_name, completed_day, task, origin_vault_id, completed_vault_id, subject_vault_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const session of sessions) insertSession.run(legacyId(vault.id, session.id), session.started_at, session.ended_at, session.milliseconds,
          session.status === 'running' ? 'paused' : session.status, session.subject_id, session.subject_name, session.completed_day,
          session.task ?? null, vault.id, session.status === 'completed' ? vault.id : null, session.subject_id ? vault.id : null);
        const mark = db.prepare('INSERT OR IGNORE INTO focus_legacy_intervals(vault_id, interval_id) VALUES (?, ?)');
        const insertInterval = db.prepare('INSERT INTO study_focus_intervals(session_id, started_at, milliseconds, day, vault_id) VALUES (?, ?, ?, ?, ?)');
        for (const interval of intervals) if (mark.run(vault.id, interval.id).changes) insertInterval.run(legacyId(vault.id, interval.session_id), interval.started_at, interval.milliseconds, interval.day, vault.id);
      })();
      if (seed && state) candidates.push({ vault, state, latest: Math.max(0, ...sessions.map(session => session.started_at)) });
    } catch (error) {
      console.error(`[focus] legacy import failed for ${vault.id}; source retained for retry`, error);
    } finally { source?.close(); }
  }
  if (!seed || !candidates.length) return;
  candidates.sort((a, b) => b.latest - a.latest);
  const preferred = candidates.find(candidate => candidate.vault.id === activeVaultId) ?? candidates[0];
  const pending = candidates.find(candidate => candidate.vault.id === activeVaultId && candidate.state.status !== 'ready')
    ?? candidates.find(candidate => candidate.state.status !== 'ready');
  const selected = pending ?? preferred;
  const state: Partial<FocusState> = { ...selected.state,
    originVaultId: selected.vault.id,
    subjectVaultId: selected.state.subjectId ? selected.vault.id : null,
    subjectName: null,
    sessionId: selected.state.sessionId ? legacyId(selected.vault.id, selected.state.sessionId) : null,
    preferences: { ...DEFAULT_FOCUS_PREFERENCES, ...preferred.state.preferences,
      enterOnStart: !candidates.some(candidate => candidate.state.preferences?.enterOnStart === false), layout: {} },
  };
  if (state.sessionId) state.subjectName = (db.prepare('SELECT subject_name FROM study_focus_sessions WHERE id = ?').get(state.sessionId) as { subject_name: string | null } | undefined)?.subject_name ?? null;
  db.prepare('INSERT OR IGNORE INTO study_focus_state(id, state_json) VALUES (1, ?)').run(JSON.stringify(state));
}
