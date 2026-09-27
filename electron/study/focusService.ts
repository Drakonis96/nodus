import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { DEFAULT_FOCUS_PREFERENCES, focusDayKey, splitFocusInterval } from '../../shared/studyFocus';
import type { FocusAction, FocusPreferences, FocusState, FocusStats } from '../../shared/studyFocus';

/** Owns one vault connection. All transitions and interval writes are one transaction. */
export class FocusService {
  private state: FocusState;
  private monoAnchor = 0;
  private wallAnchor = 0;
  constructor(private db: Database.Database, private now = () => Date.now(), private monotonic = () => performance.now(), private completed: (state: FocusState) => void = () => {}) {
    const row = db.prepare('SELECT state_json FROM study_focus_state WHERE id = 1').get() as { state_json: string } | undefined;
    this.state = row ? JSON.parse(row.state_json) : {
      revision: 0, phase: 'work', status: 'ready', durationMs: 25 * 60000, elapsedMs: 0,
      cycleBlocks: 0, sessionId: null, subjectId: null, recovered: false, preferences: { ...DEFAULT_FOCUS_PREFERENCES },
    };
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
  private persist() {
    this.db.prepare('INSERT INTO study_focus_state (id, state_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json').run(JSON.stringify(this.state));
  }
  private delta() { return this.state.status === 'running' ? Math.min(this.state.durationMs - this.state.elapsedMs, Math.max(0, this.monotonic() - this.monoAnchor)) : 0; }
  snapshot(): FocusState { return { ...this.state, preferences: { ...this.state.preferences }, elapsedMs: this.state.elapsedMs + this.delta() }; }
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
          const insert = this.db.prepare('INSERT INTO study_focus_intervals(session_id, started_at, milliseconds, day) VALUES (?, ?, ?, ?)');
          for (const part of splitFocusInterval(this.wallAnchor, delta)) insert.run(this.state.sessionId, part.start, part.milliseconds, part.day);
          this.db.prepare('UPDATE study_focus_sessions SET milliseconds = milliseconds + ? WHERE id = ?').run(delta, this.state.sessionId);
        }
        this.state.elapsedMs += delta;
        if (ended) {
          this.state.status = 'complete';
          this.state.revision++;
          if (this.state.phase === 'work') {
            this.state.cycleBlocks++;
            this.db.prepare("UPDATE study_focus_sessions SET status = 'completed', ended_at = ?, completed_day = ? WHERE id = ?").run(this.wallAnchor + delta, focusDayKey(new Date(this.wallAnchor + delta)), this.state.sessionId);
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
    const next = { ...this.state.preferences };
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
    const previous = this.state.preferences;
    this.state.preferences = next;
    try { this.persist(); } catch (error) { this.state.preferences = previous; throw error; }
    return this.snapshot();
  }
  act(action: FocusAction, revision: number, subjectId: string | null = null) {
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
          s.subjectId = subjectId;
          s.sessionId = s.phase === 'work' ? randomUUID() : null;
          if (s.sessionId) {
            const subject = subjectId ? this.db.prepare('SELECT name FROM study_subjects WHERE id = ?').get(subjectId) as { name: string } | undefined : undefined;
            if (subjectId && !subject) throw new Error('Asignatura no encontrada.');
            this.db.prepare("INSERT INTO study_focus_sessions (id, started_at, status, subject_id, subject_name) VALUES (?, ?, 'running', ?, ?)").run(s.sessionId, this.now(), subjectId, subject?.name ?? null);
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
    const recent = this.db.prepare('SELECT id, started_at AS startedAt, ended_at AS endedAt, milliseconds, status, subject_id AS subjectId, subject_name AS subjectName FROM study_focus_sessions ORDER BY started_at DESC, rowid DESC LIMIT 20').all() as FocusStats['recent'];
    return { days, recent };
  }
}
