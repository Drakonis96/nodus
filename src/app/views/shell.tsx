// The two sections that are about Nodus itself rather than about a corpus.
import { lazy } from 'react';
import type { ViewRenderer } from '../ViewContext';

const NodusBrowserView = lazy(() => import('../../views/NodusBrowserView').then((module) => ({ default: module.NodusBrowserView })));
const RadarView = lazy(() => import('../../views/RadarView').then((module) => ({ default: module.RadarView })));
const CompassView = lazy(() => import('../../views/CompassView').then((module) => ({ default: module.CompassView })));
const ToolkitView = lazy(() => import('../../views/ToolkitView').then((module) => ({ default: module.ToolkitView })));
const Settings = lazy(() => import('../../views/Settings').then((module) => ({ default: module.Settings })));

export const shellViews = {
  browser: () => <NodusBrowserView />,
  radar: ({ radarTarget }) => <RadarView target={radarTarget} />,
  compass: ({ snapshots }) => <CompassView snapshot={snapshots.read('compass')} onSnapshotChange={(patch) => snapshots.patch('compass', patch)} />,
  toolkit: ({ setToolkitPage, settings, toolkitPage }) => <ToolkitView page={toolkitPage} onNavigate={setToolkitPage} settings={settings} />,
  settings: ({ activeVault, recoveryStatus, reloadSettings, reloadVaults, setManualWhatsNewOpen, setRoadmapOpen, settings, vaults }) => (
    <Settings
      settings={settings}
      vaults={vaults}
      activeVault={activeVault}
      recoveryHealth={recoveryStatus?.health ?? null}
      onChange={reloadSettings}
      onVaultsChanged={reloadVaults}
      onOpenWhatsNew={() => setManualWhatsNewOpen(true)}
      onOpenRoadmap={() => setRoadmapOpen(true)}
    />
  ),
} satisfies Record<string, ViewRenderer>;
