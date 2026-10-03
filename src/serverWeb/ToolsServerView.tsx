import { useState } from 'react';
import { Icon } from '../components/ui';
import { TOOLKIT_TOOLS } from '../navigation';
import { t } from './i18nShim';

/** The web catalogue exposes only tools supported by the server environment. */
export function ToolsServerView({ pinned, onOpen, onTogglePinned }: {
  pinned: boolean; onOpen(): void; onTogglePinned(): Promise<void>;
}) {
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const tool = TOOLKIT_TOOLS.find(tool => tool.testid === 'scriptor')!;
  const toggle = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await onTogglePinned(); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <div data-testid="toolkit-home" className="theme-workspace-surface h-full overflow-y-auto p-6">
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"><Icon name="tools" size={22} /></span>
        <h1 className="text-lg font-semibold">Nodus Tools</h1>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><div className="relative">
        <button data-testid="toolkit-card-scriptor" className="toolkit-card flex h-full w-full flex-col items-start gap-3 rounded-xl border border-neutral-200 bg-white p-5 pr-16 text-left hover:border-amber-400 dark:border-neutral-800 dark:bg-neutral-900/40 dark:hover:border-amber-500/60" onClick={onOpen}>
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"><Icon name={tool.icon} size={22} /></span>
          <span className="text-base font-semibold">{tool.name}</span><span className="text-sm leading-relaxed text-neutral-500">{t(tool.description)}</span>
        </button>
        <button data-testid="toolkit-card-scriptor-pin" aria-pressed={pinned} aria-label={`${tool.name} · ${t(pinned ? 'Desfijar' : 'Fijar')}`} title={t(pinned ? 'Desfijar' : 'Fijar')} disabled={busy} onClick={() => void toggle()} className={`absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-lg border disabled:opacity-50 ${pinned ? 'border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-500/50 dark:bg-amber-500/20 dark:text-amber-300' : 'border-neutral-200 bg-white text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900'}`}><Icon name="pin" size={17} /></button>
      </div></div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  </div>;
}
