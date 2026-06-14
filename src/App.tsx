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
  const [loadError, setLoadError] = useState<string | null>(null);

  const reloadSettings = useCallback(async () => {
    if (!window.nodus) {
      setLoadError('El puente de Nodus (preload) no está disponible. La app no puede comunicarse con su backend.');
      return undefined;
    }
    try {
      const s = await window.nodus.getSettings();
      setSettings(s);
      document.documentElement.classList.toggle('light', s.theme === 'light');
      document.documentElement.classList.toggle('dark', s.theme === 'dark');
      return s;
    } catch (e) {
      setLoadError(`No se pudieron cargar los ajustes: ${(e as Error).message}`);
      return undefined;
    }
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

  if (loadError) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="text-red-400 font-semibold">No se pudo iniciar Nodus</div>
        <div className="text-neutral-400 text-sm max-w-md">{loadError}</div>
        <button className="btn btn-primary" onClick={() => { setLoadError(null); void reloadSettings(); }}>
          Reintentar
        </button>
      </div>
    );
  }

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
        {settings.favorites.length > 0 && (
          <select
            className="input text-xs py-1"
            title="Modelo predeterminado para escaneos"
            value={settings.defaultModel ? `${settings.defaultModel.provider}::${settings.defaultModel.model}` : ''}
            onChange={async (e) => {
              if (!e.target.value) return;
              const [provider, model] = e.target.value.split('::');
              await window.nodus.updateSettings({ defaultModel: { provider: provider as any, model } });
              void reloadSettings();
            }}
          >
            {!settings.defaultModel && <option value="">Modelo: sin configurar</option>}
            {settings.favorites.map((m) => (
              <option key={`${m.provider}::${m.model}`} value={`${m.provider}::${m.model}`}>
                {m.provider} · {m.model}
              </option>
            ))}
          </select>
        )}
        {!settings.defaultModel && (
          <button className="btn btn-ghost text-amber-400" onClick={() => setView('settings')}>
            ⚠ Configura un modelo de IA
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
          {view === 'library' && <Library settings={settings} onOpenCollections={() => setCollectionsOpen(true)} />}
          {view === 'graph' && <GraphView />}
          {view === 'gaps' && <GapsView />}
          {view === 'reading' && <ReadingPathView />}
          {view === 'settings' && <Settings settings={settings} onChange={reloadSettings} />}
        </main>
      </div>

      <QueueBar />

      {collectionsOpen && <CollectionsModal settings={settings} onClose={() => setCollectionsOpen(false)} />}
    </div>
  );
}
