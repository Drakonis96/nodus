import type { AIConversation, AIJob, AIMessage, AIPreferences, AIProviderStatus, Annotation, AnnotationResponse, JsonRecord, LibraryDocument, MeResponse, PageResponse, ServerUserProfile, Space, SpaceSummary, UserArtifact, UserArtifactKind } from './types';

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
  detail: (spaceId: string, collection: string, id: string) =>
    request<JsonRecord>(`/api/v1/spaces/${encoded(spaceId)}/${encoded(collection)}/${encoded(id)}`),
  search: (spaceId: string, query: string) =>
    request<{ results?: JsonRecord[]; mode?: string }>(`/api/v1/spaces/${encoded(spaceId)}/search?q=${encodeURIComponent(query)}&limit=50`),
  library: (spaceId: string, params: Record<string, string> = {}) => {
    const query = new URLSearchParams(params);
    return request<{ items?: LibraryDocument[]; total?: number; collections?: JsonRecord[]; published?: boolean }>(`/api/v1/spaces/${encoded(spaceId)}/library/documents?${query.toString()}`);
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
  profilePreferences: () => request<{ profile: ServerUserProfile }>('/api/v2/me/preferences'),
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
  libraryDownloadUrl: (spaceId: string, id: string) => `/api/v1/spaces/${encoded(spaceId)}/library/documents/${encoded(id)}/download.zip`,
  libraryOriginalUrl: (spaceId: string, id: string) => `/api/v1/spaces/${encoded(spaceId)}/library/documents/${encoded(id)}/original`,
  libraryAssetBaseUrl: (spaceId: string, id: string) => `/api/v1/spaces/${encoded(spaceId)}/library/documents/${encoded(id)}/assets/`,
};

export function isSpace(value: unknown): value is Space {
  return Boolean(value && typeof value === 'object' && typeof (value as Space).id === 'string');
}
