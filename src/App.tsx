import { useCallback, useEffect, useState } from 'react';
import type { AppSettings, SyncLogEntry } from '@shared/types';
import { Onboarding } from './views/Onboarding';
import { Library } from './views/Library';
import { GraphView } from './views/GraphView';
import { GapsView } from './views/GapsView';
import { ReadingPathView } from './views/ReadingPathView';
import { Settings } from './views/Settings';
import { CollectionsModal } from './views/CollectionsModal';
import { QueueBar } from './components/QueueBar';

type View = 'library' | 'graph' | 'gaps' | 'reading' | 'settings';

const NAV: { id: View; label: string; icon: string }[] = [
  { id: 'graph', label: 'Grafo', icon: '◈' },
  { id: 'library', label: 'Biblioteca', icon: '▤' },
  { id: 'gaps', label: 'Huecos', icon: '◌' },
  { id: 'reading', label: 'Ruta de lectura', icon: '➜' },
  { id: 'settings', label: 'Ajustes', icon: '⚙' },
];

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [view, setView] = useState<View>('graph');
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncLogEntry | null>(null);

  const reloadSettings = useCallback(async () => {
    const s = await window.nodus.getSettings();
    setSettings(s);
    document.documentElement.classList.toggle('light', s.theme === 'light');
    document.documentElement.classList.toggle('dark', s.theme === 'dark');
    return s;
  }, []);

  useEffect(() => {
    void reloadSettings();
  }, [reloadSettings]);

  const onSync = async () => {
    setSyncing(true);
    try {
      setLastSync(await window.nodus.syncNow());
    } finally {
      setSyncing(false);
    }
  };

  if (!settings) {
    return <div className="h-full flex items-center justify-center text-neutral-500">Cargando Nodus…</div>;
  }

  if (!settings.onboardingComplete) {
    return <Onboarding onDone={() => reloadSettings().then(() => setView('graph'))} />;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <header className="flex items-center gap-4 px-4 py-2 border-b border-neutral-800">
        <div className="font-semibold text-lg tracking-tight">Nodus</div>
        <div className="flex-1" />
        {lastSync && <span className="text-xs text-neutral-500">{lastSync.summary}</span>}
        {!settings.hasApiKey && (
          <button className="btn btn-ghost text-amber-400" onClick={() => setView('settings')}>
            ⚠ Falta clave de IA
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => setCollectionsOpen(true)}>
          Colecciones
        </button>
        <button className="btn btn-primary" onClick={onSync} disabled={syncing}>
          {syncing ? 'Actualizando…' : 'Actualizar'}
        </button>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        <nav className="w-44 border-r border-neutral-800 p-2 flex flex-col gap-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setView(n.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                view === n.id ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:bg-neutral-900'
              }`}
            >
              <span className="opacity-70">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>

        {/* Main view */}
        <main className="flex-1 min-w-0 overflow-hidden">
          {view === 'library' && <Library onOpenCollections={() => setCollectionsOpen(true)} />}
          {view === 'graph' && <GraphView />}
          {view === 'gaps' && <GapsView />}
          {view === 'reading' && <ReadingPathView />}
          {view === 'settings' && <Settings settings={settings} onChange={reloadSettings} />}
        </main>
      </div>

      <QueueBar />

      {collectionsOpen && (
        <CollectionsModal readTag={settings.readTag} onClose={() => setCollectionsOpen(false)} />
      )}
    </div>
  );
}
