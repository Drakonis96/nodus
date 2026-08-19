import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AppSettings } from '@shared/types';
import type { BrowserHistoryEntry, BrowserHistoryRetention, BrowserHistoryStore } from '@shared/browserHistory';
import { emptyBrowserHistoryStore, searchBrowserHistory } from '@shared/browserHistory';
import { Icon } from '../ui';

const RETENTION_OPTIONS: { value: BrowserHistoryRetention; label: string }[] = [
  { value: 'none', label: 'Do not save history' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: '1 year' },
  { value: 'forever', label: 'Never delete' },
];

function groupLabel(visitedAt: string, now = new Date()): string {
  const date = new Date(visitedAt);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function groupEntries(entries: BrowserHistoryEntry[]): { label: string; entries: BrowserHistoryEntry[] }[] {
  const groups = new Map<string, BrowserHistoryEntry[]>();
  for (const entry of entries) {
    const label = groupLabel(entry.visitedAt);
    const current = groups.get(label) ?? [];
    current.push(entry);
    groups.set(label, current);
  }
  return [...groups].map(([label, items]) => ({ label, entries: items }));
}

export function BrowserHistoryManager({ onClose, onNotice }: {
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const [store, setStore] = useState<BrowserHistoryStore>(emptyBrowserHistoryStore);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    void window.nodus.setBrowserOverlayVisible(true);
    const stop = window.nodus.onBrowserHistoryChanged(setStore);
    void Promise.all([window.nodus.getBrowserHistory(), window.nodus.getSettings()])
      .then(([history, prefs]) => { setStore(history); setSettings(prefs); })
      .catch((cause) => onNotice(cause instanceof Error ? cause.message : String(cause)));
    return () => {
      stop();
      void window.nodus.setBrowserOverlayVisible(false);
    };
  }, [onNotice]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      if (confirmClear) setConfirmClear(false);
      else onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [busy, confirmClear, onClose]);

  const entries = useMemo(() => searchBrowserHistory(store, query), [query, store]);
  const groups = useMemo(() => groupEntries(entries), [entries]);

  const patchSettings = async (patch: Partial<AppSettings>) => {
    setBusy(true);
    try {
      const next = await window.nodus.updateSettings(patch);
      setSettings(next);
      setStore(await window.nodus.getBrowserHistory());
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try { setStore(await window.nodus.deleteBrowserHistoryEntry(id)); }
    catch (cause) { onNotice(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const clear = async () => {
    setBusy(true);
    try {
      setStore(await window.nodus.clearBrowserHistory());
      setConfirmClear(false);
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const open = async (entry: BrowserHistoryEntry, newTab: boolean) => {
    if (newTab) await window.nodus.openBrowserTab(entry.url);
    else await window.nodus.submitBrowserOmnibox(entry.url);
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[145] flex items-center justify-center bg-black/60 p-5"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
    >
      <section
        className="card-modal relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="browser-history-title"
        data-testid="browser-history-manager"
      >
        <header className="flex items-center gap-3 border-b border-neutral-200 p-4 dark:border-neutral-800">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/15 text-indigo-500 dark:text-indigo-300"><Icon name="clock" size={19} /></span>
          <div className="min-w-0 flex-1">
            <h2 id="browser-history-title" className="font-semibold">Browsing History</h2>
            <p className="text-xs text-neutral-500">{store.entries.length} visits · private and stored only on this device</p>
          </div>
          <button className="rounded p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </header>

        <div className="grid gap-3 border-b border-neutral-200 p-3 dark:border-neutral-800 md:grid-cols-[minmax(220px,1fr)_180px_auto]">
          <label className="flex min-w-0 items-center gap-2 rounded-lg border border-neutral-300 px-2 dark:border-neutral-700">
            <Icon name="search" size={14} className="text-neutral-500" />
            <input
              data-testid="browser-history-search"
              className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
              placeholder="Search history…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="text-[11px] font-medium text-neutral-500">
            Retention
            <select
              data-testid="browser-history-retention"
              className="input mt-1 h-8 w-full text-xs"
              value={settings?.browserHistoryRetention ?? '30d'}
              disabled={busy || !settings}
              onChange={(event) => void patchSettings({ browserHistoryRetention: event.target.value as BrowserHistoryRetention })}
            >
              {RETENTION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 self-end pb-1 text-xs text-neutral-600 dark:text-neutral-300">
            <input
              data-testid="browser-history-clear-on-close"
              type="checkbox"
              checked={settings?.browserClearHistoryOnClose ?? false}
              disabled={busy || !settings}
              onChange={(event) => void patchSettings({ browserClearHistoryOnClose: event.target.checked })}
            />
            Clear when Browser closes
          </label>
        </div>

        <div className="min-h-64 flex-1 overflow-y-auto p-3" data-testid="browser-history-list">
          {groups.map((group) => (
            <section key={group.label} className="mb-4 last:mb-0">
              <h3 className="sticky top-0 z-[1] bg-white/95 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 backdrop-blur dark:bg-neutral-900/95">{group.label}</h3>
              <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {group.entries.map((entry) => (
                  <article key={entry.id} data-testid="browser-history-entry" className="group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                    <Icon name="globe" size={15} className="shrink-0 text-neutral-400" />
                    <button className="min-w-0 flex-1 text-left" title={entry.url} onClick={() => void open(entry, false)}>
                      <span className="block truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">{entry.title}</span>
                      <span className="block truncate text-[11px] text-neutral-500">{entry.domain} · {new Date(entry.visitedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                    </button>
                    <button className="rounded p-1.5 text-neutral-500 opacity-0 hover:bg-neutral-200 hover:text-neutral-900 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-neutral-700 dark:hover:text-white" title="Open in new tab" aria-label={`Open ${entry.title} in new tab`} onClick={() => void open(entry, true)}><Icon name="external" size={13} /></button>
                    <button className="rounded p-1.5 text-neutral-500 opacity-0 hover:bg-red-100 hover:text-red-600 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-red-950/50 dark:hover:text-red-300" title="Delete entry" aria-label={`Delete ${entry.title} from history`} disabled={busy} onClick={() => void remove(entry.id)}><Icon name="trash" size={13} /></button>
                  </article>
                ))}
              </div>
            </section>
          ))}
          {entries.length === 0 && (
            <div className="grid min-h-60 place-items-center px-5 text-center text-sm text-neutral-500">
              <div><Icon name="clock" size={28} className="mx-auto mb-3 opacity-40" /><p className="font-medium">{query ? 'No matching visits' : 'No browsing history yet'}</p><p className="mt-1 text-xs">{query ? 'Try another title, URL or domain.' : settings?.browserHistoryRetention === 'none' ? 'History saving is turned off.' : 'Pages you visit in Nodus Browser will appear here.'}</p></div>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-neutral-200 p-3 dark:border-neutral-800">
          <p className="text-[11px] text-neutral-500">History is separate from Nodus Bookmarks and is not backed up or synced.</p>
          <button
            data-testid="browser-history-clear"
            className="btn btn-ghost border border-red-500/40 text-xs text-red-600 dark:text-red-300"
            disabled={busy || store.entries.length === 0}
            onClick={() => setConfirmClear(true)}
          >
            <Icon name="trash" size={12} /> Clear history
          </button>
        </footer>

        {confirmClear && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-black/60 p-5">
            <section className="card-modal w-full max-w-md p-5" role="alertdialog" aria-modal="true">
              <h3 className="text-lg font-semibold">Clear browsing history?</h3>
              <p className="mt-2 text-sm text-neutral-500">Every visit will be removed from this device. Nodus Bookmarks will not be changed.</p>
              <div className="mt-5 flex justify-end gap-2">
                <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirmClear(false)}>Cancel</button>
                <button data-testid="browser-history-clear-confirm" className="btn btn-danger" disabled={busy} onClick={() => void clear()}>Clear history</button>
              </div>
            </section>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
