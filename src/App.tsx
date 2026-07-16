import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { AppSettings, CorpusHealthBucketId, DatabaseSummary, RecoveryStatus, SyncLogEntry, VaultSummary } from '@shared/types';
import { Onboarding } from './views/Onboarding';
import { HomeView, GenealogyHome, DatabasesHome } from './views/HomeView';
import type { CsvImportPlanData } from './views/DatabasesView';
import { FeedbackModal } from './views/FeedbackModal';
import { RoadmapModal } from './views/RoadmapModal';
import { QueueBar } from './components/QueueBar';
import { EmbeddingProgressBar } from './components/EmbeddingProgressBar';
import { PassageProgressBar } from './components/PassageProgressBar';
import { VaultSwitcher, vaultTypeIcon, vaultTypeLabel } from './components/VaultSwitcher';
import { DatabasesSidebarExplore } from './components/DatabasesSidebarExplore';
import { StudySidebar, type StudyNavigationTarget } from './components/StudySidebar';
import { PreviewVaultSidebar } from './components/PreviewVaultSidebar';
import { FeedbackHost } from './components/feedback';
import { Tour } from './views/Tour';
import { AdvancedTour } from './views/AdvancedTour';
import { GenealogyTour } from './views/GenealogyTour';
import { DatabasesTour } from './views/DatabasesTour';
import { StudyTour } from './views/StudyTour';
import { BASICS_TUTORIAL_VERSION, BasicsTutorial } from './views/BasicsTutorial';
import { preferencesForTutorialLanguage } from '@shared/tutorialPreferences';
import { hasPendingWhatsNew, WhatsNewModal } from './components/WhatsNewModal';
import { RecoverySetupWizard } from './views/RecoverySetupWizard';
import { NodiMascot } from './components/nodi/NodiMascot';
import { Icon } from './components/ui';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { t, tx, setActiveLang } from './i18n';
import { notifyDataChanged, useDataRefresh } from './hooks';
import { setActiveVaultQueryScope } from './vaultQueryCache';
import type {
  PendingAssistantNavigationTarget,
  PendingGraphNavigationTarget,
  PendingLibraryNavigationTarget,
  View,
} from './navigation';
import { groupedNav, NAV_ITEMS, NAV_GROUPS } from './navigation';
import { effectiveSidebarHidden, isPreviewVaultType, isViewAllowedForVaultType, viewsDisallowedForType } from '@shared/vaultTypes';
import { CommandPalette, type Command } from './components/CommandPalette';
import nodusLogo from './assets/nodus-logo.svg';
import nodusLogoGold from './assets/nodus-logo-gold.svg';
import nodusLogoCrimson from './assets/nodus-logo-crimson.svg';
import nodusLogoTeal from './assets/nodus-logo-teal.svg';
import { buildDockIconDataUrl, dockColorForVaultType } from './dockIcon';

const DatabasesView = lazy(() => import('./views/DatabasesView').then((module) => ({ default: module.DatabasesView })));
const CsvImportModal = lazy(() => import('./views/DatabasesView').then((module) => ({ default: module.CsvImportModal })));
const DatabasesAnalysisView = lazy(() => import('./views/DatabasesAnalysisView').then((module) => ({ default: module.DatabasesAnalysisView })));
const DatabasesChatView = lazy(() => import('./views/DatabasesChatView').then((module) => ({ default: module.DatabasesChatView })));
const DatabasesSearchView = lazy(() => import('./views/DatabasesSearchView').then((module) => ({ default: module.DatabasesSearchView })));
const StudyHome = lazy(() => import('./views/StudyHome').then((module) => ({ default: module.StudyHome })));
const StudyOrganizationView = lazy(() => import('./views/StudyOrganizationView').then((module) => ({ default: module.StudyOrganizationView })));
const StudyScheduleView = lazy(() => import('./views/StudyScheduleView').then((module) => ({ default: module.StudyScheduleView })));
const StudyCalendarView = lazy(() => import('./views/StudyCalendarView').then((module) => ({ default: module.StudyCalendarView })));
const StudyMaterialsView = lazy(() => import('./views/StudyMaterialsView').then((module) => ({ default: module.StudyMaterialsView })));
const StudyRecordingsView = lazy(() => import('./views/StudyRecordingsView').then((module) => ({ default: module.StudyRecordingsView })));
const StudySearchView = lazy(() => import('./views/StudySearchView').then((module) => ({ default: module.StudySearchView })));
const StudyBankView = lazy(() => import('./views/StudyBankView').then((module) => ({ default: module.StudyBankView })));
const StudyIdeasView = lazy(() => import('./views/StudyIdeasView').then((module) => ({ default: module.StudyIdeasView })));
const StudyGraphView = lazy(() => import('./views/StudyGraphView').then((module) => ({ default: module.StudyGraphView })));
const StudyChatView = lazy(() => import('./views/StudyChatView').then((module) => ({ default: module.StudyChatView })));
const StudyReviewView = lazy(() => import('./views/StudyReviewView').then((module) => ({ default: module.StudyReviewView })));
const Library = lazy(() => import('./views/Library').then((module) => ({ default: module.Library })));
const GraphView = lazy(() => import('./views/GraphView').then((module) => ({ default: module.GraphView })));
const GapsView = lazy(() => import('./views/GapsView').then((module) => ({ default: module.GapsView })));
const DebateView = lazy(() => import('./views/DebateView').then((module) => ({ default: module.DebateView })));
const ResearchMapView = lazy(() => import('./views/ResearchMapView').then((module) => ({ default: module.ResearchMapView })));
const HypothesisLabView = lazy(() => import('./views/HypothesisLabView').then((module) => ({ default: module.HypothesisLabView })));
const ReadingPathView = lazy(() => import('./views/ReadingPathView').then((module) => ({ default: module.ReadingPathView })));
const WritingWorkshopView = lazy(() => import('./views/WritingWorkshopView').then((module) => ({ default: module.WritingWorkshopView })));
const DeepResearchView = lazy(() => import('./views/DeepResearchView').then((module) => ({ default: module.DeepResearchView })));
const ProjectsView = lazy(() => import('./views/ProjectsView').then((module) => ({ default: module.ProjectsView })));
const NotesView = lazy(() => import('./views/NotesView').then((module) => ({ default: module.NotesView })));
const SearchView = lazy(() => import('./views/SearchView').then((module) => ({ default: module.SearchView })));
const ArgumentMapView = lazy(() => import('./views/ArgumentMapView').then((module) => ({ default: module.ArgumentMapView })));
const IdeasView = lazy(() => import('./views/IdeasView').then((module) => ({ default: module.IdeasView })));
const AuthorsView = lazy(() => import('./views/AuthorsView').then((module) => ({ default: module.AuthorsView })));
const PersonasView = lazy(() => import('./views/PersonasView').then((module) => ({ default: module.PersonasView })));
const TimelineView = lazy(() => import('./views/TimelineView').then((module) => ({ default: module.TimelineView })));
const TreeView = lazy(() => import('./views/TreeView').then((module) => ({ default: module.TreeView })));
const RelationsView = lazy(() => import('./views/RelationsView').then((module) => ({ default: module.RelationsView })));
const MapView = lazy(() => import('./views/MapView').then((module) => ({ default: module.MapView })));
const ArchiveView = lazy(() => import('./views/ArchiveView').then((module) => ({ default: module.ArchiveView })));
const ImmersionView = lazy(() => import('./views/ImmersionView').then((module) => ({ default: module.ImmersionView })));
const Settings = lazy(() => import('./views/Settings').then((module) => ({ default: module.Settings })));
const CollectionsModal = lazy(() => import('./views/CollectionsModal').then((module) => ({ default: module.CollectionsModal })));
const ResearchAssistantModal = lazy(() => import('./views/ResearchAssistantModal').then((module) => ({ default: module.ResearchAssistantModal })));

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
      className={`header-action group btn ${primary ? 'btn-primary' : 'btn-ghost'} h-9 min-h-9 justify-center px-2.5 py-0 leading-none ${tone}`}
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
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus | null>(null);
  const [whatsNewSettled, setWhatsNewSettled] = useState(() => !hasPendingWhatsNew());
  const [manualWhatsNewOpen, setManualWhatsNewOpen] = useState(false);
  useEffect(() => setActiveVaultQueryScope(activeVault?.id ?? null), [activeVault?.id]);
  // Resolved light/dark (accounts for 'system'); drives the macOS dock icon.
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const [view, setView] = useState<View>('home');
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem('nodus.navCollapsed') === '1');
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem('nodus.sidebarWidth'));
    return Number.isFinite(stored) ? Math.max(176, Math.min(360, stored)) : 176;
  });
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
  const [roadmapOpen, setRoadmapOpen] = useState(false);
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
  const [studyMaterialTarget, setStudyMaterialTarget] = useState<string | null>(null);
  const [studyRecordingTarget, setStudyRecordingTarget] = useState<{ id: string; timestamp?: number | null } | null>(null);
  const [studyGraphTarget, setStudyGraphTarget] = useState<PendingGraphNavigationTarget & { nonce: number } | null>(null);
  const [studyChatTarget, setStudyChatTarget] = useState<{ prompt: string; nonce: number } | null>(null);
  useEffect(() => { if (view !== 'studyGraph') setStudyGraphTarget(null); }, [view]);
  useEffect(() => { if (view !== 'studyChat') setStudyChatTarget(null); }, [view]);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncLogEntry | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // null while unknown; true when the DB holds any real or demo content.
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  const beginSidebarResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    document.body.classList.add('is-resizing-sidebar');
    const move = (pointerEvent: PointerEvent) => setSidebarWidth(Math.max(176, Math.min(360, startWidth + pointerEvent.clientX - startX)));
    const finish = (pointerEvent: PointerEvent) => {
      const width = Math.max(176, Math.min(360, startWidth + pointerEvent.clientX - startX));
      setSidebarWidth(width);
      localStorage.setItem('nodus.sidebarWidth', String(width));
      document.body.classList.remove('is-resizing-sidebar');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

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

  // Publish a bounded snapshot of the visible main view for Nodi's opt-in
  // "Vista actual" context. It remains in memory only and is never added to chat
  // history unless the user explicitly sends a message with that context enabled.
  useEffect(() => {
    if (!settings?.mascotEnabled) return;
    let timer: number | null = null;
    let idleId: number | null = null;
    let observer: MutationObserver | null = null;
    let lastText = '';
    const publish = () => {
      timer = null;
      idleId = null;
      const main = document.querySelector<HTMLElement>('main[data-nodi-view]');
      if (!main) return;
      const text = (main.innerText || '').slice(0, 12_000);
      if (text === lastText) return;
      lastText = text;
      const item = NAV_ITEMS.find((candidate) => candidate.id === view);
      void window.nodus.setNodiViewContext({
        viewId: view,
        title: item ? t(item.label) : view,
        text,
        capturedAt: Date.now(),
      });
    };
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      if (idleId !== null && window.cancelIdleCallback) window.cancelIdleCallback(idleId);
      timer = window.setTimeout(() => {
        timer = null;
        if (window.requestIdleCallback) idleId = window.requestIdleCallback(publish, { timeout: 1_000 });
        else publish();
      }, 500);
    };
    const attach = () => {
      const main = document.querySelector<HTMLElement>('main[data-nodi-view]');
      if (!main) { schedule(); return; }
      observer = new MutationObserver(schedule);
      observer.observe(main, { subtree: true, childList: true, characterData: true });
      schedule();
    };
    const attachTimer = window.setTimeout(attach, 0);
    return () => {
      window.clearTimeout(attachTimer);
      if (timer !== null) window.clearTimeout(timer);
      if (idleId !== null && window.cancelIdleCallback) window.cancelIdleCallback(idleId);
      observer?.disconnect();
    };
  }, [settings?.mascotEnabled, view]);

  useEffect(() => window.nodus.onNodiNavigate((target) => {
    if (target === 'settings') {
      localStorage.setItem('nodus.settingsTarget', 'nodi');
      setView('settings');
    }
  }), []);

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
  const isPreviewVault = isPreviewVaultType(activeVault?.type);
  useEffect(() => {
    document.documentElement.classList.toggle('estudio', isEstudio);
  }, [isEstudio]);

  // Accessibility preferences are applied at the document root so dialogs,
  // floating panels and every vault inherit them consistently.
  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    const scale = Math.max(0.85, Math.min(1.3, settings.interfaceScale || 1));
    root.style.setProperty('--interface-scale', String(scale));
    root.style.setProperty('--animation-speed', String(Math.max(0, Math.min(1, settings.animationSpeed))));
    root.classList.toggle('accessible-font', settings.accessibleFont);
    root.classList.toggle('high-contrast', settings.highContrast);
    root.classList.toggle('reduce-motion', settings.reduceMotion);
    root.classList.toggle('reading-focus', Boolean(isEstudio && settings.readingFocusMode));
  }, [settings, isEstudio]);

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

  const toggleTheme = useCallback(async () => {
    await window.nodus.updateSettings({ theme: isDark ? 'light' : 'dark' });
    await reloadSettings();
  }, [isDark, reloadSettings]);

  useEffect(() => {
    void reloadSettings();
  }, [reloadSettings]);

  useEffect(() => window.nodus?.onApiKeysRecovered(() => { void reloadSettings(); }), [reloadSettings]);

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

  const reloadRecoveryStatus = useCallback(async () => {
    if (!window.nodus) return null;
    const next = await window.nodus.getRecoveryStatus();
    setRecoveryStatus(next);
    return next;
  }, []);

  useEffect(() => {
    if (!settings || settings.basicsTutorialVersion === 0) return;
    void reloadRecoveryStatus();
  }, [reloadRecoveryStatus, settings?.basicsTutorialVersion, settings?.recoverySetupVersion, vaults.length]);

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

  const loadStudyDemo = useCallback(async () => {
    setDemoBusy(true);
    try {
      const seeded = await window.nodus.seedStudyDemoData();
      if (seeded) {
        await reloadSettings();
        await refreshHasData();
        notifyDataChanged();
        setView('home');
      }
    } finally {
      setDemoBusy(false);
    }
  }, [reloadSettings, refreshHasData]);

  // Cancel the onboarding wizard. If it is running for a freshly-created (non-main)
  // vault, discard that vault and fall back to another one; for the first-run main
  // vault there is nothing to discard, so just skip the wizard.
  const onboardingDiscardsVault = Boolean(activeVault && !activeVault.legacy && vaults.length > 1);
  const cancelOnboarding = useCallback(async () => {
    const other = vaults.find((v) => v.id !== activeVault?.id);
    if (activeVault && !activeVault.legacy && other) {
      const discardedVaultId = activeVault.id;
      const switched = await window.nodus.switchVault(other.id);
      if (!switched.ok) throw new Error(switched.message);
      await window.nodus.deleteVault(discardedVaultId, true);
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
    setStudyGraphTarget(null);
    setStudyChatTarget(null);
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
      { id: 'act:roadmap', label: t('Roadmap'), section: t('Acciones'), icon: 'route', keywords: 'roadmap hoja ruta futuro próximos pasos', run: () => setRoadmapOpen(true) },
      { id: 'act:theme', label: isDark ? t('Usar tema claro') : t('Usar tema oscuro'), section: t('Acciones'), icon: 'palette', keywords: 'tema theme claro oscuro', run: () => void window.nodus.updateSettings({ theme: isDark ? 'light' : 'dark' }).then(reloadSettings) },
      { id: 'act:motion', label: settings?.reduceMotion ? t('Activar animaciones') : t('Reducir animaciones'), section: t('Acciones'), icon: 'settings', keywords: 'accesibilidad movimiento animaciones motion', run: () => void window.nodus.updateSettings({ reduceMotion: !settings?.reduceMotion }).then(reloadSettings) },
    ];
    if (isEstudio) {
      actions.unshift({ id: 'act:reading-focus', label: settings?.readingFocusMode ? t('Salir del modo lectura') : t('Entrar en modo lectura'), section: t('Acciones'), icon: 'book', keywords: 'lectura enfoque focus estudio', run: () => void window.nodus.updateSettings({ readingFocusMode: !settings?.readingFocusMode }).then(reloadSettings) });
    }
    if (!isGenealogy && !isDatabases && !isEstudio) {
      actions.unshift(
        { id: 'act:sync', label: t('Actualizar (sincronizar Zotero)'), section: t('Acciones'), icon: 'sync', keywords: 'sync sincronizar', run: () => void onSync() },
        { id: 'act:collections', label: t('Colecciones'), section: t('Acciones'), icon: 'folder', keywords: 'collections zotero', run: () => setCollectionsOpen(true) },
      );
    }
    return [...navCommands, ...actions];
  }, [settings?.uiLanguage, settings?.reduceMotion, settings?.readingFocusMode, activeVault?.type, isGenealogy, isDatabases, isEstudio, isDark, onSync, openAssistant, reloadSettings]);

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

  // The cinematic guide owns first-run language selection. A positive value means
  // it has been seen and remains authoritative across every future app update;
  // Settings deliberately resets it to zero when the user asks to replay it.
  if (!isPreviewVault && settings.basicsTutorialVersion === 0) {
    return (
      <BasicsTutorial
        language={settings.uiLanguage}
        onLanguageChosen={async (language) => {
          await window.nodus.updateSettings(preferencesForTutorialLanguage(language));
          await reloadSettings();
        }}
        onComplete={async () => {
          await window.nodus.updateSettings({ basicsTutorialVersion: BASICS_TUTORIAL_VERSION });
          await reloadSettings();
        }}
      />
    );
  }

  if (!isPreviewVault && recoveryStatus === null) {
    return <div className="h-full flex items-center justify-center text-neutral-500">{t('Verificando la protección de tus datos…')}</div>;
  }

  // New installs see this immediately after the cinematic tutorial. Existing
  // installs first dismiss the release notes and then receive the migration wizard.
  if (!isPreviewVault && recoveryStatus?.needsSetup && (!recoveryStatus.previousInstallation || whatsNewSettled)) {
    return (
      <RecoverySetupWizard
        status={recoveryStatus}
        language={settings.uiLanguage === 'en' ? 'en' : 'es'}
        onComplete={async () => {
          await Promise.all([reloadSettings(), reloadVaults(), reloadRecoveryStatus()]);
        }}
      />
    );
  }

  if (!isPreviewVault && !settings.onboardingComplete) {
    return (
      <Onboarding
        activeVault={activeVault}
        settings={settings}
        providerKeys={settings.providerKeys}
        onDone={(nextView = 'home') => reloadSettings().then(() => setView(nextView))}
        onCancel={cancelOnboarding}
        discardsVault={onboardingDiscardsVault}
      />
    );
  }

  return (
    <div
      className="h-full flex flex-col"
      data-testid="app-shell"
      data-interface-scale={settings.interfaceScale}
      data-high-contrast={settings.highContrast ? 'true' : 'false'}
      data-reduce-motion={settings.reduceMotion ? 'true' : 'false'}
      data-reading-focus={isEstudio && settings.readingFocusMode ? 'true' : 'false'}
    >
      {/* Top bar. `app-titlebar` makes the empty header area a drag region so the
          window can be moved (its interactive children are auto-marked no-drag in
          index.css). On macOS the traffic lights sit at the very top-left. */}
      <header className="app-titlebar relative flex h-11 items-center border-b border-neutral-800">
        <button
          data-testid="sidebar-header-toggle"
          className="flex h-full shrink-0 items-center justify-center gap-2 px-2 font-semibold text-lg tracking-tight transition-colors hover:bg-neutral-900/70 focus-visible:bg-neutral-900/70"
          style={{ width: sidebarWidth }}
          onClick={toggleNav}
          title={navCollapsed ? t('Mostrar el menú lateral') : t('Ocultar el menú lateral (más espacio para el grafo)')}
          aria-label={navCollapsed ? t('Mostrar el menú lateral') : t('Ocultar el menú lateral (más espacio para el grafo)')}
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
            <Icon name={vaultTypeIcon(activeVault.type)} size={13} />
            {vaultTypeLabel(activeVault.type)}
            <Icon name="chevronDown" size={12} className={`transition-transform ${vaultAnchor ? 'rotate-180' : ''}`} />
          </button>
        )}

        <div className="flex-1" />
        {/* Right-side action rail: icon-only by default, each button reveals its
            label on hover/focus so the header reads as a clean row of icons. */}
        <div className="flex items-center gap-0.5 pr-4">
          <HeaderAction
            dataTour="vaults"
            vaultTrigger
            icon="archive"
            label={t('Bóvedas')}
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
          {!settings.synthesisModel && (
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
          <HeaderAction
            icon="route"
            label={t('Roadmap')}
            title={t('Ver roadmap de Nodus')}
            onClick={() => setRoadmapOpen(true)}
          />
          <HeaderAction
            icon={isDark ? 'sun' : 'moon'}
            label={isDark ? t('Usar tema claro') : t('Usar tema oscuro')}
            title={isDark ? t('Cambiar a modo claro') : t('Cambiar a modo oscuro')}
            onClick={() => void toggleTheme()}
            dataTour="theme-toggle"
          />
          <HeaderAction
            icon="settings"
            label={t('Ajustes')}
            title={t('Ajustes de la bóveda actual')}
            onClick={() => setView('settings')}
          />
        </div>

        <VaultSwitcher
          anchorEl={vaultAnchor}
          onClose={() => setVaultAnchor(null)}
          vaults={vaults}
          settings={settings}
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
          <nav data-testid="resizable-sidebar" className="relative shrink-0 overflow-hidden border-r border-neutral-800" style={{ width: sidebarWidth }}>
            <div data-testid="sidebar-scroll-region" className="mr-[6px] flex h-full min-h-0 flex-col gap-1 overflow-y-auto p-2">
              {(() => {
              const navButton = (n: { id: View; icon: string; label: string }, disabled = false) => (
                <button
                  key={n.id}
                  data-tour={`nav-${n.id}`}
                  disabled={disabled}
                  aria-disabled={disabled}
                  title={disabled ? t('Próximamente') : undefined}
                  onClick={() => { if (!disabled) setView(n.id); }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                    disabled ? 'cursor-not-allowed text-neutral-700 opacity-65' : view === n.id ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900'
                  }`}
                >
                  <Icon name={n.icon} className="opacity-70" />
                  {t(n.label)}
                  {disabled && <span className="ml-auto text-[9px] font-semibold uppercase tracking-wide">{t('Próximamente')}</span>}
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
              if (isPreviewVault && activeVault) {
                return <PreviewVaultSidebar type={activeVault.type} />;
              }
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
                      activeView={view}
                      onNavigate={(targetView) => { setStudyTarget(null); if (targetView !== 'studyLibrary') setStudyMaterialTarget(null); if (targetView !== 'studyRecordings') setStudyRecordingTarget(null); setStudyGraphTarget(null); setView(targetView); }}
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
            </div>
            <button
              data-testid="sidebar-resize-handle"
              type="button"
              className="sidebar-resize-handle"
              aria-label={t('Cambiar el ancho del menú lateral')}
              title={t('Arrastra para cambiar el ancho. Haz doble clic para restablecerlo.')}
              onPointerDown={beginSidebarResize}
              onDoubleClick={() => { setSidebarWidth(176); localStorage.setItem('nodus.sidebarWidth', '176'); }}
            />
          </nav>
        )}

        {/* Main view */}
        <main className="flex-1 min-w-0 overflow-hidden" data-nodi-view={view}>
          <Suspense fallback={<div className="grid h-full place-items-center text-sm text-neutral-500"><span className="flex items-center gap-2"><Icon name="sync" className="animate-spin" /> {t('Cargando...')}</span></div>}>
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
              showDemoOffer={!settings.demoMode}
              demoBusy={demoBusy}
              onLoadDemo={loadStudyDemo}
            />
          )}
          {view === 'home' && isPreviewVault && activeVault && (
            <div className="grid h-full place-items-center bg-neutral-50 p-8 text-center dark:bg-neutral-950" data-testid={`preview-vault-home-${activeVault.type}`}><div className="max-w-md"><Icon name={vaultTypeIcon(activeVault.type)} size={34} className="mx-auto mb-4 text-violet-500" /><span className="rounded border border-violet-500/50 bg-violet-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-300">PREVIEW</span><h1 className="mt-4 text-xl font-semibold">{vaultTypeLabel(activeVault.type)}</h1><p className="mt-2 text-sm leading-6 text-neutral-500">{t('Este vault muestra la estructura prevista. Sus secciones todavía no permiten realizar acciones.')}</p></div></div>
          )}
          {view === 'home' && !isGenealogy && !isDatabases && !isEstudio && !isPreviewVault && (
            <HomeView
              vaultId={activeVault?.id ?? null}
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
              vaultId={activeVault?.id ?? null}
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
          {view === 'ideas' && <IdeasView vaultId={activeVault?.id ?? null} onOpenGraph={(target) => navigate('graph', target)} onOpenAssistant={openAssistant} />}
          {view === 'authors' && <AuthorsView vaultId={activeVault?.id ?? null} settings={settings} onOpenGraph={(target) => navigate('graph', target)} />}
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
          {view === 'studyCourses' && <StudyOrganizationView target={studyTarget} mode="organization" onTargetChange={setStudyTarget} onOpenMaterial={(id) => { setStudyMaterialTarget(id); setView('studyLibrary'); }} onOpenRecording={(id, timestamp) => { setStudyRecordingTarget({ id, timestamp }); setView('studyRecordings'); }} />}
          {view === 'studySchedule' && <StudyScheduleView />}
          {view === 'studyCalendar' && <StudyCalendarView />}
          {view === 'studySearch' && <StudySearchView
            onOpenDocument={(id) => { setStudyTarget({ kind: 'document', id }); setView('studyCourses'); }}
            onOpenMaterial={(id) => { setStudyMaterialTarget(id); setView('studyLibrary'); }}
            onOpenRecording={(id, timestamp) => { setStudyRecordingTarget({ id, timestamp }); setView('studyRecordings'); }}
          />}
          {view === 'studyLibrary' && <StudyMaterialsView initialMaterialId={studyMaterialTarget} onOpenDocument={(id) => { setStudyTarget({ kind: 'document', id }); setView('studyCourses'); }} />}
          {view === 'studyRecordings' && <StudyRecordingsView initialRecordingId={studyRecordingTarget?.id} initialTimestamp={studyRecordingTarget?.timestamp} onOpenDocument={(id) => { setStudyTarget({ kind: 'document', id }); setView('studyCourses'); }} />}
          {view === 'studyChat' && <StudyChatView
            settings={settings}
            initialPrompt={studyChatTarget?.prompt}
            onOpenDocument={(id) => { setStudyTarget({ kind: 'document', id }); setView('studyCourses'); }}
            onOpenMaterial={(id) => { setStudyMaterialTarget(id); setView('studyLibrary'); }}
            onOpenRecording={(id, timestamp) => { setStudyRecordingTarget({ id, timestamp: timestamp ?? null }); setView('studyRecordings'); }}
          />}
          {view === 'studyIdeas' && <StudyIdeasView
            vaultId={activeVault?.id ?? null}
            onOpenGraph={(target) => { setStudyGraphTarget({ ...target, nonce: Date.now() }); setView('studyGraph'); }}
            onOpenAssistant={(target) => { setStudyChatTarget({ prompt: target?.prompt ?? '', nonce: Date.now() }); setView('studyChat'); }}
            onOpenMaterial={(id) => { setStudyMaterialTarget(id); setView('studyLibrary'); }}
            onOpenDocument={(id) => { setStudyTarget({ kind: 'document', id }); setView('studyCourses'); }}
          />}
          {view === 'studyGraph' && <StudyGraphView
            settings={settings}
            onSettingsChange={reloadSettings}
            target={studyGraphTarget}
            onOpenMaterial={(id) => { setStudyMaterialTarget(id); setView('studyLibrary'); }}
            onOpenDocument={(id) => { setStudyTarget({ kind: 'document', id }); setView('studyCourses'); }}
          />}
          {view === 'studyQuestions' && <StudyBankView
            onOpenDocument={(id) => { setStudyTarget({ kind: 'document', id }); setView('studyCourses'); }}
            onOpenMaterial={(id) => { setStudyMaterialTarget(id); setView('studyLibrary'); }}
            onOpenRecording={(id, timestamp) => { setStudyRecordingTarget({ id, timestamp: timestamp ?? null }); setView('studyRecordings'); }}
          />}
          {view === 'studyReview' && <StudyReviewView />}
          {view === 'studyDeepResearch' && <DeepResearchView
            settings={settings}
            isStudy
            onOpenGraph={(target) => navigate('graph', target)}
            onOpenStudyDocument={(id) => { setStudyTarget({ kind: 'document', id }); setView('studyCourses'); }}
            onOpenStudyMaterial={(id) => { setStudyMaterialTarget(id); setView('studyLibrary'); }}
            onOpenStudyRecording={(id, timestamp) => { setStudyRecordingTarget({ id, timestamp }); setView('studyRecordings'); }}
          />}
          {view === 'immersion' && (
            <ImmersionView settings={settings} onOpenGraph={(target) => navigate('graph', target)} />
          )}
          {view === 'gaps' && (
            <GapsView
              vaultId={activeVault?.id ?? null}
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
              onOpenWhatsNew={() => setManualWhatsNewOpen(true)}
            />
          )}
          </AppErrorBoundary>
          </Suspense>
        </main>
      </div>

      <div data-tour="queue">
        <QueueBar />
        <EmbeddingProgressBar />
        <PassageProgressBar />
      </div>

      <FeedbackHost />

      {paletteOpen && <CommandPalette commands={paletteCommands} onClose={() => setPaletteOpen(false)} />}

      <Suspense fallback={null}>
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
      {roadmapOpen && <RoadmapModal onClose={() => setRoadmapOpen(false)} />}

      {!isPreviewVault && settings.onboardingComplete && settings.basicsTutorialVersion > 0 && !settings.tourComplete && !isGenealogy && !isDatabases && !isEstudio && (
        <Tour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ tourComplete: true });
            void reloadSettings();
          }}
        />
      )}

      {settings.onboardingComplete && settings.basicsTutorialVersion > 0 && isGenealogy && !settings.genealogyTourComplete && (
        <GenealogyTour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ genealogyTourComplete: true });
            void reloadSettings();
          }}
        />
      )}

      {settings.onboardingComplete && settings.basicsTutorialVersion > 0 && isDatabases && !settings.databasesTourComplete && (
        <DatabasesTour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ databasesTourComplete: true });
            void reloadSettings();
          }}
        />
      )}

      {settings.onboardingComplete && settings.basicsTutorialVersion > 0 && isEstudio && !settings.studyTourComplete && (
        <StudyTour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ studyTourComplete: true });
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
      </Suspense>

      {!isPreviewVault && settings.onboardingComplete && settings.basicsTutorialVersion > 0 && settings.tourComplete && !settings.advancedTourComplete && (
        <AdvancedTour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ advancedTourComplete: true });
            void reloadSettings();
          }}
        />
      )}

      {!isPreviewVault && settings.onboardingComplete &&
        settings.basicsTutorialVersion > 0 &&
        !recoveryStatus?.needsSetup &&
        (isGenealogy || isDatabases || isEstudio || settings.tourComplete) &&
        settings.advancedTourComplete &&
        (!isGenealogy || settings.genealogyTourComplete) &&
        (!isDatabases || settings.databasesTourComplete) &&
        (!isEstudio || settings.studyTourComplete) && (
          <WhatsNewModal uiLanguage={settings.uiLanguage === 'en' ? 'en' : 'es'} />
        )}

      {!isPreviewVault && recoveryStatus?.needsSetup && recoveryStatus.previousInstallation && !whatsNewSettled && (
        <WhatsNewModal
          uiLanguage={settings.uiLanguage === 'en' ? 'en' : 'es'}
          onSettled={() => setWhatsNewSettled(true)}
        />
      )}

      {manualWhatsNewOpen && (
        <WhatsNewModal
          uiLanguage={settings.uiLanguage === 'en' ? 'en' : 'es'}
          showSeenReleaseNotes
          onSettled={() => setManualWhatsNewOpen(false)}
        />
      )}

      <NodiMascot settings={settings} />
    </div>
  );
}
