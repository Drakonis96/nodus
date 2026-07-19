import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StudyWorkspace } from '@shared/studyOrg';
import {
  MAX_RUBRIC_CRITERIA,
  MAX_RUBRIC_LEVELS,
  RUBRIC_LANGUAGES,
  RUBRIC_LEVEL_PRESETS,
  RUBRIC_SCALES,
  buildRubricLevels,
  distributeLevelScores,
  emptyRubricCriterion,
  equaliseRubricWeights,
  matchLevelPreset,
  rubricMaxScore,
  rubricWeightTotal,
  validateRubric,
  type RubricCriterion,
  type RubricLanguage,
  type TeachingRubric,
} from '@shared/teachingRubrics';
import { nextIdFor } from '@shared/sequentialIds';
import { renderRubricHtml } from '@shared/rubricHtml';
import { Icon, Spinner } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { t, errorText, getActiveLang } from '../i18n';

const LANGUAGE_LABELS: Record<RubricLanguage, string> = {
  es: 'Español', en: 'English', fr: 'Français', de: 'Deutsch', pt: 'Português', 'pt-BR': 'Português (Brasil)',
};

export function RubricsView() {
  const [rubrics, setRubrics] = useState<TeachingRubric[]>([]);
  const [rubric, setRubric] = useState<TeachingRubric | null>(null);
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyCell, setBusyCell] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'docx' | 'pdf' | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TeachingRubric | null>(null);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  const reload = useCallback(async () => setRubrics(await window.nodus.listTeachingRubrics()), []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [list, ws] = await Promise.all([window.nodus.listTeachingRubrics(), window.nodus.getStudyWorkspace()]);
        if (!active) return;
        setRubrics(list);
        setWorkspace(ws);
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
    const timer = window.setTimeout(() => setMessage(''), 4000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const subjects = workspace?.subjects ?? [];
  const subjectName = (id: string | null) => subjects.find((entry) => entry.id === id)?.name ?? t('Sin asignatura');

  const patch = async (changes: Parameters<typeof window.nodus.updateTeachingRubric>[1]) => {
    if (!rubric) return;
    try {
      const next = await window.nodus.updateTeachingRubric(rubric.id, changes);
      setRubric(next);
      void reload();
    } catch (cause) { setError(errorText(cause)); }
  };

  const createRubric = async () => {
    try {
      const created = await window.nodus.createTeachingRubric({ title: t('Rúbrica sin título'), language: getActiveLang() as RubricLanguage });
      await reload();
      setRubric(created);
    } catch (cause) { setError(errorText(cause)); }
  };

  const fillCell = async (criterionId: string, levelId: string) => {
    if (!rubric) return;
    const key = `${criterionId}:${levelId}`;
    setBusyCell(key);
    setError('');
    try {
      const result = await window.nodus.fillRubricCell({ rubricId: rubric.id, criterionId, levelId });
      setRubric(await window.nodus.setTeachingRubricCell(rubric.id, criterionId, levelId, result.text));
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusyCell(null); }
  };

  const issues = useMemo(() => (rubric ? validateRubric(rubric) : []), [rubric]);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const previewHtml = useMemo(() => (rubric ? renderRubricHtml(rubric, { forPreview: true }) : ''), [rubric]);

  const exportRubric = async (format: 'docx' | 'pdf') => {
    if (!rubric) return;
    setExporting(format);
    try {
      const result = await window.nodus.exportTeachingRubric(rubric.id, format, { includeScores: true, includeScoreColumn: true });
      if (result) setMessage(t('Rúbrica descargada.'));
    } catch (cause) { setError(errorText(cause)); }
    finally { setExporting(null); }
  };

  if (loading) return <div className="grid h-full place-items-center"><Spinner label={t('Cargando rúbricas…')} /></div>;

  /* ------------------------------------------------ history (database list) --- */
  if (!rubric) {
    const filtered = rubrics.filter((entry) => !search.trim() || entry.title.toLowerCase().includes(search.toLowerCase()));
    return (
      <div className="flex h-full min-h-0 flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="rubrics-list">
        <header className="border-b border-neutral-200 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex flex-wrap items-center gap-3">
            <div className="mr-auto">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-600 dark:text-teal-400">{t('Evaluación')}</p>
              <h1 className="text-xl font-semibold">{t('Rúbricas')}</h1>
              <p className="mt-1 text-xs text-neutral-500">{t('Crea rúbricas de evaluación por criterios y niveles, con ayuda de la IA.')}</p>
            </div>
            <button data-testid="rubric-new" className="btn btn-primary" onClick={() => void createRubric()}><Icon name="plus" />{t('Nueva rúbrica')}</button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input className="input h-8 min-w-56 flex-1 text-xs" placeholder={t('Buscar rúbricas…')} value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {error && <p className="px-5 pt-3 text-sm text-red-500">{error}</p>}
          {filtered.length === 0 ? (
            <div className="mx-auto mt-12 max-w-md rounded-xl border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-800">
              <Icon name="table" size={26} className="mx-auto mb-3 text-neutral-400" />
              <p className="text-sm text-neutral-500">{t('Todavía no has creado ninguna rúbrica.')}</p>
            </div>
          ) : (
            <table className="w-full min-w-[820px] border-collapse text-xs" data-testid="rubric-table">
              <thead className="study-browser-table-head sticky top-0 z-10">
                <tr className="text-left">
                  <th className="w-[320px] px-4 py-2 font-medium">{t('Rúbrica')}</th>
                  <th className="px-3 py-2 font-medium">{t('Asignatura')}</th>
                  <th className="px-3 py-2 font-medium">{t('Criterios')}</th>
                  <th className="px-3 py-2 font-medium">{t('Niveles')}</th>
                  <th className="px-3 py-2 font-medium">{t('Máximo')}</th>
                  <th className="px-3 py-2 font-medium">{t('Actualizada')}</th>
                  <th className="w-[110px] px-3 py-2 text-right font-medium">{t('Acciones')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr
                    key={entry.id}
                    data-testid={`rubric-row-${entry.id}`}
                    className="cursor-pointer border-b border-neutral-200 hover:bg-neutral-100 dark:border-neutral-800/60 dark:hover:bg-neutral-900/40"
                    onClick={() => void window.nodus.getTeachingRubric(entry.id).then(setRubric).catch((cause) => setError(errorText(cause)))}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex max-w-[310px] items-center gap-2">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-600/15 text-indigo-300"><Icon name="table" size={15} /></span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-neutral-800 dark:text-neutral-200">{entry.title}</span>
                          <span className="block truncate text-[10px] text-neutral-500 dark:text-neutral-600">{entry.description || entry.shortId}</span>
                        </span>
                      </div>
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-2.5 text-neutral-500">{subjectName(entry.subjectId)}</td>
                    <td className="px-3 py-2.5 text-neutral-500">{entry.criteria.length}</td>
                    <td className="px-3 py-2.5 text-neutral-500">{entry.levels.length}</td>
                    <td className="px-3 py-2.5 text-neutral-500">{rubricMaxScore(entry)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-neutral-500">{new Date(entry.updatedAt).toLocaleDateString(getActiveLang())}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button className="btn btn-ghost h-7 w-7 p-0" title={t('Duplicar')} aria-label={t('Duplicar')} onClick={(event) => { event.stopPropagation(); void window.nodus.duplicateTeachingRubric(entry.id).then(reload); }}><Icon name="copy" size={12} /></button>
                      <button className="btn btn-ghost h-7 w-7 p-0 text-red-500" title={t('Eliminar')} aria-label={t('Eliminar')} onClick={(event) => { event.stopPropagation(); setPendingDelete(entry); }}><Icon name="trash" size={12} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {pendingDelete && (
          <ConfirmModal
            title={t('Eliminar rúbrica')}
            message={t('Se eliminará esta rúbrica. Esta acción no se puede deshacer.')}
            confirmLabel={t('Eliminar')}
            danger
            onConfirm={async () => { await window.nodus.deleteTeachingRubric(pendingDelete.id); setPendingDelete(null); void reload(); }}
            onCancel={() => setPendingDelete(null)}
          />
        )}
      </div>
    );
  }

  /* ------------------------------------------------------------- editor ---- */
  const weightTotal = rubricWeightTotal(rubric.criteria);
  const setCriteria = (criteria: RubricCriterion[]) => setRubric({ ...rubric, criteria });

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="rubric-editor">
      <header className="border-b border-neutral-200 bg-white px-5 py-3 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-ghost h-8 px-2" onClick={() => { setRubric(null); void reload(); }} aria-label={t('Volver')} title={t('Volver')}><Icon name="chevronLeft" /></button>
          <input
            data-testid="rubric-title"
            className="input h-9 min-w-56 flex-1 text-sm font-semibold"
            value={rubric.title}
            onChange={(event) => setRubric({ ...rubric, title: event.target.value })}
            onBlur={(event) => void patch({ title: event.target.value })}
            aria-label={t('Título de la rúbrica')}
          />
          <label className="flex items-center gap-1.5 text-xs text-neutral-500">
            <span className="whitespace-nowrap">{t('Asignatura')}</span>
            <select
              data-testid="rubric-subject"
              className="input h-9 min-w-[11rem] max-w-[16rem] text-xs"
              value={rubric.subjectId ?? ''}
              onChange={(event) => {
                const subjectId = event.target.value || null;
                const subject = subjects.find((entry) => entry.id === subjectId);
                void patch({ subjectId, courseId: subject?.courseId ?? null });
              }}
            >
              <option value="">{t('Sin asignatura')}</option>
              {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </select>
          </label>
          <button className="btn btn-ghost h-9" onClick={() => setGeneratorOpen(true)} data-testid="rubric-generate-open"><Icon name="wand" size={13} />{t('Generar con IA')}</button>
          <button className="btn btn-ghost h-9" disabled={exporting !== null} onClick={() => void exportRubric('docx')}>{exporting === 'docx' ? <Icon name="sync" className="animate-spin" /> : <Icon name="download" />}Word</button>
          <button className="btn btn-primary h-9" disabled={exporting !== null} onClick={() => void exportRubric('pdf')} data-testid="rubric-export-pdf">{exporting === 'pdf' ? <Icon name="sync" className="animate-spin" /> : <Icon name="download" />}PDF</button>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-neutral-500">
          <span className="whitespace-nowrap">{rubric.criteria.length} {t('criterios')} · {rubric.levels.length} {t('niveles')} · {t('máximo')} {rubricMaxScore(rubric)}</span>
          <label className="flex items-center gap-1.5"><span className="whitespace-nowrap">{t('Escala')}</span>
            <select className="input h-8 min-w-[6rem] text-xs" value={rubric.scaleMax} onChange={(event) => {
              const scaleMax = Number(event.target.value);
              const scores = distributeLevelScores(rubric.levels.length, scaleMax);
              void patch({ scaleMax, levels: rubric.levels.map((level, index) => ({ ...level, score: scores[index] })) });
            }}>
              {RUBRIC_SCALES.map((scale) => <option key={scale} value={scale}>0–{scale}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5"><span className="whitespace-nowrap">{t('Idioma')}</span>
            <select className="input h-8 min-w-[9rem] text-xs" value={rubric.language} onChange={(event) => {
              const language = event.target.value as RubricLanguage;
              // Column names that are still an untouched preset follow the document
              // language; anything the teacher renamed is left exactly as written.
              const preset = matchLevelPreset(rubric.levels, rubric.language);
              void patch(preset
                ? { language, levels: buildRubricLevels(preset, language, rubric.scaleMax) }
                : { language });
            }}>
              {RUBRIC_LANGUAGES.map((code) => <option key={code} value={code}>{LANGUAGE_LABELS[code]}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" className="accent-indigo-500" checked={rubric.weighted} onChange={(event) => void patch({ weighted: event.target.checked, criteria: event.target.checked ? equaliseRubricWeights(rubric.criteria) : rubric.criteria })} />
            {t('Ponderar criterios')}
          </label>
          {rubric.weighted && (
            <span className={Math.abs(weightTotal - 100) > 0.5 ? 'text-amber-600 dark:text-amber-400' : ''}>
              {t('Pesos')}: {weightTotal}%
              {Math.abs(weightTotal - 100) > 0.5 && (
                <button className="ml-1 underline" onClick={() => void patch({ criteria: equaliseRubricWeights(rubric.criteria) })}>{t('repartir')}</button>
              )}
            </span>
          )}
          <button className="btn btn-ghost h-7 px-2" onClick={() => setShowPreview((value) => !value)}>{showPreview ? t('Ocultar vista previa') : t('Vista previa')}</button>
          {errors.length > 0 && <span className="text-red-500"><Icon name="alert" size={12} /> {errors.length}</span>}
          {warnings.length > 0 && <span className="text-amber-600 dark:text-amber-400"><Icon name="alert" size={12} /> {warnings.length} {t('sugerencias')}</span>}
          {message && <span className="text-emerald-600 dark:text-emerald-400">{message}</span>}
          {error && <span className="text-red-500">{error}</span>}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {/* Table-wide actions live above the grid: the preset names are long, and a
            dropdown squeezed into the 14rem criterion column clipped every one of them. */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-neutral-500">
            <span className="whitespace-nowrap">{t('Conjunto de niveles')}</span>
            <select
              data-testid="rubric-level-preset"
              className="input h-8 min-w-[15rem] text-xs"
              value=""
              aria-label={t('Aplicar conjunto de niveles')}
              onChange={(event) => {
                if (!event.target.value) return;
                void patch({ levels: buildRubricLevels(event.target.value, rubric.language, rubric.scaleMax) });
              }}
            >
              <option value="">{t('Conjunto de niveles…')}</option>
              {RUBRIC_LEVEL_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{t(preset.label)}</option>)}
            </select>
          </label>
        </div>

        {/* ---- the grid ---- */}
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/40">
          <table className="w-full min-w-[900px] table-fixed border-collapse text-xs" data-testid="rubric-grid">
            <thead>
              <tr>
                <th className="w-[22%] border-b border-r border-neutral-200 p-2.5 text-left align-bottom dark:border-neutral-800">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-500">{t('Criterio')}</span>
                </th>
                {rubric.levels.map((level, index) => (
                  <th
                    key={level.id}
                    // Auto layout distributes by content and left the first level column
                    // markedly narrower than the rest; an explicit share keeps them even.
                    style={{ width: `${75 / rubric.levels.length}%` }}
                    className="min-w-[9rem] border-b border-r border-neutral-200 p-2.5 text-left last:border-r-0 dark:border-neutral-800"
                  >
                    <input
                      className="input h-8 w-full text-xs font-semibold"
                      value={level.label}
                      aria-label={t('Nombre del nivel')}
                      onChange={(event) => setRubric({ ...rubric, levels: rubric.levels.map((entry, i) => (i === index ? { ...entry, label: event.target.value } : entry)) })}
                      onBlur={() => void patch({ levels: rubric.levels })}
                    />
                    <div className="mt-1 flex items-center gap-1">
                      <input
                        className="input h-7 w-[4.75rem] px-2 text-xs"
                        type="number" min="0" step="0.5" value={level.score}
                        aria-label={t('Puntuación del nivel')}
                        onChange={(event) => setRubric({ ...rubric, levels: rubric.levels.map((entry, i) => (i === index ? { ...entry, score: Number(event.target.value) } : entry)) })}
                        onBlur={() => void patch({ levels: rubric.levels })}
                      />
                      {rubric.levels.length > 2 && (
                        <button className="btn btn-ghost h-6 w-6 p-0 text-red-500" title={t('Quitar nivel')} aria-label={t('Quitar nivel')}
                          onClick={() => void patch({ levels: rubric.levels.filter((_, i) => i !== index) })}><Icon name="x" size={10} /></button>
                      )}
                    </div>
                  </th>
                ))}
                <th className="w-[3%] border-b border-neutral-200 p-1 align-top dark:border-neutral-800">
                  {rubric.levels.length < MAX_RUBRIC_LEVELS && (
                    <button data-testid="rubric-add-level" className="btn btn-ghost h-7 w-7 p-0" title={t('Añadir nivel')} aria-label={t('Añadir nivel')}
                      onClick={() => {
                        const next = [...rubric.levels, { id: nextIdFor('L', rubric.levels), label: '', score: 0 }];
                        const scores = distributeLevelScores(next.length, rubric.scaleMax);
                        void patch({ levels: next.map((level, i) => ({ ...level, score: scores[i] })) });
                      }}><Icon name="plus" size={12} /></button>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {rubric.criteria.map((criterion, rowIndex) => (
                <tr key={criterion.id} data-testid={`rubric-criterion-${rowIndex}`}>
                  <td className="border-b border-r border-neutral-200 p-2.5 align-top dark:border-neutral-800">
                    <input
                      className="input h-8 w-full text-xs font-medium"
                      placeholder={t('Nombre del criterio')}
                      value={criterion.name}
                      onChange={(event) => setCriteria(rubric.criteria.map((entry, i) => (i === rowIndex ? { ...entry, name: event.target.value } : entry)))}
                      onBlur={() => void patch({ criteria: rubric.criteria })}
                    />
                    <input
                      className="input mt-1.5 h-7 w-full text-[11px]"
                      placeholder={t('Aclaración (opcional)')}
                      value={criterion.description}
                      onChange={(event) => setCriteria(rubric.criteria.map((entry, i) => (i === rowIndex ? { ...entry, description: event.target.value } : entry)))}
                      onBlur={() => void patch({ criteria: rubric.criteria })}
                    />
                    <div className="mt-1.5 flex items-center gap-1">
                      {rubric.weighted && (
                        <label className="flex items-center gap-1 text-[10px] text-neutral-500">
                          <input className="input h-7 w-16 px-2 text-[11px]" type="number" min="0" max="100" value={criterion.weight}
                            aria-label={t('Peso del criterio')}
                            onChange={(event) => setCriteria(rubric.criteria.map((entry, i) => (i === rowIndex ? { ...entry, weight: Number(event.target.value) } : entry)))}
                            onBlur={() => void patch({ criteria: rubric.criteria })} />%
                        </label>
                      )}
                      <button className="btn btn-ghost ml-auto h-6 w-6 p-0 text-red-500" title={t('Quitar criterio')} aria-label={t('Quitar criterio')}
                        onClick={() => void patch({ criteria: rubric.criteria.filter((_, i) => i !== rowIndex) })}><Icon name="trash" size={11} /></button>
                    </div>
                  </td>
                  {rubric.levels.map((level) => {
                    const key = `${criterion.id}:${level.id}`;
                    const cellIssues = issues.filter((issue) => issue.criterionId === criterion.id && issue.levelId === level.id);
                    return (
                      <td key={level.id} className="border-b border-r border-neutral-200 p-2 align-top last:border-r-0 dark:border-neutral-800">
                        <div className="relative">
                          <textarea
                            data-testid={`rubric-cell-${rowIndex}-${level.id}`}
                            className={`input input-autosize input-with-trailing-action min-h-[5.25rem] max-h-64 w-full resize-y text-[11px] leading-5 ${cellIssues.length ? 'border-amber-500/60' : ''}`}
                            placeholder={t('Descriptor…')}
                            value={criterion.cells[level.id] ?? ''}
                            onChange={(event) => setCriteria(rubric.criteria.map((entry, i) => (i === rowIndex ? { ...entry, cells: { ...entry.cells, [level.id]: event.target.value } } : entry)))}
                            onBlur={() => void patch({ criteria: rubric.criteria })}
                          />
                          <button
                            data-testid={`rubric-cell-ai-${rowIndex}-${level.id}`}
                            className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md bg-neutral-200/80 text-indigo-600 hover:bg-indigo-600/20 dark:bg-neutral-900/70 dark:text-indigo-400"
                            title={t('Redactar este descriptor con IA')}
                            aria-label={t('Redactar este descriptor con IA')}
                            disabled={busyCell === key}
                            onClick={() => void fillCell(criterion.id, level.id)}
                          >
                            {busyCell === key ? <Icon name="sync" size={11} className="animate-spin" /> : <Icon name="wand" size={11} />}
                          </button>
                        </div>
                        {cellIssues.map((issue) => (
                          <p key={issue.message} className="mt-0.5 text-[9px] leading-3 text-amber-600 dark:text-amber-400">{t(issue.message)}</p>
                        ))}
                      </td>
                    );
                  })}
                  <td className="border-b border-neutral-200 dark:border-neutral-800" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {rubric.criteria.length < MAX_RUBRIC_CRITERIA && (
            <button data-testid="rubric-add-criterion" className="btn btn-primary" onClick={() => void patch({ criteria: [...rubric.criteria, emptyRubricCriterion(nextIdFor('C', rubric.criteria))] })}>
              <Icon name="plus" />{t('Añadir criterio')}
            </button>
          )}
        </div>

        {/* ---- quality suggestions ---- */}
        {issues.filter((issue) => !issue.levelId).length > 0 && (
          <section className="card mt-4 p-3" data-testid="rubric-issues">
            <h2 className="text-xs font-semibold">{t('Revisión de calidad')}</h2>
            <ul className="mt-2 space-y-1">
              {issues.filter((issue) => !issue.levelId).map((issue, index) => (
                <li key={`${issue.message}-${index}`} className={`text-[11px] ${issue.severity === 'error' ? 'text-red-500' : 'text-amber-600 dark:text-amber-400'}`}>
                  <Icon name="alert" size={10} /> {t(issue.message)}
                </li>
              ))}
            </ul>
          </section>
        )}

        {showPreview && (
          <section className="mt-4">
            <p className="mb-2 flex items-center gap-2 text-xs text-neutral-500"><Icon name="book" size={13} />{t('Vista previa')}</p>
            <iframe data-testid="rubric-preview" title={t('Vista previa')} className="h-[520px] w-full rounded-xl border border-neutral-200 bg-neutral-100 dark:border-neutral-800" sandbox="" srcDoc={previewHtml} />
          </section>
        )}
      </div>

      {generatorOpen && (
        <RubricGenerator
          rubric={rubric}
          onClose={() => setGeneratorOpen(false)}
          onGenerated={async (next) => {
            setRubric(next);
            setGeneratorOpen(false);
            setMessage(t('Rúbrica generada. Revísala antes de usarla.'));
            void reload();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------ AI generator modal --- */

function RubricGenerator({ rubric, onClose, onGenerated, onError }: {
  rubric: TeachingRubric;
  onClose: () => void;
  onGenerated: (rubric: TeachingRubric) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [file, setFile] = useState<{ filePath: string; name: string } | null>(null);
  const [criteriaCount, setCriteriaCount] = useState(4);
  const [levelCount, setLevelCount] = useState(4);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const result = await window.nodus.generateRubric({
        source: file ? { kind: 'file', filePath: file.filePath } : { kind: 'prompt' },
        instruction,
        subjectId: rubric.subjectId,
        courseId: rubric.courseId,
        language: rubric.language,
        scaleMax: rubric.scaleMax,
        levelCount,
        criteriaCount,
        weighted: rubric.weighted,
      });
      const saved = await window.nodus.updateTeachingRubric(rubric.id, result.rubric);
      await onGenerated(saved);
    } catch (cause) {
      onError(errorText(cause));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[130] grid place-items-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="card-modal w-full max-w-lg p-5" role="dialog" aria-modal="true" aria-label={t('Generar rúbrica con IA')} data-testid="rubric-generator">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-600/15 text-indigo-300"><Icon name="wand" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">{t('Generar rúbrica con IA')}</h2>
            <p className="mt-1 text-xs text-neutral-500">{t('Describe la tarea o adjunta el documento con sus instrucciones. La IA propondrá criterios y descriptores que podrás editar.')}</p>
          </div>
          <button className="btn btn-ghost h-7 w-7 p-0" onClick={onClose} disabled={busy} aria-label={t('Cerrar')}><Icon name="x" size={13} /></button>
        </div>

        <label className="mt-4 block text-xs text-neutral-500">{t('Tarea que se va a evaluar')}
          <textarea data-testid="rubric-generator-instruction" className="input mt-1 min-h-20 w-full resize-y text-sm" value={instruction} onChange={(event) => setInstruction(event.target.value)}
            placeholder={t('Ej. Ensayo argumentativo de 1500 palabras sobre la Revolución Industrial, 2º de Bachillerato')} />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn btn-ghost h-8 text-xs" disabled={busy} onClick={() => void window.nodus.pickRubricSourceFile().then((picked) => { if (picked) setFile(picked); })}>
            <Icon name="book" size={13} />{t('Adjuntar documento de la tarea')}
          </button>
          {file && (
            <span className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1 text-[11px] dark:border-neutral-800">
              {file.name}
              <button className="text-neutral-500 hover:text-red-500" onClick={() => setFile(null)} aria-label={t('Quitar')}><Icon name="x" size={10} /></button>
            </span>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-xs text-neutral-500">{t('Número de criterios')}
            <input className="input mt-1 w-full" type="number" min="1" max={MAX_RUBRIC_CRITERIA} value={criteriaCount} onChange={(event) => setCriteriaCount(Number(event.target.value))} />
          </label>
          <label className="text-xs text-neutral-500">{t('Número de niveles')}
            <input className="input mt-1 w-full" type="number" min="2" max={MAX_RUBRIC_LEVELS} value={levelCount} onChange={(event) => setLevelCount(Number(event.target.value))} />
          </label>
        </div>
        <p className="mt-2 text-[10px] text-neutral-500">{t('Se recomiendan entre 3 y 6 criterios y 4 niveles.')}</p>

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('Cancelar')}</button>
          <button data-testid="rubric-generator-run" className="btn btn-primary" disabled={busy || (!instruction.trim() && !file)} onClick={() => void run()}>
            {busy ? <><Icon name="sync" className="animate-spin" />{t('Generando…')}</> : <><Icon name="wand" />{t('Generar')}</>}
          </button>
        </div>
      </section>
    </div>
  );
}
