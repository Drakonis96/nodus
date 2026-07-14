import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StudyDocument, StudyDocumentKind, StudyWorkspace } from '@shared/studyOrg';
import { STUDY_DOCUMENT_KINDS } from '@shared/studyOrg';
import { Icon, Spinner } from '../components/ui';
import { announceStudyWorkspaceChanged, STUDY_WORKSPACE_CHANGED, type StudyNavigationTarget } from '../components/StudySidebar';
import { t } from '../i18n';

const StudyEditor = lazy(() => import('../components/editor/StudyEditor').then((module) => ({ default: module.StudyEditor })));

const KIND_LABEL: Record<StudyDocumentKind, string> = {
  apunte: 'Apunte', manual: 'Manual', libro: 'Libro', articulo: 'Artículo', presentacion: 'Presentación',
  grabacion: 'Grabación', transcripcion: 'Transcripción', banco: 'Banco de preguntas', test: 'Test', examen: 'Examen',
};

type StudyCreateKind = 'course' | 'subject' | 'topic' | 'folder' | 'document';

interface StudyCreateDraft {
  kind: StudyCreateKind;
  courseId: string;
  subjectId: string;
  parentId: string;
}

interface StudyCreateValues extends StudyCreateDraft {
  name: string;
  documentKind: StudyDocumentKind;
}

const CREATE_TITLES: Record<StudyCreateKind, string> = {
  course: 'Nuevo curso',
  subject: 'Nueva asignatura',
  topic: 'Nuevo tema',
  folder: 'Nueva carpeta',
  document: 'Nuevo material',
};

function StudyCreateDialog({
  draft,
  workspace,
  onSubmit,
  onCancel,
}: {
  draft: StudyCreateDraft;
  workspace: StudyWorkspace;
  onSubmit: (values: StudyCreateValues) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [courseId, setCourseId] = useState(draft.courseId);
  const [subjectId, setSubjectId] = useState(draft.subjectId);
  const [parentId, setParentId] = useState(draft.parentId);
  const [documentKind, setDocumentKind] = useState<StudyDocumentKind>('apunte');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subjects = workspace.subjects.filter((subject) => subject.courseId === courseId);
  const topics = workspace.topics.filter((topic) => topic.subjectId === subjectId);
  const requiresCourse = draft.kind === 'subject';
  const requiresSubject = draft.kind === 'topic';
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
      await onSubmit({ kind: draft.kind, name: name.trim(), courseId, subjectId, parentId, documentKind });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('No se pudo crear el elemento.'));
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-6" onClick={() => { if (!busy) onCancel(); }}>
      <form data-testid="study-create-dialog" className="card w-full max-w-md space-y-3 p-5" role="dialog" aria-modal="true" aria-label={t(CREATE_TITLES[draft.kind])} onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <h2 className="text-base font-semibold">{t(CREATE_TITLES[draft.kind])}</h2>
        <label className="block text-xs text-neutral-500">
          {t(draft.kind === 'document' ? 'Título' : 'Nombre')}
          <input data-testid="study-create-name" autoFocus className="input mt-1 w-full text-sm" value={name} onChange={(event) => setName(event.target.value)} placeholder={t(draft.kind === 'document' ? 'Título del material' : 'Escribe un nombre')} />
        </label>

        {draft.kind === 'subject' && (
          <label className="block text-xs text-neutral-500">
            {t('Curso')}
            <select data-testid="study-create-course" className="input mt-1 w-full" value={courseId} onChange={(event) => setCourseId(event.target.value)}>
              <option value="">{t('Selecciona un curso')}</option>
              {workspace.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
            </select>
          </label>
        )}

        {draft.kind === 'topic' && (
          <>
            <label className="block text-xs text-neutral-500">
              {t('Curso')}
              <select className="input mt-1 w-full" value={courseId} onChange={(event) => {
                const nextCourseId = event.target.value;
                const nextSubjectId = workspace.subjects.find((subject) => subject.courseId === nextCourseId)?.id ?? '';
                setCourseId(nextCourseId); setSubjectId(nextSubjectId); setParentId('');
              }}>
                <option value="">{t('Selecciona un curso')}</option>
                {workspace.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
              </select>
            </label>
            <label className="block text-xs text-neutral-500">
              {t('Asignatura')}
              <select data-testid="study-create-subject" className="input mt-1 w-full" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setParentId(''); }}>
                <option value="">{t('Selecciona una asignatura')}</option>
                {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
              </select>
            </label>
            {topics.length > 0 && (
              <label className="block text-xs text-neutral-500">
                {t('Subtema de (opcional)')}
                <select className="input mt-1 w-full" value={parentId} onChange={(event) => setParentId(event.target.value)}>
                  <option value="">{t('Tema principal')}</option>
                  {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
                </select>
              </label>
            )}
          </>
        )}

        {draft.kind === 'folder' && workspace.folders.length > 0 && (
          <label className="block text-xs text-neutral-500">
            {t('Dentro de (opcional)')}
            <select className="input mt-1 w-full" value={parentId} onChange={(event) => setParentId(event.target.value)}>
              <option value="">{t('Carpeta raíz')}</option>
              {workspace.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
          </label>
        )}

        {draft.kind === 'document' && (
          <label className="block text-xs text-neutral-500">
            {t('Tipo de material')}
            <select data-testid="study-create-document-kind" className="input mt-1 w-full" value={documentKind} onChange={(event) => setDocumentKind(event.target.value as StudyDocumentKind)}>
              {STUDY_DOCUMENT_KINDS.map((value) => <option key={value} value={value}>{t(KIND_LABEL[value])}</option>)}
            </select>
          </label>
        )}

        {((requiresCourse && workspace.courses.length === 0) || (requiresSubject && workspace.subjects.length === 0)) && (
          <p className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
            {t(requiresCourse ? 'Crea primero un curso.' : 'Crea primero un curso y una asignatura.')}
          </p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>{t('Cancelar')}</button>
          <button data-testid="study-create-submit" type="submit" className="btn btn-primary" disabled={busy || !valid}>{busy ? t('Creando…') : t('Crear')}</button>
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
  if (!target) return 'Todo el vault';
  if (target.kind === 'document') return workspace.documents.find((item) => item.id === target.id)?.title ?? 'Documento';
  const list = target.kind === 'course' ? workspace.courses : target.kind === 'subject' ? workspace.subjects : target.kind === 'topic' ? workspace.topics : workspace.folders;
  return list.find((item) => item.id === target.id)?.name ?? 'Selección';
}

export function StudyOrganizationView({
  target,
  mode,
  onTargetChange,
}: {
  target: StudyNavigationTarget | null;
  mode: 'organization' | 'library';
  onTargetChange: (target: StudyNavigationTarget | null) => void;
}) {
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<StudyDocumentKind | 'all'>('all');
  const [tagId, setTagId] = useState<string>('all');
  const [editing, setEditing] = useState<StudyDocument | null>(null);
  const [openDocumentIds, setOpenDocumentIds] = useState<string[]>([]);
  const [createDraft, setCreateDraft] = useState<StudyCreateDraft | null>(null);

  const reload = useCallback(async () => {
    const next = await window.nodus.getStudyWorkspace();
    setWorkspace(next);
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
      return { courseId: subject?.courseId, subjectId: topic?.subjectId, topicId: target.id };
    }
    return { folderId: target.id };
  };

  const openCreateDialog = (kind: StudyCreateKind) => {
    if (!workspace) return;
    let courseId = workspace.courses[0]?.id ?? '';
    let subjectId = workspace.subjects.find((subject) => subject.courseId === courseId)?.id ?? workspace.subjects[0]?.id ?? '';
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
      if (kind === 'topic') parentId = target.id;
    } else if (target?.kind === 'folder' && kind === 'folder') {
      parentId = target.id;
    }
    setCreateDraft({ kind, courseId, subjectId, parentId });
  };

  const submitCreate = async (values: StudyCreateValues) => {
    let nextTarget: StudyNavigationTarget | null = null;
    let createdDocument: StudyDocument | null = null;
    if (values.kind === 'course') {
      const item = await window.nodus.createStudyCourse({ name: values.name });
      nextTarget = { kind: 'course', id: item.id };
    } else if (values.kind === 'subject') {
      const item = await window.nodus.createStudySubject({ courseId: values.courseId, name: values.name });
      nextTarget = { kind: 'subject', id: item.id };
    } else if (values.kind === 'topic') {
      const item = await window.nodus.createStudyTopic({ subjectId: values.subjectId, parentId: values.parentId || null, name: values.name });
      nextTarget = { kind: 'topic', id: item.id };
    } else if (values.kind === 'folder') {
      const item = await window.nodus.createStudyFolder({ parentId: values.parentId || null, name: values.name });
      nextTarget = { kind: 'folder', id: item.id };
    } else {
      createdDocument = await window.nodus.createStudyDocument({ title: values.name, kind: values.documentKind, placement: placementForTarget() });
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
    return workspace.documents.filter((document) =>
      placementMatches(workspace, document.id, target) &&
      (kind === 'all' || document.kind === kind) &&
      (tagId === 'all' || workspace.documentTags.some((link) => link.documentId === document.id && link.tagId === tagId)) &&
      (!needle || `${document.title} ${document.description ?? ''} ${document.contentMarkdown}`.toLocaleLowerCase().includes(needle))
    );
  }, [workspace, target, query, kind, tagId]);

  if (!workspace) return <div className="flex h-full items-center justify-center"><Spinner label={t('Cargando vault de estudio…')} /></div>;
  const selectedTitle = targetTitle(workspace, target);
  const openDocuments = openDocumentIds.map((id) => workspace.documents.find((document) => document.id === id)).filter((document): document is StudyDocument => Boolean(document));

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
      />
      </Suspense>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-5 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-400">{mode === 'library' ? t('Materiales de estudio') : t('Organización')}</p>
          <h1 className="truncate text-lg font-semibold text-neutral-100">{selectedTitle}</h1>
        </div>
        {mode === 'organization' && (
          <>
            <button data-testid="study-create-course" className="btn btn-ghost" onClick={() => openCreateDialog('course')}><Icon name="plus" /> {t('Curso')}</button>
            <button data-testid="study-create-subject" className="btn btn-ghost" onClick={() => openCreateDialog('subject')}><Icon name="plus" /> {t('Asignatura')}</button>
            <button data-testid="study-create-topic" className="btn btn-ghost" onClick={() => openCreateDialog('topic')}><Icon name="plus" /> {t('Tema')}</button>
            <button data-testid="study-create-folder" className="btn btn-ghost" onClick={() => openCreateDialog('folder')}><Icon name="folderPlus" /> {t('Carpeta')}</button>
          </>
        )}
        <button data-testid="study-create-document" className="btn btn-primary" onClick={() => openCreateDialog('document')}><Icon name="plus" /> {t('Material')}</button>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex gap-2 border-b border-neutral-800 px-5 py-3">
            <label className="relative min-w-0 flex-1">
              <Icon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" />
              <input className="input input-with-leading-icon w-full" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar materiales…')} />
            </label>
            <select className="input w-48" value={kind} onChange={(event) => setKind(event.target.value as StudyDocumentKind | 'all')}>
              <option value="all">{t('Todos los tipos')}</option>
              {STUDY_DOCUMENT_KINDS.map((value) => <option key={value} value={value}>{t(KIND_LABEL[value])}</option>)}
            </select>
            <select className="input w-40" value={tagId} onChange={(event) => setTagId(event.target.value)}>
              <option value="all">{t('Todas las etiquetas')}</option>
              {workspace.tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
          </div>
          <div className="grid flex-1 content-start gap-3 overflow-y-auto p-5 sm:grid-cols-2 xl:grid-cols-3">
            {documents.map((document) => (
              <button key={document.id} draggable
                onDragStart={(event) => event.dataTransfer.setData('application/x-nodus-study-doc', document.id)}
                onClick={() => openDocument(document)}
                className="group rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-left transition-colors hover:border-indigo-800">
                <div className="flex items-start gap-2">
                  <span className="rounded-lg bg-indigo-600/15 p-2 text-indigo-300"><Icon name={document.icon || 'notebook'} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-neutral-200">{document.title}</span>
                    <span className="mt-1 block text-[10px] uppercase tracking-wider text-neutral-600">{t(KIND_LABEL[document.kind])} · {document.shortId}</span>
                  </span>
                  {document.favorite && <Icon name="star" size={13} className="text-amber-400" />}
                </div>
                <p className="mt-3 line-clamp-3 text-xs leading-5 text-neutral-500">{document.description || document.contentMarkdown || t('Material vacío')}</p>
              </button>
            ))}
            {documents.length === 0 && (
              <div className="col-span-full rounded-xl border border-dashed border-neutral-800 px-6 py-12 text-center text-sm text-neutral-500">
                <Icon name="book" size={24} className="mb-3 text-neutral-700" /><p>{t('No hay materiales en esta selección.')}</p>
              </div>
            )}
          </div>
        </section>

      </div>
      {createDraft && (
        <StudyCreateDialog
          draft={createDraft}
          workspace={workspace}
          onSubmit={submitCreate}
          onCancel={() => setCreateDraft(null)}
        />
      )}
    </div>
  );
}
