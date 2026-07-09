import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppSettings, CorpusHealthBucketId, SyncLogEntry, VaultSummary } from '@shared/types';
import { Onboarding } from './views/Onboarding';
import { HomeView } from './views/HomeView';
import { Library } from './views/Library';
import { GraphView } from './views/GraphView';
import { GapsView } from './views/GapsView';
import { DebateView } from './views/DebateView';
import { ResearchMapView } from './views/ResearchMapView';
import { HypothesisLabView } from './views/HypothesisLabView';
import { ReadingPathView } from './views/ReadingPathView';
import { WritingWorkshopView } from './views/WritingWorkshopView';
import { DeepResearchView } from './views/DeepResearchView';
import { ProjectsView } from './views/ProjectsView';
import { NotesView } from './views/NotesView';
import { SearchView } from './views/SearchView';
import { ArgumentMapView } from './views/ArgumentMapView';
import { IdeasView } from './views/IdeasView';
import { AuthorsView } from './views/AuthorsView';
import { StudyGuideView } from './views/StudyGuideView';
import { Settings } from './views/Settings';
import { CollectionsModal } from './views/CollectionsModal';
import { ResearchAssistantModal } from './views/ResearchAssistantModal';
import { QueueBar } from './components/QueueBar';
import { EmbeddingProgressBar } from './components/EmbeddingProgressBar';
import { PassageProgressBar } from './components/PassageProgressBar';
import { VaultSwitcher } from './components/VaultSwitcher';
import { FeedbackHost } from './components/feedback';
import { Tour } from './views/Tour';
import { AdvancedTour } from './views/AdvancedTour';
import { Icon } from './components/ui';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { t, tx, setActiveLang } from './i18n';
import { notifyDataChanged, useDataRefresh } from './hooks';
import type {
  PendingAssistantNavigationTarget,
  PendingGraphNavigationTarget,
  PendingLibraryNavigationTarget,
  View,
} from './navigation';
import { groupedNav, NAV_ITEMS, NAV_GROUPS } from './navigation';
import { CommandPalette, type Command } from './components/CommandPalette';
import nodusLogo from './assets/nodus-logo.svg';

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [vaults, setVaults] = useState<VaultSummary[]>([]);
  const [activeVault, setActiveVault] = useState<VaultSummary | null>(null);
  const [view, setView] = useState<View>('home');
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem('nodus.navCollapsed') === '1');
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [graphTarget, setGraphTarget] = useState<PendingGraphNavigationTarget & { nonce: number } | null>(null);
  const [libraryTarget, setLibraryTarget] = useState<PendingLibraryNavigationTarget & { nonce: number } | null>(null);
  const [assistantTarget, setAssistantTarget] = useState<PendingAssistantNavigationTarget & { nonce: number } | null>(null);
  // A note the user opened from global search; the nonce re-triggers even if the
  // same note is chosen twice.
  const [noteTarget, setNoteTarget] = useState<{ id: string; nonce: number } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncLogEntry | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // null while unknown; true when the DB holds any real or demo content.
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  // Sidebar sections grouped for rendering (Explorar · Analizar · Escribir),
  // each group in the user's chosen order, minus any hidden sections. Home is
  // pinned first and Settings last, both outside every group and never hidden.
  const navGroups = useMemo(
    () => groupedNav(settings?.sidebarOrder ?? [], settings?.sidebarHidden ?? []),
    [settings?.sidebarOrder, settings?.sidebarHidden]
  );
  const homeItem = NAV_ITEMS.find((n) => n.id === 'home')!;
  const settingsItem = NAV_ITEMS.find((n) => n.id === 'settings')!;
  const [paletteOpen, setPaletteOpen] = useState(false);

  const reloadSettings = useCallback(async () => {
    if (!window.nodus) {
      setLoadError(t('El puente de Nodus (preload) no está disponible. La app no puede comunicarse con su backend.'));
      return undefined;
    }
    try {
      const s = await window.nodus.getSettings();
      setSettings(s);
      setActiveLang(s.uiLanguage);
      document.documentElement.lang = s.uiLanguage;
      document.documentElement.classList.toggle('light', s.theme === 'light');
      document.documentElement.classList.toggle('dark', s.theme === 'dark');
      return s;
    } catch (e) {
      setLoadError(tx('No se pudieron cargar los ajustes: {msg}', { msg: (e as Error).message }));
      return undefined;
    }
  }, []);

  useEffect(() => {
    void reloadSettings();
  }, [reloadSettings]);

  const reloadVaults = useCallback(async () => {
    if (!window.nodus) return [];
    const next = await window.nodus.listVaults();
    setVaults(next);
    setActiveVault(next.find((vault) => vault.active) ?? null);
    return next;
  }, []);

  useEffect(() => {
    void reloadVaults();
  }, [reloadVaults]);

  const refreshHasData = useCallback(async () => {
    if (!window.nodus) return;
    try {
      setHasData(await window.nodus.hasAnyData());
    } catch {
      /* leave previous value */
    }
  }, []);

  useEffect(() => {
    void refreshHasData();
  }, [refreshHasData]);
  useDataRefresh(refreshHasData);

  const loadDemo = useCallback(async () => {
    setDemoBusy(true);
    try {
      await window.nodus.seedDemoData();
      await reloadSettings();
      await refreshHasData();
      notifyDataChanged();
      setView('home');
    } finally {
      setDemoBusy(false);
    }
  }, [reloadSettings, refreshHasData]);

  const exitDemo = useCallback(async () => {
    setDemoBusy(true);
    try {
      await window.nodus.clearDemoData();
      await reloadSettings();
      await refreshHasData();
      notifyDataChanged();
    } finally {
      setDemoBusy(false);
    }
  }, [reloadSettings, refreshHasData]);

  const toggleNav = () => {
    setNavCollapsed((v) => {
      localStorage.setItem('nodus.navCollapsed', v ? '0' : '1');
      return !v;
    });
  };

  // Global command palette: ⌘K / Ctrl+K toggles it from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onSync = async () => {
    setSyncing(true);
    try {
      const result = await window.nodus.syncNow();
      setLastSync(result);
      notifyDataChanged();
    } finally {
      setSyncing(false);
    }
  };

  const navigate = useCallback((nextView: View, graph?: PendingGraphNavigationTarget) => {
    if (graph) setGraphTarget({ ...graph, nonce: Date.now() });
    setView(nextView);
  }, []);

  const openLibraryBucket = useCallback((healthBucket: CorpusHealthBucketId) => {
    setLibraryTarget({ healthBucket, nonce: Date.now() });
    setView('library');
  }, []);

  useEffect(() => {
    if (!window.nodus?.onCopilotOpenIdea) return undefined;
    return window.nodus.onCopilotOpenIdea((target) => {
      navigate('graph', {
        preset: 'overview',
        nodeId: target.ideaId,
        label: target.label ? `${t('Idea:')} ${target.label}` : t('Idea de Nodus'),
      });
    });
  }, [navigate]);

  const openNoteFromSearch = useCallback((id: string) => {
    setNoteTarget({ id, nonce: Date.now() });
    setView('notes');
  }, []);

  const openAssistant = useCallback(
    (target?: PendingAssistantNavigationTarget) => {
      if (!settings?.defaultModel) {
        setView('settings');
        return;
      }
      setAssistantTarget(target ? { ...target, nonce: Date.now() } : null);
      setResearchOpen(true);
    },
    [settings?.defaultModel]
  );

  const openGraphFromAssistant = useCallback(
    (target: PendingGraphNavigationTarget) => {
      setResearchOpen(false);
      navigate('graph', target);
    },
    [navigate]
  );

  const handleActiveVaultChanged = useCallback(async () => {
    setCollectionsOpen(false);
    setResearchOpen(false);
    setGraphTarget(null);
    setAssistantTarget(null);
    setNoteTarget(null);
    setLastSync(null);
    setView('home');
    await reloadVaults();
    await reloadSettings();
    await refreshHasData();
    notifyDataChanged();
  }, [refreshHasData, reloadSettings, reloadVaults]);

  // Command palette entries: every navigation destination (grouped like the
  // sidebar) plus the header's global actions. Rebuilt when the language changes
  // so labels stay translated.
  const paletteCommands = useMemo<Command[]>(() => {
    const groupLabel = new Map(NAV_GROUPS.map((g) => [g.id, t(g.label)] as const));
    const bySection = [
      ...NAV_ITEMS.filter((n) => !n.group),
      ...NAV_GROUPS.flatMap((g) => NAV_ITEMS.filter((n) => n.group === g.id)),
    ];
    const navCommands: Command[] = bySection.map((n) => ({
      id: `nav:${n.id}`,
      label: t(n.label),
      section: n.group ? groupLabel.get(n.group)! : t('General'),
      icon: n.icon,
      run: () => setView(n.id),
    }));
    const actions: Command[] = [
      { id: 'act:sync', label: t('Actualizar (sincronizar Zotero)'), section: t('Acciones'), icon: 'sync', keywords: 'sync sincronizar', run: () => void onSync() },
      { id: 'act:assistant', label: t('Asistente de investigación'), section: t('Acciones'), icon: 'wand', keywords: 'assistant chat', run: () => openAssistant() },
      { id: 'act:collections', label: t('Colecciones'), section: t('Acciones'), icon: 'folder', keywords: 'collections zotero', run: () => setCollectionsOpen(true) },
    ];
    return [...navCommands, ...actions];
  }, [settings?.uiLanguage, onSync, openAssistant]);

  if (loadError) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="text-red-400 font-semibold">{t('No se pudo iniciar Nodus')}</div>
        <div className="text-neutral-400 text-sm max-w-md">{loadError}</div>
        <button className="btn btn-primary" onClick={() => { setLoadError(null); void reloadSettings(); }}>
          {t('Reintentar')}
        </button>
      </div>
    );
  }

  if (!settings) {
    return <div className="h-full flex items-center justify-center text-neutral-500">{t('Cargando Nodus…')}</div>;
  }

  // Authoritative per-render language: set before any child renders so every t() call
  // (including in plain helper functions) reads the current language.
  setActiveLang(settings.uiLanguage);

  if (!settings.onboardingComplete) {
    return (
      <Onboarding
        vaults={vaults}
        activeVault={activeVault}
        onVaultsChanged={reloadVaults}
        onDone={(nextView = 'home') => reloadSettings().then(() => setView(nextView))}
      />
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <header className="flex items-center gap-4 px-4 py-2 border-b border-neutral-800">
        <button
          className="flex items-center gap-2 font-semibold text-lg tracking-tight rounded-lg px-1 -mx-1 hover:bg-neutral-900 transition-colors"
          onClick={toggleNav}
          title={navCollapsed ? t('Mostrar el menú lateral') : t('Ocultar el menú lateral (más espacio para el grafo)')}
        >
          <img src={nodusLogo} alt="" className="h-7 w-7" />
          <span>Nodus</span>
          <Icon name={navCollapsed ? 'chevronRight' : 'chevronLeft'} size={14} className="text-neutral-600" />
        </button>
        <VaultSwitcher
          vaults={vaults}
          activeVault={activeVault}
          onVaultsChanged={reloadVaults}
          onActiveVaultChanged={handleActiveVaultChanged}
        />
        <div className="flex-1" />
        {lastSync && <span className="text-xs text-neutral-500">{lastSync.summary}</span>}
        {settings.favorites.length > 0 && (
          <select
            data-tour="model"
            className="input text-xs py-1"
            title={t('Modelo predeterminado para escaneos')}
            value={settings.defaultModel ? `${settings.defaultModel.provider}::${settings.defaultModel.model}` : ''}
            onChange={async (e) => {
              if (!e.target.value) return;
              const [provider, model] = e.target.value.split('::');
              await window.nodus.updateSettings({ defaultModel: { provider: provider as any, model } });
              void reloadSettings();
            }}
          >
            {!settings.defaultModel && <option value="">{t('Modelo: sin configurar')}</option>}
            {settings.favorites.map((m) => (
              <option key={`${m.provider}::${m.model}`} value={`${m.provider}::${m.model}`}>
                {m.provider} · {m.model}
              </option>
            ))}
          </select>
        )}
        {!settings.defaultModel && (
          <button data-tour="model" className="btn btn-ghost text-amber-400 gap-1.5" onClick={() => setView('settings')}>
            <Icon name="alert" /> {t('Configura un modelo de IA')}
          </button>
        )}
        <button
          className="btn btn-ghost gap-1.5"
          title={settings.defaultModel ? t('Abrir asistente de investigación') : t('Configura un modelo de IA')}
          onClick={() => openAssistant()}
        >
          <Icon name="wand" /> {t('Asistente')}
        </button>
        <button data-tour="collections" className="btn btn-ghost gap-1.5" onClick={() => setCollectionsOpen(true)}>
          <Icon name="folder" /> {t('Colecciones')}
        </button>
        <button data-tour="sync" className="btn btn-primary gap-1.5" onClick={onSync} disabled={syncing}>
          <Icon name="sync" className={syncing ? 'animate-spin' : ''} /> {syncing ? t('Actualizando…') : t('Actualizar')}
        </button>
      </header>

      {settings.demoMode && (
        <div className="flex items-center gap-3 px-4 py-1.5 bg-amber-100 border-b border-amber-300 text-amber-800 text-xs dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-300">
          <Icon name="alert" size={14} />
          <span className="flex-1">
            {t('Modo demostración: estás viendo un corpus de ejemplo. Sal del modo demo para empezar con tu propia biblioteca.')}
          </span>
          <button className="btn btn-ghost border border-amber-400/60 text-amber-800 py-0.5 dark:border-amber-500/40 dark:text-amber-200" onClick={() => void exitDemo()} disabled={demoBusy}>
            {demoBusy ? t('Saliendo…') : t('Salir del modo demo')}
          </button>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Sidebar (collapsible via the Nodus logo). Home is pinned first,
            Settings last; the rest render grouped (Explorar · Analizar · Escribir). */}
        {!navCollapsed && (
          <nav className="w-44 border-r border-neutral-800 p-2 flex flex-col gap-1 overflow-y-auto">
            {(() => {
              const navButton = (n: { id: View; icon: string; label: string }) => (
                <button
                  key={n.id}
                  data-tour={`nav-${n.id}`}
                  onClick={() => setView(n.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                    view === n.id ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900'
                  }`}
                >
                  <Icon name={n.icon} className="opacity-70" />
                  {t(n.label)}
                </button>
              );
              return (
                <>
                  {navButton(homeItem)}
                  {navGroups.map((group) => (
                    <div key={group.id} className="mt-2 flex flex-col gap-1">
                      <div className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
                        {t(group.label)}
                      </div>
                      {group.items.map((n) => navButton(n))}
                    </div>
                  ))}
                  <div className="mt-2 flex flex-col gap-1">{navButton(settingsItem)}</div>
                </>
              );
            })()}
          </nav>
        )}

        {/* Main view */}
        <main className="flex-1 min-w-0 overflow-hidden">
          {/* Per-view crash isolation: a render error in one section shows a
              recovery card here instead of blanking the whole window. key={view}
              clears the error automatically when the user switches sections. */}
          <AppErrorBoundary key={view}>
          {view === 'home' && (
            <HomeView
              settings={settings}
              lastSync={lastSync}
              syncing={syncing}
              onSync={onSync}
              onNavigate={(target) => navigate(target)}
              onOpenLibraryBucket={openLibraryBucket}
              onOpenAssistant={() => openAssistant()}
              showDemoOffer={hasData === false && !settings.demoMode}
              demoBusy={demoBusy}
              onLoadDemo={loadDemo}
            />
          )}
          {view === 'library' && (
            <Library
              settings={settings}
              target={libraryTarget}
              onOpenCollections={() => setCollectionsOpen(true)}
              onOpenGraph={(target) => navigate('graph', target)}
              onOpenAssistant={openAssistant}
            />
          )}
          {view === 'graph' && <GraphView settings={settings} onSettingsChange={reloadSettings} target={graphTarget} />}
          {view === 'argument' && <ArgumentMapView settings={settings} onBack={() => setView('graph')} />}
          {view === 'ideas' && <IdeasView onOpenGraph={(target) => navigate('graph', target)} onOpenAssistant={openAssistant} />}
          {view === 'authors' && <AuthorsView settings={settings} onOpenGraph={(target) => navigate('graph', target)} />}
          {view === 'study' && (
            <StudyGuideView
              settings={settings}
              onOpenGraph={(target) => navigate('graph', target)}
              onOpenAssistant={openAssistant}
            />
          )}
          {view === 'gaps' && (
            <GapsView
              onOpenGraph={(target) => navigate('graph', target)}
              onOpenAssistant={openAssistant}
              onOpenDebates={() => setView('debate')}
            />
          )}
          {view === 'debate' && (
            <DebateView onOpenGraph={(target) => navigate('graph', target)} onOpenAssistant={openAssistant} />
          )}
          {view === 'research' && (
            <ResearchMapView
              onOpenGraph={(target) => navigate('graph', target)}
              onOpenAssistant={openAssistant}
              onOpenDebates={() => setView('debate')}
            />
          )}
          {view === 'hypothesis' && (
            <HypothesisLabView
              settings={settings}
              onOpenGraph={(target) => navigate('graph', target)}
              onOpenAssistant={openAssistant}
            />
          )}
          {view === 'reading' && (
            <ReadingPathView onOpenGraph={(target) => navigate('graph', target)} onOpenAssistant={openAssistant} />
          )}
          {view === 'writing' && <WritingWorkshopView settings={settings} onOpenGraph={(target) => navigate('graph', target)} />}
          {view === 'deepResearch' && <DeepResearchView settings={settings} onOpenGraph={(target) => navigate('graph', target)} />}
          {view === 'projects' && <ProjectsView settings={settings} />}
          {view === 'search' && (
            <SearchView
              onOpenGraph={(target) => navigate('graph', target)}
              onOpenNote={openNoteFromSearch}
              onOpenGaps={() => setView('gaps')}
            />
          )}
          {view === 'notes' && (
            <NotesView onOpenGraph={(target) => navigate('graph', target)} focusNote={noteTarget} />
          )}
          {view === 'settings' && (
            <Settings
              settings={settings}
              vaults={vaults}
              activeVault={activeVault}
              onChange={reloadSettings}
              onVaultsChanged={reloadVaults}
            />
          )}
          </AppErrorBoundary>
        </main>
      </div>

      <div data-tour="queue">
        <QueueBar />
        <EmbeddingProgressBar />
        <PassageProgressBar />
      </div>

      <FeedbackHost />

      {paletteOpen && <CommandPalette commands={paletteCommands} onClose={() => setPaletteOpen(false)} />}

      {collectionsOpen && (
        <CollectionsModal
          settings={settings}
          onSettingsChange={reloadSettings}
          onClose={() => setCollectionsOpen(false)}
        />
      )}
      {researchOpen && (
        <ResearchAssistantModal
          settings={settings}
          initialTarget={assistantTarget}
          onClose={() => setResearchOpen(false)}
          onOpenGraph={openGraphFromAssistant}
        />
      )}

      {settings.onboardingComplete && !settings.tourComplete && (
        <Tour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ tourComplete: true });
            void reloadSettings();
          }}
        />
      )}

      {settings.onboardingComplete && settings.tourComplete && !settings.advancedTourComplete && (
        <AdvancedTour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ advancedTourComplete: true });
            void reloadSettings();
          }}
        />
      )}
    </div>
  );
}
