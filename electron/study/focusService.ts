import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { DEFAULT_FOCUS_PREFERENCES, focusDayKey, normalizeFocusTask, sanitizeFocusLayout, splitFocusInterval } from '../../shared/studyFocus';
import type { FocusAction, FocusPreferences, FocusState, FocusStats, FocusVaultContext, FocusVaultTime } from '../../shared/studyFocus';
import { focusHasSubjects } from '../../shared/studyFocus';
import { ensureGlobalFocusSchema } from './focusStore';

/** One profile session; vault changes only split attribution, never the timer. */
export class FocusService {
  private state: FocusState;
  private monoAnchor = 0;
  private wallAnchor = 0;
  private vault: FocusVaultContext = { id: '', name: '', type: 'estudio' };
  get context(): FocusVaultContext { return { ...this.vault }; }
  constructor(private db: Database.Database, private now = () => Date.now(), private monotonic = () => performance.now(), private completed: (state: FocusState) => void = () => {}, private resolveSubject?: (id: string, vaultId: string) => string | null) {
    ensureGlobalFocusSchema(db);
    const row = db.prepare('SELECT state_json FROM study_focus_state WHERE id = 1').get() as { state_json: string } | undefined;
    const stored = row ? JSON.parse(row.state_json) as Partial<FocusState> : null;
    // State written before migration 195 has no `task`; older fields keep their value.
    this.state = {
      revision: 0, phase: 'work', status: 'ready', durationMs: 25 * 60000, elapsedMs: 0,
      cycleBlocks: 0, sessionId: null, subjectId: null, subjectVaultId: null, subjectName: null, originVaultId: null, task: null, recovered: false,
      ...stored,
      preferences: { ...DEFAULT_FOCUS_PREFERENCES, ...stored?.preferences, layout: { ...stored?.preferences?.layout } },
    } as FocusState;
    if (this.state.status === 'running') {
      this.state.status = 'paused';
      this.state.recovered = true;
      this.state.revision++;
      db.transaction(() => {
        this.db.prepare("UPDATE study_focus_sessions SET status = 'paused' WHERE id = ?").run(this.state.sessionId);
        this.persist();
      })();
    }
  }
  setVault(vault: FocusVaultContext): void {
    if (vault.id === this.vault.id && vault.name === this.vault.name && vault.type === this.vault.type) return;
    this.tick(true);
    const previous = structuredClone(this.state);
    const priorVault = this.vault;
    try {
      this.db.transaction(() => {
        this.db.prepare(`INSERT INTO focus_vaults(id, name, type) VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type`).run(vault.id, vault.name, vault.type);
        const row = this.db.prepare('SELECT layout_json FROM focus_vaults WHERE id = ?').get(vault.id) as { layout_json: string };
        this.vault = { ...vault };
        this.state.preferences.layout = sanitizeFocusLayout(JSON.parse(row.layout_json)) ?? {};
        this.state.revision++;
        this.persist();
      })();
    } catch (error) { this.vault = priorVault; this.state = previous; throw error; }
  }
  private persist() {
    this.db.prepare('INSERT INTO study_focus_state (id, state_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json').run(JSON.stringify(this.state));
  }
  private delta() { return this.state.status === 'running' ? Math.min(this.state.durationMs - this.state.elapsedMs, Math.max(0, this.monotonic() - this.monoAnchor)) : 0; }
  snapshot(): FocusState { return { ...this.state, preferences: { ...this.state.preferences, layout: { ...this.state.preferences.layout } }, elapsedMs: this.state.elapsedMs + this.delta() }; }
  /** Called every second; the clock, never the number of callbacks, determines elapsed time. */
  tick(force = false) {
    if (this.state.status !== 'running') return;
    const delta = this.delta();
    const ended = this.state.elapsedMs + delta >= this.state.durationMs;
    if (!force && !ended && delta < 15000) return;
    const previous = structuredClone(this.state);
    try {
      this.db.transaction(() => {
        if (this.state.phase === 'work' && delta > 0) {
          const insert = this.db.prepare('INSERT INTO study_focus_intervals(session_id, started_at, milliseconds, day, vault_id) VALUES (?, ?, ?, ?, ?)');
          for (const part of splitFocusInterval(this.wallAnchor, delta)) insert.run(this.state.sessionId, part.start, part.milliseconds, part.day, this.vault.id);
          this.db.prepare('UPDATE study_focus_sessions SET milliseconds = milliseconds + ? WHERE id = ?').run(delta, this.state.sessionId);
        }
        this.state.elapsedMs += delta;
        if (ended) {
          this.state.status = 'complete';
          this.state.revision++;
          if (this.state.phase === 'work') {
            this.state.cycleBlocks++;
            this.db.prepare("UPDATE study_focus_sessions SET status = 'completed', ended_at = ?, completed_day = ?, completed_vault_id = ? WHERE id = ?").run(this.wallAnchor + delta, focusDayKey(new Date(this.wallAnchor + delta)), this.vault.id, this.state.sessionId);
          }
        }
        this.persist();
      })();
    } catch (error) { this.state = previous; throw error; }
    this.monoAnchor = this.monotonic();
    this.wallAnchor = this.now();
    if (ended) this.completed(this.snapshot());
  }
  configure(patch: Partial<FocusPreferences>) {
    const next = { ...this.state.preferences, layout: { ...this.state.preferences.layout } };
    for (const key of ['workMinutes', 'breakMinutes', 'longBreakMinutes', 'dailyGoalMinutes'] as const) {
      if (!(key in patch)) continue;
      const value = patch[key];
      if (key === 'dailyGoalMinutes' && value === null) { next.dailyGoalMinutes = null; continue; }
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > (key === 'dailyGoalMinutes' ? 1440 : 180)) throw new Error('La duración debe ser un número entero entre 1 y 180 minutos (meta: hasta 1440).');
      next[key] = value;
    }
    if ('sound' in patch) {
      if (typeof patch.sound !== 'boolean') throw new Error('Preferencia de sonido inválida.');
      next.sound = patch.sound;
    }
    if ('enterOnStart' in patch) {
      if (typeof patch.enterOnStart !== 'boolean') throw new Error('Valor inválido.');
      next.enterOnStart = patch.enterOnStart;
    }
    if ('layout' in patch) {
      // A full replacement, so "restore defaults" is simply an empty layout.
      const layout = sanitizeFocusLayout(patch.layout);
      if (!layout) throw new Error('Valor inválido.');
      next.layout = layout;
    }
    const previous = this.state.preferences;
    this.state.preferences = next;
    try {
      this.db.transaction(() => {
        if ('layout' in patch) this.db.prepare('UPDATE focus_vaults SET layout_json = ? WHERE id = ?').run(JSON.stringify(next.layout), this.vault.id);
        this.persist();
      })();
    } catch (error) { this.state.preferences = previous; throw error; }
    return this.snapshot();
  }
  /** `subjectId` and `task` apply to `start`; undefined keeps the previous block's, null clears it. */
  act(action: FocusAction, revision: number, subjectId?: string | null, task?: string | null) {
    // Stale / duplicated commands cannot start a subsequent phase or resume a new session.
    if (revision !== this.state.revision) return this.snapshot();
    this.tick(true);
    if (revision !== this.state.revision) return this.snapshot();
    const s = this.state;
    const valid = action === 'start' ? s.status === 'ready' || s.status === 'complete'
      : action === 'pause' ? s.status === 'running' : action === 'resume' ? s.status === 'paused'
      : action === 'finish' && s.status !== 'ready';
    if (!valid) return this.snapshot();
    const previous = structuredClone(s);
    try {
      this.db.transaction(() => {
        if (action === 'start') {
          s.phase = s.status === 'complete' && s.phase === 'work' ? (s.cycleBlocks % 4 === 0 ? 'longBreak' : 'break') : 'work';
          s.elapsedMs = 0;
          s.durationMs = s.preferences[s.phase === 'work' ? 'workMinutes' : s.phase === 'break' ? 'breakMinutes' : 'longBreakMinutes'] * 60000;
          // A break never asks again, so the subject and intention chosen for the
          // previous block carry over to the next one unless the caller changes them.
          if (subjectId !== undefined) { s.subjectId = subjectId || null; s.subjectVaultId = subjectId ? this.vault.id : null; }
          if (task !== undefined) s.task = normalizeFocusTask(task);
          s.sessionId = s.phase === 'work' ? randomUUID() : null;
          if (s.sessionId) {
            const localSubject = s.subjectVaultId === null || s.subjectVaultId === this.vault.id;
            const subjectName = s.subjectId && localSubject && focusHasSubjects(this.vault.type)
              ? this.resolveSubject ? this.resolveSubject(s.subjectId, this.vault.id)
                : (this.db.prepare('SELECT name FROM study_subjects WHERE id = ? AND deleted_at IS NULL').get(s.subjectId) as { name: string } | undefined)?.name ?? null
              : null;
            if (s.subjectId && !subjectName) {
              // An explicit choice must exist; a carried-over one may have been deleted since.
              if (subjectId) throw new Error('Asignatura no encontrada.');
              s.subjectId = null; s.subjectVaultId = null;
            }
            s.subjectName = subjectName;
            s.subjectVaultId = s.subjectId ? this.vault.id : null;
            s.originVaultId = this.vault.id;
            this.db.prepare("INSERT INTO study_focus_sessions (id, started_at, status, subject_id, subject_name, task, origin_vault_id, subject_vault_id) VALUES (?, ?, 'running', ?, ?, ?, ?, ?)").run(s.sessionId, this.now(), s.subjectId, subjectName, s.task, this.vault.id, s.subjectVaultId);
          }
          s.status = 'running';
        } else if (action === 'pause' || action === 'resume') {
          s.status = action === 'pause' ? 'paused' : 'running';
          if (s.sessionId) this.db.prepare('UPDATE study_focus_sessions SET status = ? WHERE id = ?').run(s.status, s.sessionId);
        } else {
          if (s.sessionId && s.status !== 'complete') this.db.prepare("UPDATE study_focus_sessions SET status = 'ended', ended_at = ? WHERE id = ?").run(this.now(), s.sessionId);
          s.status = 'ready'; s.phase = 'work'; s.elapsedMs = 0; s.sessionId = null;
          s.durationMs = s.preferences.workMinutes * 60000;
        }
        s.recovered = false;
        s.revision++;
        this.persist();
      })();
    } catch (error) { this.state = previous; throw error; }
    this.monoAnchor = this.monotonic(); this.wallAnchor = this.now();
    return this.snapshot();
  }
  pause() { return this.act('pause', this.state.revision); }
  stats(): FocusStats {
    this.tick(true);
    const today = new Date(this.now());
    const since = focusDayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 83));
    const rows = this.db.prepare('SELECT day, SUM(milliseconds) AS milliseconds FROM study_focus_intervals WHERE day >= ? GROUP BY day').all(since) as { day: string; milliseconds: number }[];
    const blocks = this.db.prepare("SELECT completed_day AS day, COUNT(*) AS blocks FROM study_focus_sessions WHERE status = 'completed' AND completed_day >= ? GROUP BY completed_day").all(since) as { day: string; blocks: number }[];
    const byDay = new Map(rows.map(row => [row.day, row.milliseconds]));
    const byBlocks = new Map(blocks.map(row => [row.day, row.blocks]));
    const days = Array.from({ length: 84 }, (_, i) => {
      const day = focusDayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 83 + i));
      return { day, milliseconds: byDay.get(day) ?? 0, blocks: byBlocks.get(day) ?? 0 };
    });
    const recent = this.db.prepare('SELECT id, started_at AS startedAt, ended_at AS endedAt, milliseconds, status, subject_id AS subjectId, subject_name AS subjectName, task, origin_vault_id AS originVaultId FROM study_focus_sessions ORDER BY started_at DESC, rowid DESC LIMIT 20').all() as FocusStats['recent'];
    const sessionVaults = this.db.prepare(`SELECT i.vault_id AS vaultId, COALESCE(v.name, '') AS vaultName, SUM(i.milliseconds) AS milliseconds
      FROM study_focus_intervals i LEFT JOIN focus_vaults v ON v.id = i.vault_id WHERE i.session_id = ? GROUP BY i.vault_id ORDER BY MIN(i.started_at)`);
    for (const session of recent) session.vaults = sessionVaults.all(session.id) as FocusVaultTime[];
    const vaultRows = this.db.prepare('SELECT id AS vaultId, name AS vaultName FROM focus_vaults ORDER BY name').all() as Array<{ vaultId: string; vaultName: string }>;
    const timeRows = this.db.prepare('SELECT vault_id AS vaultId, day, SUM(milliseconds) AS milliseconds FROM study_focus_intervals WHERE day >= ? GROUP BY vault_id, day').all(since) as Array<{ vaultId: string; day: string; milliseconds: number }>;
    const blockRows = this.db.prepare("SELECT completed_vault_id AS vaultId, completed_day AS day, COUNT(*) AS blocks FROM study_focus_sessions WHERE status = 'completed' AND completed_day >= ? GROUP BY completed_vault_id, completed_day").all(since) as Array<{ vaultId: string; day: string; blocks: number }>;
    const times = new Map(timeRows.map(row => [JSON.stringify([row.vaultId, row.day]), row.milliseconds]));
    const counts = new Map(blockRows.map(row => [JSON.stringify([row.vaultId, row.day]), row.blocks]));
    const vaults = vaultRows.map(vault => ({ ...vault, days: days.map(({ day }) => ({ day, milliseconds: times.get(JSON.stringify([vault.vaultId, day])) ?? 0, blocks: counts.get(JSON.stringify([vault.vaultId, day])) ?? 0 })) }));
    return { days, recent, vaults };
  }
}
