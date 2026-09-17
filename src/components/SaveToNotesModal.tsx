import { useEffect, useMemo, useState } from 'react';
import type { Note, NoteFolder, NoteKind, NoteSource, Project, StudyDocument, StudyPlacementInput, StudyWorkspace } from '@shared/types';
import { Icon } from './ui';
import { flattenFolders } from '../notesTree';
import { t } from '../i18n';
import { buildStudyNoteDocument } from '../studyNoteFromChat';
import { announceStudyWorkspaceChanged } from './StudySidebar';

/**
 * A second destination for the vaults that keep their own notes. The study and
 * teaching vaults show `study_docs` under "Apuntes y materiales", a different store
 * from the workspace notes this dialog writes by default, so an answer captured in
 * those vaults has to be filed where the vault actually lists it.
 */
export interface StudyNoteDestination {
  /** Placement the dialog opens with; the user can change it before saving. */
  defaultPlacement?: StudyPlacementInput | null;
  /** Opens the saved note in the vault that owns it. */
  onOpenSavedDocument?: (documentId: string) => void;
}

/**
 * Reusable "save this content to my notes" dialog. The content is Markdown that may
 * contain `nodus://` citations; those stay clickable once the saved note is opened
 * in the Notes view (same Markdown renderer + source modal). Callers pass the raw
 * Markdown, a default title and the note kind so provenance is preserved.
 */
export function SaveToNotesModal({
  content,
  defaultTitle,
  kind,
  source,
  destinationLabel = 'Notas',
  allowProjectLink = false,
  studyDocument = null,
  onClose,
  onSaved,
  onOpenSavedNote,
}: {
  content: string;
  defaultTitle: string;
  kind: NoteKind;
  source?: NoteSource | null;
  /** User-facing name of the section where this vault exposes saved notes. */
  destinationLabel?: string;
  /** When true, also offer to link the saved note to a project. */
  allowProjectLink?: boolean;
  /** When set, the vault's own notes are offered as a second destination. */
  studyDocument?: StudyNoteDestination | null;
  onClose: () => void;
  onSaved?: (note: Note) => void;
  onOpenSavedNote?: (note: Note) => void;
}) {
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [title, setTitle] = useState(defaultTitle.trim() || t('Nota sin título'));
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [destination, setDestination] = useState<'note' | 'study'>('note');
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [courseId, setCourseId] = useState(studyDocument?.defaultPlacement?.courseId ?? '');
  const [subjectId, setSubjectId] = useState(studyDocument?.defaultPlacement?.subjectId ?? '');
  const [studyFolderId, setStudyFolderId] = useState(studyDocument?.defaultPlacement?.folderId ?? '');
  const [topicId, setTopicId] = useState(studyDocument?.defaultPlacement?.topicId ?? '');
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<Note | null>(null);
  const [savedDocument, setSavedDocument] = useState<StudyDocument | null>(null);
  const [linkWarning, setLinkWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Whether this vault offers its own note store as a destination. */
  const studyEnabled = Boolean(studyDocument);

  useEffect(() => {
    let on = true;
    void window.nodus.getNotesTree().then((tree) => {
      if (on) setFolders(tree.folders);
    });
    if (allowProjectLink) {
      void window.nodus.listProjects().then((list) => {
        if (on) setProjects(list);
      });
    }
    return () => {
      on = false;
    };
  }, [allowProjectLink]);

  useEffect(() => {
    // The destination arrives as a fresh object on every render of the chat, so the
    // effect keys on whether it is there at all and reads the callback at render time.
    if (!studyEnabled) return;
    let on = true;
    void window.nodus.getStudyWorkspace().then((next) => {
      if (!on) return;
      setWorkspace(next);
      // A single course is the common case; opening on it keeps the subject list
      // visible instead of asking for a choice that has only one answer.
      setCourseId((current) => current || next.courses[0]?.id || '');
    });
    return () => {
      on = false;
    };
  }, [studyEnabled]);

  const flat = useMemo(() => flattenFolders(folders), [folders]);
  const destinationPath = useMemo(() => {
    if (!folderId) return `${t(destinationLabel)} › ${t('Sin carpeta (raíz)')}`;
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const names: string[] = [];
    const visited = new Set<string>();
    let current = byId.get(folderId);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      names.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return [t(destinationLabel), ...names].join(' › ');
  }, [destinationLabel, folderId, folders]);

  const studySubjects = useMemo(
    () => workspace?.subjects.filter((subject) => subject.courseId === courseId) ?? [],
    [workspace, courseId],
  );
  const studyFolders = useMemo(
    () => workspace?.folders.filter((folder) => folder.subjectId === subjectId) ?? [],
    [workspace, subjectId],
  );
  const studyTopics = useMemo(
    () => workspace?.topics.filter((topic) => topic.subjectId === subjectId && (studyFolderId ? topic.folderId === studyFolderId : !topic.folderId)) ?? [],
    [workspace, subjectId, studyFolderId],
  );
  const studyPath = useMemo(() => {
    const names = [
      workspace?.courses.find((course) => course.id === courseId)?.name,
      workspace?.subjects.find((subject) => subject.id === subjectId)?.name,
      workspace?.folders.find((folder) => folder.id === studyFolderId)?.name,
      workspace?.topics.find((topic) => topic.id === topicId)?.name,
    ].filter((name): name is string => Boolean(name));
    return [t('Apuntes'), ...names].join(' › ');
  }, [workspace, courseId, subjectId, studyFolderId, topicId]);

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setCreatingFolder(true);
    setError(null);
    try {
      const created = await window.nodus.createNoteFolder({ name, parentId: folderId });
      setFolders((current) => [...current, created]);
      setFolderId(created.id);
      setNewFolderName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingFolder(false);
    }
  };

  const save = async () => {
    if (saving || !content.trim()) return;
    if (destination === 'study' && !subjectId) return;
    setSaving(true);
    setError(null);
    try {
      if (destination === 'study') {
        const document = await window.nodus.createStudyDocument(buildStudyNoteDocument({
          title,
          content,
          source,
          placement: { courseId: courseId || null, subjectId, folderId: studyFolderId || null, topicId: topicId || null },
        }));
        // The vault lists notes from its own workspace snapshot, so it has to hear
        // about the new one before the dialog closes.
        announceStudyWorkspaceChanged();
        setSavedDocument(document);
        setSaving(false);
        return;
      }
      const note = await window.nodus.createNote({
        title,
        content,
        kind,
        folderId,
        source: source ?? { origin: kind },
      });
      setSavedNote(note);
      onSaved?.(note);
      if (allowProjectLink && projectId) {
        try {
          await window.nodus.addProjectLink({
            projectId,
            sectionId: null,
            kind: 'note',
            refId: note.id,
            label: title,
            role: 'source',
          });
        } catch {
          setLinkWarning(t('La nota se guardó, pero no se pudo vincular al proyecto.'));
        }
      }
      setSaving(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const saved = savedNote ?? savedDocument;
  const openSaved = savedNote
    ? (onOpenSavedNote ? () => onOpenSavedNote(savedNote) : undefined)
    : (savedDocument && studyDocument?.onOpenSavedDocument ? () => studyDocument.onOpenSavedDocument?.(savedDocument.id) : undefined);

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 p-4 flex items-center justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg bg-neutral-950 border border-neutral-800 rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-4 py-3 border-b border-neutral-800 flex items-center gap-2">
          <Icon name="notebook" className="text-indigo-300" />
          <span className="font-semibold text-sm">{t('Guardar en notas')}</span>
          <div className="flex-1" />
          <button className="btn btn-ghost" onClick={onClose} title={t('Cerrar')}>
            <Icon name="x" />
          </button>
        </header>

        <div className="p-4 space-y-4">
          {saved ? (
            <div data-testid="save-note-success" className="rounded-lg border border-emerald-800 bg-emerald-950/30 p-4">
              <div className="flex items-start gap-3">
                <Icon name="check" className="mt-0.5 text-emerald-400" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-emerald-200">{t('Nota guardada')}</p>
                  <p className="mt-1 truncate text-xs text-neutral-300" title={saved.title}>{saved.title}</p>
                  <p data-testid="save-note-destination" className="mt-2 text-xs text-neutral-500">{savedNote ? destinationPath : studyPath}</p>
                </div>
              </div>
              {linkWarning && <p className="mt-3 text-xs text-amber-300">{linkWarning}</p>}
            </div>
          ) : <>
          {studyEnabled && (
            <div>
              <label className="text-xs uppercase text-neutral-500">{t('Destino')}</label>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  data-testid="save-note-destination-note"
                  aria-pressed={destination === 'note'}
                  className={`btn flex-1 justify-center ${destination === 'note' ? 'btn-primary' : 'btn-ghost border border-neutral-700'}`}
                  onClick={() => setDestination('note')}
                >
                  {t(destinationLabel)}
                </button>
                <button
                  type="button"
                  data-testid="save-note-destination-study"
                  aria-pressed={destination === 'study'}
                  className={`btn flex-1 justify-center ${destination === 'study' ? 'btn-primary' : 'btn-ghost border border-neutral-700'}`}
                  onClick={() => setDestination('study')}
                >
                  {t('Apunte de estudio')}
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="text-xs uppercase text-neutral-500">{t('Título')}</label>
            <input
              className="input w-full mt-1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('Título de la nota')}
            />
          </div>

          {destination === 'study' ? <>
            {workspace && workspace.courses.length === 0 && (
              <p className="rounded-md border border-amber-900/60 bg-amber-950/20 p-2 text-xs text-amber-300">
                {t('Aún no hay cursos.')} {t('Crea tu primer curso para empezar.')}
              </p>
            )}
            <div>
              <label className="text-xs uppercase text-neutral-500">{t('Curso')}</label>
              <select
                data-testid="save-note-study-course"
                className="input w-full mt-1"
                value={courseId}
                onChange={(e) => { setCourseId(e.target.value); setSubjectId(''); setStudyFolderId(''); setTopicId(''); }}
              >
                <option value="">{t('Selecciona un curso')}</option>
                {(workspace?.courses ?? []).map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase text-neutral-500">{t('Asignatura')}</label>
              <select
                data-testid="save-note-study-subject"
                className="input w-full mt-1"
                value={subjectId}
                onChange={(e) => { setSubjectId(e.target.value); setStudyFolderId(''); setTopicId(''); }}
              >
                <option value="">{t('Selecciona una asignatura')}</option>
                {studySubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase text-neutral-500">{t('Carpeta (opcional)')}</label>
              <select
                data-testid="save-note-study-folder"
                className="input w-full mt-1"
                value={studyFolderId}
                onChange={(e) => { setStudyFolderId(e.target.value); setTopicId(''); }}
              >
                <option value="">{t('Directamente en la asignatura')}</option>
                {studyFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase text-neutral-500">{t('Tema (opcional)')}</label>
              <select
                data-testid="save-note-study-topic"
                className="input w-full mt-1"
                value={topicId}
                onChange={(e) => setTopicId(e.target.value)}
              >
                <option value="">{t('Sin tema')}</option>
                {studyTopics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
              </select>
            </div>
            <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-2 text-xs text-neutral-400">
              <Icon name="info" size={12} className="mr-1 text-neutral-500" />
              {t('El apunte guarda la respuesta, la conversación de la que viene y sus fuentes citadas.')}
            </div>
          </> : <>
          <div>
            <label className="text-xs uppercase text-neutral-500">{t('Carpeta')}</label>
            <select
              className="input w-full mt-1"
              value={folderId ?? ''}
              onChange={(e) => setFolderId(e.target.value || null)}
            >
              <option value="">{t('Sin carpeta (raíz)')}</option>
              {flat.map(({ folder, depth }) => (
                <option key={folder.id} value={folder.id}>
                  {`${'  '.repeat(depth)}${depth > 0 ? '↳ ' : ''}${folder.name}`}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-xs uppercase text-neutral-500">{t('Nueva carpeta')}</label>
              <input
                className="input w-full mt-1"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder={folderId ? t('Subcarpeta dentro de la seleccionada') : t('Carpeta nueva en la raíz')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void createFolder();
                  }
                }}
              />
            </div>
            <button
              className="btn btn-ghost border border-neutral-700 gap-1.5"
              onClick={() => void createFolder()}
              disabled={creatingFolder || !newFolderName.trim()}
              title={t('Crear carpeta')}
            >
              <Icon name={creatingFolder ? 'sync' : 'folderPlus'} className={creatingFolder ? 'animate-spin' : ''} />
              {t('Crear')}
            </button>
          </div>

          {allowProjectLink && (
            <div>
              <label className="text-xs uppercase text-neutral-500">{t('Vincular a proyecto (opcional)')}</label>
              <select
                className="input w-full mt-1"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                disabled={projects.length === 0}
              >
                <option value="">{t('Sin proyecto')}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-2 text-xs text-neutral-400">
            <Icon name="info" size={12} className="mr-1 text-neutral-500" />
            {t('Las citas clicables del contenido se conservan al guardar.')}
          </div>
          </>}

          {error && <div className="text-xs text-red-400">{error}</div>}
          </>}
        </div>

        <footer className="px-4 py-3 border-t border-neutral-800 flex items-center justify-end gap-2">
          {saved ? <>
            <button data-testid="save-note-continue" className="btn btn-ghost" onClick={onClose}>
              {t(openSaved ? 'Continuar en el chat' : 'Cerrar')}
            </button>
            {openSaved && (
              <button data-testid="save-note-open" className="btn btn-primary gap-1.5" onClick={openSaved}>
                <Icon name="external" /> {t(savedNote ? 'Abrir nota' : 'Abrir apunte')}
              </button>
            )}
          </> : <>
            <button className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button>
            <button
              data-testid="save-note-save"
              className="btn btn-primary gap-1.5"
              onClick={() => void save()}
              disabled={saving || !content.trim() || (destination === 'study' && !subjectId)}
            >
              <Icon name={saving ? 'sync' : 'save'} className={saving ? 'animate-spin' : ''} />
              {saving ? t('Guardando…') : t(destination === 'study' ? 'Guardar' : 'Guardar nota')}
            </button>
          </>}
        </footer>
      </div>
    </div>
  );
}
