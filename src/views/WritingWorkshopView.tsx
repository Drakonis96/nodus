import { useCallback, useEffect, useMemo, useState } from 'react';
import type React from 'react';
import type {
  AppSettings,
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
import { confirm } from '../components/feedback';
import type { MarkdownCitation } from '../components/Markdown';
import { SourceCitationModal, type CitationTarget } from '../components/SourceCitationModal';
import { SaveToNotesModal } from '../components/SaveToNotesModal';
import { DraftResultMain, KIND_LABELS, SavedDraftsPanel, SupportMatrix } from './writingShared';
import { t, tx } from '../i18n';

/** Manual workshop kinds shown in the kind selector (deep_research has its own view). */
const WORKSHOP_KIND_ENTRIES = (Object.entries(KIND_LABELS) as [WritingWorkshopBrief['kind'], string][]).filter(
  ([id]) => id !== 'deep_research'
);

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

  const selectedCount = useMemo(() => countSelection(selection), [selection]);
  const tableCount = useMemo(() => (snapshot ? countSnapshot(snapshot) : 0), [snapshot]);
  const activeTabTotal = snapshot ? candidateIdsForTab(snapshot, activeTab).length : 0;
  const activeTabSelected = selection[TAB_SELECTION_KEYS[activeTab]].length;
  const hasModel = !!selectedModel;

  const refreshSavedDrafts = useCallback(async () => {
    setLoadingSavedDrafts(true);
    try {
      const all = await window.nodus.listWritingWorkshopDrafts();
      setSavedDrafts(all.filter((item) => item.brief.kind !== 'deep_research'));
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
    const ok = await confirm({
      title: t('Eliminar borrador'),
      message: t('¿Eliminar este borrador guardado? Esta acción no se puede deshacer.'),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
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
            <Icon name="edit" className="text-indigo-300" /> {t('Taller de escritura')}
          </h1>
          <p className="text-xs text-neutral-500 mt-1">{t('Del grafo a un borrador con fuentes verificables.')}</p>
        </div>
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
        <select
          className="input"
          value={brief.language ?? 'es'}
          onChange={(e) => setBrief((current) => ({ ...current, language: e.target.value as WritingWorkshopBrief['language'] }))}
        >
          <option value="es">Español</option>
          <option value="en">English</option>
          <option value="fr">Français</option>
          <option value="tr">Türkçe</option>
        </select>
        <ModelPicker settings={settings} value={selectedModel} onChange={setSelectedModel} compact />
        <div className="flex-1" />
        <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={() => setShowTutorial((value) => !value)}>
          <Icon name="help" />
          {showTutorial ? t('Ocultar tutorial') : t('Tutorial')}
        </button>
        <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={prepare} disabled={loadingMaterials}>
          <Icon name={loadingMaterials ? 'sync' : 'search'} className={loadingMaterials ? 'animate-spin' : ''} />
          {t('Preparar mesa')}
        </button>
        <button
          className="btn btn-primary gap-1.5"
          onClick={generate}
          disabled={!hasModel || generating || selectedCount === 0}
          title={!hasModel ? t('Configura un modelo de síntesis') : undefined}
        >
          <Icon name={generating ? 'sync' : 'wand'} className={generating ? 'animate-spin' : ''} />
          {t('Generar borrador')}
        </button>
      </header>

      <div className="border-b border-neutral-800 p-3">
        <textarea
          className="input w-full min-h-20 resize-y"
          value={brief.objective}
          onChange={(e) => setBrief((current) => ({ ...current, objective: e.target.value }))}
          placeholder={t('Describe el apartado que quieres construir...')}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select className="input text-xs" value={sourceScope} onChange={(e) => setSourceScope(e.target.value as ProjectSourceScope)}>
            <option value="none">{t('Sin origen de proyecto')}</option>
            <option value="project">{t('Proyecto completo')}</option>
            <option value="section">{t('Seccion del proyecto')}</option>
            <option value="chapter">{t('Capítulo del proyecto')}</option>
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
      </div>

      {showTutorial && <WritingWorkshopTutorial />}

      {(message || error) && (
        <div className={`px-4 py-2 text-sm border-b ${error ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200' : 'border-neutral-200 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400'}`}>
          {error ?? message}
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-[18rem_minmax(0,1fr)_20rem] max-xl:grid-cols-1">
        <aside className="border-r border-neutral-800 min-h-0 flex flex-col max-xl:border-r-0 max-xl:border-b">
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
        </aside>

        <main className="min-h-0 overflow-y-auto p-5">
          {!draft && (
            <div className="h-full flex items-center justify-center">
              <div className="max-w-md text-center text-neutral-500 text-sm">
                {generating
                  ? t('Generando borrador...')
                  : t('El borrador aparecerá aquí cuando selecciones materiales y lo generes.')}
              </div>
            </div>
          )}
          {draft && (
            <DraftResultMain
              draft={draft}
              exporting={exporting}
              savingDraft={savingDraft}
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
            onReuse={(saved) => void reuseSavedPrompt(saved)}
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
