import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { StudyMaterialSummary, StudyNoteLink, StudyWorkspace } from '@shared/types';
import { normalizeSourceQuery, studyOrganizationPaths } from '@shared/studySourceTree';
import { studyNoteLinkLabel } from '@shared/studyNoteLinks';
import { Icon, Spinner } from './ui';
import { announceStudyWorkspaceChanged } from './StudySidebar';
import { t, tx } from '../i18n';

/** Tab stays inside the dialog, as in the move dialog. */
export function trapDialogKeys(event: KeyboardEvent<HTMLElement>, container: HTMLElement | null) {
  if (event.key !== 'Tab') return;
  const elements = [...(container?.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)') ?? [])];
  const first = elements[0]; const last = elements.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}

/**
 * Escape closes from anywhere, not only from inside the dialog: a button that turns
 * disabled after a click (a material once linked) drops the focus to the page.
 */
export function useEscapeToClose(onClose: () => void, busy: boolean) {
  const latest = useRef({ onClose, busy });
  latest.current = { onClose, busy };
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || latest.current.busy) return;
      event.preventDefault();
      latest.current.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : t('No se pudo guardar.'));

/**
 * Links one Workspace note to places of the study or teaching vault: any number of
 * courses, subjects, folders or topics, and specific materials. The note is not copied;
 * each link only makes it appear there too.
 */
export function StudyNoteLinkDialog({ noteId, noteTitle, onClose, onChanged }: {
  noteId: string;
  noteTitle: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [materials, setMaterials] = useState<StudyMaterialSummary[]>([]);
  const [links, setLinks] = useState<StudyNoteLink[]>([]);
  const [mode, setMode] = useState<'location' | 'material'>('location');
  const [courseId, setCourseId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [folderId, setFolderId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEscapeToClose(onClose, busy);

  const reloadLinks = async () => setLinks(await window.nodus.listStudyNoteLinks({ noteId }));
  useEffect(() => {
    let alive = true;
    void Promise.all([window.nodus.getStudyWorkspace(), window.nodus.listStudyMaterials(), window.nodus.listStudyNoteLinks({ noteId })])
      .then(([nextWorkspace, nextMaterials, nextLinks]) => {
        if (!alive) return;
        setWorkspace(nextWorkspace); setMaterials(nextMaterials); setLinks(nextLinks);
      })
      .catch((reason: unknown) => { if (alive) setError(errorText(reason)); });
    return () => { alive = false; };
  }, [noteId]);
  useEffect(() => {
    const previous = document.activeElement;
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { if (workspace) dialog.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(); }, [workspace, mode]);

  const paths = useMemo(() => (workspace ? studyOrganizationPaths(workspace) : null), [workspace]);
  const subjects = workspace?.subjects.filter((subject) => !courseId || subject.courseId === courseId) ?? [];
  const folders = workspace?.folders.filter((folder) => (folder.subjectId ?? '') === subjectId && (!courseId || folder.courseId === courseId)) ?? [];
  const topics = workspace?.topics.filter((topic) => topic.subjectId === subjectId && (topic.folderId ?? '') === folderId) ?? [];
  const linkedMaterialIds = new Set(links.map((link) => link.materialId).filter(Boolean));
  const needle = normalizeSourceQuery(query);
  const visibleMaterials = materials
    .filter((material) => !needle || normalizeSourceQuery(`${material.title} ${material.fileName}`).includes(needle))
    .slice(0, 60);
  const materialPath = (material: StudyMaterialSummary) => {
    const placement = material.placements.find((candidate) => !candidate.deletedAt && !candidate.archivedAt);
    return placement && paths ? paths.label(placement) : '';
  };
  const hasLocation = Boolean(courseId || subjectId || folderId || topicId);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try {
      await action();
      await reloadLinks();
      announceStudyWorkspaceChanged();
      onChanged?.();
    } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  };
  const linkLocation = () => run(async () => {
    await window.nodus.addStudyNoteLink({ noteId, courseId: courseId || null, subjectId: subjectId || null, folderId: folderId || null, topicId: topicId || null });
    setFolderId(''); setTopicId('');
  });
  const linkMaterial = (materialId: string) => run(() => window.nodus.addStudyNoteLink({ noteId, materialId }));
  const unlink = (id: string) => run(() => window.nodus.removeStudyNoteLinks([id]));

  return createPortal(<div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-6" onClick={() => { if (!busy) onClose(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="study-note-link-dialog" className="card-modal flex max-h-[85vh] w-full max-w-lg flex-col gap-4 p-5" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => trapDialogKeys(event, dialog.current)}>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-600/15 text-indigo-300"><Icon name="link" /></span>
        <div className="min-w-0">
          <h2 id={titleId} className="font-semibold">{t('Vincular con cursos y materiales')}</h2>
          <p className="mt-1 truncate text-sm text-neutral-500" title={noteTitle}>{noteTitle}</p>
        </div>
      </div>
      <p className="text-xs leading-5 text-neutral-500">{t('La nota se queda en el espacio de trabajo y aparece también en cada sitio vinculado. No se copia.')}</p>

      {!workspace ? <div className="grid place-items-center py-8"><Spinner label={t('Cargando…')} /></div> : <>
        <section aria-label={t('Vinculada en')}>
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{t('Vinculada en')}</h3>
          {links.length === 0
            ? <p className="mt-1 text-xs text-neutral-500">{t('Todavía no está vinculada a ningún sitio.')}</p>
            : <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="study-note-link-current">
              {links.map((link) => {
                const label = studyNoteLinkLabel(link, workspace) || t('Sin ubicación');
                return <li key={link.id} className="flex max-w-full items-center gap-1 rounded-full border border-neutral-300 bg-neutral-100 py-0.5 pl-2 pr-0.5 text-[11px] text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                  <Icon name={link.materialId ? 'book' : 'graduation'} size={11} className="shrink-0 text-neutral-500" />
                  <span className="min-w-0 truncate" title={label}>{label}</span>
                  <button type="button" disabled={busy} className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-neutral-500 hover:text-red-400" title={t('Quitar vínculo')} aria-label={tx('Quitar el vínculo con {name}', { name: label })} onClick={() => void unlink(link.id)}><Icon name="x" size={10} /></button>
                </li>;
              })}
            </ul>}
        </section>

        <div role="tablist" aria-label={t('Tipo de vínculo')} className="flex rounded-lg border border-neutral-300 p-0.5 dark:border-neutral-800">
          {(['location', 'material'] as const).map((item) => (
            <button key={item} type="button" role="tab" aria-selected={mode === item} data-testid={`study-note-link-mode-${item}`} className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs ${mode === item ? 'bg-indigo-600/20 text-indigo-300' : 'text-neutral-500 hover:text-neutral-300'}`} onClick={() => { setMode(item); setError(''); }}>
              <Icon name={item === 'location' ? 'graduation' : 'book'} size={13} />{t(item === 'location' ? 'Curso, asignatura o tema' : 'Material')}
            </button>
          ))}
        </div>

        {mode === 'location' ? <fieldset disabled={busy} className="space-y-3">
          <label className="block text-xs">{t('Curso')}<select data-autofocus data-testid="study-note-link-course" aria-label={t('Curso')} className="input mt-1 w-full" value={courseId} onChange={(event) => { setCourseId(event.target.value); setSubjectId(''); setFolderId(''); setTopicId(''); }}><option value="">{t('Sin curso')}</option>{workspace.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
          <label className="block text-xs">{t('Asignatura')}<select data-testid="study-note-link-subject" aria-label={t('Asignatura')} className="input mt-1 w-full" value={subjectId} onChange={(event) => {
            const subject = workspace.subjects.find((item) => item.id === event.target.value);
            setSubjectId(subject?.id ?? ''); if (subject) setCourseId(subject.courseId); setFolderId(''); setTopicId('');
          }}><option value="">{t('Sin asignatura')}</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
          <label className="block text-xs">{t('Carpeta (opcional)')}<select data-testid="study-note-link-folder" aria-label={t('Carpeta (opcional)')} className="input mt-1 w-full" value={folderId} onChange={(event) => {
            const folder = workspace.folders.find((item) => item.id === event.target.value);
            setFolderId(folder?.id ?? ''); if (folder?.courseId) setCourseId(folder.courseId); setTopicId('');
          }}><option value="">{t('Sin carpeta')}</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{paths?.label({ courseId: folder.courseId, subjectId: folder.subjectId, folderId: folder.id, topicId: null })}</option>)}</select></label>
          <label className="block text-xs">{t('Tema (opcional)')}<select data-testid="study-note-link-topic" aria-label={t('Tema (opcional)')} className="input mt-1 w-full" value={topicId} disabled={!subjectId} onChange={(event) => setTopicId(event.target.value)}><option value="">{t('Sin tema')}</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{paths?.label({ courseId: courseId || null, subjectId, folderId: folderId || null, topicId: topic.id })}</option>)}</select></label>
          <div className="flex justify-end"><button type="button" data-testid="study-note-link-add" className="btn btn-primary" disabled={!hasLocation} onClick={() => void linkLocation()}><Icon name="link" size={13} />{t('Vincular aquí')}</button></div>
        </fieldset> : <div className="flex min-h-0 flex-col gap-2">
          <span className="relative block"><Icon name="search" size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" /><input data-autofocus data-testid="study-note-link-material-search" className="input input-with-leading-icon w-full" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar material…')} aria-label={t('Buscar material…')} /></span>
          <ul className="min-h-0 max-h-64 overflow-y-auto rounded-lg border border-neutral-300 dark:border-neutral-800" data-testid="study-note-link-materials">
            {visibleMaterials.length === 0 && <li className="px-3 py-4 text-xs text-neutral-500">{t(materials.length ? 'Ningún material coincide.' : 'Aún no hay materiales.')}</li>}
            {visibleMaterials.map((material) => {
              const linked = linkedMaterialIds.has(material.id);
              return <li key={material.id} className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 text-xs last:border-b-0 dark:border-neutral-800/70">
                <Icon name="book" size={13} className="shrink-0 text-teal-400" />
                <span className="min-w-0 flex-1"><span className="block truncate text-neutral-800 dark:text-neutral-200">{material.title || material.fileName}</span><span className="block truncate text-[10px] text-neutral-500">{materialPath(material) || t('Sin ubicación')}</span></span>
                <button type="button" data-testid={`study-note-link-material-${material.id}`} disabled={busy || linked} className="btn btn-ghost h-7 shrink-0 px-2 text-xs" onClick={() => void linkMaterial(material.id)}>{linked ? <><Icon name="check" size={12} />{t('Vinculado')}</> : <><Icon name="link" size={12} />{t('Vincular')}</>}</button>
              </li>;
            })}
          </ul>
        </div>}
      </>}
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end"><button type="button" data-testid="study-note-link-done" className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('Listo')}</button></div>
    </div>
  </div>, document.body);
}
