export type JsonRecord = Record<string, unknown>;

export type Space = {
  id: string;
  name: string;
  description?: string;
  role?: string;
  vault?: { type?: string; name?: string } | null;
  revision?: string;
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
export type ServerUserProfile = {
  schemaVersion: number;
  revision: number;
  updatedAt: string | null;
  source: { kind: 'desktop' | 'server-web' | 'api' } | null;
  values: null | {
    appearance: { theme: 'dark' | 'light' | 'system'; uiLanguage: string; promptLanguage: string };
    ai: { favorites: Array<{ provider: string; model: string }>; modelSettingsMode: 'basic' | 'advanced'; models: Record<string, { provider: string; model: string } | null> };
    workspace: { sidebarOrder: string[]; sidebarHidden: string[]; sidebarCustomized: boolean };
  };
};
export type UserArtifactKind = 'workspace-note' | 'nodi-note' | 'author-synthesis' | 'dictionary-entry' | 'deep-research';
export type UserArtifact = {
  id: string; ownerUserId: string; vaultId: string; kind: UserArtifactKind; title: string; content: string;
  metadata: Record<string, unknown>; sourceJobId: string | null; publication: { actionId: string; status: string; requestedAt: string } | null;
  revision: number; createdAt: string; updatedAt: string;
};
