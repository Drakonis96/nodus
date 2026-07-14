import { lazy, Suspense, useEffect, useState } from 'react';
import type {
  StudyMaterialAnnotation,
  StudyMaterialContent,
  StudyMaterialDetail,
  StudyMaterialPreviewKind,
  StudyMaterialReadState,
  StudyMaterialSummary,
  StudyWorkspace,
} from '@shared/types';
import { parseStudyMaterialMarkers, studyMaterialLocationLabel } from '@shared/studyMaterials';
import { Icon, Spinner } from '../components/ui';
import { TextInputModal } from '../components/TextInputModal';
import { announceStudyWorkspaceChanged } from '../components/StudySidebar';
import { t } from '../i18n';

const PdfViewer = lazy(() => import('../components/materials/PdfViewer').then((module) => ({ default: module.PdfViewer })));

const READ_LABEL: Record<StudyMaterialReadState, string> = {
  pending: 'Pendiente', reading: 'En lectura', read: 'Leído', reviewed: 'Revisado',
};
const PREVIEW_LABEL: Record<StudyMaterialPreviewKind, string> = {
  pdf: 'PDF', document: 'Documento', presentation: 'Presentación', image: 'Imagen', audio: 'Audio', unknown: 'Otro',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function materialIcon(kind: StudyMaterialPreviewKind): string {
  return kind === 'image' ? 'image' : kind === 'audio' ? 'play' : kind === 'presentation' ? 'columns' : kind === 'pdf' ? 'book' : 'notebook';
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
  const [ocr, setOcr] = useState(false);
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { if (initialMaterialId) setSelected(initialMaterialId); }, [initialMaterialId]);

  const load = async () => {
    const [nextMaterials, nextWorkspace] = await Promise.all([
      window.nodus.listStudyMaterials({ search: query, readState, previewKind, courseId: courseId || undefined, subjectId: subjectId || undefined, topicId: topicId || undefined }),
      window.nodus.getStudyWorkspace(),
    ]);
    setMaterials(nextMaterials); setWorkspace(nextWorkspace);
  };

  useEffect(() => { const timer = window.setTimeout(() => void load(), 120); return () => window.clearTimeout(timer); }, [query, readState, previewKind, courseId, subjectId, topicId]);

  const subjects = workspace?.subjects.filter((subject) => !courseId || subject.courseId === courseId) ?? [];
  const topics = workspace?.topics.filter((topic) => !subjectId || topic.subjectId === subjectId) ?? [];
  const importMaterials = async () => {
    setBusy(true); setMessage('');
    try {
      const results = await window.nodus.importStudyMaterials({ courseId: courseId || null, subjectId: subjectId || null, topicId: topicId || null, ocr });
      if (results.length) {
        const duplicates = results.filter((result) => result.duplicate).length;
        setMessage(`${results.length} ${t('materiales añadidos')}${duplicates ? ` · ${duplicates} ${t('duplicados enlazados sin copiar')}` : ''}`);
        await load();
      }
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  return <div className="flex h-full min-h-0 flex-col bg-neutral-950" data-testid="study-materials-view">
    <header className="border-b border-neutral-800 px-5 py-4">
      <div className="flex flex-wrap items-center gap-3"><div><h1 className="text-lg font-semibold text-neutral-100">{t('Materiales de estudio')}</h1><p className="text-xs text-neutral-500">{t('Fuentes locales, anotables y enlazadas con tus apuntes.')}</p></div><span className="rounded-full bg-teal-950 px-2.5 py-1 text-[10px] text-teal-300">{materials.length} {t('materiales')}</span><div className="ml-auto flex items-center gap-2"><label className="flex items-center gap-2 text-[10px] text-neutral-500"><input type="checkbox" checked={ocr} onChange={(event) => setOcr(event.target.checked)} />{t('OCR para escaneos')}</label><button data-testid="study-material-import" className="btn btn-primary" disabled={busy} onClick={() => void importMaterials()}>{busy ? <Spinner label={t('Importando…')} /> : <><Icon name="upload" size={13} /> {t('Añadir archivos')}</>}</button></div></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(240px,1fr)_150px_150px_180px_180px_180px_auto]">
        <div className="relative"><Icon name="search" size={13} className="pointer-events-none absolute left-3 top-2.5 text-neutral-600" /><input data-testid="study-material-search" className="input input-with-leading-icon h-8 w-full" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar materiales…')} /></div>
        <select className="input h-8 text-xs" value={readState} onChange={(event) => setReadState(event.target.value as StudyMaterialReadState | 'all')}><option value="all">{t('Todos los estados')}</option>{Object.entries(READ_LABEL).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select>
        <select className="input h-8 text-xs" value={previewKind} onChange={(event) => setPreviewKind(event.target.value as StudyMaterialPreviewKind | 'all')}><option value="all">{t('Todos los formatos')}</option>{Object.entries(PREVIEW_LABEL).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select>
        <select className="input h-8 text-xs" value={courseId} onChange={(event) => { setCourseId(event.target.value); setSubjectId(''); setTopicId(''); }}><option value="">{t('Todos los cursos')}</option>{workspace?.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select>
        <select className="input h-8 text-xs" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setTopicId(''); }}><option value="">{t('Todas las asignaturas')}</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select>
        <select className="input h-8 text-xs" value={topicId} onChange={(event) => setTopicId(event.target.value)}><option value="">{t('Todos los temas')}</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select>
        <div className="flex rounded-lg border border-neutral-800 p-0.5"><button className={`rounded px-2 ${layout === 'grid' ? 'bg-neutral-800 text-teal-300' : 'text-neutral-600'}`} onClick={() => setLayout('grid')}><Icon name="grid" size={12} /></button><button className={`rounded px-2 ${layout === 'list' ? 'bg-neutral-800 text-teal-300' : 'text-neutral-600'}`} onClick={() => setLayout('list')}><Icon name="list" size={12} /></button></div>
      </div>
      {message && <p className="mt-2 text-xs text-amber-300">{message}</p>}
    </header>
    <main className="min-h-0 flex-1 overflow-y-auto p-5">
      {materials.length === 0 ? <div className="grid h-full place-items-center text-center"><div><span className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-teal-950 text-teal-400"><Icon name="book" size={28} /></span><h2 className="text-base font-semibold text-neutral-300">{t('Tu biblioteca de materiales está vacía')}</h2><p className="mt-1 max-w-md text-sm text-neutral-600">{t('Añade PDF, Word, Markdown, presentaciones, EPUB, imágenes o audio. Los archivos se guardan dentro del vault.')}</p><button className="btn btn-primary mt-4" onClick={() => void importMaterials()}><Icon name="upload" size={13} /> {t('Añadir primer material')}</button></div></div> : <div className={layout === 'grid' ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4' : 'space-y-2'}>{materials.map((material) => <MaterialCard key={material.id} material={material} layout={layout} onOpen={() => setSelected(material.id)} onUpdate={async (patch) => { await window.nodus.updateStudyMaterial(material.id, patch); await load(); }} />)}</div>}
    </main>
    {selected && <MaterialViewer materialId={selected} workspace={workspace} onClose={() => setSelected(null)} onChanged={load} onOpenDocument={onOpenDocument} />}
  </div>;
}

function MaterialCard({ material, layout, onOpen, onUpdate }: { material: StudyMaterialSummary; layout: 'grid' | 'list'; onOpen: () => void; onUpdate: (patch: Parameters<typeof window.nodus.updateStudyMaterial>[1]) => Promise<void> }) {
  return <article data-testid="study-material-card" className={`group rounded-xl border border-neutral-800 bg-neutral-900/30 hover:border-teal-900 ${layout === 'list' ? 'flex items-center gap-3 p-3' : 'p-4'}`}>
    <button className={`${layout === 'list' ? 'flex min-w-0 flex-1 items-center gap-3 text-left' : 'w-full text-left'}`} onClick={onOpen}>
      <span className={`grid shrink-0 place-items-center rounded-xl bg-teal-950/60 text-teal-400 ${layout === 'list' ? 'h-10 w-10' : 'mb-3 h-12 w-12'}`}><Icon name={materialIcon(material.previewKind)} size={20} /></span>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-neutral-200">{material.title}</span><span className="mt-1 block truncate text-[10px] text-neutral-600">{material.extension.toUpperCase()} · {formatBytes(material.sizeBytes)} · {material.extractedChars.toLocaleString()} {t('caracteres indexables')}</span>{layout === 'grid' && <span className="mt-3 flex flex-wrap gap-1">{(material.metadata.tags ?? []).slice(0, 4).map((tag) => <span key={tag} className="rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] text-neutral-500">{tag}</span>)}</span>}</span>
    </button>
    <div className={`flex items-center gap-1 ${layout === 'grid' ? 'mt-3 border-t border-neutral-800 pt-2' : ''}`}><select className="input h-7 flex-1 border-0 bg-transparent text-[10px]" value={material.readState} onChange={(event) => void onUpdate({ readState: event.target.value as StudyMaterialReadState })}>{Object.entries(READ_LABEL).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select><button className="btn btn-ghost h-7 px-2" onClick={() => void onUpdate({ favorite: !material.favorite })}><Icon name="star" size={11} className={material.favorite ? 'text-amber-400' : 'text-neutral-700'} /></button></div>
  </article>;
}

function MaterialViewer({ materialId, workspace, onClose, onChanged, onOpenDocument }: { materialId: string; workspace: StudyWorkspace | null; onClose: () => void; onChanged: () => Promise<void>; onOpenDocument: (id: string) => void }) {
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
    const [detail, file] = await Promise.all([window.nodus.getStudyMaterial(materialId), window.nodus.getStudyMaterialContent(materialId)]);
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

  if (!material || !content) return <div className="fixed inset-0 z-[130] grid place-items-center bg-black/75"><Spinner label={t('Abriendo material…')} /></div>;
  const placement = material.placements[0];
  const subject = workspace?.subjects.find((item) => item.id === placement?.subjectId);
  const topic = workspace?.topics.find((item) => item.id === placement?.topicId);
  const sourceLabel = studyMaterialLocationLabel({ materialId: material.id, materialTitle: material.title });

  return <div className="fixed inset-0 z-[130] flex flex-col bg-neutral-950" data-testid="study-material-viewer">
    <header className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-2.5"><button className="btn btn-ghost px-2" onClick={onClose}><Icon name="arrowLeft" /></button><span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-950 text-teal-300"><Icon name={materialIcon(material.previewKind)} size={15} /></span><div className="min-w-0"><h2 className="max-w-xl truncate text-sm font-semibold text-neutral-200">{material.title}</h2><p className="text-[10px] text-neutral-600">{sourceLabel}{subject ? ` · ${subject.name}` : ''}{topic ? ` · ${topic.name}` : ''}</p></div>{(['preview', 'text', 'details', 'versions'] as const).map((item) => <button key={item} className={`ml-2 rounded-lg px-3 py-1.5 text-xs ${tab === item ? 'bg-teal-950 text-teal-300' : 'text-neutral-500 hover:bg-neutral-900'}`} onClick={() => setTab(item)}>{t(item === 'preview' ? 'Vista previa' : item === 'text' ? 'Texto extraído' : item === 'details' ? 'Detalles y fuente' : 'Versiones')}</button>)}<div className="ml-auto flex gap-2"><select className="input h-8 text-xs" value={material.readState} onChange={(event) => void window.nodus.updateStudyMaterial(material.id, { readState: event.target.value as StudyMaterialReadState }).then(changed)}>{Object.entries(READ_LABEL).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select><button className="btn btn-ghost h-8 px-2" onClick={() => void window.nodus.updateStudyMaterial(material.id, { favorite: !material.favorite }).then(changed)}><Icon name="star" size={13} className={material.favorite ? 'text-amber-400' : ''} /></button><button className="btn btn-primary h-8" onClick={() => void createNote(null)}><Icon name="notebook" size={12} /> {t('Crear apunte')}</button></div></header>
    <main className="relative min-h-0 flex-1 overflow-hidden">
      {tab === 'preview' && <Preview material={material} content={content} objectUrl={objectUrl} onAnnotation={createAnnotation} onDeleteAnnotation={async (id) => { await window.nodus.deleteStudyMaterialAnnotation(id); await changed(); }} onCreateNote={createNote} onSelectText={captureTextSelection} />}
      {tab === 'text' && <div className="h-full overflow-y-auto p-6" onMouseUp={captureTextSelection}><pre className="mx-auto max-w-5xl whitespace-pre-wrap font-sans text-sm leading-7 text-neutral-300">{material.extractedText || t('Este formato no tiene texto extraído todavía.')}</pre>{material.extractedText && <p className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-neutral-700 bg-neutral-950/95 px-4 py-2 text-[10px] text-neutral-500 shadow-xl">{t('Selecciona un fragmento para anotarlo o convertirlo en apunte.')}</p>}</div>}
      {tab === 'details' && <div className="h-full overflow-y-auto p-6"><div className="mx-auto max-w-3xl space-y-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-neutral-500">{t('Título')}<input className="input mt-1 w-full" value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} /></label><label className="text-xs text-neutral-500">{t('Etiquetas separadas por comas')}<input className="input mt-1 w-full" value={tags} onChange={(event) => setTags(event.target.value)} /></label></div><label className="block text-xs text-neutral-500">{t('Descripción')}<textarea className="input mt-1 min-h-20 w-full" value={description} onChange={(event) => setDescription(event.target.value)} /></label><label className="block text-xs text-neutral-500">{t('Referencia bibliográfica')}<textarea className="input mt-1 min-h-20 w-full" value={citation} onChange={(event) => setCitation(event.target.value)} placeholder="Autor (año). Título…" /></label><div className="rounded-xl border border-neutral-800 p-4 text-xs text-neutral-500"><p>{material.fileName} · {material.mimeType} · {formatBytes(material.sizeBytes)}</p><p className="mt-1">SHA-256: <code className="text-neutral-600">{material.contentHash}</code></p><p className="mt-1">{material.extractedChars.toLocaleString()} {t('caracteres indexables')} · {material.pageCount ? `${material.pageCount} ${t('páginas')}` : material.metadata.slideCount ? `${material.metadata.slideCount} ${t('diapositivas')}` : material.durationSeconds ? `${material.durationSeconds}s` : t('sin paginación')}</p>{material.metadata.extractionNote && <p className="mt-2 text-amber-400">{String(material.metadata.extractionNote)}</p>}</div><div className="flex flex-wrap justify-end gap-2"><button className="btn btn-ghost" onClick={() => setCommentDialog({})}>{t('Añadir comentario general')}</button><button className="btn btn-ghost" onClick={() => void window.nodus.replaceStudyMaterialFile(material.id, true).then(async (updated) => { if (updated) await changed(); })}>{t('Sustituir fichero')}</button><button className="btn btn-ghost text-red-400" onClick={() => { if (window.confirm(t('¿Mover este material a la papelera?'))) void window.nodus.setStudyMaterialLifecycle(material.id, 'trash').then(async () => { await onChanged(); onClose(); }); }}>{t('Papelera')}</button><button className="btn btn-primary" onClick={() => void saveDetails()}>{t('Guardar detalles')}</button></div>{message && <p className="text-right text-xs text-teal-300">{message}</p>}</div></div>}
      {tab === 'versions' && <div className="h-full overflow-y-auto p-6"><div className="mx-auto max-w-3xl"><h3 className="mb-3 text-sm font-semibold text-neutral-200">{t('Historial del fichero')}</h3>{material.versions.length === 0 ? <p className="text-sm text-neutral-600">{t('Las versiones anteriores aparecerán al sustituir el fichero.')}</p> : material.versions.map((version) => <div key={version.id} className="mb-2 flex items-center gap-3 rounded-xl border border-neutral-800 p-3"><Icon name="archive" className="text-teal-500" /><div className="min-w-0 flex-1"><p className="truncate text-xs text-neutral-300">v{version.versionNo} · {version.fileName}</p><p className="text-[10px] text-neutral-600">{formatBytes(version.sizeBytes)} · {new Date(version.createdAt).toLocaleString()} · {version.contentHash.slice(0, 12)}</p></div><button className="btn btn-ghost text-xs" onClick={() => { if (window.confirm(t('¿Restaurar esta versión del fichero?'))) void window.nodus.restoreStudyMaterialVersion(material.id, version.id).then(changed); }}>{t('Restaurar')}</button></div>)}</div></div>}
    </main>
    {commentDialog && <TextInputModal testId="study-material-comment-dialog" title={commentDialog.selectedText ? t('Anotar fragmento') : t('Comentario del material')} label={t('Nota')} multiline onCancel={() => setCommentDialog(null)} onSubmit={async (note) => { const annotation = await window.nodus.createStudyMaterialAnnotation(material.id, { selectedText: commentDialog.selectedText, from: commentDialog.from, to: commentDialog.to, note }); setCommentDialog(null); await changed(); if (commentDialog.selectedText && window.confirm(t('¿Crear también un apunte enlazado desde este fragmento?'))) await createNote(annotation.id); }} />}
  </div>;
}

function Preview({ material, content, objectUrl, onAnnotation, onDeleteAnnotation, onCreateNote, onSelectText }: { material: StudyMaterialDetail; content: StudyMaterialContent; objectUrl: string; onAnnotation: (input: Parameters<typeof window.nodus.createStudyMaterialAnnotation>[1]) => Promise<void>; onDeleteAnnotation: (id: string) => Promise<void>; onCreateNote: (annotationId?: string | null) => Promise<void>; onSelectText: () => void }) {
  if (material.previewKind === 'pdf') return <Suspense fallback={<div className="grid h-full place-items-center"><Spinner label={t('Cargando visor PDF…')} /></div>}><PdfViewer content={content} material={material} onAnnotation={onAnnotation} onDeleteAnnotation={onDeleteAnnotation} onCreateNote={onCreateNote} /></Suspense>;
  if (material.previewKind === 'image') return <div className="grid h-full place-items-center overflow-auto bg-neutral-900/30 p-8"><img src={objectUrl} alt={material.title} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" /></div>;
  if (material.previewKind === 'audio') return <div className="grid h-full place-items-center"><div className="w-full max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900/40 p-8 text-center"><Icon name="microphone" size={40} className="mx-auto mb-5 text-teal-500" /><h3 className="mb-4 text-neutral-200">{material.title}</h3><audio className="w-full" controls src={objectUrl} /><p className="mt-4 text-xs text-neutral-600">{t('Este audio podrá transcribirse y marcarse temporalmente en la fase de grabaciones.')}</p></div></div>;
  if (material.previewKind === 'presentation') return <PresentationPreview material={material} onSelectText={onSelectText} />;
  return <div className="h-full overflow-y-auto p-6" onMouseUp={onSelectText}><pre className="mx-auto max-w-5xl whitespace-pre-wrap rounded-xl border border-neutral-800 bg-neutral-900/30 p-6 font-sans text-sm leading-7 text-neutral-300">{material.extractedText || t('Vista previa no disponible para este formato.')}</pre></div>;
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
