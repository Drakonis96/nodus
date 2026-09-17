// The processing-log modal, driven in a real browser.
//
// Same harness shape as scripts/fixtures/queue-panel/renderer.tsx: a mocked `window.nodus` whose
// calls are recorded (`window.actions`) and whose push channels can be fired from the test, the
// compiled Tailwind stylesheet, and the panel + modal mounted exactly as App renders them. What
// this covers that no unit test can: the colours as they end up in both themes, a filter popover
// that has to sit above the modal, the right-click menu, and the fact that the modal survives
// opening the panel and closing it in either order.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueuePanel, useQueueActivity } from '../../../src/components/QueuePanel';
import { PipelineLogsModal } from '../../../src/components/pipeline-logs/PipelineLogsModal';
import { setActiveLang } from '../../../src/i18n';

const fixture = window as any;
fixture.actions = [];
fixture.listeners = {};
fixture.sources = {
  getQueue: { total: 0, items: [], done: 0, failed: 0, maintenanceRunning: false },
  getDocumentIndexProgress: { campaigns: [], jobs: [] },
  getEmbeddingStatus: null,
  getPassageStatus: null,
  listZoteroSyncSessions: [],
  listLibraryExtractionJobs: [],
  listDeepResearchJobs: [],
  listDictionaryGenerationJobs: [],
  listOcrDocs: [],
  // Whatever the caller seeds on window.initial before the bundle runs, exactly as the
  // queue-panel fixture does: the screenshots need a panel with work in flight, and a test
  // should not have to fire an event to get one.
  ...(fixture.initial ?? {}),
};
fixture.emit = (name: string, ...args: unknown[]) => {
  for (const callback of fixture.listeners[name] ?? []) callback(...args);
};

/** A line as the store returns it: a catalogue id plus its values. */
const line = (id: string, at: string, level: string, category: string, message: any, extra: any = {}) => ({
  id, at, level, category, scope: 'indexing', message, repeat: 1, firstAt: null,
  code: null, detail: null, retryable: null, ...extra,
});

fixture.logs = [
  line('pl-4', '2026-09-15T10:04:31.000Z', 'success', 'indexing',
    { id: 'documentIndexed', params: { title: 'Historia contemporánea', sections: 12, vectors: 40 } },
    { vaultId: 'v1', vaultName: 'Tesis', documentTitle: 'Historia contemporánea', durationMs: 252000 }),
  line('pl-3', '2026-09-15T10:04:29.000Z', 'error', 'json',
    { id: 'logFailed', params: { subject: { id: 'subjectJsonResponse' }, detail: 'Unexpected token < in JSON at position 0' } },
    { code: 'invalid_json', vaultId: 'v1', vaultName: 'Tesis', documentTitle: 'Otra obra', model: 'gpt-4o', provider: 'openai' }),
  line('pl-2', '2026-09-15T10:04:12.000Z', 'warning', 'provider',
    { id: 'logRetry', params: { subject: { id: 'subjectModelCall' }, attempt: 2, max: 4 } },
    { code: 'rate_limit', retryable: true, httpStatus: 429 }),
  line('pl-1', '2026-09-14T09:00:00.000Z', 'error', 'connection',
    { id: 'logFailed', params: { subject: { id: 'subjectEmbeddings' }, detail: 'timed out' } },
    { code: 'timeout', repeat: 12, firstAt: '2026-09-14T08:00:00.000Z' }),
];

/** Category/scope counts, in the order the lines happen to list them. */
function tally(entries: any[], pick: (entry: any) => string) {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(pick(entry), (counts.get(pick(entry)) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count }));
}

fixture.page = (query: any = {}) => {
  const filter = query.filter ?? {};
  const levels = filter.levels ?? [];
  const categories = filter.categories ?? [];
  const scopes = filter.scopes ?? [];
  const vaultIds = filter.vaultIds ?? [];
  const days = filter.days ?? [];
  const ids = filter.ids ?? [];
  const search = (filter.search ?? '').toLocaleLowerCase();
  const sorted = [...fixture.logs].sort((a: any, b: any) => (a.at < b.at ? 1 : -1));
  const entries = sorted.filter((entry: any) => {
    if (ids.length && !ids.includes(entry.id)) return false;
    if (levels.length && !levels.includes(entry.level)) return false;
    if (categories.length && !categories.includes(entry.category)) return false;
    if (scopes.length && !scopes.includes(entry.scope)) return false;
    if (vaultIds.length && !vaultIds.includes(entry.vaultId)) return false;
    if (days.length && !days.includes(entry.at.slice(0, 10))) return false;
    if (search && !`${entry.message.id} ${entry.code ?? ''} ${JSON.stringify(entry.message.params)} ${entry.detail ?? ''} ${entry.model ?? ''}`.toLocaleLowerCase().includes(search)) return false;
    return true;
  });
  return {
    entries: query.sort === 'oldest' ? [...entries].reverse() : entries,
    total: entries.length,
    revision: 1,
    retention: fixture.retention ?? '10d',
    maxEntries: fixture.maxEntries ?? 5000,
    stats: { entries: fixture.logs.length, oldestAt: '2026-09-14T08:00:00.000Z', newestAt: '2026-09-15T10:04:31.000Z', bytes: 4096 },
    facets: {
      total: fixture.logs.length,
      levels: [
        { value: 'success', count: fixture.logs.filter((entry: any) => entry.level === 'success').length },
        { value: 'error', count: fixture.logs.filter((entry: any) => entry.level === 'error').length },
        { value: 'warning', count: fixture.logs.filter((entry: any) => entry.level === 'warning').length },
      ],
      // Computed from the lines rather than hardcoded, so a different dataset (the screenshot
      // run, or a test that seeds more lines) reports the counts it actually has.
      categories: tally(fixture.logs, (entry: any) => entry.category),
      scopes: tally(fixture.logs, (entry: any) => entry.scope),
      vaults: Object.values(fixture.logs.reduce((accumulator: any, entry: any) => {
        if (!entry.vaultId) return accumulator;
        accumulator[entry.vaultId] ??= { id: entry.vaultId, label: entry.vaultName ?? entry.vaultId, count: 0 };
        accumulator[entry.vaultId].count += 1;
        return accumulator;
      }, {})),
      days: [
        { value: '2026-09-15', count: fixture.logs.filter((entry: any) => entry.at.startsWith('2026-09-15')).length },
        { value: '2026-09-14', count: fixture.logs.filter((entry: any) => entry.at.startsWith('2026-09-14')).length },
      ],
    },
  };
};

fixture.nodus = new Proxy({}, {
  get: (_target, name: string) => {
    if (name.startsWith('on')) {
      return (callback: (...args: unknown[]) => void) => {
        const listeners = fixture.listeners[name] ??= new Set();
        listeners.add(callback);
        return () => listeners.delete(callback);
      };
    }
    if (name === 'getPipelineLogs') return async (query: any) => {
      fixture.lastQuery = query;
      return fixture.page({ ...(query ?? {}), retention: fixture.retention });
    };
    if (name === 'deletePipelineLogs') return async (filter: any) => {
      fixture.actions.push(['deletePipelineLogs', filter]);
      const before = fixture.logs.length;
      fixture.logs = fixture.logs.filter((entry: any) => !(filter?.ids ?? []).includes(entry.id));
      // The real host broadcasts on every mutation; without it the live-refresh path would
      // never be exercised here.
      fixture.emit('onPipelineLogsChanged', { revision: 2, total: fixture.logs.length });
      return { removed: before - fixture.logs.length, total: fixture.logs.length };
    };
    if (name === 'clearPipelineLogs') return async () => {
      fixture.actions.push(['clearPipelineLogs']);
      const before = fixture.logs.length;
      fixture.logs = [];
      fixture.emit('onPipelineLogsChanged', { revision: 3, total: 0 });
      return { removed: before, total: 0 };
    };
    if (name === 'exportPipelineLogs') return async (text: string, fileName: string) => {
      fixture.exported = { text, fileName };
      return { canceled: false, path: `/tmp/${fileName}` };
    };
    if (name === 'updateSettings') return async (patch: any) => {
      fixture.actions.push(['updateSettings', patch]);
      if (patch.pipelineLogRetention) fixture.retention = patch.pipelineLogRetention;
      if (patch.pipelineLogMaxEntries) fixture.maxEntries = patch.pipelineLogMaxEntries;
      return { ...fixture.settings, ...patch };
    };
    if (name === 'getSettings') return async () => ({ ...fixture.settings, pipelineLogRetention: fixture.retention, pipelineLogMaxEntries: fixture.maxEntries });
    if (name in fixture.sources) return async () => fixture.sources[name];
    return async (...args: unknown[]) => { fixture.actions.push([name, ...args]); return true; };
  },
});

fixture.settings = { uiLanguage: 'en', pipelineLogLanguage: 'en', pipelineLogRetention: '10d', pipelineLogMaxEntries: 5000 };

const capture = async () => null;
const overlay = async () => undefined;

function App() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const activity = useQueueActivity();
  fixture.activity = activity;
  fixture.openPanel = () => setAnchor(document.querySelector('[data-queue-trigger]'));
  fixture.closePanel = () => setAnchor(null);
  return <>
    <button data-queue-trigger data-testid="trigger" onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}>Cola</button>
    <QueuePanel
      activity={activity}
      anchorEl={anchor}
      onClose={() => setAnchor(null)}
      captureBrowserOverlaySnapshot={capture}
      setBrowserOverlayVisible={overlay}
    />
  </>;
}

// The same component, mounted on its own, so the modal can be exercised without the panel in
// the way (and so the test can prove it does not depend on the panel being open).
function StandaloneLogs() {
  return <PipelineLogsModal onClose={() => { fixture.closedByButton = true; }} />;
}
fixture.mountStandalone = () => createRoot(document.getElementById('standalone')!).render(<StandaloneLogs />);

setActiveLang('en');
createRoot(document.getElementById('root')!).render(<App />);
