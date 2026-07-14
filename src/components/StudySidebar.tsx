import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StudyPlacementInput, StudyTreeTopic, StudyWorkspace } from '@shared/studyOrg';
import { buildStudyTree } from '@shared/studyOrg';
import { Icon } from './ui';
import { t } from '../i18n';

export type StudyNavigationTarget = {
  kind: 'course' | 'subject' | 'topic' | 'folder' | 'document';
  id: string;
};

export const STUDY_WORKSPACE_CHANGED = 'nodus:study-workspace-changed';

export function announceStudyWorkspaceChanged(): void {
  window.dispatchEvent(new Event(STUDY_WORKSPACE_CHANGED));
}

function TreeButton({
  depth,
  icon,
  label,
  active,
  draggable,
  onClick,
  onDragStart,
  onDrop,
}: {
  depth: number;
  icon: string;
  label: string;
  active: boolean;
  draggable?: boolean;
  onClick: () => void;
  onDragStart?: (event: React.DragEvent) => void;
  onDrop?: (documentId: string) => void;
}) {
  return (
    <button
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDrop ? (event) => event.preventDefault() : undefined}
      onDrop={onDrop ? (event) => { event.preventDefault(); onDrop(event.dataTransfer.getData('application/x-nodus-study-doc')); } : undefined}
      onClick={onClick}
      title={label}
      style={{ paddingLeft: `${12 + depth * 12}px` }}
      className={`flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-xs transition-colors ${
        active ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
      }`}
    >
      <Icon name={icon} size={13} className="opacity-75" />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function StudySidebar({
  activeTarget,
  activeView,
  onOpen,
  onNavigate,
}: {
  activeTarget: StudyNavigationTarget | null;
  activeView: string;
  onOpen: (target: StudyNavigationTarget) => void;
  onNavigate: (view: 'studyCourses' | 'studyLibrary' | 'studyRecordings') => void;
}) {
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    const next = await window.nodus.getStudyWorkspace();
    setWorkspace(next);
    setExpanded((current) => current.size ? current : new Set(next.courses.map((course) => course.id)));
  }, []);

  useEffect(() => {
    void reload();
    window.addEventListener(STUDY_WORKSPACE_CHANGED, reload);
    return () => window.removeEventListener(STUDY_WORKSPACE_CHANGED, reload);
  }, [reload]);

  const tree = useMemo(() => workspace ? buildStudyTree(workspace) : [], [workspace]);
  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const isActive = (kind: StudyNavigationTarget['kind'], id: string) => activeTarget?.kind === kind && activeTarget.id === id;
  const moveDocument = async (documentId: string, placement: StudyPlacementInput) => {
    if (!documentId) return;
    await window.nodus.setPrimaryStudyPlacement(documentId, placement);
    announceStudyWorkspaceChanged();
  };

  const renderTopic = (topic: StudyTreeTopic, depth: number): React.ReactNode => (
    <div key={topic.id}>
      <div className="flex items-center">
        {(topic.children.length > 0 || topic.documents.length > 0) && (
          <button className="-mr-4 z-10 ml-0.5 text-neutral-600 hover:text-neutral-300" onClick={() => toggle(topic.id)}>
            <Icon name="chevronRight" size={10} className={expanded.has(topic.id) ? 'rotate-90' : ''} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <TreeButton depth={depth} icon="hash" label={topic.name} active={isActive('topic', topic.id)}
            onClick={() => onOpen({ kind: 'topic', id: topic.id })}
            onDrop={(documentId) => void moveDocument(documentId, { subjectId: topic.subjectId, topicId: topic.id })} />
        </div>
      </div>
      {expanded.has(topic.id) && (
        <>
          {topic.children.map((child) => renderTopic(child, depth + 1))}
          {topic.documents.map((document) => (
            <TreeButton key={document.id} depth={depth + 1} icon="notebook" label={document.title}
              active={isActive('document', document.id)} draggable
              onDragStart={(event) => event.dataTransfer.setData('application/x-nodus-study-doc', document.id)}
              onClick={() => onOpen({ kind: 'document', id: document.id })} />
          ))}
        </>
      )}
    </div>
  );

  const renderFolder = (folderId: string, depth: number): React.ReactNode => {
    if (!workspace) return null;
    const folder = workspace.folders.find((candidate) => candidate.id === folderId);
    if (!folder) return null;
    const children = workspace.folders.filter((candidate) => candidate.parentId === folder.id);
    const documents = workspace.placements
      .filter((placement) => placement.folderId === folder.id)
      .map((placement) => workspace.documents.find((document) => document.id === placement.documentId))
      .filter((document): document is NonNullable<typeof document> => Boolean(document));
    return (
      <div key={folder.id}>
        <div className="flex items-center">
          {(children.length > 0 || documents.length > 0) && (
            <button className="-mr-4 z-10 ml-0.5 text-neutral-600 hover:text-neutral-300" onClick={() => toggle(folder.id)}>
              <Icon name="chevronRight" size={10} className={expanded.has(folder.id) ? 'rotate-90' : ''} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <TreeButton depth={depth} icon={folder.icon || 'folder'} label={folder.name} active={isActive('folder', folder.id)}
              onClick={() => onOpen({ kind: 'folder', id: folder.id })}
              onDrop={(documentId) => void moveDocument(documentId, { folderId: folder.id })} />
          </div>
        </div>
        {expanded.has(folder.id) && (
          <>
            {children.map((child) => renderFolder(child.id, depth + 1))}
            {documents.map((document) => (
              <TreeButton key={document.id} depth={depth + 1} icon="notebook" label={document.title}
                active={isActive('document', document.id)} draggable
                onDragStart={(event) => event.dataTransfer.setData('application/x-nodus-study-doc', document.id)}
                onClick={() => onOpen({ kind: 'document', id: document.id })} />
            ))}
          </>
        )}
      </div>
    );
  };

  return (
    <div data-testid="study-sidebar-organization" className="mt-2 flex flex-col gap-1">
      <p className="px-3 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">{t('Organización')}</p>
      <button onClick={() => onNavigate('studyCourses')}
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${activeView === 'studyCourses' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900'}`}>
        <Icon name="graduation" /><span>{t('Cursos y asignaturas')}</span>
      </button>
      <button onClick={() => onNavigate('studyLibrary')}
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${activeView === 'studyLibrary' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900'}`}>
        <Icon name="book" /><span>{t('Materiales')}</span>
      </button>
      <button onClick={() => onNavigate('studyRecordings')}
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${activeView === 'studyRecordings' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900'}`}>
        <Icon name="microphone" /><span>{t('Grabaciones')}</span>
      </button>

      <div className="mt-1 max-h-[48vh] overflow-y-auto pr-0.5">
        {tree.map((course) => (
          <div key={course.id}>
            <div className="flex items-center">
              <button className="-mr-4 z-10 ml-0.5 text-neutral-600 hover:text-neutral-300" onClick={() => toggle(course.id)}>
                <Icon name="chevronRight" size={10} className={expanded.has(course.id) ? 'rotate-90' : ''} />
              </button>
              <div className="min-w-0 flex-1">
                <TreeButton depth={0} icon={course.icon || 'graduation'} label={course.name} active={isActive('course', course.id)}
                  onClick={() => onOpen({ kind: 'course', id: course.id })}
                  onDrop={(documentId) => void moveDocument(documentId, { courseId: course.id })} />
              </div>
            </div>
            {expanded.has(course.id) && course.subjects.map((subject) => (
              <div key={subject.id}>
                <div className="flex items-center">
                  <button className="-mr-4 z-10 ml-3 text-neutral-600 hover:text-neutral-300" onClick={() => toggle(subject.id)}>
                    <Icon name="chevronRight" size={10} className={expanded.has(subject.id) ? 'rotate-90' : ''} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <TreeButton depth={1} icon={subject.icon || 'book'} label={subject.name} active={isActive('subject', subject.id)}
                      onClick={() => onOpen({ kind: 'subject', id: subject.id })}
                      onDrop={(documentId) => void moveDocument(documentId, { courseId: course.id, subjectId: subject.id })} />
                  </div>
                </div>
                {expanded.has(subject.id) && (
                  <>
                    {subject.topics.map((topic) => renderTopic(topic, 2))}
                    {subject.documents.map((document) => (
                      <TreeButton key={document.id} depth={2} icon="notebook" label={document.title}
                        active={isActive('document', document.id)} draggable
                        onDragStart={(event) => event.dataTransfer.setData('application/x-nodus-study-doc', document.id)}
                        onClick={() => onOpen({ kind: 'document', id: document.id })} />
                    ))}
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {(workspace?.folders.length ?? 0) > 0 && (
        <div className="mt-2 border-t border-neutral-800 pt-2">
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">{t('Carpetas libres')}</p>
          {workspace!.folders.filter((folder) => !folder.parentId).map((folder) => renderFolder(folder.id, 0))}
        </div>
      )}
    </div>
  );
}
