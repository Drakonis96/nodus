import { useCallback, useEffect, useState } from 'react';
import type { AppSettings, SyncLogEntry } from '@shared/types';
import { Onboarding } from './views/Onboarding';
import { Library } from './views/Library';
import { GraphView } from './views/GraphView';
import { GapsView } from './views/GapsView';
import { ReadingPathView } from './views/ReadingPathView';
import { Settings } from './views/Settings';
import { CollectionsModal } from './views/CollectionsModal';
import { ResearchAssistantModal } from './views/ResearchAssistantModal';
import { QueueBar } from './components/QueueBar';
import { Tour } from './views/Tour';
import { Icon } from './components/ui';
import nodusLogo from './assets/nodus-logo.svg';

type View = 'library' | 'graph' | 'gaps' | 'reading' | 'settings';

const NAV: { id: View; label: string; icon: string }[] = [
  { id: 'graph', label: 'Grafo', icon: 'layers' },
  { id: 'library', label: 'Biblioteca', icon: 'book' },
  { id: 'gaps', label: 'Huecos', icon: 'gap' },
  { id: 'reading', label: 'Ruta de lectura', icon: 'route' },
  { id: 'settings', label: 'Ajustes', icon: 'settings' },
];

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [view, setView] = useState<View>('graph');
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
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
        <div className="flex items-center gap-2 font-semibold text-lg tracking-tight">
          <img src={nodusLogo} alt="" className="h-7 w-7" />
          <span>Nodus</span>
        </div>
        <div className="flex-1" />
        {lastSync && <span className="text-xs text-neutral-500">{lastSync.summary}</span>}
        {settings.favorites.length > 0 && (
          <select
            data-tour="model"
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
          <button data-tour="model" className="btn btn-ghost text-amber-400 gap-1.5" onClick={() => setView('settings')}>
            <Icon name="alert" /> Configura un modelo de IA
          </button>
        )}
        <button
          className="btn btn-ghost gap-1.5"
          title={settings.defaultModel ? 'Abrir asistente de investigación' : 'Configura un modelo de IA'}
          onClick={() => (settings.defaultModel ? setResearchOpen(true) : setView('settings'))}
        >
          <Icon name="wand" /> Asistente
        </button>
        <button data-tour="collections" className="btn btn-ghost gap-1.5" onClick={() => setCollectionsOpen(true)}>
          <Icon name="folder" /> Colecciones
        </button>
        <button data-tour="sync" className="btn btn-primary gap-1.5" onClick={onSync} disabled={syncing}>
          <Icon name="sync" className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Actualizando…' : 'Actualizar'}
        </button>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        <nav className="w-44 border-r border-neutral-800 p-2 flex flex-col gap-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              data-tour={`nav-${n.id}`}
              onClick={() => setView(n.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                view === n.id ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900'
              }`}
            >
              <Icon name={n.icon} className="opacity-70" />
              {n.label}
            </button>
          ))}
        </nav>

        {/* Main view */}
        <main className="flex-1 min-w-0 overflow-hidden">
          {view === 'library' && <Library settings={settings} onOpenCollections={() => setCollectionsOpen(true)} />}
          {view === 'graph' && <GraphView settings={settings} onSettingsChange={reloadSettings} />}
          {view === 'gaps' && <GapsView />}
          {view === 'reading' && <ReadingPathView />}
          {view === 'settings' && <Settings settings={settings} onChange={reloadSettings} />}
        </main>
      </div>

      <div data-tour="queue">
        <QueueBar />
      </div>

      {collectionsOpen && <CollectionsModal settings={settings} onClose={() => setCollectionsOpen(false)} />}
      {researchOpen && <ResearchAssistantModal settings={settings} onClose={() => setResearchOpen(false)} />}

      {settings.onboardingComplete && !settings.tourComplete && (
        <Tour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ tourComplete: true });
            void reloadSettings();
          }}
        />
      )}
    </div>
  );
}
