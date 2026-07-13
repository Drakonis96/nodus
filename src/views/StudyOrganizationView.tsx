import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StudyDocument, StudyDocumentKind, StudyWorkspace } from '@shared/studyOrg';
import { STUDY_DOCUMENT_KINDS } from '@shared/studyOrg';
import { Icon, Spinner } from '../components/ui';
import { announceStudyWorkspaceChanged, STUDY_WORKSPACE_CHANGED, type StudyNavigationTarget } from '../components/StudySidebar';
import { t } from '../i18n';

const KIND_LABEL: Record<StudyDocumentKind, string> = {
  apunte: 'Apunte', manual: 'Manual', libro: 'Libro', articulo: 'Artículo', presentacion: 'Presentación',
  grabacion: 'Grabación', transcripcion: 'Transcripción', banco: 'Banco de preguntas', test: 'Test', examen: 'Examen',
};

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
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const next = await window.nodus.getStudyWorkspace();
    setWorkspace(next);
    if (editing) setEditing(next.documents.find((document) => document.id === editing.id) ?? null);
  }, [editing?.id]);

  useEffect(() => {
    void reload();
    window.addEventListener(STUDY_WORKSPACE_CHANGED, reload);
    return () => window.removeEventListener(STUDY_WORKSPACE_CHANGED, reload);
  }, [reload]);

  useEffect(() => {
    if (target?.kind === 'document' && workspace) setEditing(workspace.documents.find((document) => document.id === target.id) ?? null);
  }, [target?.kind, target?.id, workspace]);

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

  const change = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    try { await operation(); announceStudyWorkspaceChanged(); await reload(); }
    finally { setBusy(false); }
  };

  const createCourse = () => {
    const name = window.prompt(t('Nombre del curso'));
    if (name) void change(async () => { const item = await window.nodus.createStudyCourse({ name }); onTargetChange({ kind: 'course', id: item.id }); });
  };
  const createSubject = () => {
    const courseId = target?.kind === 'course' ? target.id : workspace?.courses[0]?.id;
    if (!courseId) return createCourse();
    const name = window.prompt(t('Nombre de la asignatura'));
    if (name) void change(async () => { const item = await window.nodus.createStudySubject({ courseId, name }); onTargetChange({ kind: 'subject', id: item.id }); });
  };
  const createTopic = () => {
    const subjectId = target?.kind === 'subject' ? target.id : target?.kind === 'topic'
      ? workspace?.topics.find((item) => item.id === target.id)?.subjectId : workspace?.subjects[0]?.id;
    if (!subjectId) return createSubject();
    const name = window.prompt(t('Nombre del tema'));
    if (name) void change(async () => { const item = await window.nodus.createStudyTopic({ subjectId, parentId: target?.kind === 'topic' ? target.id : null, name }); onTargetChange({ kind: 'topic', id: item.id }); });
  };
  const createFolder = () => {
    const name = window.prompt(t('Nombre de la carpeta'));
    if (name) void change(async () => { const item = await window.nodus.createStudyFolder({ name }); onTargetChange({ kind: 'folder', id: item.id }); });
  };
  const createDocument = () => {
    const title = window.prompt(t('Título del material'));
    if (!title) return;
    void change(async () => {
      const item = await window.nodus.createStudyDocument({ title, placement: placementForTarget() });
      setEditing(item); onTargetChange({ kind: 'document', id: item.id });
    });
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-5 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-400">{mode === 'library' ? t('Materiales de estudio') : t('Organización')}</p>
          <h1 className="truncate text-lg font-semibold text-neutral-100">{selectedTitle}</h1>
        </div>
        {mode === 'organization' && (
          <>
            <button className="btn btn-ghost" onClick={createCourse}><Icon name="plus" /> {t('Curso')}</button>
            <button className="btn btn-ghost" onClick={createSubject}><Icon name="plus" /> {t('Asignatura')}</button>
            <button className="btn btn-ghost" onClick={createTopic}><Icon name="plus" /> {t('Tema')}</button>
            <button className="btn btn-ghost" onClick={createFolder}><Icon name="folderPlus" /> {t('Carpeta')}</button>
          </>
        )}
        <button className="btn btn-primary" onClick={createDocument}><Icon name="plus" /> {t('Material')}</button>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex gap-2 border-b border-neutral-800 px-5 py-3">
            <label className="relative min-w-0 flex-1">
              <Icon name="search" size={14} className="absolute left-3 top-2.5 text-neutral-600" />
              <input className="input w-full pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar materiales…')} />
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
                onClick={() => { setEditing(document); onTargetChange({ kind: 'document', id: document.id }); }}
                className={`group rounded-xl border p-4 text-left transition-colors ${editing?.id === document.id ? 'border-indigo-600 bg-indigo-950/25' : 'border-neutral-800 bg-neutral-900/40 hover:border-indigo-800'}`}>
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

        {editing && (
          <aside className="flex w-[min(38vw,460px)] min-w-[320px] flex-col border-l border-neutral-800 bg-neutral-950/40">
            <div className="flex items-center gap-2 border-b border-neutral-800 p-3">
              <input className="input min-w-0 flex-1 font-semibold" value={editing.title}
                onChange={(event) => setEditing({ ...editing, title: event.target.value })} />
              <button className="btn btn-ghost px-2" title={t('Favorito')} onClick={() => setEditing({ ...editing, favorite: !editing.favorite })}>
                <Icon name="star" className={editing.favorite ? 'text-amber-400' : ''} />
              </button>
              <button className="btn btn-ghost px-2" title={t('Cerrar')} onClick={() => setEditing(null)}><Icon name="x" /></button>
            </div>
            <div className="flex gap-2 border-b border-neutral-800 p-3">
              <select className="input flex-1" value={editing.kind} onChange={(event) => setEditing({ ...editing, kind: event.target.value as StudyDocumentKind })}>
                {STUDY_DOCUMENT_KINDS.map((value) => <option key={value} value={value}>{t(KIND_LABEL[value])}</option>)}
              </select>
              <input type="color" className="h-9 w-10 rounded border border-neutral-700 bg-transparent p-1" value={editing.color || '#0f766e'}
                onChange={(event) => setEditing({ ...editing, color: event.target.value })} title={t('Color')} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5 border-b border-neutral-800 px-3 py-2">
              {workspace.documentTags.filter((link) => link.documentId === editing.id).map((link) => {
                const tag = workspace.tags.find((candidate) => candidate.id === link.tagId);
                return tag ? <span key={tag.id} className="rounded-full bg-indigo-900/40 px-2 py-1 text-[10px] text-indigo-300">{tag.name}</span> : null;
              })}
              <button className="rounded-full border border-dashed border-neutral-700 px-2 py-1 text-[10px] text-neutral-500 hover:border-indigo-700 hover:text-indigo-300"
                onClick={() => {
                  const name = window.prompt(t('Nueva etiqueta'));
                  if (!name) return;
                  void change(async () => {
                    const tag = await window.nodus.createStudyTag({ name });
                    const current = workspace.documentTags.filter((link) => link.documentId === editing.id).map((link) => link.tagId);
                    await window.nodus.setStudyDocumentTags(editing.id, [...current, tag.id]);
                  });
                }}>+ {t('Etiqueta')}</button>
            </div>
            <textarea className="min-h-0 flex-1 resize-none bg-transparent p-4 text-sm leading-6 text-neutral-300 outline-none"
              value={editing.contentMarkdown} onChange={(event) => setEditing({ ...editing, contentMarkdown: event.target.value })}
              placeholder={t('Escribe en Markdown…')} />
            <div className="flex items-center gap-2 border-t border-neutral-800 p-3">
              <button disabled={busy} className="btn btn-primary flex-1" onClick={() => void change(async () => {
                await window.nodus.updateStudyEntity('document', editing.id, {
                  title: editing.title, kind: editing.kind, contentMarkdown: editing.contentMarkdown,
                  color: editing.color, favorite: editing.favorite,
                });
              })}><Icon name="save" /> {busy ? t('Guardando…') : t('Guardar')}</button>
              <button className="btn btn-ghost" title={t('Duplicar')} onClick={() => void change(() => window.nodus.duplicateStudyTree('document', editing.id))}><Icon name="copy" /></button>
              <button className="btn btn-ghost text-red-400" title={t('Mover a la papelera')} onClick={() => void change(async () => {
                await window.nodus.setStudyLifecycle('document', editing.id, 'trash'); setEditing(null); onTargetChange(null);
              })}><Icon name="trash" /></button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
