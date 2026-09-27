import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueuePanel, useQueueActivity } from '../../../src/components/QueuePanel';
import { setActiveLang } from '../../../src/i18n';
import * as background from '../../../src/backgroundJobs';

const fixture = window as any;
fixture.actions = [];
fixture.listeners = {};
fixture.sources = {
  getResearchPreparationProgress: { paused: false, campaigns: [] },
  getQueue: { total: 0, items: [], done: 0, failed: 0, maintenanceRunning: false },
  getDocumentIndexProgress: { campaigns: [], jobs: [] }, getEmbeddingStatus: null, getPassageStatus: null,
  listZoteroSyncSessions: [], listLibraryExtractionJobs: [], listDeepResearchJobs: [], listDictionaryGenerationJobs: [], listOcrDocs: [],
  ...fixture.initial,
};
fixture.emit = (name: string, ...args: unknown[]) => {
  for (const cb of fixture.listeners[name] ?? []) cb(...args);
};
fixture.pending = {};
fixture.background = background;
fixture.deferredJobs = {};
fixture.startJob = (key: string, progress: unknown, request = {}) => {
  const job = background.startBackgroundJob(key, request, (_request, onProgress) => {
    onProgress(progress);
    return new Promise((resolve, reject) => { fixture.deferredJobs[key] = { resolve, reject, onProgress }; });
  });
  return job.id;
};
fixture.nodus = new Proxy({}, { get: (_target, name: string) => {
  if (name.startsWith('on')) return (cb: (...args: unknown[]) => void) => {
    const listeners = fixture.listeners[name] ??= new Set(); listeners.add(cb); return () => listeners.delete(cb);
  };
  if (name in fixture.sources) return () => fixture.hold?.includes(name)
    ? new Promise((resolve) => { fixture.pending[name] = resolve; }) : Promise.resolve(fixture.sources[name]);
  // The processing-log modal answers with an empty store here; its own behaviour is covered by
  // scripts/test-pipeline-logs-modal.mjs. Without this the panel's Logs button would open a
  // modal that crashes on a non-page payload.
  if (name === 'getPipelineLogs') return async () => ({
    entries: [], total: 0, revision: 0, retention: '10d', maxEntries: 5000,
    stats: { entries: 0, oldestAt: null, newestAt: null, bytes: 0 },
    facets: { total: 0, levels: [], categories: [], scopes: [], vaults: [], days: [] },
  });
  if (name === 'getGlobalLibraryItem') return async (id: string) => ({ metadata: { title: `Documento ${id}` } });
  if (name === 'getDictionaryEntry') return async (id: string) => ({ entry: { name: `Entrada ${id}` } });
  return (...args: unknown[]) => { fixture.actions.push([name, ...args]); return Promise.resolve(true); };
} });
const capture = async () => null;
const overlay = async (visible: boolean) => { fixture.overlay = visible; };
function App() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const activity = useQueueActivity();
  fixture.activity = activity;
  fixture.openPanel = () => setAnchor(document.querySelector('[data-queue-trigger]'));
  fixture.closePanel = () => setAnchor(null);
  return <><button data-queue-trigger data-testid="trigger" onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
    Cola <span data-testid="count">{activity.live}</span><span data-testid="attention">{String(activity.attention)}</span>
  </button><QueuePanel activity={activity} anchorEl={anchor} onClose={() => setAnchor(null)} captureBrowserOverlaySnapshot={capture} setBrowserOverlayVisible={overlay} /></>;
}
setActiveLang('es');
createRoot(document.getElementById('root')!).render(<App />);
