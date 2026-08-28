import type { AIConversation, AIJob, AIMessage, AIModelCatalogEntry, AIPreferences, AIProviderStatus, Annotation, AnnotationResponse, JsonRecord, LibraryDocument, LibraryPageResponse, MeResponse, PageResponse, PortableProfileValues, ServerAdminOverview, ServerUserProfile, Space, SpaceSummary, UserArtifact, UserArtifactKind } from './types';

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
  });
  if (response.status === 204) return undefined as T;
  let body: unknown;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    const errorBody = body as { error_description?: string; error?: string } | null;
    throw new ApiError(errorBody?.error_description || errorBody?.error || `Request failed (${response.status})`, response.status, errorBody?.error);
  }
  return body as T;
}

function encoded(value: string): string { return encodeURIComponent(value); }

export const api = {
  me: () => request<MeResponse>('/api/v1/web/me'),
  space: (spaceId: string) => request<SpaceSummary>(`/api/v1/spaces/${encoded(spaceId)}`),
  collection: (spaceId: string, name: string, params: Record<string, string> = {}) => {
    const query = new URLSearchParams(params);
    return request<PageResponse>(`/api/v1/spaces/${encoded(spaceId)}/${encoded(name)}?${query.toString()}`);
  },
  primarySources: {
    timeline: (spaceId: string) => request<JsonRecord>(`/api/v1/spaces/${encoded(spaceId)}/primary-sources/timeline`),
    map: (spaceId: string) => request<JsonRecord>(`/api/v1/spaces/${encoded(spaceId)}/primary-sources/map`),
    relations: (spaceId: string) => request<JsonRecord>(`/api/v1/spaces/${encoded(spaceId)}/primary-sources/relations`),
    persons: (spaceId: string, params: Record<string, string> = {}) => request<JsonRecord>(`/api/v1/spaces/${encoded(spaceId)}/primary-sources/persons?${new URLSearchParams(params).toString()}`),
    person: (spaceId: string, id: string) => request<JsonRecord>(`/api/v1/spaces/${encoded(spaceId)}/primary-sources/persons/${encoded(id)}`),
    search: (spaceId: string, input: JsonRecord) => request<JsonRecord>(`/api/v1/spaces/${encoded(spaceId)}/primary-sources/search?${new URLSearchParams(Object.entries(input).filter(([, value]) => value != null && value !== '').map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : String(value)])).toString()}`),
  },
  /** The Desktop planner treats dated plan blocks and calendar events as one agenda. */
  studyAgenda: (spaceId: string, params: Record<string, string> = {}) => {
    const query = new URLSearchParams(params);
    return request<JsonRecord>(`/api/v1/spaces/${encoded(spaceId)}/study-agenda?${query.toString()}`);
  },
  detail: (spaceId: string, collection: string, id: string) =>
    request<JsonRecord>(`/api/v1/spaces/${encoded(spaceId)}/${encoded(collection)}/${encoded(id)}`),
  /** Complete published database projection used by the read-only Analysis workbench. */
  databaseAnalysis: (spaceId: string, id: string) =>
    request<JsonRecord>(`/api/v1/spaces/${encoded(spaceId)}/databases/${encoded(id)}/analysis`),
  search: (spaceId: string, query: string) =>
    request<{ results?: JsonRecord[]; mode?: string }>(`/api/v1/spaces/${encoded(spaceId)}/search?q=${encodeURIComponent(query)}&limit=50`),
  stateOfArt: (spaceId: string) => request<{
    questions?: JsonRecord[];
    debates?: JsonRecord[];
    gaps?: JsonRecord[];
    revision?: string;
  }>(`/api/v1/spaces/${encoded(spaceId)}/state-of-art`),
  readingPath: (spaceId: string, params: { strategy?: string; researchBrief?: string; limit?: number; includeRead?: boolean } = {}) => {
    const query = new URLSearchParams(Object.entries({ ...params, includeRead: params.includeRead === false ? '0' : '1' }).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
    return request<JsonRecord>(`/api/v1/spaces/${encoded(spaceId)}/reading-path?${query.toString()}`);
  },
  immersion: (spaceId: string, id?: string) => request<JsonRecord>(`/api/v1/spaces/${encoded(spaceId)}/immersion${id ? `/${encoded(id)}` : ''}`),
  writing: (spaceId: string, params: Record<string, string> = {}) => request<PageResponse>(`/api/v1/spaces/${encoded(spaceId)}/writing?${new URLSearchParams(params).toString()}`),
  writingDraft: (spaceId: string, id: string) => request<JsonRecord>(`/api/v1/spaces/${encoded(spaceId)}/writing/${encoded(id)}`),
  projects: (spaceId: string, params: Record<string, string> = {}) => request<PageResponse>(`/api/v1/spaces/${encoded(spaceId)}/projects?${new URLSearchParams(params).toString()}`),
  project: (spaceId: string, id: string) => request<JsonRecord>(`/api/v1/spaces/${encoded(spaceId)}/projects/${encoded(id)}`),
  library: (spaceId: string, params: Record<string, string> = {}) => {
    const query = new URLSearchParams(params);
    return request<LibraryPageResponse>(`/api/v1/spaces/${encoded(spaceId)}/library/documents?${query.toString()}`);
  },
  libraryCollections: (spaceId: string) => request<{ collections?: JsonRecord[] }>(`/api/v1/spaces/${encoded(spaceId)}/library/collections`),
  libraryDocument: (spaceId: string, id: string) => request<{ document?: LibraryDocument }>(`/api/v1/spaces/${encoded(spaceId)}/library/documents/${encoded(id)}`),
  libraryContent: async (spaceId: string, id: string) => {
    const response = await fetch(`/api/v1/spaces/${encoded(spaceId)}/library/documents/${encoded(id)}/content`, { credentials: 'same-origin', headers: { Accept: 'text/markdown' } });
    if (!response.ok) throw new ApiError(`Readable content is unavailable (${response.status})`, response.status);
    return response.text();
  },
  annotations: (spaceId: string, resource: string, documentId: string) => request<AnnotationResponse>(`/api/v1/spaces/${encoded(spaceId)}/personal-annotations?resource=${encoded(resource)}&documentId=${encoded(documentId)}`),
  addAnnotation: (spaceId: string, annotation: Annotation, csrfToken?: string) => request<AnnotationResponse>(`/api/v1/spaces/${encoded(spaceId)}/personal-annotations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}), ...(annotation.baseVersion ? { 'If-Match': String(annotation.baseVersion) } : {}) },
    body: JSON.stringify(annotation),
  }),
  aiProviders: () => request<{ providers: AIProviderStatus[]; credentialsAvailable: boolean }>('/api/v2/me/ai/providers'),
  aiProviderModels: (provider: string) => request<{ provider: string; models: AIModelCatalogEntry[]; source: 'live' }>(`/api/v2/me/ai/providers/${encoded(provider)}/models`),
  profilePreferences: () => request<{ profile: ServerUserProfile }>('/api/v2/me/preferences'),
  updateProfilePreferences: (profile: PortableProfileValues, csrfToken?: string) => request<{ profile: ServerUserProfile; unchanged?: boolean }>('/api/v2/me/preferences', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, body: JSON.stringify(profile),
  }),
  adminOverview: () => request<ServerAdminOverview>('/api/v1/web/admin'),
  createAdminSpace: (input: { name: string; description?: string; vaultType?: string }, csrfToken?: string) => request<{ space: ServerAdminOverview['spaces'][number] }>('/api/v1/web/admin/spaces', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, body: JSON.stringify(input),
  }),
  updateAdminSpace: (id: string, input: { name?: string; description?: string; publicationPolicy?: Record<string, boolean> }, csrfToken?: string) => request<{ space: ServerAdminOverview['spaces'][number] }>(`/api/v1/web/admin/spaces/${encoded(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, body: JSON.stringify(input),
  }),
  /** Native Server vaults. `desktop_published` spaces remain read-only and use
   * the legacy admin publication contract above; these endpoints own SQLite on
   * the Server host and carry storageKind/authority/revision in every response. */
  createVault: (input: { name: string; description?: string; vaultType: string; storageKind?: 'server_native'; authority?: 'server' }, csrfToken?: string) => request<{ vault: Space }>('/api/v2/vaults', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, body: JSON.stringify({ storageKind: 'server_native', authority: 'server', ...input }),
  }),
  updateVault: (id: string, input: { name?: string; description?: string; expectedRevision?: number }, csrfToken?: string) => request<{ vault: Space }>(`/api/v2/vaults/${encoded(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, body: JSON.stringify(input),
  }),
  vaultAction: (id: string, action: 'duplicate' | 'reset' | 'export' | 'import', input: Record<string, unknown> = {}, csrfToken?: string) => request<Record<string, unknown>>(`/api/v2/vaults/${encoded(id)}/${action}`, {
    method: action === 'export' ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, ...(action === 'export' ? {} : { body: JSON.stringify(input) }),
  }),
  exportVault: async (id: string) => {
    const response = await fetch(`/api/v2/vaults/${encoded(id)}/export`, { credentials: 'same-origin', headers: { Accept: 'application/vnd.sqlite3' } });
    if (!response.ok) { let message = `Request failed (${response.status})`; try { const body = await response.json() as { error?: string; error_description?: string }; message = body.error_description || body.error || message; } catch { /* binary/error response */ } throw new ApiError(message, response.status); }
    return response.blob();
  },
  importVault: async (id: string, file: File, expectedRevision: number, csrfToken?: string) => {
    const response = await fetch(`/api/v2/vaults/${encoded(id)}/import?expectedRevision=${encodeURIComponent(String(expectedRevision))}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'application/vnd.sqlite3', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, body: file });
    if (!response.ok) { let message = `Request failed (${response.status})`; try { const body = await response.json() as { error?: string; error_description?: string }; message = body.error_description || body.error || message; } catch { /* binary/error response */ } throw new ApiError(message, response.status); }
    return response.json() as Promise<Record<string, unknown>>;
  },
  deleteVault: (id: string, expectedRevision?: number, csrfToken?: string) => request<{ ok: boolean }>(`/api/v2/vaults/${encoded(id)}${expectedRevision === undefined ? '' : `?expectedRevision=${encodeURIComponent(String(expectedRevision))}`}`, {
    method: 'DELETE', headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
  }),
  /** Vault-manager actions stay scoped to the administrative space resource. The
   * server may reject an action when this deployment is read-only; the UI then
   * presents the API error without pretending to have changed the local vault. */
  adminSpaceAction: (id: string, action: 'duplicate' | 'reset' | 'delete' | 'export' | 'import', input: Record<string, unknown> = {}, csrfToken?: string) => request<Record<string, unknown>>(`/api/v1/web/admin/spaces/${encoded(id)}/${action}`, {
    method: action === 'export' ? 'GET' : action === 'delete' ? 'DELETE' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
    ...(action === 'export' ? {} : { body: JSON.stringify(input) }),
  }),
  createAdminPairing: (id: string, csrfToken?: string) => request<{ code: string; expiresAt: string }>(`/api/v1/web/admin/spaces/${encoded(id)}/pairing`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, body: '{}',
  }),
  createAdminUser: (input: { email: string; password: string; memberships: Array<{ spaceId: string; role: string }> }, csrfToken?: string) => request<{ user: ServerAdminOverview['users'][number] }>('/api/v1/web/admin/users', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, body: JSON.stringify(input),
  }),
  updateAdminUserAccess: (id: string, memberships: Array<{ spaceId: string; role: string }>, csrfToken?: string) => request<{ user: ServerAdminOverview['users'][number] }>(`/api/v1/web/admin/users/${encoded(id)}/access`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, body: JSON.stringify({ memberships }),
  }),
  revokeAdminDevice: (id: string, csrfToken?: string) => request<{ ok: boolean }>(`/api/v1/web/admin/devices/${encoded(id)}`, {
    method: 'DELETE', headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
  }),
  changeAccountPassword: (input: { currentPassword: string; newPassword: string; confirmPassword: string }, csrfToken?: string) => request<{ ok: boolean; signedOutOtherSessions?: boolean }>('/api/v1/web/account/password', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, body: JSON.stringify(input),
  }),
  saveAICredential: (provider: string, apiKey: string, csrfToken?: string) => request<{ provider: string; configured: boolean; updatedAt?: string }>(`/api/v2/me/ai/credentials/${encoded(provider)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, body: JSON.stringify({ apiKey }),
  }),
  removeAICredential: (provider: string, csrfToken?: string) => request<{ provider: string; configured: boolean }>(`/api/v2/me/ai/credentials/${encoded(provider)}`, {
    method: 'DELETE', headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
  }),
  aiPreferences: () => request<{ preferences: AIPreferences }>('/api/v2/me/ai/preferences'),
  updateAIPreferences: (preferences: AIPreferences, csrfToken?: string) => request<{ preferences: AIPreferences }>('/api/v2/me/ai/preferences', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, body: JSON.stringify(preferences),
  }),
  conversations: () => request<{ conversations: AIConversation[] }>('/api/v2/me/conversations'),
  createConversation: (vaultId: string, title: string, csrfToken?: string) => request<{ conversation: AIConversation }>('/api/v2/me/conversations', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, body: JSON.stringify({ vaultId, title }),
  }),
  appendConversationMessage: (conversationId: string, message: AIMessage, csrfToken?: string) => request<{ conversation: AIConversation }>(`/api/v2/me/conversations/${encoded(conversationId)}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, body: JSON.stringify(message),
  }),
  deleteConversation: (conversationId: string, csrfToken?: string) => request<{ ok: boolean }>(`/api/v2/me/conversations/${encoded(conversationId)}`, {
    method: 'DELETE', headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
  }),
  runAI: (spaceId: string, capability: string, input: { provider?: string; model?: string; messages: AIMessage[]; maxTokens?: number }, csrfToken?: string) => request<{ job: AIJob }>(`/api/v2/vaults/${encoded(spaceId)}/ai/${encoded(capability)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, body: JSON.stringify(input),
  }),
  aiJob: (jobId: string) => request<{ job: AIJob }>(`/api/v2/me/jobs/${encoded(jobId)}`),
  aiJobs: () => request<{ jobs: AIJob[] }>('/api/v2/me/jobs'),
  cancelAIJob: (jobId: string, csrfToken?: string) => request<{ job: AIJob }>(`/api/v2/me/jobs/${encoded(jobId)}/cancel`, { method: 'POST', headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {} }),
  retryAIJob: (jobId: string, csrfToken?: string) => request<{ job: AIJob }>(`/api/v2/me/jobs/${encoded(jobId)}/retry`, { method: 'POST', headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {} }),
  contextPackage: (spaceId: string, query: string, csrfToken?: string) => request<{ sections?: JsonRecord[]; citationScheme?: JsonRecord }>(`/api/v1/spaces/${encoded(spaceId)}/context`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, body: JSON.stringify({ query, budget: 32_000 }),
  }),
  artifacts: (vaultId: string, kind?: UserArtifactKind) => request<{ artifacts: UserArtifact[] }>(`/api/v2/me/artifacts?vaultId=${encoded(vaultId)}${kind ? `&kind=${encoded(kind)}` : ''}`),
  createArtifact: (input: { vaultId: string; kind: UserArtifactKind; title?: string; content?: string; metadata?: Record<string, unknown>; sourceJobId?: string }, csrfToken?: string) => request<{ artifact: UserArtifact }>('/api/v2/me/artifacts', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, body: JSON.stringify(input),
  }),
  updateArtifact: (id: string, input: { title?: string; content?: string; metadata?: Record<string, unknown> }, csrfToken?: string) => request<{ artifact: UserArtifact }>(`/api/v2/me/artifacts/${encoded(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, body: JSON.stringify(input),
  }),
  deleteArtifact: (id: string, csrfToken?: string) => request<{ ok: boolean }>(`/api/v2/me/artifacts/${encoded(id)}`, { method: 'DELETE', headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {} }),
  assetUrl: (spaceId: string, hash: string) => `/api/v1/spaces/${encoded(spaceId)}/assets/${encoded(hash)}`,
  deepResearchReport: (spaceId: string, id: string) => request<{ report?: JsonRecord; image?: JsonRecord | null; translations?: JsonRecord[]; annotations?: JsonRecord[] }>(`/api/v1/spaces/${encoded(spaceId)}/deep-research/${encoded(id)}`),
  deepResearchDocumentUrl: (spaceId: string, id: string) => `/api/v1/spaces/${encoded(spaceId)}/deep-research/${encoded(id)}/document.html`,
  deepResearchPdfUrl: (spaceId: string, id: string, privateReport = false) => privateReport
    ? `/api/v2/me/artifacts/${encoded(id)}/document.pdf`
    : `/api/v1/spaces/${encoded(spaceId)}/deep-research/${encoded(id)}/document.pdf`,
  libraryDownloadUrl: (spaceId: string, id: string) => `/api/v1/spaces/${encoded(spaceId)}/library/documents/${encoded(id)}/download.zip`,
  libraryOriginalUrl: (spaceId: string, id: string) => `/api/v1/spaces/${encoded(spaceId)}/library/documents/${encoded(id)}/original`,
  libraryAssetBaseUrl: (spaceId: string, id: string) => `/api/v1/spaces/${encoded(spaceId)}/library/documents/${encoded(id)}/assets/`,
};

export function isSpace(value: unknown): value is Space {
  return Boolean(value && typeof value === 'object' && typeof (value as Space).id === 'string');
}
