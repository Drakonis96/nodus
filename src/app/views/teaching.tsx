// The teaching vault's own sections. Everything else it uses — the organization
// tree, the materials, the chat — is the study vault's, which is why only five
// views live here.
import { lazy } from 'react';
import type { ViewRenderer } from '../ViewContext';
import { studyJumps } from './study';

const TeachingGroupsView = lazy(() => import('../../views/TeachingGroupsView').then((module) => ({ default: module.TeachingGroupsView })));
const TeachingGradesView = lazy(() => import('../../views/TeachingGradesView').then((module) => ({ default: module.TeachingGradesView })));
const RubricsView = lazy(() => import('../../views/RubricsView').then((module) => ({ default: module.RubricsView })));
const ExamBuilderView = lazy(() => import('../../views/ExamBuilderView').then((module) => ({ default: module.ExamBuilderView })));
const DeepResearchView = lazy(() => import('../../views/DeepResearchView').then((module) => ({ default: module.DeepResearchView })));

export const teachingViews = {
  teachingGroups: () => <TeachingGroupsView />,
  teachingGrades: (ctx) => <TeachingGradesView onOpenOrganization={() => ctx.setView('studyCourses')} />,
  teachingExams: () => <ExamBuilderView />,
  teachingRubrics: () => <RubricsView />,
  // Unit design: the same Deep Research surface over the teaching corpus, with a
  // structure the teacher may fix section by section.
  teachingUnits: (ctx) => (
    <DeepResearchView
      settings={ctx.settings}
      isStudy
      isTeaching
      snapshot={ctx.snapshots.read('teachingUnits')}
      onSnapshotChange={(patch) => ctx.snapshots.patch('teachingUnits', patch)}
      onOpenGraph={(target) => { ctx.setStudyGraphTarget({ ...target, nonce: Date.now() }); ctx.setView('studyGraph'); }}
      onOpenStudyDocument={studyJumps.openDocument(ctx)}
      onOpenStudyMaterial={studyJumps.openMaterial(ctx)}
      onOpenStudyRecording={(id, timestamp) => { ctx.setStudyRecordingTarget({ id, timestamp }); ctx.setView('studyRecordings'); }}
    />
  ),
} satisfies Record<string, ViewRenderer>;
