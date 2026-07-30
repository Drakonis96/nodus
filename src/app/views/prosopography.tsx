// Prosopography's own sections. Its persons and sources must never fall through to
// the genealogical dossier or the generic archive, so every one of them is a
// dedicated view with a dedicated id.
import { lazy } from 'react';
import type { ViewRenderer } from '../ViewContext';

const ProsopSearchView = lazy(() => import('../../views/ProsopSearchView').then((module) => ({ default: module.ProsopSearchView })));
const ProsopPopulationView = lazy(() => import('../../views/ProsopPopulationView').then((module) => ({ default: module.ProsopPopulationView })));
const ProsopPersonsView = lazy(() => import('../../views/ProsopPersonsView').then((module) => ({ default: module.ProsopPersonsView })));
const ProsopSourcesView = lazy(() => import('../../views/ProsopSourcesView').then((module) => ({ default: module.ProsopSourcesView })));
const ProsopAnalysisView = lazy(() => import('../../views/ProsopAnalysisView').then((module) => ({ default: module.ProsopAnalysisView })));
const ProsopNetworksView = lazy(() => import('../../views/ProsopNetworksView').then((module) => ({ default: module.ProsopNetworksView })));

export const prosopographyViews = {
  prosopSearch: () => <ProsopSearchView />,
  prosopPopulation: () => <ProsopPopulationView />,
  prosopPersons: () => <ProsopPersonsView />,
  prosopSources: () => <ProsopSourcesView />,
  prosopAnalysis: () => <ProsopAnalysisView />,
  prosopNetworks: () => <ProsopNetworksView />,
} satisfies Record<string, ViewRenderer>;
