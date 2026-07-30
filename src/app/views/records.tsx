// People, places and documents: the sections shared by the genealogy and
// primary-sources vaults, plus the two the invented worlds borrow.
//
// These are the views that resolve to a different component per vault type, which
// is the reason the registry maps a view to a function rather than to a component.
import { lazy } from 'react';
import { WorldMapsView } from '../../views/WorldMapsView';
import type { ViewRenderer } from '../ViewContext';

const PersonasView = lazy(() => import('../../views/PersonasView').then((module) => ({ default: module.PersonasView })));
const TimelineView = lazy(() => import('../../views/TimelineView').then((module) => ({ default: module.TimelineView })));
const TreeView = lazy(() => import('../../views/TreeView').then((module) => ({ default: module.TreeView })));
const RelationsView = lazy(() => import('../../views/RelationsView').then((module) => ({ default: module.RelationsView })));
const MapView = lazy(() => import('../../views/MapView').then((module) => ({ default: module.MapView })));
const ArchiveView = lazy(() => import('../../views/ArchiveView').then((module) => ({ default: module.ArchiveView })));
const PrimarySourcesPersonsView = lazy(() => import('../../views/PrimarySourcesPersonsView').then((module) => ({ default: module.PrimarySourcesPersonsView })));
const PrimarySourcesTimelineView = lazy(() => import('../../views/PrimarySourcesTimelineView').then((module) => ({ default: module.PrimarySourcesTimelineView })));
const PrimarySourcesRelationsView = lazy(() => import('../../views/PrimarySourcesRelationsView').then((module) => ({ default: module.PrimarySourcesRelationsView })));
const PrimarySourcesMapView = lazy(() => import('../../views/PrimarySourcesMapView').then((module) => ({ default: module.PrimarySourcesMapView })));
const PrimarySourcesArchiveView = lazy(() => import('../../views/PrimarySourcesArchiveView').then((module) => ({ default: module.PrimarySourcesArchiveView })));

export const recordsViews = {
  persons: ({ isPrimarySources, personsTarget }) => (isPrimarySources
    ? <PrimarySourcesPersonsView />
    : <PersonasView initialPersonId={personsTarget} />),
  timeline: ({ isPrimarySources, isWorldbuilding }) => (isPrimarySources
    ? <PrimarySourcesTimelineView />
    : <TimelineView worldbuilding={isWorldbuilding} />),
  tree: ({ reloadSettings, settings }) => <TreeView settings={settings} onSettingsChange={reloadSettings} />,
  relations: ({ isPrimarySources, setView }) => (isPrimarySources
    ? <PrimarySourcesRelationsView />
    : <RelationsView onOpenPersons={() => setView('persons')} />),
  // The genealogy map projects lat/lon onto OpenStreetMap tiles, so in an invented
  // world — whose places have no gazetteer coordinates — it renders an empty planet
  // every time. Worldbuilding gets its own section instead.
  map: ({ isPrimarySources, isWorldbuilding }) => (isPrimarySources
    ? <PrimarySourcesMapView />
    : isWorldbuilding ? <WorldMapsView /> : <MapView />),
  archive: ({ isGenealogy, isPrimarySources, primarySourceTarget, setPrimarySourceTarget, setView }) => (isPrimarySources
    ? (
      <PrimarySourcesArchiveView
        target={primarySourceTarget}
        onTargetConsumed={() => setPrimarySourceTarget(null)}
      />
    )
    : <ArchiveView onOpenLibrary={() => setView('library')} isGenealogy={isGenealogy} />),
} satisfies Record<string, ViewRenderer>;
