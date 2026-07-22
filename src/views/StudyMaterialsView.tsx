import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type {
  StudyMaterialAnnotation,
  StudyMaterialContent,
  StudyMaterialDetail,
  StudyMaterialImportInput,
  StudyMaterialPreviewKind,
  StudyMaterialReadState,
  StudyMaterialSummary,
  StudyDocument,
  StudyPlacement,
  StudyWorkspace,
} from '@shared/types';
import { parseStudyMaterialMarkers, studyMaterialLocationLabel } from '@shared/studyMaterials';
import { Icon, Spinner } from '../components/ui';
import { LinkedKnowledgeDeleteFlow, type LinkedKnowledgeDeleteStep } from '../components/LinkedKnowledgeDeleteFlow';
import { TextInputModal } from '../components/TextInputModal';
import { ChipSelectCell } from '../components/dbGrid';
import { announceStudyWorkspaceChanged, STUDY_WORKSPACE_CHANGED } from '../components/StudySidebar';
import { Markdown } from '../components/Markdown';
import { ZoteroMaterialImportModal } from '../components/ZoteroMaterialImportModal';
import { t, tx } from '../i18n';

const PdfViewer = lazy(() => import('../components/materials/PdfViewer').then((module) => ({ default: module.PdfViewer })));
const EpubViewer = lazy(() => import('../components/materials/EpubViewer').then((module) => ({ default: module.EpubViewer })));

const READ_LABEL: Record<StudyMaterialReadState, string> = {
  pending: 'Pendiente', reading: 'En lectura', read: 'Leído', reviewed: 'Revisado',
};
const READ_COLOR: Record<StudyMaterialReadState, string> = {
  pending: '#f59e0b', reading: '#3b82f6', read: '#10b981', reviewed: '#8b5cf6',
};
const studyReadOptions = () => (Object.entries(READ_LABEL) as Array<[StudyMaterialReadState, string]>).map(([id, label]) => ({ id, label: t(label), color: READ_COLOR[id] }));
const PREVIEW_LABEL: Record<StudyMaterialPreviewKind, string> = {
  pdf: 'PDF', document: 'Documento', presentation: 'Presentación', image: 'Imagen', audio: 'Audio', unknown: 'Otro',
};
const INDEX_LABEL: Record<StudyMaterialSummary['indexStatus'], string> = {
  pending: 'Pendiente de indexar', indexing: 'Indexando…', indexed: 'Indexado', unavailable: 'Sin indexar', error: 'Error de indexación',
};

type MaterialPlacementDimension = 'course' | 'subject' | 'folder' | 'topic';
type StudyLibraryDeleteSource = { kind: 'document' | 'material'; id: string; title: string };

const studyLibrarySourceKey = (source: Pick<StudyLibraryDeleteSource, 'kind' | 'id'>) => `${source.kind}:${source.id}`;

function indexStatusClass(status: StudyMaterialSummary['indexStatus']): string {
  if (status === 'indexed') return 'text-emerald-600 dark:text-emerald-400';
  if (status === 'indexing') return 'text-teal-600 dark:text-teal-300';
  if (status === 'error') return 'text-red-500';
  return 'text-neutral-500';
}

interface MaterialImportDraft {
  paths: string[];
  title: string;
  description: string;
  tags: string[];
  citation: string;
  readState: StudyMaterialReadState;
  ocr: boolean;
  placements: StudyMaterialImportInput[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function materialIcon(kind: StudyMaterialPreviewKind): string {
  return kind === 'image' ? 'image' : kind === 'audio' ? 'play' : kind === 'presentation' ? 'columns' : kind === 'pdf' ? 'book' : 'notebook';
}

function MaterialAction({ icon, label, testId, disabled = false, tone = '', onClick, children }: {
  icon?: string;
  label: string;
  testId?: string;
  disabled?: boolean;
  tone?: string;
  onClick: () => void;
  children?: ReactNode;
}) {
  return <span className="group inline-flex" title={label}><button data-testid={testId} className={`btn btn-ghost h-7 min-h-7 justify-center gap-0 px-2 ${tone}`} aria-label={label} disabled={disabled} onClick={onClick}>{children ?? <Icon name={icon ?? 'help'} size={12} className="shrink-0" />}<span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:max-w-40 group-hover:opacity-100 group-focus-within:ml-1.5 group-focus-within:max-w-40 group-focus-within:opacity-100">{label}</span></button></span>;
}

export function StudyMaterialsView({ onOpenDocument, initialMaterialId }: { onOpenDocument: (id: string) => void; initialMaterialId?: string | null }) {
  const [materials, setMaterials] = useState<StudyMaterialSummary[]>([]);
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [query, setQuery] = useState('');
  const [readState, setReadState] = useState<StudyMaterialReadState | 'all'>('all');
  const [previewKind, setPreviewKind] = useState<StudyMaterialPreviewKind | 'all'>('all');
  const [courseId, setCourseId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<StudyMaterialSummary | null>(null);
  const [locating, setLocating] = useState<{ material: StudyMaterialSummary; mode: 'move' | 'duplicate' } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ sources: StudyLibraryDeleteSource[]; step: LinkedKnowledgeDeleteStep } | null>(null);
  const [message, setMessage] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [importDialogPaths, setImportDialogPaths] = useState<string[] | null>(null);
  const [zoteroImportOpen, setZoteroImportOpen] = useState(false);
  const [reindexingId, setReindexingId] = useState<string | null>(null);
  useEffect(() => { if (initialMaterialId) setSelected(initialMaterialId); }, [initialMaterialId]);

  const load = async () => {
    const [nextMaterials, nextWorkspace] = await Promise.all([
      window.nodus.listStudyMaterials({ search: query, readState, previewKind, courseId: courseId || undefined, subjectId: subjectId || undefined, topicId: topicId || undefined }),
      window.nodus.getStudyWorkspace(),
    ]);
    setMaterials(nextMaterials); setWorkspace(nextWorkspace);
  };

  useEffect(() => { const timer = window.setTimeout(() => void load(), 120); return () => window.clearTimeout(timer); }, [query, readState, previewKind, courseId, subjectId, topicId]);
  useEffect(() => window.nodus.onStudyMaterialIndexChanged(() => void load()), [query, readState, previewKind, courseId, subjectId, topicId]);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener(STUDY_WORKSPACE_CHANGED, refresh);
    return () => window.removeEventListener(STUDY_WORKSPACE_CHANGED, refresh);
  }, [query, readState, previewKind, courseId, subjectId, topicId]);

  const subjects = workspace?.subjects.filter((subject) => !courseId || subject.courseId === courseId) ?? [];
  const topics = workspace?.topics.filter((topic) => !subjectId || topic.subjectId === subjectId) ?? [];
  const notes = useMemo(() => {
    if (!workspace || readState !== 'all' || !['all', 'document'].includes(previewKind)) return [];
    const needle = query.trim().toLocaleLowerCase();
    return workspace.documents.filter((document) => {
      const placements = workspace.placements.filter((placement) => placement.documentId === document.id);
      if (courseId && !placements.some((placement) => placement.courseId === courseId)) return false;
      if (subjectId && !placements.some((placement) => placement.subjectId === subjectId)) return false;
      if (topicId && !placements.some((placement) => placement.topicId === topicId)) return false;
      return !needle || `${document.title} ${document.description ?? ''} ${document.contentMarkdown}`.toLocaleLowerCase().includes(needle);
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [workspace, query, readState, previewKind, courseId, subjectId, topicId]);
  const visibleSourceKeys = useMemo(() => new Set([
    ...notes.map((document) => studyLibrarySourceKey({ kind: 'document', id: document.id })),
    ...materials.map((material) => studyLibrarySourceKey({ kind: 'material', id: material.id })),
  ]), [notes, materials]);
  useEffect(() => {
    setSelectedSources((current) => {
      const next = new Set([...current].filter((key) => visibleSourceKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [visibleSourceKeys]);

  const toggleSource = (source: Pick<StudyLibraryDeleteSource, 'kind' | 'id'>) => {
    const key = studyLibrarySourceKey(source);
    setSelectedSources((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const requestDelete = (sources: StudyLibraryDeleteSource[]) => {
    if (sources.length) setPendingDelete({ sources, step: 'sources' });
  };
  const requestSelectedDelete = () => requestDelete([
    ...notes.filter((document) => selectedSources.has(studyLibrarySourceKey({ kind: 'document', id: document.id }))).map((document) => ({ kind: 'document' as const, id: document.id, title: document.title })),
    ...materials.filter((material) => selectedSources.has(studyLibrarySourceKey({ kind: 'material', id: material.id }))).map((material) => ({ kind: 'material' as const, id: material.id, title: material.title })),
  ]);
  const deletePendingSources = async (purgeLinkedKnowledge: boolean) => {
    if (!pendingDelete) return;
    const sources = pendingDelete.sources;
    setPendingDelete(null);
    for (const source of sources) {
      if (source.kind === 'document') {
        await window.nodus.setStudyLifecycle('document', source.id, 'trash', { purgeLinkedKnowledge });
      } else {
        await window.nodus.setStudyMaterialLifecycle(source.id, 'trash', { purgeLinkedKnowledge });
      }
    }
    if (selected && sources.some((source) => source.kind === 'material' && source.id === selected)) setSelected(null);
    setSelectedSources((current) => {
      const next = new Set(current);
      sources.forEach((source) => next.delete(studyLibrarySourceKey(source)));
      return next;
    });
    announceStudyWorkspaceChanged();
    await load();
  };
  const finishImport = async (results: Awaited<ReturnType<typeof window.nodus.importStudyMaterials>>) => {
    if (!results.length) {
      setMessage(t('No se encontraron materiales compatibles.'));
      return;
    }
    const duplicates = results.filter((result) => result.duplicate).length;
    setMessage(`${results.length} ${t('materiales añadidos')}${duplicates ? ` · ${duplicates} ${t('duplicados enlazados sin copiar')}` : ''}`);
    await load();
  };
  const prepareDroppedMaterials = (files: FileList) => {
    const paths = Array.from(files).map((file) => window.nodus.getPathForDroppedFile(file)).filter(Boolean);
    if (paths.length) setImportDialogPaths([...new Set(paths)]);
  };
  const commitMaterialImport = async (draft: MaterialImportDraft) => {
    setMessage('');
    const placements = draft.placements.filter((placement) => placement.courseId || placement.subjectId || placement.folderId || placement.topicId);
    const firstPlacement = placements[0] ?? {};
    const results = await window.nodus.importStudyMaterialPaths(draft.paths, { ...firstPlacement, readState: draft.readState, tags: draft.tags, ocr: draft.ocr });
    const uniqueMaterials = [...new Map(results.map((result) => [result.material.id, result.material])).values()];
    for (const material of uniqueMaterials) {
      for (const placement of placements.slice(1)) await window.nodus.addStudyMaterialPlacement(material.id, placement);
      await window.nodus.updateStudyMaterial(material.id, {
        ...(uniqueMaterials.length === 1 && draft.title.trim() ? { title: draft.title.trim() } : {}),
        description: draft.description,
        readState: draft.readState,
        metadata: { tags: draft.tags },
        bibliography: { citation: draft.citation },
      });
    }
    await finishImport(results);
  };

  const updatePlacementDimension = async (
    material: StudyMaterialSummary,
    dimension: MaterialPlacementDimension,
    nextIds: string[],
  ) => {
    if (!workspace) return;
    const field = `${dimension}Id` as 'courseId' | 'subjectId' | 'folderId' | 'topicId';
    const currentIds = new Set(
      material.placements.map((placement) => placement[field]).filter((id): id is string => Boolean(id)),
    );
    const requestedIds = new Set(nextIds);
    const removedIds = new Set([...currentIds].filter((id) => !requestedIds.has(id)));

    for (const placement of material.placements) {
      const value = placement[field];
      if (value && removedIds.has(value)) {
        await window.nodus.removeStudyMaterialPlacement(material.id, placement.id);
      }
    }

    for (const id of nextIds.filter((value) => !currentIds.has(value))) {
      let placement: StudyMaterialImportInput;
      if (dimension === 'course') {
        placement = { courseId: id };
      } else if (dimension === 'subject') {
        const subject = workspace.subjects.find((item) => item.id === id);
        if (!subject) continue;
        placement = { courseId: subject.courseId, subjectId: id };
      } else if (dimension === 'folder') {
        const folder = workspace.folders.find((item) => item.id === id);
        if (!folder) continue;
        const subject = workspace.subjects.find((item) => item.id === folder.subjectId);
        placement = {
          courseId: folder.courseId ?? subject?.courseId ?? null,
          subjectId: folder.subjectId,
          folderId: id,
        };
      } else {
        const topic = workspace.topics.find((item) => item.id === id);
        if (!topic) continue;
        const subject = workspace.subjects.find((item) => item.id === topic.subjectId);
        placement = {
          courseId: subject?.courseId ?? null,
          subjectId: topic.subjectId,
          folderId: topic.folderId,
          topicId: id,
        };
      }
      await window.nodus.addStudyMaterialPlacement(material.id, placement);
    }

    announceStudyWorkspaceChanged();
    await load();
  };

  return <div
    className="relative flex h-full min-h-0 flex-col bg-neutral-950"
    data-testid="study-materials-view"
    onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragActive(true); } }}
    onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }}
    onDrop={(event) => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); setDragActive(false); prepareDroppedMaterials(event.dataTransfer.files); }}
  >
    <header className="border-b border-neutral-800 px-5 py-4">
      <div className="flex flex-wrap items-center gap-3"><div><h1 className="text-lg font-semibold text-neutral-100">{t('Materiales de estudio')}</h1><p className="text-xs text-neutral-500">{t('Fuentes locales, anotables y enlazadas con tus apuntes.')}</p></div><span className="rounded-full bg-teal-950 px-2.5 py-1 text-[10px] text-teal-300">{materials.length} {t('materiales')}</span><span className="rounded-full bg-indigo-950 px-2.5 py-1 text-[10px] text-indigo-300">{notes.length} {t('Apuntes')}</span><div className="ml-auto flex flex-wrap items-center gap-2"><button data-testid="study-material-zotero-import" className="btn btn-ghost border border-neutral-700" onClick={() => setZoteroImportOpen(true)}><Icon name="book" size={13} /> {t('Importar de Zotero')}</button><button data-testid="study-material-import" className="btn btn-primary" onClick={() => setImportDialogPaths([])}><Icon name="upload" size={13} /> {t('Desde el dispositivo')}</button></div></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(240px,1fr)_150px_150px_180px_180px_180px]">
        <div className="relative"><Icon name="search" size={13} className="pointer-events-none absolute left-3 top-2.5 text-neutral-600" /><input data-testid="study-material-search" className="input input-with-leading-icon h-8 w-full" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar materiales…')} /></div>
        <select className="input h-8 text-xs" value={readState} onChange={(event) => setReadState(event.target.value as StudyMaterialReadState | 'all')}><option value="all">{t('Todos los estados')}</option>{Object.entries(READ_LABEL).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select>
        <select className="input h-8 text-xs" value={previewKind} onChange={(event) => setPreviewKind(event.target.value as StudyMaterialPreviewKind | 'all')}><option value="all">{t('Todos los formatos')}</option>{Object.entries(PREVIEW_LABEL).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select>
        <select className="input h-8 text-xs" value={courseId} onChange={(event) => { setCourseId(event.target.value); setSubjectId(''); setTopicId(''); }}><option value="">{t('Todos los cursos')}</option>{workspace?.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select>
        <select className="input h-8 text-xs" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setTopicId(''); }}><option value="">{t('Todas las asignaturas')}</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select>
        <select className="input h-8 text-xs" value={topicId} onChange={(event) => setTopicId(event.target.value)}><option value="">{t('Todos los temas')}</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select>
      </div>
      {selectedSources.size > 0 && <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-900/40 bg-red-950/20 px-3 py-2"><span className="text-xs text-neutral-300">{tx('{n} seleccionados', { n: selectedSources.size })}</span><button className="btn btn-ghost ml-auto h-7 text-xs" onClick={() => setSelectedSources(new Set())}>{t('Quitar selección')}</button><button data-testid="study-library-delete-selected" className="btn h-7 bg-red-600 px-3 text-xs text-white hover:bg-red-500" onClick={requestSelectedDelete}><Icon name="trash" size={12} />{t('Eliminar selección')}</button></div>}
      {message && <p className="mt-2 text-xs text-amber-300">{message}</p>}
    </header>
    <main className="relative min-h-0 flex-1 overflow-auto">
      {dragActive && <div className="pointer-events-none absolute inset-3 z-[60] grid place-items-center rounded-2xl border-2 border-dashed border-teal-500 bg-teal-50/95 text-center shadow-2xl dark:bg-teal-950/90" data-testid="study-material-dropzone"><div><Icon name="upload" size={32} className="mx-auto mb-3 text-teal-600 dark:text-teal-300" /><p className="font-semibold text-teal-900 dark:text-teal-100">{t('Suelta los materiales para prepararlos')}</p><p className="mt-1 text-xs text-teal-700 dark:text-teal-300">{t('Se abrirá el formulario para completar sus metadatos y ubicaciones.')}</p></div></div>}
      {materials.length === 0 && notes.length === 0 && <div className="grid h-full place-items-center text-center"><div><span className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-teal-950 text-teal-400"><Icon name="book" size={28} /></span><h2 className="text-base font-semibold text-neutral-300">{t('Tu biblioteca de materiales está vacía')}</h2><p className="mt-1 max-w-md text-sm text-neutral-600">{t('Añade PDF, Word, Markdown, presentaciones, EPUB, imágenes o audio. Los archivos se guardan dentro del vault.')}</p><button className="btn btn-primary mt-4" onClick={() => setImportDialogPaths([])}><Icon name="upload" size={13} /> {t('Añadir primer material')}</button></div></div>}
      {notes.length > 0 && <section className="border-b border-neutral-800" data-testid="study-material-notes-section"><div className="sticky left-0 flex items-center gap-2 border-b border-neutral-800 bg-neutral-900/40 px-4 py-2"><Icon name="notebook" size={13} className="text-indigo-300" /><h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{t('Apuntes')}</h2><span className="text-[10px] text-neutral-600">{notes.length}</span></div><StudyNotesTable notes={notes} placements={workspace?.placements ?? []} workspace={workspace} selected={selectedSources} onToggle={toggleSource} onOpen={onOpenDocument} onDelete={(document) => requestDelete([{ kind: 'document', id: document.id, title: document.title }])} /></section>}
      {materials.length === 0 ? null : <MaterialTable
        materials={materials}
        workspace={workspace}
        selected={selectedSources}
        onToggle={toggleSource}
        onOpen={(material) => { if (material.origin === 'zotero_link') void window.nodus.openStudyMaterialInZotero(material.id); else setSelected(material.id); }}
        onFavorite={async (material) => { await window.nodus.updateStudyMaterial(material.id, { favorite: !material.favorite }); await load(); }}
        onReadState={async (material, next) => { await window.nodus.updateStudyMaterial(material.id, { readState: next }); await load(); }}
        onPlacementsChange={updatePlacementDimension}
        onEdit={setEditing}
        onLocate={(material, mode) => setLocating({ material, mode })}
        onDelete={(material) => requestDelete([{ kind: 'material', id: material.id, title: material.title }])}
        reindexingId={reindexingId}
        onReindex={async (material) => { setReindexingId(material.id); try { await window.nodus.reindexStudyMaterial(material.id); await load(); } finally { setReindexingId(null); } }}
      />}
    </main>
    {selected && <MaterialViewer materialId={selected} workspace={workspace} onClose={() => setSelected(null)} onChanged={load} onOpenDocument={onOpenDocument} onRequestDelete={(material) => requestDelete([{ kind: 'material', id: material.id, title: material.title }])} />}
    {editing && <MaterialMetadataDialog material={editing} onCancel={() => setEditing(null)} onSave={async (patch) => { await window.nodus.updateStudyMaterial(editing.id, patch); setEditing(null); await load(); }} />}
    {locating && workspace && <MaterialLocationDialog material={locating.material} mode={locating.mode} workspace={workspace} onCancel={() => setLocating(null)} onSave={async (input) => { if (locating.mode === 'move') await window.nodus.setPrimaryStudyMaterialPlacement(locating.material.id, input); else await window.nodus.addStudyMaterialPlacement(locating.material.id, input); setLocating(null); await load(); }} />}
    {pendingDelete && <LinkedKnowledgeDeleteFlow items={pendingDelete.sources} step={pendingDelete.step} onContinue={() => setPendingDelete((current) => current ? { ...current, step: 'knowledge' } : current)} onChoose={(purge) => void deletePendingSources(purge)} onCancel={() => setPendingDelete(null)} />}
    {importDialogPaths && workspace && <MaterialImportDialog initialPaths={importDialogPaths} initialPlacement={{ courseId: courseId || null, subjectId: subjectId || null, topicId: topicId || null }} workspace={workspace} onCancel={() => setImportDialogPaths(null)} onSave={async (draft) => { await commitMaterialImport(draft); setImportDialogPaths(null); }} />}
    {zoteroImportOpen && <ZoteroMaterialImportModal placement={{ courseId: courseId || null, subjectId: subjectId || null, topicId: topicId || null }} onClose={() => setZoteroImportOpen(false)} onImported={async (result) => finishImport([result])} />}
  </div>;
}

function StudyNotesTable({ notes, placements, workspace, selected, onToggle, onOpen, onDelete }: {
  notes: StudyDocument[];
  placements: StudyPlacement[];
  workspace: StudyWorkspace | null;
  selected: Set<string>;
  onToggle: (source: Pick<StudyLibraryDeleteSource, 'kind' | 'id'>) => void;
  onOpen: (id: string) => void;
  onDelete: (document: StudyDocument) => void;
}) {
  const locationNames = (documentId: string, dimension: 'course' | 'subject' | 'folder' | 'topic') => {
    if (!workspace) return '—';
    const field = `${dimension}Id` as 'courseId' | 'subjectId' | 'folderId' | 'topicId';
    const entities = dimension === 'course' ? workspace.courses : dimension === 'subject' ? workspace.subjects : dimension === 'folder' ? workspace.folders : workspace.topics;
    const ids = [...new Set(placements.filter((placement) => placement.documentId === documentId).map((placement) => placement[field]).filter((id): id is string => Boolean(id)))];
    const names = ids.map((id) => entities.find((entity) => entity.id === id)?.name).filter(Boolean);
    return names.length ? names.join(', ') : '—';
  };
  const allSelected = notes.every((document) => selected.has(studyLibrarySourceKey({ kind: 'document', id: document.id })));
  return <table className="w-full min-w-[980px] border-collapse text-xs" data-testid="study-material-notes-table">
    <thead className="bg-neutral-950/95"><tr className="border-b border-neutral-800 text-neutral-500"><th className="w-10 px-3 py-2 text-center"><input type="checkbox" aria-label={t('Seleccionar todos')} checked={allSelected} onChange={() => notes.forEach((document) => { const isSelected = selected.has(studyLibrarySourceKey({ kind: 'document', id: document.id })); if (isSelected === allSelected) onToggle({ kind: 'document', id: document.id }); })} /></th><th className="w-[320px] px-4 py-2 text-center font-medium">{t('Apunte')}</th><th className="px-3 py-2 text-center font-medium">{t('Curso')}</th><th className="px-3 py-2 text-center font-medium">{t('Asignatura')}</th><th className="px-3 py-2 text-center font-medium">{t('Carpeta')}</th><th className="px-3 py-2 text-center font-medium">{t('Tema')}</th><th className="w-[110px] px-3 py-2 text-center font-medium">{t('Formato')}</th><th className="w-[90px] px-3 py-2 text-center font-medium">{t('Acciones')}</th></tr></thead>
    <tbody>{notes.map((document) => <tr key={document.id} data-testid={`study-material-note-${document.id}`} className="cursor-pointer border-b border-neutral-800/60 hover:bg-neutral-900/40" onClick={() => onOpen(document.id)}><td className="px-3 py-2.5"><input type="checkbox" aria-label={document.title} checked={selected.has(studyLibrarySourceKey({ kind: 'document', id: document.id }))} onClick={(event) => event.stopPropagation()} onChange={() => onToggle({ kind: 'document', id: document.id })} /></td><td className="px-4 py-2.5"><div className="flex max-w-[310px] items-center gap-2"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-600/15 text-indigo-300">{document.emoji ? <span>{document.emoji}</span> : <Icon name={document.icon || 'notebook'} size={15} />}</span><span className="min-w-0"><span className="block truncate font-medium text-neutral-200">{document.title}</span><span className="block truncate text-[10px] text-neutral-600">{document.description || t('Apunte creado en Nodus')}</span></span></div></td>{(['course', 'subject', 'folder', 'topic'] as const).map((dimension) => <td key={dimension} className="max-w-[180px] truncate px-3 py-2.5 text-neutral-500">{locationNames(document.id, dimension)}</td>)}<td className="px-3 py-2.5 text-neutral-500">{t('Apunte')}</td><td className="px-3 py-2.5 text-right"><div className="flex justify-end"><button className="btn btn-ghost h-7 px-2" title={t('Abrir apunte')} onClick={(event) => { event.stopPropagation(); onOpen(document.id); }}><Icon name="external" size={12} /></button><button className="btn btn-ghost h-7 px-2 text-red-400" title={t('Mover a la papelera')} onClick={(event) => { event.stopPropagation(); onDelete(document); }}><Icon name="trash" size={12} /></button></div></td></tr>)}</tbody>
  </table>;
}

interface MaterialLocationDraft {
  courseId: string;
  subjectId: string;
  folderId: string;
  topicId: string;
}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

function MaterialImportDialog({ initialPaths, initialPlacement, workspace, onSave, onCancel }: { initialPaths: string[]; initialPlacement: StudyMaterialImportInput; workspace: StudyWorkspace; onSave: (draft: MaterialImportDraft) => Promise<void>; onCancel: () => void }) {
  const firstName = initialPaths.length === 1 ? fileNameFromPath(initialPaths[0]).replace(/\.[^.]+$/, '') : '';
  const [paths, setPaths] = useState([...new Set(initialPaths)]);
  const [title, setTitle] = useState(firstName);
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [citation, setCitation] = useState('');
  const [readState, setReadState] = useState<StudyMaterialReadState>('pending');
  const [ocr, setOcr] = useState(false);
  const [locations, setLocations] = useState<MaterialLocationDraft[]>([{
    courseId: initialPlacement.courseId ?? '', subjectId: initialPlacement.subjectId ?? '', folderId: initialPlacement.folderId ?? '', topicId: initialPlacement.topicId ?? '',
  }]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (paths.length === 1 && !title.trim()) setTitle(fileNameFromPath(paths[0]).replace(/\.[^.]+$/, ''));
  }, [paths]);

  const appendPaths = (nextPaths: string[]) => setPaths((current) => [...new Set([...current, ...nextPaths.filter(Boolean)])]);
  const browse = async (folder = false) => appendPaths(await window.nodus.chooseStudyMaterialPaths(folder));
  const dropFiles = (files: FileList) => appendPaths(Array.from(files).map((file) => window.nodus.getPathForDroppedFile(file)));
  const updateLocation = (index: number, patch: Partial<MaterialLocationDraft>) => setLocations((current) => current.map((location, locationIndex) => locationIndex === index ? { ...location, ...patch } : location));
  const submit = async () => {
    if (!paths.length || busy) return;
    setBusy(true); setError('');
    try {
      await onSave({
        paths, title, description, citation, readState, ocr,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        placements: locations.map((location) => ({ courseId: location.courseId || null, subjectId: location.subjectId || null, folderId: location.folderId || null, topicId: location.topicId || null })),
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  return createPortal(<div className="fixed inset-0 z-[150] grid place-items-center bg-black/55 p-5" onClick={onCancel} data-testid="study-material-import-dialog"><section className="card-modal flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden" onClick={(event) => event.stopPropagation()}>
    <header className="flex items-center gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800"><div><h2 className="text-base font-semibold">{t('Añadir materiales')}</h2><p className="mt-0.5 text-xs text-neutral-500">{t('Adjunta los archivos, completa sus metadatos y elige una o varias ubicaciones.')}</p></div><button className="btn btn-ghost ml-auto px-2" onClick={onCancel} aria-label={t('Cerrar')}><Icon name="x" /></button></header>
    <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
      <div className="space-y-4 border-b border-neutral-200 p-5 dark:border-neutral-800 lg:border-b-0 lg:border-r">
        <section><h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Metadatos')}</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs text-neutral-500">{t('Título')}<input data-testid="study-material-import-title" className="input mt-1 w-full" value={title} disabled={paths.length > 1} onChange={(event) => setTitle(event.target.value)} placeholder={paths.length > 1 ? t('Se conservará el nombre de cada archivo') : t('Título del material')} /></label><label className="text-xs text-neutral-500">{t('Estado')}<select className="input mt-1 w-full" value={readState} onChange={(event) => setReadState(event.target.value as StudyMaterialReadState)}>{Object.entries(READ_LABEL).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label></div><label className="mt-3 block text-xs text-neutral-500">{t('Descripción')}<textarea data-testid="study-material-import-description" className="input mt-1 min-h-20 w-full" value={description} onChange={(event) => setDescription(event.target.value)} /></label><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs text-neutral-500">{t('Etiquetas separadas por comas')}<input className="input mt-1 w-full" value={tags} onChange={(event) => setTags(event.target.value)} /></label><label className="text-xs text-neutral-500">{t('Referencia bibliográfica')}<input className="input mt-1 w-full" value={citation} onChange={(event) => setCitation(event.target.value)} /></label></div><label className="mt-3 flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400"><input type="checkbox" checked={ocr} onChange={(event) => setOcr(event.target.checked)} />{t('Aplicar OCR a documentos escaneados')}</label></section>
        <section><div className="flex items-center"><div><h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Ubicaciones')}</h3><p className="mt-1 text-[11px] text-neutral-500">{t('Puedes enlazar los materiales a varios cursos, asignaturas, carpetas o temas.')}</p></div><button data-testid="study-material-add-location" className="btn btn-ghost ml-auto text-xs" onClick={() => setLocations((current) => [...current, { courseId: '', subjectId: '', folderId: '', topicId: '' }])}><Icon name="plus" size={12} />{t('Añadir ubicación')}</button></div><div className="mt-3 space-y-3">{locations.map((location, index) => {
          const subjects = workspace.subjects.filter((subject) => !location.courseId || subject.courseId === location.courseId);
          const folders = workspace.folders.filter((folder) => !location.subjectId || folder.subjectId === location.subjectId);
          const topics = workspace.topics.filter((topic) => !location.subjectId || topic.subjectId === location.subjectId).filter((topic) => location.folderId ? topic.folderId === location.folderId : !topic.folderId);
          return <div key={index} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/40" data-testid="study-material-import-location"><div className="grid gap-2 sm:grid-cols-2"><select aria-label={t('Curso')} className="input w-full text-xs" value={location.courseId} onChange={(event) => updateLocation(index, { courseId: event.target.value, subjectId: '', folderId: '', topicId: '' })}><option value="">{t('Sin curso')}</option>{workspace.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select><select aria-label={t('Asignatura')} className="input w-full text-xs" value={location.subjectId} onChange={(event) => updateLocation(index, { subjectId: event.target.value, folderId: '', topicId: '' })}><option value="">{t('Sin asignatura')}</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select><select aria-label={t('Carpeta')} className="input w-full text-xs" value={location.folderId} disabled={!location.subjectId} onChange={(event) => updateLocation(index, { folderId: event.target.value, topicId: '' })}><option value="">{t('Sin carpeta')}</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><select aria-label={t('Tema')} className="input w-full text-xs" value={location.topicId} disabled={!location.subjectId} onChange={(event) => updateLocation(index, { topicId: event.target.value })}><option value="">{t('Sin tema')}</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></div>{locations.length > 1 && <button className="mt-2 text-[11px] text-red-500 hover:text-red-400" onClick={() => setLocations((current) => current.filter((_, locationIndex) => locationIndex !== index))}>{t('Quitar ubicación')}</button>}</div>;
        })}</div></section>
      </div>
      <div className="flex min-h-[420px] flex-col p-5"><h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Archivos')}</h3><div className={`mt-3 grid min-h-44 place-items-center rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${dragging ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/40' : 'border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900/30'}`} onDragEnter={(event) => { event.stopPropagation(); if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }} onDragOver={(event) => { event.stopPropagation(); event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDragLeave={(event) => { event.stopPropagation(); if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={(event) => { event.stopPropagation(); event.preventDefault(); setDragging(false); dropFiles(event.dataTransfer.files); }} data-testid="study-material-import-dropzone"><div><Icon name="upload" size={28} className="mx-auto text-teal-600 dark:text-teal-300" /><p className="mt-3 text-sm font-medium">{t('Arrastra aquí tus materiales')}</p><p className="mt-1 text-xs text-neutral-500">{t('o selecciónalos desde el dispositivo')}</p><button className="btn btn-primary mt-4" onClick={() => void browse(false)}>{t('Seleccionar archivos o ZIP')}</button><button className="btn btn-ghost mt-4" onClick={() => void browse(true)}>{t('Seleccionar carpeta')}</button></div></div><div className="mt-4 min-h-0 flex-1 overflow-y-auto">{paths.length ? <div className="space-y-2">{paths.map((filePath) => <div key={filePath} className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800"><Icon name="book" size={13} className="text-teal-600" /><span className="min-w-0 flex-1 truncate" title={filePath}>{fileNameFromPath(filePath)}</span><button className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-red-500 dark:hover:bg-neutral-800" onClick={() => setPaths((current) => current.filter((path) => path !== filePath))}><Icon name="x" size={11} /></button></div>)}</div> : <p className="py-6 text-center text-xs text-neutral-500">{t('Todavía no has adjuntado ningún material.')}</p>}</div></div>
    </div>
    <footer className="flex items-center gap-3 border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">{error && <p className="min-w-0 flex-1 truncate text-xs text-red-500" title={error}>{error}</p>}<button className="btn btn-ghost ml-auto" onClick={onCancel}>{t('Cancelar')}</button><button data-testid="study-material-import-confirm" className="btn btn-primary" disabled={!paths.length || busy} onClick={() => void submit()}>{busy ? <Spinner label={t('Importando…')} /> : t(paths.length === 1 ? 'Añadir material' : 'Añadir materiales')}</button></footer>
  </section></div>, document.body);
}

function MaterialTable({
  materials,
  workspace,
  selected,
  onToggle,
  onOpen,
  onFavorite,
  onReadState,
  onPlacementsChange,
  onEdit,
  onLocate,
  onDelete,
  onReindex,
  reindexingId,
}: {
  materials: StudyMaterialSummary[];
  workspace: StudyWorkspace | null;
  selected: Set<string>;
  onToggle: (source: Pick<StudyLibraryDeleteSource, 'kind' | 'id'>) => void;
  onOpen: (material: StudyMaterialSummary) => void;
  onFavorite: (material: StudyMaterialSummary) => Promise<void>;
  onReadState: (material: StudyMaterialSummary, state: StudyMaterialReadState) => Promise<void>;
  onPlacementsChange: (material: StudyMaterialSummary, dimension: MaterialPlacementDimension, ids: string[]) => Promise<void>;
  onEdit: (material: StudyMaterialSummary) => void;
  onLocate: (material: StudyMaterialSummary, mode: 'move' | 'duplicate') => void;
  onDelete: (material: StudyMaterialSummary) => void;
  onReindex: (material: StudyMaterialSummary) => Promise<void>;
  reindexingId: string | null;
}) {
  const readOptions = studyReadOptions();
  const locationOptions = {
    course: workspace?.courses.map((item) => ({ id: item.id, label: item.name, color: item.color })) ?? [],
    subject: workspace?.subjects.map((item) => ({ id: item.id, label: item.name, color: item.color })) ?? [],
    folder: workspace?.folders.map((item) => ({ id: item.id, label: item.name, color: item.color })) ?? [],
    topic: workspace?.topics.map((item) => ({ id: item.id, label: item.name, color: item.color })) ?? [],
  } satisfies Record<MaterialPlacementDimension, Array<{ id: string; label: string; color: string | null }>>;
  const placementIds = (material: StudyMaterialSummary, dimension: MaterialPlacementDimension) => {
    const field = `${dimension}Id` as 'courseId' | 'subjectId' | 'folderId' | 'topicId';
    return [...new Set(
      material.placements.map((placement) => placement[field]).filter((id): id is string => Boolean(id)),
    )];
  };
  const allSelected = materials.every((material) => selected.has(studyLibrarySourceKey({ kind: 'material', id: material.id })));
  return <table className="w-full min-w-[1180px] border-collapse text-xs" data-testid="study-material-table">
    <thead className="sticky top-0 z-10 bg-neutral-950/95 backdrop-blur">
      <tr className="border-b border-neutral-800 text-neutral-500">
        <th className="w-10 px-3 py-2 text-center"><input type="checkbox" aria-label={t('Seleccionar todos')} checked={allSelected} onChange={() => materials.forEach((material) => { const isSelected = selected.has(studyLibrarySourceKey({ kind: 'material', id: material.id })); if (isSelected === allSelected) onToggle({ kind: 'material', id: material.id }); })} /></th>
        <th className="w-[300px] px-4 py-2 text-center font-medium">{t('Material')}</th>
        <th className="w-[135px] px-3 py-2 text-center font-medium">{t('Curso')}</th>
        <th className="w-[150px] px-3 py-2 text-center font-medium">{t('Asignatura')}</th>
        <th className="w-[145px] px-3 py-2 text-center font-medium">{t('Carpeta')}</th>
        <th className="w-[145px] px-3 py-2 text-center font-medium">{t('Tema')}</th>
        <th className="w-[115px] px-3 py-2 text-center font-medium">{t('Estado')}</th>
        <th className="w-[90px] px-3 py-2 text-center font-medium">{t('Formato')}</th>
        <th className="w-[90px] px-3 py-2 text-center font-medium">{t('Tamaño')}</th>
        <th className="w-[260px] px-3 py-2 text-center font-medium">{t('Acciones')}</th>
      </tr>
    </thead>
    <tbody>
      {materials.map((material) => <tr key={material.id} data-testid="study-material-row" className="border-b border-neutral-800/60 hover:bg-neutral-900/40">
        <td className="px-3 py-2.5"><input type="checkbox" aria-label={material.title} checked={selected.has(studyLibrarySourceKey({ kind: 'material', id: material.id }))} onChange={() => onToggle({ kind: 'material', id: material.id })} /></td>
        <td className="px-4 py-2.5"><button className="flex max-w-[290px] items-center gap-2 text-left" onClick={() => onOpen(material)}><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-600/15 text-indigo-300"><Icon name={material.origin === 'zotero_link' ? 'external' : materialIcon(material.previewKind)} size={15} /></span><span className="min-w-0"><span className="block truncate font-medium text-neutral-200">{material.title}</span><span className="block truncate text-[10px] text-neutral-600">{material.origin === 'zotero_link' ? t('Enlace de Zotero') : material.fileName}</span><span className={`block truncate text-[10px] ${indexStatusClass(material.indexStatus)}`} title={material.indexError ?? undefined}>{material.origin === 'zotero_link' ? t('Se abre en Zotero') : t(INDEX_LABEL[material.indexStatus])}{material.embeddingModel ? ` · ${material.embeddingModel}` : ''}</span></span></button></td>
        {(['course', 'subject', 'folder', 'topic'] as const).map((dimension) => <td key={dimension} className="study-material-state-cell px-1 py-1"><div className="h-8"><ChipSelectCell values={placementIds(material, dimension)} options={locationOptions[dimension]} multi onChange={(ids) => void onPlacementsChange(material, dimension, ids)} placeholder={t('Seleccionar')} /></div></td>)}
        <td className="study-material-state-cell px-1 py-1"><div className="h-8"><ChipSelectCell values={[material.readState]} options={readOptions} multi={false} onChange={(values) => { const next = values[0] as StudyMaterialReadState | undefined; if (next) void onReadState(material, next); }} /></div></td>
        <td className="px-3 py-2.5 text-neutral-500">{material.origin === 'zotero_link' ? 'ZOTERO' : material.extension.toUpperCase()}</td>
        <td className="px-3 py-2.5 text-neutral-500">{material.origin === 'zotero_link' ? '—' : formatBytes(material.sizeBytes)}</td>
        <td className="px-3 py-2.5"><div className="flex justify-end gap-0.5">
          {material.origin === 'zotero_link' ? <MaterialAction testId="study-material-open-zotero" icon="external" label={t('Abrir en Zotero')} onClick={() => void window.nodus.openStudyMaterialInZotero(material.id)} /> : <MaterialAction testId="study-material-reindex" label={t('Reindexar material')} disabled={reindexingId === material.id || material.indexStatus === 'indexing'} onClick={() => void onReindex(material)}>{reindexingId === material.id || material.indexStatus === 'indexing' ? <Spinner label="" /> : <Icon name="refresh" size={12} />}</MaterialAction>}
          {material.origin !== 'zotero_link' && <MaterialAction testId="study-material-download" icon="download" label={t('Descargar material')} onClick={() => void window.nodus.downloadStudyMaterial(material.id)} />}
          {material.origin === 'zotero_import' && <MaterialAction icon="external" label={t('Abrir origen en Zotero')} onClick={() => void window.nodus.openStudyMaterialInZotero(material.id)} />}
          <MaterialAction label={t(material.favorite ? 'Quitar de favoritos' : 'Marcar como favorito')} onClick={() => void onFavorite(material)}><Icon name="star" size={12} className={material.favorite ? 'text-amber-400' : 'text-neutral-600'} /></MaterialAction>
          <MaterialAction icon="edit" label={t('Editar nombre y metadatos')} onClick={() => onEdit(material)} />
          <MaterialAction icon="folder" label={t('Cambiar ubicación')} onClick={() => onLocate(material, 'move')} />
          <MaterialAction icon="copy" label={t('Duplicar en otra ubicación')} onClick={() => onLocate(material, 'duplicate')} />
          <MaterialAction icon="trash" label={t('Mover a la papelera')} tone="text-red-400" onClick={() => onDelete(material)} />
        </div></td>
      </tr>)}
    </tbody>
  </table>;
}

function MaterialMetadataDialog({ material, onSave, onCancel }: { material: StudyMaterialSummary; onSave: (patch: Parameters<typeof window.nodus.updateStudyMaterial>[1]) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(material.title);
  const [description, setDescription] = useState(material.description);
  const [tags, setTags] = useState((material.metadata.tags ?? []).join(', '));
  const [citation, setCitation] = useState(material.bibliography.citation);
  const [busy, setBusy] = useState(false);
  return createPortal(<div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-6" onClick={onCancel}><form className="card-modal w-full max-w-xl space-y-3 p-5" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); setBusy(true); void onSave({ title, description, metadata: { tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean) }, bibliography: { citation } }).finally(() => setBusy(false)); }}>
    <h2 className="text-base font-semibold">{t('Editar material')}</h2>
    <label className="block text-xs text-neutral-500">{t('Título')}<input autoFocus className="input mt-1 w-full" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label className="block text-xs text-neutral-500">{t('Descripción')}<textarea className="input mt-1 min-h-20 w-full" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <label className="block text-xs text-neutral-500">{t('Etiquetas separadas por comas')}<input className="input mt-1 w-full" value={tags} onChange={(event) => setTags(event.target.value)} /></label>
    <label className="block text-xs text-neutral-500">{t('Referencia bibliográfica')}<textarea className="input mt-1 min-h-16 w-full" value={citation} onChange={(event) => setCitation(event.target.value)} /></label>
    <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={onCancel}>{t('Cancelar')}</button><button className="btn btn-primary" disabled={busy || !title.trim()}>{busy ? t('Guardando…') : t('Guardar')}</button></div>
  </form></div>, document.body);
}

function MaterialLocationDialog({ material, mode, workspace, onSave, onCancel }: { material: StudyMaterialSummary; mode: 'move' | 'duplicate'; workspace: StudyWorkspace; onSave: (input: { courseId: string; subjectId: string; folderId: string | null; topicId: string | null }) => Promise<void>; onCancel: () => void }) {
  const initial = mode === 'move' ? material.placements[0] : null;
  const [courseId, setCourseId] = useState(initial?.courseId ?? workspace.courses[0]?.id ?? '');
  const [subjectId, setSubjectId] = useState(initial?.subjectId ?? '');
  const [folderId, setFolderId] = useState(initial?.folderId ?? '');
  const [topicId, setTopicId] = useState(initial?.topicId ?? '');
  const [busy, setBusy] = useState(false);
  const subjects = workspace.subjects.filter((subject) => subject.courseId === courseId);
  const folders = workspace.folders.filter((folder) => folder.subjectId === subjectId);
  const topics = workspace.topics.filter((topic) => topic.subjectId === subjectId && (!folderId ? !topic.folderId : topic.folderId === folderId));
  return createPortal(<div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-6" onClick={onCancel}><form className="card-modal w-full max-w-md space-y-3 p-5" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); if (!subjectId) return; setBusy(true); void onSave({ courseId, subjectId, folderId: folderId || null, topicId: topicId || null }).finally(() => setBusy(false)); }}>
    <h2 className="text-base font-semibold">{t(mode === 'move' ? 'Cambiar ubicación' : 'Duplicar en otra ubicación')}</h2>
    <p className="text-xs text-neutral-500">{material.title}</p>
    <label className="block text-xs text-neutral-500">{t('Curso')}<select className="input mt-1 w-full" value={courseId} onChange={(event) => { const next = event.target.value; setCourseId(next); setSubjectId(''); setFolderId(''); setTopicId(''); }}><option value="">{t('Selecciona un curso')}</option>{workspace.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
    <label className="block text-xs text-neutral-500">{t('Asignatura')}<select className="input mt-1 w-full" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setFolderId(''); setTopicId(''); }}><option value="">{t('Selecciona una asignatura')}</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
    <label className="block text-xs text-neutral-500">{t('Carpeta (opcional)')}<select className="input mt-1 w-full" value={folderId} onChange={(event) => { setFolderId(event.target.value); setTopicId(''); }}><option value="">{t('Directamente en la asignatura')}</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
    <label className="block text-xs text-neutral-500">{t('Tema (opcional)')}<select className="input mt-1 w-full" value={topicId} onChange={(event) => setTopicId(event.target.value)}><option value="">{t('Sin tema')}</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></label>
    <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={onCancel}>{t('Cancelar')}</button><button className="btn btn-primary" disabled={busy || !subjectId}>{busy ? t('Guardando…') : t(mode === 'move' ? 'Mover' : 'Duplicar')}</button></div>
  </form></div>, document.body);
}

function MaterialViewer({ materialId, workspace, onClose, onChanged, onOpenDocument, onRequestDelete }: { materialId: string; workspace: StudyWorkspace | null; onClose: () => void; onChanged: () => Promise<void>; onOpenDocument: (id: string) => void; onRequestDelete: (material: StudyMaterialDetail) => void }) {
  const [material, setMaterial] = useState<StudyMaterialDetail | null>(null);
  const [content, setContent] = useState<StudyMaterialContent | null>(null);
  const [tab, setTab] = useState<'preview' | 'text' | 'details' | 'versions'>('preview');
  const [editingTitle, setEditingTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [citation, setCitation] = useState('');
  const [commentDialog, setCommentDialog] = useState<{ annotation?: StudyMaterialAnnotation; selectedText?: string; from?: number; to?: number } | null>(null);
  const [message, setMessage] = useState('');
  const [objectUrl, setObjectUrl] = useState('');

  const load = async () => {
    const detail = await window.nodus.getStudyMaterial(materialId);
    if (detail.origin === 'zotero_link') {
      await window.nodus.openStudyMaterialInZotero(materialId);
      onClose();
      return;
    }
    const file = await window.nodus.getStudyMaterialContent(materialId);
    setMaterial(detail); setContent(file); setEditingTitle(detail.title); setDescription(detail.description);
    setTags((detail.metadata.tags ?? []).join(', ')); setCitation(detail.bibliography.citation);
  };
  useEffect(() => { void load(); }, [materialId]);
  useEffect(() => {
    if (!content || !['image', 'audio'].includes(material?.previewKind ?? '')) return;
    const url = URL.createObjectURL(new Blob([Uint8Array.from(content.bytes).buffer], { type: content.mimeType }));
    setObjectUrl(url); return () => URL.revokeObjectURL(url);
  }, [content, material?.contentHash]);

  const changed = async () => { await load(); await onChanged(); };
  const createAnnotation = async (input: Parameters<typeof window.nodus.createStudyMaterialAnnotation>[1]) => { await window.nodus.createStudyMaterialAnnotation(materialId, input); await changed(); };
  const updateAnnotation = async (id: string, patch: Parameters<typeof window.nodus.updateStudyMaterialAnnotation>[1]) => { await window.nodus.updateStudyMaterialAnnotation(id, patch); await changed(); };
  const createNote = async (annotationId?: string | null) => {
    const result = await window.nodus.createStudyNoteFromMaterial(materialId, annotationId);
    announceStudyWorkspaceChanged(); onOpenDocument(result.documentId); onClose();
  };
  const saveDetails = async () => {
    await window.nodus.updateStudyMaterial(materialId, { title: editingTitle, description, metadata: { tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean) }, bibliography: { citation } });
    setMessage(t('Detalles guardados.')); await changed();
  };
  const captureTextSelection = () => {
    if (!material) return;
    const selectedText = window.getSelection()?.toString().trim() ?? '';
    if (!selectedText) return;
    const from = material.extractedText.indexOf(selectedText);
    setCommentDialog({ selectedText, from: from >= 0 ? from : undefined, to: from >= 0 ? from + selectedText.length : undefined });
  };

  if (!material || !content) return <div className="absolute inset-0 z-40 grid place-items-center bg-white/90 dark:bg-neutral-950/90"><Spinner label={t('Abriendo material…')} /></div>;
  const placement = material.placements[0];
  const subject = workspace?.subjects.find((item) => item.id === placement?.subjectId);
  const topic = workspace?.topics.find((item) => item.id === placement?.topicId);
  const sourceLabel = studyMaterialLocationLabel({ materialId: material.id, materialTitle: material.title });

  return <div className="absolute inset-0 z-40 flex flex-col bg-neutral-50 dark:bg-neutral-950" data-testid="study-material-viewer">
    <header className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-2.5"><button className="btn btn-ghost px-2" onClick={onClose}><Icon name="arrowLeft" /></button><span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-950 text-teal-300"><Icon name={materialIcon(material.previewKind)} size={15} /></span><div className="min-w-0"><h2 className="max-w-xl truncate text-sm font-semibold text-neutral-200">{material.title}</h2><p className="text-[10px] text-neutral-600">{sourceLabel}{subject ? ` · ${subject.name}` : ''}{topic ? ` · ${topic.name}` : ''}</p></div>{(['preview', 'text', 'details', 'versions'] as const).map((item) => <button key={item} className={`ml-2 rounded-lg px-3 py-1.5 text-xs ${tab === item ? 'bg-teal-950 text-teal-300' : 'text-neutral-500 hover:bg-neutral-900'}`} onClick={() => setTab(item)}>{t(item === 'preview' ? 'Vista previa' : item === 'text' ? 'Texto extraído' : item === 'details' ? 'Detalles y fuente' : 'Versiones')}</button>)}<div className="ml-auto flex gap-2"><div className="h-8 w-28"><ChipSelectCell values={[material.readState]} options={studyReadOptions()} multi={false} onChange={(values) => { const next = values[0] as StudyMaterialReadState | undefined; if (next) void window.nodus.updateStudyMaterial(material.id, { readState: next }).then(changed); }} /></div><button className="btn btn-ghost h-8 px-2" onClick={() => void window.nodus.updateStudyMaterial(material.id, { favorite: !material.favorite }).then(changed)}><Icon name="star" size={13} className={material.favorite ? 'text-amber-400' : ''} /></button><button className="btn btn-primary h-8" onClick={() => void createNote(null)}><Icon name="notebook" size={12} /> {t('Crear apunte')}</button></div></header>
    <main className="relative min-h-0 flex-1 overflow-hidden">
      {tab === 'preview' && <Preview material={material} content={content} objectUrl={objectUrl} onAnnotation={createAnnotation} onUpdateAnnotation={updateAnnotation} onDeleteAnnotation={async (id) => { await window.nodus.deleteStudyMaterialAnnotation(id); await changed(); }} onCreateNote={createNote} onSelectText={captureTextSelection} />}
      {tab === 'text' && <div className="h-full overflow-y-auto p-6" onMouseUp={captureTextSelection}><pre className="mx-auto max-w-5xl whitespace-pre-wrap font-sans text-sm leading-7 text-neutral-300">{material.extractedText || t('Este formato no tiene texto extraído todavía.')}</pre>{material.extractedText && <p className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-neutral-700 bg-neutral-950/95 px-4 py-2 text-[10px] text-neutral-500 shadow-xl">{t('Selecciona un fragmento para anotarlo o convertirlo en apunte.')}</p>}</div>}
      {tab === 'details' && <div className="h-full overflow-y-auto p-6"><div className="mx-auto max-w-3xl space-y-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-neutral-500">{t('Título')}<input className="input mt-1 w-full" value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} /></label><label className="text-xs text-neutral-500">{t('Etiquetas separadas por comas')}<input className="input mt-1 w-full" value={tags} onChange={(event) => setTags(event.target.value)} /></label></div><label className="block text-xs text-neutral-500">{t('Descripción')}<textarea className="input mt-1 min-h-20 w-full" value={description} onChange={(event) => setDescription(event.target.value)} /></label>{material.previewKind === 'image' && <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-xs dark:border-neutral-800 dark:bg-neutral-900/40"><p className="font-medium text-neutral-700 dark:text-neutral-300">{t('Descripción visual generada por IA')}</p><p className="mt-2 whitespace-pre-wrap leading-6 text-neutral-600 dark:text-neutral-400">{material.visualDescription || t('Todavía no hay una descripción visual disponible.')}</p>{material.visualAnalysisModel && <p className="mt-2 text-[10px] text-neutral-500">{material.visualAnalysisProvider} · {material.visualAnalysisModel}</p>}</div>}<label className="block text-xs text-neutral-500">{t('Referencia bibliográfica')}<textarea className="input mt-1 min-h-20 w-full" value={citation} onChange={(event) => setCitation(event.target.value)} placeholder={t('Autor (año). Título…')} /></label><div className="rounded-xl border border-neutral-800 p-4 text-xs text-neutral-500"><p>{material.fileName} · {material.mimeType} · {formatBytes(material.sizeBytes)}</p><p className="mt-1">SHA-256: <code className="text-neutral-600">{material.contentHash}</code></p><p className="mt-1">{material.extractedChars.toLocaleString()} {t('caracteres indexables')} · {material.pageCount ? `${material.pageCount} ${t('páginas')}` : material.metadata.slideCount ? `${material.metadata.slideCount} ${t('diapositivas')}` : material.durationSeconds ? `${material.durationSeconds}s` : t('sin paginación')}</p><p className={`mt-2 ${indexStatusClass(material.indexStatus)}`}>{t(INDEX_LABEL[material.indexStatus])}{material.embeddingModel ? ` · ${material.embeddingProvider}/${material.embeddingModel} · ${material.embeddingDim ?? 0}d` : ''}</p>{material.indexError && <p className="mt-1 text-red-500">{material.indexError}</p>}{material.metadata.extractionNote && <p className="mt-2 text-amber-400">{String(material.metadata.extractionNote)}</p>}</div><div className="flex flex-wrap justify-end gap-2"><button className="btn btn-ghost" onClick={() => setCommentDialog({})}>{t('Añadir comentario general')}</button><button className="btn btn-ghost" onClick={() => void window.nodus.replaceStudyMaterialFile(material.id, true).then(async (updated) => { if (updated) await changed(); })}>{t('Sustituir fichero')}</button><button className="btn btn-ghost text-red-400" onClick={() => onRequestDelete(material)}>{t('Papelera')}</button><button className="btn btn-primary" onClick={() => void saveDetails()}>{t('Guardar detalles')}</button></div>{message && <p className="text-right text-xs text-teal-300">{message}</p>}</div></div>}
      {tab === 'versions' && <div className="h-full overflow-y-auto p-6"><div className="mx-auto max-w-3xl"><h3 className="mb-3 text-sm font-semibold text-neutral-200">{t('Historial del fichero')}</h3>{material.versions.length === 0 ? <p className="text-sm text-neutral-600">{t('Las versiones anteriores aparecerán al sustituir el fichero.')}</p> : material.versions.map((version) => <div key={version.id} className="mb-2 flex items-center gap-3 rounded-xl border border-neutral-800 p-3"><Icon name="archive" className="text-teal-500" /><div className="min-w-0 flex-1"><p className="truncate text-xs text-neutral-300">v{version.versionNo} · {version.fileName}</p><p className="text-[10px] text-neutral-600">{formatBytes(version.sizeBytes)} · {new Date(version.createdAt).toLocaleString()} · {version.contentHash.slice(0, 12)}</p></div><button className="btn btn-ghost text-xs" onClick={() => { if (window.confirm(t('¿Restaurar esta versión del fichero?'))) void window.nodus.restoreStudyMaterialVersion(material.id, version.id).then(changed); }}>{t('Restaurar')}</button></div>)}</div></div>}
    </main>
    {commentDialog && <TextInputModal testId="study-material-comment-dialog" title={commentDialog.selectedText ? t('Anotar fragmento') : t('Comentario del material')} label={t('Nota')} multiline onCancel={() => setCommentDialog(null)} onSubmit={async (note) => { const annotation = await window.nodus.createStudyMaterialAnnotation(material.id, { selectedText: commentDialog.selectedText, from: commentDialog.from, to: commentDialog.to, note }); setCommentDialog(null); await changed(); if (commentDialog.selectedText && window.confirm(t('¿Crear también un apunte enlazado desde este fragmento?'))) await createNote(annotation.id); }} />}
  </div>;
}

function Preview({ material, content, objectUrl, onAnnotation, onUpdateAnnotation, onDeleteAnnotation, onCreateNote, onSelectText }: { material: StudyMaterialDetail; content: StudyMaterialContent; objectUrl: string; onAnnotation: (input: Parameters<typeof window.nodus.createStudyMaterialAnnotation>[1]) => Promise<void>; onUpdateAnnotation: (id: string, patch: Parameters<typeof window.nodus.updateStudyMaterialAnnotation>[1]) => Promise<void>; onDeleteAnnotation: (id: string) => Promise<void>; onCreateNote: (annotationId?: string | null) => Promise<void>; onSelectText: () => void }) {
  if (material.previewKind === 'pdf') return <Suspense fallback={<div className="grid h-full place-items-center"><Spinner label={t('Cargando visor PDF…')} /></div>}><PdfViewer content={content} material={material} onAnnotation={onAnnotation} onUpdateAnnotation={onUpdateAnnotation} onDeleteAnnotation={onDeleteAnnotation} onCreateNote={onCreateNote} /></Suspense>;
  if (material.extension === 'epub') return <Suspense fallback={<div className="grid h-full place-items-center"><Spinner label={t('Cargando EPUB…')} /></div>}><EpubViewer material={material} onAnnotation={onAnnotation} onDeleteAnnotation={onDeleteAnnotation} onCreateNote={onCreateNote} /></Suspense>;
  if (material.previewKind === 'image') return <div className="grid h-full place-items-center overflow-auto bg-neutral-900/30 p-8"><img src={objectUrl} alt={material.title} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" /></div>;
  if (material.previewKind === 'audio') return <div className="grid h-full place-items-center"><div className="w-full max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900/40 p-8 text-center"><Icon name="microphone" size={40} className="mx-auto mb-5 text-teal-500" /><h3 className="mb-4 text-neutral-200">{material.title}</h3><audio className="w-full" controls src={objectUrl} /><p className="mt-4 text-xs text-neutral-600">{t('Este audio podrá transcribirse y marcarse temporalmente en la fase de grabaciones.')}</p></div></div>;
  if (material.previewKind === 'presentation') return <PresentationPreview material={material} onSelectText={onSelectText} />;
  if (material.extension === 'md' || material.extension === 'markdown') return <div className="h-full overflow-y-auto bg-neutral-100 p-6 dark:bg-neutral-950" onMouseUp={onSelectText}><article className="mx-auto max-w-5xl rounded-xl border border-neutral-200 bg-white p-8 text-sm leading-7 text-neutral-900 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"><Markdown content={material.extractedText || t('Vista previa no disponible para este formato.')} verify={false} /></article></div>;
  return <div className="h-full overflow-y-auto bg-neutral-100 p-6 dark:bg-neutral-950" onMouseUp={onSelectText}><pre className="mx-auto max-w-5xl whitespace-pre-wrap rounded-xl border border-neutral-200 bg-white p-6 font-sans text-sm leading-7 text-neutral-900 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100">{material.extractedText || t('Vista previa no disponible para este formato.')}</pre></div>;
}

function PresentationPreview({ material, onSelectText }: { material: StudyMaterialDetail; onSelectText: () => void }) {
  const markers = parseStudyMaterialMarkers(material.extractedText).filter((marker) => marker.kind === 'slide');
  const [slide, setSlide] = useState(1);
  const current = markers.find((marker) => marker.number === slide);
  const next = markers.find((marker) => marker.number === slide + 1);
  const text = current ? material.extractedText.slice(current.from, next?.from ?? material.extractedText.length).replace(/^\[\[slide\.\s*\d+\]\]\s*/i, '') : material.extractedText;
  const total = Number(material.metadata.slideCount ?? markers.length ?? 1);
  return <div className="flex h-full flex-col"><div className="flex items-center justify-center gap-3 border-b border-neutral-800 p-2"><button className="btn btn-ghost" disabled={slide <= 1} onClick={() => setSlide((value) => Math.max(1, value - 1))}>‹</button><span className="text-xs text-neutral-500">{t('Diapositiva')} {slide} / {total}</span><button className="btn btn-ghost" disabled={slide >= total} onClick={() => setSlide((value) => Math.min(total, value + 1))}>›</button></div><div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-neutral-900/40 p-8" onMouseUp={onSelectText}><div className="aspect-video w-full max-w-5xl overflow-y-auto rounded-xl bg-white p-[8%] text-slate-900 shadow-2xl"><pre className="whitespace-pre-wrap font-sans text-xl leading-9">{text}</pre></div></div></div>;
}
