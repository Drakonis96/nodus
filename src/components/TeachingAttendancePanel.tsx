import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { StudyWorkspace } from '@shared/studyOrg';
import { studentFullName, type TeachingGroup, type TeachingStudent } from '@shared/teachingGroups';
import {
  ATTENDANCE_STATUSES,
  addDays,
  addMonths,
  clampDay,
  holidayCandidates,
  isWeekend,
  monthDays,
  parseDayKey,
  summarizeAttendance,
  toDayKey,
  weekDays,
  weekdayIndex,
  type AttendanceRecord,
  type AttendanceStatus,
  type AttendanceSummary,
} from '@shared/teachingAttendance';
import { Icon } from './ui';
import { anchorStyle, useAnchoredCoords } from './dbGrid';
import { AttendanceHolidayModal, type HolidayPrompt } from './AttendanceHolidayModal';
import { AttendanceExportModal } from './AttendanceExportModal';
import { t, tx, errorText, getActiveLang } from '../i18n';

/**
 * Attendance ("pasar lista") for one group: students down, days across.
 *
 * A blank cell means "not recorded" — never "present" — so the summary only counts
 * what the teacher actually marked, and "Todos asisten" fills the blanks of one day in
 * a click before the exceptions are corrected. A holiday belongs to the group: it tints
 * its column, hides whatever was marked under it (without deleting it), and offers to
 * copy itself to the teacher's other groups.
 */

type Mode = 'week' | 'month';

const MODE_KEY = 'nodus-teaching-attendance-mode';
const WEEKEND_KEY = 'nodus-teaching-attendance-weekend';

function readPref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writePref(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* private window: the choice just is not remembered */ }
}

export const STATUS_ICON: Record<AttendanceStatus, string> = {
  present: 'check',
  justified: 'fileText',
  unjustified: 'x',
  late: 'clock',
};

/** Light-first with `dark:` variants: none of these hues is remapped by the vault accent. */
export const STATUS_TONE: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  justified: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  unjustified: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  late: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
};

export function attendanceStatusLabel(status: AttendanceStatus): string {
  switch (status) {
    case 'justified': return t('Falta justificada');
    case 'unjustified': return t('Falta injustificada');
    case 'late': return t('Retraso');
    case 'present':
    default: return t('Asiste');
  }
}

const WEEKDAY_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

function weekdayShort(day: string): string {
  return t(WEEKDAY_SHORT[weekdayIndex(day)]);
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase(getActiveLang()) + text.slice(1);
}

function periodLabel(mode: Mode, days: string[], anchor: string): string {
  const lang = getActiveLang();
  if (mode === 'month') return capitalize(parseDayKey(anchor).toLocaleDateString(lang, { month: 'long', year: 'numeric' }));
  const first = parseDayKey(days[0]).toLocaleDateString(lang, { day: 'numeric', month: 'short' });
  const last = parseDayKey(days[days.length - 1]).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${first} – ${last}`;
}

const cellKey = (studentId: string, date: string) => `${studentId}|${date}`;

/** Header cells are sticky, so they must be OPAQUE — the shared translucent table head
 * lets the columns that scroll beneath them show through. */
const HEAD = 'border-neutral-200 bg-neutral-100 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900';

function displayName(student: TeachingStudent): string {
  return studentFullName(student);
}

export function TeachingAttendancePanel({
  group,
  groups,
  workspace,
  onOpenRoster,
}: {
  group: TeachingGroup;
  groups: TeachingGroup[];
  workspace: StudyWorkspace;
  onOpenRoster: () => void;
}) {
  const year = workspace.academicYears.find((y) => y.id === group.academicYearId) ?? null;
  const today = toDayKey(new Date());
  const [mode, setModeState] = useState<Mode>(() => (readPref(MODE_KEY) === 'month' ? 'month' : 'week'));
  const [includeWeekend, setIncludeWeekendState] = useState(() => readPref(WEEKEND_KEY) === '1');
  const [anchor, setAnchor] = useState(() => clampDay(today, year?.startDate, year?.endDate));
  const [records, setRecords] = useState<Map<string, AttendanceRecord>>(new Map());
  const [holidays, setHolidays] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [cellMenu, setCellMenu] = useState<{ studentId: string; date: string } | null>(null);
  const [dayMenu, setDayMenu] = useState<string | null>(null);
  const [holidayPrompt, setHolidayPrompt] = useState<HolidayPrompt | null>(null);
  const [exporting, setExporting] = useState(false);
  const cellAnchor = useRef<HTMLElement | null>(null);
  const dayAnchor = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  const loadSeq = useRef(0);

  const setMode = (next: Mode) => { setModeState(next); writePref(MODE_KEY, next); };
  const setIncludeWeekend = (next: boolean) => { setIncludeWeekendState(next); writePref(WEEKEND_KEY, next ? '1' : '0'); };

  const days = mode === 'week' ? weekDays(anchor, includeWeekend) : monthDays(anchor);
  const from = days[0];
  const to = days[days.length - 1];
  const students = group.students ?? [];

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const sheet = await window.nodus.getAttendanceSheet(group.id, from, to);
      // A slower answer for the period the teacher already left must not overwrite this one.
      if (seq !== loadSeq.current) return;
      setRecords(new Map(sheet.records.map((r) => [cellKey(r.studentId, r.date), r])));
      setHolidays(new Map(sheet.holidays.map((h) => [h.date, h.label])));
    } catch (cause) {
      if (seq === loadSeq.current) setError(errorText(cause));
    }
  }, [group.id, from, to]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  const putLocal = (key: string, record: AttendanceRecord | null) =>
    setRecords((prev) => {
      const next = new Map(prev);
      if (record) next.set(key, record);
      else next.delete(key);
      return next;
    });

  /** Optimistic: the cell changes at once, and goes back if the write fails. */
  const setStatus = async (studentId: string, date: string, status: AttendanceStatus, note?: string) => {
    const key = cellKey(studentId, date);
    const before = records.get(key) ?? null;
    putLocal(key, { studentId, date, status, note: note ?? before?.note ?? '' });
    try {
      putLocal(key, await window.nodus.setAttendance({ studentId, date, status, ...(note === undefined ? {} : { note }) }));
    } catch (cause) {
      putLocal(key, before);
      setError(errorText(cause));
    }
  };

  const clearStatus = async (studentId: string, date: string) => {
    const key = cellKey(studentId, date);
    const before = records.get(key) ?? null;
    if (!before) return;
    putLocal(key, null);
    try {
      await window.nodus.clearAttendance(studentId, date);
    } catch (cause) {
      putLocal(key, before);
      setError(errorText(cause));
    }
  };

  const fillDay = async (date: string) => {
    setDayMenu(null);
    try {
      const marks = await window.nodus.fillAttendanceDay(group.id, date, 'present');
      setRecords((prev) => {
        const next = new Map(prev);
        for (const record of marks) next.set(cellKey(record.studentId, record.date), record);
        return next;
      });
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  // ── Holidays ─────────────────────────────────────────────────────────────
  const otherGroupsFor = (date: string) => holidayCandidates(groups, workspace.academicYears, date, group.id);

  const markHoliday = async (date: string, label: string) => {
    setDayMenu(null);
    try {
      await window.nodus.setAttendanceHoliday([group.id], date, label);
      setHolidays((prev) => new Map(prev).set(date, label.trim()));
      const already = new Set(await window.nodus.attendanceHolidayGroups(date));
      const pending = otherGroupsFor(date).filter((g) => !already.has(g.id));
      if (pending.length) setHolidayPrompt({ action: 'set', date, label: label.trim(), candidates: otherGroupsFor(date), marked: [...already] });
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  const unmarkHoliday = async (date: string) => {
    setDayMenu(null);
    try {
      await window.nodus.clearAttendanceHoliday([group.id], date);
      setHolidays((prev) => {
        const next = new Map(prev);
        next.delete(date);
        return next;
      });
      const candidates = otherGroupsFor(date);
      const ids = new Set(candidates.map((g) => g.id));
      const still = (await window.nodus.attendanceHolidayGroups(date)).filter((id) => ids.has(id));
      if (still.length) setHolidayPrompt({ action: 'clear', date, label: '', candidates, marked: still });
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  const applyPropagation = async (groupIds: string[]) => {
    const prompt = holidayPrompt;
    setHolidayPrompt(null);
    if (!prompt || !groupIds.length) return;
    try {
      if (prompt.action === 'set') await window.nodus.setAttendanceHoliday(groupIds, prompt.date, prompt.label);
      else await window.nodus.clearAttendanceHoliday(groupIds, prompt.date);
      const n = groupIds.length;
      setMessage(prompt.action === 'set'
        ? n === 1 ? t('Festivo aplicado también a 1 grupo.') : tx('Festivo aplicado también a {n} grupos.', { n })
        : n === 1 ? t('Festivo quitado también de 1 grupo.') : tx('Festivo quitado también de {n} grupos.', { n }));
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  // ── Keyboard: digits set a status, Delete clears, arrows move ───────────
  const focusCell = (row: number, col: number) => {
    const target = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`);
    target?.focus();
  };

  const onGridKeyDown = (event: ReactKeyboardEvent<HTMLTableElement>) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-cell]');
    if (!cell) return;
    const [row, col] = (cell.dataset.cell ?? '0:0').split(':').map(Number);
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[event.key]) {
      event.preventDefault();
      focusCell(row + moves[event.key][0], col + moves[event.key][1]);
      return;
    }
    const student = students[row];
    const date = days[col];
    if (!student || !date || holidays.has(date)) return;
    const digit = Number(event.key);
    if (digit >= 1 && digit <= ATTENDANCE_STATUSES.length) {
      event.preventDefault();
      void setStatus(student.id, date, ATTENDANCE_STATUSES[digit - 1]);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      void clearStatus(student.id, date);
    }
  };

  const move = (step: number) => setAnchor((current) => (mode === 'week' ? addDays(current, step * 7) : addMonths(current, step)));

  const summaries = summarizeAttendance([...records.values()], holidays.keys(), days);
  const compact = mode === 'month';
  const openCell = cellMenu ? records.get(cellKey(cellMenu.studentId, cellMenu.date)) ?? null : null;
  const openStudent = cellMenu ? students.find((s) => s.id === cellMenu.studentId) ?? null : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="attendance-panel">
      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-800" role="group" aria-label={t('Vista')}>
          {(['week', 'month'] as const).map((item) => (
            <button
              key={item}
              type="button"
              data-testid={`attendance-mode-${item}`}
              aria-pressed={mode === item}
              className={`rounded-md px-3 py-1.5 text-xs ${mode === item ? 'bg-indigo-600 text-white' : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900'}`}
              onClick={() => setMode(item)}
            >
              {item === 'week' ? t('Semana') : t('Mes')}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost h-8 w-8 p-0" data-testid="attendance-prev" title={t('Anterior')} aria-label={t('Anterior')} onClick={() => move(-1)}>
          <Icon name="chevronLeft" size={14} />
        </button>
        <button type="button" className="btn btn-ghost h-8" data-testid="attendance-today" onClick={() => setAnchor(today)}>{t('Hoy')}</button>
        <button type="button" className="btn btn-ghost h-8 w-8 p-0" data-testid="attendance-next" title={t('Siguiente')} aria-label={t('Siguiente')} onClick={() => move(1)}>
          <Icon name="chevronRight" size={14} />
        </button>
        <h2 className="ml-1 text-sm font-semibold" data-testid="attendance-period">{periodLabel(mode, days, anchor)}</h2>
        {mode === 'week' && (
          <label className="ml-2 inline-flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
            <input
              type="checkbox"
              className="accent-indigo-400"
              data-testid="attendance-weekend"
              checked={includeWeekend}
              onChange={(event) => setIncludeWeekend(event.target.checked)}
            />
            {t('Incluir fin de semana')}
          </label>
        )}
        <button type="button" className="btn btn-ghost ml-auto h-8" data-testid="attendance-export" onClick={() => setExporting(true)}>
          <Icon name="download" size={13} />{t('Exportar')}
        </button>
      </div>

      <Legend />

      {error && (
        <p className="mt-2 flex items-center gap-2 text-sm text-red-500" data-testid="attendance-error">
          {error}
          <button type="button" className="text-xs underline" onClick={() => setError('')}>{t('Cerrar')}</button>
        </p>
      )}
      {message && <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">{message}</p>}

      {/* ── Grid ──────────────────────────────────────────────────────────── */}
      {students.length === 0 ? (
        <div className="mx-auto mt-10 max-w-md rounded-xl border border-dashed border-neutral-300 p-8 text-center dark:border-neutral-800">
          <p className="text-sm text-neutral-500">{t('Este grupo todavía no tiene alumnado.')}</p>
          <button type="button" className="btn btn-primary mt-4" onClick={onOpenRoster}>{t('Ir al listado')}</button>
        </div>
      ) : (
        <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
          <table
            ref={gridRef}
            className="w-max min-w-full border-separate border-spacing-0 text-xs"
            data-testid="attendance-grid"
            data-mode={mode}
            onKeyDown={onGridKeyDown}
          >
            <thead>
              <tr>
                <th className={`${HEAD} sticky left-0 top-0 z-40 w-[220px] min-w-[220px] border-b border-r px-3 py-2 text-left font-medium`}>
                  {t('Alumno')}
                </th>
                {days.map((date) => {
                  const holiday = holidays.has(date);
                  const weekend = isWeekend(date);
                  const isToday = date === today;
                  return (
                    <th
                      key={date}
                      className={`sticky top-0 z-20 border-b border-neutral-200 p-0 font-medium text-neutral-500 dark:border-neutral-800 ${compact ? 'w-9 min-w-9' : 'min-w-[104px]'} ${
                        holiday ? 'bg-violet-100 dark:bg-violet-950' : weekend ? 'bg-neutral-200 dark:bg-neutral-800' : 'bg-neutral-100 dark:bg-neutral-900'
                      }`}
                    >
                      <button
                        type="button"
                        data-testid={`attendance-day-${date}`}
                        title={holiday ? (holidays.get(date) || t('Festivo')) : t('Opciones del día')}
                        className={`flex w-full flex-col items-center gap-0.5 px-1 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 ${
                          weekend && !holiday ? 'text-neutral-400 dark:text-neutral-600' : ''
                        }`}
                        onClick={(event) => { dayAnchor.current = event.currentTarget; setDayMenu(date); }}
                      >
                        <span className="text-[10px] uppercase tracking-wide">{weekdayShort(date)}</span>
                        <span className={`grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] ${isToday ? 'bg-indigo-600 font-semibold text-white' : ''}`}>
                          {Number(date.slice(8))}
                        </span>
                        {holiday && (
                          <Icon name="partyPopper" size={compact ? 12 : 14} className="text-violet-600 dark:text-violet-300" />
                        )}
                      </button>
                    </th>
                  );
                })}
                {SUMMARY_COLUMNS.map((column, index) => (
                  <th
                    key={column}
                    title={summaryTitle(column)}
                    style={{ right: summaryOffset(index) }}
                    className={`${HEAD} sticky top-0 z-30 w-14 min-w-14 max-w-14 border-b px-1 py-2 text-center font-medium ${index === 0 ? 'border-l' : ''}`}
                  >
                    {summaryHeader(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map((student, row) => {
                const name = displayName(student);
                const summary = summaries.get(student.id);
                return (
                  <tr key={student.id} data-testid={`attendance-row-${student.id}`}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 w-[220px] min-w-[220px] max-w-[220px] border-b border-r border-neutral-200 bg-white px-3 py-1.5 text-left font-normal dark:border-neutral-800 dark:bg-neutral-950"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="w-5 shrink-0 text-right text-[10px] text-neutral-400">{row + 1}</span>
                        {name
                          ? <span className="truncate text-neutral-800 dark:text-neutral-200">{name}</span>
                          : <span className="truncate font-mono text-[10px] text-neutral-400">{student.pseudonymCode}</span>}
                      </span>
                    </th>
                    {days.map((date, col) => {
                      const holiday = holidays.has(date);
                      const weekend = isWeekend(date);
                      const base = `h-9 border-b border-neutral-200 p-0.5 dark:border-neutral-800/70 ${
                        holiday ? 'bg-violet-50 dark:bg-violet-950/40' : weekend ? 'bg-neutral-50 dark:bg-neutral-900/50' : ''
                      }`;
                      if (holiday) {
                        return (
                          <td key={date} className={base}>
                            <div data-cell={`${row}:${col}`} tabIndex={-1} className="h-full w-full" aria-label={t('Festivo')} />
                          </td>
                        );
                      }
                      const record = records.get(cellKey(student.id, date));
                      return (
                        <td key={date} className={base}>
                          <button
                            type="button"
                            data-cell={`${row}:${col}`}
                            data-testid={`attendance-cell-${student.id}-${date}`}
                            data-status={record?.status ?? ''}
                            title={record ? [attendanceStatusLabel(record.status), record.note].filter(Boolean).join(' — ') : t('Sin registrar')}
                            aria-label={`${name || student.pseudonymCode}, ${date}: ${record ? attendanceStatusLabel(record.status) : t('Sin registrar')}`}
                            className={`relative flex h-full w-full items-center justify-center gap-1 rounded-md outline-none ring-indigo-500 focus-visible:ring-2 ${
                              record ? STATUS_TONE[record.status] : weekend ? 'hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60' : 'hover:bg-neutral-100 dark:hover:bg-neutral-900/60'
                            }`}
                            onClick={(event) => { cellAnchor.current = event.currentTarget; setCellMenu({ studentId: student.id, date }); }}
                          >
                            {record && <Icon name={STATUS_ICON[record.status]} size={compact ? 13 : 14} />}
                            {record && !compact && <span className="truncate text-[11px]">{attendanceStatusLabel(record.status)}</span>}
                            {record?.note && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-neutral-500 dark:bg-neutral-400" data-testid={`attendance-note-dot-${student.id}-${date}`} />}
                          </button>
                        </td>
                      );
                    })}
                    {SUMMARY_COLUMNS.map((column, index) => (
                      <td
                        key={column}
                        data-testid={`attendance-summary-${column}-${student.id}`}
                        style={{ right: summaryOffset(index) }}
                        className={`sticky z-10 w-14 min-w-14 max-w-14 border-b border-neutral-200 bg-white px-1 text-center tabular-nums text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400 ${index === 0 ? 'border-l' : ''}`}
                      >
                        {summaryValue(column, summary)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {cellMenu && openStudent && (
        <CellMenu
          anchorRef={cellAnchor}
          record={openCell}
          title={`${displayName(openStudent) || openStudent.pseudonymCode} · ${capitalize(parseDayKey(cellMenu.date).toLocaleDateString(getActiveLang(), { weekday: 'long', day: 'numeric', month: 'long' }))}`}
          onClose={() => setCellMenu(null)}
          onStatus={(status) => { void setStatus(cellMenu.studentId, cellMenu.date, status); setCellMenu(null); }}
          onClear={() => { void clearStatus(cellMenu.studentId, cellMenu.date); setCellMenu(null); }}
          onNote={(note) => { if (openCell) void setStatus(cellMenu.studentId, cellMenu.date, openCell.status, note); }}
        />
      )}

      {dayMenu && (
        <DayMenu
          anchorRef={dayAnchor}
          date={dayMenu}
          holidayLabel={holidays.has(dayMenu) ? holidays.get(dayMenu) ?? '' : null}
          onClose={() => setDayMenu(null)}
          onFill={() => void fillDay(dayMenu)}
          onMarkHoliday={(label) => void markHoliday(dayMenu, label)}
          onUnmarkHoliday={() => void unmarkHoliday(dayMenu)}
        />
      )}

      {holidayPrompt && (
        <AttendanceHolidayModal
          prompt={holidayPrompt}
          workspace={workspace}
          onCancel={() => setHolidayPrompt(null)}
          onApply={(ids) => void applyPropagation(ids)}
        />
      )}

      {exporting && (
        <AttendanceExportModal
          group={group}
          groups={groups}
          workspace={workspace}
          visibleDays={days}
          mode={mode}
          includeWeekend={mode === 'month' || includeWeekend}
          onClose={() => setExporting(false)}
          onDone={(path) => { setExporting(false); setMessage(tx('Asistencia exportada en {path}', { path })); }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- summary --- */

const SUMMARY_COLUMNS = ['present', 'justified', 'unjustified', 'late', 'rate'] as const;
type SummaryColumn = (typeof SUMMARY_COLUMNS)[number];
/** Matches `w-14`: the totals stay pinned to the right edge while a month scrolls under them. */
const SUMMARY_WIDTH = 56;
const summaryOffset = (index: number) => (SUMMARY_COLUMNS.length - 1 - index) * SUMMARY_WIDTH;

function summaryHeader(column: SummaryColumn) {
  if (column === 'rate') return '%';
  return <Icon name={STATUS_ICON[column]} size={13} className={STATUS_TONE[column].split(' ').filter((c) => c.includes('text-')).join(' ')} />;
}

function summaryTitle(column: SummaryColumn): string {
  if (column === 'rate') return t('Asistencia: (asiste + retraso) / días registrados, sin contar festivos');
  return attendanceStatusLabel(column);
}

function summaryValue(column: SummaryColumn, summary: AttendanceSummary | undefined): string {
  if (!summary) return column === 'rate' ? '—' : '0';
  if (column === 'rate') return summary.rate === null ? '—' : `${Math.round(summary.rate * 100)}`;
  return String(summary[column]);
}

/* -------------------------------------------------------------- legend --- */

function Legend() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500" data-testid="attendance-legend">
      {ATTENDANCE_STATUSES.map((status, index) => (
        <span key={status} className="inline-flex items-center gap-1">
          <span className={`grid h-5 w-5 place-items-center rounded ${STATUS_TONE[status]}`}><Icon name={STATUS_ICON[status]} size={12} /></span>
          {attendanceStatusLabel(status)}
          <kbd className="rounded border border-neutral-200 px-1 font-mono text-[9px] text-neutral-400 dark:border-neutral-800">{index + 1}</kbd>
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span className="grid h-5 w-5 place-items-center rounded bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-300"><Icon name="partyPopper" size={12} /></span>
        {t('Festivo')}
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-5 w-5 rounded border border-dashed border-neutral-300 dark:border-neutral-700" />
        {t('Sin registrar')}
      </span>
    </div>
  );
}

/* ----------------------------------------------------------- popovers --- */

function Popover({ anchorRef, width, onClose, testId, children }: {
  anchorRef: RefObject<HTMLElement>;
  width: number;
  onClose: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  const coords = useAnchoredCoords(true, anchorRef, width, width, 'below');
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!coords) return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-[140]" onClick={onClose} />
      <div className="card-modal fixed z-[150] p-2 text-xs shadow-xl" style={anchorStyle(coords)} data-testid={testId} role="dialog">
        {children}
      </div>
    </>,
    document.body,
  );
}

function CellMenu({ anchorRef, record, title, onClose, onStatus, onClear, onNote }: {
  anchorRef: RefObject<HTMLElement>;
  record: AttendanceRecord | null;
  title: string;
  onClose: () => void;
  onStatus: (status: AttendanceStatus) => void;
  onClear: () => void;
  onNote: (note: string) => void;
}) {
  const [note, setNote] = useState(record?.note ?? '');
  const commitNote = () => {
    if (record && note.trim() !== record.note.trim()) onNote(note.trim());
  };
  return (
    <Popover anchorRef={anchorRef} width={250} onClose={() => { commitNote(); onClose(); }} testId="attendance-cell-menu">
      <p className="mb-1.5 truncate px-1 text-[11px] font-medium text-neutral-500">{title}</p>
      <div className="grid gap-0.5">
        {ATTENDANCE_STATUSES.map((status, index) => (
          <button
            key={status}
            type="button"
            data-testid={`attendance-set-${status}`}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 ${record?.status === status ? 'font-semibold' : ''}`}
            onClick={() => onStatus(status)}
          >
            <span className={`grid h-5 w-5 place-items-center rounded ${STATUS_TONE[status]}`}><Icon name={STATUS_ICON[status]} size={12} /></span>
            <span className="flex-1">{attendanceStatusLabel(status)}</span>
            {record?.status === status && <Icon name="check" size={12} className="text-neutral-500" />}
            <kbd className="font-mono text-[9px] text-neutral-400">{index + 1}</kbd>
          </button>
        ))}
        <button
          type="button"
          data-testid="attendance-clear"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          onClick={onClear}
        >
          <span className="h-5 w-5 rounded border border-dashed border-neutral-300 dark:border-neutral-700" />
          <span className="flex-1">{t('Sin registrar')}</span>
        </button>
      </div>
      <div className="mt-2 border-t border-neutral-200 pt-2 dark:border-neutral-800">
        {record ? (
          <textarea
            className="input w-full resize-none text-xs"
            rows={2}
            data-testid="attendance-note"
            placeholder={t('Comentario (opcional)')}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onBlur={commitNote}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                commitNote();
                onClose();
              }
            }}
          />
        ) : (
          <p className="px-1 text-[11px] text-neutral-500">{t('Elige un estado para poder añadir un comentario.')}</p>
        )}
      </div>
    </Popover>
  );
}

function DayMenu({ anchorRef, date, holidayLabel, onClose, onFill, onMarkHoliday, onUnmarkHoliday }: {
  anchorRef: RefObject<HTMLElement>;
  date: string;
  /** null when the day is not a holiday. */
  holidayLabel: string | null;
  onClose: () => void;
  onFill: () => void;
  onMarkHoliday: (label: string) => void;
  onUnmarkHoliday: () => void;
}) {
  const [naming, setNaming] = useState(false);
  const [label, setLabel] = useState('');
  const isHoliday = holidayLabel !== null;
  return (
    <Popover anchorRef={anchorRef} width={240} onClose={onClose} testId="attendance-day-menu">
      <p className="mb-1.5 px-1 text-[11px] font-medium text-neutral-500">
        {capitalize(parseDayKey(date).toLocaleDateString(getActiveLang(), { weekday: 'long', day: 'numeric', month: 'long' }))}
        {isHoliday && holidayLabel ? ` · ${holidayLabel}` : ''}
      </p>
      {!isHoliday && (
        <button
          type="button"
          data-testid="attendance-fill-day"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
          onClick={onFill}
        >
          <Icon name="check" size={13} className="text-emerald-600 dark:text-emerald-400" />
          <span>
            <span className="block">{t('Todos asisten')}</span>
            <span className="block text-[10px] text-neutral-500">{t('Solo rellena las celdas vacías.')}</span>
          </span>
        </button>
      )}
      {isHoliday ? (
        <button
          type="button"
          data-testid="attendance-holiday-clear"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
          onClick={onUnmarkHoliday}
        >
          <Icon name="x" size={13} className="text-neutral-500" />{t('Quitar festivo')}
        </button>
      ) : naming ? (
        <form
          className="mt-1 grid gap-1.5 px-1"
          onSubmit={(event) => { event.preventDefault(); onMarkHoliday(label); }}
        >
          <input
            autoFocus
            className="input h-8 w-full text-xs"
            data-testid="attendance-holiday-label"
            placeholder={t('Nombre del festivo (opcional)')}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <button type="submit" className="btn btn-primary h-8 justify-center text-xs" data-testid="attendance-holiday-confirm">
            <Icon name="partyPopper" size={13} />{t('Marcar como festivo')}
          </button>
        </form>
      ) : (
        <button
          type="button"
          data-testid="attendance-holiday-set"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
          onClick={() => setNaming(true)}
        >
          <Icon name="partyPopper" size={13} className="text-violet-600 dark:text-violet-300" />{t('Marcar como festivo')}
        </button>
      )}
    </Popover>
  );
}
