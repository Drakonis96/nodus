import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StudyAcademicYear } from '@shared/types';
import {
  academicYearLabelForDate,
  defaultAcademicYearRange,
  formatAcademicYearLabel,
  nextAcademicYearLabel,
  normalizeAcademicYearLabel,
  parseAcademicYearStart,
  pickCurrentAcademicYear,
} from '@shared/studyAcademicYears';
import { Icon } from './ui';
import { t } from '../i18n';

/**
 * The academic year the study views are scoped to.
 *
 * `all` shows everything; `none` shows the work that has no year yet — which is
 * every course in a vault created before this existed, so it has to stay
 * reachable rather than be an edge case.
 */
export type StudyAcademicYearScope = 'all' | 'none' | (string & {});

const STORAGE_KEY = 'nodus.studyAcademicYearScope';

export const STUDY_ACADEMIC_YEAR_SCOPE_CHANGED = 'nodus:study-academic-year-scope-changed';

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * One year selection shared by every study view, persisted so it survives a
 * reload. Deliberately not a React context: the views that need it are siblings
 * under different routes, and a window event is what the sidebar already uses to
 * keep them in step (see `STUDY_WORKSPACE_CHANGED`).
 *
 * The stored id is validated against the years that actually exist on every
 * render, so switching to a vault that never heard of it — or deleting the
 * selected year — lands on the current year instead of showing an empty screen
 * for a year that is gone.
 */
export function useStudyAcademicYearScope(years: readonly StudyAcademicYear[] | undefined): {
  scope: StudyAcademicYearScope;
  setScope: (next: StudyAcademicYearScope) => void;
  resolved: StudyAcademicYear | null;
} {
  const [stored, setStored] = useState<StudyAcademicYearScope>(() => localStorage.getItem(STORAGE_KEY) ?? 'all');
  useEffect(() => {
    const sync = () => setStored(localStorage.getItem(STORAGE_KEY) ?? 'all');
    window.addEventListener(STUDY_ACADEMIC_YEAR_SCOPE_CHANGED, sync);
    return () => window.removeEventListener(STUDY_ACADEMIC_YEAR_SCOPE_CHANGED, sync);
  }, []);

  const scope = useMemo<StudyAcademicYearScope>(() => {
    if (!years) return stored;
    if (stored === 'all' || stored === 'none') return stored;
    if (years.some((year) => year.id === stored)) return stored;
    // The stored year is not in this vault. Falling back to the current one rather
    // than to 'all' keeps the September default useful without ever pointing at a
    // year that does not exist.
    return pickCurrentAcademicYear(years, todayIso())?.id ?? 'all';
  }, [years, stored]);

  const setScope = useCallback((next: StudyAcademicYearScope) => {
    localStorage.setItem(STORAGE_KEY, next);
    setStored(next);
    window.dispatchEvent(new Event(STUDY_ACADEMIC_YEAR_SCOPE_CHANGED));
  }, []);

  const resolved = useMemo(
    () => (scope === 'all' || scope === 'none' ? null : years?.find((year) => year.id === scope) ?? null),
    [years, scope],
  );

  return { scope, setScope, resolved };
}

/** The academic year label a vault should default to when it has none yet. */
export function suggestedAcademicYearLabel(): string {
  return academicYearLabelForDate(todayIso());
}

/** The year today falls into, or the most recent one that has started. */
export function currentStudyAcademicYear(years: readonly StudyAcademicYear[]): StudyAcademicYear | null {
  return pickCurrentAcademicYear(years, todayIso());
}

export function isCurrentAcademicYear(year: StudyAcademicYear): boolean {
  const today = todayIso();
  return year.startDate <= today && today <= year.endDate;
}

/**
 * The scope selector: the one control that answers "which year am I looking at?".
 * `none` is only offered when there is actually unfiled work, so a tidy vault is
 * not asked to reason about a bucket it never uses.
 */
export function StudyAcademicYearScopeSelect({
  years,
  scope,
  onScopeChange,
  hasUnscoped,
  onManage,
  allowAll = true,
  testId = 'study-academic-year-scope',
}: {
  years: readonly StudyAcademicYear[];
  scope: StudyAcademicYearScope;
  onScopeChange: (next: StudyAcademicYearScope) => void;
  hasUnscoped: boolean;
  onManage?: () => void;
  /** False where only one year can be shown at a time, such as the weekly timetable. */
  allowAll?: boolean;
  testId?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <label className="flex items-center gap-1.5 text-xs text-neutral-500">
        <Icon name="graduation" size={13} className="shrink-0" />
        <span className="sr-only">{t('Curso académico')}</span>
        <select
          data-testid={testId}
          aria-label={t('Curso académico')}
          className="input h-9 min-w-44 text-xs"
          value={scope}
          onChange={(event) => onScopeChange(event.target.value)}
        >
          {allowAll && <option value="all">{t('Todos los cursos académicos')}</option>}
          {years.map((year) => (
            <option key={year.id} value={year.id}>
              {isCurrentAcademicYear(year) ? `${year.label} · ${t('actual')}` : year.label}
            </option>
          ))}
          {(hasUnscoped || !allowAll) && <option value="none">{t('Sin curso académico')}</option>}
        </select>
      </label>
      {onManage && (
        <button
          type="button"
          data-testid={`${testId}-manage`}
          className="btn btn-ghost h-9 w-9 shrink-0 p-0"
          title={t('Gestionar cursos académicos')}
          aria-label={t('Gestionar cursos académicos')}
          onClick={onManage}
        >
          <Icon name="settings" size={13} />
        </button>
      )}
    </div>
  );
}

/**
 * The academic year field inside the create/edit dialog for a course or subject.
 *
 * A subject shows what it would inherit from its course, because "empty" and
 * "2024/2025 via the course" look identical otherwise and the user cannot tell
 * whether they still need to fill it in.
 */
export function StudyAcademicYearField({
  years,
  value,
  onChange,
  inheritedLabel,
  onCreateRequest,
}: {
  years: readonly StudyAcademicYear[];
  value: string;
  onChange: (next: string) => void;
  inheritedLabel?: string | null;
  onCreateRequest?: () => void;
}) {
  return (
    <label className="block text-xs text-neutral-500">
      {t('Curso académico')}
      <div className="mt-1 flex items-center gap-1">
        <select data-testid="study-create-academic-year" className="input w-full" value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{inheritedLabel ? `${t('Heredado del curso')} · ${inheritedLabel}` : t('Sin curso académico')}</option>
          {years.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}
        </select>
        {onCreateRequest && (
          <button type="button" data-testid="study-create-academic-year-add" className="btn btn-ghost h-[34px] w-9 shrink-0 p-0" title={t('Nuevo curso académico')} aria-label={t('Nuevo curso académico')} onClick={onCreateRequest}>
            <Icon name="plus" size={13} />
          </button>
        )}
      </div>
    </label>
  );
}

type Draft = { label: string; startDate: string; endDate: string; color: string };

function draftFor(label: string): Draft {
  const start = parseAcademicYearStart(label);
  const range = defaultAcademicYearRange(start ?? new Date().getFullYear());
  return { label, startDate: range.startDate, endDate: range.endDate, color: '' };
}

/**
 * Create, rename and delete academic years.
 *
 * The dates are collapsed behind a disclosure and prefilled from the label. A
 * September-to-August span is right for almost everybody, and asking two date
 * questions before a user can write "2025/2026" is the difference between a
 * feature they adopt and one they skip.
 */
export function StudyAcademicYearManager({
  years,
  usage,
  onClose,
  onChanged,
  initialLabel,
}: {
  years: readonly StudyAcademicYear[];
  /** How many courses and subjects point at each year, so deletion states the cost. */
  usage: Map<string, number>;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  initialLabel?: string | null;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFor(initialLabel || suggestedAcademicYearLabel()));
  const [showDates, setShowDates] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  const normalized = normalizeAcademicYearLabel(draft.label);
  const duplicate = Boolean(normalized) && years.some((year) => year.label === normalized);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  // Keeping the dates in step with the label until the user opens the disclosure
  // means "2025/2026" gets a 2025 September range for free; once they have taken
  // charge of the dates, retyping the label must not silently undo their edit.
  const setLabel = (label: string) => setDraft((current) => (showDates ? { ...current, label } : { ...draftFor(label), color: current.color, label }));

  const create = () => run(async () => {
    const year = await window.nodus.createStudyAcademicYear({
      label: draft.label,
      startDate: draft.startDate || null,
      endDate: draft.endDate || null,
      color: draft.color || null,
    });
    setDraft(draftFor(nextAcademicYearLabel(year.label) ?? suggestedAcademicYearLabel()));
    setShowDates(false);
  });

  return createPortal(
    <div className="fixed inset-0 z-[125] flex items-center justify-center bg-black/60 p-6" onClick={() => { if (!busy) onClose(); }}>
      <div data-testid="study-academic-year-manager" className="card max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto p-5" role="dialog" aria-modal="true" aria-label={t('Cursos académicos')} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">{t('Cursos académicos')}</h2>
            <p className="mt-0.5 text-xs text-neutral-500">{t('Agrupa cursos, asignaturas y horarios por año escolar, como 2024/2025.')}</p>
          </div>
          <button className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" size={13} /></button>
        </div>

        {error && <p className="rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">{error}</p>}

        <form
          className="space-y-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
          onSubmit={(event) => { event.preventDefault(); if (normalized && !duplicate && !busy) void create(); }}
        >
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1 text-xs text-neutral-500">
              {t('Nuevo curso académico')}
              <input data-testid="study-academic-year-label" autoFocus className="input mt-1 w-full text-sm" value={draft.label} onChange={(event) => setLabel(event.target.value)} placeholder="2025/2026" />
            </label>
            <button data-testid="study-academic-year-create" className="btn btn-primary h-[34px]" disabled={!normalized || duplicate || busy}><Icon name="plus" size={13} />{t('Añadir')}</button>
          </div>
          {draft.label.trim() && !normalized && <p className="text-[11px] text-amber-500">{t('Escribe el curso académico como 2024/2025.')}</p>}
          {duplicate && <p className="text-[11px] text-amber-500">{t('Ese curso académico ya existe.')}</p>}
          {normalized && !duplicate && normalized !== draft.label.trim() && <p className="text-[11px] text-neutral-500">{t('Se guardará como {label}.').replace('{label}', normalized)}</p>}
          <button type="button" className="flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-300" aria-expanded={showDates} onClick={() => setShowDates((value) => !value)}>
            <Icon name="chevronRight" size={10} className={`transition-transform ${showDates ? 'rotate-90' : ''}`} />
            {t('Fechas de inicio y fin')}
          </button>
          {showDates && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-xs text-neutral-500">{t('Empieza')}<input data-testid="study-academic-year-start" className="input mt-1 w-full" type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} /></label>
              <label className="block text-xs text-neutral-500">{t('Termina')}<input data-testid="study-academic-year-end" className="input mt-1 w-full" type="date" value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} /></label>
              <p className="text-[11px] text-neutral-600 sm:col-span-2">{t('Estas fechas deciden qué curso académico se considera el actual.')}</p>
            </div>
          )}
        </form>

        {years.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-800 p-6 text-center text-xs text-neutral-500">{t('Todavía no has creado ningún curso académico.')}</p>
        ) : (
          <ul className="space-y-2" data-testid="study-academic-year-list">
            {years.map((year) => {
              const count = usage.get(year.id) ?? 0;
              return (
                <li key={year.id} className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
                  {editingId === year.id ? (
                    <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void run(async () => { await window.nodus.updateStudyAcademicYear(year.id, { label: editingLabel }); setEditingId(null); }); }}>
                      <input autoFocus className="input h-8 min-w-0 flex-1 text-sm" value={editingLabel} onChange={(event) => setEditingLabel(event.target.value)} />
                      <button className="btn btn-primary h-8 px-3 text-xs" disabled={busy}>{t('Guardar')}</button>
                      <button type="button" className="btn btn-ghost h-8 px-3 text-xs" onClick={() => setEditingId(null)}>{t('Cancelar')}</button>
                    </form>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-sm font-semibold text-neutral-200">
                          {year.label}
                          {isCurrentAcademicYear(year) && <span className="rounded-full bg-teal-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-teal-300">{t('actual')}</span>}
                        </p>
                        <p className="mt-0.5 text-[11px] text-neutral-500">
                          {year.startDate} → {year.endDate}
                          {count > 0 && ` · ${t('{count} elementos').replace('{count}', String(count))}`}
                        </p>
                      </div>
                      <button className="btn btn-ghost h-8 w-8 shrink-0 p-0" title={t('Renombrar')} aria-label={t('Renombrar')} onClick={() => { setEditingId(year.id); setEditingLabel(year.label); }}><Icon name="edit" size={12} /></button>
                      <button data-testid={`study-academic-year-delete-${year.id}`} className="btn btn-ghost h-8 w-8 shrink-0 p-0 text-red-400" title={t('Eliminar')} aria-label={t('Eliminar')} onClick={() => setConfirmingId(year.id)}><Icon name="trash" size={12} /></button>
                    </div>
                  )}
                  {confirmingId === year.id && (
                    <div className="mt-2 rounded-lg border border-red-900/50 bg-red-950/20 p-2.5">
                      <p className="text-[11px] text-red-200">
                        {count > 0
                          ? t('Se eliminará {label} y sus {count} cursos y asignaturas dejarán de tener curso académico. No se borra ningún contenido.').replace('{label}', year.label).replace('{count}', String(count))
                          : t('Se eliminará {label}.').replace('{label}', year.label)}
                      </p>
                      <p className="mt-1 text-[11px] text-red-300/80">{t('Su horario sí se eliminará.')}</p>
                      <div className="mt-2 flex justify-end gap-2">
                        <button className="btn btn-ghost h-7 px-2 text-[11px]" onClick={() => setConfirmingId(null)}>{t('Cancelar')}</button>
                        <button data-testid={`study-academic-year-delete-confirm-${year.id}`} className="btn h-7 bg-red-600 px-2 text-[11px] text-white hover:bg-red-500" disabled={busy} onClick={() => void run(async () => { await window.nodus.deleteStudyAcademicYear(year.id); setConfirmingId(null); })}>{t('Eliminar')}</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** `2024/2025` for a year id, for the compact labels on cards and rows. */
export function academicYearLabel(years: readonly StudyAcademicYear[], id: string | null): string | null {
  if (!id) return null;
  return years.find((year) => year.id === id)?.label ?? null;
}

export { formatAcademicYearLabel };
