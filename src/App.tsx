import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppSettings, CorpusHealthBucketId, DatabaseSummary, SyncLogEntry, VaultSummary } from '@shared/types';
import { Onboarding } from './views/Onboarding';
import { HomeView, GenealogyHome, DatabasesHome } from './views/HomeView';
import { DatabasesView, CsvImportModal, type CsvImportPlanData } from './views/DatabasesView';
import { DatabasesAnalysisView } from './views/DatabasesAnalysisView';
import { DatabasesChatView } from './views/DatabasesChatView';
import { DatabasesSearchView } from './views/DatabasesSearchView';
import { StudyHome, StudyScaffoldView } from './views/StudyHome';
import { StudyOrganizationView } from './views/StudyOrganizationView';
import { StudyMaterialsView } from './views/StudyMaterialsView';
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
import { PersonasView } from './views/PersonasView';
import { TimelineView } from './views/TimelineView';
import { TreeView } from './views/TreeView';
import { RelationsView } from './views/RelationsView';
import { MapView } from './views/MapView';
import { ArchiveView } from './views/ArchiveView';
import { StudyGuideView } from './views/StudyGuideView';
import { ImmersionView } from './views/ImmersionView';
import { Settings } from './views/Settings';
import { CollectionsModal } from './views/CollectionsModal';
import { ResearchAssistantModal } from './views/ResearchAssistantModal';
import { FeedbackModal } from './views/FeedbackModal';
import { QueueBar } from './components/QueueBar';
import { EmbeddingProgressBar } from './components/EmbeddingProgressBar';
import { PassageProgressBar } from './components/PassageProgressBar';
import { VaultSwitcher, vaultTypeLabel } from './components/VaultSwitcher';
import { DatabasesSidebarExplore } from './components/DatabasesSidebarExplore';
import { StudySidebar, type StudyNavigationTarget } from './components/StudySidebar';
import { FeedbackHost } from './components/feedback';
import { Tour } from './views/Tour';
import { AdvancedTour } from './views/AdvancedTour';
import { GenealogyTour } from './views/GenealogyTour';
import { DatabasesTour } from './views/DatabasesTour';
import { WhatsNewModal } from './components/WhatsNewModal';
import { NodiMascot } from './components/nodi/NodiMascot';
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
import { effectiveSidebarHidden, isViewAllowedForVaultType, viewsDisallowedForType } from '@shared/vaultTypes';
import { CommandPalette, type Command } from './components/CommandPalette';
import nodusLogo from './assets/nodus-logo.svg';
import nodusLogoGold from './assets/nodus-logo-gold.svg';
import nodusLogoCrimson from './assets/nodus-logo-crimson.svg';
import nodusLogoTeal from './assets/nodus-logo-teal.svg';
import { buildDockIconDataUrl, dockColorForVaultType } from './dockIcon';

const STUDY_SCAFFOLD_VIEWS = new Set<View>([
  'studyQuestions',
  'studyTests',
  'studyExams',
  'studyPlanner',
  'studyReview',
  'studyProgress',
  'studyChat',
]);

// Shortcut label for the command palette: ⌘K on macOS, Ctrl K elsewhere.
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
const PALETTE_HINT = IS_MAC ? '⌘K' : 'Ctrl K';

/** Apply the light/dark root classes for a theme mode. 'system' resolves to the
 *  OS preference at call time; the App re-invokes this when that preference
 *  changes so the "system" mode tracks the OS live. */
function applyThemeClasses(theme: import('@shared/types').ThemeMode): boolean {
  const dark = theme === 'system'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : theme === 'dark';
  document.documentElement.classList.toggle('light', !dark);
  document.documentElement.classList.toggle('dark', dark);
  return dark;
}

/** Header action rendered as an icon that reveals its label on hover/focus, so the
 *  top bar's action rail stays a clean row of icons. Pass `showLabel` to keep the
 *  text pinned open (e.g. the primary action, or an alert that must be noticed). */
function HeaderAction({
  icon,
  label,
  onClick,
  title,
  primary = false,
  tone = '',
  spinning = false,
  showLabel = false,
  disabled = false,
  dataTour,
  kbd,
  vaultTrigger = false,
}: {
  icon: string;
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  primary?: boolean;
  tone?: string;
  spinning?: boolean;
  showLabel?: boolean;
  disabled?: boolean;
  dataTour?: string;
  kbd?: string;
  vaultTrigger?: boolean;
}) {
  return (
    <button
      data-tour={dataTour}
      data-vault-trigger={vaultTrigger ? '' : undefined}
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
      className={`group btn ${primary ? 'btn-primary' : 'btn-ghost'} h-9 min-h-9 justify-center gap-0 px-2.5 py-0 leading-none ${tone}`}
    >
      <Icon name={icon} className={`shrink-0 ${spinning ? 'animate-spin' : ''}`} />
      <span
        className={`flex items-center overflow-hidden whitespace-nowrap transition-all duration-200 ${
          showLabel
            ? 'ml-1.5 max-w-[14rem] opacity-100'
            : 'ml-0 max-w-0 opacity-0 group-hover:ml-1.5 group-hover:max-w-[14rem] group-hover:opacity-100 group-focus-visible:ml-1.5 group-focus-visible:max-w-[14rem] group-focus-visible:opacity-100'
        }`}
      >
        {label}
        {kbd && <kbd className="composer-kbd ml-1.5">{kbd}</kbd>}
      </span>
    </button>
  );
}

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [vaults, setVaults] = useState<VaultSummary[]>([]);
  const [activeVault, setActiveVault] = useState<VaultSummary | null>(null);
  // Resolved light/dark (accounts for 'system'); drives the macOS dock icon.
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const [view, setView] = useState<View>('home');
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem('nodus.navCollapsed') === '1');
  // Per-group collapse state for the sidebar (Explorar · Analizar · Escribir),
  // persisted so a user's folded groups survive restarts.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('nodus.collapsedGroups') || '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // The trigger element that opened the vault panel (the centre badge or the
  // right-rail vaults icon), or null when closed. The panel anchors under it.
  const [vaultAnchor, setVaultAnchor] = useState<HTMLElement | null>(null);
  const toggleVaults = useCallback(
    (el: HTMLElement) => setVaultAnchor((cur) => (cur === el ? null : el)),
    []
  );
  const [graphTarget, setGraphTarget] = useState<PendingGraphNavigationTarget & { nonce: number } | null>(null);
  const [libraryTarget, setLibraryTarget] = useState<PendingLibraryNavigationTarget & { nonce: number } | null>(null);
  const [assistantTarget, setAssistantTarget] = useState<PendingAssistantNavigationTarget & { nonce: number } | null>(null);
  // A note the user opened from global search; the nonce re-triggers even if the
  // same note is chosen twice.
  const [noteTarget, setNoteTarget] = useState<{ id: string; nonce: number } | null>(null);
  // A person opened from global search, to preselect in the Personas view.
  const [personsTarget, setPersonsTarget] = useState<{ id: string; nonce: number } | null>(null);
  const [studyTarget, setStudyTarget] = useState<StudyNavigationTarget | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncLogEntry | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // null while unknown; true when the DB holds any real or demo content.
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  // Sidebar sections grouped for rendering (Explorar · Analizar · Escribir),
  // each group in the user's chosen order, minus any hidden sections. Home is
  // pinned first and Settings last, both outside every group and never hidden.
  const navGroups = useMemo(() => {
    const hidden = effectiveSidebarHidden(
      settings?.sidebarHidden ?? [],
      settings?.sidebarCustomized ?? false,
      activeVault?.type
    );
    // Views scoped to other vault types are removed outright (not user-toggleable here).
    const disallowed = viewsDisallowedForType(
      NAV_ITEMS.map((n) => n.id),
      activeVault?.type
    );
    return groupedNav(settings?.sidebarOrder ?? [], [...hidden, ...disallowed]);
  }, [settings?.sidebarOrder, settings?.sidebarHidden, settings?.sidebarCustomized, activeVault?.type]);

  // If the active vault type doesn't allow the current view (e.g. switching from a
  // primary-source vault to an academic one while on Personas), fall back to Home.
  useEffect(() => {
    if (activeVault && !isViewAllowedForVaultType(view, activeVault.type)) setView('home');
  }, [activeVault?.type, view]);

  // Genealogy vaults wear a golden accent + logo instead of the indigo default.
  const isGenealogy = activeVault?.type === 'genealogy';
  useEffect(() => {
    document.documentElement.classList.toggle('genealogy', isGenealogy);
  }, [isGenealogy]);
  // Databases vaults wear the Nodus crimson (#B30333) accent.
  const isDatabases = activeVault?.type === 'databases';
  useEffect(() => {
    document.documentElement.classList.toggle('databases', isDatabases);
  }, [isDatabases]);
  // Study vaults use a calm teal accent and expose only their local learning tools.
  const isEstudio = activeVault?.type === 'estudio';
  useEffect(() => {
    document.documentElement.classList.toggle('estudio', isEstudio);
  }, [isEstudio]);

  // The user's databases (sidebar list) + the one currently open in the workspace.
  const [databases, setDatabases] = useState<DatabaseSummary[]>([]);
  const [activeDatabaseId, setActiveDatabaseId] = useState<string | null>(null);
  // A row to open in the record modal after navigating to its database (from search).
  const [pendingRecordId, setPendingRecordId] = useState<string | null>(null);
  const reloadDatabases = useCallback(async () => {
    if (!window.nodus) return [];
    const list = await window.nodus.listDatabases();
    setDatabases(list);
    return list;
  }, []);
  useEffect(() => {
    if (isDatabases) void reloadDatabases();
    else {
      setDatabases([]);
      setActiveDatabaseId(null);
    }
  }, [isDatabases, activeVault?.id, reloadDatabases]);
  // Keep a valid database selected: default to the first, and recover if the open
  // one was deleted.
  useEffect(() => {
    if (!isDatabases) return;
    if (databases.length === 0) {
      if (activeDatabaseId !== null) setActiveDatabaseId(null);
      return;
    }
    if (!activeDatabaseId || !databases.some((d) => d.id === activeDatabaseId)) {
      setActiveDatabaseId(databases[0].id);
    }
  }, [isDatabases, databases, activeDatabaseId]);
  const createDatabase = useCallback(async () => {
    if (!window.nodus) return;
    const created = await window.nodus.createDatabase(t('Base de datos nueva'), null);
    // Seed a starter title column so the table is usable immediately.
    await window.nodus.createDatabaseColumn(created.id, t('Nombre'), 'title');
    await reloadDatabases();
    setActiveDatabaseId(created.id);
    setView('databases');
  }, [reloadDatabases]);
  const [csvPlan, setCsvPlan] = useState<CsvImportPlanData | null>(null);
  const importCsv = useCallback(async () => {
    if (!window.nodus) return;
    const plan = await window.nodus.parseCsvForImport();
    if (plan) setCsvPlan(plan);
  }, []);

  const homeItem = NAV_ITEMS.find((n) => n.id === 'home')!;
  const settingsItem = NAV_ITEMS.find((n) => n.id === 'settings')!;
  const dbSearchItem = NAV_ITEMS.find((n) => n.id === 'dbSearch')!;
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
      setIsDark(applyThemeClasses(s.theme));
      return s;
    } catch (e) {
      setLoadError(tx('No se pudieron cargar los ajustes: {msg}', { msg: (e as Error).message }));
      return undefined;
    }
  }, []);

  useEffect(() => {
    void reloadSettings();
  }, [reloadSettings]);

  // In "system" theme mode, follow the OS light/dark preference as it changes.
  useEffect(() => {
    if (settings?.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setIsDark(applyThemeClasses('system'));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [settings?.theme]);

  // Repaint the macOS dock icon whenever the theme or the active vault changes:
  // white/near-black plate for light/dark, "N" tinted with the vault accent.
  // No-op on non-mac (main guards app.dock too).
  useEffect(() => {
    if (!IS_MAC || !window.nodus?.setDockIcon) return;
    let cancelled = false;
    void buildDockIconDataUrl(dockColorForVaultType(activeVault?.type), isDark).then((url) => {
      if (!cancelled && url) void window.nodus.setDockIcon(url);
    });
    return () => {
      cancelled = true;
    };
  }, [activeVault?.type, isDark]);

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

  const loadGenealogyDemo = useCallback(async () => {
    setDemoBusy(true);
    try {
      await window.nodus.seedGenealogyDemoData();
      await reloadSettings();
      await reloadVaults();
      await refreshHasData();
      notifyDataChanged();
      setView('tree');
    } finally {
      setDemoBusy(false);
    }
  }, [reloadSettings, reloadVaults, refreshHasData]);

  const loadDatabasesDemo = useCallback(async () => {
    setDemoBusy(true);
    try {
      await window.nodus.seedDatabasesDemoData();
      await reloadSettings();
      await reloadVaults();
      await reloadDatabases();
      await refreshHasData();
      notifyDataChanged();
      setView('home');
    } finally {
      setDemoBusy(false);
    }
  }, [reloadSettings, reloadVaults, reloadDatabases, refreshHasData]);

  // Cancel the onboarding wizard. If it is running for a freshly-created (non-main)
  // vault, discard that vault and fall back to another one; for the first-run main
  // vault there is nothing to discard, so just skip the wizard.
  const onboardingDiscardsVault = Boolean(activeVault && !activeVault.legacy && vaults.length > 1);
  const cancelOnboarding = useCallback(async () => {
    const other = vaults.find((v) => v.id !== activeVault?.id);
    if (activeVault && !activeVault.legacy && other) {
      await window.nodus.deleteVault(activeVault.id, true);
      await window.nodus.switchVault(other.id);
      await reloadVaults();
    } else {
      await window.nodus.updateSettings({ onboardingComplete: true });
    }
    await reloadSettings();
    setView('home');
  }, [vaults, activeVault, reloadVaults, reloadSettings]);

  const exitDemo = useCallback(async () => {
    setDemoBusy(true);
    try {
      await window.nodus.clearDemoData();
      await reloadSettings();
      await reloadVaults();
      await refreshHasData();
      notifyDataChanged();
      setView('home');
    } finally {
      setDemoBusy(false);
    }
  }, [reloadSettings, reloadVaults, refreshHasData]);

  const toggleNav = () => {
    setNavCollapsed((v) => {
      localStorage.setItem('nodus.navCollapsed', v ? '0' : '1');
      return !v;
    });
  };

  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem('nodus.collapsedGroups', JSON.stringify([...next]));
      return next;
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
      if (!(settings?.chatModel ?? settings?.synthesisModel)) {
        setView('settings');
        return;
      }
      setAssistantTarget(target ? { ...target, nonce: Date.now() } : null);
      setResearchOpen(true);
    },
    [settings?.chatModel, settings?.synthesisModel]
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
    ].filter((n) => isViewAllowedForVaultType(n.id, activeVault?.type));
    const navCommands: Command[] = bySection.map((n) => ({
      id: `nav:${n.id}`,
      label: t(n.label),
      section: n.group ? groupLabel.get(n.group)! : t('General'),
      icon: n.icon,
      run: () => setView(n.id),
    }));
    const actions: Command[] = [
      { id: 'act:assistant', label: t('Asistente de investigación'), section: t('Acciones'), icon: 'chat', keywords: 'assistant chat', run: () => openAssistant() },
      { id: 'act:feedback', label: t('Sugerir función o reportar error'), section: t('Acciones'), icon: 'gitPr', keywords: 'feedback github pr bug feature sugerencia error', run: () => setFeedbackOpen(true) },
    ];
    if (!isGenealogy && !isDatabases && !isEstudio) {
      actions.unshift(
        { id: 'act:sync', label: t('Actualizar (sincronizar Zotero)'), section: t('Acciones'), icon: 'sync', keywords: 'sync sincronizar', run: () => void onSync() },
        { id: 'act:collections', label: t('Colecciones'), section: t('Acciones'), icon: 'folder', keywords: 'collections zotero', run: () => setCollectionsOpen(true) },
      );
    }
    return [...navCommands, ...actions];
  }, [settings?.uiLanguage, activeVault?.type, isGenealogy, isDatabases, isEstudio, onSync, openAssistant]);

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
        activeVault={activeVault}
        providerKeys={settings.providerKeys}
        onLanguageChosen={reloadSettings}
        onDone={(nextView = 'home') => reloadSettings().then(() => setView(nextView))}
        onCancel={cancelOnboarding}
        discardsVault={onboardingDiscardsVault}
      />
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Top bar. `app-titlebar` makes the empty header area a drag region so the
          window can be moved (its interactive children are auto-marked no-drag in
          index.css). On macOS the traffic lights sit at the very top-left. */}
      <header className="app-titlebar relative flex items-center gap-4 px-4 py-2 border-b border-neutral-800">
        <button
          className="flex items-center gap-2 font-semibold text-lg tracking-tight rounded-lg px-1 -mx-1 hover:bg-neutral-900 transition-colors"
          onClick={toggleNav}
          title={navCollapsed ? t('Mostrar el menú lateral') : t('Ocultar el menú lateral (más espacio para el grafo)')}
        >
          <img
            data-testid="nodus-logo"
            data-vault-logo={isGenealogy ? 'genealogy' : isDatabases ? 'databases' : isEstudio ? 'estudio' : 'academic'}
            src={isGenealogy ? nodusLogoGold : isDatabases ? nodusLogoCrimson : isEstudio ? nodusLogoTeal : nodusLogo}
            alt=""
            className="h-7 w-7"
          />
          <span>Nodus</span>
          <Icon name={navCollapsed ? 'chevronRight' : 'chevronLeft'} size={14} className="text-neutral-600" />
        </button>

        {/* Vault mode, centered, in the vault's accent colour (gold in genealogy /
            crimson in databases via the accent-utility remaps). Clicking it opens
            the vault panel right under the badge (see VaultSwitcher). */}
        {activeVault && (
          <button
            data-vault-trigger
            className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border border-indigo-700/60 bg-indigo-950/30 px-3 py-0.5 text-xs font-semibold uppercase tracking-wide text-indigo-200 transition-colors hover:border-indigo-500 hover:bg-indigo-900/40 xl:inline-flex"
            title={t('Bóveda activa')}
            onClick={(e) => toggleVaults(e.currentTarget)}
          >
            <Icon name={isGenealogy ? 'tree' : isDatabases ? 'table' : isEstudio ? 'graduation' : 'network'} size={13} />
            {vaultTypeLabel(activeVault.type)}
            <Icon name="chevronDown" size={12} className={`transition-transform ${vaultAnchor ? 'rotate-180' : ''}`} />
          </button>
        )}

        <div className="flex-1" />
        {/* Right-side action rail: icon-only by default, each button reveals its
            label on hover/focus so the header reads as a clean row of icons. */}
        <div className="flex items-center gap-0.5">
          <HeaderAction
            dataTour="vaults"
            vaultTrigger
            icon="archive"
            label={activeVault?.name ?? t('Bóveda')}
            title={t('Bóveda activa')}
            onClick={(e) => toggleVaults(e.currentTarget)}
          />
          <HeaderAction
            icon="search"
            label={t('Comandos')}
            title={t('Paleta de comandos')}
            kbd={PALETTE_HINT}
            tone="text-neutral-400"
            onClick={() => setPaletteOpen(true)}
          />
          {(!settings.extractionModel || !settings.synthesisModel) && (
            <HeaderAction
              dataTour="model"
              icon="alert"
              label={t('Configura un modelo de IA')}
              tone="text-amber-500 dark:text-amber-400"
              showLabel
              onClick={() => setView('settings')}
            />
          )}
          <HeaderAction
            icon="chat"
            label={t('Asistente')}
            title={(settings.chatModel ?? settings.synthesisModel) ? t('Abrir asistente de investigación') : t('Configura un modelo de IA')}
            onClick={() => openAssistant()}
          />
          {/* Colecciones y Actualizar dependen de Zotero → solo en bóvedas
              académicas; genealogía y bases de datos no sincronizan con Zotero. */}
          {!isGenealogy && !isDatabases && !isEstudio && (
            <HeaderAction
              dataTour="collections"
              icon="folder"
              label={t('Colecciones')}
              onClick={() => setCollectionsOpen(true)}
            />
          )}
          <HeaderAction
            icon="gitPr"
            label={t('Sugerir / Reportar')}
            title={t('Enviar una propuesta o reporte a GitHub')}
            onClick={() => setFeedbackOpen(true)}
          />
          {!isGenealogy && !isDatabases && !isEstudio && (
            <HeaderAction
              dataTour="sync"
              icon="refresh"
              label={syncing ? t('Actualizando…') : t('Actualizar')}
              primary
              spinning={syncing}
              showLabel={syncing}
              disabled={syncing}
              onClick={onSync}
            />
          )}
        </div>

        <VaultSwitcher
          anchorEl={vaultAnchor}
          onClose={() => setVaultAnchor(null)}
          vaults={vaults}
          onVaultsChanged={reloadVaults}
          onActiveVaultChanged={handleActiveVaultChanged}
        />
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
              // A collapsible group header (chevron + label), optionally with a control
              // on the right (e.g. the "new database" +).
              const groupHeaderButton = (groupId: string, label: string, collapsed: boolean, hasActive: boolean) => (
                <button
                  onClick={() => toggleGroup(groupId)}
                  aria-expanded={!collapsed}
                  title={collapsed ? t('Mostrar grupo') : t('Plegar grupo')}
                  className={`flex items-center gap-1 flex-1 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-left transition-colors ${
                    collapsed && hasActive ? 'text-indigo-400' : 'text-neutral-600 hover:text-neutral-400'
                  }`}
                >
                  <Icon
                    name="chevronRight"
                    size={11}
                    className={`transition-transform duration-200 ${collapsed ? 'rotate-0' : 'rotate-90'}`}
                  />
                  {t(label)}
                </button>
              );
              const renderGroup = (group: (typeof navGroups)[number]) => {
                const collapsed = collapsedGroups.has(group.id);
                const hasActive = group.items.some((n) => n.id === view);
                return (
                  <div key={group.id} className="mt-2 flex flex-col gap-1">
                    <div className="flex items-center px-3">{groupHeaderButton(group.id, group.label, collapsed, hasActive)}</div>
                    {!collapsed && group.items.map((n) => navButton(n))}
                  </div>
                );
              };
              if (isDatabases) {
                // A databases vault keeps the same Explorar · Analizar · Escribir
                // structure as every other vault: the user's databases are the
                // Explorar content (rendered dynamically), then the Analysis + Chat
                // (Analizar) and Notes (Escribir) groups come through groupedNav.
                const exploreCollapsed = collapsedGroups.has('explore');
                const exploreLabel = NAV_GROUPS.find((g) => g.id === 'explore')?.label ?? 'Explorar';
                return (
                  <>
                    {navButton(homeItem)}
                    <div className="mt-2 flex flex-col gap-1" data-tour="db-list">
                      <div className="flex items-center px-3">
                        {groupHeaderButton('explore', exploreLabel, exploreCollapsed, view === 'databases')}
                        <button
                          onClick={() => void createDatabase()}
                          title={t('Nueva base de datos')}
                          className="text-neutral-500 hover:text-neutral-300"
                        >
                          <Icon name="plus" size={14} />
                        </button>
                      </div>
                      {!exploreCollapsed && navButton(dbSearchItem)}
                      {!exploreCollapsed && (
                        <DatabasesSidebarExplore
                          databases={databases}
                          activeId={activeDatabaseId}
                          isActiveView={view === 'databases'}
                          onOpen={(id) => {
                            setActiveDatabaseId(id);
                            setView('databases');
                          }}
                        />
                      )}
                    </div>
                    {navGroups.filter((group) => group.id !== 'explore').map((group) => renderGroup(group))}
                    <div className="mt-2 flex flex-col gap-1">{navButton(settingsItem)}</div>
                  </>
                );
              }
              if (isEstudio) {
                return (
                  <>
                    {navButton(homeItem)}
                    <StudySidebar
                      activeTarget={studyTarget}
                      activeView={view}
                      onOpen={(target) => { setStudyTarget(target); setView('studyCourses'); }}
                      onNavigate={(targetView) => { if (targetView === 'studyLibrary') setStudyTarget(null); setView(targetView); }}
                    />
                    {navGroups.filter((group) => group.id !== 'explore').map((group) => renderGroup(group))}
                    <div className="mt-2 flex flex-col gap-1">{navButton(settingsItem)}</div>
                  </>
                );
              }
              return (
                <>
                  {navButton(homeItem)}
                  {navGroups.map((group) => renderGroup(group))}
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
          {view === 'home' && isGenealogy && (
            <GenealogyHome
              settings={settings}
              onNavigate={(target) => navigate(target)}
              onOpenAssistant={() => openAssistant()}
              showDemoOffer={hasData === false && !settings.demoMode}
              demoBusy={demoBusy}
              onLoadDemo={loadDemo}
              onLoadGenealogyDemo={loadGenealogyDemo}
              onLoadDatabasesDemo={loadDatabasesDemo}
            />
          )}
          {view === 'home' && isDatabases && (
            <DatabasesHome
              databases={databases}
              onOpenDatabase={(id) => {
                setActiveDatabaseId(id);
                setView('databases');
              }}
              onNewDatabase={() => void createDatabase()}
              onImportCsv={() => void importCsv()}
              onOpenAnalysis={() => setView('dbAnalysis')}
              onOpenChat={() => setView('dbChat')}
              demoBusy={demoBusy}
              onLoadDatabasesDemo={loadDatabasesDemo}
            />
          )}
          {view === 'home' && isEstudio && (
            <StudyHome
              onNavigate={setView}
              onOpenDocument={(id) => { setStudyTarget({ kind: 'document', id }); setView('studyCourses'); }}
            />
          )}
          {view === 'home' && !isGenealogy && !isDatabases && !isEstudio && (
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
              onLoadGenealogyDemo={loadGenealogyDemo}
              onLoadDatabasesDemo={loadDatabasesDemo}
            />
          )}
          {view === 'library' && (
            <Library
              target={libraryTarget}
              vaultType={activeVault?.type}
              onOpenCollections={() => setCollectionsOpen(true)}
              onOpenGraph={(target) => navigate('graph', target)}
              onOpenAssistant={openAssistant}
              onOpenArchive={() => setView('archive')}
            />
          )}
          {view === 'graph' && <GraphView settings={settings} onSettingsChange={reloadSettings} target={graphTarget} />}
          {view === 'argument' && <ArgumentMapView settings={settings} />}
          {view === 'ideas' && <IdeasView onOpenGraph={(target) => navigate('graph', target)} onOpenAssistant={openAssistant} />}
          {view === 'authors' && <AuthorsView settings={settings} onOpenGraph={(target) => navigate('graph', target)} />}
          {view === 'persons' && <PersonasView initialPersonId={personsTarget} />}
          {view === 'timeline' && <TimelineView />}
          {view === 'tree' && <TreeView settings={settings} onSettingsChange={reloadSettings} />}
          {view === 'relations' && <RelationsView onOpenPersons={() => setView('persons')} />}
          {view === 'map' && <MapView />}
          {view === 'archive' && <ArchiveView onOpenLibrary={() => setView('library')} isGenealogy={isGenealogy} />}
          {view === 'databases' && (
            <DatabasesView
              databaseId={activeDatabaseId}
              onDatabasesChanged={reloadDatabases}
              onCreateDatabase={() => void createDatabase()}
              initialRowId={pendingRecordId}
              onConsumeInitialRow={() => setPendingRecordId(null)}
            />
          )}
          {view === 'dbSearch' && (
            <DatabasesSearchView
              onOpenDatabase={(id, rowId) => {
                setActiveDatabaseId(id);
                setPendingRecordId(rowId ?? null);
                setView('databases');
              }}
            />
          )}
          {view === 'dbAnalysis' && <DatabasesAnalysisView initialDatabaseId={activeDatabaseId} />}
          {view === 'dbChat' && <DatabasesChatView initialDatabaseId={activeDatabaseId} />}
          {view === 'studyCourses' && <StudyOrganizationView target={studyTarget} mode="organization" onTargetChange={setStudyTarget} />}
          {view === 'studyLibrary' && <StudyMaterialsView onOpenDocument={(id) => { setStudyTarget({ kind: 'document', id }); setView('studyCourses'); }} />}
          {STUDY_SCAFFOLD_VIEWS.has(view) && <StudyScaffoldView view={view} />}
          {view === 'study' && (
            <StudyGuideView
              settings={settings}
              onOpenGraph={(target) => navigate('graph', target)}
              onOpenAssistant={openAssistant}
            />
          )}
          {view === 'immersion' && (
            <ImmersionView settings={settings} onOpenGraph={(target) => navigate('graph', target)} />
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
          {view === 'deepResearch' && <DeepResearchView settings={settings} isGenealogy={isGenealogy} onOpenGraph={(target) => navigate('graph', target)} />}
          {view === 'projects' && <ProjectsView settings={settings} />}
          {view === 'search' && (
            <SearchView
              vaultType={activeVault?.type}
              onOpenGraph={(target) => navigate('graph', target)}
              onOpenNote={openNoteFromSearch}
              onOpenGaps={() => setView('gaps')}
              onOpenPerson={(id) => {
                setPersonsTarget({ id, nonce: Date.now() });
                setView('persons');
              }}
              onOpenTimeline={() => setView('timeline')}
              onOpenArchive={() => setView('archive')}
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
          isGenealogy={isGenealogy}
          onClose={() => setResearchOpen(false)}
          onOpenGraph={openGraphFromAssistant}
        />
      )}
      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}

      {settings.onboardingComplete && !settings.tourComplete && !isGenealogy && !isDatabases && !isEstudio && (
        <Tour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ tourComplete: true });
            void reloadSettings();
          }}
        />
      )}

      {settings.onboardingComplete && isGenealogy && !settings.genealogyTourComplete && (
        <GenealogyTour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ genealogyTourComplete: true });
            void reloadSettings();
          }}
        />
      )}

      {settings.onboardingComplete && isDatabases && !settings.databasesTourComplete && (
        <DatabasesTour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ databasesTourComplete: true });
            void reloadSettings();
          }}
        />
      )}

      {csvPlan && (
        <CsvImportModal
          plan={csvPlan}
          onClose={() => setCsvPlan(null)}
          onImported={(id) => {
            setCsvPlan(null);
            void reloadDatabases();
            setActiveDatabaseId(id);
            setView('databases');
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

      {settings.onboardingComplete &&
        (isGenealogy || isDatabases || isEstudio || settings.tourComplete) &&
        settings.advancedTourComplete &&
        (!isGenealogy || settings.genealogyTourComplete) &&
        (!isDatabases || settings.databasesTourComplete) && (
          <WhatsNewModal uiLanguage={settings.uiLanguage === 'en' ? 'en' : 'es'} />
        )}

      <NodiMascot settings={settings} />
    </div>
  );
}
