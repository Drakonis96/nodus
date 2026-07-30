// The invented world: its encyclopedia, its cast, its groups and the manuscript.
//
// `setView` is passed straight through rather than wrapped: it is referentially
// stable, and the encyclopedia's section descriptor depends on that.
import { lazy } from 'react';
import { EncyclopediaView } from '../../views/EncyclopediaView';
import { ContinuityView } from '../../views/ContinuityView';
import { ConflictsView } from '../../views/ConflictsView';
import { ArcsView } from '../../views/ArcsView';
import { RulesView } from '../../views/RulesView';
import { QuestionsView } from '../../views/QuestionsView';
import { WorldChatView } from '../../views/WorldChatView';
import { ManuscriptView } from '../../views/ManuscriptView';
import type { ViewRenderer } from '../ViewContext';

const CharactersView = lazy(() => import('../../views/CharactersView').then((module) => ({ default: module.CharactersView })));
const PlacesView = lazy(() => import('../../views/PlacesView').then((module) => ({ default: module.PlacesView })));
const FactionsView = lazy(() => import('../../views/GroupsView').then((module) => ({ default: module.FactionsView })));
const CulturesView = lazy(() => import('../../views/GroupsView').then((module) => ({ default: module.CulturesView })));
const DynastiesView = lazy(() => import('../../views/GroupsView').then((module) => ({ default: module.DynastiesView })));
const ScenesView = lazy(() => import('../../views/ScenesView').then((module) => ({ default: module.ScenesView })));

export const worldbuildingViews = {
  encyclopedia: ({ setView }) => <EncyclopediaView onNavigate={setView} />,
  continuity: ({ setView }) => <ContinuityView onNavigate={setView} />,
  conflicts: ({ setView }) => <ConflictsView onNavigate={setView} />,
  arcs: ({ setView }) => <ArcsView onNavigate={setView} />,
  rules: ({ setView }) => <RulesView onNavigate={setView} />,
  questions: ({ setView }) => <QuestionsView onNavigate={setView} />,
  worldChat: ({ setView, settings }) => <WorldChatView settings={settings} onNavigate={setView} />,
  manuscript: ({ setView }) => <ManuscriptView onNavigate={setView} />,
  characters: () => <CharactersView />,
  places: () => <PlacesView />,
  factions: () => <FactionsView />,
  cultures: () => <CulturesView />,
  dynasties: () => <DynastiesView />,
  scenes: ({ setView }) => <ScenesView onNavigate={setView} />,
} satisfies Record<string, ViewRenderer>;
