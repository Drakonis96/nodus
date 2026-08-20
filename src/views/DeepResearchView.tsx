// Deep Research — a gallery of saved reports (grid/list, search, sort), a
// chained generation queue, and an immersive reader that expands one report to
// full width with a back button to the gallery. The heavy lifting (generation,
// saving, citations) is shared with the Writing workshop via writingShared.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  AppSettings,
  DeepResearchArchiveFormat,
  DeepResearchJobRecord,
  DeepResearchOutlineSection,
  DeepResearchSectionLimit,
  DeepResearchTargetLength,
  Person,
  PromptLanguage,
  WritingWorkshopSavedDraft,
  DecorativeImage,
  DecorativeImageStyle,
  ContentTranslation,
  WritingDraftAnnotation,
  WritingDraftAnnotationColor,
  WritingDraftAnnotationInput,
} from '@shared/types';
import type { StudyDeepResearchAudience } from '@shared/studyDeepResearchAudience';
import { DECORATIVE_IMAGE_STYLES } from '@shared/imageStyles';
import { toReadingCopy } from '@shared/readingCopy';
import { stripLeadingAbstract } from '@shared/writingDocument';
import type { DeepResearchSnapshot } from '../app/viewSnapshots';
import { useListPlacement } from '../listPlacement';
import { useReadingPlace, type ReadingPlace } from '../readingPlace';
import { HoverLabelButton, Icon, RestoringPane, modelLabel } from '../components/ui';
import { SectionHeader } from '../components/SectionHeader';
import { ModelPicker } from '../components/ModelPicker';
import { confirm } from '../components/feedback';
import { SourceCitationModal, type CitationTarget, type OpenCitationLibraryWork } from '../components/SourceCitationModal';
import { SaveToNotesModal } from '../components/SaveToNotesModal';
import { TranslationModal } from '../components/TranslationModal';
import { Markdown } from '../components/Markdown';
import { DraftActionBar, DraftResultMain, SupportMatrix } from './writingShared';
import { DeepResearchQueueStrip, type QueueStripItem } from '../components/DeepResearchQueueStrip';
import { DecorativeImageCard } from '../components/DecorativeImageCard';
import { AudioPanel } from '../components/AudioPanel';
import { FindInPage } from '../components/FindInPage';
import { NodiViewContextSource } from '../components/NodiViewContextSource';
import {
  ReaderHighlighterControl,
  ReaderSelectionActions,
  type ReaderSelectionActionsHandle,
} from '../components/ReaderSelectionActions';
import { t, tx, getActiveLang } from '../i18n';
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

// Exported because the section's snapshot stores them; the unions stay declared here,
// next to the selects that produce them.
export type SortKey = 'recent' | 'oldest' | 'title';
export type ReadFilter = 'all' | 'read' | 'unread';

/**
 * One surface, four readers. The machinery is identical — queue, gallery, reader,
 * citations, audio, export — but the artefact is not: an academic report, a family
 * history, a study report and a teaching unit are different things, and calling all
 * four "informe" is what made the teaching section read as somebody else's feature.
 * Only the wording lives here; every variant runs the same code path.
 */
type DeepResearchVariant = 'academic' | 'genealogy' | 'study' | 'unit';

interface DeepResearchCopy {
  heading: string;
  subtitle: string;
  newAction: string;
  composerSubtitle: string;
  objectivePlaceholder: string;
  missingObjective: string;
  queuedToast: string;
  deleteTitle: string;
  deleteMessage: string;
  deletedToast: string;
  searchPlaceholder: string;
  loading: string;
  noMatch: string;
  empty: string;
  tutorial: { icon: string; title: string; body: string }[];
}

const REPORT_TUTORIAL = [
  {
    icon: 'edit',
    title: '1. Plantea la idea',
    body: 'Pulsa «Nuevo informe» y escribe la pregunta o idea. El informe la convierte en un texto de varias páginas, no en una respuesta corta.',
  },
  {
    icon: 'layers',
    title: '2. Encola los que quieras',
    body: 'Añade varios informes a la cola: se generan en cadena, uno tras otro, mientras sigues trabajando.',
  },
  {
    icon: 'compass',
    title: '3. Cobertura del corpus',
    body: 'Nodus recorre todo el corpus indexado, planifica las secciones y redacta guiado por la cobertura, citando cada obra sin que tengas que seleccionarla.',
  },
  {
    icon: 'book',
    title: '4. Lee a pantalla completa',
    body: 'Abre cualquier informe de la galería para leerlo a pantalla completa, revisar sus citas y exportarlo a Markdown o PDF.',
  },
];

const DEEP_RESEARCH_COPY: Record<DeepResearchVariant, DeepResearchCopy> = {
  academic: {
    heading: 'Deep Research',
    subtitle: 'Tu biblioteca de informes académicos, generados en cola y citando todo el corpus.',
    newAction: 'Nuevo informe',
    composerSubtitle: 'El informe desarrolla tu idea por completo, citando todo el corpus.',
    objectivePlaceholder: 'Escribe la idea o pregunta de investigación. El informe la desarrollará por completo, citando todas las obras del corpus.',
    missingObjective: 'Escribe la idea de investigación antes de generar el informe.',
    queuedToast: 'Informe añadido a la cola. Se generará en segundo plano.',
    deleteTitle: 'Eliminar informe',
    deleteMessage: '¿Eliminar este informe guardado? Esta acción no se puede deshacer.',
    deletedToast: 'Informe eliminado.',
    searchPlaceholder: 'Buscar entre tus informes…',
    loading: 'Cargando informes…',
    noMatch: 'Ningún informe coincide con tu búsqueda.',
    empty: 'Aún no hay informes. Crea el primero y quedará aquí, listo para leerse a pantalla completa.',
    tutorial: REPORT_TUTORIAL,
  },
  genealogy: {
    heading: 'Deep Research',
    subtitle: 'Tu biblioteca de informes de historia familiar, generados en cola y citando tus documentos y fuentes.',
    newAction: 'Nuevo informe',
    composerSubtitle: 'El informe reconstruye la historia familiar a partir de tus documentos y fuentes, citándolos.',
    objectivePlaceholder: 'Escribe el tema o la pregunta (p. ej. «Historia de la familia» o «La migración a la ciudad»). El informe la desarrollará citando tus documentos y fuentes.',
    missingObjective: 'Escribe la idea de investigación antes de generar el informe.',
    queuedToast: 'Informe añadido a la cola. Se generará en segundo plano.',
    deleteTitle: 'Eliminar informe',
    deleteMessage: '¿Eliminar este informe guardado? Esta acción no se puede deshacer.',
    deletedToast: 'Informe eliminado.',
    searchPlaceholder: 'Buscar entre tus informes…',
    loading: 'Cargando informes…',
    noMatch: 'Ningún informe coincide con tu búsqueda.',
    empty: 'Aún no hay informes. Crea el primero y quedará aquí, listo para leerse a pantalla completa.',
    tutorial: REPORT_TUTORIAL,
  },
  study: {
    heading: 'Deep Research',
    subtitle: 'Informes didácticos basados en tus materiales, apuntes y transcripciones indexados.',
    newAction: 'Nuevo informe',
    composerSubtitle: 'El informe enseña el tema paso a paso usando y citando tus materiales de estudio.',
    objectivePlaceholder: 'Escribe el tema o pregunta que quieres comprender. El informe explicará los conceptos difíciles, ejemplos y conexiones usando tus materiales.',
    missingObjective: 'Escribe la idea de investigación antes de generar el informe.',
    queuedToast: 'Informe añadido a la cola. Se generará en segundo plano.',
    deleteTitle: 'Eliminar informe',
    deleteMessage: '¿Eliminar este informe guardado? Esta acción no se puede deshacer.',
    deletedToast: 'Informe eliminado.',
    searchPlaceholder: 'Buscar entre tus informes…',
    loading: 'Cargando informes…',
    noMatch: 'Ningún informe coincide con tu búsqueda.',
    empty: 'Aún no hay informes. Crea el primero y quedará aquí, listo para leerse a pantalla completa.',
    tutorial: REPORT_TUTORIAL,
  },
  unit: {
    heading: 'Diseño de unidades',
    subtitle: 'Diseña unidades para el docente o apuntes para entregar al alumnado, siempre desde tus fuentes.',
    newAction: 'Nueva unidad',
    composerSubtitle: 'Elige si necesitas una planificación para impartir la lección o apuntes listos para entregar.',
    objectivePlaceholder: 'Escribe el tema de la unidad y, si quieres, para qué grupo o nivel. La unidad se desarrollará con tus materiales, citándolos.',
    missingObjective: 'Escribe el tema de la unidad antes de generarla.',
    queuedToast: 'Unidad añadida a la cola. Se generará en segundo plano.',
    deleteTitle: 'Eliminar unidad',
    deleteMessage: '¿Eliminar esta unidad guardada? Esta acción no se puede deshacer.',
    deletedToast: 'Unidad eliminada.',
    searchPlaceholder: 'Buscar entre tus unidades…',
    loading: 'Cargando unidades…',
    noMatch: 'Ninguna unidad coincide con tu búsqueda.',
    empty: 'Aún no hay unidades. Crea la primera y quedará aquí, lista para leerse a pantalla completa.',
    tutorial: [
      {
        icon: 'edit',
        title: '1. Plantea el tema',
        body: 'Pulsa «Nueva unidad» y escribe el tema. Nodus lo convierte en una unidad de varias páginas escrita para dar clase, no en una respuesta corta.',
      },
      {
        icon: 'list',
        title: '2. Decide la estructura',
        body: 'Deja que la IA proponga las partes o fíjalas tú: eliges cuántas son, les pones título y, si quieres, indicas en qué debe centrarse cada una.',
      },
      {
        icon: 'compass',
        title: '3. Tus materiales y tus ideas',
        body: 'Nodus recorre los materiales indexados y la red de ideas extraída de ellos, y redacta citando cada material sin que tengas que seleccionarlo.',
      },
      {
        icon: 'book',
        title: '4. Lee a pantalla completa',
        body: 'Abre cualquier unidad de la galería para leerla a pantalla completa, revisar sus citas y exportarla a Markdown o PDF.',
      },
    ],
  },
};

/** Section counts offered when the teacher fixes the structure. */
const UNIT_SECTION_COUNTS = [2, 3, 4, 5, 6, 7, 8];

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(getActiveLang(), { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export function DeepResearchView({
  settings,
  isGenealogy = false,
  isStudy = false,
  isTeaching = false,
  snapshot,
  onSnapshotChange,
  onOpenLibraryWork,
  onOpenStudyDocument,
  onOpenStudyMaterial,
  onOpenStudyRecording,
}: {
  settings: AppSettings;
  isGenealogy?: boolean;
  isStudy?: boolean;
  /** Teaching vaults: Unit design — same surface, plus the teacher-defined structure. */
  isTeaching?: boolean;
  /** Where this section was last left. Read once, at mount, and never again. */
  snapshot?: DeepResearchSnapshot;
  onSnapshotChange?: (patch: Partial<DeepResearchSnapshot>) => void;
  onOpenLibraryWork?: OpenCitationLibraryWork;
  onOpenStudyDocument?: (id: string) => void;
  onOpenStudyMaterial?: (id: string) => void;
  onOpenStudyRecording?: (id: string, timestamp?: number | null) => void;
}) {
  const variant: DeepResearchVariant = isTeaching ? 'unit' : isGenealogy ? 'genealogy' : isStudy ? 'study' : 'academic';
  const copy = DEEP_RESEARCH_COPY[variant];
  // A report can only be the surface if there was one open; the pair is stored
  // together, and a reader with nothing in it would render the gallery anyway.
  const [mode, setMode] = useState<'gallery' | 'reader'>(
    () => (snapshot?.surface === 'reader' && snapshot.openReport ? 'reader' : 'gallery')
  );

  // Composer (new report) state.
  const [composerOpen, setComposerOpen] = useState(false);
  const [objective, setObjective] = useState('');
  const [language, setLanguage] = useState<PromptLanguage>('es');
  const [selectedModel, setSelectedModel] = useFeatureModel(settings, 'deepResearchModel');
  const [deepTarget, setDeepTarget] = useState<DeepResearchTargetLength>('adaptive');
  const [deepSectionLimit, setDeepSectionLimit] = useState<DeepResearchSectionLimit>('auto');
  const [audience, setAudience] = useState<StudyDeepResearchAudience>(isTeaching ? 'teacher' : 'students');
  const [includeImage, setIncludeImage] = useState(false);
  const [imageStyle, setImageStyle] = useState<DecorativeImageStyle>(settings.imageStyle);
  const [focusPersonId, setFocusPersonId] = useState<string | null>(null);
  const [personsList, setPersonsList] = useState<Person[]>([]);
  // Unit design: who decides the structure, and the teacher's slots when it is them.
  // Blank slots are kept — the count is the teacher's decision even when the titles
  // are not (see DeepResearchOutlineSection).
  const [structureMode, setStructureMode] = useState<'ai' | 'manual'>('ai');
  const [unitOutline, setUnitOutline] = useState<DeepResearchOutlineSection[]>(
    () => Array.from({ length: 4 }, () => ({ title: '', focus: '' }))
  );

  // Data.
  const [savedDrafts, setSavedDrafts] = useState<WritingWorkshopSavedDraft[]>([]);
  const [loadingSavedDrafts, setLoadingSavedDrafts] = useState(false);
  /** True once the gallery has been read at least once, empty or not. */
  const [galleryRead, setGalleryRead] = useState(false);
  const [queue, setQueue] = useState<DeepResearchQueueItem[]>(() => getDeepResearchQueue());
  // The main-process lane, which also holds reports queued by MCP clients.
  const [laneJobs, setLaneJobs] = useState<DeepResearchJobRecord[]>([]);
  const [deepJob, setDeepJob] = useState<DeepResearchGenerationJob | null>(() =>
    getBackgroundJob(DEEP_RESEARCH_MAIN_JOB_KEY)
  );

  // Gallery controls. Restored as initial values only: a reactive `snapshot` prop
  // would fight the reader for their own filters on every render of the shell.
  const [search, setSearch] = useState(() => snapshot?.search ?? '');
  const [readFilter, setReadFilter] = useState<ReadFilter>(() => snapshot?.readFilter ?? 'all');
  const [sortKey, setSortKey] = useState<SortKey>(() => snapshot?.sortKey ?? 'recent');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => snapshot?.viewMode ?? 'grid');
  const [galleryAnchorId, setGalleryAnchorId] = useState<string | null>(() => snapshot?.placement?.anchorId ?? null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Bulk download: the ids the archive modal is about, then its live progress.
  const [archiveIds, setArchiveIds] = useState<string[] | null>(null);
  const [archiveProgress, setArchiveProgress] = useState<{ done: number; total: number } | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Reader + shared modals.
  const [openDraft, setOpenDraft] = useState<WritingWorkshopSavedDraft | null>(null);
  const [showMatrix, setShowMatrix] = useState(false);
  const [citation, setCitation] = useState<CitationTarget>(null);
  const [savingToNotes, setSavingToNotes] = useState(false);
  const [translationOpen, setTranslationOpen] = useState(false);
  const [appliedTranslation, setAppliedTranslation] = useState<ContentTranslation | null>(null);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasModel = !!selectedModel;
  const deepRunning = deepJob?.status === 'running';
  const deepProgress = deepJob?.progress ?? null;

  /**
   * The report that was open, found again once the gallery has been read.
   *
   * The gallery is the only source of a saved report, so this waits for it rather
   * than fetching the report a second way. If it is no longer there — deleted, or
   * written in a vault this is not — the section falls back to the gallery instead
   * of showing an empty reader.
   */
  const reopening = useRef(snapshot?.surface === 'reader' ? snapshot.openReport?.id ?? null : null);

  // The registry builds `onSnapshotChange` inline, so its identity changes on every
  // render of the shell; a ref keeps that out of the effects' dependencies.
  const report = useRef(onSnapshotChange);
  report.current = onSnapshotChange;
  useEffect(() => {
    // Silent until the report being reopened has landed: on the way in the reader is
    // empty, and saying so would erase the very report that is on its way back.
    if (reopening.current) return;
    report.current?.({
      surface: mode,
      openReport: openDraft ? { id: openDraft.id, label: openDraft.title } : null,
      search,
      readFilter,
      sortKey,
      viewMode,
    });
  }, [mode, openDraft, readFilter, search, sortKey, viewMode]);

  // The place inside the open report. Kept in a ref rather than in state because it
  // is written on every scroll frame and read only when the reader mounts.
  const restoredReading = useRef<ReadingPlace | null>(snapshot?.reading ?? null);

  useEffect(() => {
    const id = reopening.current;
    if (!id || !galleryRead) return;
    reopening.current = null;
    const found = savedDrafts.find((item) => item.id === id);
    if (found) {
      setOpenDraft(found);
      return;
    }
    restoredReading.current = null;
    setMode('gallery');
  }, [galleryRead, savedDrafts]);

  // Changing the cut throws the place in the gallery away with it: a card at the top
  // of one filter means nothing under another. It skips its own first run, or
  // arriving with a restored filter would drop the restored place a frame later.
  const cutChanged = useRef(false);
  useEffect(() => {
    if (!cutChanged.current) {
      cutChanged.current = true;
      return;
    }
    setGalleryAnchorId(null);
    report.current?.({ placement: null });
  }, [readFilter, search, sortKey]);

  useEffect(() => subscribeBackgroundJob(DEEP_RESEARCH_MAIN_JOB_KEY, setDeepJob), []);
  useEffect(() => subscribeDeepResearchQueue(setQueue), []);
  useEffect(() => {
    void window.nodus.listDeepResearchJobs().then(setLaneJobs);
    return window.nodus.onDeepResearchQueue(setLaneJobs);
  }, []);

  useEffect(() => {
    if (!composerOpen || !isGenealogy) return;
    let cancelled = false;
    void window.nodus.listPersons().then((list) => {
      if (!cancelled) setPersonsList([...list].sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? '')));
    });
    return () => {
      cancelled = true;
    };
  }, [composerOpen, isGenealogy]);

  const refreshSavedDrafts = useCallback(async () => {
    setLoadingSavedDrafts(true);
    try {
      const all = await window.nodus.listWritingWorkshopDrafts();
      setSavedDrafts(all.filter((item) => item.brief.kind === 'deep_research'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingSavedDrafts(false);
      setGalleryRead(true);
    }
  }, []);

  useEffect(() => {
    void refreshSavedDrafts();
  }, [refreshSavedDrafts]);

  /**
   * Every finished report reaches the gallery, whoever wrote it.
   *
   * This is the one mechanism, on purpose. Watching the generation job instead cannot
   * work: all queued reports share one job key, so when one finishes the next starts
   * in the same tick, React renders once per tick, and the completed state of every
   * report but the last was never observed — those reports stayed out of the gallery
   * until the section was left and reopened. A save, wherever it happens, is a fact
   * the main process announces.
   *
   * refreshSavedDrafts has no dependencies, so this subscribes exactly once.
   */
  useEffect(() => window.nodus.onWritingDraftsChanged(() => void refreshSavedDrafts()), [refreshSavedDrafts]);

  /**
   * The exception: a report that generated but could not be filed. Nothing was saved,
   * so nothing is announced, and the queue would otherwise empty with the work lost in
   * silence. The queue carries the reason (it keeps its finished entries, which is what
   * a render can miss), and the strip shows the report as failed.
   */
  const seenUnsavedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const unsaved = queue.find((item) => item.saveError && !seenUnsavedRef.current.has(item.id));
    if (!unsaved?.saveError) return;
    seenUnsavedRef.current.add(unsaved.id);
    setError(unsaved.saveError);
  }, [queue]);

  // A report queued over MCP is saved by the main process, so nothing in this window
  // knows about it until the gallery is re-read.
  const seenMcpDraftsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const landed = laneJobs.filter(
      (job) => job.origin === 'mcp' && job.savedDraftId && !seenMcpDraftsRef.current.has(job.savedDraftId)
    );
    if (landed.length === 0) return;
    for (const job of landed) seenMcpDraftsRef.current.add(job.savedDraftId as string);
    void refreshSavedDrafts();
  }, [laneJobs, refreshSavedDrafts]);

  const submitComposer = () => {
    if (!objective.trim()) {
      setError(t(copy.missingObjective));
      return;
    }
    const outline = isTeaching && structureMode === 'manual' ? unitOutline : null;
    enqueueDeepResearch({
      objective: objective.trim(),
      language,
      targetLength: deepTarget,
      sectionLimit: deepSectionLimit,
      ...(isStudy ? { audience } : {}),
      model: selectedModel,
      decorativeImage: { enabled: includeImage, style: imageStyle },
      ...(isGenealogy ? { focusPersonId } : {}),
      ...(isStudy ? { studyMode: true } : {}),
      ...(isTeaching ? { unitMode: true } : {}),
      // Trimmed here rather than in the editor so a slot the teacher is still typing
      // into never loses its whitespace mid-keystroke.
      ...(outline ? { outline: outline.map((slot) => ({ title: slot.title.trim(), focus: slot.focus?.trim() || undefined })) } : {}),
    });
    setComposerOpen(false);
    setObjective('');
    setFocusPersonId(null);
    setError(null);
    setMessage(t(copy.queuedToast));
  };

  const openReader = (saved: WritingWorkshopSavedDraft) => {
    // A place taken in another report is not a place in this one.
    restoredReading.current = null;
    setOpenDraft(saved);
    setMode('reader');
    setShowMatrix(false);
    setError(null);
    setMessage(null);
    setTranslationOpen(false);
    setAppliedTranslation(null);
  };

  const backToGallery = () => {
    setMode('gallery');
    setOpenDraft(null);
    restoredReading.current = null;
    report.current?.({ reading: null });
    setTranslationOpen(false);
    setAppliedTranslation(null);
    void refreshSavedDrafts();
  };

  const reusePrompt = (saved: WritingWorkshopSavedDraft) => {
    setObjective(saved.brief.objective);
    if (saved.brief.language) setLanguage(saved.brief.language as PromptLanguage);
    if (saved.model) setSelectedModel(saved.model);
    if (isTeaching && (saved.brief.audience === 'teacher' || saved.brief.audience === 'students')) {
      setAudience(saved.brief.audience);
    }
    setFocusPersonId(null);
    setComposerOpen(true);
  };

  /**
   * Read, or not read after all.
   *
   * The main process announces the change and the gallery re-reads itself, so the two
   * writes here are only about the wait: the badge flips under the cursor rather than a
   * round trip later. `openDraft` is separate state and would otherwise keep showing the
   * old mark until the reader was closed — which is precisely where this is pressed.
   */
  const toggleRead = async (saved: WritingWorkshopSavedDraft) => {
    try {
      const next = await window.nodus.setWritingWorkshopDraftRead(saved.id, !saved.readAt);
      if (!next) return;
      setSavedDrafts((current) => current.map((item) => (item.id === next.id ? next : item)));
      setOpenDraft((current) => (current?.id === next.id ? next : current));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteDraft = async (saved: WritingWorkshopSavedDraft) => {
    const ok = await confirm({
      title: t(copy.deleteTitle),
      message: t(copy.deleteMessage),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    try {
      await window.nodus.deleteWritingWorkshopDraft(saved.id);
      setSavedDrafts((current) => current.filter((item) => item.id !== saved.id));
      if (openDraft?.id === saved.id) backToGallery();
      setMessage(t(copy.deletedToast));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const exitSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const deleteSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const ok = await confirm({
      title: t('Eliminar informes'),
      message: tx('¿Eliminar {n} informes guardados? Esta acción no se puede deshacer.', { n: ids.length }),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    try {
      await Promise.all(ids.map((id) => window.nodus.deleteWritingWorkshopDraft(id)));
      setSavedDrafts((current) => current.filter((item) => !selected.has(item.id)));
      exitSelection();
      setMessage(tx('{n} informes eliminados.', { n: ids.length }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /**
   * One report, straight to disk. The native dialog offers both extensions and the
   * chosen one decides the format, so the card needs a single button rather than a
   * format menu of its own.
   */
  const downloadDraft = async (saved: WritingWorkshopSavedDraft) => {
    if (downloadingId) return;
    setDownloadingId(saved.id);
    setError(null);
    setMessage(null);
    try {
      const result = await window.nodus.exportWritingWorkshopDraft({ draft: saved.draft, format: 'pdf', entityId: saved.id });
      if (result) setMessage(`${t('Descargado')}: ${result.path}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloadingId(null);
    }
  };

  const runArchive = async (format: DeepResearchArchiveFormat) => {
    const ids = archiveIds ?? [];
    if (ids.length === 0) return;
    setArchiveProgress({ done: 0, total: ids.length });
    setError(null);
    setMessage(null);
    try {
      const result = await window.nodus.exportDeepResearchArchive({ ids, format }, (done, total) =>
        setArchiveProgress({ done, total })
      );
      setArchiveIds(null);
      if (!result) return; // the user dismissed the save dialog
      exitSelection();
      setMessage(
        result.failed.length === 0
          ? tx('Informes descargados: {n}. Se han guardado en {path}', { n: result.count, path: result.path })
          : tx('Informes descargados: {n} (en {path}). No se pudieron preparar {failed}: {reasons}', {
              n: result.count,
              path: result.path,
              failed: result.failed.length,
              reasons: result.failed.map((item) => `${item.title} (${item.reason})`).join('; '),
            })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setArchiveIds(null);
    } finally {
      setArchiveProgress(null);
    }
  };

  /** The header button: pick first, download second — with the selection already made. */
  const startDownload = () => {
    if (!selecting) {
      setSelecting(true);
      setError(null);
      setMessage(t('Marca los informes que quieres descargar y vuelve a pulsar «Descargar».'));
      return;
    }
    if (selected.size === 0) {
      setMessage(t('Marca al menos un informe para descargarlo.'));
      return;
    }
    setMessage(null);
    setArchiveIds([...selected]);
  };

  const exportDraft = async (format: 'markdown' | 'pdf') => {
    if (!openDraft) return;
    setExporting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await window.nodus.exportWritingWorkshopDraft({ draft: openDraft.draft, format, entityId: openDraft.id });
      if (result) setMessage(`${t('Exportado')}: ${result.path}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const copyDraft = async () => {
    if (!openDraft) return;
    await navigator.clipboard.writeText(appliedTranslation?.markdown ?? openDraft.draft.draftMarkdown);
    setMessage(t('Borrador copiado.'));
  };

  /** The same report, prepared to be listened to instead of read: no citation
   *  buttons, no author-year parentheses, no reference list, no Markdown. A
   *  translated report already carries its title, so it is copied as it stands. */
  const copyForListening = async () => {
    if (!openDraft) return;
    const text = appliedTranslation
      ? toReadingCopy(appliedTranslation.markdown)
      : toReadingCopy(openDraft.draft.draftMarkdown, { title: openDraft.draft.title });
    await navigator.clipboard.writeText(text);
    setMessage(t('Texto copiado sin citas ni referencias.'));
  };

  const onImageChange = (image: DecorativeImage) => {
    if (!openDraft) return;
    const next = { ...openDraft, image };
    setOpenDraft(next);
    setSavedDrafts((current) => current.map((item) => (item.id === next.id ? next : item)));
  };

  const visibleDrafts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = savedDrafts.filter((draft) => {
      const matchesSearch = !q
        || (draft.title ?? '').toLowerCase().includes(q)
        || (draft.brief.objective ?? '').toLowerCase().includes(q);
      const matchesReadState = readFilter === 'all'
        || (readFilter === 'read' ? !!draft.readAt : !draft.readAt);
      return matchesSearch && matchesReadState;
    });
    const sorted = [...filtered];
    if (sortKey === 'title') sorted.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
    else if (sortKey === 'oldest') sorted.sort((a, b) => (a.updatedAt ?? '').localeCompare(b.updatedAt ?? ''));
    else sorted.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    return sorted;
  }, [savedDrafts, search, readFilter, sortKey]);

  // The strip shows one lane, not two. Reports queued from this window come from the
  // renderer store; reports queued by an MCP client live in the main process and arrive
  // over `onDeepResearchQueue`. Only MCP ones are taken from there — an app report is
  // already represented by its renderer entry, and would otherwise appear twice.
  const stripItems = useMemo<QueueStripItem[]>(() => {
    const local = queue.map<QueueStripItem>((item) => ({
      id: item.id,
      title: item.title,
      // A report that generated but could not be filed is shown as a failure: the
      // gallery will never hold it, so quietly completing would lose it in silence.
      status: item.status === 'completed' && item.saveError ? 'failed' : item.status,
      progress: item.status === 'running' ? deepProgress : null,
      error: item.error ?? item.saveError,
      origin: 'app',
      enqueuedAt: item.enqueuedAt,
    }));
    const remote = laneJobs
      .filter((job) => job.origin === 'mcp')
      .map<QueueStripItem>((job) => ({
        id: job.id,
        title: job.title,
        status: job.status === 'cancelled' ? 'failed' : job.status,
        progress: job.status === 'running' || job.status === 'queued' ? job.progress : null,
        error: job.error,
        origin: 'mcp',
        enqueuedAt: job.enqueuedAt,
      }));
    return [...local, ...remote].sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt));
  }, [queue, laneJobs, deepProgress]);

  const activeQueue = stripItems.filter((item) => item.status === 'queued' || item.status === 'running');
  const finishedQueue = stripItems.filter((item) => item.status === 'failed');

  const removeQueued = (item: QueueStripItem) => {
    if (item.origin === 'mcp') void window.nodus.cancelDeepResearchJob(item.id);
    else removeQueuedDeepResearch(item.id);
  };

  const clearFinished = () => {
    clearFinishedDeepResearch();
    void window.nodus.clearFinishedDeepResearchJobs();
  };

  // A report that was left open is the section's first frame, never its second. The
  // gallery below is a screen full of cards; painting it for the frames the read of
  // the report takes is what makes returning to the section look like the app opening
  // the list and clicking the report by itself. `mode` already says the reader was in
  // a report — so wait here, quietly, until the report it names has landed.
  if (mode === 'reader' && !openDraft) return <RestoringPane />;

  if (mode === 'reader' && openDraft) {
    return (
      <>
        <ReaderView
          saved={openDraft}
          settings={settings}
          initialReading={restoredReading.current}
          onReadingChange={(place) => report.current?.({ reading: place })}
          showMatrix={showMatrix}
          exporting={exporting}
          message={message}
          error={error}
          appliedTranslation={appliedTranslation}
          onToggleMatrix={() => setShowMatrix((v) => !v)}
          onBack={backToGallery}
          onCopy={() => void copyDraft()}
          onCopyReading={() => void copyForListening()}
          onSaveToNotes={() => setSavingToNotes(true)}
          onToggleRead={() => void toggleRead(openDraft)}
          onTranslate={() => setTranslationOpen(true)}
          onExport={(format) => void exportDraft(format)}
          onCitation={setCitation}
          onImageChange={onImageChange}
          onOpenStudyDocument={onOpenStudyDocument}
          onOpenStudyMaterial={onOpenStudyMaterial}
          onOpenStudyRecording={onOpenStudyRecording}
        />
        {translationOpen && (
          <TranslationModal
            entityKind="deep_research"
            entityId={openDraft.id}
            sourceTitle={openDraft.draft.title}
            sourceMarkdown={`# ${openDraft.draft.title}\n\n${openDraft.draft.abstract ? `${openDraft.draft.abstract}\n\n` : ''}${stripLeadingAbstract(openDraft.draft.draftMarkdown, openDraft.draft.abstract)}`}
            model={openDraft.model}
            activeTranslationId={appliedTranslation?.id ?? null}
            onApply={setAppliedTranslation}
            onClose={() => setTranslationOpen(false)}
          />
        )}
        {citation && (
          <SourceCitationModal
            target={citation}
            onClose={() => setCitation(null)}
            onOpenLibraryWork={onOpenLibraryWork}
          />
        )}
        {savingToNotes && (
          <SaveToNotesModal
            content={`# ${openDraft.draft.title}\n\n${openDraft.draft.abstract ? `${openDraft.draft.abstract}\n\n` : ''}${stripLeadingAbstract(openDraft.draft.draftMarkdown, openDraft.draft.abstract)}`}
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
      <SectionHeader
        icon="telescope"
        title={t(copy.heading)}
        subtitle={t(copy.subtitle)}
        actions={(<>
        <button className="btn btn-ghost gap-1.5 border border-neutral-700" onClick={() => setShowTutorial((v) => !v)}>
          <Icon name="help" /> {showTutorial ? t('Ocultar tutorial') : t('Tutorial')}
        </button>
        {savedDrafts.length > 0 && (
          <button
            className={`btn btn-ghost gap-1.5 border ${selecting ? 'border-indigo-700/60 text-indigo-200' : 'border-neutral-700'}`}
            onClick={startDownload}
            title={t('Descargar en un ZIP los informes seleccionados')}
          >
            <Icon name="download" /> {t('Descargar')}
            {selecting && selected.size > 0 && <span className="text-xs text-indigo-300">({selected.size})</span>}
          </button>
        )}
        <button className="btn btn-primary gap-1.5" onClick={() => setComposerOpen(true)}>
          <Icon name="plus" /> {t(copy.newAction)}
        </button>
        </>)}
      />

      {showTutorial && <DeepResearchTutorial steps={copy.tutorial} />}

      {(message || error) && (
        <div className={`px-4 py-2 text-sm border-b ${error ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200' : 'border-neutral-200 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400'}`}>
          {error ?? message}
        </div>
      )}

      {(activeQueue.length > 0 || finishedQueue.length > 0) && (
        <DeepResearchQueueStrip
          active={activeQueue}
          failed={finishedQueue}
          running={deepRunning || activeQueue.some((item) => item.status === 'running')}
          onRemove={removeQueued}
          onClearFinished={clearFinished}
        />
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-2.5">
        <div className="relative min-w-[14rem] flex-1 max-w-md">
          <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            className="input input-with-leading-icon w-full !py-1.5 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t(copy.searchPlaceholder)}
          />
        </div>
        <select
          className="input !py-1.5 text-xs"
          value={readFilter}
          onChange={(e) => setReadFilter(e.target.value as ReadFilter)}
          aria-label={t('Filtrar por estado')}
          title={t('Filtrar por estado')}
        >
          <option value="all">{t('Leído + no leído')}</option>
          <option value="read">{t('Solo leído')}</option>
          <option value="unread">{t('Solo no leído')}</option>
        </select>
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
        {savedDrafts.length > 0 && (
          <button
            className={`btn btn-ghost !py-1.5 gap-1.5 border text-xs ${selecting ? 'border-indigo-700/60 text-indigo-200' : 'border-neutral-700'}`}
            onClick={() => (selecting ? exitSelection() : setSelecting(true))}
          >
            <Icon name="check" size={13} /> {selecting ? t('Cancelar') : t('Seleccionar')}
          </button>
        )}
      </div>

      {selecting && (
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-900/40 bg-indigo-950/20 px-4 py-2 text-xs">
          <button
            className="text-indigo-300 hover:underline"
            onClick={() =>
              setSelected(
                visibleDrafts.every((d) => selected.has(d.id)) ? new Set() : new Set(visibleDrafts.map((d) => d.id))
              )
            }
          >
            {visibleDrafts.length > 0 && visibleDrafts.every((d) => selected.has(d.id))
              ? t('Deseleccionar todo')
              : t('Seleccionar todo')}
          </button>
          <span className="text-neutral-500">{tx('{n} seleccionados', { n: selected.size })}</span>
          <div className="flex-1" />
          <button
            className="btn btn-ghost !py-1 gap-1 text-xs text-indigo-300 disabled:text-neutral-600"
            onClick={() => setArchiveIds([...selected])}
            disabled={selected.size === 0}
          >
            <Icon name="download" size={13} /> {t('Descargar seleccionados')}
          </button>
          <button
            className="btn btn-ghost !py-1 gap-1 text-xs text-red-400 disabled:text-neutral-600"
            onClick={() => void deleteSelected()}
            disabled={selected.size === 0}
          >
            <Icon name="trash" size={13} /> {t('Eliminar seleccionados')}
          </button>
        </div>
      )}

      <GalleryScroller
        anchorId={galleryAnchorId}
        revision={visibleDrafts}
        onMissed={() => {
          setGalleryAnchorId(null);
          report.current?.({ placement: null });
        }}
        onCapture={(anchorId) => report.current?.({ placement: anchorId ? { anchorId } : null })}
      >
        {visibleDrafts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Icon name="compass" size={28} className="text-neutral-600" />
            <div className="max-w-md text-sm text-neutral-500">
              {loadingSavedDrafts
                ? t(copy.loading)
                : readFilter !== 'all'
                  ? t('No hay elementos con estos filtros.')
                  : search.trim()
                  ? t(copy.noMatch)
                  : t(copy.empty)}
            </div>
            {!search.trim() && readFilter === 'all' && !loadingSavedDrafts && (
              <button className="btn btn-primary gap-1.5" onClick={() => setComposerOpen(true)}>
                <Icon name="plus" /> {t(copy.newAction)}
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
                selecting={selecting}
                selected={selected.has(saved.id)}
                downloading={downloadingId === saved.id}
                onToggle={() => toggleSelected(saved.id)}
                onOpen={() => openReader(saved)}
                onReuse={() => reusePrompt(saved)}
                onDownload={() => void downloadDraft(saved)}
                onToggleRead={() => void toggleRead(saved)}
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
                selecting={selecting}
                selected={selected.has(saved.id)}
                downloading={downloadingId === saved.id}
                onToggle={() => toggleSelected(saved.id)}
                onOpen={() => openReader(saved)}
                onReuse={() => reusePrompt(saved)}
                onDownload={() => void downloadDraft(saved)}
                onToggleRead={() => void toggleRead(saved)}
                onDelete={() => void deleteDraft(saved)}
              />
            ))}
          </div>
        )}
      </GalleryScroller>

      {archiveIds && (
        <ArchiveModal
          count={archiveIds.length}
          progress={archiveProgress}
          onDownload={(format) => void runArchive(format)}
          onClose={() => setArchiveIds(null)}
        />
      )}

      {composerOpen && (
        <ComposerModal
          settings={settings}
          isGenealogy={isGenealogy}
          isTeaching={isTeaching}
          copy={copy}
          structureMode={structureMode}
          unitOutline={unitOutline}
          onStructureMode={setStructureMode}
          onUnitOutline={setUnitOutline}
          objective={objective}
          audience={audience}
          language={language}
          model={selectedModel}
          target={deepTarget}
          sectionLimit={deepSectionLimit}
          includeImage={includeImage}
          imageStyle={imageStyle}
          hasModel={hasModel}
          queuedCount={activeQueue.length}
          persons={personsList}
          focusPersonId={focusPersonId}
          onObjective={setObjective}
          onAudience={setAudience}
          onLanguage={setLanguage}
          onModel={setSelectedModel}
          onTarget={setDeepTarget}
          onSectionLimit={setDeepSectionLimit}
          onIncludeImage={setIncludeImage}
          onImageStyle={setImageStyle}
          onFocusPerson={setFocusPersonId}
          onSubmit={submitComposer}
          onClose={() => setComposerOpen(false)}
        />
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Gallery cards
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The gallery's scroller, and the reader's place in it.
 *
 * A component rather than a hook call in the view, because the gallery is unmounted
 * while a report is open: the hook has to be born and die with the element it listens
 * to, or it would come back from the reader still holding the scroller that was
 * thrown away. It also means the trip into a report and back out lands on the same
 * card, not at the top.
 */
function GalleryScroller({
  anchorId,
  revision,
  onMissed,
  onCapture,
  children,
}: {
  anchorId: string | null;
  revision: unknown;
  onMissed: () => void;
  onCapture: (anchorId: string | null) => void;
  children: ReactNode;
}) {
  const scrollerRef = useListPlacement<HTMLDivElement>({
    restoreAnchorId: anchorId,
    revision,
    onRestoreMissed: onMissed,
    onCapture,
  });
  return <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>;
}

function SelectCheck({ checked }: { checked: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
        checked ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-neutral-500 bg-neutral-900/70'
      }`}
    >
      {checked && <Icon name="check" size={12} />}
    </span>
  );
}

/**
 * The mark a report wears once it has been read, over its cover.
 *
 * On the illustration rather than beside the title, because the question it answers —
 * which of these have I already been through? — is asked of the whole gallery at a
 * glance, and a badge among the metadata has to be read one card at a time.
 */
function ReadBadge() {
  return (
    <span
      className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full bg-emerald-100/90 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-300/80 dark:bg-emerald-950/80 dark:text-emerald-200 dark:ring-emerald-700/60"
      title={t('Ya has leído este informe')}
    >
      <Icon name="check" size={10} /> {t('Leído')}
    </span>
  );
}

/** The toggle itself, identical wherever a report is listed. */
function ReadToggle({ read, onToggle }: { read: boolean; onToggle: () => void }) {
  return (
    <button
      className={`btn btn-ghost !py-1 gap-1 border text-xs ${
        read ? 'border-emerald-700/60 text-emerald-300' : 'border-neutral-700 text-neutral-400'
      }`}
      onClick={onToggle}
      title={read ? t('Marcar como no leído') : t('Marcar como leído')}
      aria-pressed={read}
    >
      <Icon name={read ? 'eyeOff' : 'check'} size={12} />
    </button>
  );
}

function DraftGridCard({
  saved,
  settings,
  selecting,
  selected,
  downloading,
  onToggle,
  onOpen,
  onReuse,
  onDownload,
  onToggleRead,
  onDelete,
}: {
  saved: WritingWorkshopSavedDraft;
  settings: AppSettings;
  selecting: boolean;
  selected: boolean;
  downloading: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onReuse: () => void;
  onDownload: () => void;
  onToggleRead: () => void;
  onDelete: () => void;
}) {
  const primary = selecting ? onToggle : onOpen;
  return (
    <div
      data-anchor-id={saved.id}
      className={`card group flex flex-col overflow-hidden p-0 transition-colors ${
        selected ? 'border-indigo-600/70 ring-1 ring-indigo-600/40' : 'hover:border-indigo-700/60'
      }`}
    >
      <button
        className="relative block h-40 w-full overflow-hidden bg-gradient-to-br from-indigo-950/30 to-neutral-900"
        onClick={primary}
        title={selecting ? t('Seleccionar') : t('Abrir a pantalla completa')}
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
        {selecting && (
          <span className="absolute left-2 top-2 z-10">
            <SelectCheck checked={selected} />
          </span>
        )}
        {saved.readAt && <ReadBadge />}
      </button>
      <div className="flex flex-1 flex-col p-3">
        <button className="text-left" onClick={primary}>
          {/* A read report steps back a shade. Not struck through and not hidden: it is
              still the same report, it is simply no longer one of the ones waiting. */}
          <div
            className={`line-clamp-2 text-sm ${saved.readAt ? 'font-normal text-neutral-400' : 'font-medium text-neutral-200'}`}
            title={saved.title}
          >
            {saved.title}
          </div>
        </button>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-neutral-500">
          <Icon name="clock" size={11} /> {formatDate(saved.updatedAt)}
          {saved.model && <><span>·</span><span className="truncate">{modelLabel(saved.model)}</span></>}
        </div>
        {!selecting && (
          <div className="mt-3 flex items-center gap-1.5">
            <button className="btn btn-primary !py-1 gap-1 text-xs" onClick={onOpen}>
              <Icon name="book" size={12} /> {t('Leer')}
            </button>
            <button className="btn btn-ghost !py-1 gap-1 border border-neutral-700 text-xs" onClick={onReuse} title={t('Reutilizar la idea para un informe nuevo')}>
              <Icon name="refresh" size={12} />
            </button>
            <button
              className="btn btn-ghost !py-1 gap-1 border border-neutral-700 text-xs"
              onClick={onDownload}
              disabled={downloading}
              title={t('Descargar este informe')}
            >
              <Icon name={downloading ? 'sync' : 'download'} size={12} className={downloading ? 'animate-spin' : ''} />
            </button>
            <ReadToggle read={!!saved.readAt} onToggle={onToggleRead} />
            <div className="flex-1" />
            <button className="btn btn-ghost !py-1 text-xs text-neutral-500 hover:text-red-400" onClick={onDelete} title={t('Eliminar informe')}>
              <Icon name="trash" size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DraftListRow({
  saved,
  settings,
  selecting,
  selected,
  downloading,
  onToggle,
  onOpen,
  onReuse,
  onDownload,
  onToggleRead,
  onDelete,
}: {
  saved: WritingWorkshopSavedDraft;
  settings: AppSettings;
  selecting: boolean;
  selected: boolean;
  downloading: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onReuse: () => void;
  onDownload: () => void;
  onToggleRead: () => void;
  onDelete: () => void;
}) {
  const primary = selecting ? onToggle : onOpen;
  return (
    <div
      data-anchor-id={saved.id}
      className={`card flex items-center gap-3 p-2.5 transition-colors ${
        selected ? 'border-indigo-600/70 ring-1 ring-indigo-600/40' : 'hover:border-indigo-700/60'
      }`}
    >
      {selecting && (
        <button onClick={onToggle} aria-label={t('Seleccionar')}>
          <SelectCheck checked={selected} />
        </button>
      )}
      <button
        className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-indigo-950/30 to-neutral-900"
        onClick={primary}
        title={selecting ? t('Seleccionar') : t('Abrir a pantalla completa')}
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
      <button className="min-w-0 flex-1 text-left" onClick={primary}>
        <div
          className={`truncate text-sm ${saved.readAt ? 'font-normal text-neutral-400' : 'font-medium text-neutral-200'}`}
          title={saved.title}
        >
          {saved.title}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-neutral-500">
          <Icon name="clock" size={11} /> {formatDate(saved.updatedAt)}
          {saved.model && <><span>·</span><span className="truncate">{modelLabel(saved.model)}</span></>}
          {saved.readAt && (
            <span className="flex items-center gap-1 text-emerald-400">
              <span>·</span>
              <Icon name="check" size={11} /> {t('Leído')}
            </span>
          )}
        </div>
      </button>
      {!selecting && (
        <>
          <button className="btn btn-primary !py-1 gap-1 text-xs" onClick={onOpen}>
            <Icon name="book" size={12} /> {t('Leer')}
          </button>
          <button className="btn btn-ghost !py-1 gap-1 border border-neutral-700 text-xs" onClick={onReuse} title={t('Reutilizar la idea para un informe nuevo')}>
            <Icon name="refresh" size={12} />
          </button>
          <button
            className="btn btn-ghost !py-1 gap-1 border border-neutral-700 text-xs"
            onClick={onDownload}
            disabled={downloading}
            title={t('Descargar este informe')}
          >
            <Icon name={downloading ? 'sync' : 'download'} size={12} className={downloading ? 'animate-spin' : ''} />
          </button>
          <ReadToggle read={!!saved.readAt} onToggle={onToggleRead} />
          <button className="btn btn-ghost !py-1 text-xs text-neutral-500 hover:text-red-400" onClick={onDelete} title={t('Eliminar informe')}>
            <Icon name="trash" size={12} />
          </button>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk download — format choice, then one zip
// ─────────────────────────────────────────────────────────────────────────────

const ARCHIVE_FORMATS: { value: DeepResearchArchiveFormat; label: string; hint: string }[] = [
  { value: 'markdown', label: 'Markdown (.md)', hint: 'Texto editable, listo para otro editor. Se prepara al instante.' },
  { value: 'pdf', label: 'PDF', hint: 'El informe maquetado, con portada y matriz. Tarda unos segundos por informe.' },
  { value: 'both', label: 'Markdown y PDF', hint: 'Ambos archivos de cada informe dentro del mismo ZIP.' },
];

function ArchiveModal({
  count,
  progress,
  onDownload,
  onClose,
}: {
  count: number;
  progress: { done: number; total: number } | null;
  onDownload: (format: DeepResearchArchiveFormat) => void;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<DeepResearchArchiveFormat>('pdf');
  const busy = progress !== null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Closing mid-render would leave the export running with nowhere to report to.
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={() => !busy && onClose()}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('Descargar informes')}
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-neutral-700 bg-white shadow-2xl dark:bg-neutral-950"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <Icon name="download" className="text-indigo-500 dark:text-indigo-300" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t('Descargar informes')}</h2>
            <p className="text-xs text-neutral-500">
              {tx('Informes seleccionados: {n}. Se guardarán en un único ZIP, en la carpeta que elijas.', { n: count })}
            </p>
          </div>
          <button className="btn btn-ghost px-2" onClick={onClose} disabled={busy} aria-label={t('Cerrar')}>
            <Icon name="x" />
          </button>
        </header>

        <div className="space-y-2 px-5 py-4">
          {ARCHIVE_FORMATS.map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm transition ${
                format === option.value
                  ? 'border-indigo-600/70 bg-indigo-950/20'
                  : 'border-neutral-200 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600'
              }`}
            >
              <input
                type="radio"
                name="deep-research-archive-format"
                className="mt-0.5"
                value={option.value}
                checked={format === option.value}
                disabled={busy}
                onChange={() => setFormat(option.value)}
              />
              <span className="min-w-0">
                <span className="block font-medium text-neutral-800 dark:text-neutral-200">{t(option.label)}</span>
                <span className="mt-0.5 block text-[11px] leading-5 text-neutral-500">{t(option.hint)}</span>
              </span>
            </label>
          ))}
          {progress && (
            <div className="flex items-center gap-2 pt-1 text-xs text-indigo-500 dark:text-indigo-300">
              <Icon name="sync" size={13} className="animate-spin" />
              {tx('Preparando {done} de {total}…', { done: progress.done, total: progress.total })}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
          <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={onClose} disabled={busy}>
            {t('Cancelar')}
          </button>
          <button className="btn btn-primary gap-1.5" onClick={() => onDownload(format)} disabled={busy}>
            <Icon name={busy ? 'sync' : 'download'} className={busy ? 'animate-spin' : ''} />
            {busy ? t('Descargando…') : t('Descargar ZIP')}
          </button>
        </footer>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reader — immersive full-report view
// ─────────────────────────────────────────────────────────────────────────────

function ReaderView({
  saved,
  settings,
  initialReading,
  onReadingChange,
  showMatrix,
  exporting,
  message,
  error,
  appliedTranslation,
  onToggleMatrix,
  onBack,
  onCopy,
  onCopyReading,
  onSaveToNotes,
  onToggleRead,
  onTranslate,
  onExport,
  onCitation,
  onImageChange,
  onOpenStudyDocument,
  onOpenStudyMaterial,
  onOpenStudyRecording,
}: {
  saved: WritingWorkshopSavedDraft;
  settings: AppSettings;
  /** How far into the report the reader had got last time. */
  initialReading: ReadingPlace | null;
  onReadingChange: (place: ReadingPlace | null) => void;
  showMatrix: boolean;
  exporting: boolean;
  message: string | null;
  error: string | null;
  appliedTranslation: ContentTranslation | null;
  onToggleMatrix: () => void;
  onBack: () => void;
  onCopy: () => void;
  onCopyReading: () => void;
  onSaveToNotes: () => void;
  onToggleRead: () => void;
  onTranslate: () => void;
  onExport: (format: 'markdown' | 'pdf') => void;
  onCitation: (target: CitationTarget) => void;
  onImageChange: (image: DecorativeImage) => void;
  onOpenStudyDocument?: (id: string) => void;
  onOpenStudyMaterial?: (id: string) => void;
  onOpenStudyRecording?: (id: string, timestamp?: number | null) => void;
}) {
  const mainRef = useRef<HTMLElement | null>(null);
  const documentRef = useRef<HTMLDivElement | null>(null);
  const markActionsRef = useRef<ReaderSelectionActionsHandle | null>(null);
  const [hasReaderMark, setHasReaderMark] = useState(false);
  const [annotations, setAnnotations] = useState<WritingDraftAnnotation[]>([]);
  const [highlighterColor, setHighlighterColor] = useState<WritingDraftAnnotationColor | null>(null);
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const annotationScope = appliedTranslation ? `translation:${appliedTranslation.id}` : 'source';
  const visibleAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.scope === annotationScope),
    [annotationScope, annotations],
  );
  const refreshAnnotations = useCallback(async () => {
    try {
      setAnnotations(await window.nodus.listWritingDraftAnnotations(saved.id));
      setAnnotationError(null);
    } catch (nextError) {
      setAnnotationError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [saved.id]);

  useEffect(() => {
    void refreshAnnotations();
    return window.nodus.onWritingDraftAnnotationsChanged((draftId) => {
      if (draftId === null || draftId === saved.id) void refreshAnnotations();
    });
  }, [refreshAnnotations, saved.id]);

  const createAnnotation = async (input: Omit<WritingDraftAnnotationInput, 'draftId' | 'scope'>) => {
    const created = await window.nodus.createWritingDraftAnnotation({ ...input, draftId: saved.id, scope: annotationScope });
    setAnnotations((current) => [...current.filter((item) => item.id !== created.id), created]);
    setAnnotationError(null);
  };

  const updateComment = async (id: string, comment: string) => {
    const updated = await window.nodus.updateWritingDraftComment(id, comment);
    if (!updated) {
      await refreshAnnotations();
      return;
    }
    setAnnotations((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setAnnotationError(null);
  };

  const deleteAnnotation = async (id: string) => {
    await window.nodus.deleteWritingDraftAnnotation(id);
    setAnnotations((current) => current.filter((item) => item.id !== id));
    setAnnotationError(null);
  };
  // Where the reader was in the report, restored once the prose is on screen. The
  // rendering travels with the place: a translation is a different document, and a
  // block counted in one of them is not the same block in the other.
  useReadingPlace({
    scrollerRef: mainRef,
    documentRef,
    restore: initialReading,
    rendering: annotationScope,
    revision: appliedTranslation?.id ?? saved.id,
    onCapture: onReadingChange,
  });

  const contextTitle = appliedTranslation?.title ?? saved.draft.title;
  const contextMarkdown = appliedTranslation?.markdown
    ?? `# ${saved.draft.title}\n\n${saved.draft.abstract ? `${saved.draft.abstract}\n\n` : ''}${stripLeadingAbstract(saved.draft.draftMarkdown, saved.draft.abstract)}`;
  return (
    <div className="h-full flex flex-col min-h-0">
      <NodiViewContextSource title={contextTitle} text={contextMarkdown} />
      <header className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-2.5">
        <button className="btn btn-ghost gap-1.5" onClick={onBack}>
          <Icon name="chevronLeft" /> {t('Volver a la galería')}
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-neutral-100" title={appliedTranslation?.title ?? saved.title}>{appliedTranslation?.title ?? saved.title}</div>
          <div className="text-[11px] text-neutral-500">{formatDate(saved.updatedAt)}</div>
        </div>
        {/* Icons only: the report title needs the room, and the reader already
            auto-saves, so there is no "Guardar borrador" action to offer here. */}
        <DraftActionBar
          exporting={exporting}
          savingDraft={false}
          compact
          onCopy={onCopy}
          onCopyReading={onCopyReading}
          onSaveToNotes={onSaveToNotes}
          onExport={onExport}
        />
        <ReaderHighlighterControl value={highlighterColor} onChange={setHighlighterColor} />
        <HoverLabelButton
          icon={hasReaderMark ? 'bookmarkFill' : 'bookmark'}
          label={t('Ir al marcador de lectura')}
          onClick={() => markActionsRef.current?.goToMark()}
          disabled={!hasReaderMark}
          className={`btn-ghost h-9 min-h-9 border ${hasReaderMark ? 'border-amber-300 text-amber-700 dark:border-amber-700/60 dark:text-amber-300' : 'border-neutral-700 text-neutral-500'}`}
        />
        {/* Beside the reading actions, where somebody who has just finished the report
            is already looking, rather than back in the gallery they would have to
            return to first. */}
        <HoverLabelButton
          icon={saved.readAt ? 'eyeOff' : 'check'}
          label={saved.readAt ? t('Marcar como no leído') : t('Marcar como leído')}
          onClick={onToggleRead}
          showLabel={!!saved.readAt}
          className={`btn-ghost h-9 min-h-9 border ${saved.readAt ? 'border-emerald-700/60 text-emerald-300' : 'border-neutral-700'}`}
        />
        <HoverLabelButton
          icon="languages"
          label={t('Traducir')}
          onClick={onTranslate}
          className="btn-ghost h-9 min-h-9 border border-neutral-700"
        />
        <HoverLabelButton
          icon="layers"
          label={t('Matriz de apoyo')}
          onClick={onToggleMatrix}
          showLabel={showMatrix}
          className={`btn-ghost h-9 min-h-9 border ${showMatrix ? 'border-indigo-700/60 text-indigo-200' : 'border-neutral-700'}`}
        />
      </header>

      {(message || error || annotationError) && (
        <div className={`px-4 py-2 text-sm border-b ${(error || annotationError) ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200' : 'border-neutral-200 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400'}`}>
          {error ?? annotationError ?? message}
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
            <AudioPanel entityKind="deep_research" entityId={saved.id} />
            <div ref={documentRef} className="relative" data-testid="deep-research-reader-document">
              {appliedTranslation ? <Markdown content={appliedTranslation.markdown} className="text-[15px] leading-7" onCitation={(citation) => onCitation(citation)} onStudyDocument={onOpenStudyDocument} onStudyMaterial={onOpenStudyMaterial} onStudyRecording={onOpenStudyRecording} /> : <DraftResultMain
                draft={saved.draft}
                exporting={exporting}
                savingDraft={false}
                draftSaved
                hideActions
                justify
                onCopy={onCopy}
                onSaveToNotes={onSaveToNotes}
                onExport={onExport}
                onCitation={onCitation}
                onStudyDocument={onOpenStudyDocument}
                onStudyMaterial={onOpenStudyMaterial}
                onStudyRecording={onOpenStudyRecording}
              />}
            </div>
          </div>
        </main>
        <ReaderSelectionActions
          key={appliedTranslation?.id ?? 'source'}
          ref={markActionsRef}
          targetRef={documentRef}
          scrollRef={mainRef}
          contextId={appliedTranslation ? `deep-research:${saved.id}:translation:${appliedTranslation.id}` : `deep-research:${saved.id}`}
          annotations={visibleAnnotations}
          highlighterColor={highlighterColor}
          onCreateAnnotation={createAnnotation}
          onUpdateComment={updateComment}
          onDeleteAnnotation={deleteAnnotation}
          onAnnotationError={setAnnotationError}
          onMarkChange={setHasReaderMark}
        />
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
  isGenealogy = false,
  isTeaching = false,
  copy,
  structureMode,
  unitOutline,
  onStructureMode,
  onUnitOutline,
  objective,
  audience,
  language,
  model,
  target,
  sectionLimit,
  includeImage,
  imageStyle,
  hasModel,
  queuedCount,
  persons = [],
  focusPersonId = null,
  onObjective,
  onAudience,
  onLanguage,
  onModel,
  onTarget,
  onSectionLimit,
  onIncludeImage,
  onImageStyle,
  onFocusPerson,
  onSubmit,
  onClose,
}: {
  settings: AppSettings;
  isGenealogy?: boolean;
  isTeaching?: boolean;
  copy: DeepResearchCopy;
  structureMode: 'ai' | 'manual';
  unitOutline: DeepResearchOutlineSection[];
  onStructureMode: (v: 'ai' | 'manual') => void;
  onUnitOutline: (v: DeepResearchOutlineSection[]) => void;
  objective: string;
  audience: StudyDeepResearchAudience;
  language: PromptLanguage;
  model: AppSettings['deepResearchModel'];
  target: DeepResearchTargetLength;
  sectionLimit: DeepResearchSectionLimit;
  includeImage: boolean;
  imageStyle: DecorativeImageStyle;
  hasModel: boolean;
  queuedCount: number;
  persons?: Person[];
  focusPersonId?: string | null;
  onObjective: (v: string) => void;
  onAudience: (v: StudyDeepResearchAudience) => void;
  onLanguage: (v: PromptLanguage) => void;
  onModel: (m: AppSettings['deepResearchModel']) => void;
  onTarget: (v: DeepResearchTargetLength) => void;
  onSectionLimit: (v: DeepResearchSectionLimit) => void;
  onIncludeImage: (v: boolean) => void;
  onImageStyle: (v: DecorativeImageStyle) => void;
  onFocusPerson?: (v: string | null) => void;
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
        aria-label={t(copy.newAction)}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-neutral-700 bg-white shadow-2xl dark:bg-neutral-950"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <Icon name="compass" className="text-indigo-500 dark:text-indigo-300" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t(copy.newAction)}</h2>
            <p className="text-xs text-neutral-500">{t(copy.composerSubtitle)}</p>
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
            placeholder={isTeaching && audience === 'students'
              ? t('Escribe el tema de los apuntes. El contenido lo explicará paso a paso con ejemplos y autoevaluación usando tus materiales.')
              : t(copy.objectivePlaceholder)}
          />
          {isTeaching && (
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                {t('Público objetivo y producto')}
              </span>
              <select
                data-testid="deep-research-audience"
                className="input w-full text-sm"
                value={audience}
                onChange={(event) => onAudience(event.target.value as StudyDeepResearchAudience)}
              >
                <option value="teacher">{t('Docente · planificación de la lección')}</option>
                <option value="students">{t('Alumnado · apuntes para entregar')}</option>
              </select>
              <span className="mt-1 block text-[11px] text-neutral-500" data-testid="deep-research-audience-help">
                {audience === 'teacher'
                  ? t('Generará objetivos, secuencia, actividades, comprobaciones de comprensión y evaluación para el docente.')
                  : t('Generará explicaciones, definiciones, ejemplos, síntesis y autoevaluación dirigidos al alumnado.')}
              </span>
            </label>
          )}
          {isGenealogy && (
            <div>
              <select
                className="input text-sm"
                value={focusPersonId ?? ''}
                onChange={(e) => onFocusPerson?.(e.target.value || null)}
              >
                <option value="">{t('Toda la familia (sin persona en foco)')}</option>
                {persons.map((p) => (
                  <option key={p.personId} value={p.personId}>
                    {p.displayName}
                    {p.birthDate ? ` (${p.birthDate})` : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-neutral-500">
                {t('Opcional: centra el informe en la biografía documentada de una persona concreta.')}
              </p>
            </div>
          )}
          {isTeaching && (
            <UnitStructureEditor
              mode={structureMode}
              outline={unitOutline}
              onMode={onStructureMode}
              onOutline={onUnitOutline}
            />
          )}
          <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
            <select className="input text-sm" value={target} onChange={(e) => onTarget(e.target.value as DeepResearchTargetLength)}>
              {Object.entries(DEEP_TARGET_LABELS).map(([id, label]) => (
                <option key={id} value={id}>{t(label)}</option>
              ))}
            </select>
            {/* Superseded once the teacher fixes the structure: the outline already says
                how many parts there are, and offering a second, contradictory answer is
                how a form starts lying to the person filling it in. */}
            {!(isTeaching && structureMode === 'manual') && (
              <select
                className="input text-sm"
                value={String(sectionLimit)}
                onChange={(e) => onSectionLimit(e.target.value === 'auto' ? 'auto' : (Number(e.target.value) as DeepResearchSectionLimit))}
              >
                {DEEP_SECTION_OPTIONS.map((option) => (
                  <option key={String(option.value)} value={String(option.value)}>{t(option.label)}</option>
                ))}
              </select>
            )}
            <select className="input text-sm" value={language} onChange={(e) => onLanguage(e.target.value as PromptLanguage)}>
              <option value="es">Español</option>
              <option value="en">English</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="pt">Português (Portugal)</option>
              <option value="pt-BR">Português (Brasil)</option>
              <option value="tr">Türkçe</option>
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
// Unit structure — who decides the parts of a teaching unit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The one thing Unit design adds to Deep Research: the teacher can hand the generator
 * a structure instead of receiving one. The slot list IS the contract — its length is
 * the number of parts and its order is their order — so changing the count grows or
 * trims the list rather than storing a separate number that could disagree with it.
 */
function UnitStructureEditor({
  mode,
  outline,
  onMode,
  onOutline,
}: {
  mode: 'ai' | 'manual';
  outline: DeepResearchOutlineSection[];
  onMode: (v: 'ai' | 'manual') => void;
  onOutline: (v: DeepResearchOutlineSection[]) => void;
}) {
  const setCount = (count: number) => {
    // Grow by appending blanks, shrink from the end: the teacher's typing in the parts
    // they keep must survive a change of mind about how many there are.
    onOutline(Array.from({ length: count }, (_unused, index) => outline[index] ?? { title: '', focus: '' }));
  };
  const patch = (index: number, change: Partial<DeepResearchOutlineSection>) => {
    onOutline(outline.map((slot, at) => (at === index ? { ...slot, ...change } : slot)));
  };

  return (
    <section className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800" data-testid="unit-structure">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('Estructura de la unidad')}</span>
        <div className="ml-auto flex overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700">
          {(['ai', 'manual'] as const).map((option) => (
            <button
              key={option}
              type="button"
              data-testid={`unit-structure-${option}`}
              aria-pressed={mode === option}
              className={`px-2.5 py-1 text-xs ${mode === option ? 'bg-indigo-600 text-white' : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900'}`}
              onClick={() => onMode(option)}
            >
              {t(option === 'ai' ? 'La decide la IA' : 'La defino yo')}
            </button>
          ))}
        </div>
      </div>

      {mode === 'ai' ? (
        <p className="mt-2 text-[11px] leading-5 text-neutral-500">
          {t('La IA agrupa los materiales y propone las partes de la unidad y su orden.')}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-2 text-[11px] text-neutral-500">
            {t('Número de partes')}
            <select
              className="input !py-1 text-xs"
              data-testid="unit-structure-count"
              value={outline.length}
              onChange={(event) => setCount(Number(event.target.value))}
            >
              {UNIT_SECTION_COUNTS.map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
          {outline.map((slot, index) => (
            <div key={index} className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-[11px] font-medium text-neutral-500">{index + 1}</span>
                <input
                  className="input w-full !py-1 text-xs"
                  data-testid={`unit-section-title-${index}`}
                  value={slot.title}
                  onChange={(event) => patch(index, { title: event.target.value })}
                  placeholder={t('Título de la parte (opcional)')}
                />
              </div>
              <input
                className="input mt-1.5 w-full !py-1 text-xs"
                data-testid={`unit-section-focus-${index}`}
                value={slot.focus ?? ''}
                onChange={(event) => patch(index, { focus: event.target.value })}
                placeholder={t('En qué debe centrarse (opcional)')}
              />
            </div>
          ))}
          <p className="text-[11px] leading-5 text-neutral-500">
            {t('Se generarán exactamente estas partes, en este orden. Las que dejes sin título las nombra la IA.')}
          </p>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tutorial
// ─────────────────────────────────────────────────────────────────────────────

function DeepResearchTutorial({ steps }: { steps: { icon: string; title: string; body: string }[] }) {
  return (
    <section className="border-b border-neutral-800 bg-white/95 px-4 py-3 dark:bg-neutral-950/80">
      <div className="grid grid-cols-4 gap-3 max-2xl:grid-cols-2 max-md:grid-cols-1">
        {steps.map((step) => (
          <TutorialStep key={step.title} icon={step.icon} title={t(step.title)} body={t(step.body)} />
        ))}
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
