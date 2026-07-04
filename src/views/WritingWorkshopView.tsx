import { useCallback, useEffect, useMemo, useState } from 'react';
import type React from 'react';
import type {
  AppSettings,
  DeepResearchMeta,
  DeepResearchProgress,
  DeepResearchSectionLimit,
  DeepResearchTargetLength,
  Project,
  ProjectDetail,
  WritingWorkshopBrief,
  WritingWorkshopCandidateBase,
  WritingWorkshopContradictionCandidate,
  WritingWorkshopDraft,
  WritingWorkshopGapCandidate,
  WritingWorkshopIdeaCandidate,
  WritingWorkshopPassageCandidate,
  WritingWorkshopRouteCandidate,
  WritingWorkshopSelection,
  WritingWorkshopSavedDraft,
  WritingWorkshopSnapshot,
  WritingWorkshopThemeCandidate,
  WritingWorkshopWorkCandidate,
} from '@shared/types';
import type { PendingGraphNavigationTarget } from '../navigation';
import { Badge, EDGE_LABELS, Icon, NODE_LABELS, modelLabel } from '../components/ui';
import { ModelPicker } from '../components/ModelPicker';
import { Markdown, type MarkdownCitation } from '../components/Markdown';
import { SourceCitationModal, type CitationTarget } from '../components/SourceCitationModal';
import { SaveToNotesModal } from '../components/SaveToNotesModal';
import { t, tx } from '../i18n';

const KIND_LABELS: Record<WritingWorkshopBrief['kind'], string> = {
  literature_review: 'Estado de la cuestión',
  theoretical_framework: 'Marco teórico',
  debate: 'Debate entre autores',
  gap_justification: 'Justificación de hueco',
  chapter_section: 'Apartado de capítulo',
  research_question: 'Pregunta / hipótesis',
  deep_research: 'Deep Research',
};

/** Manual workshop kinds shown in the kind selector (deep_research is its own mode). */
const WORKSHOP_KIND_ENTRIES = (Object.entries(KIND_LABELS) as [WritingWorkshopBrief['kind'], string][]).filter(
  ([id]) => id !== 'deep_research'
);

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

const TONE_LABELS: Record<NonNullable<WritingWorkshopBrief['tone']>, string> = {
  academic: 'Académico',
  synthetic: 'Sintético',
  critical: 'Crítico',
  exploratory: 'Exploratorio',
};

const EMPTY_SELECTION: WritingWorkshopSelection = {
  ideaIds: [],
  themeIds: [],
  gapIds: [],
  contradictionIds: [],
  workIds: [],
  passageIds: [],
  tutorRouteIds: [],
};

type MaterialTab = 'ideas' | 'themes' | 'gaps' | 'contradictions' | 'works' | 'passages' | 'routes';
type ProjectSourceScope = 'none' | 'project' | 'section' | 'chapter';

const TAB_SELECTION_KEYS: Record<MaterialTab, keyof WritingWorkshopSelection> = {
  ideas: 'ideaIds',
  themes: 'themeIds',
  gaps: 'gapIds',
  contradictions: 'contradictionIds',
  works: 'workIds',
  passages: 'passageIds',
  routes: 'tutorRouteIds',
};

export function WritingWorkshopView({
  settings,
  onOpenGraph,
}: {
  settings: AppSettings;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
}) {
  const [brief, setBrief] = useState<WritingWorkshopBrief>({
    kind: 'literature_review',
    objective: '',
    tone: 'academic',
    language: 'es',
  });
  const [selectedModel, setSelectedModel] = useState(settings.synthesisModel ?? settings.defaultModel);
  const [snapshot, setSnapshot] = useState<WritingWorkshopSnapshot | null>(null);
  const [selection, setSelection] = useState<WritingWorkshopSelection>(EMPTY_SELECTION);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(null);
  const [sourceScope, setSourceScope] = useState<ProjectSourceScope>('none');
  const [sourceProjectId, setSourceProjectId] = useState('');
  const [sourceSectionId, setSourceSectionId] = useState('');
  const [sourceChapterId, setSourceChapterId] = useState('');
  const [activeProjectLinkScope, setActiveProjectLinkScope] = useState<{ projectId: string; sectionId: string | null } | null>(null);
  const [activeTab, setActiveTab] = useState<MaterialTab>('ideas');
  const [draft, setDraft] = useState<WritingWorkshopDraft | null>(null);
  const [savedDrafts, setSavedDrafts] = useState<WritingWorkshopSavedDraft[]>([]);
  const [citation, setCitation] = useState<CitationTarget>(null);
  const [savingToNotes, setSavingToNotes] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [loadingMaterials, setLoadingMaterials] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [loadingSavedDrafts, setLoadingSavedDrafts] = useState(false);
  const [reusingDraftId, setReusingDraftId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Deep Research mode (orchestrated, coverage-guided multi-page report).
  const [mode, setMode] = useState<'workshop' | 'deep'>('workshop');
  const [deepTarget, setDeepTarget] = useState<DeepResearchTargetLength>('adaptive');
  const [deepSectionLimit, setDeepSectionLimit] = useState<DeepResearchSectionLimit>('auto');
  const [deepRunning, setDeepRunning] = useState(false);
  const [deepProgress, setDeepProgress] = useState<DeepResearchProgress | null>(null);
  const [deepMeta, setDeepMeta] = useState<DeepResearchMeta | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const selectedCount = useMemo(() => countSelection(selection), [selection]);
  const tableCount = useMemo(() => (snapshot ? countSnapshot(snapshot) : 0), [snapshot]);
  const activeTabTotal = snapshot ? candidateIdsForTab(snapshot, activeTab).length : 0;
  const activeTabSelected = selection[TAB_SELECTION_KEYS[activeTab]].length;
  const hasModel = !!selectedModel;

  const refreshSavedDrafts = useCallback(async () => {
    setLoadingSavedDrafts(true);
    try {
      setSavedDrafts(await window.nodus.listWritingWorkshopDrafts());
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
    void window.nodus.listProjects().then((list) => {
      setProjects(list);
      if (!sourceProjectId && list[0]) setSourceProjectId(list[0].id);
    });
  }, [sourceProjectId]);

  useEffect(() => {
    if (!sourceProjectId) {
      setProjectDetail(null);
      return;
    }
    let on = true;
    void window.nodus.getProject(sourceProjectId).then((detail) => {
      if (!on) return;
      setProjectDetail(detail);
      if (detail) {
        setSourceSectionId((current) => current || detail.sections[0]?.id || '');
        setSourceChapterId((current) => current || detail.chapters[0]?.id || '');
      }
    });
    return () => {
      on = false;
    };
  }, [sourceProjectId]);

  const prepare = async () => {
    setError(null);
    setMessage(null);
    setDraft(null);
    setLoadingMaterials(true);
    try {
      const next = await window.nodus.getWritingWorkshopSnapshot(brief);
      setSnapshot(next);
      setSelection(next.recommendedSelection);
      setMessage(t('Mesa preparada con materiales recomendados.'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMaterials(false);
    }
  };

  const generate = async () => {
    setError(null);
    setMessage(null);
    setGenerating(true);
    try {
      const result = await window.nodus.generateWritingWorkshopDraft({
        brief,
        selection,
        model: selectedModel,
      });
      setDraft(result);
      setMessage(t('Borrador generado con matriz y citas.'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const runDeepResearch = async () => {
    if (!brief.objective.trim()) {
      setError(t('Escribe la idea de investigación antes de generar el informe.'));
      return;
    }
    setError(null);
    setMessage(null);
    setDraft(null);
    setDeepMeta(null);
    setDeepProgress(null);
    setDeepRunning(true);
    try {
      const report = await window.nodus.generateDeepResearchReport(
        {
          objective: brief.objective,
          language: brief.language,
          audience: brief.audience,
          targetLength: deepTarget,
          sectionLimit: deepSectionLimit,
          model: selectedModel,
        },
        { onProgress: (p) => setDeepProgress(p) }
      );
      setDraft(report.draft);
      setDeepMeta(report.meta);
      setMessage(
        tx('Informe generado: {s} secciones · ~{p} páginas · {i} ideas citadas.', {
          s: report.meta.sections,
          p: report.meta.pages,
          i: report.meta.ideasCovered,
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeepRunning(false);
    }
  };

  const exportDraft = async (format: 'markdown' | 'pdf') => {
    if (!draft) return;
    setExportMenuOpen(false);
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
      if (activeProjectLinkScope) {
        await window.nodus.addProjectLink({
          projectId: activeProjectLinkScope.projectId,
          sectionId: activeProjectLinkScope.sectionId,
          kind: 'writing_draft',
          refId: saved.id,
          label: saved.draft.title,
          role: 'draft',
        });
      }
      setMessage(t('Borrador guardado localmente.'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingDraft(false);
    }
  };

  const openSavedDraft = (saved: WritingWorkshopSavedDraft) => {
    setError(null);
    setMessage(t('Borrador guardado abierto. Puedes exportarlo o reutilizar su prompt para actualizarlo.'));
    setBrief(saved.brief);
    setSelection(saved.selection);
    setSnapshot(null);
    setDraft(saved.draft);
    if (saved.model) setSelectedModel(saved.model);
  };

  const reuseSavedPrompt = async (saved: WritingWorkshopSavedDraft) => {
    if (reusingDraftId) return;
    setError(null);
    setMessage(null);
    setReusingDraftId(saved.id);
    setLoadingMaterials(true);
    try {
      const next = await window.nodus.getWritingWorkshopSnapshot(saved.brief);
      const restoredSelection = selectionAvailableInSnapshot(saved.selection, next);
      setBrief(saved.brief);
      setSnapshot(next);
      setSelection(restoredSelection);
      setDraft(null);
      if (saved.model) setSelectedModel(saved.model);
      setMessage(tx('Prompt reutilizado: {n} materiales siguen disponibles para generar un borrador actualizado.', { n: countSelection(restoredSelection) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMaterials(false);
      setReusingDraftId(null);
    }
  };

  const deleteSavedDraft = async (saved: WritingWorkshopSavedDraft) => {
    if (!window.confirm(t('¿Eliminar este borrador guardado? Esta acción no se puede deshacer.'))) return;
    setError(null);
    setMessage(null);
    try {
      await window.nodus.deleteWritingWorkshopDraft(saved.id);
      setSavedDrafts((current) => current.filter((item) => item.id !== saved.id));
      setMessage(t('Borrador eliminado.'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggle = (key: keyof WritingWorkshopSelection, id: string) => {
    setSelection((current) => {
      const next = new Set(current[key]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...current, [key]: Array.from(next) };
    });
  };

  const applyRecommended = () => {
    if (!snapshot) return;
    setSelection(snapshot.recommendedSelection);
  };

  const selectAllMaterials = () => {
    if (!snapshot) return;
    setSelection(selectionFromSnapshot(snapshot));
  };

  const selectAllIdeas = () => {
    if (!snapshot) return;
    setSelection((current) => ({ ...current, ideaIds: snapshot.ideas.map((item) => item.id) }));
  };

  const clearIdeas = () => {
    setSelection((current) => ({ ...current, ideaIds: [] }));
  };

  const selectActiveTab = () => {
    if (!snapshot) return;
    const key = TAB_SELECTION_KEYS[activeTab];
    setSelection((current) => ({ ...current, [key]: candidateIdsForTab(snapshot, activeTab) }));
  };

  const clearActiveTab = () => {
    const key = TAB_SELECTION_KEYS[activeTab];
    setSelection((current) => ({ ...current, [key]: [] }));
  };

  const applyProjectSource = () => {
    if (!projectDetail || sourceScope === 'none') {
      setActiveProjectLinkScope(null);
      return;
    }
    const sectionId = sourceScope === 'section' || sourceScope === 'chapter' ? sourceSectionId || null : null;
    const chapter = sourceScope === 'chapter'
      ? projectDetail.chapters.find((item) => item.id === sourceChapterId) ?? null
      : null;
    const nextSelection = selectionFromProject(projectDetail, sectionId);
    setSelection(nextSelection);
    setSnapshot(null);
    setDraft(null);
    setActiveProjectLinkScope({ projectId: projectDetail.project.id, sectionId });
    setBrief((current) => ({
      ...current,
      kind: sourceScope === 'chapter' ? 'chapter_section' : current.kind,
      objective: projectSourceObjective(projectDetail, sourceScope, sectionId, chapter),
    }));
    setMessage(tx('Origen aplicado: {n} materiales vinculados.', { n: countSelection(nextSelection) }));
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <header className="border-b border-neutral-800 p-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem]">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Icon name="edit" className="text-indigo-300" /> {mode === 'deep' ? t('Deep Research') : t('Taller de escritura')}
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            {mode === 'deep'
              ? t('Informe académico de varias páginas, guiado por cobertura y con todas las fuentes citadas.')
              : t('Del grafo a un borrador con fuentes verificables.')}
          </p>
        </div>
        <div className="flex rounded-lg border border-neutral-700 overflow-hidden text-sm">
          <button
            className={`px-3 py-1.5 ${mode === 'workshop' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}`}
            onClick={() => setMode('workshop')}
          >
            {t('Taller')}
          </button>
          <button
            className={`px-3 py-1.5 flex items-center gap-1 ${mode === 'deep' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}`}
            onClick={() => setMode('deep')}
          >
            <Icon name="compass" size={14} /> {t('Deep Research')}
          </button>
        </div>
        {mode === 'workshop' && (
          <>
            <select
              className="input"
              value={brief.kind}
              onChange={(e) => setBrief((current) => ({ ...current, kind: e.target.value as WritingWorkshopBrief['kind'] }))}
            >
              {WORKSHOP_KIND_ENTRIES.map(([id, label]) => (
                <option key={id} value={id}>
                  {t(label)}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={brief.tone ?? 'academic'}
              onChange={(e) => setBrief((current) => ({ ...current, tone: e.target.value as WritingWorkshopBrief['tone'] }))}
            >
              {Object.entries(TONE_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {t(label)}
                </option>
              ))}
            </select>
          </>
        )}
        {mode === 'deep' && (
          <>
            <select
              className="input"
              value={deepTarget}
              onChange={(e) => setDeepTarget(e.target.value as DeepResearchTargetLength)}
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
              onChange={(e) =>
                setDeepSectionLimit(e.target.value === 'auto' ? 'auto' : (Number(e.target.value) as DeepResearchSectionLimit))
              }
              title={t('Número máximo de secciones (menos secciones = mayor profundidad)')}
            >
              {DEEP_SECTION_OPTIONS.map((option) => (
                <option key={String(option.value)} value={String(option.value)}>
                  {t(option.label)}
                </option>
              ))}
            </select>
          </>
        )}
        <select
          className="input"
          value={brief.language ?? 'es'}
          onChange={(e) => setBrief((current) => ({ ...current, language: e.target.value as WritingWorkshopBrief['language'] }))}
        >
          <option value="es">Español</option>
          <option value="en">English</option>
          <option value="fr">Français</option>
        </select>
        <ModelPicker settings={settings} value={selectedModel} onChange={setSelectedModel} compact />
        <div className="flex-1" />
        <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={() => setShowTutorial((value) => !value)}>
          <Icon name="help" />
          {showTutorial ? t('Ocultar tutorial') : t('Tutorial')}
        </button>
        {mode === 'workshop' && (
          <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={prepare} disabled={loadingMaterials}>
            <Icon name={loadingMaterials ? 'sync' : 'search'} className={loadingMaterials ? 'animate-spin' : ''} />
            {t('Preparar mesa')}
          </button>
        )}
        {mode === 'workshop' ? (
          <button
            className="btn btn-primary gap-1.5"
            onClick={generate}
            disabled={!hasModel || generating || selectedCount === 0}
            title={!hasModel ? t('Configura un modelo de síntesis') : undefined}
          >
            <Icon name={generating ? 'sync' : 'wand'} className={generating ? 'animate-spin' : ''} />
            {t('Generar borrador')}
          </button>
        ) : (
          <button
            className="btn btn-primary gap-1.5"
            onClick={runDeepResearch}
            disabled={!hasModel || deepRunning || !brief.objective.trim()}
            title={!hasModel ? t('Configura un modelo de síntesis') : undefined}
          >
            <Icon name={deepRunning ? 'sync' : 'compass'} className={deepRunning ? 'animate-spin' : ''} />
            {deepRunning ? t('Generando informe…') : t('Generar informe')}
          </button>
        )}
      </header>

      <div className="border-b border-neutral-800 p-3">
        <textarea
          className="input w-full min-h-20 resize-y"
          value={brief.objective}
          onChange={(e) => setBrief((current) => ({ ...current, objective: e.target.value }))}
          placeholder={
            mode === 'deep'
              ? t('Escribe la idea o pregunta de investigación. El informe la desarrollará por completo, citando todas las obras del corpus.')
              : t('Describe el apartado que quieres construir...')
          }
        />
        {mode === 'deep' && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <Badge color="green">{t('Cobertura del corpus completo')}</Badge>
            <Badge>{t(DEEP_TARGET_LABELS[deepTarget])}</Badge>
            <Badge>{sectionLimitLabel(deepSectionLimit)}</Badge>
            {selectedModel && <span>{t('Modelo:')} {modelLabel(selectedModel)}</span>}
            <span className="text-neutral-600">{t('Sin selección manual: el informe elige y cita las fuentes por ti.')}</span>
          </div>
        )}
        {mode === 'workshop' && (
        <>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select className="input text-xs" value={sourceScope} onChange={(e) => setSourceScope(e.target.value as ProjectSourceScope)}>
            <option value="none">{t('Sin origen de proyecto')}</option>
            <option value="project">{t('Proyecto completo')}</option>
            <option value="section">{t('Seccion del proyecto')}</option>
            <option value="chapter">{t('Capitulo del proyecto')}</option>
          </select>
          {sourceScope !== 'none' && (
            <>
              <select className="input text-xs min-w-48" value={sourceProjectId} onChange={(e) => setSourceProjectId(e.target.value)}>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.title}</option>
                ))}
              </select>
              {(sourceScope === 'section' || sourceScope === 'chapter') && projectDetail && (
                <select className="input text-xs min-w-48" value={sourceSectionId} onChange={(e) => setSourceSectionId(e.target.value)}>
                  {projectDetail.sections.map((section) => (
                    <option key={section.id} value={section.id}>{section.title}</option>
                  ))}
                </select>
              )}
              {sourceScope === 'chapter' && projectDetail && (
                <select className="input text-xs min-w-48" value={sourceChapterId} onChange={(e) => setSourceChapterId(e.target.value)}>
                  {projectDetail.chapters.map((chapter) => (
                    <option key={chapter.id} value={chapter.id}>{chapter.title}</option>
                  ))}
                </select>
              )}
              <button
                className="btn btn-ghost border border-neutral-700 text-xs gap-1.5"
                onClick={applyProjectSource}
                disabled={!projectDetail}
              >
                <Icon name="folder" size={13} /> {t('Aplicar origen')}
              </button>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2 mt-2 text-xs text-neutral-500">
          {snapshot && (
            <>
              <Badge>
                {tx('{a}/{b} ideas en mesa', { a: selection.ideaIds.length, b: snapshot.ideas.length })}
              </Badge>
              <Badge>{tx('{n} ideas en el grafo', { n: snapshot.stats.ideas })}</Badge>
              <Badge>
                {tx('{a}/{b} materiales seleccionados', { a: selectedCount, b: tableCount })}
              </Badge>
              <Badge>{tx('{n} huecos', { n: snapshot.stats.gaps })}</Badge>
              <Badge>{tx('{n} contradicciones', { n: snapshot.stats.contradictions })}</Badge>
              <Badge color="green">{tx('{n} pasajes indexados', { n: snapshot.stats.passages })}</Badge>
              <button className="btn btn-ghost border border-neutral-700 py-1 text-xs" onClick={applyRecommended}>
                {t('Recomendados')}
              </button>
              <button className="btn btn-ghost border border-neutral-700 py-1 text-xs" onClick={selectAllMaterials}>
                {t('Toda la mesa')}
              </button>
              <button className="btn btn-ghost border border-neutral-700 py-1 text-xs" onClick={selectAllIdeas}>
                {t('Todas las ideas')}
              </button>
              <button className="btn btn-ghost border border-neutral-700 py-1 text-xs" onClick={clearIdeas}>
                {t('Vaciar ideas')}
              </button>
              <button className="btn btn-ghost border border-neutral-700 py-1 text-xs" onClick={() => setSelection(EMPTY_SELECTION)}>
                {t('Vaciar')}
              </button>
            </>
          )}
          {selectedModel && <span>{t('Modelo:')} {modelLabel(selectedModel)}</span>}
        </div>
        </>
        )}
      </div>

      {showTutorial && <WritingWorkshopTutorial />}

      {(message || error) && (
        <div className={`px-4 py-2 text-sm border-b ${error ? 'border-red-900 bg-red-950/30 text-red-200' : 'border-neutral-800 text-neutral-400'}`}>
          {error ?? message}
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-[18rem_minmax(0,1fr)_20rem] max-xl:grid-cols-1">
        <aside className="border-r border-neutral-800 min-h-0 flex flex-col max-xl:border-r-0 max-xl:border-b">
          {mode === 'deep' && (
            <DeepResearchPanel
              running={deepRunning}
              progress={deepProgress}
              meta={deepMeta}
              target={deepTarget}
              sectionLimit={deepSectionLimit}
            />
          )}
          {mode === 'workshop' && (
          <>
          <div className="p-3 border-b border-neutral-800 grid grid-cols-3 gap-1 text-xs">
            <TabButton id="ideas" active={activeTab} setActive={setActiveTab} label={tabLabel(t('Ideas'), selection.ideaIds.length, snapshot?.ideas.length)} />
            <TabButton id="themes" active={activeTab} setActive={setActiveTab} label={tabLabel(t('Temas'), selection.themeIds.length, snapshot?.themes.length)} />
            <TabButton id="gaps" active={activeTab} setActive={setActiveTab} label={tabLabel(t('Huecos'), selection.gapIds.length, snapshot?.gaps.length)} />
            <TabButton
              id="contradictions"
              active={activeTab}
              setActive={setActiveTab}
              label={tabLabel(t('Contrad.'), selection.contradictionIds.length, snapshot?.contradictions.length)}
            />
            <TabButton id="works" active={activeTab} setActive={setActiveTab} label={tabLabel(t('Obras'), selection.workIds.length, snapshot?.works.length)} />
            <TabButton id="passages" active={activeTab} setActive={setActiveTab} label={tabLabel(t('Pasajes'), selection.passageIds.length, snapshot?.passages.length)} />
            <TabButton
              id="routes"
              active={activeTab}
              setActive={setActiveTab}
              label={tabLabel(t('Rutas'), selection.tutorRouteIds.length, snapshot?.tutorRoutes.length)}
            />
          </div>
          {snapshot && (
            <div className="px-3 py-2 border-b border-neutral-800 text-xs text-neutral-500 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span>
                  {tx('{a}/{b} en esta pestaña', { a: activeTabSelected, b: activeTabTotal })}
                </span>
                <span>{tx('{n} ideas seleccionadas', { n: selection.ideaIds.length })}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn btn-ghost border border-neutral-700 py-1 text-xs gap-1" onClick={selectActiveTab}>
                  <Icon name="check" size={13} /> {t('Seleccionar')}
                </button>
                <button className="btn btn-ghost border border-neutral-700 py-1 text-xs gap-1" onClick={clearActiveTab}>
                  <Icon name="minus" size={13} /> {t('Vaciar')}
                </button>
              </div>
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
            {!snapshot && (
              <div className="text-sm text-neutral-500 p-3">
                {t('Escribe un objetivo y prepara la mesa para seleccionar materiales.')}
              </div>
            )}
            {snapshot && activeTab === 'ideas' && snapshot.ideas.map((item) => (
              <IdeaCard key={item.id} item={item} selected={selection.ideaIds.includes(item.id)} onToggle={() => toggle('ideaIds', item.id)} />
            ))}
            {snapshot && activeTab === 'themes' && snapshot.themes.map((item) => (
              <ThemeCard key={item.id} item={item} selected={selection.themeIds.includes(item.id)} onToggle={() => toggle('themeIds', item.id)} />
            ))}
            {snapshot && activeTab === 'gaps' && snapshot.gaps.map((item) => (
              <GapCard key={item.id} item={item} selected={selection.gapIds.includes(item.id)} onToggle={() => toggle('gapIds', item.id)} />
            ))}
            {snapshot && activeTab === 'contradictions' && snapshot.contradictions.map((item) => (
              <ContradictionCard
                key={item.id}
                item={item}
                selected={selection.contradictionIds.includes(item.id)}
                onToggle={() => toggle('contradictionIds', item.id)}
              />
            ))}
            {snapshot && activeTab === 'works' && snapshot.works.map((item) => (
              <WorkCard key={item.id} item={item} selected={selection.workIds.includes(item.id)} onToggle={() => toggle('workIds', item.id)} />
            ))}
            {snapshot && activeTab === 'passages' && snapshot.passages.map((item) => (
              <PassageCard key={item.id} item={item} selected={selection.passageIds.includes(item.id)} onToggle={() => toggle('passageIds', item.id)} />
            ))}
            {snapshot && activeTab === 'routes' && snapshot.tutorRoutes.map((item) => (
              <RouteCard
                key={item.id}
                item={item}
                selected={selection.tutorRouteIds.includes(item.id)}
                onToggle={() => toggle('tutorRouteIds', item.id)}
              />
            ))}
          </div>
          </>
          )}
        </aside>

        <main className="min-h-0 overflow-y-auto p-5">
          {!draft && (
            <div className="h-full flex items-center justify-center">
              <div className="max-w-md text-center text-neutral-500 text-sm">
                {mode === 'deep'
                  ? deepRunning
                    ? deepProgress?.message ?? t('Generando informe…')
                    : t('El informe aparecerá aquí. Escribe tu idea de investigación y pulsa «Generar informe».')
                  : generating
                    ? t('Generando borrador...')
                    : t('El borrador aparecerá aquí cuando selecciones materiales y lo generes.')}
              </div>
            </div>
          )}
          {draft && (
            <div className="max-w-4xl mx-auto space-y-5">
              <div className="space-y-3">
                <div className="min-w-0">
                  <h2 className="text-xl font-semibold break-words">{draft.title}</h2>
                  {draft.abstract && <p className="text-sm text-neutral-400 mt-1">{draft.abstract}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={copyDraft}>
                    <Icon name="check" /> {t('Copiar')}
                  </button>
                  <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={saveDraft} disabled={savingDraft}>
                    <Icon name={savingDraft ? 'sync' : 'save'} className={savingDraft ? 'animate-spin' : ''} /> {savingDraft ? t('Guardando…') : t('Guardar borrador')}
                  </button>
                  <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={() => setSavingToNotes(true)}>
                    <Icon name="notebook" /> {t('Guardar en notas')}
                  </button>
                  <div className="relative">
                    <button
                      className="btn btn-primary gap-1.5"
                      onClick={() => setExportMenuOpen((open) => !open)}
                      disabled={exporting}
                    >
                      <Icon name={exporting ? 'sync' : 'download'} className={exporting ? 'animate-spin' : ''} /> {t('Exportar')}
                      <Icon name="chevronDown" size={14} />
                    </button>
                    {exportMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setExportMenuOpen(false)} />
                        <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-neutral-700 bg-neutral-900 shadow-xl py-1">
                          <button
                            className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-800 flex items-center gap-2"
                            onClick={() => void exportDraft('markdown')}
                          >
                            <Icon name="code" size={14} /> {t('Markdown (.md)')}
                          </button>
                          <button
                            className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-800 flex items-center gap-2"
                            onClick={() => void exportDraft('pdf')}
                          >
                            <Icon name="download" size={14} /> {t('PDF (.pdf)')}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <section className="card p-4">
                <h3 className="font-semibold mb-3">{t('Esquema')}</h3>
                <div className="space-y-3">
                  {draft.outline.map((section, index) => (
                    <div key={section.id} className="border-l-2 border-indigo-700 pl-3">
                      <div className="font-medium text-sm">
                        {index + 1}. {section.title}
                      </div>
                      <p className="text-xs text-neutral-400 mt-1">{section.purpose}</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {section.sources.slice(0, 6).map((source, i) => (
                          <Badge key={`${section.id}-${i}`}>{source.replace(/\[|\]|\(.+\)/g, '')}</Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              <section className="card p-4">
                <Markdown content={draft.draftMarkdown} onCitation={(c: MarkdownCitation) => setCitation(c)} />
              </section>
            </div>
          )}
        </main>

        <aside className="border-l border-neutral-800 min-h-0 overflow-y-auto p-4 max-xl:border-l-0 max-xl:border-t">
          <SavedDraftsPanel
            drafts={savedDrafts}
            loading={loadingSavedDrafts}
            reusingDraftId={reusingDraftId}
            onOpen={openSavedDraft}
            onReuse={(saved) => void reuseSavedPrompt(saved)}
            onDelete={(saved) => void deleteSavedDraft(saved)}
            onRefresh={() => void refreshSavedDrafts()}
          />
          <div className="my-4 border-t border-neutral-800" />
          <h2 className="font-semibold text-sm mb-3">{t('Matriz de apoyo')}</h2>
          {!draft && <div className="text-sm text-neutral-500">{t('Sin matriz todavía.')}</div>}
          {draft && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 mb-3">
                <Metric label={t('Ideas')} value={draft.stats.selectedIdeas} />
                <Metric label={t('Huecos')} value={draft.stats.selectedGaps} />
                <Metric label={t('Obras')} value={draft.stats.selectedWorks} />
                <Metric label={t('Pasajes')} value={draft.stats.selectedPassages} />
                <Metric label={t('Contexto')} value={formatChars(draft.stats.contextChars)} />
              </div>
              {draft.matrix.map((row, index) => (
                <div key={index} className="card p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge color={matrixColor(row.role)}>{row.role}</Badge>
                    <span className="text-xs text-neutral-500 truncate">{row.sourceLabel}</span>
                  </div>
                  <p className="text-sm text-neutral-200">{row.claim}</p>
                  {row.evidence && <p className="text-xs text-neutral-500 mt-1">{row.evidence}</p>}
                  <div className="flex items-center gap-2 mt-2">
                    {row.citation && (
                      <button className="text-xs text-indigo-300 hover:underline" onClick={() => openMatrixCitation(row.citation, setCitation)}>
                        {t('abrir fuente')}
                      </button>
                    )}
                    {row.notes && <span className="text-xs text-neutral-600">{row.notes}</span>}
                  </div>
                </div>
              ))}
              <PanelList title={t('Siguientes pasos')} items={draft.nextSteps} />
              <PanelList title={t('Limitaciones')} items={draft.limitations} />
              <PanelList title={t('Bibliografía')} items={draft.bibliography} />
            </div>
          )}
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

function WritingWorkshopTutorial() {
  return (
    <section className="border-b border-neutral-800 bg-white/95 px-4 py-3 dark:bg-neutral-950/80">
      <div className="grid grid-cols-4 gap-3 max-2xl:grid-cols-2 max-md:grid-cols-1">
        <TutorialStep
          icon="search"
          title={t('1. Delimita')}
          body={t('Escribe el apartado que quieres construir: pregunta, capítulo, debate, hueco o marco teórico. Cuanto más concreto sea el objetivo, mejor se ordena la mesa.')}
        />
        <TutorialStep
          icon="layers"
          title={t('2. Monta la mesa')}
          body={t('Pulsa Preparar mesa y revisa ideas, temas, huecos, contradicciones, obras y rutas. Usa Todas las ideas cuando quieras una revisión amplia del corpus encontrado.')}
        />
        <TutorialStep
          icon="check"
          title={t('3. Decide el foco')}
          body={t('Selecciona todo para explorar, vacía para empezar de cero o ajusta cada pestaña. La matriz final te dirá qué papel cumple cada material en el argumento.')}
        />
        <TutorialStep
          icon="edit"
          title={t('4. Convierte en texto')}
          body={t('Genera el borrador, abre las citas para verificar fuentes, guárdalo si quieres retomarlo y exporta Markdown cuando el hilo argumental ya tenga sentido para tu manuscrito.')}
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

function TabButton({
  id,
  active,
  setActive,
  label,
}: {
  id: MaterialTab;
  active: MaterialTab;
  setActive: (tab: MaterialTab) => void;
  label: string;
}) {
  return (
    <button
      className={`rounded-md px-2 py-1 text-left ${active === id ? 'bg-indigo-600 text-white' : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-800'}`}
      onClick={() => setActive(id)}
    >
      {label}
    </button>
  );
}

function CandidateShell({
  item,
  selected,
  onToggle,
  children,
}: {
  item: WritingWorkshopCandidateBase;
  selected: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`card p-3 w-full text-left transition-colors ${selected ? 'ring-1 ring-indigo-500 bg-neutral-800/80' : 'hover:bg-neutral-800/60'}`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="flex items-start gap-2">
        <input className="mt-1 accent-indigo-500" type="checkbox" checked={selected} onChange={onToggle} onClick={(e) => e.stopPropagation()} />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm line-clamp-2">{item.label}</div>
          <p className="text-xs text-neutral-400 mt-1 line-clamp-3">{item.summary}</p>
          <div className="flex flex-wrap gap-1 mt-2">
            <Badge>{Math.round(item.score * 100)}%</Badge>
            <Badge color="cyan">{item.reason}</Badge>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function IdeaCard({ item, selected, onToggle }: { item: WritingWorkshopIdeaCandidate; selected: boolean; onToggle: () => void }) {
  return (
    <CandidateShell item={item} selected={selected} onToggle={onToggle}>
      <div className="flex flex-wrap gap-1 mt-2">
        <Badge color="indigo">{t(NODE_LABELS[item.type])}</Badge>
        <Badge>{tx('{n} obras', { n: item.workCount })}</Badge>
        <Badge>{tx('{n} evidencias', { n: item.evidenceCount })}</Badge>
      </div>
    </CandidateShell>
  );
}

function ThemeCard({ item, selected, onToggle }: { item: WritingWorkshopThemeCandidate; selected: boolean; onToggle: () => void }) {
  return (
    <CandidateShell item={item} selected={selected} onToggle={onToggle}>
      <div className="flex flex-wrap gap-1 mt-2">
        {item.pinned && <Badge color="amber">{t('curado')}</Badge>}
        <Badge>{tx('{n} ideas', { n: item.ideaCount })}</Badge>
        <Badge>{tx('{n} obras', { n: item.workCount })}</Badge>
      </div>
    </CandidateShell>
  );
}

function GapCard({ item, selected, onToggle }: { item: WritingWorkshopGapCandidate; selected: boolean; onToggle: () => void }) {
  return (
    <CandidateShell item={item} selected={selected} onToggle={onToggle}>
      <div className="text-xs text-neutral-500 mt-2">
        {item.work.authors[0] ?? t('Autoría no disponible')} {item.work.year ?? ''}
      </div>
    </CandidateShell>
  );
}

function ContradictionCard({
  item,
  selected,
  onToggle,
}: {
  item: WritingWorkshopContradictionCandidate;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <CandidateShell item={item} selected={selected} onToggle={onToggle}>
      <div className="flex flex-wrap gap-1 mt-2">
        <Badge color="red">{t(EDGE_LABELS[item.type as keyof typeof EDGE_LABELS]) ?? item.type}</Badge>
        <Badge>{item.basis}</Badge>
        <Badge>{t('conf')} {item.confidence.toFixed(2)}</Badge>
      </div>
    </CandidateShell>
  );
}

function WorkCard({ item, selected, onToggle }: { item: WritingWorkshopWorkCandidate; selected: boolean; onToggle: () => void }) {
  return (
    <CandidateShell item={item} selected={selected} onToggle={onToggle}>
      <div className="flex flex-wrap gap-1 mt-2">
        <Badge color={item.deepStatus === 'done' ? 'green' : 'neutral'}>{item.deepStatus === 'done' ? t('analizada') : item.deepStatus}</Badge>
        <Badge>{tx('{n} ideas', { n: item.ideaCount })}</Badge>
        <Badge>{tx('{n} huecos', { n: item.gapCount })}</Badge>
      </div>
    </CandidateShell>
  );
}

function PassageCard({ item, selected, onToggle }: { item: WritingWorkshopPassageCandidate; selected: boolean; onToggle: () => void }) {
  return (
    <CandidateShell item={item} selected={selected} onToggle={onToggle}>
      <div className="mt-2 flex flex-wrap gap-1">
        <Badge color="green">{t('texto completo')}</Badge>
        {item.pageLabel && <Badge>{item.pageLabel}</Badge>}
        <Badge>{item.authors[0] ?? t('Autoría no disponible')}{item.year ? `, ${item.year}` : ''}</Badge>
      </div>
    </CandidateShell>
  );
}

function RouteCard({ item, selected, onToggle }: { item: WritingWorkshopRouteCandidate; selected: boolean; onToggle: () => void }) {
  return (
    <CandidateShell item={item} selected={selected} onToggle={onToggle}>
      <div className="flex flex-wrap gap-1 mt-2">
        <Badge color="indigo">{tx('{n} paradas', { n: item.stops })}</Badge>
        {item.rating && <Badge color="amber">★ {item.rating}</Badge>}
      </div>
    </CandidateShell>
  );
}

function SavedDraftsPanel({
  drafts,
  loading,
  reusingDraftId,
  onOpen,
  onReuse,
  onDelete,
  onRefresh,
}: {
  drafts: WritingWorkshopSavedDraft[];
  loading: boolean;
  reusingDraftId: string | null;
  onOpen: (draft: WritingWorkshopSavedDraft) => void;
  onReuse: (draft: WritingWorkshopSavedDraft) => void;
  onDelete: (draft: WritingWorkshopSavedDraft) => void;
  onRefresh: () => void;
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="font-semibold text-sm">{t('Borradores guardados')}</h2>
          <p className="text-xs text-neutral-500 mt-0.5">{tx('{n} guardado(s) en este dispositivo', { n: drafts.length })}</p>
        </div>
        <button className="btn btn-ghost px-2 py-1 gap-1" onClick={onRefresh} disabled={loading} title={t('Actualizar borradores')}>
          <Icon name="refresh" size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-neutral-500">{t('Cargando borradores…')}</div>
      ) : drafts.length === 0 ? (
        <div className="rounded-md border border-dashed border-neutral-800 px-3 py-4 text-sm leading-5 text-neutral-500">
          {t('Aún no hay borradores guardados. Genera uno y guárdalo para volver a abrirlo o reutilizar su prompt más adelante.')}
        </div>
      ) : (
        <div className="space-y-2">
          {drafts.map((saved) => {
            const isReusing = reusingDraftId === saved.id;
            return (
              <div key={saved.id} className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium leading-5 line-clamp-2">{saved.title}</div>
                    <div className="mt-1 text-[11px] text-neutral-500">
                      {t(KIND_LABELS[saved.brief.kind])} · {formatSavedDraftDate(saved.updatedAt)}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost px-1.5 py-1 text-red-400 hover:text-red-300"
                    onClick={() => onDelete(saved)}
                    title={t('Eliminar borrador guardado')}
                    aria-label={`${t('Eliminar borrador guardado')}: ${saved.title}`}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
                {saved.brief.objective && <p className="mt-2 text-xs leading-5 text-neutral-500 line-clamp-3">{saved.brief.objective}</p>}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button className="btn btn-ghost border border-neutral-700 px-2 py-1.5 text-xs gap-1" onClick={() => onOpen(saved)}>
                    <Icon name="edit" size={13} /> {t('Abrir')}
                  </button>
                  <button
                    className="btn btn-primary px-2 py-1.5 text-xs gap-1"
                    onClick={() => onReuse(saved)}
                    disabled={reusingDraftId !== null}
                  >
                    <Icon name={isReusing ? 'sync' : 'refresh'} size={13} className={isReusing ? 'animate-spin' : ''} />
                    {isReusing ? t('Preparando…') : t('Reutilizar prompt')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-neutral-800 px-2 py-1.5">
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
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
        <div className="rounded-md border border-amber-900 bg-amber-950/30 p-2 text-xs text-amber-200">{meta.stoppedReason}</div>
      )}

      {!running && !progress && (
        <div className="text-xs text-neutral-600">
          {t('Consejo: cuanto más profundo sea el análisis del corpus, más completo será el informe.')}
        </div>
      )}
    </div>
  );
}

function PanelList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="pt-3 border-t border-neutral-800">
      <h3 className="font-semibold text-sm mb-2">{title}</h3>
      <ul className="space-y-1 text-xs text-neutral-400">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function countSelection(selection: WritingWorkshopSelection): number {
  return (
    selection.ideaIds.length +
    selection.themeIds.length +
    selection.gapIds.length +
    selection.contradictionIds.length +
    selection.workIds.length +
    selection.passageIds.length +
    selection.tutorRouteIds.length
  );
}

function countSnapshot(snapshot: WritingWorkshopSnapshot): number {
  return (
    snapshot.ideas.length +
    snapshot.themes.length +
    snapshot.gaps.length +
    snapshot.contradictions.length +
    snapshot.works.length +
    snapshot.passages.length +
    snapshot.tutorRoutes.length
  );
}

function selectionFromSnapshot(snapshot: WritingWorkshopSnapshot): WritingWorkshopSelection {
  return {
    ideaIds: snapshot.ideas.map((item) => item.id),
    themeIds: snapshot.themes.map((item) => item.id),
    gapIds: snapshot.gaps.map((item) => item.id),
    contradictionIds: snapshot.contradictions.map((item) => item.id),
    workIds: snapshot.works.map((item) => item.id),
    passageIds: snapshot.passages.map((item) => item.id),
    tutorRouteIds: snapshot.tutorRoutes.map((item) => item.id),
  };
}

function selectionFromProject(detail: ProjectDetail, sectionId: string | null): WritingWorkshopSelection {
  const selected: WritingWorkshopSelection = {
    ideaIds: [],
    themeIds: [],
    gapIds: [],
    contradictionIds: [],
    workIds: [],
    passageIds: [],
    tutorRouteIds: [],
  };
  const include = (linkSectionId: string | null) => !sectionId || !linkSectionId || linkSectionId === sectionId;
  for (const link of detail.links) {
    if (!include(link.sectionId)) continue;
    switch (link.kind) {
      case 'idea':
        selected.ideaIds.push(link.refId);
        break;
      case 'gap':
        selected.gapIds.push(link.refId);
        break;
      case 'debate':
        selected.contradictionIds.push(link.refId);
        break;
      case 'work':
        selected.workIds.push(link.refId);
        break;
      case 'tutor_route':
        selected.tutorRouteIds.push(link.refId);
        break;
      default:
        break;
    }
  }
  return {
    ideaIds: unique(selected.ideaIds),
    themeIds: [],
    gapIds: unique(selected.gapIds),
    contradictionIds: unique(selected.contradictionIds),
    workIds: unique(selected.workIds),
    passageIds: [],
    tutorRouteIds: unique(selected.tutorRouteIds),
  };
}

function projectSourceObjective(
  detail: ProjectDetail,
  scope: ProjectSourceScope,
  sectionId: string | null,
  chapter: ProjectDetail['chapters'][number] | null
): string {
  const section = sectionId ? detail.sections.find((item) => item.id === sectionId) ?? null : null;
  const parts = [
    `Proyecto: ${detail.project.title}`,
    detail.project.brief ? `Brief: ${detail.project.brief}` : '',
    scope === 'section' && section ? `Seccion: ${section.title}` : '',
    scope === 'chapter' && chapter ? `Capitulo: ${chapter.title}` : '',
    scope === 'chapter' && chapter ? `Texto actual del capitulo:\n${chapter.currentMarkdown.slice(0, 6000)}` : '',
    'Objetivo: construir un borrador academico conectado, con citas nodus:// verificables, usando solo los materiales vinculados a este origen.',
  ];
  return parts.filter(Boolean).join('\n\n');
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

/** Keep only selected material that still appears in the freshly prepared table. */
function selectionAvailableInSnapshot(
  selection: WritingWorkshopSelection,
  snapshot: WritingWorkshopSnapshot
): WritingWorkshopSelection {
  return {
    ideaIds: availableIds(selection.ideaIds, snapshot.ideas),
    themeIds: availableIds(selection.themeIds, snapshot.themes),
    gapIds: availableIds(selection.gapIds, snapshot.gaps),
    contradictionIds: availableIds(selection.contradictionIds, snapshot.contradictions),
    workIds: availableIds(selection.workIds, snapshot.works),
    passageIds: availableIds(selection.passageIds, snapshot.passages),
    tutorRouteIds: availableIds(selection.tutorRouteIds, snapshot.tutorRoutes),
  };
}

function availableIds(selectedIds: string[], candidates: WritingWorkshopCandidateBase[]): string[] {
  const available = new Set(candidates.map((candidate) => candidate.id));
  return Array.from(new Set(selectedIds.filter((id) => available.has(id))));
}

function candidateIdsForTab(snapshot: WritingWorkshopSnapshot, tab: MaterialTab): string[] {
  switch (tab) {
    case 'ideas':
      return snapshot.ideas.map((item) => item.id);
    case 'themes':
      return snapshot.themes.map((item) => item.id);
    case 'gaps':
      return snapshot.gaps.map((item) => item.id);
    case 'contradictions':
      return snapshot.contradictions.map((item) => item.id);
    case 'works':
      return snapshot.works.map((item) => item.id);
    case 'passages':
      return snapshot.passages.map((item) => item.id);
    case 'routes':
      return snapshot.tutorRoutes.map((item) => item.id);
  }
}

function tabLabel(label: string, selected: number, total?: number): string {
  return total === undefined ? `${label} ${selected}` : `${label} ${selected}/${total}`;
}

function matrixColor(role: WritingWorkshopDraft['matrix'][number]['role']): 'neutral' | 'indigo' | 'green' | 'amber' | 'red' | 'cyan' {
  switch (role) {
    case 'contrast':
      return 'red';
    case 'gap':
      return 'amber';
    case 'method':
      return 'cyan';
    case 'definition':
      return 'indigo';
    case 'context':
      return 'neutral';
    case 'support':
      return 'green';
  }
}

function openMatrixCitation(value: string, setCitation: (target: CitationTarget) => void) {
  const citation = parseNodusCitation(value);
  if (citation) setCitation(citation);
}

function parseNodusCitation(value: string): Exclude<CitationTarget, null> | null {
  const idea = value.match(/^nodus:\/\/idea\/(.+)$/);
  if (idea) return { kind: 'idea', id: decodeURIComponent(idea[1]) };
  const work = value.match(/^nodus:\/\/work\/(.+)$/);
  if (work) return { kind: 'work', id: decodeURIComponent(work[1]) };
  const gap = value.match(/^nodus:\/\/gap\/(.+)$/);
  if (gap) return { kind: 'gap', id: decodeURIComponent(gap[1]) };
  const contradiction = value.match(/^nodus:\/\/contradiction\/(.+)$/);
  if (contradiction) return { kind: 'contradiction', id: decodeURIComponent(contradiction[1]) };
  const passage = value.match(/^nodus:\/\/passage\/(.+)$/);
  if (passage) return { kind: 'passage', id: decodeURIComponent(passage[1]) };
  return null;
}

function formatChars(value: number): string {
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

function formatSavedDraftDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}
