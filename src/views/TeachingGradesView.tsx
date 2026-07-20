import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StudyWorkspace } from '@shared/studyOrg';
import type { AppSettings } from '@shared/types';
import type { TeachingGroup } from '@shared/teachingGroups';
import {
  ASSESSMENT_PROFILES,
  ENTRY_STATUSES,
  GRID_COL,
  awardHonours,
  gradebookToGrid,
  toScale,
  validatePlan,
  type AssessmentItem,
  type AssessmentPlan,
  type AssessmentTrack,
  type EntryStatus,
  type GradeEntry,
  type PlanRules,
  type TraceNode,
  type TraceRule,
} from '@shared/assessment';
import type { TeachingRubric } from '@shared/teachingRubrics';
import { criterionMaxPoints } from '@shared/teachingRubrics';
import { isStudentFilled } from '@shared/teachingGroups';
import { Icon, ModalBackdrop, Spinner } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { AssessmentPlanEditor } from './AssessmentPlanEditor';
import { GUTTER_WIDTH, TextCell } from '../components/dbGrid';
import { analyseItems, gradeDistribution, EXTREME_GROUP_FRACTION } from '@shared/itemAnalysis';
import { t, tx, errorText, getActiveLang } from '../i18n';

/**
 * Calificaciones — the gradebook.
 *
 * The grid is derived, never stored: `gradebookToGrid` presents the plan, its items
 * and its marks in the same `(columns, rows)` shape the database vault works over, so
 * the sorting, statistics and export machinery all apply unchanged. Edits go the other
 * way, cell by cell, keyed on (student, item, convocatoria).
 *
 * Two things are deliberately visible rather than buried: the derivation behind every
 * final mark, because a grade challenge is decided by comparing it with the published
 * plan; and the plan's own warnings, which advise but never block — real published
 * programaciones contain weights that do not sum, and refusing to open them would make
 * the tool useless for the documents teachers actually have.
 */
export function TeachingGradesView() {
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [plans, setPlans] = useState<AssessmentPlan[]>([]);
  const [groups, setGroups] = useState<TeachingGroup[]>([]);
  const [plan, setPlan] = useState<AssessmentPlan | null>(null);
  const [items, setItems] = useState<AssessmentItem[]>([]);
  const [entries, setEntries] = useState<GradeEntry[]>([]);
  const [group, setGroup] = useState<TeachingGroup | null>(null);
  const [cohort, setCohort] = useState<{ maxByItem: Record<string, number> }>({ maxByItem: {} });
  /** studentId → itemId → fraction already earned earlier. Feeds the ratchet rule. */
  const [previous, setPrevious] = useState<Record<string, Record<string, number>>>({});
  const [rubricCell, setRubricCell] = useState<{ studentId: string; item: AssessmentItem } | null>(null);
  const [track, setTrack] = useState<AssessmentTrack>('continua');
  const [convocatoria, setConvocatoria] = useState('ordinaria');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AssessmentPlan | null>(null);
  const [explain, setExplain] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [analysing, setAnalysing] = useState(false);

  const reloadPlans = useCallback(async () => setPlans(await window.nodus.listAssessmentPlans()), []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [list, ws, cfg, grps] = await Promise.all([
          window.nodus.listAssessmentPlans(),
          window.nodus.getStudyWorkspace(),
          window.nodus.getSettings(),
          window.nodus.listTeachingGroups(),
        ]);
        if (!active) return;
        setPlans(list);
        setWorkspace(ws);
        setSettings(cfg);
        setGroups(grps);
      } catch (cause) {
        if (active) setError(errorText(cause));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  const guard = async (run: () => Promise<void>) => {
    try { await run(); } catch (cause) { setError(errorText(cause)); }
  };

  const subjectName = (id: string) => workspace?.subjects.find((s) => s.id === id)?.name ?? t('Sin asignatura');

  const openPlan = async (id: string) => {
    const detail = await window.nodus.getAssessmentPlan(id);
    setPlan(detail.plan);
    setItems(detail.items);
    const rows = await window.nodus.listGradeEntries(id, convocatoria);
    setEntries(rows);
    const candidates = groups.filter((g) => g.subjectId === detail.plan.subjectId);
    const chosen = candidates[0] ?? null;
    if (chosen) await selectGroup(id, chosen);
  };

  const selectGroup = async (planId: string, next: TeachingGroup) => {
    const detail = await window.nodus.getTeachingGroup(next.id);
    setGroup(detail);
    const [stats, baseline] = await Promise.all([
      window.nodus.gradebookCohortStats(planId, next.id, convocatoria),
      window.nodus.gradebookRatchetBaseline(planId, next.id, convocatoria),
    ]);
    setCohort(stats);
    setPrevious(baseline);
  };

  const refresh = async () => {
    if (!plan) return;
    setEntries(await window.nodus.listGradeEntries(plan.id, convocatoria));
    if (!group) return;
    const [stats, baseline] = await Promise.all([
      window.nodus.gradebookCohortStats(plan.id, group.id, convocatoria),
      window.nodus.gradebookRatchetBaseline(plan.id, group.id, convocatoria),
    ]);
    setCohort(stats);
    setPrevious(baseline);
  };

  // Deliberately keyed on the convocatoria alone: the ordinary and the resit marks are
  // separate rows, so switching between them is a reload, not a re-render of the same
  // data. `refresh` reads plan/group from the current render's closure, so it is not
  // stale — note this project has no exhaustive-deps rule to catch it if it ever were.
  useEffect(() => {
    if (plan) void guard(refresh);
  }, [convocatoria]);

  // `lang` is in the dependency list because the column headers are translated INSIDE
  // this memo. Without it the grid keeps the previous language's headers after a
  // language switch — and this project has no exhaustive-deps rule to catch that.
  const lang = getActiveLang();
  const grid = useMemo(() => {
    if (!plan || !group) return null;
    return gradebookToGrid({
      plan,
      items,
      entries,
      students: (group.students ?? []).map((s) => ({
        id: s.id, givenNames: s.givenNames, surnames: s.surnames, pseudonymCode: s.pseudonymCode, position: s.position,
      })),
      cohort,
      track,
      previous,
      convocatoria,
      showCodes: settings?.studentPseudonymsEnabled ?? true,
      labels: {
        code: t('Identificador'), givenNames: t('Nombre'),
        surnames: t('Apellidos'), grade: t('Calificación'),
        qualitative: t('Calificación cualitativa'),
      },
    });
  }, [plan, items, entries, group, cohort, track, previous, convocatoria, settings, lang]);

  /**
   * Who gets a distinction. The quota is counted over everyone ENROLLED, so the blank
   * rows a group pre-creates would enlarge the denominator and quietly shrink the quota:
   * only real students count.
   */
  const honours = useMemo(() => {
    const policy = plan?.rules.honours;
    if (!plan || !policy?.enabled || !grid) return new Set<string>();
    const roster = (group?.students ?? []).filter(isStudentFilled);
    const ids = awardHonours(
      roster.map((student) => {
        const result = grid.results[student.id];
        return {
          studentId: student.id,
          raw: result?.raw ?? null,
          passed: result?.passed,
          notPresented: result?.record.notPresented,
        };
      }),
      policy,
      plan.rules,
    );
    return new Set(ids);
  }, [plan, grid, group]);

  const warnings = useMemo(() => (plan ? validatePlan(plan, items) : []), [plan, items]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const entryByCell = useMemo(() => {
    const map = new Map<string, GradeEntry>();
    for (const entry of entries) map.set(`${entry.studentId}|${entry.itemId}`, entry);
    return map;
  }, [entries]);
  const isEditable = (columnId: string) => {
    const item = itemById.get(columnId);
    // Only leaves take a typed mark: a block's cell is its computed subtotal.
    return !!item && !items.some((child) => child.parentId === item.id);
  };

  if (loading) return <div className="grid h-full place-items-center"><Spinner label={t('Cargando calificaciones…')} /></div>;

  /* ------------------------------------------------------------- plan list --- */
  if (!plan) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="grades-list">
        <header className="border-b border-neutral-200 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex flex-wrap items-center gap-3">
            <div className="mr-auto">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-300">{t('Evaluación')}</p>
              <h1 className="text-xl font-semibold">{t('Calificaciones')}</h1>
              <p className="mt-1 text-xs text-neutral-500">{t('Cuadernos de notas con los criterios de tu programación o guía docente.')}</p>
            </div>
            <button
              data-testid="plan-new"
              data-tour="plan-new"
              className="btn btn-primary"
              disabled={!workspace?.subjects.length}
              title={workspace?.subjects.length ? undefined : t('Crea antes una asignatura.')}
              onClick={() => setCreating(true)}
            >
              <Icon name="plus" />{t('Nuevo cuaderno')}
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          {error && <p className="px-5 pt-3 text-sm text-red-500">{error}</p>}
          {plans.length === 0 ? (
            <div className="mx-auto mt-12 max-w-md rounded-xl border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-800">
              <Icon name="chartBar" size={26} className="mx-auto mb-3 text-neutral-400" />
              <p className="text-sm text-neutral-500">
                {workspace?.subjects.length
                  ? t('Todavía no has creado ningún cuaderno de notas.')
                  : t('Crea primero una asignatura en Cursos, asignaturas y grupos.')}
              </p>
            </div>
          ) : (
            <table className="w-full min-w-[720px] border-collapse text-xs" data-testid="plan-table" data-tour="plan-table">
              <thead className="study-browser-table-head sticky top-0 z-10">
                <tr className="text-left">
                  <th className="w-[34%] px-4 py-2 font-medium">{t('Cuaderno')}</th>
                  <th className="px-3 py-2 font-medium">{t('Asignatura')}</th>
                  <th className="px-3 py-2 font-medium">{t('Modelo')}</th>
                  <th className="px-3 py-2 font-medium">{t('Estado')}</th>
                  <th className="w-[8%] px-3 py-2 text-right font-medium">{t('Acciones')}</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((entry) => (
                  <tr
                    key={entry.id}
                    data-testid={`plan-row-${entry.id}`}
                    className="cursor-pointer border-b border-neutral-200 hover:bg-neutral-100 dark:border-neutral-800/60 dark:hover:bg-neutral-900/40"
                    onClick={() => void guard(() => openPlan(entry.id))}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-600/15 text-indigo-300"><Icon name="chartBar" size={15} /></span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-neutral-800 dark:text-neutral-200">{entry.name}</span>
                          <span className="block truncate text-[10px] text-neutral-500 dark:text-neutral-600">{tx('Versión {n}', { n: entry.version })}</span>
                        </span>
                      </div>
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-2.5 text-neutral-500">{subjectName(entry.subjectId)}</td>
                    <td className="px-3 py-2.5 text-neutral-500">
                      {ASSESSMENT_PROFILES.find((p) => p.id === entry.profile)?.label ?? entry.profile}
                    </td>
                    <td className="px-3 py-2.5 text-neutral-500">
                      {entry.publishedAt ? t('Publicado') : t('Borrador')}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        className="btn btn-ghost h-7 w-7 p-0 text-red-500"
                        title={t('Eliminar')}
                        aria-label={t('Eliminar')}
                        onClick={(event) => { event.stopPropagation(); setPendingDelete(entry); }}
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {creating && workspace && (
          <NewPlanModal
            workspace={workspace}
            onCancel={() => setCreating(false)}
            onCreate={async (input) => {
              await guard(async () => {
                const created = await window.nodus.createAssessmentPlan(input);
                setCreating(false);
                await reloadPlans();
                await openPlan(created.id);
              });
            }}
          />
        )}
        {pendingDelete && (
          <ConfirmModal
            title={t('Eliminar cuaderno')}
            message={t('Se eliminará este cuaderno y todas sus calificaciones. Esta acción no se puede deshacer.')}
            confirmLabel={t('Eliminar')}
            danger
            onConfirm={async () => {
              await window.nodus.deleteAssessmentPlan(pendingDelete.id);
              setPendingDelete(null);
              void reloadPlans();
            }}
            onCancel={() => setPendingDelete(null)}
          />
        )}
      </div>
    );
  }

  /* ----------------------------------------------------------------- grid --- */
  const columns = grid?.columns ?? [];
  const rows = grid?.rows ?? [];
  const totalWidth = GUTTER_WIDTH + columns.reduce((sum, c) => sum + (c.config.width ?? 110), 0);

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="grades-detail">
      <header className="border-b border-neutral-200 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-ghost h-8 w-8 p-0" title={t('Volver')} aria-label={t('Volver')} data-testid="plan-back"
            onClick={() => { setPlan(null); setGroup(null); void reloadPlans(); }}>
            <Icon name="chevronLeft" size={14} />
          </button>
          <div className="mr-auto min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-300">{subjectName(plan.subjectId)}</p>
            <h1 className="truncate text-xl font-semibold">{plan.name}</h1>
            <p className="mt-1 text-xs text-neutral-500">
              {group ? tx('{n} alumnos · {g}', { n: (group.students ?? []).length, g: group.name }) : t('Elige un grupo para empezar.')}
            </p>
          </div>
          <button className="btn btn-ghost h-8" data-testid="grades-analysis" disabled={!grid}
            onClick={() => setAnalysing(true)}>
            <Icon name="chartBar" size={13} />{t('Analizar')}
          </button>
          <button className="btn btn-ghost h-8" data-testid="grades-export" disabled={!grid}
            onClick={() => setExporting(true)}>
            <Icon name="download" size={13} />{t('Exportar')}
          </button>
          <button className="btn btn-ghost h-8" data-testid="plan-edit" onClick={() => setEditing(true)}>
            <Icon name="settings" size={13} />{t('Plan de evaluación')}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select className="input h-8 min-w-40 text-xs" data-testid="grades-group"
            value={group?.id ?? ''}
            onChange={(e) => {
              const next = groups.find((g) => g.id === e.target.value);
              if (next) void guard(() => selectGroup(plan.id, next));
            }}>
            <option value="">{t('Elige un grupo')}</option>
            {groups.filter((g) => g.subjectId === plan.subjectId).map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <select className="input h-8 text-xs" data-testid="grades-track" value={track}
            onChange={(e) => setTrack(e.target.value as AssessmentTrack)}>
            <option value="continua">{t('Evaluación continua')}</option>
            <option value="no_continua">{t('Evaluación no continua')}</option>
          </select>
          <select className="input h-8 text-xs" data-testid="grades-convocatoria" value={convocatoria}
            onChange={(e) => setConvocatoria(e.target.value)}>
            <option value="ordinaria">{t('Convocatoria ordinaria')}</option>
            <option value="extraordinaria">{t('Convocatoria extraordinaria')}</option>
          </select>
        </div>

        {/* Advisories, never refusals: a plan whose weights do not add up is a real
            document, and the teacher — not the tool — decides what to do about it. */}
        {warnings.length > 0 && (
          <div data-testid="plan-warnings"
            className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
            {warnings.slice(0, 3).map((warning, index) => (
              <p key={index} className="flex items-start gap-2">
                <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
                <span>{warningText(warning)}</span>
              </p>
            ))}
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {error && <p className="pb-3 text-sm text-red-500">{error}</p>}
        {message && <p className="pb-3 text-sm text-emerald-600 dark:text-emerald-400">{message}</p>}

        {items.length === 0 ? (
          <div className="mx-auto mt-8 max-w-md rounded-xl border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-800">
            <Icon name="layers" size={26} className="mx-auto mb-3 text-neutral-400" />
            <p className="text-sm text-neutral-500">{t('Este cuaderno todavía no tiene bloques de evaluación.')}</p>
            <button className="btn btn-primary mt-4" data-testid="item-add-first"
              onClick={() => void guard(async () => {
                await window.nodus.createAssessmentItem(plan.id, { name: t('Bloque'), weight: 100 });
                setItems((await window.nodus.getAssessmentPlan(plan.id)).items);
              })}>
              <Icon name="plus" />{t('Añadir bloque')}
            </button>
          </div>
        ) : !group ? (
          <p className="text-sm text-neutral-500">{t('Elige un grupo para ver su alumnado.')}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800" data-testid="grades-grid">
            <div style={{ minWidth: totalWidth }}>
              <div className="study-browser-table-head sticky top-0 z-10 flex border-b border-neutral-200 dark:border-neutral-800">
                <div style={{ width: GUTTER_WIDTH }} className="shrink-0 px-3 py-2 text-[11px] font-medium text-neutral-500">#</div>
                {columns.map((col) => (
                  <div key={col.id} style={{ width: col.config.width ?? 110 }}
                    className="shrink-0 truncate px-2 py-2 text-[11px] font-medium" title={col.name}>
                    {col.name}
                  </div>
                ))}
              </div>
              {rows.map((row, index) => (
                <div key={row.id} data-testid={`grade-row-${row.id}`}
                  className="flex border-t border-neutral-200 dark:border-neutral-800/60">
                  <div style={{ width: GUTTER_WIDTH }} className="shrink-0 px-3 py-2 text-[11px] text-neutral-500">{index + 1}</div>
                  {columns.map((col) => {
                    const width = col.config.width ?? 110;
                    if (col.id === GRID_COL.code) {
                      return (
                        <div key={col.id} style={{ width }} className="shrink-0 px-2 py-1">
                          <button type="button" data-testid={`grade-code-${row.id}`}
                            className="rounded-md bg-indigo-600/15 px-2 py-1 font-mono text-[10px] text-indigo-300 hover:bg-indigo-600/20"
                            title={t('Copiar identificador')}
                            aria-label={tx('Copiar el identificador {code}', { code: String(row.cells[col.id] ?? '') })}
                            onClick={() => void guard(async () => {
                              await navigator.clipboard.writeText(String(row.cells[col.id] ?? ''));
                              setMessage(tx('Identificador {code} copiado.', { code: String(row.cells[col.id] ?? '') }));
                            })}>
                            {row.cells[col.id]}
                          </button>
                        </div>
                      );
                    }
                    if (col.id === GRID_COL.final || col.id === GRID_COL.qualitative) {
                      return (
                        <div key={col.id} style={{ width }} className="flex shrink-0 items-center px-2 py-1">
                          <button type="button" data-testid={`grade-final-${row.id}`}
                            className="min-w-0 flex-1 rounded-md px-2 py-1 text-left text-sm font-medium hover:bg-neutral-100 dark:hover:bg-neutral-900/40"
                            title={t('Ver cómo se ha calculado')}
                            onClick={() => setExplain(row.id)}>
                            {row.cells[col.id] ?? '—'}
                          </button>
                          {col.id === GRID_COL.final && honours.has(row.id) && (
                            <span className="shrink-0 text-[11px] text-amber-500" data-testid={`grade-honours-${row.id}`}
                              title={t('Mención')} aria-label={t('Mención')}>★</span>
                          )}
                        </div>
                      );
                    }
                    const item = itemById.get(col.id);
                    const editable = isEditable(col.id);
                    return (
                      <div key={col.id} style={{ width }}
                        data-testid={editable ? `grade-cell-${row.id}-${col.id}` : undefined}
                        className={`h-9 shrink-0 ${editable ? '' : 'bg-neutral-100/60 dark:bg-neutral-900/30'}`}>
                        {editable && item ? (
                          <GradeCell
                            studentId={row.id}
                            item={item}
                            value={row.cells[col.id]}
                            status={entryByCell.get(`${row.id}|${item.id}`)?.status ?? 'not_assessed'}
                            onSetValue={(raw) => void guard(async () => {
                              await window.nodus.setGradeEntry({
                                studentId: row.id, itemId: col.id, convocatoria,
                                rawValue: raw == null || raw.trim() === '' ? null : Number(raw),
                                status: raw == null || raw.trim() === '' ? 'not_assessed' : 'evaluated',
                              });
                              await refresh();
                            })}
                            onSetStatus={(status) => void guard(async () => {
                              // A status that carries no mark clears the value: leaving the
                              // old number behind would make "no entregado" still average.
                              const keepsValue = status === 'evaluated' || status === 'validated';
                              await window.nodus.setGradeEntry({
                                studentId: row.id, itemId: col.id, convocatoria,
                                status, ...(keepsValue ? {} : { rawValue: null }),
                              });
                              await refresh();
                            })}
                            onOpenRubric={() => setRubricCell({ studentId: row.id, item })}
                          />
                        ) : (
                          <div className="px-2 py-2 text-right text-sm text-neutral-500" title={t('Subtotal calculado')}>
                            {row.cells[col.id] ?? '—'}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {rubricCell && (
        <RubricCellModal
          studentId={rubricCell.studentId}
          item={rubricCell.item}
          convocatoria={convocatoria}
          onClose={() => setRubricCell(null)}
          onSaved={refresh}
        />
      )}

      {analysing && grid && plan && group && (
        <AnalysisModal
          plan={plan}
          items={items}
          entries={entries}
          // Only real students: the blank rows a group pre-creates carry no marks, and
          // counting them as zeros makes every question look excellent (see E1).
          students={(group.students ?? []).filter(isStudentFilled)}
          results={grid.results}
          onClose={() => setAnalysing(false)}
        />
      )}

      {exporting && grid && plan && group && (
        <ExportModal
          onCancel={() => setExporting(false)}
          onExport={async (format) => {
            await guard(async () => {
              const rows = (group.students ?? []).map((student) => {
                const result = grid.results[student.id];
                return {
                  code: student.pseudonymCode,
                  name: [student.givenNames, student.surnames].filter(Boolean).join(' '),
                  numeric: result?.record.numeric ?? null,
                  qualitative: result?.record.qualitative ?? null,
                  notPresented: !!result?.record.notPresented,
                  passed: !!result?.passed,
                  honours: honours.has(student.id),
                };
              });
              const done = await window.nodus.exportGradebookActa(format, {
                header: {
                  subject: subjectName(plan.subjectId),
                  group: group.name,
                  convocatoria: convocatoria === 'ordinaria' ? t('Convocatoria ordinaria') : t('Convocatoria extraordinaria'),
                  date: new Date().toLocaleDateString(getActiveLang()),
                },
                rows,
                labels: exportLabels(),
                showCodes: settings?.studentPseudonymsEnabled ?? true,
              }, { columns: grid.columns, rows: grid.rows });
              setExporting(false);
              if (done) setMessage(t('Documento descargado.'));
            });
          }}
        />
      )}

      {editing && (
        <AssessmentPlanEditor
          plan={plan}
          items={items}
          onClose={() => setEditing(false)}
          onReplaced={async (next) => {
            // A revision is a NEW plan. Staying on the old id left the editor showing
            // the frozen version and let the same button mint orphan copies.
            await guard(() => openPlan(next.id));
            await reloadPlans();
          }}
          onChanged={async () => {
            const detail = await window.nodus.getAssessmentPlan(plan.id);
            setPlan(detail.plan);
            setItems(detail.items);
            await refresh();
            await reloadPlans();
          }}
        />
      )}

      {explain && grid && (
        <ExplainModal
          name={rowLabel(rows.find((r) => r.id === explain))}
          result={grid.results[explain]}
          rules={plan.rules}
          onClose={() => setExplain(null)}
          onDownload={async () => {
            const student = (group?.students ?? []).find((s) => s.id === explain);
            if (!student || !plan) return;
            await guard(async () => {
              const done = await window.nodus.exportGradebookBoletin({
                header: {
                  subject: subjectName(plan.subjectId),
                  group: group?.name,
                  date: new Date().toLocaleDateString(getActiveLang()),
                },
                student: {
                  code: student.pseudonymCode,
                  name: [student.givenNames, student.surnames].filter(Boolean).join(' '),
                },
                result: grid.results[student.id],
                scale: { min: plan.rules.scaleMin, max: plan.rules.scaleMax },
                labels: exportLabels(),
              });
              if (done) setMessage(t('Documento descargado.'));
            });
          }}
        />
      )}
    </div>
  );
}

/**
 * One editable cell: the mark, and — just as importantly — its STATUS.
 *
 * The status menu is the whole point. Until it existed the grid could only ever send
 * `evaluated` or `not_assessed`, so three of the five statuses the engine implements
 * were unreachable from the interface and a teacher had no way to say "no lo entregó"
 * as opposed to "todavía no lo he corregido". That distinction is the difference
 * between a blank cell and a zero, which is the single most consequential difference in
 * a gradebook.
 *
 * A native `<select>` on purpose: the browser renders its list outside the grid, so it
 * cannot be clipped by the scroll container the way a custom dropdown would be.
 */
const STATUS_CODE: Record<EntryStatus, string> = {
  evaluated: '·', not_submitted: 'NE', not_assessed: '—', exempt: 'EX', validated: 'CV',
};

function statusLabel(status: EntryStatus): string {
  switch (status) {
    case 'not_submitted': return t('No entregado');
    case 'not_assessed': return t('Sin evaluar');
    case 'exempt': return t('Exento');
    case 'validated': return t('Convalidado');
    case 'evaluated':
    default: return t('Evaluado');
  }
}

function GradeCell({
  studentId, item, value, status, onSetValue, onSetStatus, onOpenRubric,
}: {
  studentId: string;
  item: AssessmentItem;
  value: string | null;
  status: EntryStatus;
  onSetValue: (raw: string | null) => void;
  onSetStatus: (status: EntryStatus) => void;
  onOpenRubric: () => void;
}) {
  const carriesValue = status === 'evaluated' || status === 'not_assessed' || status === 'validated';
  const isRubric = item.entryMode === 'rubric' && !!item.sourceRubricId;
  return (
    <div className="flex h-full items-center gap-0.5 px-0.5">
      <select
        className="input h-7 w-9 shrink-0 px-0.5 text-center text-[10px]"
        data-testid={`grade-status-${studentId}-${item.id}`}
        aria-label={t('Situación de la entrega')}
        title={statusLabel(status)}
        value={status}
        onChange={(event) => onSetStatus(event.target.value as EntryStatus)}
      >
        {ENTRY_STATUSES.map((option) => (
          <option key={option} value={option}>{STATUS_CODE[option]} {statusLabel(option)}</option>
        ))}
      </select>
      {!carriesValue ? (
        <span className="flex-1 pr-2 text-right text-sm text-neutral-500"
          data-testid={`grade-status-label-${studentId}-${item.id}`}>{statusLabel(status)}</span>
      ) : isRubric ? (
        <button type="button" data-testid={`grade-rubric-${studentId}-${item.id}`}
          className="h-7 flex-1 rounded-md px-2 text-right text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900/40"
          title={t('Evaluar con la rúbrica')} onClick={onOpenRubric}>
          {value ?? '—'}
        </button>
      ) : (
        // `h-full` matters: TextCell's own hit area is `h-full`, so with nothing to
        // resolve against it collapses to a sliver and the cell stops taking clicks —
        // the mark simply does not go in.
        <div className="h-full min-w-0 flex-1" data-testid={`grade-value-${studentId}-${item.id}`}>
          <TextCell value={value} inputType="number" align="right" onChange={onSetValue} />
        </div>
      )}
    </div>
  );
}

/**
 * The rubric grid, as the way to mark a rubric column.
 *
 * The plan editor promises "se evalúa abriendo la rúbrica" and `setRubricEvaluation`
 * existed with no caller, so the promise had nowhere to land. Criteria left unmarked
 * are not zeros: the repo renormalises over the ones actually chosen, and this panel
 * says how many are still pending so the teacher knows the mark is provisional.
 */
function RubricCellModal({
  studentId, item, convocatoria, onClose, onSaved,
}: {
  studentId: string;
  item: AssessmentItem;
  convocatoria: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [rubric, setRubric] = useState<TeachingRubric | null>(null);
  const [levels, setLevels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [detail, chosen] = await Promise.all([
          window.nodus.getTeachingRubric(item.sourceRubricId as string),
          window.nodus.getRubricEvaluation(studentId, item.id, convocatoria),
        ]);
        if (!active) return;
        setRubric(detail);
        setLevels(chosen);
      } catch (cause) {
        if (active) setError(errorText(cause));
      }
    })();
    return () => { active = false; };
  }, [studentId, item.id, item.sourceRubricId, convocatoria]);

  const pending = rubric ? rubric.criteria.filter((c) => !levels[c.id]).length : 0;

  return (
    <ModalBackdrop onClose={onClose}>
      <section className="card-modal flex max-h-[86vh] w-full max-w-3xl flex-col p-5" role="dialog" aria-modal="true"
        aria-label={t('Evaluar con la rúbrica')} data-testid="rubric-cell-modal">
        <h2 className="text-base font-semibold">{t('Evaluar con la rúbrica')}</h2>
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        {!rubric ? (
          <div className="grid h-40 place-items-center"><Spinner label={t('Cargando…')} /></div>
        ) : (
          <>
            <p className="mt-1 text-xs text-neutral-500">
              {pending > 0
                ? tx('Quedan {n} criterios sin marcar; la nota se calcula solo sobre los evaluados.', { n: pending })
                : t('Todos los criterios están evaluados.')}
            </p>
            <div className="mt-3 min-h-0 flex-1 overflow-auto">
              <table className="w-full border-collapse text-xs">
                <thead className="study-browser-table-head">
                  <tr className="text-left">
                    <th className="px-2 py-1 font-medium">{t('Criterio')}</th>
                    {rubric.levels.map((level) => (
                      <th key={level.id} className="px-2 py-1 text-center font-medium">{level.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rubric.criteria.map((criterion) => (
                    <tr key={criterion.id} className="border-t border-neutral-200 dark:border-neutral-800/60">
                      <td className="px-2 py-1">
                        <span className="block">{criterion.name || '—'}</span>
                        <span className="block text-[10px] text-neutral-500">
                          {tx('hasta {n} puntos', { n: criterionMaxPoints(rubric, criterion) })}
                        </span>
                      </td>
                      {rubric.levels.map((level) => (
                        <td key={level.id} className="px-2 py-1 text-center">
                          <input
                            type="radio"
                            name={`criterion-${criterion.id}`}
                            data-testid={`rubric-pick-${criterion.id}-${level.id}`}
                            aria-label={`${criterion.name} · ${level.label}`}
                            checked={levels[criterion.id] === level.id}
                            onChange={() => setLevels((prev) => ({ ...prev, [criterion.id]: level.id }))}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button>
          <button className="btn btn-primary" data-testid="rubric-cell-save" disabled={busy || !rubric}
            onClick={() => {
              setBusy(true);
              void (async () => {
                try {
                  await window.nodus.setRubricEvaluation({ studentId, itemId: item.id, convocatoria, levels });
                  await onSaved();
                  onClose();
                } catch (cause) {
                  setError(errorText(cause));
                } finally {
                  setBusy(false);
                }
              })();
            }}>
            {busy ? t('Guardando…') : t('Guardar')}
          </button>
        </div>
      </section>
    </ModalBackdrop>
  );
}

/** Document wording, translated at the call site so the file follows the UI language. */
function exportLabels() {
  return {
    acta: t('Acta de calificaciones'), boletin: t('Boletín de calificaciones'),
    student: t('Alumno/a'), identifier: t('Identificador'), grade: t('Calificación'),
    status: t('Situación'), passed: t('Apto'), failed: t('No apto'),
    notPresented: t('No presentado'), honours: t('Mención'), breakdown: t('Desglose'),
    weight: t('Peso'), signature: t('Firma'), generated: t('Generado con Nodus'),
  };
}

/**
 * Group summary and, when the plan has an exam block, classical item analysis.
 *
 * The convention is printed next to the numbers rather than assumed. Spanish sources
 * disagree on which way the difficulty index runs, and a teacher reading it backwards
 * would "fix" precisely the questions that worked.
 */
function AnalysisModal({
  plan, items, entries, students, results, onClose,
}: {
  plan: AssessmentPlan;
  items: AssessmentItem[];
  entries: GradeEntry[];
  students: { id: string; pseudonymCode: string }[];
  results: Record<string, { record: { numeric: number | null } }>;
  onClose: () => void;
}) {
  const studentIds = students.map((s) => s.id);
  const finals = studentIds
    .map((id) => results[id]?.record.numeric)
    .filter((v): v is number => v != null);
  const dist = gradeDistribution(finals, plan.rules.passAt, { min: plan.rules.scaleMin, max: plan.rules.scaleMax });
  // A qualitative-only plan records no number by design, so `numeric` is null for
  // everyone. Saying "0 calificaciones" would read as "nobody has been graded";
  // the honest statement is that a numeric distribution does not apply here.
  const numericApplies = plan.rules.record !== 'qualitative';

  // Only leaves that belong to an exam block: item analysis is about questions.
  const questions = items.filter((i) => i.sourceExamQuestionId && !items.some((c) => c.parentId === i.id));
  const stats = questions.length > 0
    ? analyseItems(questions.map((q) => ({
        itemId: q.id, name: q.name, maxPoints: q.maxPoints,
        marks: Object.fromEntries(entries
          .filter((e) => e.itemId === q.id && e.status === 'evaluated' && e.rawValue != null)
          .map((e) => [e.studentId, e.rawValue as number])),
      })), studentIds)
    : [];

  const maxBucket = Math.max(1, ...dist.buckets.map((b) => b.count));

  return (
    <ModalBackdrop onClose={onClose}>
      <section className="card-modal flex max-h-[86vh] w-full max-w-2xl flex-col p-5" role="dialog" aria-modal="true"
        aria-label={t('Analizar')} data-testid="analysis-modal">
        <h2 className="text-base font-semibold">{t('Analizar')}</h2>

        <div className="mt-3 min-h-0 flex-1 overflow-auto">
          {!numericApplies ? (
            <p className="text-xs text-neutral-500" data-testid="analysis-no-numeric">
              {t('Este cuaderno registra la calificación en términos cualitativos, así que la distribución numérica no se aplica.')}
            </p>
          ) : (
            <>
              <p className="text-xs text-neutral-500">
                {tx('{n} calificaciones · media {mean} · mediana {median} · aprueban {rate} %', {
                  n: dist.n, mean: dist.mean, median: dist.median, rate: Math.round(dist.passRate * 100),
                })}
              </p>

              <div className="mt-3 flex items-end gap-2" data-testid="analysis-distribution">
                {dist.buckets.map((bucket) => (
                  <div key={bucket.label} className="flex flex-1 flex-col items-center gap-1">
                    <div className="w-full rounded-t bg-indigo-600/15" style={{ height: `${(bucket.count / maxBucket) * 90 + 4}px` }} />
                    <span className="text-[10px] text-neutral-500">{bucket.label}</span>
                    <span className="text-[10px] font-medium">{bucket.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {stats.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-semibold">{t('Análisis de preguntas')}</h3>
              <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400" data-testid="analysis-convention">
                {tx('Dificultad: proporción de la puntuación obtenida, así que un valor ALTO significa pregunta FÁCIL. Grupos extremos: {pct} %.',
                  { pct: Math.round(EXTREME_GROUP_FRACTION * 100) })}
              </p>
              <table className="mt-2 w-full border-collapse text-xs" data-testid="analysis-items">
                <thead className="study-browser-table-head">
                  <tr className="text-left">
                    <th className="px-2 py-1 font-medium">{t('Pregunta')}</th>
                    <th className="w-[50px] px-2 py-1 text-right font-medium" title={t('Alumnado con nota en esta pregunta')}>n</th>
                    <th className="w-[70px] px-2 py-1 text-right font-medium">{t('Media')}</th>
                    <th className="w-[90px] px-2 py-1 text-right font-medium">{t('Dificultad')}</th>
                    <th className="w-[110px] px-2 py-1 text-right font-medium">{t('Discriminación')}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((row) => (
                    <tr key={row.itemId} className="border-t border-neutral-200 dark:border-neutral-800/60">
                      <td className="max-w-[220px] truncate px-2 py-1">{row.name}</td>
                      <td className="px-2 py-1 text-right text-neutral-500">{row.n}</td>
                      <td className="px-2 py-1 text-right text-neutral-500">{row.mean}</td>
                      <td className="px-2 py-1 text-right">{row.difficulty}</td>
                      {/* A discrimination computed from one student, or from a group with
                          no marks, is arithmetic without meaning. Showing "—" beats
                          labelling a perfectly good question "mala discriminación". */}
                      <td className={`px-2 py-1 text-right ${
                        row.reliable && (row.discriminationBand === 'muy_mala' || row.discriminationBand === 'mala')
                          ? 'text-red-500' : ''}`}
                        data-testid={`analysis-discrimination-${row.itemId}`}>
                        {row.reliable
                          ? row.discrimination
                          : <span className="text-neutral-500" title={t('Datos insuficientes para interpretar este valor.')}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[10px] text-neutral-500">
                {t('Bandas según Baladrón y otros (FEM, 2016) y la guía SEDEM (2014).')}
              </p>
            </>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button className="btn btn-primary" data-testid="analysis-close" onClick={onClose}>{t('Cerrar')}</button>
        </div>
      </section>
    </ModalBackdrop>
  );
}

function ExportModal({ onCancel, onExport }: { onCancel: () => void; onExport: (format: 'pdf' | 'docx' | 'csv' | 'xlsx') => Promise<void> }) {
  return (
    <ModalBackdrop onClose={onCancel}>
      <section className="card-modal w-full max-w-sm p-5" role="dialog" aria-modal="true"
        aria-label={t('Exportar')} data-testid="export-modal">
        <h2 className="text-base font-semibold">{t('Exportar')}</h2>
        <p className="mt-1 text-xs text-neutral-500">{t('El acta lleva los nombres: es un documento para el centro.')}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {(['pdf', 'docx', 'csv', 'xlsx'] as const).map((format) => (
            <button key={format} className="btn btn-ghost h-9" data-testid={`export-${format}`}
              onClick={() => void onExport(format)}>{format.toUpperCase()}</button>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button className="btn btn-ghost" onClick={onCancel}>{t('Cancelar')}</button>
        </div>
      </section>
    </ModalBackdrop>
  );
}

function rowLabel(row: { cells: Record<string, string | null> } | undefined): string {
  if (!row) return '';
  return [row.cells[GRID_COL.givenNames], row.cells[GRID_COL.surnames]].filter(Boolean).join(' ')
    || String(row.cells[GRID_COL.code] ?? '');
}

/** Advisory copy. Each string is inline so the i18n coverage test can see it. */
function warningText(warning: { code: string; detail: Record<string, number | string>; source: string }): string {
  const base = (() => {
    switch (warning.code) {
      case 'weights_not_100':
        return tx('Los pesos de un bloque suman {sum} en lugar de 100.', { sum: Math.round(Number(warning.detail.sum) * 100) / 100 });
      case 'min_above_cap':
        return t('Una nota mínima para promediar supera el límite que has configurado.');
      case 'non_recoverable_above_cap':
        return t('La parte no recuperable supera el límite que has configurado.');
      case 'unequal_sibling_weights':
        return t('Hay criterios hermanos con pesos distintos.');
      case 'empty_plan':
        return t('Este cuaderno todavía no tiene bloques de evaluación.');
      default:
        return '';
    }
  })();
  return warning.source ? `${base} ${warning.source}` : base;
}

/* ------------------------------------------------------------------ modals --- */

/**
 * The derivation, in the order it happened.
 *
 * This is the panel that answers a reclamación: it names every part, the weight it
 * really carried, and every rule that changed the outcome.
 */
function ExplainModal({
  name, result, rules, onClose, onDownload,
}: {
  name: string;
  result: { raw: number | null; record: { numeric: number | null; qualitative: string | null }; trace: TraceNode | null; rules: TraceRule[] } | undefined;
  /** The whole rule set: the scale's minimum is not always 0, so `toScale` is needed. */
  rules: PlanRules;
  onClose: () => void;
  onDownload?: () => Promise<void>;
}) {
  if (!result) return null;
  const renderNode = (node: TraceNode, depth: number) => (
    <div key={node.itemId} style={{ paddingLeft: depth * 14 }} className="border-b border-neutral-200 py-1.5 last:border-0 dark:border-neutral-800/60">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate">{node.name || '—'}</span>
        {node.effectiveWeight > 0 && node.effectiveWeight <= 1 && (
          <span className="shrink-0 text-[10px] text-neutral-500">{Math.round(node.effectiveWeight * 100)}%</span>
        )}
        <span className="w-12 shrink-0 text-right font-medium">
          {node.fraction == null ? '—' : Math.round(toScale(node.fraction, rules) * 100) / 100}
        </span>
      </div>
      {node.rules.map((rule, index) => (
        <p key={index} className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-400">{ruleText(rule)}</p>
      ))}
      {node.children.map((child) => renderNode(child, depth + 1))}
    </div>
  );

  return (
    <ModalBackdrop onClose={onClose}>
      <section className="card-modal flex max-h-[80vh] w-full max-w-xl flex-col p-5" role="dialog" aria-modal="true"
        aria-label={t('Cómo se ha calculado')} data-testid="explain-modal">
        <h2 className="text-base font-semibold">{t('Cómo se ha calculado')}</h2>
        <p className="mt-1 text-xs text-neutral-500">{name}</p>
        <div className="mt-4 min-h-0 flex-1 overflow-auto text-xs">
          {result.trace && renderNode(result.trace, 0)}
        </div>
        {result.rules.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
            {result.rules.map((rule, index) => <p key={index}>{ruleText(rule)}</p>)}
          </div>
        )}
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm">
            {t('Calificación')}: <strong data-testid="explain-final">{result.record.numeric ?? result.record.qualitative ?? '—'}</strong>
          </span>
          <span className="flex gap-2">
            {onDownload && (
              <button className="btn btn-ghost" data-testid="explain-download" onClick={() => void onDownload()}>
                <Icon name="download" size={13} />{t('Boletín')}
              </button>
            )}
            <button className="btn btn-ghost" onClick={onClose}>{t('Cerrar')}</button>
          </span>
        </div>
      </section>
    </ModalBackdrop>
  );
}

function ruleText(rule: TraceRule): string {
  const d = rule.detail ?? {};
  switch (rule.code) {
    case 'excluded_not_assessed': return t('Sin evaluar todavía: no penaliza y se reparte su peso.');
    case 'excluded_exempt': return t('Exento: no cuenta ni a favor ni en contra.');
    case 'not_submitted_as_value': return tx('No entregado: cuenta como {value}.', { value: String(d.value ?? 0) });
    case 'not_submitted_excluded': return t('No entregado: se excluye del cálculo.');
    case 'renormalized': return tx('Se han repartido los pesos de {dropped} elementos sin evaluar.', { dropped: String(d.dropped ?? 0) });
    case 'min_not_met': return t('No se alcanza la nota mínima exigida para promediar.');
    case 'mandatory_failed': return t('Hay una parte obligatoria sin superar.');
    case 'conditional_mean_refused': return t('No se hace media porque alguna parte no llega al mínimo.');
    case 'ratchet_applied': return t('Se conserva la nota anterior, que era más alta.');
    case 'capped': return tx('Calificación limitada a {to}.', { to: String(d.to ?? '') });
    case 'rounded': return tx('Redondeado de {from} a {to}.', { from: String(d.from ?? ''), to: String(d.to ?? '') });
    case 'group_max_missing': return t('Sin referencia del grupo todavía para escalar esta columna.');
    case 'manual_override': return t('Valor fijado a mano por el docente.');
    case 'no_data': return t('Sin datos suficientes.');
    default: return '';
  }
}

function NewPlanModal({
  workspace, onCancel, onCreate,
}: {
  workspace: StudyWorkspace;
  onCancel: () => void;
  onCreate: (input: { name: string; subjectId: string; academicYearId: string | null; profile: string }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [subjectId, setSubjectId] = useState(workspace.subjects[0]?.id ?? '');
  const [academicYearId, setAcademicYearId] = useState(workspace.academicYears[0]?.id ?? '');
  const [profile, setProfile] = useState(ASSESSMENT_PROFILES[0].id);
  const [busy, setBusy] = useState(false);
  const chosen = ASSESSMENT_PROFILES.find((p) => p.id === profile);

  return (
    <ModalBackdrop onClose={onCancel}>
      <section className="card-modal w-full max-w-lg p-5" role="dialog" aria-modal="true" aria-label={t('Nuevo cuaderno')} data-testid="plan-new-modal">
        <h2 className="text-base font-semibold">{t('Nuevo cuaderno')}</h2>
        <p className="mt-1 text-xs text-neutral-500">{t('Elige un modelo de partida. Todas sus reglas se pueden cambiar después.')}</p>

        <label className="mt-4 block text-xs font-medium">{t('Nombre')}</label>
        <input className="input mt-1 w-full" data-testid="plan-name" autoFocus value={name}
          placeholder={t('Por ejemplo, Historia 2024/2025')} onChange={(e) => setName(e.target.value)} />

        <label className="mt-3 block text-xs font-medium">{t('Asignatura')}</label>
        <select className="input mt-1 w-full" data-testid="plan-subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          {workspace.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <label className="mt-3 block text-xs font-medium">{t('Curso académico')}</label>
        <select className="input mt-1 w-full" data-testid="plan-year" value={academicYearId} onChange={(e) => setAcademicYearId(e.target.value)}>
          {workspace.academicYears.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
          <option value="">{t('Sin curso académico')}</option>
        </select>

        <label className="mt-3 block text-xs font-medium">{t('Modelo de evaluación')}</label>
        <select className="input mt-1 w-full" data-testid="plan-profile" value={profile} onChange={(e) => setProfile(e.target.value)}>
          {ASSESSMENT_PROFILES.map((p) => <option key={p.id} value={p.id}>{t(p.label)}</option>)}
        </select>
        {chosen && <p className="mt-1 text-[11px] text-neutral-500">{t(chosen.hint)}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onCancel}>{t('Cancelar')}</button>
          <button className="btn btn-primary" data-testid="plan-create" disabled={busy || !subjectId}
            onClick={() => { setBusy(true); void onCreate({ name: name.trim() || t('Cuaderno'), subjectId, academicYearId: academicYearId || null, profile }).finally(() => setBusy(false)); }}>
            {busy ? t('Creando…') : t('Crear cuaderno')}
          </button>
        </div>
      </section>
    </ModalBackdrop>
  );
}
