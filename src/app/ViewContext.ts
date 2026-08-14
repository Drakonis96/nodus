// What a view needs from the shell.
//
// The obstacle to a plain `Record<View, Component>` is that the props are wildly
// heterogeneous: a dozen views take nothing, several take eight or ten callbacks,
// and three resolve to a different component depending on the vault's type. So the
// registry does not map a view to a component — it maps a view to a function of
// this context, and the context is what the shell already had in scope.
//
// It is assembled once per render in App.tsx and passed whole. A renderer
// destructures what it uses; nothing else has to change when one of them starts
// needing one more callback.
import type { AppSettings, CorpusHealthBucketId, DatabaseSummary, RecoveryStatus, SyncLogEntry, VaultSummary } from '@shared/types';
import type { TestimonyDeepLink } from '@shared/testimonyDeepLinks';
import type {
  PendingAssistantNavigationTarget,
  PendingGraphNavigationTarget,
  PendingIdeaNavigationTarget,
  PendingLibraryNavigationTarget,
  ToolkitPage,
  View,
} from '../navigation';
import type { StudyNavigationTarget } from '../components/StudySidebar';
import type { DossierTab } from '../components/testimonies/InterviewDossier';
import type { ViewSnapshotAccess } from './viewSnapshots';

/** A pending navigation carries a nonce so repeating the same target re-triggers it. */
export type Nonced<T> = T & { nonce: number };

export interface PrimarySourceTarget {
  itemId: string;
  excerptId?: string | null;
  textVersionId?: string | null;
  startOffset?: number | null;
  endOffset?: number | null;
}

/**
 * True for exactly one vault type at a time (or none, for a preview). The views
 * that read these are the handful whose *identity* depends on the vault: `map` is
 * a gazetteer, an invented world or a set of primary-source places, and only the
 * vault type says which.
 */
export interface VaultFlags {
  /** La bóveda académica: la de por defecto, y la única con Espacio de trabajo. */
  isAcademic: boolean;
  isGenealogy: boolean;
  isPrimarySources: boolean;
  isDatabases: boolean;
  isEstudio: boolean;
  isDocencia: boolean;
  isWorldbuilding: boolean;
  isTestimonios: boolean;
  isProsopography: boolean;
  isPreviewVault: boolean;
}

export interface ViewContext extends VaultFlags {
  settings: AppSettings;
  activeVault: VaultSummary | null;
  vaults: VaultSummary[];
  recoveryStatus: RecoveryStatus | null;

  // Shell state a view reads.
  hasData: boolean | null;
  demoBusy: boolean;
  lastSync: SyncLogEntry | null;
  syncing: boolean;
  databases: DatabaseSummary[];
  activeDatabaseId: string | null;
  pendingRecordId: string | null;
  toolkitPage: ToolkitPage;

  // Pending navigation targets, consumed by the view that owns each one.
  graphTarget: Nonced<PendingGraphNavigationTarget> | null;
  ideaTarget: Nonced<PendingIdeaNavigationTarget> | null;
  libraryTarget: Nonced<PendingLibraryNavigationTarget> | null;
  noteTarget: { id: string; nonce: number } | null;
  personsTarget: { id: string; nonce: number } | null;
  testimonyTarget: { interviewId: string; tab?: DossierTab; nonce: number } | null;
  primarySourceTarget: Nonced<PrimarySourceTarget> | null;
  studyTarget: StudyNavigationTarget | null;
  studyMaterialTarget: string | null;
  studyRecordingTarget: { id: string; timestamp?: number | null } | null;
  studyGraphTarget: Nonced<PendingGraphNavigationTarget> | null;
  studyChatTarget: { prompt: string; nonce: number } | null;

  /**
   * Where each section was when it was last left: its filters, its ordering and its
   * open tab, kept above the render point so they outlive the unmount. Already bound
   * to the active vault, so a section cannot read another vault's cut.
   */
  snapshots: ViewSnapshotAccess;

  // Navigation.
  setView: (view: View) => void;
  navigate: (view: View, graph?: PendingGraphNavigationTarget) => void;
  setToolkitPage: (page: ToolkitPage) => void;

  // Reloads.
  reloadSettings: () => Promise<AppSettings | undefined>;
  reloadVaults: () => Promise<VaultSummary[]>;
  reloadDatabases: () => Promise<DatabaseSummary[]>;

  // Cross-view jumps the shell owns, because they set a target and a view at once.
  openAssistant: (target?: PendingAssistantNavigationTarget) => void;
  openLibraryBucket: (bucket: CorpusHealthBucketId) => void;
  openNoteFromSearch: (id: string) => void;
  openPrimarySourceTarget: (target: PrimarySourceTarget) => void;
  openTestimonyInterview: (interviewId: string, tab?: DossierTab) => void;
  openTestimonyLink: (link: TestimonyDeepLink) => void;
  onSync: () => Promise<void>;

  // Target setters, for the jumps a view performs on its own.
  setNoteTarget: (target: { id: string; nonce: number } | null) => void;
  setPersonsTarget: (target: { id: string; nonce: number } | null) => void;
  setPrimarySourceTarget: (target: Nonced<PrimarySourceTarget> | null) => void;
  setStudyTarget: (target: StudyNavigationTarget | null) => void;
  setStudyMaterialTarget: (id: string | null) => void;
  setStudyRecordingTarget: (target: { id: string; timestamp?: number | null } | null) => void;
  setStudyGraphTarget: (target: Nonced<PendingGraphNavigationTarget> | null) => void;
  setStudyChatTarget: (target: { prompt: string; nonce: number } | null) => void;
  setActiveDatabaseId: (id: string | null) => void;
  setPendingRecordId: (id: string | null) => void;

  // Modals and one-off actions the shell hosts.
  setCollectionsOpen: (open: boolean) => void;
  setManualWhatsNewOpen: (open: boolean) => void;
  setRoadmapOpen: (open: boolean) => void;
  createDatabase: () => Promise<void>;
  importCsv: () => Promise<void>;

  // Demo seeding, one per vault type that offers it.
  loadDemo: () => Promise<void>;
  loadGenealogyDemo: () => Promise<void>;
  loadDatabasesDemo: () => Promise<void>;
  loadPrimarySourcesDemo: () => Promise<void>;
  loadStudyDemo: () => Promise<void>;
  loadTeachingDemo: () => Promise<void>;
  loadWorldbuildingDemo: () => Promise<void>;
  loadTestimonyDemo: () => Promise<void>;
}

/** What the registry stores for each view: a render function, not a component. */
export type ViewRenderer = (context: ViewContext) => React.ReactNode;
