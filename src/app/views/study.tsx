// The study vault. Almost every section can hand off to another one — a search hit
// opens a document, an idea opens the graph — so the same three jumps recur; they
// are written out per view rather than shared, because each carries the target
// setter its own destination reads.
import { lazy } from 'react';
import type { ViewContext, ViewRenderer } from '../ViewContext';

const StudyOrganizationView = lazy(() => import('../../views/StudyOrganizationView').then((module) => ({ default: module.StudyOrganizationView })));
const StudyScheduleView = lazy(() => import('../../views/StudyScheduleView').then((module) => ({ default: module.StudyScheduleView })));
const StudyCalendarView = lazy(() => import('../../views/StudyCalendarView').then((module) => ({ default: module.StudyCalendarView })));
const StudySearchView = lazy(() => import('../../views/StudySearchView').then((module) => ({ default: module.StudySearchView })));
const StudyMaterialsView = lazy(() => import('../../views/StudyMaterialsView').then((module) => ({ default: module.StudyMaterialsView })));
const StudyRecordingsView = lazy(() => import('../../views/StudyRecordingsView').then((module) => ({ default: module.StudyRecordingsView })));
const StudyChatView = lazy(() => import('../../views/StudyChatView').then((module) => ({ default: module.StudyChatView })));
const StudyIdeasView = lazy(() => import('../../views/StudyIdeasView').then((module) => ({ default: module.StudyIdeasView })));
const StudyGraphView = lazy(() => import('../../views/StudyGraphView').then((module) => ({ default: module.StudyGraphView })));
const StudyBankView = lazy(() => import('../../views/StudyBankView').then((module) => ({ default: module.StudyBankView })));
const StudyReviewView = lazy(() => import('../../views/StudyReviewView').then((module) => ({ default: module.StudyReviewView })));
const DeepResearchView = lazy(() => import('../../views/DeepResearchView').then((module) => ({ default: module.DeepResearchView })));

/** The three destinations every study section can jump to. */
const openDocument = (ctx: ViewContext) => (id: string) => {
  ctx.setStudyTarget({ kind: 'document', id });
  ctx.setView('studyCourses');
};
const openMaterial = (ctx: ViewContext) => (id: string) => {
  ctx.setStudyMaterialTarget(id);
  ctx.setView('studyLibrary');
};
const openRecording = (ctx: ViewContext) => (id: string, timestamp?: number | null) => {
  ctx.setStudyRecordingTarget({ id, timestamp: timestamp ?? null });
  ctx.setView('studyRecordings');
};

export const studyViews = {
  studyCourses: (ctx) => (
    <StudyOrganizationView
      target={ctx.studyTarget}
      mode="organization"
      onTargetChange={ctx.setStudyTarget}
      onOpenMaterial={openMaterial(ctx)}
      onOpenRecording={(id, timestamp) => { ctx.setStudyRecordingTarget({ id, timestamp }); ctx.setView('studyRecordings'); }}
    />
  ),
  studySchedule: () => <StudyScheduleView />,
  studyCalendar: () => <StudyCalendarView />,
  studySearch: (ctx) => (
    <StudySearchView
      onOpenDocument={openDocument(ctx)}
      onOpenMaterial={openMaterial(ctx)}
      onOpenRecording={(id, timestamp) => { ctx.setStudyRecordingTarget({ id, timestamp }); ctx.setView('studyRecordings'); }}
    />
  ),
  studyLibrary: (ctx) => (
    <StudyMaterialsView initialMaterialId={ctx.studyMaterialTarget} onOpenDocument={openDocument(ctx)} />
  ),
  studyRecordings: (ctx) => (
    <StudyRecordingsView
      initialRecordingId={ctx.studyRecordingTarget?.id}
      initialTimestamp={ctx.studyRecordingTarget?.timestamp}
      onOpenDocument={openDocument(ctx)}
    />
  ),
  studyChat: (ctx) => (
    <StudyChatView
      settings={ctx.settings}
      variant={ctx.isDocencia ? 'teaching' : 'study'}
      initialPrompt={ctx.studyChatTarget?.prompt}
      onOpenDocument={openDocument(ctx)}
      onOpenMaterial={openMaterial(ctx)}
      onOpenRecording={openRecording(ctx)}
    />
  ),
  studyIdeas: (ctx) => (
    <StudyIdeasView
      vaultId={ctx.activeVault?.id ?? null}
      onOpenGraph={(target) => { ctx.setStudyGraphTarget({ ...target, nonce: Date.now() }); ctx.setView('studyGraph'); }}
      onOpenAssistant={(target) => { ctx.setStudyChatTarget({ prompt: target?.prompt ?? '', nonce: Date.now() }); ctx.setView('studyChat'); }}
      onOpenMaterial={openMaterial(ctx)}
      onOpenDocument={openDocument(ctx)}
    />
  ),
  studyGraph: (ctx) => (
    <StudyGraphView
      settings={ctx.settings}
      onSettingsChange={ctx.reloadSettings}
      target={ctx.studyGraphTarget}
      onOpenMaterial={openMaterial(ctx)}
      onOpenDocument={openDocument(ctx)}
    />
  ),
  studyQuestions: (ctx) => (
    <StudyBankView
      onOpenDocument={openDocument(ctx)}
      onOpenMaterial={openMaterial(ctx)}
      onOpenRecording={openRecording(ctx)}
    />
  ),
  studyReview: () => <StudyReviewView />,
  studyDeepResearch: (ctx) => (
    <DeepResearchView
      settings={ctx.settings}
      isStudy
      isTeaching={ctx.isDocencia}
      onOpenGraph={(target) => ctx.navigate('graph', target)}
      onOpenStudyDocument={openDocument(ctx)}
      onOpenStudyMaterial={openMaterial(ctx)}
      onOpenStudyRecording={(id, timestamp) => { ctx.setStudyRecordingTarget({ id, timestamp }); ctx.setView('studyRecordings'); }}
    />
  ),
} satisfies Record<string, ViewRenderer>;

export const studyJumps = { openDocument, openMaterial, openRecording };
