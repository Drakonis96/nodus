// Workspace notes as they appear inside a study or teaching vault: in a course, subject,
// folder or topic, beside a material, and in the focus rail. The note itself lives in the
// Workspace; here it is listed, read, edited, unlinked or sent to the Workspace trash.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Note, StudyNoteLink, StudyNoteLinkFilter } from '@shared/types';
import { groupStudyNoteLinks, type StudyLinkedNoteSummary } from '@shared/studyNoteLinks';
import { normalizeSourceQuery } from '@shared/studySourceTree';
import { Icon, Spinner } from './ui';
import { ConfirmModal } from './ConfirmModal';
import { Markdown } from './Markdown';
import { StudyNoteLinkDialog, trapDialogKeys, useEscapeToClose } from './StudyNoteLinkDialog';
import { announceStudyWorkspaceChanged, STUDY_WORKSPACE_CHANGED } from './StudySidebar';
import { t, tx } from '../i18n';

export interface StudyLinkedNoteEntry {
  note: StudyLinkedNoteSummary;
  /** Every link that makes the note appear in the current place. */
  links: StudyNoteLink[];
}

/** Opens the note in the Workspace, whatever section is showing. */
export function openWorkspaceNote(id: string) {
  window.dispatchEvent(new CustomEvent('nodus:open-research-note', { detail: id }));
}

/** The notes linked to one place, kept current as anything in the vault changes. */
export function useStudyLinkedNotes(filter: StudyNoteLinkFilter | null) {
  const key = filter ? JSON.stringify(filter) : '';
  const [entries, setEntries] = useState<StudyLinkedNoteEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    if (!key) { setEntries([]); setLoaded(true); return; }
    try {
      const links = await window.nodus.listStudyNoteLinks(JSON.parse(key) as StudyNoteLinkFilter);
      setEntries(groupStudyNoteLinks(links));
    } catch { setEntries([]); }
    setLoaded(true);
  }, [key]);
  useEffect(() => {
    setLoaded(false);
    void reload();
    window.addEventListener(STUDY_WORKSPACE_CHANGED, reload);
    return () => window.removeEventListener(STUDY_WORKSPACE_CHANGED, reload);
  }, [reload]);
  return { entries, loaded, reload };
}

export async function unlinkStudyNote(entry: StudyLinkedNoteEntry) {
  await window.nodus.removeStudyNoteLinks(entry.links.map((link) => link.id));
  announceStudyWorkspaceChanged();
}

/** «Move to the trash» for a linked note, with the confirmation the action deserves. */
export function StudyLinkedNoteTrashConfirm({ note, onCancel, onTrashed }: { note: Pick<StudyLinkedNoteSummary, 'id' | 'title'>; onCancel: () => void; onTrashed?: () => void }) {
  return <ConfirmModal
    zIndex={150}
    title={t('Mover la nota a la papelera')}
    message={<>
      <p>{tx('«{name}» se moverá a la papelera del espacio de trabajo y dejará de aparecer en todos los sitios vinculados.', { name: note.title || t('Sin título') })}</p>
      <p className="mt-2 text-xs text-neutral-500">{t('Puedes restaurarla desde la papelera del espacio de trabajo; sus vínculos vuelven con ella.')}</p>
    </>}
    confirmLabel={t('Mover a la papelera')}
    danger
    onCancel={onCancel}
    onConfirm={() => {
      void window.nodus.trashNotes([note.id]).then(() => {
        announceStudyWorkspaceChanged();
        onTrashed?.();
      });
    }}
  />;
}

const formatDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

function LinkedNoteBadge() {
  return <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-indigo-600/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-indigo-300"><Icon name="link" size={9} />{t('Vinculada')}</span>;
}

function LinkedNoteVisual({ large = false }: { large?: boolean }) {
  return <span className={`grid shrink-0 place-items-center rounded-lg bg-indigo-600/15 text-indigo-300 ${large ? 'h-12 w-12' : 'h-8 w-8'}`}><Icon name="notebook" size={large ? 20 : 15} /></span>;
}

type EntryActions = {
  onOpen: (entry: StudyLinkedNoteEntry) => void;
  onManage: (entry: StudyLinkedNoteEntry) => void;
  onUnlink: (entry: StudyLinkedNoteEntry) => void;
  onTrash: (entry: StudyLinkedNoteEntry) => void;
};

function EntryButtons({ entry, onManage, onUnlink, onTrash }: Omit<EntryActions, 'onOpen'> & { entry: StudyLinkedNoteEntry }) {
  const name = entry.note.title || t('Sin título');
  return <>
    <button className="btn btn-ghost h-7 px-2" title={t('Abrir en el espacio de trabajo')} aria-label={tx('Abrir {name} en el espacio de trabajo', { name })} onClick={(event) => { event.stopPropagation(); openWorkspaceNote(entry.note.id); }}><Icon name="external" size={12} /></button>
    <button className="btn btn-ghost h-7 px-2" data-testid={`study-linked-note-manage-${entry.note.id}`} title={t('Gestionar vínculos')} aria-label={tx('Gestionar los vínculos de {name}', { name })} onClick={(event) => { event.stopPropagation(); onManage(entry); }}><Icon name="link" size={12} /></button>
    <button className="btn btn-ghost h-7 px-2" data-testid={`study-linked-note-unlink-${entry.note.id}`} title={t('Quitar de esta sección')} aria-label={tx('Quitar {name} de esta sección', { name })} onClick={(event) => { event.stopPropagation(); onUnlink(entry); }}><Icon name="x" size={12} /></button>
    <button className="btn btn-ghost h-7 px-2 text-red-400" data-testid={`study-linked-note-trash-${entry.note.id}`} title={t('Mover a la papelera')} aria-label={tx('Mover {name} a la papelera', { name })} onClick={(event) => { event.stopPropagation(); onTrash(entry); }}><Icon name="trash" size={12} /></button>
  </>;
}

/** Linked notes in the list or grid of a course, subject, folder or topic. */
export function StudyLinkedNotesCollection({ entries, layout, ...actions }: EntryActions & { entries: StudyLinkedNoteEntry[]; layout: 'grid' | 'list' }) {
  if (layout === 'list') {
    return <div className="mt-3 overflow-x-auto rounded-xl border border-neutral-800"><table className="w-full min-w-[720px] border-collapse text-xs" data-testid="study-linked-notes-list">
      <thead className="study-browser-table-head text-left"><tr><th className="px-4 py-2 font-medium">{t('Nombre')}</th><th className="w-40 px-3 py-2 font-medium">{t('Tipo')}</th><th className="w-32 px-3 py-2 font-medium">{t('Modificado')}</th><th className="w-40 px-3 py-2 text-center font-medium">{t('Acciones')}</th></tr></thead>
      <tbody>{entries.map((entry) => <tr key={entry.note.id} data-testid={`study-linked-note-${entry.note.id}`} className="border-t border-neutral-800/70 hover:bg-neutral-900/40">
        <td className="px-4 py-2.5"><button data-testid={`study-linked-note-open-${entry.note.id}`} className="flex min-w-0 items-center gap-2 text-left" onClick={() => actions.onOpen(entry)}><LinkedNoteVisual /><span className="min-w-0"><span className="flex min-w-0 items-center gap-1.5"><span className="truncate font-medium text-neutral-200">{entry.note.title || t('Sin título')}</span><LinkedNoteBadge /></span><span className="block max-w-[420px] truncate text-[10px] text-neutral-600">{entry.note.excerpt || t('Sin contenido')}</span></span></button></td>
        <td className="px-3 py-2.5 text-neutral-500">{t('Nota del espacio de trabajo')}</td>
        <td className="px-3 py-2.5 text-neutral-500">{formatDate(entry.note.updatedAt)}</td>
        <td className="px-3 py-2.5"><div className="flex justify-center gap-0.5"><EntryButtons entry={entry} {...actions} /></div></td>
      </tr>)}</tbody>
    </table></div>;
  }
  return <div className="mt-3 grid content-start gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="study-linked-notes-grid">{entries.map((entry) => <article key={entry.note.id} data-testid={`study-linked-note-${entry.note.id}`} className="group rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 transition-colors hover:border-indigo-800">
    <button data-testid={`study-linked-note-open-${entry.note.id}`} className="block w-full text-left" onClick={() => actions.onOpen(entry)}>
      <span className="mb-3 flex items-start justify-between gap-2"><LinkedNoteVisual large /><LinkedNoteBadge /></span>
      <span className="block truncate text-sm font-semibold text-neutral-200">{entry.note.title || t('Sin título')}</span>
      <span className="mt-1 block text-[10px] uppercase tracking-wider text-neutral-600">{t('Nota del espacio de trabajo')}</span>
      <span className="mt-3 line-clamp-3 block text-xs leading-5 text-neutral-500">{entry.note.excerpt || t('Sin contenido')}</span>
    </button>
    <span className="mt-3 flex justify-end gap-0.5 border-t border-neutral-800/70 pt-2"><EntryButtons entry={entry} {...actions} /></span>
  </article>)}</div>;
}

/**
 * The reverse direction: from a place, pick Workspace notes to link here. Notes already
 * linked to the place are shown as such rather than hidden, so the list reads as the
 * whole Workspace.
 */
export function StudyNotePickerDialog({ target, targetLabel, linkedNoteIds, onClose, onLinked }: {
  target: { courseId?: string; subjectId?: string; folderId?: string; topicId?: string } | { materialId: string };
  targetLabel: string;
  linkedNoteIds: ReadonlySet<string>;
  onClose: () => void;
  onLinked?: () => void;
}) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEscapeToClose(onClose, busy);
  useEffect(() => {
    let alive = true;
    void window.nodus.getNotesTree(false).then((tree) => { if (alive) setNotes(tree.notes.filter((note) => !note.trashedAt)); });
    const previous = document.activeElement;
    return () => { alive = false; if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { if (notes) dialog.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(); }, [notes]);
  const needle = normalizeSourceQuery(query);
  const visible = useMemo(() => (notes ?? [])
    .filter((note) => !needle || normalizeSourceQuery(`${note.title} ${note.content.slice(0, 2000)} ${note.tags.join(' ')}`).includes(needle))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 100), [notes, needle]);
  const submit = async () => {
    if (!selected.size || busy) return;
    setBusy(true); setError('');
    try {
      for (const noteId of selected) await window.nodus.addStudyNoteLink({ noteId, ...target });
      announceStudyWorkspaceChanged();
      onLinked?.();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('No se pudo guardar.'));
      setBusy(false);
    }
  };
  return createPortal(<div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-6" onClick={() => { if (!busy) onClose(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="study-note-picker-dialog" className="card-modal flex max-h-[85vh] w-full max-w-lg flex-col gap-3 p-5" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => trapDialogKeys(event, dialog.current)}>
      <div><h2 id={titleId} className="font-semibold">{t('Vincular notas del espacio de trabajo')}</h2><p className="mt-1 truncate text-sm text-neutral-500" title={targetLabel}>{targetLabel}</p></div>
      <span className="relative block"><Icon name="search" size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" /><input data-autofocus data-testid="study-note-picker-search" className="input input-with-leading-icon w-full" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar en notas e ideas…')} aria-label={t('Buscar en notas e ideas…')} /></span>
      <ul className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-neutral-300 dark:border-neutral-800" data-testid="study-note-picker-list">
        {!notes && <li className="px-3 py-4 text-xs text-neutral-500"><Spinner /> {t('Cargando…')}</li>}
        {notes && visible.length === 0 && <li className="px-3 py-4 text-xs text-neutral-500">{t(notes.length ? 'Ningún elemento coincide.' : 'El espacio de trabajo aún no tiene notas.')}</li>}
        {visible.map((note) => {
          const linked = linkedNoteIds.has(note.id);
          return <li key={note.id} className="border-b border-neutral-200 last:border-b-0 dark:border-neutral-800/70">
            <label className={`flex items-center gap-2.5 px-3 py-2 text-xs ${linked ? 'opacity-60' : 'cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900/60'}`}>
              <input type="checkbox" data-testid={`study-note-picker-${note.id}`} disabled={linked || busy} checked={linked || selected.has(note.id)} onChange={(event) => setSelected((current) => {
                const next = new Set(current);
                if (event.target.checked) next.add(note.id); else next.delete(note.id);
                return next;
              })} />
              <Icon name={note.kind === 'idea' ? 'bulb' : 'notebook'} size={13} className={`shrink-0 ${note.kind === 'idea' ? 'text-amber-400' : 'text-neutral-500'}`} />
              <span className="min-w-0 flex-1"><span className="block truncate text-neutral-800 dark:text-neutral-200">{note.title || t('Sin título')}</span><span className="block truncate text-[10px] text-neutral-500">{linked ? t('Ya vinculada aquí') : note.content.replace(/\s+/g, ' ').slice(0, 140) || t('Sin contenido')}</span></span>
            </label>
          </li>;
        })}
      </ul>
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('Cancelar')}</button>
        <button type="button" data-testid="study-note-picker-submit" className="btn btn-primary" disabled={busy || !selected.size} onClick={() => void submit()}><Icon name="link" size={13} />{selected.size ? tx('Vincular ({n})', { n: selected.size }) : t('Vincular')}</button>
      </div>
    </div>
  </div>, document.body);
}

/**
 * The notes beside a material while it is being read: a list, the selected note rendered
 * in place, and the same actions as in a subject. Editing happens in the Workspace, where
 * the full editor lives, so reading here never competes with the material for space.
 */
export function StudyLinkedNotesPanel({ materialId, materialTitle, onClose }: { materialId: string; materialTitle: string; onClose: () => void }) {
  const filter = useMemo(() => ({ materialId }), [materialId]);
  const { entries, loaded } = useStudyLinkedNotes(filter);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<Note | null>(null);
  const [picking, setPicking] = useState(false);
  const [managing, setManaging] = useState<StudyLinkedNoteSummary | null>(null);
  const [trashing, setTrashing] = useState<StudyLinkedNoteSummary | null>(null);
  useEffect(() => {
    if (!openId) { setOpenNote(null); return; }
    let alive = true;
    void window.nodus.getNote(openId).then((note) => { if (alive) setOpenNote(note); });
    return () => { alive = false; };
  }, [openId, entries]);
  useEffect(() => { if (openId && loaded && !entries.some((entry) => entry.note.id === openId)) setOpenId(null); }, [entries, loaded, openId]);

  return <aside data-testid="study-material-linked-notes" className="flex w-80 shrink-0 flex-col border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950" aria-label={t('Notas vinculadas')}>
    <header className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2.5 dark:border-neutral-800">
      <Icon name="notebook" size={14} className="text-indigo-300" />
      <h3 className="min-w-0 flex-1 truncate whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-neutral-500" title={t('Notas vinculadas')}>{t('Notas vinculadas')}</h3>
      <button className="btn btn-ghost h-7 px-2 text-xs" data-testid="study-material-link-note" onClick={() => setPicking(true)}><Icon name="plus" size={12} />{t('Vincular nota')}</button>
      <button className="btn btn-ghost h-7 w-7 p-0" title={t('Cerrar')} aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" size={13} /></button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto">
      {!loaded && <p className="px-3 py-4 text-xs text-neutral-500"><Spinner /> {t('Cargando…')}</p>}
      {loaded && entries.length === 0 && <p className="px-3 py-6 text-xs leading-5 text-neutral-500">{t('Ninguna nota del espacio de trabajo está vinculada a este material. Vincula una aquí o desde el propio espacio de trabajo.')}</p>}
      <ul>{entries.map((entry) => {
        const open = entry.note.id === openId;
        const name = entry.note.title || t('Sin título');
        return <li key={entry.note.id} data-testid={`study-material-linked-note-${entry.note.id}`} className="border-b border-neutral-200 dark:border-neutral-800/70">
          <button className={`flex w-full items-start gap-2 px-3 py-2.5 text-left ${open ? 'bg-indigo-600/10' : 'hover:bg-neutral-100 dark:hover:bg-neutral-900/60'}`} aria-expanded={open} onClick={() => setOpenId(open ? null : entry.note.id)}>
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} className="mt-0.5 shrink-0 text-neutral-500" />
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-neutral-800 dark:text-neutral-200">{name}</span><span className="mt-0.5 line-clamp-2 block text-[10px] leading-4 text-neutral-500">{entry.note.excerpt || t('Sin contenido')}</span></span>
          </button>
          {open && <div className="px-3 pb-3">
            <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-900/40">
              {openNote?.id === entry.note.id ? <Markdown content={openNote.content || t('Sin contenido')} verify={false} className="text-xs" /> : <Spinner />}
            </div>
            <div className="mt-2 flex flex-wrap justify-end gap-1">
              <button className="btn btn-ghost h-7 px-2 text-xs" data-testid={`study-material-linked-note-edit-${entry.note.id}`} onClick={() => openWorkspaceNote(entry.note.id)}><Icon name="edit" size={12} />{t('Editar')}</button>
              <button className="btn btn-ghost h-7 px-2" title={t('Gestionar vínculos')} aria-label={tx('Gestionar los vínculos de {name}', { name })} onClick={() => setManaging(entry.note)}><Icon name="link" size={12} /></button>
              <button className="btn btn-ghost h-7 px-2" data-testid={`study-material-linked-note-unlink-${entry.note.id}`} title={t('Quitar de este material')} aria-label={tx('Quitar {name} de este material', { name })} onClick={() => void unlinkStudyNote(entry)}><Icon name="x" size={12} /></button>
              <button className="btn btn-ghost h-7 px-2 text-red-400" data-testid={`study-material-linked-note-trash-${entry.note.id}`} title={t('Mover a la papelera')} aria-label={tx('Mover {name} a la papelera', { name })} onClick={() => setTrashing(entry.note)}><Icon name="trash" size={12} /></button>
            </div>
          </div>}
        </li>;
      })}</ul>
    </div>
    {picking && <StudyNotePickerDialog target={{ materialId }} targetLabel={materialTitle} linkedNoteIds={new Set(entries.map((entry) => entry.note.id))} onClose={() => setPicking(false)} />}
    {managing && <StudyNoteLinkDialog noteId={managing.id} noteTitle={managing.title} onClose={() => setManaging(null)} />}
    {trashing && <StudyLinkedNoteTrashConfirm note={trashing} onCancel={() => setTrashing(null)} onTrashed={() => setTrashing(null)} />}
  </aside>;
}
