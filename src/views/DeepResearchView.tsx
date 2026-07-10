// Deep Research — a gallery of saved reports (grid/list, search, sort), a
// chained generation queue, and an immersive reader that expands one report to
// full width with a back button to the gallery. The heavy lifting (generation,
// saving, citations) is shared with the Writing workshop via writingShared.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppSettings,
  DeepResearchProgress,
  DeepResearchSectionLimit,
  DeepResearchTargetLength,
  WritingWorkshopSavedDraft,
  DecorativeImage,
  DecorativeImageStyle,
} from '@shared/types';
import { DECORATIVE_IMAGE_STYLES } from '@shared/imageStyles';
import type { PendingGraphNavigationTarget } from '../navigation';
import { Icon, modelLabel } from '../components/ui';
import { ModelPicker } from '../components/ModelPicker';
import { confirm } from '../components/feedback';
import { SourceCitationModal, type CitationTarget } from '../components/SourceCitationModal';
import { SaveToNotesModal } from '../components/SaveToNotesModal';
import { DraftActionBar, DraftResultMain, SupportMatrix } from './writingShared';
import { DecorativeImageCard } from '../components/DecorativeImageCard';
import { FindInPage } from '../components/FindInPage';
import { t, tx } from '../i18n';
import {
  DEEP_RESEARCH_MAIN_JOB_KEY,
  clearFinishedDeepResearch,
  enqueueDeepResearch,
  getBackgroundJob,
  getDeepResearchQueue,
  removeQueuedDeepResearch,
  subscribeBackgroundJob,
  subscribeDeepResearchQueue,
  type DeepResearchGenerationJob,
  type DeepResearchQueueItem,
} from '../backgroundJobs';
import { useFeatureModel } from '../hooks/useFeatureModel';

const DEEP_TARGET_LABELS: Record<DeepResearchTargetLength, string> = {
  adaptive: 'Adaptativo (según corpus)',
  concise: 'Conciso (5–8 pág.)',
  standard: 'Estándar (9–14 pág.)',
  exhaustive: 'Exhaustivo (15–20 pág.)',
};

const DEEP_SECTION_OPTIONS: { value: DeepResearchSectionLimit; label: string }[] = [
  { value: 'auto', label: 'Secciones: Auto (IA decide)' },
  { value: 4, label: 'Máx. 4 secciones' },
  { value: 5, label: 'Máx. 5 secciones' },
  { value: 6, label: 'Máx. 6 secciones' },
  { value: 8, label: 'Máx. 8 secciones' },
  { value: 10, label: 'Máx. 10 secciones' },
];

type SortKey = 'recent' | 'oldest' | 'title';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export function DeepResearchView({
  settings,
  onOpenGraph,
}: {
  settings: AppSettings;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
}) {
  const [mode, setMode] = useState<'gallery' | 'reader'>('gallery');

  // Composer (new report) state.
  const [composerOpen, setComposerOpen] = useState(false);
  const [objective, setObjective] = useState('');
  const [language, setLanguage] = useState<'es' | 'en' | 'fr'>('es');
  const [selectedModel, setSelectedModel] = useFeatureModel(settings, 'deepResearchModel');
  const [deepTarget, setDeepTarget] = useState<DeepResearchTargetLength>('adaptive');
  const [deepSectionLimit, setDeepSectionLimit] = useState<DeepResearchSectionLimit>('auto');
  const [includeImage, setIncludeImage] = useState(false);
  const [imageStyle, setImageStyle] = useState<DecorativeImageStyle>(settings.imageStyle);

  // Data.
  const [savedDrafts, setSavedDrafts] = useState<WritingWorkshopSavedDraft[]>([]);
  const [loadingSavedDrafts, setLoadingSavedDrafts] = useState(false);
  const [queue, setQueue] = useState<DeepResearchQueueItem[]>(() => getDeepResearchQueue());
  const [deepJob, setDeepJob] = useState<DeepResearchGenerationJob | null>(() =>
    getBackgroundJob(DEEP_RESEARCH_MAIN_JOB_KEY)
  );

  // Gallery controls.
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showTutorial, setShowTutorial] = useState(false);

  // Reader + shared modals.
  const [openDraft, setOpenDraft] = useState<WritingWorkshopSavedDraft | null>(null);
  const [showMatrix, setShowMatrix] = useState(false);
  const [citation, setCitation] = useState<CitationTarget>(null);
  const [savingToNotes, setSavingToNotes] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasModel = !!selectedModel;
  const deepRunning = deepJob?.status === 'running';
  const deepProgress = deepJob?.progress ?? null;

  useEffect(() => subscribeBackgroundJob(DEEP_RESEARCH_MAIN_JOB_KEY, setDeepJob), []);
  useEffect(() => subscribeDeepResearchQueue(setQueue), []);

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

  // Surface each finished report in the gallery as soon as it lands.
  const lastCompletedRef = useRef<string | null>(null);
  useEffect(() => {
    if (deepJob?.status !== 'completed' || deepJob.id === lastCompletedRef.current) return;
    lastCompletedRef.current = deepJob.id;
    const saved = deepJob.result?.savedDraft ?? null;
    if (saved) {
      setSavedDrafts((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setOpenDraft((current) => (current?.id === saved.id ? saved : current));
    } else {
      void refreshSavedDrafts();
    }
  }, [deepJob, refreshSavedDrafts]);

  const submitComposer = () => {
    if (!objective.trim()) {
      setError(t('Escribe la idea de investigación antes de generar el informe.'));
      return;
    }
    enqueueDeepResearch({
      objective: objective.trim(),
      language,
      targetLength: deepTarget,
      sectionLimit: deepSectionLimit,
      model: selectedModel,
      decorativeImage: { enabled: includeImage, style: imageStyle },
    });
    setComposerOpen(false);
    setObjective('');
    setError(null);
    setMessage(t('Informe añadido a la cola. Se generará en segundo plano.'));
  };

  const openReader = (saved: WritingWorkshopSavedDraft) => {
    setOpenDraft(saved);
    setMode('reader');
    setShowMatrix(false);
    setError(null);
    setMessage(null);
  };

  const backToGallery = () => {
    setMode('gallery');
    setOpenDraft(null);
    void refreshSavedDrafts();
  };

  const reusePrompt = (saved: WritingWorkshopSavedDraft) => {
    setObjective(saved.brief.objective);
    if (saved.brief.language) setLanguage(saved.brief.language as 'es' | 'en' | 'fr');
    if (saved.model) setSelectedModel(saved.model);
    setComposerOpen(true);
  };

  const deleteDraft = async (saved: WritingWorkshopSavedDraft) => {
    const ok = await confirm({
      title: t('Eliminar informe'),
      message: t('¿Eliminar este informe guardado? Esta acción no se puede deshacer.'),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    try {
      await window.nodus.deleteWritingWorkshopDraft(saved.id);
      setSavedDrafts((current) => current.filter((item) => item.id !== saved.id));
      if (openDraft?.id === saved.id) backToGallery();
      setMessage(t('Informe eliminado.'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const exportDraft = async (format: 'markdown' | 'pdf') => {
    if (!openDraft) return;
    setExporting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await window.nodus.exportWritingWorkshopDraft({ draft: openDraft.draft, format });
      if (result) setMessage(`${t('Exportado')}: ${result.path}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const copyDraft = async () => {
    if (!openDraft) return;
    await navigator.clipboard.writeText(openDraft.draft.draftMarkdown);
    setMessage(t('Borrador copiado.'));
  };

  const onImageChange = (image: DecorativeImage) => {
    if (!openDraft) return;
    const next = { ...openDraft, image };
    setOpenDraft(next);
    setSavedDrafts((current) => current.map((item) => (item.id === next.id ? next : item)));
  };

  const visibleDrafts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? savedDrafts.filter(
          (d) => d.title.toLowerCase().includes(q) || d.brief.objective.toLowerCase().includes(q)
        )
      : savedDrafts;
    const sorted = [...filtered];
    if (sortKey === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortKey === 'oldest') sorted.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    else sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return sorted;
  }, [savedDrafts, search, sortKey]);

  const activeQueue = queue.filter((item) => item.status === 'queued' || item.status === 'running');
  const finishedQueue = queue.filter((item) => item.status === 'failed');

  if (mode === 'reader' && openDraft) {
    return (
      <>
        <ReaderView
          saved={openDraft}
          settings={settings}
          showMatrix={showMatrix}
          exporting={exporting}
          message={message}
          error={error}
          onToggleMatrix={() => setShowMatrix((v) => !v)}
          onBack={backToGallery}
          onCopy={() => void copyDraft()}
          onSaveToNotes={() => setSavingToNotes(true)}
          onExport={(format) => void exportDraft(format)}
          onCitation={setCitation}
          onImageChange={onImageChange}
        />
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
        {savingToNotes && (
          <SaveToNotesModal
            content={`# ${openDraft.draft.title}\n\n${openDraft.draft.abstract ? `${openDraft.draft.abstract}\n\n` : ''}${openDraft.draft.draftMarkdown}`}
            defaultTitle={openDraft.draft.title}
            kind="writing"
            source={{ origin: 'writing', model: openDraft.model, ref: 'deep_research' }}
            allowProjectLink
            onClose={() => setSavingToNotes(false)}
          />
        )}
      </>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <header className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-4 py-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Icon name="compass" className="text-indigo-300" /> {t('Deep Research')}
          </h1>
          <p className="mt-0.5 text-xs text-neutral-500">
            {t('Tu biblioteca de informes académicos, generados en cola y citando todo el corpus.')}
          </p>
        </div>
        <div className="flex-1" />
        <button className="btn btn-ghost gap-1.5 border border-neutral-700" onClick={() => setShowTutorial((v) => !v)}>
          <Icon name="help" /> {showTutorial ? t('Ocultar tutorial') : t('Tutorial')}
        </button>
        <button className="btn btn-primary gap-1.5" onClick={() => setComposerOpen(true)}>
          <Icon name="plus" /> {t('Nuevo informe')}
        </button>
      </header>

      {showTutorial && <DeepResearchTutorial />}

      {(message || error) && (
        <div className={`px-4 py-2 text-sm border-b ${error ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200' : 'border-neutral-200 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400'}`}>
          {error ?? message}
        </div>
      )}

      {(activeQueue.length > 0 || finishedQueue.length > 0) && (
        <QueueStrip
          active={activeQueue}
          failed={finishedQueue}
          progress={deepProgress}
          running={deepRunning}
          onRemove={(id) => removeQueuedDeepResearch(id)}
          onClearFinished={() => clearFinishedDeepResearch()}
        />
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-2.5">
        <div className="relative min-w-[14rem] flex-1 max-w-md">
          <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            className="input input-with-leading-icon w-full !py-1.5 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('Buscar entre tus informes…')}
          />
        </div>
        <select className="input !py-1.5 text-xs" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
          <option value="recent">{t('Más recientes')}</option>
          <option value="oldest">{t('Más antiguos')}</option>
          <option value="title">{t('Por título (A–Z)')}</option>
        </select>
        <div className="flex overflow-hidden rounded-lg border border-neutral-700">
          <button
            className={`px-2.5 py-1.5 text-xs ${viewMode === 'grid' ? 'bg-indigo-900/40 text-indigo-200' : 'text-neutral-400 hover:bg-neutral-900'}`}
            onClick={() => setViewMode('grid')}
            title={t('Vista mosaico')}
          >
            <Icon name="grid" size={14} />
          </button>
          <button
            className={`px-2.5 py-1.5 text-xs ${viewMode === 'list' ? 'bg-indigo-900/40 text-indigo-200' : 'text-neutral-400 hover:bg-neutral-900'}`}
            onClick={() => setViewMode('list')}
            title={t('Vista lista')}
          >
            <Icon name="list" size={14} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {visibleDrafts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Icon name="compass" size={28} className="text-neutral-600" />
            <div className="max-w-md text-sm text-neutral-500">
              {loadingSavedDrafts
                ? t('Cargando informes…')
                : search.trim()
                  ? t('Ningún informe coincide con tu búsqueda.')
                  : t('Aún no hay informes. Crea el primero y quedará aquí, listo para leerse a pantalla completa.')}
            </div>
            {!search.trim() && !loadingSavedDrafts && (
              <button className="btn btn-primary gap-1.5" onClick={() => setComposerOpen(true)}>
                <Icon name="plus" /> {t('Nuevo informe')}
              </button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-3 gap-4 max-2xl:grid-cols-2 max-lg:grid-cols-1">
            {visibleDrafts.map((saved) => (
              <DraftGridCard
                key={saved.id}
                saved={saved}
                settings={settings}
                onOpen={() => openReader(saved)}
                onReuse={() => reusePrompt(saved)}
                onDelete={() => void deleteDraft(saved)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {visibleDrafts.map((saved) => (
              <DraftListRow
                key={saved.id}
                saved={saved}
                settings={settings}
                onOpen={() => openReader(saved)}
                onReuse={() => reusePrompt(saved)}
                onDelete={() => void deleteDraft(saved)}
              />
            ))}
          </div>
        )}
      </div>

      {composerOpen && (
        <ComposerModal
          settings={settings}
          objective={objective}
          language={language}
          model={selectedModel}
          target={deepTarget}
          sectionLimit={deepSectionLimit}
          includeImage={includeImage}
          imageStyle={imageStyle}
          hasModel={hasModel}
          queuedCount={activeQueue.length}
          onObjective={setObjective}
          onLanguage={setLanguage}
          onModel={setSelectedModel}
          onTarget={setDeepTarget}
          onSectionLimit={setDeepSectionLimit}
          onIncludeImage={setIncludeImage}
          onImageStyle={setImageStyle}
          onSubmit={submitComposer}
          onClose={() => setComposerOpen(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue strip
// ─────────────────────────────────────────────────────────────────────────────

function QueueStrip({
  active,
  failed,
  progress,
  running,
  onRemove,
  onClearFinished,
}: {
  active: DeepResearchQueueItem[];
  failed: DeepResearchQueueItem[];
  progress: DeepResearchProgress | null;
  running: boolean;
  onRemove: (id: string) => void;
  onClearFinished: () => void;
}) {
  return (
    <div className="border-b border-neutral-800 bg-indigo-950/15 px-4 py-2.5">
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-indigo-300">
        <Icon name={running ? 'sync' : 'layers'} size={12} className={running ? 'animate-spin' : ''} />
        {tx('Cola de generación · {n} en curso', { n: active.length })}
        {failed.length > 0 && (
          <button className="ml-auto text-[11px] font-medium text-neutral-500 hover:text-neutral-300" onClick={onClearFinished}>
            {t('Limpiar fallidos')}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {active.map((item) => (
          <div key={item.id} className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950/40 px-2.5 py-1.5 text-xs">
            <Icon
              name={item.status === 'running' ? 'sync' : 'clock'}
              size={12}
              className={item.status === 'running' ? 'animate-spin text-indigo-300' : 'text-neutral-500'}
            />
            <span className="min-w-0 flex-1 truncate text-neutral-300" title={item.title}>{item.title}</span>
            {item.status === 'running' ? (
              <span className="shrink-0 text-[11px] text-indigo-300">
                {progress?.message ?? t('Generando…')}
                {progress?.pagesSoFar != null && ` · ~${progress.pagesSoFar} ${t('pág.')}`}
              </span>
            ) : (
              <button className="shrink-0 text-neutral-500 hover:text-red-400" onClick={() => onRemove(item.id)} title={t('Quitar de la cola')}>
                <Icon name="x" size={13} />
              </button>
            )}
          </div>
        ))}
        {failed.map((item) => (
          <div key={item.id} className="flex items-center gap-2 rounded-md border border-red-900/50 bg-red-950/20 px-2.5 py-1.5 text-xs">
            <Icon name="alert" size={12} className="text-red-400" />
            <span className="min-w-0 flex-1 truncate text-red-300" title={item.error ?? item.title}>{item.title}</span>
            <span className="shrink-0 text-[11px] text-red-400/80">{t('Falló')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gallery cards
// ─────────────────────────────────────────────────────────────────────────────

function DraftGridCard({
  saved,
  settings,
  onOpen,
  onReuse,
  onDelete,
}: {
  saved: WritingWorkshopSavedDraft;
  settings: AppSettings;
  onOpen: () => void;
  onReuse: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="card group flex flex-col overflow-hidden p-0 transition-colors hover:border-indigo-700/60">
      <button
        className="relative block h-40 w-full overflow-hidden bg-gradient-to-br from-indigo-950/30 to-neutral-900"
        onClick={onOpen}
        title={t('Abrir a pantalla completa')}
      >
        <div className="absolute inset-0 flex items-center justify-center text-neutral-700">
          <Icon name="compass" size={30} />
        </div>
        <DecorativeImageCard
          entityKind="deep_research"
          entityId={saved.id}
          image={saved.image}
          defaultStyle={settings.imageStyle}
          thumbnail
          className="absolute inset-0 !h-full !rounded-none"
        />
      </button>
      <div className="flex flex-1 flex-col p-3">
        <button className="text-left" onClick={onOpen}>
          <div className="line-clamp-2 text-sm font-medium text-neutral-200" title={saved.title}>{saved.title}</div>
        </button>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-neutral-500">
          <Icon name="clock" size={11} /> {formatDate(saved.updatedAt)}
          {saved.model && <><span>·</span><span className="truncate">{modelLabel(saved.model)}</span></>}
        </div>
        <div className="mt-3 flex items-center gap-1.5">
          <button className="btn btn-primary !py-1 gap-1 text-xs" onClick={onOpen}>
            <Icon name="book" size={12} /> {t('Leer')}
          </button>
          <button className="btn btn-ghost !py-1 gap-1 border border-neutral-700 text-xs" onClick={onReuse} title={t('Reutilizar la idea para un informe nuevo')}>
            <Icon name="refresh" size={12} />
          </button>
          <div className="flex-1" />
          <button className="btn btn-ghost !py-1 text-xs text-neutral-500 hover:text-red-400" onClick={onDelete} title={t('Eliminar informe')}>
            <Icon name="trash" size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

function DraftListRow({
  saved,
  settings,
  onOpen,
  onReuse,
  onDelete,
}: {
  saved: WritingWorkshopSavedDraft;
  settings: AppSettings;
  onOpen: () => void;
  onReuse: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="card flex items-center gap-3 p-2.5 transition-colors hover:border-indigo-700/60">
      <button
        className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-indigo-950/30 to-neutral-900"
        onClick={onOpen}
        title={t('Abrir a pantalla completa')}
      >
        <div className="absolute inset-0 flex items-center justify-center text-neutral-700">
          <Icon name="compass" size={16} />
        </div>
        <DecorativeImageCard
          entityKind="deep_research"
          entityId={saved.id}
          image={saved.image}
          defaultStyle={settings.imageStyle}
          thumbnail
          className="absolute inset-0 !h-full !rounded-md"
        />
      </button>
      <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <div className="truncate text-sm font-medium text-neutral-200" title={saved.title}>{saved.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-neutral-500">
          <Icon name="clock" size={11} /> {formatDate(saved.updatedAt)}
          {saved.model && <><span>·</span><span className="truncate">{modelLabel(saved.model)}</span></>}
        </div>
      </button>
      <button className="btn btn-primary !py-1 gap-1 text-xs" onClick={onOpen}>
        <Icon name="book" size={12} /> {t('Leer')}
      </button>
      <button className="btn btn-ghost !py-1 gap-1 border border-neutral-700 text-xs" onClick={onReuse} title={t('Reutilizar la idea para un informe nuevo')}>
        <Icon name="refresh" size={12} />
      </button>
      <button className="btn btn-ghost !py-1 text-xs text-neutral-500 hover:text-red-400" onClick={onDelete} title={t('Eliminar informe')}>
        <Icon name="trash" size={12} />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reader — immersive full-report view
// ─────────────────────────────────────────────────────────────────────────────

function ReaderView({
  saved,
  settings,
  showMatrix,
  exporting,
  message,
  error,
  onToggleMatrix,
  onBack,
  onCopy,
  onSaveToNotes,
  onExport,
  onCitation,
  onImageChange,
}: {
  saved: WritingWorkshopSavedDraft;
  settings: AppSettings;
  showMatrix: boolean;
  exporting: boolean;
  message: string | null;
  error: string | null;
  onToggleMatrix: () => void;
  onBack: () => void;
  onCopy: () => void;
  onSaveToNotes: () => void;
  onExport: (format: 'markdown' | 'pdf') => void;
  onCitation: (target: CitationTarget) => void;
  onImageChange: (image: DecorativeImage) => void;
}) {
  const mainRef = useRef<HTMLElement | null>(null);
  return (
    <div className="h-full flex flex-col min-h-0">
      <header className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-2.5">
        <button className="btn btn-ghost gap-1.5" onClick={onBack}>
          <Icon name="chevronLeft" /> {t('Volver a la galería')}
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-neutral-100" title={saved.title}>{saved.title}</div>
          <div className="text-[11px] text-neutral-500">{formatDate(saved.updatedAt)}</div>
        </div>
        <DraftActionBar
          exporting={exporting}
          savingDraft={false}
          draftSaved
          onCopy={onCopy}
          onSaveDraft={() => undefined}
          onSaveToNotes={onSaveToNotes}
          onExport={onExport}
        />
        <button
          className={`btn btn-ghost gap-1.5 border ${showMatrix ? 'border-indigo-700/60 text-indigo-200' : 'border-neutral-700'}`}
          onClick={onToggleMatrix}
        >
          <Icon name="layers" size={13} /> {t('Matriz de apoyo')}
        </button>
      </header>

      {(message || error) && (
        <div className={`px-4 py-2 text-sm border-b ${error ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200' : 'border-neutral-200 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400'}`}>
          {error ?? message}
        </div>
      )}

      <div className="min-h-0 flex-1 flex">
        <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto px-6 py-6 max-md:px-4">
          <div className="mx-auto max-w-3xl space-y-6">
            <DecorativeImageCard
              entityKind="deep_research"
              entityId={saved.id}
              image={saved.image}
              defaultStyle={settings.imageStyle}
              interactive
              onChange={onImageChange}
            />
            <DraftResultMain
              draft={saved.draft}
              exporting={exporting}
              savingDraft={false}
              draftSaved
              hideActions
              justify
              onCopy={onCopy}
              onSaveDraft={() => undefined}
              onSaveToNotes={onSaveToNotes}
              onExport={onExport}
              onCitation={onCitation}
            />
          </div>
        </main>
        {showMatrix && (
          <aside className="w-80 shrink-0 overflow-y-auto border-l border-neutral-800 p-4 max-lg:hidden">
            <SupportMatrix draft={saved.draft} onCitation={onCitation} />
          </aside>
        )}
      </div>
      <FindInPage targetRef={mainRef} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Composer — the new-report form (modal)
// ─────────────────────────────────────────────────────────────────────────────

function ComposerModal({
  settings,
  objective,
  language,
  model,
  target,
  sectionLimit,
  includeImage,
  imageStyle,
  hasModel,
  queuedCount,
  onObjective,
  onLanguage,
  onModel,
  onTarget,
  onSectionLimit,
  onIncludeImage,
  onImageStyle,
  onSubmit,
  onClose,
}: {
  settings: AppSettings;
  objective: string;
  language: 'es' | 'en' | 'fr';
  model: AppSettings['deepResearchModel'];
  target: DeepResearchTargetLength;
  sectionLimit: DeepResearchSectionLimit;
  includeImage: boolean;
  imageStyle: DecorativeImageStyle;
  hasModel: boolean;
  queuedCount: number;
  onObjective: (v: string) => void;
  onLanguage: (v: 'es' | 'en' | 'fr') => void;
  onModel: (m: AppSettings['deepResearchModel']) => void;
  onTarget: (v: DeepResearchTargetLength) => void;
  onSectionLimit: (v: DeepResearchSectionLimit) => void;
  onIncludeImage: (v: boolean) => void;
  onImageStyle: (v: DecorativeImageStyle) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('Nuevo informe')}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-neutral-700 bg-white shadow-2xl dark:bg-neutral-950"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <Icon name="compass" className="text-indigo-500 dark:text-indigo-300" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t('Nuevo informe')}</h2>
            <p className="text-xs text-neutral-500">{t('El informe desarrolla tu idea por completo, citando todo el corpus.')}</p>
          </div>
          <button className="btn btn-ghost px-2" onClick={onClose} aria-label={t('Cerrar')}>
            <Icon name="x" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <textarea
            className="input min-h-28 w-full resize-y"
            value={objective}
            autoFocus
            onChange={(e) => onObjective(e.target.value)}
            placeholder={t('Escribe la idea o pregunta de investigación. El informe la desarrollará por completo, citando todas las obras del corpus.')}
          />
          <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
            <select className="input text-sm" value={target} onChange={(e) => onTarget(e.target.value as DeepResearchTargetLength)}>
              {Object.entries(DEEP_TARGET_LABELS).map(([id, label]) => (
                <option key={id} value={id}>{t(label)}</option>
              ))}
            </select>
            <select
              className="input text-sm"
              value={String(sectionLimit)}
              onChange={(e) => onSectionLimit(e.target.value === 'auto' ? 'auto' : (Number(e.target.value) as DeepResearchSectionLimit))}
            >
              {DEEP_SECTION_OPTIONS.map((option) => (
                <option key={String(option.value)} value={String(option.value)}>{t(option.label)}</option>
              ))}
            </select>
            <select className="input text-sm" value={language} onChange={(e) => onLanguage(e.target.value as 'es' | 'en' | 'fr')}>
              <option value="es">Español</option>
              <option value="en">English</option>
              <option value="fr">Français</option>
            </select>
            <ModelPicker settings={settings} value={model} onChange={onModel} compact />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={`rounded-full border px-2.5 py-1 text-xs ${includeImage ? 'border-indigo-600 bg-indigo-900/40 text-indigo-200' : 'border-neutral-700 text-neutral-500'}`}
              onClick={() => onIncludeImage(!includeImage)}
              title={t('La imagen se genera una sola vez después de guardar el informe')}
            >
              <Icon name={includeImage ? 'check' : 'minus'} size={11} className="mr-1" /> {t('Imagen decorativa')}
            </button>
            {includeImage && (
              <select className="input !py-1 text-xs" value={imageStyle} onChange={(e) => onImageStyle(e.target.value as DecorativeImageStyle)}>
                {DECORATIVE_IMAGE_STYLES.map((style) => <option key={style.id} value={style.id}>{t(style.label)}</option>)}
              </select>
            )}
          </div>
          <p className="text-[11px] text-neutral-500">
            {queuedCount > 0
              ? tx('Se añadirá a la cola ({n} en curso) y se generará cuando termine el anterior.', { n: queuedCount })
              : t('Se genera en segundo plano: puedes cerrar esto y seguir trabajando.')}
          </p>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
          <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={onClose}>{t('Cancelar')}</button>
          <button
            className="btn btn-primary gap-1.5"
            onClick={onSubmit}
            disabled={!hasModel || !objective.trim()}
            title={!hasModel ? t('Configura un modelo de síntesis') : undefined}
          >
            <Icon name="plus" /> {t('Añadir a la cola')}
          </button>
        </footer>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tutorial
// ─────────────────────────────────────────────────────────────────────────────

function DeepResearchTutorial() {
  return (
    <section className="border-b border-neutral-800 bg-white/95 px-4 py-3 dark:bg-neutral-950/80">
      <div className="grid grid-cols-4 gap-3 max-2xl:grid-cols-2 max-md:grid-cols-1">
        <TutorialStep
          icon="edit"
          title={t('1. Plantea la idea')}
          body={t('Pulsa «Nuevo informe» y escribe la pregunta o idea. El informe la convierte en un texto de varias páginas, no en una respuesta corta.')}
        />
        <TutorialStep
          icon="layers"
          title={t('2. Encola los que quieras')}
          body={t('Añade varios informes a la cola: se generan en cadena, uno tras otro, mientras sigues trabajando.')}
        />
        <TutorialStep
          icon="compass"
          title={t('3. Cobertura del corpus')}
          body={t('Nodus recorre todo el corpus indexado, planifica las secciones y redacta guiado por la cobertura, citando cada obra sin que tengas que seleccionarla.')}
        />
        <TutorialStep
          icon="book"
          title={t('4. Lee a pantalla completa')}
          body={t('Abre cualquier informe de la galería para leerlo a pantalla completa, revisar sus citas y exportarlo a Markdown o PDF.')}
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
