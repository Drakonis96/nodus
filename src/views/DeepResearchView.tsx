import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AppSettings,
  DeepResearchMeta,
  DeepResearchProgress,
  DeepResearchSectionLimit,
  DeepResearchTargetLength,
  WritingWorkshopDraft,
  WritingWorkshopSavedDraft,
} from '@shared/types';
import type { PendingGraphNavigationTarget } from '../navigation';
import { Badge, Icon, modelLabel } from '../components/ui';
import { ModelPicker } from '../components/ModelPicker';
import { confirm } from '../components/feedback';
import type { MarkdownCitation } from '../components/Markdown';
import { SourceCitationModal, type CitationTarget } from '../components/SourceCitationModal';
import { SaveToNotesModal } from '../components/SaveToNotesModal';
import { DraftResultMain, Metric, SavedDraftsPanel, SupportMatrix } from './writingShared';
import { t, tx } from '../i18n';
import {
  DEEP_RESEARCH_MAIN_JOB_KEY,
  clearBackgroundJob,
  getBackgroundJob,
  startDeepResearchGeneration,
  subscribeBackgroundJob,
  type DeepResearchGenerationJob,
} from '../backgroundJobs';

const DEEP_TARGET_LABELS: Record<DeepResearchTargetLength, string> = {
  adaptive: 'Adaptativo (según corpus)',
  concise: 'Conciso (5–8 pág.)',
  standard: 'Estándar (9–14 pág.)',
  exhaustive: 'Exhaustivo (15–20 pág.)',
};

/** Options for the "max sections" selector. `'auto'` lets the model decide; numbers cap it. */
const DEEP_SECTION_OPTIONS: { value: DeepResearchSectionLimit; label: string }[] = [
  { value: 'auto', label: 'Secciones: Auto (IA decide)' },
  { value: 4, label: 'Máx. 4 secciones' },
  { value: 5, label: 'Máx. 5 secciones' },
  { value: 6, label: 'Máx. 6 secciones' },
  { value: 8, label: 'Máx. 8 secciones' },
  { value: 10, label: 'Máx. 10 secciones' },
];

function sectionLimitLabel(limit: DeepResearchSectionLimit): string {
  return limit === 'auto' ? t('Secciones: Auto') : tx('Máx. {n} secciones', { n: limit });
}

export function DeepResearchView({
  settings,
  onOpenGraph,
}: {
  settings: AppSettings;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
}) {
  const [objective, setObjective] = useState('');
  const [language, setLanguage] = useState<'es' | 'en' | 'fr'>('es');
  const [selectedModel, setSelectedModel] = useState(settings.synthesisModel ?? settings.defaultModel);
  const [deepTarget, setDeepTarget] = useState<DeepResearchTargetLength>('adaptive');
  const [deepSectionLimit, setDeepSectionLimit] = useState<DeepResearchSectionLimit>('auto');
  const [deepJob, setDeepJob] = useState<DeepResearchGenerationJob | null>(() =>
    getBackgroundJob(DEEP_RESEARCH_MAIN_JOB_KEY)
  );
  const appliedJobRef = useRef<string | null>(null);
  const [deepMeta, setDeepMeta] = useState<DeepResearchMeta | null>(null);
  const [draft, setDraft] = useState<WritingWorkshopDraft | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [savedDrafts, setSavedDrafts] = useState<WritingWorkshopSavedDraft[]>([]);
  const [loadingSavedDrafts, setLoadingSavedDrafts] = useState(false);
  const [reusingDraftId, setReusingDraftId] = useState<string | null>(null);
  const [citation, setCitation] = useState<CitationTarget>(null);
  const [savingToNotes, setSavingToNotes] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasModel = !!selectedModel;
  const deepRunning = deepJob?.status === 'running';
  const deepProgress = deepJob?.progress ?? null;

  useEffect(
    () => subscribeBackgroundJob(DEEP_RESEARCH_MAIN_JOB_KEY, setDeepJob),
    []
  );

  const refreshSavedDrafts = useCallback(async () => {
    setLoadingSavedDrafts(true);
    try {
      const all = await window.nodus.listWritingWorkshopDrafts();
      setSavedDrafts(all.filter((item) => item.brief.kind === 'deep_research'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingSavedDrafts(false);
    }
  }, []);

  useEffect(() => {
    void refreshSavedDrafts();
  }, [refreshSavedDrafts]);

  useEffect(() => {
    if (!deepJob) {
      appliedJobRef.current = null;
      return;
    }
    if (appliedJobRef.current !== deepJob.id) {
      appliedJobRef.current = deepJob.id;
      setObjective(deepJob.request.objective);
      setLanguage(deepJob.request.language ?? 'es');
      setDeepTarget(deepJob.request.targetLength ?? 'adaptive');
      setDeepSectionLimit(deepJob.request.sectionLimit ?? 'auto');
      setSelectedModel(deepJob.request.model ?? null);
      if (deepJob.status === 'running') {
        setDraft(null);
        setDraftSaved(false);
        setDeepMeta(null);
        setMessage(null);
      }
    }
    if (deepJob.status === 'running') {
      setError(null);
      return;
    }
    if (deepJob.status === 'failed') {
      setError(deepJob.error ?? t('No se pudo generar el informe.'));
      return;
    }
    if (deepJob.result) {
      const { report, savedDraft, saveError } = deepJob.result;
      setDraft(report.draft);
      setDeepMeta(report.meta);
      setDraftSaved(!!savedDraft);
      setError(saveError ? tx('Informe generado, pero no se pudo guardar automáticamente: {error}', { error: saveError }) : null);
      setMessage(
        saveError
          ? t('El informe está listo y puedes guardarlo manualmente.')
          : tx('Informe generado y guardado: {s} secciones · ~{p} páginas · {i} ideas citadas.', {
              s: report.meta.sections,
              p: report.meta.pages,
              i: report.meta.ideasCovered,
            })
      );
      if (savedDraft) {
        setSavedDrafts((current) => [savedDraft, ...current.filter((item) => item.id !== savedDraft.id)]);
      }
    }
  }, [deepJob]);

  const runDeepResearch = () => {
    if (!objective.trim()) {
      setError(t('Escribe la idea de investigación antes de generar el informe.'));
      return;
    }
    setError(null);
    setMessage(null);
    setDraft(null);
    setDraftSaved(false);
    setDeepMeta(null);
    startDeepResearchGeneration(DEEP_RESEARCH_MAIN_JOB_KEY, {
      objective,
      language,
      targetLength: deepTarget,
      sectionLimit: deepSectionLimit,
      model: selectedModel,
    });
  };

  const exportDraft = async (format: 'markdown' | 'pdf') => {
    if (!draft) return;
    setExporting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await window.nodus.exportWritingWorkshopDraft({ draft, format });
      if (result) setMessage(`${t('Exportado')}: ${result.path}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const copyDraft = async () => {
    if (!draft) return;
    await navigator.clipboard.writeText(draft.draftMarkdown);
    setMessage(t('Borrador copiado.'));
  };

  const saveDraft = async () => {
    if (!draft || savingDraft) return;
    setError(null);
    setMessage(null);
    setSavingDraft(true);
    try {
      const saved = await window.nodus.saveWritingWorkshopDraft({ draft, model: selectedModel });
      setSavedDrafts((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setDraftSaved(true);
      setMessage(t('Informe guardado localmente.'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingDraft(false);
    }
  };

  const openSavedDraft = (saved: WritingWorkshopSavedDraft) => {
    clearBackgroundJob(DEEP_RESEARCH_MAIN_JOB_KEY);
    setError(null);
    setMessage(t('Informe guardado abierto. Puedes exportarlo o reutilizar su idea para regenerarlo.'));
    setObjective(saved.brief.objective);
    if (saved.brief.language) setLanguage(saved.brief.language);
    setDraft(saved.draft);
    setDraftSaved(true);
    setDeepMeta(null);
    if (saved.model) setSelectedModel(saved.model);
  };

  const reuseSavedPrompt = (saved: WritingWorkshopSavedDraft) => {
    if (reusingDraftId) return;
    clearBackgroundJob(DEEP_RESEARCH_MAIN_JOB_KEY);
    setReusingDraftId(saved.id);
    setError(null);
    setObjective(saved.brief.objective);
    if (saved.brief.language) setLanguage(saved.brief.language);
    if (saved.model) setSelectedModel(saved.model);
    setDraft(null);
    setDraftSaved(false);
    setDeepMeta(null);
    setMessage(t('Idea reutilizada: ajusta los parámetros y genera un informe actualizado.'));
    setReusingDraftId(null);
  };

  const deleteSavedDraft = async (saved: WritingWorkshopSavedDraft) => {
    const ok = await confirm({
      title: t('Eliminar informe'),
      message: t('¿Eliminar este informe guardado? Esta acción no se puede deshacer.'),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    setError(null);
    setMessage(null);
    try {
      await window.nodus.deleteWritingWorkshopDraft(saved.id);
      setSavedDrafts((current) => current.filter((item) => item.id !== saved.id));
      setMessage(t('Informe eliminado.'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <header className="border-b border-neutral-800 p-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem]">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Icon name="compass" className="text-indigo-300" /> {t('Deep Research')}
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            {t('Informe académico de varias páginas, guiado por cobertura y con todas las fuentes citadas.')}
          </p>
        </div>
        <select
          className="input"
          value={deepTarget}
          disabled={deepRunning}
          onChange={(e) => {
            if (!deepRunning) clearBackgroundJob(DEEP_RESEARCH_MAIN_JOB_KEY);
            setDeepTarget(e.target.value as DeepResearchTargetLength);
          }}
          title={t('Extensión objetivo del informe')}
        >
          {Object.entries(DEEP_TARGET_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {t(label)}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={String(deepSectionLimit)}
          disabled={deepRunning}
          onChange={(e) => {
            if (!deepRunning) clearBackgroundJob(DEEP_RESEARCH_MAIN_JOB_KEY);
            setDeepSectionLimit(e.target.value === 'auto' ? 'auto' : (Number(e.target.value) as DeepResearchSectionLimit));
          }}
          title={t('Número máximo de secciones (menos secciones = mayor profundidad)')}
        >
          {DEEP_SECTION_OPTIONS.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {t(option.label)}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={language}
          disabled={deepRunning}
          onChange={(e) => {
            if (!deepRunning) clearBackgroundJob(DEEP_RESEARCH_MAIN_JOB_KEY);
            setLanguage(e.target.value as 'es' | 'en' | 'fr');
          }}
        >
          <option value="es">Español</option>
          <option value="en">English</option>
          <option value="fr">Français</option>
        </select>
        <ModelPicker
          settings={settings}
          value={selectedModel}
          onChange={(next) => {
            if (!deepRunning) clearBackgroundJob(DEEP_RESEARCH_MAIN_JOB_KEY);
            setSelectedModel(next);
          }}
          compact
          disabled={deepRunning}
        />
        <div className="flex-1" />
        <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={() => setShowTutorial((value) => !value)}>
          <Icon name="help" />
          {showTutorial ? t('Ocultar tutorial') : t('Tutorial')}
        </button>
        <button
          className="btn btn-primary gap-1.5"
          onClick={runDeepResearch}
          disabled={!hasModel || deepRunning || !objective.trim()}
          title={!hasModel ? t('Configura un modelo de síntesis') : undefined}
        >
          <Icon name={deepRunning ? 'sync' : 'compass'} className={deepRunning ? 'animate-spin' : ''} />
          {deepRunning ? t('Generando informe…') : t('Generar informe')}
        </button>
      </header>

      <div className="border-b border-neutral-800 p-3">
        <textarea
          className="input w-full min-h-20 resize-y"
          value={objective}
          disabled={deepRunning}
          onChange={(e) => {
            if (!deepRunning) clearBackgroundJob(DEEP_RESEARCH_MAIN_JOB_KEY);
            setObjective(e.target.value);
          }}
          placeholder={t('Escribe la idea o pregunta de investigación. El informe la desarrollará por completo, citando todas las obras del corpus.')}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <Badge color="green">{t('Cobertura del corpus completo')}</Badge>
          <Badge>{t(DEEP_TARGET_LABELS[deepTarget])}</Badge>
          <Badge>{sectionLimitLabel(deepSectionLimit)}</Badge>
          {selectedModel && <span>{t('Modelo:')} {modelLabel(selectedModel)}</span>}
          <span className="text-neutral-600">{t('Sin selección manual: el informe elige y cita las fuentes por ti.')}</span>
          {deepRunning && (
            <span className="text-indigo-300">
              {t('Puedes cambiar de sección: el informe seguirá en segundo plano y recuperarás este progreso al volver.')}
            </span>
          )}
        </div>
      </div>

      {showTutorial && <DeepResearchTutorial />}

      {(message || error) && (
        <div className={`px-4 py-2 text-sm border-b ${error ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200' : 'border-neutral-200 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400'}`}>
          {error ?? message}
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-[18rem_minmax(0,1fr)_20rem] max-xl:grid-cols-1">
        <aside className="border-r border-neutral-800 min-h-0 flex flex-col max-xl:border-r-0 max-xl:border-b">
          <DeepResearchPanel
            running={deepRunning}
            progress={deepProgress}
            meta={deepMeta}
            target={deepTarget}
            sectionLimit={deepSectionLimit}
          />
        </aside>

        <main className="min-h-0 overflow-y-auto p-5">
          {!draft && (
            <div className="h-full flex items-center justify-center">
              <div className="max-w-md text-center text-neutral-500 text-sm">
                {deepRunning
                  ? deepProgress?.message ?? t('Generando informe…')
                  : t('El informe aparecerá aquí. Escribe tu idea de investigación y pulsa «Generar informe».')}
              </div>
            </div>
          )}
          {draft && (
            <DraftResultMain
              draft={draft}
              exporting={exporting}
              savingDraft={savingDraft}
              draftSaved={draftSaved}
              onCopy={copyDraft}
              onSaveDraft={saveDraft}
              onSaveToNotes={() => setSavingToNotes(true)}
              onExport={(format) => void exportDraft(format)}
              onCitation={(c: MarkdownCitation) => setCitation(c)}
            />
          )}
        </main>

        <aside className="border-l border-neutral-800 min-h-0 overflow-y-auto p-4 max-xl:border-l-0 max-xl:border-t">
          <SavedDraftsPanel
            drafts={savedDrafts}
            loading={loadingSavedDrafts}
            reusingDraftId={reusingDraftId}
            onOpen={openSavedDraft}
            onReuse={reuseSavedPrompt}
            onDelete={(saved) => void deleteSavedDraft(saved)}
            onRefresh={() => void refreshSavedDrafts()}
          />
          <div className="my-4 border-t border-neutral-800" />
          <SupportMatrix draft={draft} onCitation={setCitation} />
        </aside>
      </div>

      {citation && (
        <SourceCitationModal
          target={citation}
          onClose={() => setCitation(null)}
          onOpenGraph={(target) => {
            setCitation(null);
            onOpenGraph(target);
          }}
        />
      )}

      {savingToNotes && draft && (
        <SaveToNotesModal
          content={`# ${draft.title}\n\n${draft.abstract ? `${draft.abstract}\n\n` : ''}${draft.draftMarkdown}`}
          defaultTitle={draft.title}
          kind="writing"
          source={{ origin: 'writing', model: selectedModel, ref: draft.brief.kind }}
          allowProjectLink
          onClose={() => setSavingToNotes(false)}
        />
      )}
    </div>
  );
}

function DeepResearchTutorial() {
  return (
    <section className="border-b border-neutral-800 bg-white/95 px-4 py-3 dark:bg-neutral-950/80">
      <div className="grid grid-cols-4 gap-3 max-2xl:grid-cols-2 max-md:grid-cols-1">
        <TutorialStep
          icon="edit"
          title={t('1. Plantea la idea')}
          body={t('Escribe la pregunta o idea de investigación que quieres desarrollar. El informe la convierte en un texto de varias páginas, no en una respuesta corta.')}
        />
        <TutorialStep
          icon="compass"
          title={t('2. Ajusta el alcance')}
          body={t('Elige la extensión objetivo y el número máximo de secciones. Menos secciones producen un texto más profundo; más secciones, uno más panorámico.')}
        />
        <TutorialStep
          icon="layers"
          title={t('3. Cobertura del corpus')}
          body={t('Nodus recorre todo el corpus indexado, planifica las secciones y redacta guiado por la cobertura, citando cada obra sin que tengas que seleccionarla.')}
        />
        <TutorialStep
          icon="download"
          title={t('4. Revisa y exporta')}
          body={t('Abre las citas para comprobar cada fuente, guarda el informe para retomarlo y expórtalo a Markdown o PDF cuando esté listo.')}
        />
      </div>
    </section>
  );
}

function TutorialStep({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-white p-3 shadow-sm dark:bg-neutral-900/60 dark:shadow-none">
      <div className="flex items-center gap-2 text-sm font-medium text-neutral-200">
        <Icon name={icon} size={14} className="text-indigo-300" />
        {title}
      </div>
      <p className="mt-1 text-xs leading-5 text-neutral-500">{body}</p>
    </div>
  );
}

const DEEP_PHASE_LABELS: Record<DeepResearchProgress['phase'], string> = {
  snapshot: 'Reuniendo el corpus',
  planning: 'Planificando secciones',
  section: 'Redactando secciones',
  coverage: 'Ampliando cobertura',
  assembling: 'Ensamblando y referenciando',
  done: 'Informe listo',
};

const DEEP_STEP_ORDER: DeepResearchProgress['phase'][] = ['snapshot', 'planning', 'section', 'coverage', 'assembling', 'done'];

function DeepResearchPanel({
  running,
  progress,
  meta,
  target,
  sectionLimit,
}: {
  running: boolean;
  progress: DeepResearchProgress | null;
  meta: DeepResearchMeta | null;
  target: DeepResearchTargetLength;
  sectionLimit: DeepResearchSectionLimit;
}) {
  const currentPhaseIndex = progress ? DEEP_STEP_ORDER.indexOf(progress.phase) : -1;
  return (
    <div className="p-4 space-y-4 overflow-y-auto min-h-0">
      <div>
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <Icon name="compass" className="text-indigo-300" size={16} /> {t('Deep Research')}
        </h2>
        <p className="text-xs text-neutral-500 mt-1">
          {t('Planifica, redacta sección a sección guiado por la cobertura del corpus y ensambla un informe académico de 5–20 páginas con todas las fuentes citadas.')}
        </p>
      </div>

      <div className="text-xs text-neutral-500 space-y-1">
        <div>
          <span className="text-neutral-400">{t('Extensión:')}</span> {t(DEEP_TARGET_LABELS[target])}
        </div>
        <div>
          <span className="text-neutral-400">{t('Secciones:')}</span> {sectionLimitLabel(sectionLimit)}
        </div>
      </div>

      {(running || progress) && (
        <ol className="space-y-1.5">
          {DEEP_STEP_ORDER.filter((p) => p !== 'done').map((phase) => {
            const index = DEEP_STEP_ORDER.indexOf(phase);
            const state = currentPhaseIndex > index ? 'done' : currentPhaseIndex === index ? 'active' : 'todo';
            return (
              <li key={phase} className="flex items-center gap-2 text-xs">
                <Icon
                  name={state === 'done' ? 'check' : state === 'active' ? 'sync' : 'minus'}
                  size={13}
                  className={state === 'done' ? 'text-green-400' : state === 'active' ? 'text-indigo-300 animate-spin' : 'text-neutral-600'}
                />
                <span className={state === 'todo' ? 'text-neutral-600' : 'text-neutral-300'}>{t(DEEP_PHASE_LABELS[phase])}</span>
              </li>
            );
          })}
        </ol>
      )}

      {progress && (
        <div className="rounded-md border border-neutral-800 p-2 text-xs text-neutral-400 space-y-1">
          <div className="text-neutral-300">{progress.message}</div>
          {progress.sectionIndex != null && progress.sectionTitle && (
            <div className="text-neutral-500">
              {tx('Sección {n}: {title}', { n: progress.sectionIndex, title: progress.sectionTitle })}
            </div>
          )}
          {progress.wordsSoFar != null && (
            <div className="text-neutral-600">
              {tx('~{p} páginas · {w} palabras', { p: progress.pagesSoFar ?? 0, w: progress.wordsSoFar })}
            </div>
          )}
        </div>
      )}

      {meta && !running && (
        <div className="grid grid-cols-2 gap-2">
          <Metric label={t('Secciones')} value={meta.sections} />
          <Metric label={t('Páginas')} value={`~${meta.pages}`} />
          <Metric label={t('Ideas citadas')} value={`${meta.ideasCovered}/${meta.ideasConsidered}`} />
          <Metric label={t('Obras citadas')} value={meta.worksCited} />
        </div>
      )}

      {meta?.stoppedReason && !running && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{meta.stoppedReason}</div>
      )}

      {!running && !progress && (
        <div className="text-xs text-neutral-600">
          {t('Consejo: cuanto más profundo sea el análisis del corpus, más completo será el informe.')}
        </div>
      )}
    </div>
  );
}
