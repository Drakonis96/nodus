import { contextBridge, ipcRenderer } from 'electron';
import type { NodusApi, QueueProgress, UpdateProgressEvent, ReprocessProgress, EmbeddingPipelineProgress, SemanticBridgeProgress } from '@shared/types';

// Minimal, typed surface exposed to the renderer. No Node, no direct IPC names leak.
const api: NodusApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  setApiKey: (provider, key) => ipcRenderer.invoke('settings:setApiKey', provider, key),
  clearApiKey: (provider) => ipcRenderer.invoke('settings:clearApiKey', provider),

  listModels: (provider) => ipcRenderer.invoke('ai:listModels', provider),
  listEmbeddingModels: (provider) => ipcRenderer.invoke('ai:listEmbeddingModels', provider),

  zoteroPing: () => ipcRenderer.invoke('zotero:ping'),
  zoteroCollections: () => ipcRenderer.invoke('zotero:collections'),
  zoteroChildCollections: (parentKey) => ipcRenderer.invoke('zotero:childCollections', parentKey),
  zoteroCollectionItems: (collectionKey, opts) =>
    ipcRenderer.invoke('zotero:collectionItems', collectionKey, opts),

  listWorks: (filter) => ipcRenderer.invoke('works:list', filter),
  getWork: (nodusId) => ipcRenderer.invoke('works:get', nodusId),
  ingestZoteroItems: (items) => ipcRenderer.invoke('works:ingestZoteroItems', items),
  setManualDeep: (nodusId, value, model) => ipcRenderer.invoke('works:setManualDeep', nodusId, value, model),
  setManualDeepBulk: (nodusIds, value, model) => ipcRenderer.invoke('works:setManualDeepBulk', nodusIds, value, model),
  analyzeBoth: (nodusId, model) => ipcRenderer.invoke('works:analyzeBoth', nodusId, model).then(() => undefined),
  analyzeBothBulk: (nodusIds, model) => ipcRenderer.invoke('works:analyzeBothBulk', nodusIds, model).then(() => undefined),
  reassignThemes: (model) => ipcRenderer.invoke('works:reassignThemes', model),
  rescan: (nodusId, kind, model) => ipcRenderer.invoke('works:rescan', nodusId, kind, model),
  getWorkMeta: (nodusId) => ipcRenderer.invoke('works:meta', nodusId),
  openInZotero: (zoteroKey) => ipcRenderer.invoke('works:openInZotero', zoteroKey).then(() => undefined),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url).then(() => undefined),
  uploadText: (nodusId, filePath) => ipcRenderer.invoke('works:uploadText', nodusId, filePath),

  syncNow: () => ipcRenderer.invoke('sync:now'),
  getSyncLog: () => ipcRenderer.invoke('sync:log'),

  getQueue: () => ipcRenderer.invoke('queue:get'),
  pauseQueue: () => ipcRenderer.invoke('queue:pause'),
  resumeQueue: () => ipcRenderer.invoke('queue:resume'),
  cancelQueueItem: (id) => ipcRenderer.invoke('queue:cancelItem', id),
  removeQueueItem: (id) => ipcRenderer.invoke('queue:removeItem', id),
  moveQueueItemToTop: (id) => ipcRenderer.invoke('queue:moveToTop', id),
  clearQueue: () => ipcRenderer.invoke('queue:clear'),
  stopQueue: () => ipcRenderer.invoke('queue:stopAll'),
  retryFailed: () => ipcRenderer.invoke('queue:retryFailed'),
  onQueueProgress: (cb) => {
    const listener = (_e: unknown, p: QueueProgress) => cb(p);
    ipcRenderer.on('queue:progress', listener);
    return () => ipcRenderer.removeListener('queue:progress', listener);
  },

  getGraph: (lens) => ipcRenderer.invoke('graph:get', lens),
  getIdeaDetail: (globalId) => ipcRenderer.invoke('graph:ideaDetail', globalId),
  getEdgeDetail: (edgeId) => ipcRenderer.invoke('graph:edgeDetail', edgeId),
  getThemes: () => ipcRenderer.invoke('graph:themes'),

  listManagedThemes: () => ipcRenderer.invoke('themes:listManaged'),
  addManualTheme: (label) => ipcRenderer.invoke('themes:add', label),
  renameTheme: (themeId, label) => ipcRenderer.invoke('themes:rename', themeId, label),
  setThemePinned: (themeId, pinned) => ipcRenderer.invoke('themes:setPinned', themeId, pinned),
  deleteTheme: (themeId) => ipcRenderer.invoke('themes:delete', themeId),
  reprocessThemeConnections: async (options, model, onProgress) => {
    const listener = (_e: unknown, p: ReprocessProgress) => onProgress?.(p);
    ipcRenderer.on('themes:reprocess:progress', listener);
    try {
      return await ipcRenderer.invoke('themes:reprocess', options, model);
    } finally {
      ipcRenderer.removeListener('themes:reprocess:progress', listener);
    }
  },

  getGaps: () => ipcRenderer.invoke('gaps:aggregate'),
  getContradictions: () => ipcRenderer.invoke('gaps:contradictions'),
  getReadingPath: (request) => ipcRenderer.invoke('reading:path', request),
  researchChat: (request) => ipcRenderer.invoke('research:chat', request),
  researchChatStream: async (request, handlers) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onDelta = (_e: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onDelta(delta);
    };
    ipcRenderer.on('research:chatStream:delta', onDelta);
    try {
      const response = await ipcRenderer.invoke('research:chatStream', requestId, request);
      handlers.onStats?.(response.stats);
      return response;
    } finally {
      ipcRenderer.removeListener('research:chatStream:delta', onDelta);
    }
  },

  tutorPlan: (request) => ipcRenderer.invoke('tutor:plan', request),
  listTutorRoutes: () => ipcRenderer.invoke('tutor:routes:list'),
  rateTutorRoute: (routeId, rating) => ipcRenderer.invoke('tutor:routes:rate', routeId, rating),
  markTutorRoutePlayed: (routeId) => ipcRenderer.invoke('tutor:routes:played', routeId),
  tutorStep: (request) => ipcRenderer.invoke('tutor:step', request),
  tutorStepStream: async (request, handlers) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onDelta = (_e: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onDelta(delta);
    };
    ipcRenderer.on('tutor:stepStream:delta', onDelta);
    try {
      return await ipcRenderer.invoke('tutor:stepStream', requestId, request);
    } finally {
      ipcRenderer.removeListener('tutor:stepStream:delta', onDelta);
    }
  },

  buildArgumentMap: (request) => ipcRenderer.invoke('argumentMap:build', request),
  discoverArgumentRoutes: () => ipcRenderer.invoke('argumentMap:discover'),

  listConversations: (includeArchived) => ipcRenderer.invoke('chat:list', includeArchived),
  getConversation: (id) => ipcRenderer.invoke('chat:get', id),
  createConversation: (input) => ipcRenderer.invoke('chat:create', input),
  saveConversationMessages: (id, messages, meta) =>
    ipcRenderer.invoke('chat:saveMessages', id, messages, meta).then(() => undefined),
  generateConversationTitle: (id, model) => ipcRenderer.invoke('chat:generateTitle', id, model),
  renameConversation: (id, title) => ipcRenderer.invoke('chat:rename', id, title).then(() => undefined),
  archiveConversation: (id, archived) => ipcRenderer.invoke('chat:archive', id, archived).then(() => undefined),
  deleteConversation: (id) => ipcRenderer.invoke('chat:delete', id).then(() => undefined),

  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),
  resetGraph: () => ipcRenderer.invoke('data:resetGraph').then(() => undefined),

  startEmbedding: (nodusIds) => ipcRenderer.invoke('embeddings:start', nodusIds).then(() => undefined),
  pauseEmbedding: () => ipcRenderer.invoke('embeddings:pause').then(() => undefined),
  resumeEmbedding: () => ipcRenderer.invoke('embeddings:resume').then(() => undefined),
  stopEmbedding: () => ipcRenderer.invoke('embeddings:stop').then(() => undefined),
  getEmbeddingStatus: () => ipcRenderer.invoke('embeddings:status'),
  getWorkEmbeddingStatuses: (nodusIds) => ipcRenderer.invoke('embeddings:workStatuses', nodusIds),
  onEmbeddingProgress: (cb) => {
    const listener = (_e: unknown, p: EmbeddingPipelineProgress) => cb(p);
    ipcRenderer.on('embeddings:progress', listener);
    return () => ipcRenderer.removeListener('embeddings:progress', listener);
  },

  discoverSemanticBridges: (model) => ipcRenderer.invoke('bridges:discover', model),
  isSemanticBridgeRunning: () => ipcRenderer.invoke('bridges:isRunning'),
  onSemanticBridgeProgress: (cb) => {
    const listener = (_e: unknown, p: SemanticBridgeProgress) => cb(p);
    ipcRenderer.on('bridges:progress', listener);
    return () => ipcRenderer.removeListener('bridges:progress', listener);
  },

  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateProgress: (cb) => {
    const listener = (_e: unknown, event: UpdateProgressEvent) => cb(event);
    ipcRenderer.on('updates:progress', listener);
    return () => ipcRenderer.removeListener('updates:progress', listener);
  },
};

contextBridge.exposeInMainWorld('nodus', api);
