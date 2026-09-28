export type FocusPhase = 'work' | 'break' | 'longBreak';
export type FocusStatus = 'ready' | 'running' | 'paused' | 'complete';
export interface FocusPreferences {
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  dailyGoalMinutes: number | null;
  sound: boolean;
  /** Starting a work block also turns on the focus mode. */
  enterOnStart: boolean;
  /** What the focus mode shows, as overrides over {@link FOCUS_LAYOUT_DEFAULT_VISIBLE}. */
  layout: Record<string, boolean>;
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
/** The system notification shown when a phase ends while Nodus is in the background. */
export const FOCUS_NOTIFICATION_COPY = {
  title: { es: 'Nodus · Concentración', en: 'Nodus · Focus', fr: 'Nodus · Concentration', de: 'Nodus · Fokus', pt: 'Nodus · Concentração', 'pt-BR': 'Nodus · Concentração', it: 'Nodus · Concentrazione', tr: 'Nodus · Odak', 'zh-CN': 'Nodus · 专注', 'zh-TW': 'Nodus · 專注', ja: 'Nodus · 集中', ko: 'Nodus · 집중' },
  workDone: { es: 'Bloque completado. Tu descanso está listo.', en: 'Block complete. Your break is ready.', fr: 'Bloc terminé. Votre pause est prête.', de: 'Block abgeschlossen. Ihre Pause ist bereit.', pt: 'Bloco concluído. A sua pausa está pronta.', 'pt-BR': 'Bloco concluído. Sua pausa está pronta.', it: 'Blocco completato. La tua pausa è pronta.', tr: 'Blok tamamlandı. Molanız hazır.', 'zh-CN': '专注时段已完成。可以开始休息了。', 'zh-TW': '專注時段已完成。可以開始休息了。', ja: 'ブロック完了。休憩の準備ができました。', ko: '블록을 마쳤습니다. 휴식을 시작할 수 있습니다.' },
  breakDone: { es: 'Descanso completado. Puedes comenzar otro bloque.', en: 'Break complete. You can start another block.', fr: 'Pause terminée. Vous pouvez commencer un autre bloc.', de: 'Pause beendet. Sie können einen weiteren Block beginnen.', pt: 'Pausa concluída. Pode começar outro bloco.', 'pt-BR': 'Pausa concluída. Você pode começar outro bloco.', it: 'Pausa completata. Puoi iniziare un altro blocco.', tr: 'Mola tamamlandı. Yeni bir bloğa başlayabilirsiniz.', 'zh-CN': '休息结束。可以开始下一个专注时段。', 'zh-TW': '休息結束。可以開始下一個專注時段。', ja: '休憩終了。次のブロックを始められます。', ko: '휴식을 마쳤습니다. 다음 블록을 시작할 수 있습니다.' },
} as const;
export const DEFAULT_FOCUS_PREFERENCES: FocusPreferences = {
  workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, dailyGoalMinutes: null, sound: true,
  enterOnStart: true, layout: {},
};

/**
 * Everything the focus mode can show or hide. Ids are `block:` (top of the focus
 * rail), `nav:<view>` (a section in the rail) and `header:` (kept in the header).
 * Only these are on until the student decides otherwise; every other section of the
 * vault can be turned on from the focus mode settings.
 */
export const FOCUS_LAYOUT_DEFAULT_VISIBLE: ReadonlySet<string> = new Set([
  'block:timer', 'block:subject', 'block:shelf',
  'nav:studyCourses', 'nav:studyCalendar', 'nav:studySearch', 'nav:studyLibrary',
  'nav:studyChat', 'nav:studyQuestions', 'nav:studyDeepResearch', 'nav:browser',
  'header:media', 'header:commands', 'header:theme', 'header:queue',
]);
export const FOCUS_LAYOUT_BLOCKS = ['block:timer', 'block:subject', 'block:shelf'] as const;
export const FOCUS_LAYOUT_HEADER = ['header:media', 'header:commands', 'header:theme', 'header:queue'] as const;
const FOCUS_LAYOUT_ID = /^(?:block|nav|header):[A-Za-z0-9:_-]{1,80}$/;
export const FOCUS_LAYOUT_MAX_ENTRIES = 200;

export function focusLayoutVisible(layout: Record<string, boolean> | undefined, id: string): boolean {
  return layout?.[id] ?? FOCUS_LAYOUT_DEFAULT_VISIBLE.has(id);
}
/** Keeps only well-formed ids with boolean values; anything else is dropped, not trusted. */
export function sanitizeFocusLayout(value: unknown): Record<string, boolean> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > FOCUS_LAYOUT_MAX_ENTRIES) return null;
  const layout: Record<string, boolean> = {};
  for (const [id, visible] of entries) {
    if (!FOCUS_LAYOUT_ID.test(id) || typeof visible !== 'boolean') return null;
    layout[id] = visible;
  }
  return layout;
}
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
