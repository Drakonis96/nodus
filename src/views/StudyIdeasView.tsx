import { useEffect, useMemo, useState } from 'react';
import type { StudyWorkspace } from '@shared/types';
import type { PendingAssistantNavigationTarget, PendingGraphNavigationTarget } from '../navigation';
import { Spinner } from '../components/ui';
import { t } from '../i18n';
import { IdeasView } from './IdeasView';
import { createStudyKnowledgeViewSource } from './studyKnowledgeViewSource';

const SUBJECT_KEY = 'nodus.studyKnowledgeSubjectId';

export function StudyIdeasView({
  vaultId,
  onOpenGraph,
  onOpenAssistant,
  onOpenMaterial,
  onOpenDocument,
}: {
  vaultId: string | null;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
  onOpenMaterial: (id: string) => void;
  onOpenDocument: (id: string) => void;
}) {
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [subjectId, setSubjectId] = useState(() => localStorage.getItem(SUBJECT_KEY) ?? '');
  useEffect(() => { void window.nodus.getStudyWorkspace().then(setWorkspace); }, []);
  useEffect(() => {
    if (!workspace?.subjects.length) return;
    if (!workspace.subjects.some((subject) => subject.id === subjectId)) setSubjectId(workspace.subjects[0].id);
  }, [workspace, subjectId]);
  useEffect(() => { if (subjectId) localStorage.setItem(SUBJECT_KEY, subjectId); }, [subjectId]);
  const dataSource = useMemo(() => createStudyKnowledgeViewSource(subjectId, (sourceRef) => {
    const match = /^study:(material|document):(.+)$/.exec(sourceRef);
    if (!match) return;
    if (match[1] === 'material') onOpenMaterial(match[2]);
    else onOpenDocument(match[2]);
  }), [onOpenDocument, onOpenMaterial, subjectId]);

  if (!workspace) return <div className="flex h-full items-center justify-center"><Spinner label={t('Cargando ideas…')} /></div>;
  if (!workspace.subjects.length) return <div className="flex h-full items-center justify-center p-8 text-center text-sm text-neutral-500">{t('Crea una asignatura y añade materiales para construir su mapa de ideas.')}</div>;
  return <IdeasView
    key={subjectId}
    vaultId={vaultId}
    dataSource={dataSource}
    testId="study-ideas-view"
    onOpenGraph={onOpenGraph}
    onOpenAssistant={onOpenAssistant}
    scopeControl={<select data-testid="study-ideas-subject" className="input min-w-48 text-sm" value={subjectId} onChange={(event) => setSubjectId(event.target.value)} aria-label={t('Asignatura')}>{workspace.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select>}
  />;
}
