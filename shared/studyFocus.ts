export type FocusPhase = 'work' | 'break' | 'longBreak';
export type FocusStatus = 'ready' | 'running' | 'paused' | 'complete';
export interface FocusPreferences {
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  dailyGoalMinutes: number | null;
  sound: boolean;
}
export interface FocusState {
  revision: number;
  phase: FocusPhase;
  status: FocusStatus;
  durationMs: number;
  elapsedMs: number;
  cycleBlocks: number;
  sessionId: string | null;
  subjectId: string | null;
  /** The block's intention ("Repasar el tema 3"); carried into the next block until changed. */
  task: string | null;
  recovered: boolean;
  preferences: FocusPreferences;
}
export interface FocusDay { day: string; milliseconds: number; blocks: number }
export interface FocusSession {
  id: string; startedAt: number; endedAt: number | null; milliseconds: number;
  status: 'running' | 'paused' | 'completed' | 'ended'; subjectId: string | null; subjectName: string | null;
  task: string | null;
}
export interface FocusStats { days: FocusDay[]; recent: FocusSession[] }
export interface FocusSnapshot { vaultId: string; state: FocusState }
export type FocusAction = 'start' | 'pause' | 'resume' | 'finish';
export interface StudyFocusApi {
  getStudyFocus(): Promise<FocusSnapshot>;
  configureStudyFocus(vaultId: string, preferences: Partial<FocusPreferences>): Promise<FocusSnapshot>;
  /** `subjectId`/`task` only matter for `start`; leave them undefined to keep the previous block's. */
  actStudyFocus(vaultId: string, action: FocusAction, revision: number, subjectId?: string | null, task?: string | null): Promise<FocusSnapshot>;
  getStudyFocusStats(): Promise<FocusStats>;
  setStudyFocusDistractions(reduced: boolean): Promise<void>;
  onStudyFocusChanged(callback: (snapshot: FocusSnapshot) => void): () => void;
  onStudyFocusCompleted(callback: (snapshot: FocusSnapshot) => void): () => void;
}
export const DEFAULT_FOCUS_PREFERENCES: FocusPreferences = {
  workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, dailyGoalMinutes: null, sound: true,
};
export const FOCUS_TASK_MAX_LENGTH = 160;
/** Blank means no intention; overlong text is cut rather than rejected. */
export function normalizeFocusTask(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const task = value.replace(/\s+/g, ' ').trim().slice(0, FOCUS_TASK_MAX_LENGTH);
  return task || null;
}
export function focusDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
/** Local calendar boundaries, including 23/25-hour days. Never round interval minutes. */
export function splitFocusInterval(start: number, milliseconds: number): Array<{ day: string; start: number; milliseconds: number }> {
  const parts = [];
  let cursor = start;
  const end = start + milliseconds;
  while (cursor < end) {
    const date = new Date(cursor);
    const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    const next = Math.min(end, midnight);
    parts.push({ day: focusDayKey(date), start: cursor, milliseconds: next - cursor });
    cursor = next;
  }
  return parts;
}
