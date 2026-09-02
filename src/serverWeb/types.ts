export type JsonRecord = Record<string, unknown>;

export type Space = {
  id: string;
  name: string;
  description?: string;
  role?: string;
  vaultType?: string;
  storageKind?: 'server_native' | 'desktop_published' | string;
  authorityMode?: 'server' | 'desktop' | string;
  initializationState?: 'initializing' | 'ready' | 'failed' | 'published' | string;
  vault?: { type?: string; name?: string } | null;
  revision?: string | number;
  createdAt?: string | null;
  updatedAt?: string | null;
  hasSnapshot?: boolean;
  counts?: Record<string, number>;
  [key: string]: unknown;
};

export type MeResponse = {
  user?: { id: string; email: string; role?: string };
  spaces?: Space[];
  server?: { name?: string; version?: string };
  csrfToken?: string;
};

export type SpaceSummary = {
  space?: Space;
  vault?: { type?: string; name?: string } | null;
  capabilities?: Record<string, unknown> | null;
  counts?: Record<string, number>;
  assets?: number;
  generatedAt?: string | null;
  [key: string]: unknown;
};

export type PageResponse = {
  items?: JsonRecord[];
  total?: number;
  hasMore?: boolean;
  limit?: number;
  offset?: number;
  revision?: string;
  [key: string]: unknown;
};

export type LibraryDocument = {
  id: string;
  title?: string;
  abstract?: string;
  creators?: string[];
  tags?: string[];
  collectionIds?: string[];
  cleanAvailable?: boolean;
  originalAvailable?: boolean;
  originalMimeType?: string;
  originalFileName?: string;
  packageHash?: string;
  content?: string;
  markdown?: string;
  text?: string;
  [key: string]: unknown;
};

/** The read-only projection returned by /library/documents.
 * Keep paging fields shared with the other published collections so callers do
 * not accidentally infer pagination from the number of rows in the current page.
 */
export type LibraryPageResponse = PageResponse & {
  items?: LibraryDocument[];
  collections?: JsonRecord[];
  published?: boolean;
  generatedAt?: string;
};

export type Annotation = {
  id: string;
  title?: string;
  content?: string;
  resource?: string;
  documentId?: string;
  quote?: string;
  baseVersion?: string | number | null;
  createdAt?: string | number;
  updatedAt?: string | number;
  deletedAt?: string | null;
  [key: string]: unknown;
};

export type AnnotationResponse = {
  version: number;
  updatedAt?: string | null;
  annotations: Annotation[];
};

export type AIProviderStatus = {
  provider: string;
  configured: boolean;
  updatedAt?: string | null;
  supportsEmbeddings?: boolean;
};

export type AIMessage = { id?: string; role: 'user' | 'assistant' | 'system'; content: string; createdAt?: string };
export type AIConversation = {
  id: string; ownerUserId: string; vaultId: string | null; title: string;
  messages: AIMessage[]; createdAt: string; updatedAt: string; revision: number;
};
export type AIJob = {
  id: string; ownerUserId: string; userId: string; vaultId: string; capability: string;
  provider: string; model: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  attempt: number; result: unknown; error: { code?: string; message?: string } | null;
  createdAt: string; updatedAt: string;
};
export type AIPreferences = {
  defaultProvider?: string;
  chatModels?: Record<string, string>;
  featureModels?: Record<string, { provider: string; model: string; reasoningEffort?: string } | null>;
  favorites?: Array<{ provider: string; model: string; reasoningEffort?: string }>;
  modelSettingsMode?: 'basic' | 'advanced';
};

export type PortableModelRef = { provider: string; model: string; reasoningEffort?: string; pending?: boolean };
export type AIModelCatalogEntry = {
  id: string;
  name?: string;
  group?: string;
  contextLength?: number;
  vision?: boolean;
  reasoning?: boolean;
};
export type PortableProfileValues = {
  schemaVersion: 1;
  appearance: {
    theme: 'dark' | 'light' | 'system';
    appTheme: import('@shared/types').AppTheme;
    uiLanguage: 'es' | 'en' | 'fr' | 'de' | 'pt' | 'pt-BR' | 'it' | 'tr';
    promptLanguage: 'es' | 'en' | 'fr' | 'de' | 'pt' | 'pt-BR' | 'it' | 'tr';
    animationSpeed: number;
    interfaceScale: number;
    accessibleFont: boolean;
    highContrast: boolean;
    reduceMotion: boolean;
    readingFocusMode: boolean;
    mascot: {
      enabled: boolean;
      scale: number;
      vaultCostumes: boolean;
      style: 'classic' | 'orb';
      orbColorMode: 'auto' | 'manual';
      orbColor: string;
    };
  };
  ai: {
    favorites: PortableModelRef[];
    modelSettingsMode: 'basic' | 'advanced';
    modelSettingsVersion: number;
    models: Record<string, PortableModelRef | null>;
    pendingAssignments: string[];
    chatReasoning: 'off' | 'low' | 'medium' | 'high';
    codexReasoningEfforts: Record<string, string>;
    preferFastOpenRouter: boolean;
    providerFreeTier: Record<string, boolean>;
    image: { provider: string; model: string; quality: string; style: string };
    audio: { provider: string; voice: string; speed: number; pending?: boolean };
    studyPolicy: {
      enabled: boolean;
      privacyMode: 'local' | 'hybrid' | 'external';
      confirmExternal: boolean;
      monthlyBudgetUsd: number;
      budgetWarningPercent: number;
      maxInputChars: number;
      maxOutputTokens: number;
      temperature: number;
      retryCount: number;
      studentPseudonyms: boolean;
    };
  };
  workspace: {
    sidebarOrder: string[];
    sidebarHidden: string[];
    sidebarCustomized: boolean;
    aiConcurrencyMode: 'automatic' | 'manual';
    aiConcurrencyVersion: number;
    concurrency: number;
    deepContextMode: 'standard' | 'long';
    standardChunkWords: number;
    longChunkWords: number;
  };
};
export type ServerUserProfile = {
  schemaVersion: number;
  revision: number;
  updatedAt: string | null;
  source: { kind: 'desktop' | 'server-web' | 'api' } | null;
  values: PortableProfileValues | null;
};

export type ServerAdminOverview = {
  server: { name: string; publicUrl: string; mcpUrl: string; version?: string; language?: string; deploymentMode?: string };
  spaces: Array<Space & { description?: string; vaultType?: string; bytes?: number; counts?: Record<string, number>; libraryDocuments?: number; publicationPolicy?: Record<string, boolean | string | number | null> }>;
  users: Array<{ id: string; email: string; emailMasked?: boolean; role: string; memberships: Array<{ spaceId: string; role: string }> }>;
  devices: Array<{ id: string; deviceName: string; userId?: string; spaceId: string; createdAt?: string | null; lastUsedAt?: string | null; kind?: string }>;
  sensitiveAccessUnlocked?: boolean;
  csrfToken?: string;
};
export type UserArtifactKind = 'workspace-note' | 'workspace-collection' | 'nodi-note' | 'author-synthesis' | 'dictionary-entry' | 'deep-research';
export type UserArtifact = {
  id: string; ownerUserId: string; vaultId: string; kind: UserArtifactKind; title: string; content: string;
  metadata: Record<string, unknown>; sourceJobId: string | null; publication: { actionId: string; status: string; requestedAt: string } | null;
  revision: number; createdAt: string; updatedAt: string;
};
