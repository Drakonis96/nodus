// One entry per section of the app.
//
// This replaces 84 `{view === '…' && <SomeView … />}` lines threaded through
// App.tsx's JSX. It is a registry rather than a component map because the props
// are heterogeneous — many views take nothing, several take ten callbacks, and
// `map`, `persons`, `timeline`, `relations`, `archive`, `search`, `notes` and
// `home` resolve to a different component depending on the vault type. Every one
// of them is a function of ViewContext instead.
//
// What is NOT here: the label, the icon, the sidebar group and the per-vault
// gating. Those already live in src/navigation.ts and shared/vaultTypes.ts, which
// are the source of truth for the sidebar and for the reordering in Settings. The
// registry only adds the render.
//
// `Record<View, ViewRenderer>` is the contract: add a member to the View union and
// this stops compiling until the section exists.
import type { View } from '../navigation';
import type { ViewRenderer } from './ViewContext';
import { renderHome } from './views/home';
import { corpusViews } from './views/corpus';
import { recordsViews } from './views/records';
import { prosopographyViews } from './views/prosopography';
import { worldbuildingViews } from './views/worldbuilding';
import { testimonyViews } from './views/testimonies';
import { databasesViews } from './views/databases';
import { studyViews } from './views/study';
import { teachingViews } from './views/teaching';
import { shellViews } from './views/shell';

export const VIEW_REGISTRY: Record<View, ViewRenderer> = {
  home: renderHome,
  ...corpusViews,
  ...recordsViews,
  ...prosopographyViews,
  ...worldbuildingViews,
  ...testimonyViews,
  ...databasesViews,
  ...studyViews,
  ...teachingViews,
  ...shellViews,
};
