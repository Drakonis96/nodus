import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { StudySchedule, StudyScheduleDay, StudySchedulePeriod, StudyScheduleSection, StudySubject, StudyWorkspace } from '@shared/types';
import { STUDY_SCHEDULE_DAYS } from '@shared/studySchedule';
import { IconEmojiPicker } from '../components/IconEmojiPicker';
import { announceStudyWorkspaceChanged, STUDY_WORKSPACE_CHANGED } from '../components/StudySidebar';
import { Icon, Spinner } from '../components/ui';
import { t } from '../i18n';

const DAY_LABELS: Record<StudyScheduleDay, string> = { monday: 'Lunes', tuesday: 'Martes', wednesday: 'Miércoles', thursday: 'Jueves', friday: 'Viernes' };
const SECTION_LABELS: Record<StudyScheduleSection, string> = { morning: 'Mañana', afternoon: 'Tarde' };

type CellEditor = {
  day: StudyScheduleDay;
  periodId: string;
  kind: 'subject' | 'activity' | null;
  subjectId: string;
  activityTitle: string;
  anchor: { top: number; bottom: number; left: number };
};

function readableText(color: string): string {
  const value = color.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#171717' : '#ffffff';
}

function SubjectMark({ subject }: { subject: StudySubject }) {
  return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-black/10 text-sm">{subject.emoji || <Icon name={subject.icon || 'book'} size={13} />}</span>;
}

export function StudyScheduleView() {
  const [schedule, setSchedule] = useState<StudySchedule | null>(null);
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [cellEditor, setCellEditor] = useState<CellEditor | null>(null);
  const [activeDayActions, setActiveDayActions] = useState<StudyScheduleDay | null>(null);

  const load = async () => {
    try {
      const [nextSchedule, nextWorkspace] = await Promise.all([window.nodus.getStudySchedule(), window.nodus.getStudyWorkspace()]);
      setSchedule(nextSchedule); setWorkspace(nextWorkspace); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  useEffect(() => { void load(); const reload = () => void window.nodus.getStudyWorkspace().then(setWorkspace); window.addEventListener(STUDY_WORKSPACE_CHANGED, reload); return () => window.removeEventListener(STUDY_WORKSPACE_CHANGED, reload); }, []);
  useEffect(() => {
    if (!cellEditor) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest('[data-study-schedule-editor], [data-study-schedule-trigger]')) setCellEditor(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setCellEditor(null); };
    const closeOnViewportChange = () => setCellEditor(null);
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, [cellEditor]);

  const subjects = workspace?.subjects ?? [];
  const subjectById = useMemo(() => new Map(subjects.map((subject) => [subject.id, subject])), [subjects]);
  const periods = (section: StudyScheduleSection) => schedule?.periods.filter((period) => period.section === section).sort((a, b) => a.position - b.position) ?? [];
  const cellAt = (day: StudyScheduleDay, periodId: string) => schedule?.cells.find((cell) => cell.day === day && cell.periodId === periodId) ?? null;

  const persist = async (next: StudySchedule) => {
    setSchedule(next); setSaving(true); setError('');
    try { setSchedule(await window.nodus.saveStudySchedule(next)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  const updatePeriod = (id: string, patch: Partial<StudySchedulePeriod>, save = false) => {
    if (!schedule) return;
    const next = { ...schedule, periods: schedule.periods.map((period) => period.id === id ? { ...period, ...patch } : period) };
    if (save) void persist(next); else setSchedule(next);
  };
  const addPeriod = (section: StudyScheduleSection) => {
    if (!schedule) return;
    const existing = periods(section); const last = existing.at(-1);
    const fallbackStart = section === 'morning' ? '09:00' : '15:00';
    const startTime = last?.endTime && last.endTime < '23:00' ? last.endTime : fallbackStart;
    const [hour, minute] = startTime.split(':').map(Number);
    const endTime = `${String(hour + 1).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const item: StudySchedulePeriod = { id: crypto.randomUUID(), section, label: SECTION_LABELS[section], startTime, endTime, position: existing.length };
    void persist({ ...schedule, periods: [...schedule.periods, item] });
  };
  const removePeriod = (id: string) => { if (schedule) void persist({ ...schedule, periods: schedule.periods.filter((period) => period.id !== id), cells: schedule.cells.filter((cell) => cell.periodId !== id) }); };
  const setCell = (day: StudyScheduleDay, periodId: string, value: { subjectId: string | null; activityTitle: string | null } | null) => {
    if (!schedule) return;
    const cells = schedule.cells.filter((cell) => !(cell.day === day && cell.periodId === periodId));
    if (value?.subjectId || value?.activityTitle?.trim()) cells.push({ day, periodId, subjectId: value.subjectId, activityTitle: value.activityTitle?.trim() || null });
    void persist({ ...schedule, cells });
  };
  const openCellEditor = (day: StudyScheduleDay, periodId: string, trigger: HTMLElement) => {
    const cell = cellAt(day, periodId);
    const bounds = trigger.getBoundingClientRect();
    setCellEditor({ day, periodId, kind: cell?.subjectId ? 'subject' : cell?.activityTitle ? 'activity' : null, subjectId: cell?.subjectId ?? '', activityTitle: cell?.activityTitle ?? '', anchor: { top: bounds.top, bottom: bounds.bottom, left: bounds.left } });
  };
  const saveCellEditor = () => {
    if (!cellEditor) return;
    if (cellEditor.kind === 'subject' && cellEditor.subjectId) setCell(cellEditor.day, cellEditor.periodId, { subjectId: cellEditor.subjectId, activityTitle: null });
    else if (cellEditor.kind === 'activity' && cellEditor.activityTitle.trim()) setCell(cellEditor.day, cellEditor.periodId, { subjectId: null, activityTitle: cellEditor.activityTitle });
    else return;
    setCellEditor(null);
  };
  const setDayColor = (day: StudyScheduleDay, color: string | null) => { if (schedule) void persist({ ...schedule, dayColors: { ...schedule.dayColors, [day]: color } }); };
  const styleSubject = async (subject: StudySubject, patch: { color?: string | null; icon?: string | null; emoji?: string | null }) => {
    try {
      await window.nodus.updateStudyEntity('subject', subject.id, patch);
      setWorkspace(await window.nodus.getStudyWorkspace()); announceStudyWorkspaceChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  if (!schedule || !workspace) return <div className="grid h-full place-items-center"><Spinner label={t('Cargando horario…')} /></div>;

  const cellEditorStyle = cellEditor ? (() => {
    const width = Math.min(360, window.innerWidth - 24);
    const left = Math.max(12, Math.min(cellEditor.anchor.left, window.innerWidth - width - 12));
    return cellEditor.anchor.bottom + 330 <= window.innerHeight
      ? { top: cellEditor.anchor.bottom + 8, left, width }
      : { bottom: window.innerHeight - cellEditor.anchor.top + 8, left, width };
  })() : undefined;

  return <div className="study-schedule-page h-full overflow-y-auto bg-neutral-50 p-5 text-neutral-900 dark:bg-neutral-950/20 dark:text-neutral-100" data-testid="study-schedule-view">
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-end gap-3">
        <div className="mr-auto"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-600 dark:text-teal-400">{t('Organización')}</p><h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{t('Horarios')}</h1><p className="mt-1 text-sm text-neutral-500">{t('Organiza tus asignaturas por días y franjas de mañana o tarde.')}</p></div>
        {saving && <Spinner label={t('Guardando…')} />}
        <button data-testid="study-schedule-add-morning" className="btn btn-primary" onClick={() => addPeriod('morning')}><Icon name="sun" />{t('Añadir franja de mañana')}</button>
        <button data-testid="study-schedule-add-afternoon" className="btn btn-primary" onClick={() => addPeriod('afternoon')}><Icon name="plus" />{t('Añadir franja de tarde')}</button>
      </header>
      {error && <div className="rounded-xl border border-red-900/60 bg-red-950/20 px-4 py-3 text-sm text-red-300">{error}</div>}

      <section className="study-schedule-panel overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl shadow-black/10 dark:border-neutral-800 dark:bg-neutral-950/50">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] table-fixed border-collapse" data-testid="study-schedule-table">
            <thead><tr><th className="w-64 border-b border-r border-neutral-200 bg-neutral-50 px-4 py-4 text-left text-xs uppercase tracking-wider text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">{t('Franja horaria')}</th>{STUDY_SCHEDULE_DAYS.map((day) => { const color = schedule.dayColors[day]; const actionsOpen = activeDayActions === day; return <th key={day} className="relative border-b border-r border-neutral-200 px-3 py-3 last:border-r-0 dark:border-neutral-800" style={{ backgroundColor: color || undefined, color: color ? readableText(color) : undefined }}><button type="button" className="w-full text-center text-sm font-semibold" aria-expanded={actionsOpen} onClick={() => setActiveDayActions(actionsOpen ? null : day)}>{t(DAY_LABELS[day])}</button>{actionsOpen && <div className="absolute right-2 top-1/2 z-30 flex -translate-y-1/2 gap-1 rounded-lg border border-neutral-200 bg-white/95 p-1 text-neutral-700 shadow-lg backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-200" data-testid={`study-schedule-day-actions-${day}`} onClick={(event) => event.stopPropagation()}><label className="grid h-7 w-7 cursor-pointer place-items-center rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800" title={t('Color de la cabecera')}><Icon name="palette" size={12} /><input data-testid={`study-schedule-day-color-${day}`} className="sr-only" type="color" value={color || '#0f766e'} onChange={(event) => setDayColor(day, event.target.value)} /></label><button data-testid={`study-schedule-day-clear-${day}`} className="grid h-7 w-7 place-items-center rounded-md hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-red-950/40 dark:hover:text-red-300" title={t('Vaciar color')} aria-label={t('Vaciar color')} disabled={!color} onClick={() => setDayColor(day, null)}><Icon name="trash" size={12} /></button></div>}</th>; })}</tr></thead>
            {(['morning', 'afternoon'] as const).map((section) => <tbody key={section}>{periods(section).map((period, index) => <tr key={period.id} className={section === 'afternoon' && index === 0 ? 'border-t-4 border-t-neutral-700' : ''}>
              <th className="border-b border-r border-neutral-800 bg-neutral-900/75 p-3 text-left align-top"><div className="flex items-start gap-2"><span className={`mt-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${section === 'morning' ? 'bg-amber-500/15 text-amber-300' : 'bg-indigo-500/15 text-indigo-300'}`}>{t(SECTION_LABELS[section])}</span><div className="min-w-0 flex-1"><input className="w-full border-0 bg-transparent text-sm font-semibold text-neutral-200 outline-none" value={period.label} onChange={(event) => updatePeriod(period.id, { label: event.target.value })} onBlur={() => updatePeriod(period.id, {}, true)} /><div className="mt-2 flex items-center gap-1"><input aria-label={t('Hora de inicio')} className="input h-8 min-w-0 flex-1 px-2 text-xs" type="time" value={period.startTime} onChange={(event) => updatePeriod(period.id, { startTime: event.target.value })} onBlur={() => updatePeriod(period.id, {}, true)} /><span className="text-neutral-600">–</span><input aria-label={t('Hora de fin')} className="input h-8 min-w-0 flex-1 px-2 text-xs" type="time" value={period.endTime} onChange={(event) => updatePeriod(period.id, { endTime: event.target.value })} onBlur={() => updatePeriod(period.id, {}, true)} /></div></div><button className="mt-1 text-neutral-600 hover:text-red-400" title={t('Eliminar franja')} onClick={() => removePeriod(period.id)}><Icon name="trash" size={13} /></button></div></th>
              {STUDY_SCHEDULE_DAYS.map((day) => { const cell = cellAt(day, period.id); const subject = cell?.subjectId ? subjectById.get(cell.subjectId) : null; return <td key={day} className="border-b border-r border-neutral-200 p-2 last:border-r-0 dark:border-neutral-800"><button type="button" data-study-schedule-trigger data-testid={`study-schedule-cell-${day}-${period.id}`} aria-label={`${t(DAY_LABELS[day])} · ${period.label}`} title={subject?.name || cell?.activityTitle || undefined} className={`study-schedule-subject-cell relative min-h-20 w-full rounded-xl border border-neutral-200 p-2 text-left transition-colors hover:border-teal-600 dark:border-neutral-800 dark:hover:border-teal-700 ${subject?.color ? 'has-color' : ''}`} style={subject?.color ? { '--subject-color': subject.color } as CSSProperties : undefined} onClick={(event) => openCellEditor(day, period.id, event.currentTarget)}>{subject ? <div className="flex items-start gap-2"><SubjectMark subject={subject} /><span className="min-w-0 break-words text-xs font-semibold leading-4 text-neutral-800 dark:text-neutral-200">{subject.name}</span></div> : cell?.activityTitle ? <div className="flex items-start gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"><Icon name="clock" size={13} /></span><span className="min-w-0 break-words text-xs font-semibold leading-4 text-neutral-800 dark:text-neutral-200">{cell.activityTitle}</span></div> : <div className="flex min-h-14 items-center justify-center gap-1 text-xs text-neutral-500 dark:text-neutral-600"><Icon name="plus" size={12} />{t('Añadir elemento')}</div>}</button></td>; })}
            </tr>)}</tbody>)}
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-5" data-testid="study-schedule-subject-styles"><div><h2 className="text-base font-semibold text-neutral-200">{t('Aspecto de las asignaturas')}</h2><p className="mt-1 text-xs text-neutral-500">{t('Los cambios también se aplicarán en Cursos y asignaturas.')}</p></div>{subjects.length ? <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{subjects.map((subject) => <article key={subject.id} className={`study-schedule-subject-style rounded-xl border border-neutral-800 p-3 ${subject.color ? 'has-color' : ''}`} style={subject.color ? { '--subject-color': subject.color } as CSSProperties : undefined}><div className="flex items-start gap-2"><SubjectMark subject={subject} /><strong className="min-w-0 flex-1 break-words text-sm leading-5 text-neutral-200">{subject.name}</strong><label className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-neutral-700" style={{ backgroundColor: subject.color || undefined }} title={t('Color de la asignatura')}><Icon name="palette" size={13} className={subject.color ? 'text-white' : 'text-neutral-500'} /><input data-testid={`study-schedule-subject-color-${subject.id}`} className="sr-only" type="color" value={subject.color || '#0f766e'} onChange={(event) => void styleSubject(subject, { color: event.target.value })} /></label><button data-testid={`study-schedule-subject-clear-${subject.id}`} className="btn btn-ghost h-9 w-9 shrink-0 p-0 disabled:cursor-not-allowed disabled:opacity-30" title={t('Vaciar color')} aria-label={t('Vaciar color')} disabled={!subject.color} onClick={() => void styleSubject(subject, { color: null })}><Icon name="x" size={12} /></button></div><div className="mt-2"><IconEmojiPicker icon={subject.icon || 'book'} emoji={subject.emoji || ''} onChange={(value) => void styleSubject(subject, value)} /></div></article>)}</div> : <div className="mt-4 rounded-xl border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">{t('Añade asignaturas en Cursos y asignaturas para poder colocarlas en el horario.')}</div>}</section>
    </div>
    {cellEditor && <div data-study-schedule-editor data-testid="study-schedule-cell-popover" className="fixed z-[130] rounded-xl border border-neutral-200 bg-white p-3 text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100" style={cellEditorStyle} role="dialog" aria-modal="false" aria-labelledby="study-schedule-cell-title"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><h2 id="study-schedule-cell-title" className="text-sm font-semibold">{t('Añadir al horario')}</h2><p className="mt-0.5 truncate text-[11px] text-neutral-500">{t(DAY_LABELS[cellEditor.day])} · {schedule.periods.find((period) => period.id === cellEditor.periodId)?.label}</p></div><button className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label={t('Cerrar')} onClick={() => setCellEditor(null)}><Icon name="x" size={13} /></button></div><div className="mt-3 grid grid-cols-2 gap-2"><button data-testid="study-schedule-kind-subject" className={`rounded-lg border p-2.5 text-left transition-colors ${cellEditor.kind === 'subject' ? 'border-teal-500 bg-teal-50 text-neutral-900 dark:bg-teal-950/40 dark:text-neutral-100' : 'border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800'}`} onClick={() => setCellEditor({ ...cellEditor, kind: 'subject', activityTitle: '' })}><div className="flex items-center gap-2"><Icon name="book" size={14} /><strong className="text-xs">{t('Asignatura')}</strong></div><span className="mt-1 block text-[10px] leading-tight text-neutral-500">{t('Elegir una asignatura existente')}</span></button><button data-testid="study-schedule-kind-activity" className={`rounded-lg border p-2.5 text-left transition-colors ${cellEditor.kind === 'activity' ? 'border-indigo-500 bg-indigo-50 text-neutral-900 dark:bg-indigo-950/40 dark:text-neutral-100' : 'border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800'}`} onClick={() => setCellEditor({ ...cellEditor, kind: 'activity', subjectId: '' })}><div className="flex items-center gap-2"><Icon name="clock" size={14} /><strong className="text-xs">{t('Actividad independiente')}</strong></div><span className="mt-1 block text-[10px] leading-tight text-neutral-500">{t('Añadir una actividad con nombre propio')}</span></button></div>{cellEditor.kind === 'subject' && <label className="mt-3 block text-xs text-neutral-500">{t('Asignatura')}<select autoFocus className="input mt-1 w-full" value={cellEditor.subjectId} onChange={(event) => setCellEditor({ ...cellEditor, subjectId: event.target.value })}><option value="">{t('Selecciona una asignatura…')}</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>}{cellEditor.kind === 'activity' && <label className="mt-3 block text-xs text-neutral-500">{t('Nombre de la actividad')}<input autoFocus data-testid="study-schedule-activity-title" className="input mt-1 w-full" maxLength={160} value={cellEditor.activityTitle} onChange={(event) => setCellEditor({ ...cellEditor, activityTitle: event.target.value })} placeholder={t('Ej. Tutoría, gimnasio o biblioteca')} onKeyDown={(event) => { if (event.key === 'Enter') saveCellEditor(); }} /></label>}<div className="mt-3 flex items-center justify-end gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-700">{cellAt(cellEditor.day, cellEditor.periodId) && <button className="btn btn-ghost mr-auto h-8 px-2 text-red-500" title={t('Vaciar celda')} aria-label={t('Vaciar celda')} onClick={() => { setCell(cellEditor.day, cellEditor.periodId, null); setCellEditor(null); }}><Icon name="trash" size={13} /></button>}<button className="btn btn-ghost h-8 px-3" onClick={() => setCellEditor(null)}>{t('Cancelar')}</button><button data-testid="study-schedule-cell-save" className="btn btn-primary h-8 px-3" disabled={(cellEditor.kind === 'subject' && !cellEditor.subjectId) || (cellEditor.kind === 'activity' && !cellEditor.activityTitle.trim()) || !cellEditor.kind} onClick={saveCellEditor}>{t('Guardar')}</button></div></div>}
  </div>;
}
