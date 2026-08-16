import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, CorpusHealthBucketId, DatabaseSummary, NodiNotification, RecoveryStatus, ServerInboxEntry, SyncLogEntry, VaultSummary } from '@shared/types';
import type { AnnouncementRefreshResult } from '@shared/announcements';
import type { CsvImportPlanData } from './views/DatabasesView';
import { FeedbackModal } from './views/FeedbackModal';
import { RoadmapFeedbackModal, type RoadmapTopicKey } from './views/RoadmapFeedbackModal';
import { RoadmapModal } from './views/RoadmapModal';
import { QueueBar } from './components/QueueBar';
import { EmbeddingProgressBar } from './components/EmbeddingProgressBar';
import { PassageProgressBar } from './components/PassageProgressBar';
import { VaultSwitcher, vaultTypeIcon, vaultTypeLabel } from './components/VaultSwitcher';
import { ServerInbox } from './components/ServerInbox';
import { unreadServerInboxGroupCount } from './serverInboxGrouping';
import { NotificationsPanel, useAnnouncements } from './components/NotificationsPanel';
import { DatabasesSidebarExplore } from './components/DatabasesSidebarExplore';
import { StudySidebar, type StudyNavigationTarget } from './components/StudySidebar';
import { TeachingSidebar } from './components/TeachingSidebar';
import { PrimarySourcesSidebar } from './components/PrimarySourcesSidebar';
import { CONTINUITY_VIEWS, ContinuityProvider } from './components/world/ContinuityBadge';
import { WorldbuildingSidebar } from './components/WorldbuildingSidebar';
import { ProsopographySidebar } from './components/ProsopographySidebar';
import { TestimonySidebar } from './components/TestimonySidebar';
import type { DossierTab } from './components/testimonies/InterviewDossier';
import type { TestimonyDeepLink } from '@shared/testimonyDeepLinks';
import { FeedbackHost } from './components/feedback';
import { PrivacyRequestHost } from './privacyNotices';
import { Tour } from './views/Tour';
import { AdvancedTour } from './views/AdvancedTour';
import { GenealogyTour } from './views/GenealogyTour';
import { DatabasesTour } from './views/DatabasesTour';
import { TestimonyTour } from './views/TestimonyTour';
import { StudyTour } from './views/StudyTour';
import { TeachingTour } from './views/TeachingTour';
import { PrimarySourcesTour } from './views/PrimarySourcesTour';
import { ProsopographyTour } from './views/ProsopographyTour';
import { WorldbuildingTour } from './views/WorldbuildingTour';
import { FIRST_VAULT_VERSION } from './views/FirstVaultSetup';
import { hasPendingWhatsNew, WhatsNewModal } from './components/WhatsNewModal';
import { TutorialVideosUpdateTour } from './components/TutorialVideosGuide';
import { PlatformHighlightsUpdateTour } from './components/PlatformHighlightsGuide';
import { ToolkitBetaUpdateTour } from './components/ToolkitBetaGuide';
import { StartupUpdateModal } from './components/StartupUpdateModal';
import { MobileTeaserGuide } from './components/MobileTeaserGuide';
import { recoveryHealthAdvice, recoveryHealthHeadline } from './recoveryHealth';
import { NodiMascot } from './components/nodi/NodiMascot';
import { NodiStyleModal } from './components/NodiStyleModal';
import { HoverLabelButton, Icon } from './components/ui';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { t, tx, setActiveLang } from './i18n';
import { resolveStartupGate } from './app/StartupGate';
import { VIEW_REGISTRY } from './app/viewRegistry';
import type { ViewContext } from './app/ViewContext';
import { notifyDataChanged, useDataRefresh } from './hooks';
import { setActiveVaultQueryScope } from './vaultQueryCache';
import { viewSnapshotAccess } from './app/viewSnapshots';
import type {
  PendingAssistantNavigationTarget,
  PendingGraphNavigationTarget,
  PendingIdeaNavigationTarget,
  PendingLibraryNavigationTarget,
  View,
} from './navigation';
import { dedicatedVaultNavIds, groupedNav, NAV_ITEMS, NAV_GROUPS } from './navigation';
import type { ToolkitPage } from './navigation';
import { placeHeaderBadge, type HeaderBadgePlacement } from './headerLayout';
import { effectiveSidebarHidden, isPreviewVaultType, isViewAllowedForVaultType, normalizeVaultType, viewsDisallowedForType } from '@shared/vaultTypes';
import { CommandPalette, type Command } from './components/CommandPalette';
import nodusLogo from './assets/nodus-logo.svg';
import nodusLogoGold from './assets/nodus-logo-gold.svg';
import nodusLogoCrimson from './assets/nodus-logo-crimson.svg';
import nodusLogoTeal from './assets/nodus-logo-teal.svg';
import nodusLogoOrange from './assets/nodus-logo-orange.svg';
import nodusLogoViolet from './assets/nodus-logo-violet.svg';
import nodusLogoCyan from './assets/nodus-logo-cyan.svg';
import { buildDockIconDataUrl, dockColorForVaultType } from './dockIcon';

const CsvImportModal = lazy(() => import('./views/DatabasesView').then((module) => ({ default: module.CsvImportModal })));
const CollectionsModal = lazy(() => import('./views/CollectionsModal').then((module) => ({ default: module.CollectionsModal })));
const ResearchAssistantModal = lazy(() => import('./views/ResearchAssistantModal').then((module) => ({ default: module.ResearchAssistantModal })));

// Shortcut label for the command palette: ⌘K on macOS, Ctrl K elsewhere.
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
const PALETTE_HINT = IS_MAC ? '⌘K' : 'Ctrl K';
const SIDEBAR_MIN_WIDTH = 64;
const SIDEBAR_DEFAULT_WIDTH = 176;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_COMPACT_THRESHOLD = 144;
// Below this width the full wordmark would enter macOS's hiddenInset traffic-light
// area. The icon itself remains visible and centred over the compact sidebar; only
// the decorative word is hidden.
const MACOS_FULL_SIDEBAR_BRAND_MIN_WIDTH = 248;

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
 *  top bar's action rail stays a clean row of icons. Every action shares the same
 *  ghost styling so none stands out; pass `showLabel` to keep the text pinned open
 *  (e.g. an action in progress, or an alert that must be noticed). */
function HeaderAction({
  icon,
  label,
  onClick,
  title,
  tone = '',
  spinning = false,
  showLabel = false,
  disabled = false,
  dataTour,
  kbd,
  vaultTrigger = false,
  inboxTrigger = false,
  notificationsTrigger = false,
}: {
  icon: string;
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  tone?: string;
  spinning?: boolean;
  showLabel?: boolean;
  disabled?: boolean;
  dataTour?: string;
  kbd?: string;
  vaultTrigger?: boolean;
  /** Lets the Inbox panel's outside-click handler ignore its own trigger, so it toggles. */
  inboxTrigger?: boolean;
  /** Same, for the notifications panel. */
  notificationsTrigger?: boolean;
}) {
  return (
    <HoverLabelButton
      data-tour={dataTour}
      data-vault-trigger={vaultTrigger ? '' : undefined}
      data-inbox-trigger={inboxTrigger ? '' : undefined}
      data-notifications-trigger={notificationsTrigger ? '' : undefined}
      icon={icon}
      label={label}
      title={title}
      onClick={onClick}
      disabled={disabled}
      spinning={spinning}
      showLabel={showLabel}
      className={`btn-ghost h-9 min-h-9 ${tone}`}
      trailing={kbd ? <kbd className="composer-kbd ml-1.5">{kbd}</kbd> : undefined}
    />
  );
}

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [vaults, setVaults] = useState<VaultSummary[]>([]);
  const [activeVault, setActiveVault] = useState<VaultSummary | null>(null);
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus | null>(null);
  const [backupWarningDismissed, setBackupWarningDismissed] = useState(false);
  const [whatsNewSettled, setWhatsNewSettled] = useState(() => !hasPendingWhatsNew());
  const [manualWhatsNewOpen, setManualWhatsNewOpen] = useState(false);
  // The mobile app does not exist in this build, so there is no tutorial chapter that
  // could have covered it: every 3.2.4 user gets the teaser once, new install or not.
  const [mobileTeaserSettled, setMobileTeaserSettled] = useState(false);
  // Existing users receive the current MCP/Server/Zotero/Toolkit overview directly
  // after release notes. Fresh installs already saw the same three chapters in v5.
  const [platformHighlightsSettled, setPlatformHighlightsSettled] = useState(false);
  // The 2.4.0 toolkit/model guide queues directly behind release notes. Its own
  // versioned guard settles immediately for new installs and for users who saw it.
  const [toolkitBetaTourSettled, setToolkitBetaTourSettled] = useState(false);
  // Users who completed the essential guide before the video tutorials existed were
  // never asked "video or text", so the catalogue is announced to them once, here.
  const [tutorialVideosSettled, setTutorialVideosSettled] = useState(false);
  // Set once the startup update check is done with the screen, so the one-time Nodi
  // choice can queue up behind it instead of fighting it for the foreground.
  const [updateSettled, setUpdateSettled] = useState(false);
  // Whether this RUN began before the essential guide had ever been completed — i.e.
  // whether the person at the keyboard is meeting Nodus for the first time. Captured
  // from the first settings read and never recomputed, because both flags the
  // first-vault chooser depends on flip while the app is running: reading them live
  // would shut the chooser the instant the guide set `basicsTutorialVersion`.
  const newInstallRef = useRef<boolean | null>(null);
  const [newInstall, setNewInstall] = useState(false);
  useEffect(() => setActiveVaultQueryScope(activeVault?.id ?? null), [activeVault?.id]);
  // Where each section was when it was last left. It lives above the single render
  // point because that is what survives the unmount, and outside React state
  // because it is read only when a section mounts: as state, every keystroke in a
  // search box would re-render the whole shell. The active vault is bound in once,
  // here, so no section can read another vault's cut.
  const snapshots = useMemo(() => viewSnapshotAccess(activeVault?.id ?? null), [activeVault?.id]);
  // Resolved light/dark (accounts for 'system'); drives the macOS dock icon.
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const [view, setView] = useState<View>('home');
  // Página activa dentro de Herramientas. Vive aquí (y no en ToolkitView) porque
  // el sidebar navega directamente a una herramienta, y porque así salir de la
  // sección y volver no pierde el sitio aunque la vista se desmonte.
  const [toolkitPage, setToolkitPage] = useState<ToolkitPage>('home');
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem('nodus.navCollapsed') === '1');
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem('nodus.sidebarWidth'));
    return Number.isFinite(stored)
      ? Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, stored))
      : SIDEBAR_DEFAULT_WIDTH;
  });
  const sidebarCompact = sidebarWidth <= SIDEBAR_COMPACT_THRESHOLD;
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
  // Planned teaching section whose feedback thread is open, if any.
  const [roadmapTopic, setRoadmapTopic] = useState<RoadmapTopicKey | null>(null);
  const [roadmapOpen, setRoadmapOpen] = useState(false);
  // The trigger element that opened the vault panel (the centre badge or the
  // right-rail vaults icon), or null when closed. The panel anchors under it.
  const [vaultAnchor, setVaultAnchor] = useState<HTMLElement | null>(null);
  // What has arrived from other devices. Loaded once and then PUSHED: unlike the Settings
  // overview, which polls every three seconds, there is nothing here worth asking about
  // when nothing has happened — the poller tells the window when something has.
  const [inboxAnchor, setInboxAnchor] = useState<HTMLElement | null>(null);
  const [inbox, setInbox] = useState<ServerInboxEntry[]>([]);
  // The notification centre. Same two lists Nodi shows, reachable without Nodi.
  const [notificationsAnchor, setNotificationsAnchor] = useState<HTMLElement | null>(null);
  const [notifications, setNotifications] = useState<NodiNotification[]>([]);
  const [refreshingNotifications, setRefreshingNotifications] = useState(false);
  const {
    announcements,
    unread: unreadAnnouncements,
    markRead: markAnnouncementRead,
    refresh: refreshNotificationSources,
  } = useAnnouncements();
  // Live placement of the centred vault badge. Both rails around it change width
  // (the logo tracks the sidebar; the action rail grows when a button pins or
  // reveals its label), so the badge is measured rather than pinned at 50% — see
  // headerLayout.ts.
  //
  // These are callback refs held in state, not useRef: the header renders only past
  // the loading/tutorial/onboarding returns below, and the measurement has to start
  // the moment those four boxes attach. A plain ref cannot say when that happened,
  // so the effect would have to guess from unrelated deps — and a wrong guess leaves
  // the badge unmeasured and invisible until some later state change happens to
  // re-run it. Storing the nodes makes attachment itself the trigger.
  const [headerEl, setHeaderEl] = useState<HTMLElement | null>(null);
  const [headerLogoEl, setHeaderLogoEl] = useState<HTMLElement | null>(null);
  const [headerActionsEl, setHeaderActionsEl] = useState<HTMLElement | null>(null);
  const [vaultBadgeEl, setVaultBadgeEl] = useState<HTMLElement | null>(null);
  const [vaultBadgePlacement, setVaultBadgePlacement] = useState<HeaderBadgePlacement | null>(null);
  const toggleVaults = useCallback(
    (el: HTMLElement) => setVaultAnchor((cur) => (cur === el ? null : el)),
    []
  );
  const toggleInbox = useCallback(
    (el: HTMLElement) => setInboxAnchor((cur) => (cur === el ? null : el)),
    []
  );
  // Opening the panel clears the ACTIVITY feed only — "I have seen these" is all that
  // list ever means. An announcement stays unread until it is read one at a time.
  const toggleNotifications = useCallback((el: HTMLElement) => {
    setNotificationsAnchor((cur) => {
      if (cur === el) return null;
      if (notifications.some((notification) => !notification.read)) {
        void window.nodus.markNotificationsRead().then(setNotifications).catch(() => {});
      }
      return el;
    });
  }, [notifications]);
  const refreshNotificationCenter = useCallback(async (): Promise<AnnouncementRefreshResult> => {
    if (refreshingNotifications) return { status: 'not-modified', checkedAt: Date.now() };
    setRefreshingNotifications(true);
    try {
      const snapshot = await refreshNotificationSources();
      setNotifications(snapshot.notifications);
      return snapshot.refresh;
    } catch {
      // The notification centre deliberately keeps the last good lists when the public
      // announcements file is unreachable. The panel renders this status inline.
      return { status: 'error', checkedAt: Date.now() };
    } finally {
      setRefreshingNotifications(false);
    }
  }, [refreshNotificationSources, refreshingNotifications]);
  const [graphTarget, setGraphTarget] = useState<PendingGraphNavigationTarget & { nonce: number } | null>(null);
  const [ideaTarget, setIdeaTarget] = useState<PendingIdeaNavigationTarget & { nonce: number } | null>(null);
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
  const [primarySourceTarget, setPrimarySourceTarget] = useState<{
    itemId: string;
    excerptId?: string | null;
    textVersionId?: string | null;
    startOffset?: number | null;
    endOffset?: number | null;
    nonce: number;
  } | null>(null);
  const openPrimarySourceTarget = useCallback((target: {
    itemId: string;
    excerptId?: string | null;
    textVersionId?: string | null;
    startOffset?: number | null;
    endOffset?: number | null;
  }) => {
    setPrimarySourceTarget({ ...target, nonce: Date.now() });
    setView('archive');
  }, []);
  useEffect(() => {
    const openPrimarySource = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail as
        | { itemId?: unknown; excerptId?: unknown }
        | null;
      if (typeof detail?.itemId !== 'string' || typeof detail.excerptId !== 'string') return;
      setPrimarySourceTarget({
        itemId: detail.itemId,
        excerptId: detail.excerptId,
        nonce: Date.now(),
      });
      setView('archive');
    };
    window.addEventListener('nodus:navigate-primary-source', openPrimarySource);
    return () => window.removeEventListener('nodus:navigate-primary-source', openPrimarySource);
  }, []);
  useEffect(() => { if (view !== 'studyGraph') setStudyGraphTarget(null); }, [view]);
  useEffect(() => { if (view !== 'studyChat') setStudyChatTarget(null); }, [view]);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncLogEntry | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // null while unknown; true when the DB holds any real or demo content.
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  const beginSidebarResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.focus();
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    document.body.classList.add('is-resizing-sidebar');
    const move = (pointerEvent: PointerEvent) => setSidebarWidth(Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, startWidth + pointerEvent.clientX - startX)));
    const finish = (pointerEvent: PointerEvent) => {
      const width = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, startWidth + pointerEvent.clientX - startX));
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

  const resizeSidebarWithKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const requestedWidth = event.key === 'Home'
      ? SIDEBAR_MIN_WIDTH
      : event.key === 'End'
        ? SIDEBAR_MAX_WIDTH
        : event.key === 'ArrowLeft'
          ? sidebarWidth - 8
          : event.key === 'ArrowRight'
            ? sidebarWidth + 8
            : null;
    if (requestedWidth === null) return;
    event.preventDefault();
    const width = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, requestedWidth));
    setSidebarWidth(width);
    localStorage.setItem('nodus.sidebarWidth', String(width));
  };

  const unreadInbox = useMemo(() => unreadServerInboxGroupCount(inbox), [inbox]);
  // One count for one button: an unread announcement and an unread activity line both
  // mean "there is something here you have not seen".
  const unreadNotifications = useMemo(
    () => unreadAnnouncements + notifications.reduce((n, x) => n + (x.read ? 0 : 1), 0),
    [unreadAnnouncements, notifications]
  );

  // Load the inbox once and then let the main process push it. The poller broadcasts after
  // any batch that produced entries, and the mutators return the fresh list themselves, so
  // nothing here has to ask on a timer.
  useEffect(() => {
    void window.nodus.listServerInbox().then(setInbox).catch(() => undefined);
    return window.nodus.onServerInboxChanged(setInbox);
  }, [activeVault?.id]);

  // Same pattern for the activity feed, which the main process pushes whenever a job
  // finishes. Nodi subscribes to the very same channel, so both stay in step.
  useEffect(() => {
    void window.nodus.listNotifications().then(setNotifications).catch(() => undefined);
    return window.nodus.onNotificationsChanged(setNotifications);
  }, []);

  // Sidebar sections grouped for rendering (Explorar · Analizar · Escribir),
  // each group in the user's chosen order, minus any hidden sections. Home is
  // pinned first and Settings last, both outside every group and never hidden.
  const activeSidebarHidden = useMemo(
    () => effectiveSidebarHidden(
      settings?.sidebarHidden ?? [],
      settings?.sidebarCustomized ?? false,
      activeVault?.type
    ),
    [settings?.sidebarHidden, settings?.sidebarCustomized, activeVault?.type],
  );

  const navGroups = useMemo(() => {
    // Views scoped to other vault types are removed outright (not user-toggleable here).
    const disallowed = viewsDisallowedForType(
      NAV_ITEMS.map((n) => n.id),
      activeVault?.type
    );
    const dedicatedIds = dedicatedVaultNavIds(activeVault?.type);
    const outsideDedicatedWorkspace = dedicatedIds
      ? NAV_ITEMS.filter((item) => item.id !== 'home' && item.id !== 'settings' && !dedicatedIds.includes(item.id)).map((item) => item.id)
      : [];
    return groupedNav(settings?.sidebarOrder ?? [], ['library', ...activeSidebarHidden, ...disallowed, ...outsideDedicatedWorkspace]);
  }, [settings?.sidebarOrder, activeSidebarHidden, activeVault?.type]);

  // If the active vault type doesn't allow the current view (e.g. switching from a
  // primary-source vault to an academic one while on Personas), fall back to Home.
  useEffect(() => {
    if (activeVault && !isViewAllowedForVaultType(view, activeVault.type)) setView('home');
  }, [activeVault?.type, view]);

  // Publish a bounded snapshot of the visible main view for Nodi's opt-in
  // "Vista actual" context. Document readers instead expose a hidden,
  // explicit source containing the complete report/immersion instead. It remains
  // in memory only and is never added to chat history unless the user sends with
  // that context enabled. Quoting enables Nodi first, which mounts this publisher
  // and captures the document synchronously before the user can send the question.
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
      const explicit = main.querySelector<HTMLElement>('[data-nodi-context-source="document"]');
      const complete = Boolean(explicit);
      const text = complete ? (explicit?.textContent || '') : (main.innerText || '').slice(0, 12_000);
      const explicitTitle = explicit?.dataset.nodiContextTitle?.trim();
      if (text === lastText) return;
      lastText = text;
      const item = NAV_ITEMS.find((candidate) => candidate.id === view);
      void window.nodus.setNodiViewContext({
        viewId: view,
        title: explicitTitle || (item ? t(item.label) : view),
        text,
        capturedAt: Date.now(),
        ...(complete ? { complete: true } : {}),
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
    } else {
      setView(target.view);
    }
  }), []);

  // Genealogy vaults wear a golden accent + logo instead of the indigo default.
  const isGenealogy = activeVault?.type === 'genealogy';
  useEffect(() => {
    document.documentElement.classList.toggle('genealogy', isGenealogy);
  }, [isGenealogy]);
  const isPrimarySources = activeVault?.type === 'primary_sources';
  useEffect(() => {
    document.documentElement.classList.toggle('primary-sources', isPrimarySources);
  }, [isPrimarySources]);
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
  // Teaching vaults wear an orange accent and reuse the study organisation surfaces.
  const isDocencia = activeVault?.type === 'docencia';
  useEffect(() => {
    document.documentElement.classList.toggle('docencia', isDocencia);
  }, [isDocencia]);
  // Worldbuilding vaults wear a violet accent and render their own sidebar; the
  // character section is built on the shared person ontology.
  const isWorldbuilding = activeVault?.type === 'worldbuilding';
  useEffect(() => {
    document.documentElement.classList.toggle('worldbuilding', isWorldbuilding);
  }, [isWorldbuilding]);
  // Prosopography is an evidence-first blue workspace with a strict dedicated shell.
  const isProsopography = activeVault?.type === 'prosopography';
  // 'academic' es también el tipo al que resuelve cualquier bóveda anterior a los tipos,
  // así que se pregunta por lo que NO es en vez de por lo que es.
  const isAcademic = normalizeVaultType(activeVault?.type) === 'academic' && !isPreviewVault;
  useEffect(() => {
    document.documentElement.classList.toggle('prosopography', isProsopography);
  }, [isProsopography]);
  // Testimonios: acento cian y sidebar propio de cinco entradas. Reutiliza la ontología
  // de personas para los participantes y Notas para los memos del investigador.
  const isTestimonios = activeVault?.type === 'testimonios';
  // Apertura profunda de una entrevista (desde Inicio, Buscar, Contrastes o un enlace
  // `nodus://testimonios/...`). El nonce fuerza la reapertura aunque sea la misma.
  const [testimonyTarget, setTestimonyTarget] = useState<{ interviewId: string; tab?: DossierTab; nonce: number } | null>(null);
  const openTestimonyInterview = useCallback((interviewId: string, tab?: DossierTab) => {
    setTestimonyTarget({ interviewId, tab, nonce: Date.now() });
    setView('testimonyInterviews');
  }, []);
  /**
   * Abrir un enlace `nodus://testimonios/...`.
   *
   * Un fragmento abre la pestaña de Análisis, que es donde se ve la cita con su código y
   * su tramo; una entrevista sin más abre el Resumen. Los enlaces de otra bóveda no
   * llevan a ninguna parte a propósito: el destino tiene que pertenecer a la bóveda
   * activa, y abrir «algo parecido» sería peor que no abrir nada.
   */
  const openTestimonyLink = useCallback((link: TestimonyDeepLink) => {
    if (link.target === 'interview') {
      setTestimonyTarget({
        interviewId: link.id,
        tab: link.annotationId ? 'analysis' : link.transcriptId || link.sessionId ? 'sessions' : 'overview',
        nonce: Date.now(),
      });
      setView('testimonyInterviews');
      return;
    }
    if (link.target === 'participant') {
      setView('testimonyParticipants');
      return;
    }
    setView('testimonyContrasts');
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('testimonios', isTestimonios);
  }, [isTestimonios]);

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
  const libraryItem = NAV_ITEMS.find((n) => n.id === 'library')!;
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

  // Decide once, from the first settings this run sees, whether this is a first meeting.
  // The same pass stamps `firstVaultVersion` on any install that already completed the
  // guide: without it, an existing user who replays the guide from Settings and then
  // restarts would look brand new and have their vault renamed under them.
  useEffect(() => {
    if (!settings || newInstallRef.current !== null) return;
    const fresh = settings.basicsTutorialVersion === 0;
    newInstallRef.current = fresh;
    setNewInstall(fresh);
    if (!fresh && settings.firstVaultVersion === 0) {
      void window.nodus.updateSettings({ firstVaultVersion: FIRST_VAULT_VERSION });
    }
  }, [settings]);

  useEffect(() => window.nodus?.onApiKeysRecovered(() => { void reloadSettings(); }), [reloadSettings]);
  // Settings may also change outside this React tree (notably from the floating
  // Nodi window). Keep visibility, theme and every settings-backed control in sync.
  useEffect(() => window.nodus?.onSettingsChanged(() => { void reloadSettings(); }), [reloadSettings]);

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

  const loadTeachingDemo = useCallback(async () => {
    setDemoBusy(true);
    try {
      const seeded = await window.nodus.seedTeachingDemoData();
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

  const loadPrimarySourcesDemo = useCallback(async () => {
    setDemoBusy(true);
    try {
      const seeded = await window.nodus.seedPrimarySourcesDemoData();
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

  const loadTestimonyDemo = useCallback(async () => {
    setDemoBusy(true);
    try {
      const seeded = await window.nodus.seedTestimonyDemoData();
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

  const loadWorldbuildingDemo = useCallback(async () => {
    setDemoBusy(true);
    try {
      const seeded = await window.nodus.seedWorldbuildingDemoData();
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

  // Keep the vault badge centred without letting either rail reach it. Both rails
  // resize for reasons React never re-renders for — the action rail animates open
  // on hover, the logo follows a pointer-driven sidebar drag — so the measurement
  // is driven by a ResizeObserver over the boxes themselves rather than by the
  // render cycle. The badge is absolutely positioned, so moving it cannot resize
  // the rails back: no feedback loop.
  useLayoutEffect(() => {
    if (!headerEl || !headerLogoEl || !headerActionsEl || !vaultBadgeEl) {
      setVaultBadgePlacement(null);
      return undefined;
    }
    const measure = () => {
      setVaultBadgePlacement((previous) => {
        const next = placeHeaderBadge({
          headerWidth: headerEl.clientWidth,
          logoWidth: headerLogoEl.offsetWidth,
          actionsWidth: headerActionsEl.offsetWidth,
          badgeWidth: vaultBadgeEl.offsetWidth,
        });
        // Bail out when nothing moved: the observer fires on every frame of the
        // rail's open/close animation and each state write would re-render the app.
        if (previous && previous.fits === next.fits && Math.abs(previous.left - next.left) < 0.5) return previous;
        return next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const box of [headerEl, headerLogoEl, headerActionsEl, vaultBadgeEl]) observer.observe(box);
    return () => observer.disconnect();
  }, [headerEl, headerLogoEl, headerActionsEl, vaultBadgeEl]);

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
    setLibraryTarget({ scope: 'vault', healthBucket, nonce: Date.now() });
    setView('library');
  }, []);

  useEffect(() => {
    if (!window.nodus?.onCopilotOpenIdea) return undefined;
    return window.nodus.onCopilotOpenIdea((target) => {
      if (target.destination === 'library-citation-styles') {
        setLibraryTarget({ scope: 'global', citationStyles: true, nonce: Date.now() });
        setView('library');
        return;
      }
      if (target.destination === 'ideas') {
        setIdeaTarget({ ideaId: target.ideaId, nonce: Date.now() });
        setView('ideas');
        return;
      }
      navigate('graph', {
        preset: 'overview',
        nodeId: target.ideaId,
        label: target.label ? `${t('Idea:')} ${target.label}` : t('Idea de Nodus'),
      });
    });
  }, [navigate]);

  useEffect(() => {
    if (!window.nodus?.onZoteroPluginOpen) return undefined;
    return window.nodus.onZoteroPluginOpen((target) => {
      if (target.kind !== 'library-reader' || !target.id) return;
      setLibraryTarget({ scope: 'global', readerItemId: target.id, nonce: Date.now() });
      setView('library');
    });
  }, []);

  // Una nota se abre con la misma experiencia de catálogo y pestañas, bajo el nombre
  // Espacio de trabajo en la académica y Notas en las demás bóvedas.
  const openNoteFromSearch = useCallback((id: string) => {
    setNoteTarget({ id, nonce: Date.now() });
    setView(isAcademic ? 'workspace' : 'notes');
  }, [isAcademic]);

  const openAssistant = useCallback(
    (target?: PendingAssistantNavigationTarget) => {
      if (!(settings?.chatModel ?? settings?.synthesisModel)) {
        setView('settings');
        return;
      }
      if (isWorldbuilding) {
        setResearchOpen(false);
        setView('worldChat');
        return;
      }
      setAssistantTarget(target ? { ...target, nonce: Date.now() } : null);
      setResearchOpen(true);
    },
    [isWorldbuilding, settings?.chatModel, settings?.synthesisModel]
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
    setIdeaTarget(null);
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
    const dedicatedIds = dedicatedVaultNavIds(activeVault?.type);
    const bySection = [
      ...NAV_ITEMS.filter((n) => !n.group),
      ...NAV_GROUPS.flatMap((g) => NAV_ITEMS.filter((n) => n.group === g.id)),
    ].filter((n) =>
      isViewAllowedForVaultType(n.id, activeVault?.type)
      && (!dedicatedIds || n.id === 'home' || n.id === 'settings' || dedicatedIds.includes(n.id))
    );
    const navCommands: Command[] = bySection.map((n) => ({
      id: `nav:${n.id}`,
      label: t(n.label),
      section: n.group ? groupLabel.get(n.group)! : t('General'),
      icon: n.icon,
      run: () => setView(n.id),
    }));
    const actions: Command[] = [
      // The last resort for the vault panel: the badge that opens it is placed by
      // measurement and can, in a window narrow enough, have nowhere to go.
      { id: 'act:vaults', label: t('Bóvedas'), section: t('Acciones'), icon: 'archive', keywords: 'vaults bovedas boveda cambiar crear renombrar duplicar eliminar', run: () => { const badge = document.querySelector<HTMLElement>('[data-testid="header-vault-badge"]'); if (badge) toggleVaults(badge); } },
      { id: 'act:assistant', label: t(isWorldbuilding ? 'Chat del mundo' : 'Asistente de investigación'), section: t('Acciones'), icon: 'chat', keywords: 'assistant chat', run: () => openAssistant() },
      { id: 'act:presenter', label: 'PDF Presenter', section: t('Acciones'), icon: 'presentation', keywords: 'presentar diapositivas slides pdf presenter proyector herramientas toolkit', run: () => { setToolkitPage('presenter'); setView('toolkit'); } },
      { id: 'act:feedback', label: t('Sugerir función o reportar error'), section: t('Acciones'), icon: 'gitPr', keywords: 'feedback github pr bug feature sugerencia error', run: () => setFeedbackOpen(true) },
      { id: 'act:roadmap', label: t('Roadmap'), section: t('Acciones'), icon: 'route', keywords: 'roadmap hoja ruta futuro próximos pasos', run: () => setRoadmapOpen(true) },
      { id: 'act:theme', label: isDark ? t('Usar tema claro') : t('Usar tema oscuro'), section: t('Acciones'), icon: 'palette', keywords: 'tema theme claro oscuro', run: () => void window.nodus.updateSettings({ theme: isDark ? 'light' : 'dark' }).then(reloadSettings) },
      { id: 'act:motion', label: settings?.reduceMotion ? t('Activar animaciones') : t('Reducir animaciones'), section: t('Acciones'), icon: 'settings', keywords: 'accesibilidad movimiento animaciones motion', run: () => void window.nodus.updateSettings({ reduceMotion: !settings?.reduceMotion }).then(reloadSettings) },
    ];
    if (isEstudio) {
      actions.unshift({ id: 'act:reading-focus', label: settings?.readingFocusMode ? t('Salir del modo lectura') : t('Entrar en modo lectura'), section: t('Acciones'), icon: 'book', keywords: 'lectura enfoque focus estudio', run: () => void window.nodus.updateSettings({ readingFocusMode: !settings?.readingFocusMode }).then(reloadSettings) });
    }
    if (!isPrimarySources && !isGenealogy && !isDatabases && !isEstudio && !isDocencia && !isWorldbuilding && !isProsopography && !isTestimonios) {
      actions.unshift(
        { id: 'act:sync', label: t('Actualizar (sincronizar Zotero)'), section: t('Acciones'), icon: 'sync', keywords: 'sync sincronizar', run: () => void onSync() },
        { id: 'act:collections', label: t('Colecciones de Zotero'), section: t('Acciones'), icon: 'folder', keywords: 'collections zotero', run: () => setCollectionsOpen(true) },
      );
    }
    return [...navCommands, ...actions];
  }, [settings?.uiLanguage, settings?.reduceMotion, settings?.readingFocusMode, activeVault?.type, isPrimarySources, isGenealogy, isDatabases, isEstudio, isDocencia, isWorldbuilding, isProsopography, isTestimonios, isDark, onSync, openAssistant, reloadSettings, toggleVaults]);

  // The startup sequence, as an ordered list of guards rather than a run of early
  // returns. It also sets this render's authoritative language, which is why it is
  // called before anything below reads `settings`.
  const startupGate = resolveStartupGate({
    loadError,
    settings,
    activeVault,
    recoveryStatus,
    isPreviewVault,
    newInstall,
    whatsNewSettled,
    onboardingDiscardsVault,
    clearLoadError: () => setLoadError(null),
    reloadSettings,
    reloadVaults,
    reloadRecoveryStatus,
    cancelOnboarding,
    setView,
  });
  if (startupGate) return startupGate;
  if (!settings) return null; // unreachable: the settings guard above owns this case

  // Everything the sections need from the shell, assembled once. Built after the
  // startup gate so `settings` is known to be there, which is what lets a renderer
  // read `ctx.settings` without a null check of its own.
  const viewContext: ViewContext = {
    settings,
    activeVault,
    vaults,
    recoveryStatus,
    isAcademic,
    isGenealogy,
    isPrimarySources,
    isDatabases,
    isEstudio,
    isDocencia,
    isWorldbuilding,
    isTestimonios,
    isProsopography,
    isPreviewVault,
    snapshots,
    hasData,
    demoBusy,
    lastSync,
    syncing,
    databases,
    activeDatabaseId,
    pendingRecordId,
    toolkitPage,
    graphTarget,
    ideaTarget,
    libraryTarget,
    noteTarget,
    personsTarget,
    testimonyTarget,
    primarySourceTarget,
    studyTarget,
    studyMaterialTarget,
    studyRecordingTarget,
    studyGraphTarget,
    studyChatTarget,
    setView,
    navigate,
    setToolkitPage,
    reloadSettings,
    reloadVaults,
    reloadDatabases,
    openAssistant,
    openLibraryBucket,
    openNoteFromSearch,
    openPrimarySourceTarget,
    openTestimonyInterview,
    openTestimonyLink,
    onSync,
    setNoteTarget,
    setPersonsTarget,
    setPrimarySourceTarget,
    setStudyTarget,
    setStudyMaterialTarget,
    setStudyRecordingTarget,
    setStudyGraphTarget,
    setStudyChatTarget,
    setActiveDatabaseId,
    setPendingRecordId,
    setCollectionsOpen,
    setManualWhatsNewOpen,
    setRoadmapOpen,
    createDatabase,
    importCsv,
    loadDemo,
    loadGenealogyDemo,
    loadDatabasesDemo,
    loadPrimarySourcesDemo,
    loadStudyDemo,
    loadTeachingDemo,
    loadWorldbuildingDemo,
    loadTestimonyDemo,
  };

  return (
    <div
      className="h-full flex flex-col"
      style={{ '--vault-accent': dockColorForVaultType(activeVault?.type) } as React.CSSProperties}
      data-testid="app-shell"
      data-interface-scale={settings.interfaceScale}
      data-high-contrast={settings.highContrast ? 'true' : 'false'}
      data-reduce-motion={settings.reduceMotion ? 'true' : 'false'}
      data-reading-focus={isEstudio && settings.readingFocusMode ? 'true' : 'false'}
    >
      {/* Top bar. `app-titlebar` makes the empty header area a drag region so the
          window can be moved (its interactive children are auto-marked no-drag in
          index.css). On macOS the traffic lights sit at the very top-left. */}
      <header
        ref={setHeaderEl}
        className="app-titlebar relative flex h-11 items-center border-b border-neutral-800"
        data-platform={IS_MAC ? 'macos' : 'other'}
      >
        <button
          ref={setHeaderLogoEl}
          data-testid="sidebar-header-toggle"
          className="relative flex h-full shrink-0 items-center justify-center px-2 font-semibold text-lg tracking-tight transition-colors hover:bg-neutral-900/70 focus-visible:bg-neutral-900/70"
          style={{ width: sidebarWidth }}
          onClick={toggleNav}
          title={navCollapsed ? t('Mostrar el menú lateral') : t('Ocultar el menú lateral (más espacio para el grafo)')}
          aria-label={navCollapsed ? t('Mostrar el menú lateral') : t('Ocultar el menú lateral (más espacio para el grafo)')}
        >
          <span data-testid="sidebar-header-brand" className="flex items-center justify-center gap-2" style={{ transform: sidebarCompact && IS_MAC ? 'translateY(0.5625rem)' : undefined }}>
            <img
              data-testid="nodus-logo"
              data-vault-logo={isPrimarySources ? 'primary_sources' : isGenealogy ? 'genealogy' : isDatabases ? 'databases' : isEstudio ? 'estudio' : isDocencia ? 'docencia' : isWorldbuilding ? 'worldbuilding' : isTestimonios ? 'testimonios' : isProsopography ? 'prosopography' : 'academic'}
              src={isGenealogy ? nodusLogoGold : isDatabases ? nodusLogoCrimson : isEstudio ? nodusLogoTeal : isDocencia ? nodusLogoOrange : isWorldbuilding ? nodusLogoViolet : isTestimonios ? nodusLogoCyan : nodusLogo}
              alt=""
              className={sidebarCompact && IS_MAC
                ? 'h-[18px] w-[18px]'
                : sidebarCompact || (IS_MAC && sidebarWidth < MACOS_FULL_SIDEBAR_BRAND_MIN_WIDTH)
                  ? 'h-6 w-6'
                  : 'h-7 w-7'}
            />
            <span className={sidebarCompact || (IS_MAC && sidebarWidth < MACOS_FULL_SIDEBAR_BRAND_MIN_WIDTH) ? 'sr-only' : undefined}>Nodus</span>
          </span>
          {!sidebarCompact && (
            <Icon
              name={navCollapsed ? 'chevronRight' : 'chevronLeft'}
              size={14}
              className="absolute right-2 text-neutral-600"
            />
          )}
        </button>

        {/* Vault mode, centred, in the vault's accent colour (gold in genealogy /
            crimson in databases via the accent-utility remaps). Clicking it opens
            the vault panel right under the badge (see VaultSwitcher).
            Its `left` is measured, not pinned at 50%: the rails on either side
            change width and must never reach it (see headerLayout.ts). Until the
            first measurement lands it stays invisible rather than flashing at a
            position it is about to leave. */}
        {activeVault && (
          <button
            ref={setVaultBadgeEl}
            data-vault-trigger
            data-tour="vault-badge"
            data-testid="header-vault-badge"
            data-badge-fits={vaultBadgePlacement ? String(vaultBadgePlacement.fits) : undefined}
            aria-expanded={Boolean(vaultAnchor)}
            style={{
              left: vaultBadgePlacement ? `${vaultBadgePlacement.left}px` : '50%',
              visibility: vaultBadgePlacement?.fits ? 'visible' : 'hidden',
            }}
            className="header-vault-badge absolute top-1/2 inline-flex -translate-y-1/2 items-center gap-1.5 rounded-full border border-indigo-700/60 bg-indigo-950/30 px-3 py-0.5 text-xs font-semibold uppercase tracking-wide text-indigo-200 transition-colors hover:border-indigo-500 hover:bg-indigo-900/40"
            title={t('Bóveda activa')}
            onClick={(e) => toggleVaults(e.currentTarget)}
          >
            <Icon name={vaultTypeIcon(activeVault.type)} size={13} />
            {/* The badge is now the only permanent way into the vault panel, so it is
                shown at every width — the LABEL is what gives way on a narrow window,
                not the button. Dropping the word leaves an icon-and-chevron chip that
                fits in a band where the full badge would not. */}
            <span className="hidden xl:inline">{vaultTypeLabel(activeVault.type)}</span>
            <Icon name="chevronDown" size={12} className={`transition-transform ${vaultAnchor ? 'rotate-180' : ''}`} />
          </button>
        )}

        <div className="flex-1" />
        {/* Right-side action rail: icon-only by default, each button reveals its
            label on hover/focus so the header reads as a clean row of icons. It
            grows leftwards as labels open, which is why the centre badge measures
            it instead of assuming a fixed clearance. */}
        <div ref={setHeaderActionsEl} data-testid="header-actions" className="header-action-rail flex min-w-0 items-center justify-end gap-0.5 overflow-hidden pr-4">
          {/* No Bóvedas button: the centred badge is the way in, and it is now shown at
              every width for exactly that reason (see the badge above). */}
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
            title={(settings.chatModel ?? settings.synthesisModel) ? t(isWorldbuilding ? 'Abrir chat del mundo' : 'Abrir asistente de investigación') : t('Configura un modelo de IA')}
            onClick={() => openAssistant()}
          />
          <HeaderAction
            dataTour="toolkit"
            icon="tools"
            label={t('Herramientas')}
            title={t('Abrir Nodus Toolkit')}
            onClick={() => { setToolkitPage('home'); setView('toolkit'); }}
          />
          {/* Colecciones ya no vive aquí: sigue a un comando de distancia («Colecciones»
              en la paleta) y su sitio natural es la configuración de Zotero. */}
          {/* Inside the measured actions box on purpose: the ResizeObserver above feeds
              placeHeaderBadge, which keeps this rail from ever reaching the centred vault
              badge. A badge positioned outside this box is exactly what that geometry
              cannot see. The wrapper is what the count hangs off — HoverLabelButton's
              `trailing` slot sits inside a label span that is max-w-0 until hover.

              Only shown once something has actually arrived: the inbox is per vault and
              only means anything for a connected one, so on a local install it was a
              permanently empty icon sitting next to a bell that is never empty. */}
          {inbox.length > 0 && (
            <span className="relative inline-flex">
              <HeaderAction
                icon="inbox"
                label={t('Bandeja')}
                title={t('Lo que ha llegado de otros dispositivos')}
                inboxTrigger
                onClick={(e) => toggleInbox(e.currentTarget)}
              />
              {unreadInbox > 0 && (
                <span className="header-action-badge">{unreadInbox > 9 ? '9+' : unreadInbox}</span>
              )}
            </span>
          )}
          <HeaderAction
            icon="gitPr"
            label={t('Sugerir / Reportar')}
            title={t('Enviar una propuesta o reporte a GitHub')}
            onClick={() => setFeedbackOpen(true)}
          />
          {/* Actualizar depende de Zotero igual que Colecciones dependía, así que la
              condición es ahora la misma: fuentes primarias no sincroniza con Zotero y
              antes mostraba este botón por una asimetría entre el comentario y el código. */}
          {!isPrimarySources && !isGenealogy && !isDatabases && !isEstudio && !isDocencia && !isWorldbuilding && !isProsopography && !isTestimonios && (
            <HeaderAction
              dataTour="sync"
              icon="refresh"
              label={syncing ? t('Actualizando…') : t('Actualizar')}
              spinning={syncing}
              showLabel={syncing}
              disabled={syncing}
              onClick={onSync}
            />
          )}
          <HeaderAction
            icon={isDark ? 'sun' : 'moon'}
            label={isDark ? t('Usar tema claro') : t('Usar tema oscuro')}
            title={isDark ? t('Cambiar a modo claro') : t('Cambiar a modo oscuro')}
            onClick={() => void toggleTheme()}
            dataTour="theme-toggle"
          />
          {/* The notification centre, reachable whether or not Nodi is enabled — turning
              the mascot off used to take the only way to read these with it. */}
          <span className="relative inline-flex">
            <HeaderAction
              dataTour="notifications"
              icon="bell"
              label={t('Notificaciones')}
              title={t('Avisos de Nodus y actividad reciente')}
              notificationsTrigger
              onClick={(e) => toggleNotifications(e.currentTarget)}
            />
            {unreadNotifications > 0 && (
              <span className="header-action-badge">{unreadNotifications > 9 ? '9+' : unreadNotifications}</span>
            )}
          </span>
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
          onVaultsChanged={reloadVaults}
          onActiveVaultChanged={handleActiveVaultChanged}
        />

        <ServerInbox
          anchorEl={inboxAnchor}
          onClose={() => setInboxAnchor(null)}
          entries={inbox}
          onMarkRead={(id) => void window.nodus.markServerInboxRead(id).then(setInbox)}
          onClearOne={async (id) => { setInbox(await window.nodus.clearServerInbox(id)); }}
          onClearAll={() => void window.nodus.clearServerInbox().then(setInbox)}
          onOpenEntry={(entry) => {
            // Reading is per entry, so opening one is what marks that one — never the lot,
            // and never merely opening the panel.
            void window.nodus.markServerInboxRead(entry.id).then(setInbox);
            if (entry.entityKind === 'deep_research' && entry.outcome === 'applied') {
              setView('deepResearch');
              setInboxAnchor(null);
            }
          }}
        />

        <NotificationsPanel
          anchorEl={notificationsAnchor}
          onClose={() => setNotificationsAnchor(null)}
          notifications={notifications}
          announcements={announcements}
          language={settings.uiLanguage}
          onMarkAnnouncementRead={markAnnouncementRead}
          onRefresh={refreshNotificationCenter}
          refreshing={refreshingNotifications}
          onClearAll={() => void window.nodus.clearNotifications().then(setNotifications).catch(() => {})}
        />
      </header>

      {settings.demoMode && (
        <div className="flex items-center gap-3 px-4 py-1.5 bg-amber-100 border-b border-amber-300 text-amber-800 text-xs dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-300">
          <Icon name="alert" size={14} />
          <span className="flex-1">
            {isPrimarySources
              ? t('Modo demostración: estás viendo un corpus ficticio de aprendizaje. Sal del modo demo para empezar con tus propias fuentes.')
              : t('Modo demostración: estás viendo un corpus de ejemplo. Sal del modo demo para empezar con tu propia biblioteca.')}
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
          <nav
            data-testid="resizable-sidebar"
            data-sidebar-compact={sidebarCompact ? 'true' : 'false'}
            className="relative shrink-0 overflow-hidden border-r border-neutral-800"
            style={{ width: sidebarWidth }}
          >
            <div data-testid="sidebar-scroll-region" className="vault-sidebar-scroll mr-[6px] flex h-full min-h-0 flex-col gap-1 overflow-y-auto p-2">
              {(() => {
              const navButton = (n: { id: View; icon: string; label: string }, disabled = false) => (
                <button
                  key={n.id}
                  data-tour={`nav-${n.id}`}
                  disabled={disabled}
                  aria-disabled={disabled}
                  aria-label={sidebarCompact ? t(n.label) : undefined}
                  title={disabled ? `${t(n.label)} · ${t('Próximamente')}` : sidebarCompact ? t(n.label) : undefined}
                  onClick={() => {
                    if (disabled) return;
                    // La sección Herramientas siempre entra por el catálogo.
                    if (n.id === 'toolkit') setToolkitPage('home');
                    setView(n.id);
                  }}
                  className={`flex items-center rounded-lg py-2 text-sm text-left transition-colors ${sidebarCompact ? 'justify-center px-2' : 'gap-2 px-3'} ${
                    disabled
                      ? 'cursor-not-allowed text-neutral-700 opacity-65'
                      : view === n.id && (n.id !== 'toolkit' || toolkitPage === 'home')
                        ? 'bg-indigo-600 text-white'
                        : 'text-neutral-400 hover:bg-neutral-900'
                  }`}
                >
                  <Icon name={n.icon} className="shrink-0 opacity-70" />
                  <span className={sidebarCompact ? 'sr-only' : undefined}>{t(n.label)}</span>
                  {disabled && !sidebarCompact && <span className="ml-auto text-[9px] font-semibold uppercase tracking-wide">{t('Próximamente')}</span>}
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
                const collapsed = !sidebarCompact && collapsedGroups.has(group.id);
                const hasActive = group.items.some((n) => n.id === view);
                return (
                  <div key={group.id} className={`${sidebarCompact ? 'mt-1 border-t border-neutral-800/70 pt-1' : 'mt-2'} flex flex-col gap-1`}>
                    {!sidebarCompact && <div className="flex items-center px-3">{groupHeaderButton(group.id, group.label, collapsed, hasActive)}</div>}
                    {!collapsed && group.items.map((n) => navButton(n))}
                  </div>
                );
              };
              if (isWorldbuilding) {
                return (
                  <>
                    {navButton(homeItem)}
                    {navButton(libraryItem)}
                    <WorldbuildingSidebar
                      compact={sidebarCompact}
                      activeView={view}
                      onNavigate={(targetView) => setView(targetView)}
                      sidebarOrder={settings?.sidebarOrder}
                      sidebarHidden={activeSidebarHidden}
                    />
                    {/* Only the tools group: Explorar/Analizar/Crear are already covered
                        by WorldbuildingSidebar, so rendering them would duplicate. */}
                    {navGroups.filter((group) => group.id === 'tools').map((group) => renderGroup(group))}
                    <div className="mt-2 flex flex-col gap-1">{navButton(settingsItem)}</div>
                  </>
                );
              }
              if (isProsopography) {
                return (
                  <>
                    {navButton(homeItem)}
                    {navButton(libraryItem)}
                    <ProsopographySidebar
                      compact={sidebarCompact}
                      activeView={view}
                      onNavigate={(targetView) => setView(targetView)}
                      sidebarOrder={settings?.sidebarOrder}
                      sidebarHidden={activeSidebarHidden}
                    />
                    {navGroups.filter((group) => group.id === 'tools').map((group) => renderGroup(group))}
                    <div className="mt-2 flex flex-col gap-1">{navButton(settingsItem)}</div>
                  </>
                );
              }
              if (isTestimonios) {
                return (
                  <>
                    {navButton(homeItem)}
                    {navButton(libraryItem)}
                    <TestimonySidebar
                      compact={sidebarCompact}
                      activeView={view}
                      onNavigate={(targetView) => setView(targetView)}
                      sidebarOrder={settings?.sidebarOrder}
                      sidebarHidden={activeSidebarHidden}
                    />
                    {/* Solo el grupo de herramientas: Explorar/Analizar/Registrar ya los
                        cubre TestimonySidebar, y repetirlos duplicaría el menú. */}
                    {navGroups.filter((group) => group.id === 'tools').map((group) => renderGroup(group))}
                    <div className="mt-2 flex flex-col gap-1">{navButton(settingsItem)}</div>
                  </>
                );
              }
              if (isPrimarySources) {
                return (
                  <>
                    {navButton(homeItem)}
                    {navButton(libraryItem)}
                    <PrimarySourcesSidebar
                      compact={sidebarCompact}
                      activeView={view}
                      onNavigate={(targetView) => setView(targetView)}
                      sidebarOrder={settings?.sidebarOrder}
                      sidebarHidden={activeSidebarHidden}
                    />
                    {/* Toolkit is universal. Reuse its canonical group instead of
                        maintaining a primary-source fork. */}
                    {navGroups.filter((group) => group.id === 'tools').map((group) => renderGroup(group))}
                    <div className="mt-2 flex flex-col gap-1">{navButton(settingsItem)}</div>
                  </>
                );
              }
              if (isDatabases) {
                // A databases vault keeps the same Explorar · Analizar · Escribir
                // structure as every other vault: the user's databases are the
                // Explorar content (rendered dynamically), then the Analysis + Chat
                // (Analizar) and Notes (Escribir) groups come through groupedNav.
                const exploreCollapsed = !sidebarCompact && collapsedGroups.has('explore');
                const exploreLabel = NAV_GROUPS.find((g) => g.id === 'explore')?.label ?? 'Explorar';
                return (
                  <>
                    {navButton(homeItem)}
                    {navButton(libraryItem)}
                    <div className={`${sidebarCompact ? 'mt-1 border-t border-neutral-800/70 pt-1' : 'mt-2'} flex flex-col gap-1`} data-tour="db-list">
                      <div className="flex items-center px-3">
                        {!sidebarCompact && groupHeaderButton('explore', exploreLabel, exploreCollapsed, view === 'databases')}
                        <button
                          onClick={() => void createDatabase()}
                          title={t('Nueva base de datos')}
                          aria-label={t('Nueva base de datos')}
                          className={`${sidebarCompact ? 'flex w-full justify-center py-2' : ''} text-neutral-500 hover:text-neutral-300`}
                        >
                          <Icon name="plus" size={14} />
                        </button>
                      </div>
                      {!exploreCollapsed && navButton(dbSearchItem)}
                      {!exploreCollapsed && (
                        <DatabasesSidebarExplore
                          compact={sidebarCompact}
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
                    {navButton(libraryItem)}
                    <StudySidebar
                      compact={sidebarCompact}
                      activeView={view}
                      onNavigate={(targetView) => { setStudyTarget(null); if (targetView !== 'studyLibrary') setStudyMaterialTarget(null); if (targetView !== 'studyRecordings') setStudyRecordingTarget(null); setStudyGraphTarget(null); setView(targetView); }}
                      sidebarOrder={settings?.sidebarOrder}
                      sidebarHidden={activeSidebarHidden}
                    />
                    {navGroups.filter((group) => group.id !== 'explore').map((group) => renderGroup(group))}
                    <div className="mt-2 flex flex-col gap-1">{navButton(settingsItem)}</div>
                  </>
                );
              }
              if (isDocencia) {
                return (
                  <>
                    {navButton(homeItem)}
                    {navButton(libraryItem)}
                    <TeachingSidebar
                      compact={sidebarCompact}
                      activeView={view}
                      onNavigate={(targetView) => { setStudyTarget(null); if (targetView !== 'studyLibrary') setStudyMaterialTarget(null); if (targetView !== 'studyRecordings') setStudyRecordingTarget(null); setStudyGraphTarget(null); setView(targetView); }}
                      onOpenRoadmap={setRoadmapTopic}
                      sidebarOrder={settings?.sidebarOrder}
                      sidebarHidden={activeSidebarHidden}
                    />
                    {/* Only the tools group: Explorar/Analizar/Escribir are already
                        covered by TeachingSidebar, so rendering them would duplicate. */}
                    {navGroups.filter((group) => group.id === 'tools').map((group) => renderGroup(group))}
                    <div className="mt-2 flex flex-col gap-1">{navButton(settingsItem)}</div>
                  </>
                );
              }
              return (
                <>
                  {navButton(homeItem)}
                  {navButton(libraryItem)}
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
              onClick={(event) => event.currentTarget.focus()}
              onKeyDown={resizeSidebarWithKeyboard}
              onDoubleClick={() => { setSidebarWidth(SIDEBAR_DEFAULT_WIDTH); localStorage.setItem('nodus.sidebarWidth', String(SIDEBAR_DEFAULT_WIDTH)); }}
            />
          </nav>
        )}

        {/* Main view */}
        {/* One continuity snapshot for the whole worldbuilding vault. Every sheet's badge
            filters the same array with `findingsFor()`, so a contradiction costs one set of
            queries rather than one per open sheet. */}
        <ContinuityProvider enabled={isWorldbuilding} revision={CONTINUITY_VIEWS.has(view) ? view : undefined}>
        <main className="flex flex-1 min-w-0 flex-col overflow-hidden" data-nodi-view={view}>
          {/* A backup system that fails quietly is worse than none: until now the only
              trace of a broken schedule was a grey line inside a collapsed Settings
              section, so a user could go months believing they were protected. Only
              genuinely blocking states appear here, and only once per session. */}
          {!isPreviewVault && recoveryStatus?.health.level === 'critical' && !recoveryStatus.needsSetup && !backupWarningDismissed && (
            <div data-testid="backup-health-banner" className="backup-health-banner">
              <Icon name="alert" size={16} className="shrink-0" />
              <span className="min-w-0 flex-1">
                <b>{recoveryHealthHeadline(recoveryStatus.health)}</b>
                {recoveryHealthAdvice(recoveryStatus.health) && (
                  <span className="ml-2 opacity-80">{recoveryHealthAdvice(recoveryStatus.health)}</span>
                )}
              </span>
              <button className="btn btn-ghost shrink-0 text-xs" onClick={() => setView('settings')}>
                {t('Revisar copias')}
              </button>
              <button
                className="backup-health-dismiss"
                aria-label={t('Ocultar aviso')}
                title={t('Ocultar aviso')}
                onClick={() => setBackupWarningDismissed(true)}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={<div className="grid h-full place-items-center text-sm text-neutral-500"><span className="flex items-center gap-2"><Icon name="sync" className="animate-spin" /> {t('Cargando...')}</span></div>}>
          {/* Per-view crash isolation: a render error in one section shows a
              recovery card here instead of blanking the whole window. key={view}
              clears the error automatically when the user switches sections. */}
          <AppErrorBoundary key={view}>
          {VIEW_REGISTRY[view](viewContext)}
          </AppErrorBoundary>
          </Suspense>
          </div>
        </main>
        </ContinuityProvider>
      </div>

      <div data-tour="queue">
        <QueueBar />
        <EmbeddingProgressBar />
        <PassageProgressBar />
      </div>

      <FeedbackHost />
      <PrivacyRequestHost />

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
      {roadmapTopic && <RoadmapFeedbackModal topic={roadmapTopic} onClose={() => setRoadmapTopic(null)} />}
      {roadmapOpen && <RoadmapModal onClose={() => setRoadmapOpen(false)} />}

      {!isPreviewVault && settings.onboardingComplete && settings.basicsTutorialVersion > 0 && !settings.tourComplete && !isPrimarySources && !isGenealogy && !isDatabases && !isEstudio && !isDocencia && !isWorldbuilding && !isProsopography && !isTestimonios && (
        <Tour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ tourComplete: true });
            void reloadSettings();
          }}
        />
      )}

      {settings.onboardingComplete && settings.basicsTutorialVersion > 0 && isProsopography && !settings.tourComplete && (
        <ProsopographyTour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ tourComplete: true });
            void reloadSettings();
          }}
        />
      )}

      {settings.onboardingComplete && settings.basicsTutorialVersion > 0 && isWorldbuilding && !settings.tourComplete && (
        <WorldbuildingTour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ tourComplete: true });
            void reloadSettings();
          }}
        />
      )}

      {settings.onboardingComplete && settings.basicsTutorialVersion > 0 && isPrimarySources && !settings.primarySourcesTourComplete && (
        <PrimarySourcesTour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ primarySourcesTourComplete: true });
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

      {settings.onboardingComplete && settings.basicsTutorialVersion > 0 && isTestimonios && !settings.testimonyTourComplete && (
        <TestimonyTour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ testimonyTourComplete: true });
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

      {settings.onboardingComplete && settings.basicsTutorialVersion > 0 && isDocencia && !settings.docenciaTourComplete && (
        <TeachingTour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ docenciaTourComplete: true });
            void reloadSettings();
          }}
        />
      )}

      {csvPlan && (
        <CsvImportModal
          plan={csvPlan}
          onClose={() => {
            // Let the main process drop the parsed rows it is holding for this import.
            void window.nodus.releaseCsvImport(csvPlan.token);
            setCsvPlan(null);
          }}
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
        (isPrimarySources || isGenealogy || isDatabases || isTestimonios || isEstudio || isDocencia || settings.tourComplete) &&
        settings.advancedTourComplete &&
        (!isPrimarySources || settings.primarySourcesTourComplete) &&
        (!isGenealogy || settings.genealogyTourComplete) &&
        (!isDatabases || settings.databasesTourComplete) &&
        (!isTestimonios || settings.testimonyTourComplete) &&
        (!isEstudio || settings.studyTourComplete) &&
        (!isDocencia || settings.docenciaTourComplete) && (
          <WhatsNewModal
            settings={settings}
            activeVaultType={activeVault?.type ?? null}
            uiLanguage={settings.uiLanguage}
            onSettled={() => setWhatsNewSettled(true)}
          />
        )}

      {!isPreviewVault && recoveryStatus?.needsSetup && recoveryStatus.previousInstallation && !whatsNewSettled && (
        <WhatsNewModal
          settings={settings}
          activeVaultType={activeVault?.type ?? null}
          uiLanguage={settings.uiLanguage}
          onSettled={() => setWhatsNewSettled(true)}
        />
      )}

      {manualWhatsNewOpen && (
        <WhatsNewModal
          settings={settings}
          activeVaultType={activeVault?.type ?? null}
          uiLanguage={settings.uiLanguage}
          showSeenReleaseNotes
          onSettled={() => setManualWhatsNewOpen(false)}
        />
      )}

      {whatsNewSettled && !mobileTeaserSettled && !manualWhatsNewOpen && (
        <MobileTeaserGuide
          uiLanguage={settings.uiLanguage}
          onSettled={() => setMobileTeaserSettled(true)}
        />
      )}

      {whatsNewSettled && mobileTeaserSettled && !platformHighlightsSettled && !manualWhatsNewOpen && (
        <PlatformHighlightsUpdateTour
          uiLanguage={settings.uiLanguage}
          previousTutorialVersion={settings.basicsTutorialVersion}
          onSettled={() => setPlatformHighlightsSettled(true)}
        />
      )}

      {whatsNewSettled && mobileTeaserSettled && platformHighlightsSettled && !toolkitBetaTourSettled && !manualWhatsNewOpen && (
        <ToolkitBetaUpdateTour
          uiLanguage={settings.uiLanguage}
          previousTutorialVersion={settings.basicsTutorialVersion}
          onSettled={() => setToolkitBetaTourSettled(true)}
        />
      )}

      {whatsNewSettled && mobileTeaserSettled && platformHighlightsSettled && toolkitBetaTourSettled && !tutorialVideosSettled && !manualWhatsNewOpen && (
        <TutorialVideosUpdateTour
          uiLanguage={settings.uiLanguage}
          previousTutorialVersion={settings.basicsTutorialVersion}
          onSettled={() => setTutorialVideosSettled(true)}
        />
      )}

      {whatsNewSettled && mobileTeaserSettled && platformHighlightsSettled && toolkitBetaTourSettled && tutorialVideosSettled && !manualWhatsNewOpen && !updateSettled && (
        <StartupUpdateModal
          settings={settings}
          activeVaultType={activeVault?.type ?? null}
          onSettled={() => setUpdateSettled(true)}
        />
      )}

      {/* Users who already saw the cinematic tutorial were never offered the choice of
          Nodi, so it is made here instead — once, behind the update check. New users
          pick inside the tutorial and reach this already chosen. */}
      {updateSettled && !manualWhatsNewOpen && !isPreviewVault &&
        settings.onboardingComplete &&
        settings.basicsTutorialVersion > 0 &&
        !recoveryStatus?.needsSetup &&
        settings.mascotEnabled &&
        !settings.mascotStyleChosen && (
          <NodiStyleModal onChosen={async () => { await reloadSettings(); }} />
        )}

      {!manualWhatsNewOpen && updateSettled && <NodiMascot settings={settings} />}
    </div>
  );
}
