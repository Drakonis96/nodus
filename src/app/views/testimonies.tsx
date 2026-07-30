// Oral history: the interviews, who took part, and what they contradict.
import { lazy } from 'react';
import type { ViewRenderer } from '../ViewContext';

const TestimonyInterviewsView = lazy(() => import('../../views/TestimonyInterviewsView').then((module) => ({ default: module.TestimonyInterviewsView })));
const TestimonyParticipantsView = lazy(() => import('../../views/TestimonyParticipantsView').then((module) => ({ default: module.TestimonyParticipantsView })));
const TestimonyContrastsView = lazy(() => import('../../views/TestimonyContrastsView').then((module) => ({ default: module.TestimonyContrastsView })));

export const testimonyViews = {
  testimonyInterviews: ({ testimonyTarget }) => <TestimonyInterviewsView target={testimonyTarget} />,
  testimonyParticipants: () => <TestimonyParticipantsView />,
  testimonyContrasts: () => <TestimonyContrastsView />,
} satisfies Record<string, ViewRenderer>;
