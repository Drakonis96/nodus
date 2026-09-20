import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StudyMaterialSummary, StudyPlacementInput, StudyWorkspace } from '@shared/types';
import { studyOrganizationPaths } from '@shared/studySourceTree';
import { announceStudyWorkspaceChanged } from './StudySidebar';
import { t } from '../i18n';

export function StudyMaterialMoveDialog({ material, workspace, onMoved, onCancel }: {
  material: StudyMaterialSummary; workspace: StudyWorkspace; onMoved: () => void; onCancel: () => void;
}) {
  const paths = studyOrganizationPaths(workspace);
  const placements = material.placements.filter((p) => !p.archivedAt && !p.deletedAt);
  const [originId, setOriginId] = useState(placements[0]?.id ?? '');
  const [destination, setDestination] = useState<StudyPlacementInput>(paths.resolve(placements[0] ?? { courseId: null, subjectId: null, folderId: null, topicId: null }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    form.current?.querySelector<HTMLElement>('select')?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const courseId = destination.courseId ?? '';
  const subjectId = destination.subjectId ?? '';
  const folderId = destination.folderId ?? '';
  const subjects = workspace.subjects.filter((s) => !courseId || s.courseId === courseId);
  const folders = workspace.folders.filter((f) => (f.subjectId ?? '') === subjectId && (!courseId || f.courseId === courseId));
  const topics = workspace.topics.filter((topic) => topic.subjectId === subjectId && (topic.folderId ?? '') === folderId);
  return createPortal(<div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-6" onClick={() => { if (!busy) onCancel(); }}>
    <form ref={form} role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="study-material-move-dialog" className="card-modal w-full max-w-lg space-y-4 p-5" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onCancel(); }
      if (event.key === 'Tab') {
        const elements = [...(form.current?.querySelectorAll<HTMLElement>('select:not(:disabled), button:not(:disabled)') ?? [])];
        const first = elements[0]; const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }} onSubmit={(event) => {
      event.preventDefault(); if (busy) return; setBusy(true); setError('');
      void window.nodus.moveStudyMaterialPlacement(material.id, originId || null, destination).then(() => {
        announceStudyWorkspaceChanged(); onMoved();
      }).catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : t('No se pudo guardar.')); setBusy(false); });
    }}>
      <div><h2 id={titleId} className="font-semibold">{t('Mover material…')}</h2><p className="mt-1 truncate text-sm text-neutral-500" title={material.title}>{material.title}</p></div>
      <fieldset disabled={busy} className="space-y-3">
        <label className="block text-xs">{t('Ubicación de origen')}<select aria-label={t('Ubicación de origen')} className="input mt-1 w-full" value={originId} onChange={(event) => {
          const id = event.target.value; setOriginId(id);
          const placement = placements.find((p) => p.id === id); if (placement) setDestination(paths.resolve(placement));
        }}>{placements.length ? placements.map((p) => <option key={p.id} value={p.id}>{paths.label(p) || t('Sin ubicación')}</option>) : <option value="">{t('Sin ubicación')}</option>}</select></label>
        <p className="text-xs text-neutral-500">{t('Se conservarán las demás ubicaciones y los datos del material.')}</p>
        <label className="block text-xs">{t('Curso')}<select aria-label={t('Curso')} className="input mt-1 w-full" value={courseId} onChange={(event) => setDestination({ courseId: event.target.value || null, subjectId: null, folderId: null, topicId: null })}><option value="">{t('Sin curso')}</option>{workspace.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="block text-xs">{t('Asignatura')}<select aria-label={t('Asignatura')} className="input mt-1 w-full" value={subjectId} onChange={(event) => {
          const subject = workspace.subjects.find((s) => s.id === event.target.value);
          setDestination({ courseId: subject?.courseId ?? (courseId || null), subjectId: subject?.id ?? null, folderId: null, topicId: null });
        }}><option value="">{t('Sin asignatura')}</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="block text-xs">{t('Carpeta (opcional)')}<select aria-label={t('Carpeta (opcional)')} className="input mt-1 w-full" value={folderId} onChange={(event) => {
          const folder = workspace.folders.find((f) => f.id === event.target.value);
          setDestination({ ...destination, ...(folder ? { courseId: folder.courseId, subjectId: folder.subjectId } : {}), folderId: folder?.id ?? null, topicId: null });
        }}><option value="">{t('Sin carpeta')}</option>{folders.map((f) => <option key={f.id} value={f.id}>{paths.label({ courseId: f.courseId, subjectId: f.subjectId, folderId: f.id, topicId: null })}</option>)}</select></label>
        <label className="block text-xs">{t('Tema (opcional)')}<select aria-label={t('Tema (opcional)')} className="input mt-1 w-full" value={destination.topicId ?? ''} onChange={(event) => setDestination({ ...destination, topicId: event.target.value || null })}><option value="">{t('Sin tema')}</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></label>
      </fieldset>
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" disabled={busy} className="btn btn-ghost" onClick={onCancel}>{t('Cancelar')}</button><button disabled={busy} className="btn btn-primary">{t(busy ? 'Guardando…' : 'Mover')}</button></div>
    </form>
  </div>, document.body);
}
