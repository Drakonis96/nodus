import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StudyDocument, StudyDocumentKind, StudyWorkspace } from '@shared/studyOrg';
import type { StudyAcademicYear, StudyExportFormat, StudyExportScope, StudyMaterialPreviewKind, StudyMaterialSummary } from '@shared/types';
import { STUDY_DOCUMENT_KINDS } from '@shared/studyOrg';
import { Icon, Spinner } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { IconEmojiPicker } from '../components/IconEmojiPicker';
import { StudyGeneratedQuestionsTable, StudyTestGeneratorDialog, type StudyTestScope } from '../components/StudyTestGenerator';
import {
  StudyAcademicYearField,
  StudyAcademicYearManager,
  StudyAcademicYearScopeSelect,
  academicYearLabel,
  useStudyAcademicYearScope,
} from '../components/StudyAcademicYear';
import { effectiveAcademicYearId } from '@shared/studyAcademicYears';
import type { StudyQuestion } from '@shared/studyQuestions';
import { announceStudyWorkspaceChanged, STUDY_WORKSPACE_CHANGED, type StudyNavigationTarget } from '../components/StudySidebar';
import { t } from '../i18n';
import { ZoteroMaterialImportModal } from '../components/ZoteroMaterialImportModal';

const StudyEditor = lazy(() => import('../components/editor/StudyEditor').then((module) => ({ default: module.StudyEditor })));

const KIND_LABEL: Record<StudyDocumentKind, string> = {
  apunte: 'Apunte', manual: 'Manual', libro: 'Libro', articulo: 'Artículo', presentacion: 'Presentación',
  grabacion: 'Grabación', transcripcion: 'Transcripción', banco: 'Banco de preguntas', test: 'Test', examen: 'Examen',
};

type StudyCreateKind = 'course' | 'subject' | 'topic' | 'folder' | 'document';
type StudyOrganizationSort = 'manual' | 'year-desc' | 'year-asc' | 'created-desc' | 'created-asc' | 'updated-desc' | 'name-asc' | 'name-desc';

interface StudyCreateDraft {
  kind: StudyCreateKind;
  courseId: string;
  subjectId: string;
  folderId: string;
  parentId: string;
  /** Prefilled from the year the browser is currently scoped to. */
  academicYearId?: string;
}

interface StudyCreateValues extends StudyCreateDraft {
  name: string;
  documentKind: StudyDocumentKind;
  description: string;
  color: string;
  icon: string;
  emoji: string;
  imageData: string;
  year: number | null;
  /** Empty means "no academic year", or "inherit from the course" for a subject. */
  academicYearId: string;
}

const CREATE_TITLES: Record<StudyCreateKind, string> = {
  course: 'Nuevo curso',
  subject: 'Nueva asignatura',
  topic: 'Nuevo tema',
  folder: 'Nueva carpeta',
  document: 'Nuevo material',
};

function StudyHeaderAction({ testId, icon, label, tone = 'ghost', disabled = false, onClick }: { testId: string; icon: string; label: string; tone?: 'primary' | 'secondary' | 'ghost'; disabled?: boolean; onClick?: () => void }) {
  return <span className="group inline-flex" title={label}><button data-testid={testId} className={`btn ${tone === 'primary' ? 'btn-primary' : tone === 'secondary' ? 'btn-secondary' : 'btn-ghost'} h-9 min-h-9 justify-center gap-0 px-2.5 py-0`} aria-label={label} disabled={disabled} onClick={onClick}><Icon name={icon} className="shrink-0" /><span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:max-w-48 group-hover:opacity-100 group-focus-within:ml-1.5 group-focus-within:max-w-48 group-focus-within:opacity-100">{label}</span></button></span>;
}

async function imageFileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error(t('Selecciona un archivo de imagen.'));
  if (file.size > 2 * 1024 * 1024) throw new Error(t('La imagen no puede superar 2 MB.'));
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error(t('No se pudo leer la imagen.')));
    reader.readAsDataURL(file);
  });
}

function StudyCreateDialog({
  draft,
  workspace,
  initial,
  onSubmit,
  onCancel,
  onManageAcademicYears,
}: {
  draft: StudyCreateDraft;
  workspace: StudyWorkspace;
  initial?: StudyBrowserItem | null;
  onSubmit: (values: StudyCreateValues) => Promise<void>;
  onCancel: () => void;
  onManageAcademicYears?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [color, setColor] = useState(initial?.color ?? '#0f766e');
  const [icon, setIcon] = useState(initial?.icon ?? (draft.kind === 'course' ? 'graduation' : draft.kind === 'subject' ? 'book' : draft.kind === 'folder' ? 'folder' : draft.kind === 'topic' ? 'hash' : 'notebook'));
  const [emoji, setEmoji] = useState(initial?.emoji ?? '');
  const [imageData, setImageData] = useState(initial?.imageData ?? '');
  const [year, setYear] = useState(initial?.year?.toString() ?? '');
  const [academicYearId, setAcademicYearId] = useState(initial?.academicYearId ?? draft.academicYearId ?? '');
  const [courseId, setCourseId] = useState(draft.courseId);
  const [subjectId, setSubjectId] = useState(draft.subjectId);
  const [folderId, setFolderId] = useState(draft.folderId);
  const [parentId, setParentId] = useState(draft.parentId);
  const [documentKind, setDocumentKind] = useState<StudyDocumentKind>('apunte');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageFileRef = useRef<HTMLInputElement | null>(null);
  const subjects = workspace.subjects.filter((subject) => subject.courseId === courseId);
  const editing = Boolean(initial);
  const carriesAcademicYear = draft.kind === 'course' || draft.kind === 'subject';
  // When editing, `draft.courseId` is blank (the caller only fills it for creation),
  // so the subject's own course is the only way to know what it would inherit.
  const parentCourseId = draft.kind === 'subject' ? (editing ? initial?.courseId ?? '' : courseId) : '';
  const inheritedAcademicYearLabel = draft.kind === 'subject' && !academicYearId
    ? academicYearLabel(workspace.academicYears, workspace.courses.find((course) => course.id === parentCourseId)?.academicYearId ?? null)
    : null;
  const requiresCourse = !editing && draft.kind === 'subject';
  const requiresSubject = !editing && (draft.kind === 'topic' || draft.kind === 'folder');
  const valid = Boolean(name.trim()) && (!requiresCourse || Boolean(courseId)) && (!requiresSubject || Boolean(subjectId));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ kind: draft.kind, name: name.trim(), courseId, subjectId, folderId, parentId, documentKind, description: description.trim(), color, icon, emoji: emoji.trim(), imageData, year: year ? Number(year) : null, academicYearId });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('No se pudo crear el elemento.'));
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-6" onClick={() => { if (!busy) onCancel(); }}>
      <form data-testid={editing ? 'study-metadata-dialog' : 'study-create-dialog'} className="card max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto p-5" role="dialog" aria-modal="true" aria-label={t(editing ? 'Editar información' : CREATE_TITLES[draft.kind])} onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <h2 className="text-base font-semibold">{t(editing ? 'Editar información' : CREATE_TITLES[draft.kind])}</h2>
        <label className="block text-xs text-neutral-500">
          {t(draft.kind === 'document' ? 'Título' : 'Nombre')}
          <input data-testid="study-create-name" autoFocus className="input mt-1 w-full text-sm" value={name} onChange={(event) => setName(event.target.value)} placeholder={t(draft.kind === 'document' ? 'Título del material' : 'Escribe un nombre')} />
        </label>

        {!editing && draft.kind === 'subject' && (
          <label className="block text-xs text-neutral-500">
            {t('Curso')}
            <select data-testid="study-create-course" className="input mt-1 w-full" value={courseId} onChange={(event) => setCourseId(event.target.value)}>
              <option value="">{t('Selecciona un curso')}</option>
              {workspace.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
            </select>
          </label>
        )}

        {!editing && (draft.kind === 'topic' || draft.kind === 'folder') && (
          <>
            <label className="block text-xs text-neutral-500">
              {t('Curso')}
              <select className="input mt-1 w-full" value={courseId} onChange={(event) => {
                const nextCourseId = event.target.value;
                const nextSubjectId = workspace.subjects.find((subject) => subject.courseId === nextCourseId)?.id ?? '';
                setCourseId(nextCourseId); setSubjectId(nextSubjectId); setFolderId(''); setParentId('');
              }}>
                <option value="">{t('Selecciona un curso')}</option>
                {workspace.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
              </select>
            </label>
            <label className="block text-xs text-neutral-500">
              {t('Asignatura')}
              <select data-testid="study-create-subject" className="input mt-1 w-full" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setFolderId(''); setParentId(''); }}>
                <option value="">{t('Selecciona una asignatura')}</option>
                {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
              </select>
            </label>
            {draft.kind === 'topic' && workspace.folders.some((folder) => folder.subjectId === subjectId) && !draft.parentId && (
              <label className="block text-xs text-neutral-500">
                {t('Carpeta (opcional)')}
                <select className="input mt-1 w-full" value={folderId} onChange={(event) => setFolderId(event.target.value)}>
                  <option value="">{t('Directamente en la asignatura')}</option>
                  {workspace.folders.filter((folder) => folder.subjectId === subjectId).map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
              </label>
            )}
          </>
        )}

        {!editing && draft.kind === 'document' && (
          <label className="block text-xs text-neutral-500">
            {t('Tipo de material')}
            <select data-testid="study-create-document-kind" className="input mt-1 w-full" value={documentKind} onChange={(event) => setDocumentKind(event.target.value as StudyDocumentKind)}>
              {STUDY_DOCUMENT_KINDS.map((value) => <option key={value} value={value}>{t(KIND_LABEL[value])}</option>)}
            </select>
          </label>
        )}

        <label className="block text-xs text-neutral-500">
          {t('Descripción')}
          <textarea data-testid="study-create-description" className="input mt-1 min-h-20 w-full resize-y text-sm" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t('Añade contexto, objetivos o información útil')} />
        </label>

        {carriesAcademicYear && (
          <StudyAcademicYearField
            years={workspace.academicYears}
            value={academicYearId}
            onChange={setAcademicYearId}
            inheritedLabel={inheritedAcademicYearLabel}
            onCreateRequest={onManageAcademicYears}
          />
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-neutral-500">{t('Año')}<input data-testid="study-create-year" className="input mt-1 w-full" type="number" min="1900" max="2200" value={year} onChange={(event) => setYear(event.target.value)} placeholder={String(new Date().getFullYear())} /></label>
          <div className="block text-xs text-neutral-500">{t('Icono o emoji')}<IconEmojiPicker icon={icon} emoji={emoji} onChange={(visual) => { setIcon(visual.icon); setEmoji(visual.emoji); }} /></div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          <div className="block text-xs text-neutral-500">{t('Imagen')}<button type="button" className="btn btn-ghost mt-1 flex w-full justify-start border border-neutral-700 bg-neutral-950/25 text-xs hover:border-indigo-700" onClick={() => imageFileRef.current?.click()}><Icon name="upload" size={14} /><span>{t(imageData ? 'Cambiar archivo' : 'Seleccionar archivo')}</span></button><input ref={imageFileRef} data-testid="study-create-image" className="sr-only" type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; void imageFileToDataUrl(file).then(setImageData).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))); }} /><span className="mt-1 block text-[10px] text-neutral-600">{t('PNG, JPEG, WebP o GIF; máximo 2 MB.')}</span></div>
          <label className="block text-xs text-neutral-500">{t('Color')}<input data-testid="study-create-color" className="mt-1 h-[34px] w-full cursor-pointer rounded-lg border border-neutral-300 bg-transparent p-1 dark:border-neutral-700" type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
        </div>
        {imageData && <div className="flex items-center gap-3"><img className="h-20 w-20 rounded-xl object-cover" src={imageData} alt="" /><button type="button" className="btn btn-ghost text-xs text-red-400" onClick={() => setImageData('')}>{t('Quitar imagen')}</button></div>}

        {((requiresCourse && workspace.courses.length === 0) || (requiresSubject && workspace.subjects.length === 0)) && (
          <p className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
            {t(requiresCourse ? 'Crea primero un curso.' : 'Crea primero un curso y una asignatura.')}
          </p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>{t('Cancelar')}</button>
          <button data-testid="study-create-submit" type="submit" className="btn btn-primary" disabled={busy || !valid}>{busy ? t('Guardando…') : t(editing ? 'Guardar cambios' : 'Crear')}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function placementMatches(workspace: StudyWorkspace, documentId: string, target: StudyNavigationTarget | null): boolean {
  if (!target) return true;
  if (target.kind === 'document') return documentId === target.id;
  return workspace.placements.some((placement) => placement.documentId === documentId && (
    (target.kind === 'course' && placement.courseId === target.id) ||
    (target.kind === 'subject' && placement.subjectId === target.id) ||
    (target.kind === 'topic' && placement.topicId === target.id) ||
    (target.kind === 'folder' && placement.folderId === target.id)
  ));
}

function targetTitle(workspace: StudyWorkspace, target: StudyNavigationTarget | null): string {
  if (!target) return 'Cursos y asignaturas';
  if (target.kind === 'document') return workspace.documents.find((item) => item.id === target.id)?.title ?? 'Documento';
  const list = target.kind === 'course' ? workspace.courses : target.kind === 'subject' ? workspace.subjects : target.kind === 'topic' ? workspace.topics : workspace.folders;
  return list.find((item) => item.id === target.id)?.name ?? 'Selección';
}

interface StudyBrowserItem {
  kind: 'course' | 'subject' | 'folder' | 'topic';
  id: string;
  name: string;
  description: string | null;
  icon: string;
  emoji: string | null;
  imageData: string | null;
  year: number | null;
  color: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  courseId: string | null;
  subjectId: string | null;
  topicId: string | null;
  folderId: string | null;
  /** What this item states itself; only courses and subjects can have one. */
  academicYearId: string | null;
  /**
   * Every academic year this item takes part in, `null` meaning "none". Usually
   * one entry, but a course is listed under each year its subjects belong to —
   * a degree carries its year per subject, and matching only the course's own
   * (empty) year would empty the browser the moment you filtered by a year.
   */
  academicYearIds: (string | null)[];
  meta: string;
}

/** Item shape before the academic year is derived; see `decorate` in `browserItems`. */
type StudyBrowserItemDraft = Omit<StudyBrowserItem, 'academicYearId' | 'academicYearIds'>;

function txCount(count: number, singular: string, plural: string): string {
  return `${count} ${t(count === 1 ? singular : plural)}`;
}

function compareStudyOrganization(a: Pick<StudyBrowserItem, 'name' | 'year' | 'position' | 'createdAt' | 'updatedAt'>, b: Pick<StudyBrowserItem, 'name' | 'year' | 'position' | 'createdAt' | 'updatedAt'>, sort: StudyOrganizationSort): number {
  if (sort === 'year-desc' || sort === 'year-asc') {
    if (a.year == null && b.year == null) return a.position - b.position;
    if (a.year == null) return 1;
    if (b.year == null) return -1;
    return sort === 'year-desc' ? b.year - a.year : a.year - b.year;
  }
  if (sort === 'created-desc') return b.createdAt.localeCompare(a.createdAt);
  if (sort === 'created-asc') return a.createdAt.localeCompare(b.createdAt);
  if (sort === 'updated-desc') return b.updatedAt.localeCompare(a.updatedAt);
  if (sort === 'name-asc') return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  if (sort === 'name-desc') return b.name.localeCompare(a.name, undefined, { sensitivity: 'base' });
  return a.position - b.position;
}

function StudyEntityVisual({ item, size = 'sm' }: { item: Pick<StudyBrowserItem, 'name' | 'icon' | 'emoji' | 'imageData' | 'color'>; size?: 'sm' | 'lg' }) {
  const dimensions = size === 'lg' ? 'h-12 w-12 text-xl' : 'h-8 w-8 text-base';
  if (item.imageData) return <img className={`${dimensions} shrink-0 rounded-lg object-cover`} src={item.imageData} alt="" />;
  return <span className={`grid ${dimensions} shrink-0 place-items-center rounded-lg text-indigo-700 dark:text-indigo-300`} style={{ backgroundColor: `${item.color || '#6366f1'}22` }} aria-label={item.name}>
    {item.emoji || <Icon name={item.icon} size={size === 'lg' ? 20 : 15} />}
  </span>;
}

function StudyBrowserActions({ item, onRename, onMove, onDuplicate, onDelete }: { item: StudyBrowserItem; onRename: () => void; onMove: () => void; onDuplicate: () => void; onDelete: () => void }) {
  return (
    <span className="flex items-center justify-end gap-0.5">
      <button className="btn btn-ghost h-7 px-2" title={t('Renombrar')} onClick={onRename}><Icon name="edit" size={12} /></button>
      {item.kind !== 'course' && <button className="btn btn-ghost h-7 px-2" title={t('Mover a otra ubicación')} onClick={onMove}><Icon name="folder" size={12} /></button>}
      <button className="btn btn-ghost h-7 px-2" title={t(item.kind === 'course' ? 'Duplicar' : 'Duplicar en otra ubicación')} onClick={onDuplicate}><Icon name="copy" size={12} /></button>
      <button className="btn btn-ghost h-7 px-2 text-red-400" title={t('Eliminar')} onClick={onDelete}><Icon name="trash" size={12} /></button>
    </span>
  );
}

/**
 * The academic year(s) an item belongs to, short enough to sit next to its name.
 * A course spanning more than two years is counted rather than listed, because
 * the point of the badge is to be readable at a glance.
 */
function StudyAcademicYearBadge({ item, academicYears }: { item: StudyBrowserItem; academicYears: readonly StudyAcademicYear[] }) {
  const labels = item.academicYearIds.map((id) => academicYearLabel(academicYears, id)).filter((label): label is string => Boolean(label)).sort().reverse();
  if (!labels.length) return null;
  const text = labels.length > 2 ? t('{count} cursos académicos').replace('{count}', String(labels.length)) : labels.join(' · ');
  return <span className="ml-1.5 shrink-0 rounded bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-indigo-300" title={labels.join(' · ')}>{text}</span>;
}

function StudyBrowserCollection({ items, layout, academicYears, onOpen, onRename, onMove, onDuplicate, onDelete }: { items: StudyBrowserItem[]; layout: 'grid' | 'list'; academicYears: readonly StudyAcademicYear[]; onOpen: (item: StudyBrowserItem) => void; onRename: (item: StudyBrowserItem) => void; onMove: (item: StudyBrowserItem) => void; onDuplicate: (item: StudyBrowserItem) => void; onDelete: (item: StudyBrowserItem) => void }) {
  const actions = (item: StudyBrowserItem) => <StudyBrowserActions item={item} onRename={() => onRename(item)} onMove={() => onMove(item)} onDuplicate={() => onDuplicate(item)} onDelete={() => onDelete(item)} />;
  if (layout === 'list') return (
    <div className="overflow-x-auto rounded-xl border border-neutral-800">
      <table className="w-full min-w-[760px] border-collapse text-xs" data-testid="study-browser-list">
        <thead className="study-browser-table-head text-left"><tr><th className="px-4 py-2 font-medium">{t('Nombre')}</th><th className="w-32 px-3 py-2 font-medium">{t('Tipo')}</th><th className="w-52 px-3 py-2 font-medium">{t('Contenido')}</th><th className="w-52 px-3 py-2 text-right font-medium">{t('Acciones')}</th></tr></thead>
        <tbody>{items.map((item) => <tr key={`${item.kind}:${item.id}`} data-testid={`study-browser-${item.kind}-${item.id}`} className="border-t border-neutral-800/70 hover:bg-neutral-900/40">
          <td className="px-4 py-2.5"><button className="flex min-w-0 items-center gap-2 text-left" onClick={() => onOpen(item)}><StudyEntityVisual item={item} /><span className="min-w-0"><span className="flex min-w-0 items-center font-medium text-neutral-200"><span className="truncate">{item.name}</span><StudyAcademicYearBadge item={item} academicYears={academicYears} /></span><span className="block truncate text-[10px] text-neutral-600">{item.description || t('Sin descripción')}{item.year ? ` · ${item.year}` : ''}</span></span></button></td>
          <td className="px-3 py-2.5 capitalize text-neutral-500">{t(item.kind === 'course' ? 'Curso' : item.kind === 'subject' ? 'Asignatura' : item.kind === 'folder' ? 'Carpeta' : 'Tema')}</td>
          <td className="px-3 py-2.5 text-indigo-400">{item.meta}</td><td className="px-3 py-2.5">{actions(item)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  );
  return <div className="grid content-start gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="study-browser-grid">{items.map((item) => (
    <article key={`${item.kind}:${item.id}`} data-testid={`study-browser-${item.kind}-${item.id}`} className="group rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 transition-colors hover:border-indigo-700/60 hover:bg-indigo-950/20">
      <button className="block w-full text-left" onClick={() => onOpen(item)}><span className="mb-3 block"><StudyEntityVisual item={item} size="lg" /></span><span className="flex min-w-0 items-center text-sm font-semibold text-neutral-200"><span className="truncate">{item.name}</span><StudyAcademicYearBadge item={item} academicYears={academicYears} /></span><span className="mt-1 block text-[10px] font-medium uppercase tracking-wider text-indigo-400">{item.meta}{item.year ? ` · ${item.year}` : ''}</span>{item.description && <span className="mt-2 line-clamp-2 block text-xs leading-5 text-neutral-500">{item.description}</span>}</button>
      <span className="mt-3 flex items-center justify-between border-t border-neutral-800/70 pt-2"><button className="text-xs text-neutral-600 hover:text-indigo-400" onClick={() => onOpen(item)}>{t('Abrir')} <Icon name="chevronRight" size={12} /></button>{actions(item)}</span>
    </article>
  ))}</div>;
}

function StudyDocumentVisual({ document, size = 'sm' }: { document: StudyDocument; size?: 'sm' | 'lg' }) {
  return <StudyEntityVisual item={{ name: document.title, icon: document.icon || 'notebook', emoji: document.emoji, imageData: document.imageData, color: document.color }} size={size} />;
}

function StudyDocumentCollection({ documents, layout, onOpen, onEdit, onDelete }: { documents: StudyDocument[]; layout: 'grid' | 'list'; onOpen: (document: StudyDocument) => void; onEdit: (document: StudyDocument) => void; onDelete: (document: StudyDocument) => void }) {
  if (layout === 'list') return <div className="overflow-x-auto rounded-xl border border-neutral-800"><table className="w-full min-w-[720px] border-collapse text-xs" data-testid="study-documents-list"><thead className="study-browser-table-head text-left"><tr><th className="px-4 py-2 font-medium">{t('Nombre')}</th><th className="w-40 px-3 py-2 font-medium">{t('Tipo')}</th><th className="w-28 px-3 py-2 font-medium">{t('Año')}</th><th className="w-24 px-3 py-2 text-center font-medium">{t('Acciones')}</th></tr></thead><tbody>{documents.map((document) => <tr key={document.id} className="border-t border-neutral-800/70 hover:bg-neutral-900/40"><td className="px-4 py-2.5"><button className="flex min-w-0 items-center gap-2 text-left" onClick={() => onOpen(document)}><StudyDocumentVisual document={document} /><span className="min-w-0"><span className="block truncate font-medium text-neutral-200">{document.title}</span><span className="block truncate text-[10px] text-neutral-600">{document.description || t('Sin descripción')}</span></span></button></td><td className="px-3 py-2.5 text-neutral-500">{t(KIND_LABEL[document.kind])}</td><td className="px-3 py-2.5 text-neutral-500">{document.year ?? '—'}</td><td className="px-3 py-2.5"><div className="flex justify-center gap-0.5"><button className="btn btn-ghost h-7 px-2" title={t('Editar información')} onClick={() => onEdit(document)}><Icon name="edit" size={12} /></button><button className="btn btn-ghost h-7 px-2 text-red-400" title={t('Eliminar')} onClick={() => onDelete(document)}><Icon name="trash" size={12} /></button></div></td></tr>)}</tbody></table></div>;
  return <div className="grid content-start gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="study-documents-grid">{documents.map((document) => <article key={document.id} className="group rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 transition-colors hover:border-indigo-800"><button className="block w-full text-left" onClick={() => onOpen(document)}><span className="mb-3 block"><StudyDocumentVisual document={document} size="lg" /></span><span className="block truncate text-sm font-semibold text-neutral-200">{document.title}</span><span className="mt-1 block text-[10px] uppercase tracking-wider text-neutral-600">{t(KIND_LABEL[document.kind])}{document.year ? ` · ${document.year}` : ''}</span><span className="mt-3 line-clamp-3 block text-xs leading-5 text-neutral-500">{document.description || document.contentMarkdown || t('Material vacío')}</span></button><span className="mt-3 flex justify-end gap-0.5 border-t border-neutral-800/70 pt-2"><button className="btn btn-ghost h-7 px-2" title={t('Editar información')} onClick={() => onEdit(document)}><Icon name="edit" size={12} /></button><button className="btn btn-ghost h-7 px-2 text-red-400" title={t('Eliminar')} onClick={() => onDelete(document)}><Icon name="trash" size={12} /></button></span></article>)}</div>;
}

const MATERIAL_PREVIEW_LABEL: Record<StudyMaterialPreviewKind, string> = {
  pdf: 'PDF', document: 'Documento', presentation: 'Presentación', image: 'Imagen', audio: 'Audio', unknown: 'Otro',
};

function studyMaterialIcon(kind: StudyMaterialPreviewKind): string {
  return kind === 'image' ? 'image' : kind === 'audio' ? 'play' : kind === 'presentation' ? 'columns' : kind === 'pdf' ? 'book' : 'notebook';
}

function StudyMaterialCollection({ materials, layout, onOpen, onRename, onDelete }: { materials: StudyMaterialSummary[]; layout: 'grid' | 'list'; onOpen: (material: StudyMaterialSummary) => void; onRename: (material: StudyMaterialSummary) => void; onDelete: (material: StudyMaterialSummary) => void }) {
  const visual = (material: StudyMaterialSummary, large = false) => <span className={`grid shrink-0 place-items-center rounded-lg bg-teal-600/15 text-teal-300 ${large ? 'h-12 w-12' : 'h-8 w-8'}`}><Icon name={material.origin === 'zotero_link' ? 'external' : studyMaterialIcon(material.previewKind)} size={large ? 20 : 15} /></span>;
  if (layout === 'list') return <div className="mt-3 overflow-x-auto rounded-xl border border-neutral-800"><table className="w-full min-w-[720px] border-collapse text-xs" data-testid="study-organization-materials-list"><thead className="study-browser-table-head text-left"><tr><th className="px-4 py-2 font-medium">{t('Nombre')}</th><th className="w-40 px-3 py-2 font-medium">{t('Formato')}</th><th className="w-40 px-3 py-2 font-medium">{t('Estado')}</th><th className="w-32 px-3 py-2 text-center font-medium">{t('Acciones')}</th></tr></thead><tbody>{materials.map((material) => <tr key={material.id} data-testid={`study-organization-material-${material.id}`} className="border-t border-neutral-800/70 hover:bg-neutral-900/40"><td className="px-4 py-2.5"><button className="flex min-w-0 items-center gap-2 text-left" onClick={() => onOpen(material)}>{visual(material)}<span className="min-w-0"><span className="block truncate font-medium text-neutral-200">{material.title}</span><span className="block truncate text-[10px] text-neutral-600">{material.description || material.fileName}</span></span></button></td><td className="px-3 py-2.5 text-neutral-500">{material.origin === 'zotero_link' ? 'ZOTERO' : material.extension.toUpperCase() || t(MATERIAL_PREVIEW_LABEL[material.previewKind])}</td><td className="px-3 py-2.5 text-neutral-500">{material.indexStatus === 'indexed' ? t('Indexado') : material.indexStatus === 'indexing' ? t('Indexando…') : t('Pendiente de indexar')}</td><td className="px-3 py-2.5"><div className="flex justify-center gap-0.5"><button className="btn btn-ghost h-7 px-2" title={t('Abrir')} onClick={() => onOpen(material)}><Icon name="chevronRight" size={12} /></button><button className="btn btn-ghost h-7 px-2" title={t('Renombrar')} onClick={() => onRename(material)}><Icon name="edit" size={12} /></button><button className="btn btn-ghost h-7 px-2 text-red-400" title={t('Eliminar')} onClick={() => onDelete(material)}><Icon name="trash" size={12} /></button></div></td></tr>)}</tbody></table></div>;
  return <div className="mt-3 grid content-start gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="study-organization-materials-grid">{materials.map((material) => <article key={material.id} data-testid={`study-organization-material-${material.id}`} className="group rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 transition-colors hover:border-teal-800"><button className="block w-full text-left" onClick={() => onOpen(material)}><span className="mb-3 block">{visual(material, true)}</span><span className="block truncate text-sm font-semibold text-neutral-200">{material.title}</span><span className="mt-1 block text-[10px] uppercase tracking-wider text-neutral-600">{material.origin === 'zotero_link' ? 'ZOTERO' : material.extension.toUpperCase() || t(MATERIAL_PREVIEW_LABEL[material.previewKind])}</span><span className="mt-3 line-clamp-3 block text-xs leading-5 text-neutral-500">{material.description || material.fileName}</span></button><span className="mt-3 flex items-center gap-0.5 border-t border-neutral-800/70 pt-2"><button className="text-xs text-neutral-600 hover:text-teal-400" onClick={() => onOpen(material)}>{t('Abrir')} <Icon name="chevronRight" size={12} /></button><button className="btn btn-ghost ml-auto h-7 px-2" title={t('Renombrar')} onClick={() => onRename(material)}><Icon name="edit" size={12} /></button><button className="btn btn-ghost h-7 px-2 text-red-400" title={t('Eliminar')} onClick={() => onDelete(material)}><Icon name="trash" size={12} /></button></span></article>)}</div>;
}

function StudyEntityLocationDialog({ item, mode, workspace, onSave, onCancel }: { item: StudyBrowserItem; mode: 'move' | 'duplicate'; workspace: StudyWorkspace; onSave: (input: { courseId: string; subjectId: string; folderId: string | null; parentId: string | null }) => Promise<void>; onCancel: () => void }) {
  const subject = item.kind === 'subject' ? workspace.subjects.find((entry) => entry.id === item.id) : null;
  const folder = item.kind === 'folder' ? workspace.folders.find((entry) => entry.id === item.id) : null;
  const topic = item.kind === 'topic' ? workspace.topics.find((entry) => entry.id === item.id) : null;
  const initialSubjectId = subject?.id ?? folder?.subjectId ?? topic?.subjectId ?? '';
  const initialCourseId = subject?.courseId ?? folder?.courseId ?? workspace.subjects.find((entry) => entry.id === initialSubjectId)?.courseId ?? workspace.courses[0]?.id ?? '';
  const [courseId, setCourseId] = useState(initialCourseId);
  const [subjectId, setSubjectId] = useState(item.kind === 'subject' ? '' : initialSubjectId);
  const [folderId, setFolderId] = useState(topic?.folderId ?? '');
  const [parentId, setParentId] = useState(item.kind === 'folder' ? folder?.parentId ?? '' : topic?.parentId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const subjects = workspace.subjects.filter((entry) => entry.courseId === courseId && entry.id !== item.id);
  const folders = workspace.folders.filter((entry) => entry.subjectId === subjectId && entry.id !== item.id);
  const topics = workspace.topics.filter((entry) => entry.subjectId === subjectId && entry.folderId === (folderId || null) && entry.id !== item.id);
  const valid = item.kind === 'subject' ? Boolean(courseId) : Boolean(subjectId);
  return createPortal(<div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-6" onClick={() => { if (!busy) onCancel(); }}><form data-testid="study-entity-location-dialog" className="card w-full max-w-md space-y-3 p-5" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); if (!valid || busy) return; setBusy(true); setError(''); void onSave({ courseId, subjectId, folderId: folderId || null, parentId: parentId || null }).catch((reason) => { setError(reason instanceof Error ? reason.message : String(reason)); setBusy(false); }); }}>
    <h2 className="text-base font-semibold">{t(mode === 'move' ? 'Mover elemento' : 'Duplicar en otra ubicación')}</h2><p className="text-xs text-neutral-500">{item.name}</p>
    <label className="block text-xs text-neutral-500">{t('Curso')}<select className="input mt-1 w-full" value={courseId} onChange={(event) => { setCourseId(event.target.value); setSubjectId(''); setFolderId(''); setParentId(''); }}><option value="">{t('Selecciona un curso')}</option>{workspace.courses.filter((entry) => entry.id !== item.id).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
    {item.kind !== 'subject' && <label className="block text-xs text-neutral-500">{t('Asignatura')}<select className="input mt-1 w-full" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setFolderId(''); setParentId(''); }}><option value="">{t('Selecciona una asignatura')}</option>{subjects.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
    {item.kind === 'folder' && <label className="block text-xs text-neutral-500">{t('Carpeta superior (opcional)')}<select className="input mt-1 w-full" value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">{t('Raíz de la asignatura')}</option>{folders.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
    {item.kind === 'topic' && <><label className="block text-xs text-neutral-500">{t('Carpeta (opcional)')}<select className="input mt-1 w-full" value={folderId} onChange={(event) => { setFolderId(event.target.value); setParentId(''); }}><option value="">{t('Directamente en la asignatura')}</option>{folders.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><label className="block text-xs text-neutral-500">{t('Tema superior (opcional)')}<select className="input mt-1 w-full" value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">{t('Tema principal')}</option>{topics.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label></>}
    {error && <p className="text-xs text-red-400">{error}</p>}<div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>{t('Cancelar')}</button><button className="btn btn-primary" disabled={!valid || busy}>{busy ? t('Guardando…') : t(mode === 'move' ? 'Mover' : 'Duplicar')}</button></div>
  </form></div>, document.body);
}

function StudyMaterialRenameDialog({ material, onSave, onCancel }: { material: StudyMaterialSummary; onSave: (title: string) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(material.title);
  const [busy, setBusy] = useState(false);
  return createPortal(<div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-6" onClick={() => { if (!busy) onCancel(); }}><form data-testid="study-material-rename-dialog" className="card w-full max-w-md space-y-3 p-5" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); if (!title.trim() || busy) return; setBusy(true); void onSave(title.trim()).catch(() => setBusy(false)); }}>
    <h2 className="text-base font-semibold">{t('Renombrar')}</h2>
    <label className="block text-xs text-neutral-500">{t('Título')}<input autoFocus className="input mt-1 w-full" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>{t('Cancelar')}</button><button className="btn btn-primary" disabled={busy || !title.trim()}>{busy ? t('Guardando…') : t('Guardar')}</button></div>
  </form></div>, document.body);
}

export function StudyOrganizationView({
  target,
  mode,
  onTargetChange,
  onOpenMaterial,
  onOpenRecording,
}: {
  target: StudyNavigationTarget | null;
  mode: 'organization' | 'library';
  onTargetChange: (target: StudyNavigationTarget | null) => void;
  onOpenMaterial: (id: string) => void;
  onOpenRecording: (id: string, timestamp?: number | null) => void;
}) {
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [materials, setMaterials] = useState<StudyMaterialSummary[]>([]);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<StudyDocumentKind | 'all'>('all');
  const [tagId, setTagId] = useState<string>('all');
  const [courseFilterId, setCourseFilterId] = useState('all');
  const [subjectFilterId, setSubjectFilterId] = useState('all');
  const [topicFilterId, setTopicFilterId] = useState('all');
  const [academicYearManagerOpen, setAcademicYearManagerOpen] = useState(false);
  const [organizationSort, setOrganizationSort] = useState<StudyOrganizationSort>('manual');
  const [editing, setEditing] = useState<StudyDocument | null>(null);
  const [openDocumentIds, setOpenDocumentIds] = useState<string[]>([]);
  const [createDraft, setCreateDraft] = useState<StudyCreateDraft | null>(null);
  const [exportFormat, setExportFormat] = useState<StudyExportFormat>('bundle');
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState('');
  const [browserLayout, setBrowserLayout] = useState<'grid' | 'list'>(() => localStorage.getItem('nodus-study-browser-layout') === 'grid' ? 'grid' : 'list');
  const [renamingItem, setRenamingItem] = useState<StudyBrowserItem | null>(null);
  const [editingDocumentMetadata, setEditingDocumentMetadata] = useState<StudyDocument | null>(null);
  const [locatingItem, setLocatingItem] = useState<{ item: StudyBrowserItem; mode: 'move' | 'duplicate' } | null>(null);
  const [deletingItem, setDeletingItem] = useState<StudyBrowserItem | null>(null);
  const [deletingDocument, setDeletingDocument] = useState<StudyDocument | null>(null);
  const [renamingMaterial, setRenamingMaterial] = useState<StudyMaterialSummary | null>(null);
  const [deletingMaterial, setDeletingMaterial] = useState<StudyMaterialSummary | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [assessmentGenerator, setAssessmentGenerator] = useState<'test' | 'exam' | 'flashcards' | null>(null);
  const [generatedQuestions, setGeneratedQuestions] = useState<StudyQuestion[]>([]);
  const [zoteroMaterialImportOpen, setZoteroMaterialImportOpen] = useState(false);

  const reload = useCallback(async () => {
    const [next, nextMaterials] = await Promise.all([
      window.nodus.getStudyWorkspace(),
      window.nodus.listStudyMaterials(),
    ]);
    setWorkspace(next);
    setMaterials(nextMaterials);
    setEditing((current) => current ? next.documents.find((document) => document.id === current.id) ?? null : null);
  }, []);

  useEffect(() => {
    void reload();
    window.addEventListener(STUDY_WORKSPACE_CHANGED, reload);
    return () => window.removeEventListener(STUDY_WORKSPACE_CHANGED, reload);
  }, [reload]);

  useEffect(() => {
    if (target?.kind === 'document' && workspace) {
      const document = workspace.documents.find((candidate) => candidate.id === target.id) ?? null;
      if (document) {
        setEditing(document);
        setOpenDocumentIds((current) => current.includes(document.id) ? current : [...current, document.id]);
      }
    }
  }, [target?.kind, target?.id, workspace]);

  useEffect(() => {
    if (!target || target.kind === 'document') { setGeneratedQuestions([]); return; }
    void window.nodus.listStudyQuestions({
      courseId: target.kind === 'course' ? target.id : undefined,
      subjectId: target.kind === 'subject' ? target.id : undefined,
      folderId: target.kind === 'folder' ? target.id : undefined,
      topicId: target.kind === 'topic' ? target.id : undefined,
    }).then((questions) => setGeneratedQuestions(questions.filter((question) => question.generationPrompt.includes('"format":"Q-star-dash"') || question.generationPrompt.includes('"format":"Q-star-development"'))));
  }, [target?.kind, target?.id]);

  const openDocument = (document: StudyDocument) => {
    setEditing(document);
    setOpenDocumentIds((current) => current.includes(document.id) ? current : [...current, document.id]);
    onTargetChange({ kind: 'document', id: document.id });
  };

  const placementForTarget = () => {
    if (!target || target.kind === 'document') return null;
    if (target.kind === 'course') return { courseId: target.id };
    if (target.kind === 'subject') {
      const subject = workspace?.subjects.find((item) => item.id === target.id);
      return { courseId: subject?.courseId, subjectId: target.id };
    }
    if (target.kind === 'topic') {
      const topic = workspace?.topics.find((item) => item.id === target.id);
      const subject = workspace?.subjects.find((item) => item.id === topic?.subjectId);
      return { courseId: subject?.courseId, subjectId: topic?.subjectId, folderId: topic?.folderId, topicId: target.id };
    }
    const folder = workspace?.folders.find((item) => item.id === target.id);
    return { courseId: folder?.courseId, subjectId: folder?.subjectId, folderId: target.id };
  };

  const importMaterialsForTarget = async () => {
    const placement = placementForTarget();
    if (!placement) return;
    const results = await window.nodus.importStudyMaterials(placement);
    if (results.length) announceStudyWorkspaceChanged();
  };

  const handleFilesDropped = async (fileList: FileList) => {
    const placement = placementForTarget();
    if (!placement) return;
    const paths = [...new Set(Array.from(fileList).map((file) => window.nodus.getPathForDroppedFile(file)).filter(Boolean))];
    if (!paths.length) return;
    const results = await window.nodus.importStudyMaterialPaths(paths, placement);
    if (results.length) { announceStudyWorkspaceChanged(); await reload(); }
  };

  const refreshAfterOrganizationChange = async () => {
    announceStudyWorkspaceChanged();
    await reload();
  };

  const { scope: academicYearScope, setScope: setAcademicYearScope } = useStudyAcademicYearScope(workspace?.academicYears);

  /**
   * The academic year an item is filtered by. Everything below a subject reaches
   * its year through that subject, so a topic can never disagree with the subject
   * it lives in.
   */
  const academicYearIdFor = useCallback((courseId: string | null, subjectId: string | null): string | null => {
    if (!workspace) return null;
    const subject = subjectId ? workspace.subjects.find((item) => item.id === subjectId) : null;
    if (subject) return effectiveAcademicYearId(subject, workspace.courses);
    return courseId ? workspace.courses.find((item) => item.id === courseId)?.academicYearId ?? null : null;
  }, [workspace]);

  /**
   * The years a course takes part in: its own, plus whatever its subjects
   * effectively belong to. A course with neither counts as unfiled.
   */
  const academicYearIdsForCourse = useCallback((courseId: string): (string | null)[] => {
    if (!workspace) return [null];
    const years = new Set<string | null>();
    const course = workspace.courses.find((item) => item.id === courseId);
    if (course?.academicYearId) years.add(course.academicYearId);
    for (const subject of workspace.subjects.filter((item) => item.courseId === courseId)) {
      years.add(effectiveAcademicYearId(subject, workspace.courses));
    }
    if (!years.size) years.add(null);
    return [...years];
  }, [workspace]);

  const matchesAcademicYear = useCallback((yearIds: (string | null)[]): boolean => {
    if (academicYearScope === 'all') return true;
    return yearIds.includes(academicYearScope === 'none' ? null : academicYearScope);
  }, [academicYearScope]);

  /** Whether anything is still unfiled, which is what makes "Sin curso académico" worth offering. */
  const hasUnscopedWork = useMemo(
    () => Boolean(workspace) && workspace!.courses.some((course) => academicYearIdsForCourse(course.id).includes(null)),
    [workspace, academicYearIdsForCourse],
  );

  const academicYearUsage = useMemo(() => {
    const counts = new Map<string, number>();
    if (!workspace) return counts;
    const add = (id: string | null) => { if (id) counts.set(id, (counts.get(id) ?? 0) + 1); };
    for (const course of workspace.courses) add(course.academicYearId);
    for (const subject of workspace.subjects) add(subject.academicYearId);
    return counts;
  }, [workspace]);

  const duplicateBrowserItem = async (item: StudyBrowserItem) => {
    if (item.kind !== 'course') { setLocatingItem({ item, mode: 'duplicate' }); return; }
    await window.nodus.duplicateStudyTree(item.kind, item.id);
    await refreshAfterOrganizationChange();
  };

  const openCreateDialog = (kind: StudyCreateKind) => {
    if (!workspace) return;
    let courseId = workspace.courses[0]?.id ?? '';
    let subjectId = workspace.subjects.find((subject) => subject.courseId === courseId)?.id ?? workspace.subjects[0]?.id ?? '';
    let folderId = '';
    let parentId = '';
    if (target?.kind === 'course') {
      courseId = target.id;
      subjectId = workspace.subjects.find((subject) => subject.courseId === courseId)?.id ?? '';
    } else if (target?.kind === 'subject') {
      const subject = workspace.subjects.find((item) => item.id === target.id);
      courseId = subject?.courseId ?? courseId;
      subjectId = target.id;
    } else if (target?.kind === 'topic') {
      const topic = workspace.topics.find((item) => item.id === target.id);
      const subject = workspace.subjects.find((item) => item.id === topic?.subjectId);
      courseId = subject?.courseId ?? courseId;
      subjectId = topic?.subjectId ?? subjectId;
      folderId = topic?.folderId ?? '';
      if (kind === 'topic') parentId = target.id;
    } else if (target?.kind === 'folder') {
      const folder = workspace.folders.find((item) => item.id === target.id);
      courseId = folder?.courseId ?? courseId;
      subjectId = folder?.subjectId ?? subjectId;
      folderId = target.id;
    }
    // A new course lands in the year you are looking at. Scoping the browser to
    // 2025/2026 and then having to restate it on every course is the busywork this
    // whole feature exists to remove.
    const academicYearId = academicYearScope === 'all' || academicYearScope === 'none' ? '' : academicYearScope;
    setCreateDraft({ kind, courseId, subjectId, folderId, parentId, academicYearId });
  };

  const submitCreate = async (values: StudyCreateValues) => {
    const metadata = { description: values.description || null, color: values.color || null, icon: values.icon || null, emoji: values.emoji || null, imageData: values.imageData || null, year: values.year };
    let nextTarget: StudyNavigationTarget | null = null;
    let createdDocument: StudyDocument | null = null;
    if (values.kind === 'course') {
      const item = await window.nodus.createStudyCourse({ name: values.name, ...metadata, academicYearId: values.academicYearId || null });
      nextTarget = { kind: 'course', id: item.id };
    } else if (values.kind === 'subject') {
      const item = await window.nodus.createStudySubject({ courseId: values.courseId, name: values.name, ...metadata, academicYearId: values.academicYearId || null });
      nextTarget = { kind: 'subject', id: item.id };
    } else if (values.kind === 'topic') {
      const item = await window.nodus.createStudyTopic({ subjectId: values.subjectId, folderId: values.folderId || null, parentId: values.parentId || null, name: values.name, ...metadata });
      nextTarget = { kind: 'topic', id: item.id };
    } else if (values.kind === 'folder') {
      const item = await window.nodus.createStudyFolder({ courseId: values.courseId, subjectId: values.subjectId, name: values.name, ...metadata });
      nextTarget = { kind: 'folder', id: item.id };
    } else {
      createdDocument = await window.nodus.createStudyDocument({ title: values.name, kind: values.documentKind, placement: placementForTarget(), ...metadata });
      nextTarget = { kind: 'document', id: createdDocument.id };
    }
    announceStudyWorkspaceChanged();
    await reload();
    setCreateDraft(null);
    if (createdDocument) openDocument(createdDocument);
    else if (nextTarget) onTargetChange(nextTarget);
  };

  const documents = useMemo(() => {
    if (!workspace) return [];
    const needle = query.trim().toLocaleLowerCase();
    const matchesOrganizationFilters = (documentId: string) => {
      if (courseFilterId === 'all' && subjectFilterId === 'all' && topicFilterId === 'all') return true;
      return workspace.placements.some((placement) => placement.documentId === documentId &&
        (courseFilterId === 'all' || placement.courseId === courseFilterId) &&
        (subjectFilterId === 'all' || placement.subjectId === subjectFilterId) &&
        (topicFilterId === 'all' || placement.topicId === topicFilterId));
    };
    return workspace.documents.filter((document) =>
      placementMatches(workspace, document.id, target) && matchesOrganizationFilters(document.id) &&
      (kind === 'all' || document.kind === kind) &&
      (tagId === 'all' || workspace.documentTags.some((link) => link.documentId === document.id && link.tagId === tagId)) &&
      (!needle || `${document.title} ${document.description ?? ''} ${document.contentMarkdown}`.toLocaleLowerCase().includes(needle))
    ).sort((a, b) => compareStudyOrganization({ name: a.title, year: a.year, position: a.position, createdAt: a.createdAt, updatedAt: a.updatedAt }, { name: b.title, year: b.year, position: b.position, createdAt: b.createdAt, updatedAt: b.updatedAt }, organizationSort));
  }, [workspace, target, query, kind, tagId, courseFilterId, subjectFilterId, topicFilterId, organizationSort]);

  const scopedMaterials = useMemo(() => {
    if (!workspace || !target || target.kind === 'document' || kind !== 'all' || tagId !== 'all') return [];
    const needle = query.trim().toLocaleLowerCase();
    const placementMatchesTarget = (material: StudyMaterialSummary) => material.placements.some((placement) =>
      (target.kind === 'course' && placement.courseId === target.id) ||
      (target.kind === 'subject' && placement.subjectId === target.id) ||
      (target.kind === 'folder' && placement.folderId === target.id) ||
      (target.kind === 'topic' && placement.topicId === target.id));
    const placementMatchesFilters = (material: StudyMaterialSummary) => material.placements.some((placement) =>
      (courseFilterId === 'all' || placement.courseId === courseFilterId) &&
      (subjectFilterId === 'all' || placement.subjectId === subjectFilterId) &&
      (topicFilterId === 'all' || placement.topicId === topicFilterId));
    return materials.filter((material) => placementMatchesTarget(material) && placementMatchesFilters(material) &&
      (!needle || `${material.title} ${material.description} ${material.fileName} ${(material.metadata.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(needle)))
      .sort((a, b) => compareStudyOrganization(
        { name: a.title, year: a.bibliography.year, position: a.position, createdAt: a.createdAt, updatedAt: a.updatedAt },
        { name: b.title, year: b.bibliography.year, position: b.position, createdAt: b.createdAt, updatedAt: b.updatedAt },
        organizationSort,
      ));
  }, [workspace, materials, target, query, kind, tagId, courseFilterId, subjectFilterId, topicFilterId, organizationSort]);

  const browserItems = useMemo<StudyBrowserItem[]>(() => {
    if (!workspace) return [];
    const needle = query.trim().toLocaleLowerCase();
    const selectedTopic = topicFilterId === 'all' ? null : workspace.topics.find((topic) => topic.id === topicFilterId) ?? null;
    const selectedTopicCourseId = selectedTopic ? workspace.subjects.find((subject) => subject.id === selectedTopic.subjectId)?.courseId ?? null : null;
    const matchesScope = (item: StudyBrowserItem) => {
      if (courseFilterId !== 'all' && item.courseId !== courseFilterId) return false;
      if (subjectFilterId !== 'all' && item.subjectId !== subjectFilterId && !(item.kind === 'course' && item.courseId === workspace.subjects.find((subject) => subject.id === subjectFilterId)?.courseId)) return false;
      if (selectedTopic) {
        if (item.kind === 'course') return item.courseId === selectedTopicCourseId;
        if (item.kind === 'subject') return item.subjectId === selectedTopic.subjectId;
        if (item.kind === 'folder') return item.folderId === selectedTopic.folderId;
        return item.topicId === selectedTopic.id || workspace.topics.some((topic) => topic.id === item.topicId && topic.parentId === selectedTopic.id);
      }
      return true;
    };
    // The academic year is derived here rather than at each call site so that every
    // kind of item resolves it the same way, and so a new listing cannot forget to.
    const decorate = (item: StudyBrowserItemDraft): StudyBrowserItem => {
      const own = item.kind === 'course'
        ? workspace.courses.find((course) => course.id === item.id)?.academicYearId ?? null
        : item.kind === 'subject'
          ? workspace.subjects.find((subject) => subject.id === item.id)?.academicYearId ?? null
          : null;
      const academicYearIds = item.kind === 'course'
        ? academicYearIdsForCourse(item.id)
        : [academicYearIdFor(item.courseId, item.subjectId)];
      return { ...item, academicYearId: own, academicYearIds };
    };
    const filter = (items: StudyBrowserItemDraft[]) => items.map(decorate)
      .filter((item) => matchesScope(item) && matchesAcademicYear(item.academicYearIds)
        && (!needle || `${item.name} ${item.description ?? ''} ${item.year ?? ''} ${academicYearLabel(workspace.academicYears, item.academicYearIds.find(Boolean) ?? null) ?? ''} ${item.meta}`.toLocaleLowerCase().includes(needle)))
      .sort((a, b) => compareStudyOrganization(a, b, organizationSort));
    if (!target) {
      return filter(workspace.courses.map((course) => ({
        kind: 'course', id: course.id, name: course.name, description: course.description, icon: course.icon || 'graduation',
        emoji: course.emoji, imageData: course.imageData, year: course.year, color: course.color, position: course.position, createdAt: course.createdAt, updatedAt: course.updatedAt,
        courseId: course.id, subjectId: null, topicId: null, folderId: null,
        meta: txCount(workspace.subjects.filter((subject) => subject.courseId === course.id).length, 'asignatura', 'asignaturas'),
      })));
    }
    if (target.kind === 'course') {
      return filter(workspace.subjects.filter((subject) => subject.courseId === target.id).map((subject) => ({
        kind: 'subject', id: subject.id, name: subject.name, description: subject.description, icon: subject.icon || 'book',
        emoji: subject.emoji, imageData: subject.imageData, year: subject.year, color: subject.color, position: subject.position, createdAt: subject.createdAt, updatedAt: subject.updatedAt,
        courseId: subject.courseId, subjectId: subject.id, topicId: null, folderId: null,
        meta: `${workspace.folders.filter((folder) => folder.subjectId === subject.id).length} ${t('carpetas')} · ${workspace.topics.filter((topic) => topic.subjectId === subject.id).length} ${t('temas de estudio')}`,
      })));
    }
    if (target.kind === 'subject') {
      const folders: StudyBrowserItemDraft[] = workspace.folders.filter((folder) => folder.subjectId === target.id && !folder.parentId).map((folder) => ({
        kind: 'folder', id: folder.id, name: folder.name, description: folder.description, icon: folder.icon || 'folder',
        emoji: folder.emoji, imageData: folder.imageData, year: folder.year, color: folder.color, position: folder.position, createdAt: folder.createdAt, updatedAt: folder.updatedAt,
        courseId: folder.courseId, subjectId: folder.subjectId, topicId: null, folderId: folder.id,
        meta: txCount(workspace.topics.filter((topic) => topic.folderId === folder.id && !topic.parentId).length, 'tema de estudio', 'temas de estudio'),
      }));
      const topics: StudyBrowserItemDraft[] = workspace.topics.filter((topic) => topic.subjectId === target.id && !topic.folderId && !topic.parentId).map((topic) => ({
        kind: 'topic', id: topic.id, name: topic.name, description: topic.description, icon: topic.icon || 'hash',
        emoji: topic.emoji, imageData: topic.imageData, year: topic.year, color: topic.color, position: topic.position, createdAt: topic.createdAt, updatedAt: topic.updatedAt,
        courseId: workspace.subjects.find((subject) => subject.id === topic.subjectId)?.courseId ?? null, subjectId: topic.subjectId, topicId: topic.id, folderId: topic.folderId,
        meta: t('Tema en la asignatura'),
      }));
      return filter([...folders, ...topics]);
    }
    if (target.kind === 'folder') {
      return filter(workspace.topics.filter((topic) => topic.folderId === target.id && !topic.parentId).map((topic) => ({
        kind: 'topic', id: topic.id, name: topic.name, description: topic.description, icon: topic.icon || 'hash',
        emoji: topic.emoji, imageData: topic.imageData, year: topic.year, color: topic.color, position: topic.position, createdAt: topic.createdAt, updatedAt: topic.updatedAt,
        courseId: workspace.subjects.find((subject) => subject.id === topic.subjectId)?.courseId ?? null, subjectId: topic.subjectId, topicId: topic.id, folderId: topic.folderId,
        meta: t('Tema en la carpeta'),
      })));
    }
    if (target.kind === 'topic') {
      return filter(workspace.topics.filter((topic) => topic.parentId === target.id).map((topic) => ({
        kind: 'topic', id: topic.id, name: topic.name, description: topic.description, icon: topic.icon || 'hash',
        emoji: topic.emoji, imageData: topic.imageData, year: topic.year, color: topic.color, position: topic.position, createdAt: topic.createdAt, updatedAt: topic.updatedAt,
        courseId: workspace.subjects.find((subject) => subject.id === topic.subjectId)?.courseId ?? null, subjectId: topic.subjectId, topicId: topic.id, folderId: topic.folderId,
        meta: t('Subtema'),
      })));
    }
    return [];
  }, [workspace, target, query, courseFilterId, subjectFilterId, topicFilterId, organizationSort, matchesAcademicYear, academicYearIdFor, academicYearIdsForCourse]);

  const breadcrumbs = useMemo<Array<{ label: string; target: StudyNavigationTarget | null }>>(() => {
    const crumbs: Array<{ label: string; target: StudyNavigationTarget | null }> = [{ label: t('Cursos'), target: null }];
    if (!workspace || !target) return crumbs;
    let courseId: string | null = null;
    let subjectId: string | null = null;
    let folderId: string | null = null;
    if (target.kind === 'course') courseId = target.id;
    if (target.kind === 'subject') {
      subjectId = target.id;
      courseId = workspace.subjects.find((subject) => subject.id === target.id)?.courseId ?? null;
    }
    if (target.kind === 'folder') {
      const folder = workspace.folders.find((item) => item.id === target.id);
      folderId = folder?.id ?? null;
      subjectId = folder?.subjectId ?? null;
      courseId = folder?.courseId ?? null;
    }
    if (target.kind === 'topic') {
      const topic = workspace.topics.find((item) => item.id === target.id);
      subjectId = topic?.subjectId ?? null;
      folderId = topic?.folderId ?? null;
      courseId = workspace.subjects.find((subject) => subject.id === subjectId)?.courseId ?? null;
    }
    if (target.kind === 'document') {
      const placement = workspace.placements.find((item) => item.documentId === target.id);
      courseId = placement?.courseId ?? null;
      subjectId = placement?.subjectId ?? null;
      folderId = placement?.folderId ?? null;
    }
    const course = workspace.courses.find((item) => item.id === courseId);
    const subject = workspace.subjects.find((item) => item.id === subjectId);
    const folder = workspace.folders.find((item) => item.id === folderId);
    if (course) crumbs.push({ label: course.name, target: { kind: 'course', id: course.id } });
    if (subject) crumbs.push({ label: subject.name, target: { kind: 'subject', id: subject.id } });
    if (folder) crumbs.push({ label: folder.name, target: { kind: 'folder', id: folder.id } });
    if (target.kind === 'topic') crumbs.push({ label: targetTitle(workspace, target), target });
    return crumbs;
  }, [workspace, target]);

  if (!workspace) return <div className="flex h-full items-center justify-center"><Spinner label={t('Cargando vault de estudio…')} /></div>;
  const selectedTitle = targetTitle(workspace, target);
  const exportScope: StudyExportScope = target ? { kind: target.kind, id: target.id } : { kind: 'workspace' };
  const openDocuments = openDocumentIds.map((id) => workspace.documents.find((document) => document.id === id)).filter((document): document is StudyDocument => Boolean(document));
  const browserLabel = !target ? t('Cursos') : target.kind === 'course' ? t('Asignaturas') : target.kind === 'subject' ? t('Carpetas y temas') : t('Temas');
  const showDocuments = Boolean(target && target.kind !== 'document');
  // The narrower filters only offer what the selected academic year contains, so the
  // three of them cannot be combined into a guaranteed-empty result.
  const academicYearCourses = workspace.courses.filter((course) => matchesAcademicYear(academicYearIdsForCourse(course.id)));
  const filterSubjects = workspace.subjects.filter((subject) =>
    (courseFilterId === 'all' ? academicYearCourses.some((course) => course.id === subject.courseId) : subject.courseId === courseFilterId)
    && matchesAcademicYear([effectiveAcademicYearId(subject, workspace.courses)]));
  const filterTopics = workspace.topics.filter((topic) =>
    (subjectFilterId === 'all' ? filterSubjects.some((subject) => subject.id === topic.subjectId) : topic.subjectId === subjectFilterId));
  const testScope = (placementForTarget() ?? {}) as StudyTestScope;
  const canCreateTest = Boolean(target && target.kind !== 'document');
  const runExport = async () => {
    setExporting(true); setExportProgress(6); setExportError('');
    const timer = window.setInterval(() => setExportProgress((value) => Math.min(92, value + Math.max(2, Math.round((94 - value) / 9)))), 180);
    try {
      const result = await window.nodus.exportStudyScope(exportScope, exportFormat);
      window.clearInterval(timer);
      if (!result) { setExporting(false); setExportProgress(0); return; }
      setExportProgress(100);
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      setExportOpen(false); setExporting(false); setExportProgress(0);
    } catch (cause) {
      window.clearInterval(timer); setExporting(false); setExportProgress(0); setExportError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  if (editing) {
    return (
      <Suspense fallback={<div className="flex h-full items-center justify-center"><Spinner label={t('Cargando editor…')} /></div>}>
      <StudyEditor
        documents={openDocuments.length ? openDocuments : [editing]}
        tags={workspace.tags}
        activeTagIds={workspace.documentTags.filter((link) => link.documentId === editing.id).map((link) => link.tagId)}
        subjectId={workspace.placements.find((placement) => placement.documentId === editing.id && placement.subjectId)?.subjectId}
        activeId={editing.id}
        onActivate={(id) => {
          const document = workspace.documents.find((candidate) => candidate.id === id);
          if (document) { setEditing(document); onTargetChange({ kind: 'document', id }); }
        }}
        onClose={(id) => {
          const remaining = openDocumentIds.filter((candidate) => candidate !== id);
          setOpenDocumentIds(remaining);
          const next = workspace.documents.find((document) => document.id === remaining.at(-1));
          setEditing(next ?? null);
          onTargetChange(next ? { kind: 'document', id: next.id } : null);
        }}
        onSaved={(updated) => {
          setWorkspace((current) => current ? { ...current, documents: current.documents.map((document) => document.id === updated.id ? updated : document) } : current);
          setEditing(updated);
          announceStudyWorkspaceChanged();
        }}
        onUpdateMetadata={async (patch) => {
          const updated = await window.nodus.updateStudyEntity('document', editing.id, patch);
          if (updated && 'title' in updated) {
            setWorkspace((current) => current ? { ...current, documents: current.documents.map((document) => document.id === updated.id ? updated : document) } : current);
            setEditing(updated);
            announceStudyWorkspaceChanged();
          }
        }}
        onSetTags={async (tagIds) => {
          await window.nodus.setStudyDocumentTags(editing.id, tagIds);
          announceStudyWorkspaceChanged();
          await reload();
        }}
        onCreateTag={async (name) => {
          const tag = await window.nodus.createStudyTag({ name });
          const current = workspace.documentTags.filter((link) => link.documentId === editing.id).map((link) => link.tagId);
          await window.nodus.setStudyDocumentTags(editing.id, [...current, tag.id]);
          announceStudyWorkspaceChanged();
          await reload();
        }}
        onDuplicate={async () => {
          const duplicate = await window.nodus.duplicateStudyTree('document', editing.id);
          if ('title' in duplicate) openDocument(duplicate);
          announceStudyWorkspaceChanged();
          await reload();
        }}
        onTrash={async () => {
          await window.nodus.setStudyLifecycle('document', editing.id, 'trash');
          const remaining = openDocumentIds.filter((candidate) => candidate !== editing.id);
          setOpenDocumentIds(remaining);
          const next = workspace.documents.find((document) => document.id === remaining.at(-1));
          setEditing(next ?? null);
          onTargetChange(next ? { kind: 'document', id: next.id } : null);
          announceStudyWorkspaceChanged();
          await reload();
        }}
        onOpenLinkedDocument={(id) => {
          const document = workspace.documents.find((candidate) => candidate.id === id);
          if (document) openDocument(document);
        }}
        onOpenRecording={onOpenRecording}
      />
      </Suspense>
    );
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragEnter={(event) => { if (showDocuments && event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragActive(true); } }}
      onDragOver={(event) => { if (showDocuments && event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }}
      onDrop={(event) => { if (!showDocuments || !event.dataTransfer.types.includes('Files')) return; event.preventDefault(); setDragActive(false); void handleFilesDropped(event.dataTransfer.files); }}
    >
      {dragActive && <div className="pointer-events-none absolute inset-3 z-[60] grid place-items-center rounded-2xl border-2 border-dashed border-teal-500 bg-teal-950/85 text-center shadow-2xl" data-testid="study-organization-dropzone"><div><Icon name="upload" size={32} className="mx-auto mb-3 text-teal-300" /><p className="font-semibold text-teal-100">{t('Suelta los archivos para añadirlos a esta sección')}</p><p className="mt-1 text-xs text-teal-300">{t('Se importarán como materiales en la selección actual.')}</p></div></div>}
      <header className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-5 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-400">{mode === 'library' ? t('Materiales de estudio') : t('Organización')}</p>
          <h1 className="truncate text-lg font-semibold text-neutral-100">{selectedTitle}</h1>
          <nav className="mt-1 flex min-w-0 items-center gap-1 overflow-hidden text-[10px] text-neutral-600" aria-label={t('Ruta de organización')}>
            {breadcrumbs.map((crumb, index) => (
              <span key={`${crumb.target?.kind ?? 'root'}:${crumb.target?.id ?? 'root'}`} className="flex min-w-0 items-center gap-1">
                {index > 0 && <Icon name="chevronRight" size={10} />}
                <button className="truncate hover:text-indigo-400" onClick={() => { setEditing(null); onTargetChange(crumb.target); }}>{crumb.label}</button>
              </span>
            ))}
          </nav>
        </div>
        {mode === 'organization' && (
          <>
            {!target && <StudyHeaderAction testId="study-create-course" icon="graduation" label={t('Nuevo curso')} tone="primary" onClick={() => openCreateDialog('course')} />}
            {target?.kind === 'course' && <StudyHeaderAction testId="study-create-subject" icon="book" label={t('Nueva asignatura')} tone="primary" onClick={() => openCreateDialog('subject')} />}
            {target?.kind === 'subject' && <StudyHeaderAction testId="study-create-folder" icon="folderPlus" label={t('Nueva carpeta')} onClick={() => openCreateDialog('folder')} />}
            {(target?.kind === 'subject' || target?.kind === 'folder' || target?.kind === 'topic') && <StudyHeaderAction testId="study-create-topic" icon="hash" label={t(target.kind === 'topic' ? 'Nuevo subtema' : 'Nuevo tema')} onClick={() => openCreateDialog('topic')} />}
          </>
        )}
        {mode === 'organization' && canCreateTest && <StudyHeaderAction testId="study-create-ai-test" icon="quiz" label={t('Crear test')} tone="primary" onClick={() => setAssessmentGenerator('test')} />}
        {mode === 'organization' && canCreateTest && <StudyHeaderAction testId="study-create-ai-exam" icon="exam" label={t('Crear examen')} tone="secondary" onClick={() => setAssessmentGenerator('exam')} />}
        {mode === 'organization' && canCreateTest && <StudyHeaderAction testId="study-create-ai-flashcards" icon="flashcards" label={t('Crear flashcards')} onClick={() => setAssessmentGenerator('flashcards')} />}
        <StudyHeaderAction testId="study-export-scope" icon="download" label={t('Exportar')} onClick={() => setExportOpen(true)} />
        {(target?.kind === 'course' || target?.kind === 'subject' || target?.kind === 'folder' || target?.kind === 'topic') && <StudyHeaderAction testId="study-organization-zotero-import" icon="book" label={t('Importar de Zotero')} onClick={() => setZoteroMaterialImportOpen(true)} />}
        {(target?.kind === 'course' || target?.kind === 'subject' || target?.kind === 'folder' || target?.kind === 'topic') && <StudyHeaderAction testId="study-organization-material-import" icon="upload" label={t('Desde el dispositivo')} tone="primary" onClick={() => void importMaterialsForTarget()} />}
        {target && <StudyHeaderAction testId="study-create-document" icon="notebook" label={t('Nuevo apunte')} onClick={() => openCreateDialog('document')} />}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="p-5" data-testid="study-organization-browser-section">
          <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="study-organization-toolbar">
            <label className="relative min-w-64 flex-1">
              <Icon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" />
              <input data-testid="study-organization-search" className="input input-with-leading-icon w-full" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar en esta sección…')} />
            </label>
            <StudyAcademicYearScopeSelect
              years={workspace.academicYears}
              scope={academicYearScope}
              onScopeChange={(next) => { setAcademicYearScope(next); setCourseFilterId('all'); setSubjectFilterId('all'); setTopicFilterId('all'); }}
              hasUnscoped={hasUnscopedWork}
              onManage={() => setAcademicYearManagerOpen(true)}
            />
            <select data-testid="study-organization-course-filter" aria-label={t('Filtrar por curso')} className="input h-9 min-w-40 text-xs" value={courseFilterId} onChange={(event) => { setCourseFilterId(event.target.value); setSubjectFilterId('all'); setTopicFilterId('all'); }}><option value="all">{t('Todos los cursos')}</option>{academicYearCourses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select>
            <select data-testid="study-organization-subject-filter" aria-label={t('Filtrar por asignatura')} className="input h-9 min-w-44 text-xs" value={subjectFilterId} onChange={(event) => { setSubjectFilterId(event.target.value); setTopicFilterId('all'); }}><option value="all">{t('Todas las asignaturas')}</option>{filterSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select>
            <select data-testid="study-organization-topic-filter" aria-label={t('Filtrar por tema')} className="input h-9 min-w-40 text-xs" value={topicFilterId} onChange={(event) => setTopicFilterId(event.target.value)}><option value="all">{t('Todos los temas')}</option>{filterTopics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select>
            <select data-testid="study-organization-sort" aria-label={t('Ordenar')} className="input h-9 min-w-48 text-xs" value={organizationSort} onChange={(event) => setOrganizationSort(event.target.value as StudyOrganizationSort)}><option value="manual">{t('Orden manual')}</option><option value="year-desc">{t('Año: más reciente')}</option><option value="year-asc">{t('Año: más antiguo')}</option><option value="created-desc">{t('Creación: más recientes')}</option><option value="created-asc">{t('Creación: más antiguos')}</option><option value="updated-desc">{t('Actividad reciente')}</option><option value="name-asc">{t('Nombre: A–Z')}</option><option value="name-desc">{t('Nombre: Z–A')}</option></select>
            {showDocuments && <select className="input w-48" value={kind} onChange={(event) => setKind(event.target.value as StudyDocumentKind | 'all')}><option value="all">{t('Todos los tipos')}</option>{STUDY_DOCUMENT_KINDS.map((value) => <option key={value} value={value}>{t(KIND_LABEL[value])}</option>)}</select>}
            {showDocuments && <select className="input w-40" value={tagId} onChange={(event) => setTagId(event.target.value)}><option value="all">{t('Todas las etiquetas')}</option>{workspace.tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select>}
            <span className="flex rounded-lg border border-neutral-800 p-0.5"><button data-testid="study-browser-layout-list" className={`rounded-md p-1.5 ${browserLayout === 'list' ? 'bg-indigo-600/20 text-indigo-300' : 'text-neutral-600'}`} title={t('Vista de lista')} onClick={() => { setBrowserLayout('list'); localStorage.setItem('nodus-study-browser-layout', 'list'); }}><Icon name="list" size={13} /></button><button data-testid="study-browser-layout-grid" className={`rounded-md p-1.5 ${browserLayout === 'grid' ? 'bg-indigo-600/20 text-indigo-300' : 'text-neutral-600'}`} title={t('Vista de cuadrícula')} onClick={() => { setBrowserLayout('grid'); localStorage.setItem('nodus-study-browser-layout', 'grid'); }}><Icon name="grid" size={13} /></button></span>
          </div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-neutral-300">{browserLabel}</h2>
            <span className="text-xs text-neutral-600">{browserItems.length}</span>
          </div>
          {browserItems.length > 0 ? (
            <StudyBrowserCollection items={browserItems} layout={browserLayout} academicYears={workspace.academicYears} onOpen={(item) => { setEditing(null); onTargetChange({ kind: item.kind, id: item.id }); }} onRename={setRenamingItem} onMove={(item) => setLocatingItem({ item, mode: 'move' })} onDuplicate={(item) => void duplicateBrowserItem(item)} onDelete={setDeletingItem} />
          ) : (
            <div className="rounded-xl border border-dashed border-neutral-800 px-6 py-10 text-center text-sm text-neutral-500">
              <Icon name={!target ? 'graduation' : target.kind === 'course' ? 'book' : 'folder'} size={24} className="mb-3 text-neutral-700" />
              <p>{t(!target ? 'Aún no hay cursos.' : target.kind === 'course' ? 'Este curso aún no tiene asignaturas.' : 'No hay carpetas ni temas en esta selección.')}</p>
            </div>
          )}
        </section>

        {showDocuments && <section className="flex min-w-0 flex-col px-5 pb-5" data-testid="study-documents-section">
          <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-neutral-300">{t('Apuntes y materiales')}</h2><span className="text-xs text-neutral-600">{documents.length + scopedMaterials.length}</span></div>
          <div className="flex-1 content-start overflow-y-auto">
            {documents.length > 0 && <StudyDocumentCollection documents={documents} layout={browserLayout} onOpen={openDocument} onEdit={setEditingDocumentMetadata} onDelete={setDeletingDocument} />}
            {scopedMaterials.length > 0 && <StudyMaterialCollection materials={scopedMaterials} layout={browserLayout} onOpen={(material) => onOpenMaterial(material.id)} onRename={setRenamingMaterial} onDelete={setDeletingMaterial} />}
            {documents.length === 0 && scopedMaterials.length === 0 && (
              <div className="col-span-full rounded-xl border border-dashed border-neutral-800 px-6 py-12 text-center text-sm text-neutral-500">
                <Icon name="book" size={24} className="mb-3 text-neutral-700" /><p>{t('No hay materiales en esta selección.')}</p>
              </div>
            )}
          </div>
        </section>}
        {mode === 'organization' && canCreateTest && <StudyGeneratedQuestionsTable questions={generatedQuestions} />}
      </div>
      {exportOpen && createPortal(<div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-6" onClick={() => { if (!exporting) setExportOpen(false); }}><section data-testid="study-export-modal" className="card w-full max-w-md p-5" role="dialog" aria-modal="true" aria-labelledby="study-export-title" onClick={(event) => event.stopPropagation()}><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-900/30 text-teal-300"><Icon name="download" /></div><div><h2 id="study-export-title" className="font-semibold">{t('Exportar contenido')}</h2><p className="mt-1 text-xs text-neutral-500">{t('Elige el formato del archivo que quieres descargar.')}</p></div></div><label className="mt-5 block text-xs text-neutral-500">{t('Formato de descarga')}<select data-testid="study-export-format" className="input mt-1 w-full" value={exportFormat} disabled={exporting} onChange={(event) => setExportFormat(event.target.value as StudyExportFormat)}><option value="bundle">ZIP</option><option value="markdown">Markdown</option><option value="txt">TXT</option><option value="html">HTML</option><option value="docx">Word</option><option value="pdf">PDF</option></select></label>{exporting && <div className="mt-5" data-testid="study-export-progress"><div className="mb-1.5 flex items-center justify-between text-xs"><span className="text-neutral-400">{exportProgress < 100 ? t('Generando archivo…') : t('Descarga preparada')}</span><span className="font-medium text-teal-400">{exportProgress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-neutral-800"><div className="h-full rounded-full bg-teal-600 transition-[width] duration-200" style={{ width: `${exportProgress}%` }} /></div></div>}{exportError && <p className="mt-4 rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">{exportError}</p>}<div className="mt-6 flex justify-end gap-2"><button className="btn btn-ghost" disabled={exporting} onClick={() => setExportOpen(false)}>{t('Cancelar')}</button><button data-testid="study-export-download" className="btn btn-primary" disabled={exporting} onClick={() => void runExport()}>{exporting ? <Spinner label={t('Generando…')} /> : <><Icon name="download" />{t('Descargar')}</>}</button></div></section></div>, document.body)}
      {assessmentGenerator && <StudyTestGeneratorDialog kind={assessmentGenerator} scope={testScope} scopeTitle={selectedTitle} onCancel={() => setAssessmentGenerator(null)} onCreated={(questions) => { setGeneratedQuestions((current) => [...questions, ...current]); if (assessmentGenerator === 'test') setAssessmentGenerator(null); }} />}
      {createDraft && (
        <StudyCreateDialog
          draft={createDraft}
          workspace={workspace}
          onSubmit={submitCreate}
          onCancel={() => setCreateDraft(null)}
          onManageAcademicYears={() => setAcademicYearManagerOpen(true)}
        />
      )}
      {academicYearManagerOpen && <StudyAcademicYearManager years={workspace.academicYears} usage={academicYearUsage} onClose={() => setAcademicYearManagerOpen(false)} onChanged={refreshAfterOrganizationChange} />}
      {renamingItem && <StudyCreateDialog initial={renamingItem} draft={{ kind: renamingItem.kind, courseId: '', subjectId: '', folderId: '', parentId: '' }} workspace={workspace} onManageAcademicYears={() => setAcademicYearManagerOpen(true)} onCancel={() => setRenamingItem(null)} onSubmit={async (values) => { await window.nodus.updateStudyEntity(renamingItem.kind, renamingItem.id, { name: values.name, description: values.description || null, color: values.color || null, icon: values.icon || null, emoji: values.emoji || null, imageData: values.imageData || null, year: values.year, ...(renamingItem.kind === 'course' || renamingItem.kind === 'subject' ? { academicYearId: values.academicYearId || null } : {}) }); setRenamingItem(null); await refreshAfterOrganizationChange(); }} />}
      {editingDocumentMetadata && <StudyCreateDialog initial={{ kind: 'topic', id: editingDocumentMetadata.id, name: editingDocumentMetadata.title, description: editingDocumentMetadata.description, icon: editingDocumentMetadata.icon || 'notebook', emoji: editingDocumentMetadata.emoji, imageData: editingDocumentMetadata.imageData, year: editingDocumentMetadata.year, color: editingDocumentMetadata.color, position: editingDocumentMetadata.position, createdAt: editingDocumentMetadata.createdAt, updatedAt: editingDocumentMetadata.updatedAt, courseId: null, subjectId: null, topicId: null, folderId: null, academicYearId: null, academicYearIds: [null], meta: '' }} draft={{ kind: 'document', courseId: '', subjectId: '', folderId: '', parentId: '' }} workspace={workspace} onCancel={() => setEditingDocumentMetadata(null)} onSubmit={async (values) => { await window.nodus.updateStudyEntity('document', editingDocumentMetadata.id, { title: values.name, description: values.description || null, color: values.color || null, icon: values.icon || null, emoji: values.emoji || null, imageData: values.imageData || null, year: values.year }); setEditingDocumentMetadata(null); await refreshAfterOrganizationChange(); }} />}
      {locatingItem && workspace && <StudyEntityLocationDialog item={locatingItem.item} mode={locatingItem.mode} workspace={workspace} onCancel={() => setLocatingItem(null)} onSave={async (destination) => { let entityId = locatingItem.item.id; if (locatingItem.mode === 'duplicate') entityId = (await window.nodus.duplicateStudyTree(locatingItem.item.kind, locatingItem.item.id)).id; if (locatingItem.item.kind !== 'course') await window.nodus.moveStudyEntity(locatingItem.item.kind, entityId, destination); setLocatingItem(null); await refreshAfterOrganizationChange(); }} />}
      {deletingItem && <ConfirmModal title={t('Eliminar elemento')} message={t('«{name}» y todo su contenido se moverán a la papelera.').replace('{name}', deletingItem.name)} confirmLabel={t('Mover a la papelera')} danger onCancel={() => setDeletingItem(null)} onConfirm={() => void window.nodus.setStudyLifecycle(deletingItem.kind, deletingItem.id, 'trash').then(async () => { setDeletingItem(null); await refreshAfterOrganizationChange(); })} />}
      {deletingDocument && <ConfirmModal title={t('Eliminar elemento')} message={t('«{name}» y todo su contenido se moverán a la papelera.').replace('{name}', deletingDocument.title)} confirmLabel={t('Mover a la papelera')} danger onCancel={() => setDeletingDocument(null)} onConfirm={() => void window.nodus.setStudyLifecycle('document', deletingDocument.id, 'trash').then(async () => { setDeletingDocument(null); await refreshAfterOrganizationChange(); })} />}
      {deletingMaterial && <ConfirmModal title={t('Mover material a la papelera')} message={t('El material «{name}» dejará de aparecer en la biblioteca. Podrás recuperarlo desde la administración de datos.').replace('{name}', deletingMaterial.title)} confirmLabel={t('Mover a la papelera')} danger onCancel={() => setDeletingMaterial(null)} onConfirm={() => void window.nodus.setStudyMaterialLifecycle(deletingMaterial.id, 'trash').then(async () => { setDeletingMaterial(null); announceStudyWorkspaceChanged(); await reload(); })} />}
      {renamingMaterial && <StudyMaterialRenameDialog material={renamingMaterial} onCancel={() => setRenamingMaterial(null)} onSave={async (title) => { await window.nodus.updateStudyMaterial(renamingMaterial.id, { title }); setRenamingMaterial(null); announceStudyWorkspaceChanged(); await reload(); }} />}
      {zoteroMaterialImportOpen && <ZoteroMaterialImportModal placement={placementForTarget() ?? {}} onClose={() => setZoteroMaterialImportOpen(false)} onImported={async () => { announceStudyWorkspaceChanged(); await reload(); }} />}
    </div>
  );
}
