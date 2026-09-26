import { useEffect, useRef, useState } from 'react';
import type { StudyNamedEntity, StudyWorkspace } from '@shared/studyOrg';
import type { TeachingGroup } from '@shared/teachingGroups';
import { Icon, ModalBackdrop } from './ui';
import { t, tx, getActiveLang } from '../i18n';
import { parseDayKey } from '@shared/teachingAttendance';

/**
 * After a holiday is marked (or removed) in one group, offer the same change to the
 * teacher's other groups: all of them, a hand-picked set, or none.
 *
 * `candidates` are the groups whose academic year contains the day (see
 * `holidayCandidates`); `marked` are those where the day is already a holiday. When
 * adding, the marked ones show as done and cannot be picked; when removing, only the
 * marked ones are offered.
 */
export interface HolidayPrompt {
  action: 'set' | 'clear';
  date: string;
  label: string;
  candidates: TeachingGroup[];
  marked: string[];
}

interface SubjectNode { subject: StudyNamedEntity | null; subjectId: string; groups: TeachingGroup[] }
interface CourseNode { course: StudyNamedEntity | null; courseId: string; subjects: SubjectNode[] }

/** Curso → asignatura → grupo, in the order the organisation tree uses. */
function buildTree(groups: TeachingGroup[], workspace: StudyWorkspace): CourseNode[] {
  const courses = new Map<string, CourseNode>();
  for (const group of groups) {
    const subject = workspace.subjects.find((s) => s.id === group.subjectId) ?? null;
    const courseId = subject?.courseId ?? '';
    const course = workspace.courses.find((c) => c.id === courseId) ?? null;
    const courseNode = courses.get(courseId) ?? { course, courseId, subjects: [] };
    courses.set(courseId, courseNode);
    let subjectNode = courseNode.subjects.find((s) => s.subjectId === group.subjectId);
    if (!subjectNode) {
      subjectNode = { subject, subjectId: group.subjectId, groups: [] };
      courseNode.subjects.push(subjectNode);
    }
    subjectNode.groups.push(group);
  }
  const byPosition = (a: StudyNamedEntity | null, b: StudyNamedEntity | null) => (a?.position ?? 0) - (b?.position ?? 0);
  const tree = [...courses.values()].sort((a, b) => byPosition(a.course, b.course));
  for (const course of tree) course.subjects.sort((a, b) => byPosition(a.subject, b.subject));
  return tree;
}

function EntityGlyph({ entity, fallback }: { entity: StudyNamedEntity | null; fallback: string }) {
  if (entity?.emoji) return <span className="grid h-5 w-5 shrink-0 place-items-center text-sm leading-none">{entity.emoji}</span>;
  return <Icon name={entity?.icon || fallback} size={14} className="shrink-0 text-indigo-300" />;
}

/** A checkbox whose `indeterminate` state (a DOM property, not an attribute) follows React. */
function TriCheckbox({ checked, indeterminate, disabled, onChange, testId, label }: {
  checked: boolean;
  indeterminate: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  testId: string;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="accent-indigo-400"
      data-testid={testId}
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

export function AttendanceHolidayModal({ prompt, workspace, onCancel, onApply }: {
  prompt: HolidayPrompt;
  workspace: StudyWorkspace;
  onCancel: () => void;
  onApply: (groupIds: string[]) => void;
}) {
  const adding = prompt.action === 'set';
  const marked = new Set(prompt.marked);
  // Adding: every candidate is listed, the marked ones as already done.
  // Removing: only the groups that actually have the holiday.
  const listed = adding ? prompt.candidates : prompt.candidates.filter((g) => marked.has(g.id));
  const selectable = adding ? listed.filter((g) => !marked.has(g.id)) : listed;
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(adding ? [] : selectable.map((g) => g.id)));

  const longDay = parseDayKey(prompt.date).toLocaleDateString(getActiveLang(), { weekday: 'long', day: 'numeric', month: 'long' });
  const day = longDay.charAt(0).toLocaleUpperCase(getActiveLang()) + longDay.slice(1);
  const tree = buildTree(listed, workspace);
  const isDone = (group: TeachingGroup) => adding && marked.has(group.id);

  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const state = (groups: TeachingGroup[]) => {
    const open = groups.filter((g) => !isDone(g));
    const on = open.filter((g) => selected.has(g.id)).length;
    return { ids: open.map((g) => g.id), checked: open.length > 0 && on === open.length, indeterminate: on > 0 && on < open.length, disabled: open.length === 0 };
  };

  return (
    <ModalBackdrop onClose={onCancel} zIndex={160}>
      <section className="card-modal w-full max-w-lg p-5" role="dialog" aria-modal="true" aria-label={t('Festivo en otros grupos')} data-testid="attendance-holiday-modal">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-300">
            <Icon name="partyPopper" size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">
              {adding ? t('¿Aplicarlo también a tus otros grupos?') : t('¿Quitarlo también de tus otros grupos?')}
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              {day}
              {prompt.label ? ` · ${prompt.label}` : ''}
              {' · '}
              {adding
                ? t('Ya está guardado en este grupo. Solo se ofrecen los grupos cuyo curso académico incluye este día.')
                : t('Ya se ha quitado de este grupo.')}
            </p>
          </div>
        </div>

        {!picking ? (
          <div className="mt-5 grid gap-2">
            <button
              type="button"
              className="btn btn-primary justify-center"
              data-testid="attendance-holiday-all"
              onClick={() => onApply(selectable.map((g) => g.id))}
            >
              {adding ? t('Sí, a todos') : t('Sí, de todos')}
              <span className="text-xs opacity-80">({selectable.length})</span>
            </button>
            <button type="button" className="btn btn-ghost justify-center" data-testid="attendance-holiday-pick" onClick={() => setPicking(true)}>
              <Icon name="list" size={13} />{t('Elegir grupos…')}
            </button>
            <button type="button" className="btn btn-ghost justify-center" data-testid="attendance-holiday-none" onClick={onCancel}>
              {t('No, solo este grupo')}
            </button>
          </div>
        ) : (
          <>
            <div className="mt-4 max-h-[50vh] overflow-auto rounded-lg border border-neutral-200 p-2 dark:border-neutral-800" data-testid="attendance-holiday-tree">
              {tree.map((course) => {
                const courseGroups = course.subjects.flatMap((s) => s.groups);
                const cs = state(courseGroups);
                return (
                  <div key={course.courseId || 'none'} className="mb-1">
                    <label className="flex items-center gap-2 rounded-md px-1.5 py-1 font-medium hover:bg-neutral-100 dark:hover:bg-neutral-900">
                      <TriCheckbox {...cs} testId={`holiday-course-${course.courseId}`} label={course.course?.name ?? t('Sin curso')} onChange={(on) => toggle(cs.ids, on)} />
                      <EntityGlyph entity={course.course} fallback="graduation" />
                      <span className="truncate text-sm">{course.course?.name ?? t('Sin curso')}</span>
                    </label>
                    {course.subjects.map((subject) => {
                      const ss = state(subject.groups);
                      return (
                        <div key={subject.subjectId} className="ml-5">
                          <label className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-900">
                            <TriCheckbox {...ss} testId={`holiday-subject-${subject.subjectId}`} label={subject.subject?.name ?? t('Sin asignatura')} onChange={(on) => toggle(ss.ids, on)} />
                            <EntityGlyph entity={subject.subject} fallback="book" />
                            <span className="truncate text-sm">{subject.subject?.name ?? t('Sin asignatura')}</span>
                          </label>
                          {subject.groups.map((group) => {
                            const done = isDone(group);
                            return (
                              <label key={group.id} className={`ml-5 flex items-center gap-2 rounded-md px-1.5 py-1 ${done ? 'text-neutral-400' : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'}`}>
                                <input
                                  type="checkbox"
                                  className="accent-indigo-400"
                                  data-testid={`holiday-group-${group.id}`}
                                  checked={done || selected.has(group.id)}
                                  disabled={done}
                                  onChange={(event) => toggle([group.id], event.target.checked)}
                                />
                                <Icon name="users" size={14} className="shrink-0 text-neutral-500" />
                                <span className="truncate text-sm">{group.name}</span>
                                {done && <span className="ml-auto shrink-0 text-[10px]">{t('ya es festivo')}</span>}
                              </label>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setPicking(false)}>{t('Volver')}</button>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="attendance-holiday-apply"
                disabled={selected.size === 0}
                onClick={() => onApply([...selected])}
              >
                {adding
                  ? selected.size === 1 ? t('Aplicar a 1 grupo') : tx('Aplicar a {n} grupos', { n: selected.size })
                  : selected.size === 1 ? t('Quitar de 1 grupo') : tx('Quitar de {n} grupos', { n: selected.size })}
              </button>
            </div>
          </>
        )}
      </section>
    </ModalBackdrop>
  );
}
