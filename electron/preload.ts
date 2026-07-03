import { contextBridge, ipcRenderer } from 'electron';
import type {
  NodusApi,
  QueueProgress,
  UpdateProgressEvent,
  ReprocessProgress,
  EmbeddingPipelineProgress,
  PassageEmbeddingProgress,
  SemanticBridgeProgress,
  ChapterRelationsProgress,
} from '@shared/types';

// Minimal, typed surface exposed to the renderer. No Node, no direct IPC names leak.
const api: NodusApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  getMcpStatus: () => ipcRenderer.invoke('mcp:status'),
  regenerateMcpToken: () => ipcRenderer.invoke('mcp:regenerateToken'),
  getCopilotStatus: () => ipcRenderer.invoke('copilot:status'),
  regenerateCopilotToken: () => ipcRenderer.invoke('copilot:regenerateToken'),
  ensureCopilotCert: () => ipcRenderer.invoke('copilot:ensureCert'),
  installCopilotAddin: () => ipcRenderer.invoke('copilot:installAddin'),
  onCopilotOpenIdea: (cb) => {
    const listener = (_e: unknown, target: import('@shared/types').CopilotOpenIdeaTarget) => cb(target);
    ipcRenderer.on('copilot:openIdea', listener);
    return () => ipcRenderer.removeListener('copilot:openIdea', listener);
  },
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
  listZoteroTags: () => ipcRenderer.invoke('works:listZoteroTags'),
  getWork: (nodusId) => ipcRenderer.invoke('works:get', nodusId),
  ingestZoteroItems: (items) => ipcRenderer.invoke('works:ingestZoteroItems', items),
  setManualDeep: (nodusId, value, model) => ipcRenderer.invoke('works:setManualDeep', nodusId, value, model),
  setManualDeepBulk: (nodusIds, value, model) => ipcRenderer.invoke('works:setManualDeepBulk', nodusIds, value, model),
  analyzeBoth: (nodusId, model) => ipcRenderer.invoke('works:analyzeBoth', nodusId, model).then(() => undefined),
  analyzeBothBulk: (nodusIds, model) => ipcRenderer.invoke('works:analyzeBothBulk', nodusIds, model).then(() => undefined),
  processFull: (nodusId, model) => ipcRenderer.invoke('works:processFull', nodusId, model).then(() => undefined),
  processFullBulk: (nodusIds, model) => ipcRenderer.invoke('works:processFullBulk', nodusIds, model).then(() => undefined),
  reassignThemes: (model) => ipcRenderer.invoke('works:reassignThemes', model),
  rescan: (nodusId, kind, model) => ipcRenderer.invoke('works:rescan', nodusId, kind, model),
  summarizeWork: (nodusId, model) => ipcRenderer.invoke('works:summarize', nodusId, model).then(() => undefined),
  summarizeBulk: (nodusIds, model) => ipcRenderer.invoke('works:summarizeBulk', nodusIds, model).then(() => undefined),
  summarizeAll: (model) => ipcRenderer.invoke('works:summarizeAll', model).then(() => undefined),
  getWorkSummary: (nodusId) => ipcRenderer.invoke('works:getSummary', nodusId),
  listCollectionFacets: () => ipcRenderer.invoke('works:collectionFacets'),
  listDuplicateWorks: () => ipcRenderer.invoke('works:listDuplicates'),
  mergeWorks: (canonicalId, duplicateIds) => ipcRenderer.invoke('works:merge', canonicalId, duplicateIds),
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
  enqueueBridgeDiscovery: (model) => ipcRenderer.invoke('queue:enqueueBridge', model).then(() => undefined),
  onQueueProgress: (cb) => {
    const listener = (_e: unknown, p: QueueProgress) => cb(p);
    ipcRenderer.on('queue:progress', listener);
    return () => ipcRenderer.removeListener('queue:progress', listener);
  },

  getGraph: (lens) => ipcRenderer.invoke('graph:get', lens),
  getIdeaDetail: (globalId) => ipcRenderer.invoke('graph:ideaDetail', globalId),
  getEdgeDetail: (edgeId) => ipcRenderer.invoke('graph:edgeDetail', edgeId),
  getIdeaEdges: (globalId) => ipcRenderer.invoke('graph:ideaEdges', globalId),
  getIdeasByWork: (nodusId, limit, offset) => ipcRenderer.invoke('works:ideasByWork', nodusId, limit, offset),
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
  getGapDetail: (gapId) => ipcRenderer.invoke('gaps:detail', gapId),
  getContradictions: () => ipcRenderer.invoke('gaps:contradictions'),
  getReadingPath: (request) => ipcRenderer.invoke('reading:path', request),

  getDebates: () => ipcRenderer.invoke('debates:list'),
  analyzeDebate: async (request, handlers) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onDelta = (_e: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onDelta(delta);
    };
    const onReasoning = (_e: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onReasoning?.(delta);
    };
    ipcRenderer.on('debates:analyzeStream:delta', onDelta);
    ipcRenderer.on('debates:analyzeStream:reasoning', onReasoning);
    try {
      return await ipcRenderer.invoke('debates:analyzeStream', requestId, request);
    } finally {
      ipcRenderer.removeListener('debates:analyzeStream:delta', onDelta);
      ipcRenderer.removeListener('debates:analyzeStream:reasoning', onReasoning);
    }
  },

  listResearchQuestions: () => ipcRenderer.invoke('research:rq:list'),
  getResearchQuestion: (id) => ipcRenderer.invoke('research:rq:get', id),
  createResearchQuestion: (input) => ipcRenderer.invoke('research:rq:create', input),
  decomposeResearchQuestion: (request) => ipcRenderer.invoke('research:rq:decompose', request),
  updateResearchSubQuestions: (request) => ipcRenderer.invoke('research:rq:updateSubs', request),
  mapResearchCoverage: async (request, handlers) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onProgress = (_e: unknown, id: string, p: import('@shared/types').RqMapProgress) => {
      if (id === requestId) handlers?.onProgress?.(p);
    };
    ipcRenderer.on('research:rq:map:progress', onProgress);
    try {
      return await ipcRenderer.invoke('research:rq:map', requestId, request);
    } finally {
      ipcRenderer.removeListener('research:rq:map:progress', onProgress);
    }
  },
  deleteResearchQuestion: (id) => ipcRenderer.invoke('research:rq:delete', id).then(() => undefined),
  exportResearchCoverage: (request) => ipcRenderer.invoke('research:rq:export', request),
  researchChat: (request) => ipcRenderer.invoke('research:chat', request),
  researchChatStream: async (request, handlers) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onDelta = (_e: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onDelta(delta);
    };
    const onReasoning = (_e: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onReasoning?.(delta);
    };
    ipcRenderer.on('research:chatStream:delta', onDelta);
    ipcRenderer.on('research:chatStream:reasoning', onReasoning);
    try {
      const response = await ipcRenderer.invoke('research:chatStream', requestId, request);
      handlers.onStats?.(response.stats);
      return response;
    } finally {
      ipcRenderer.removeListener('research:chatStream:delta', onDelta);
      ipcRenderer.removeListener('research:chatStream:reasoning', onReasoning);
    }
  },

  getWritingWorkshopSnapshot: (brief) => ipcRenderer.invoke('writing:snapshot', brief),
  generateWritingWorkshopDraft: (request) => ipcRenderer.invoke('writing:draft', request),
  exportWritingWorkshopDraft: (request) => ipcRenderer.invoke('writing:export', request),
  listWritingWorkshopDrafts: () => ipcRenderer.invoke('writing:saved:list'),
  saveWritingWorkshopDraft: (request) => ipcRenderer.invoke('writing:saved:save', request),
  deleteWritingWorkshopDraft: (id) => ipcRenderer.invoke('writing:saved:delete', id).then(() => undefined),

  generateDeepResearchReport: async (request, handlers) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onProgress = (_e: unknown, id: string, progress: import('@shared/types').DeepResearchProgress) => {
      if (id === requestId) handlers?.onProgress?.(progress);
    };
    ipcRenderer.on('research:deep:progress', onProgress);
    try {
      return await ipcRenderer.invoke('research:deep', requestId, request);
    } finally {
      ipcRenderer.removeListener('research:deep:progress', onProgress);
    }
  },

  tutorPlan: (request) => ipcRenderer.invoke('tutor:plan', request),
  listTutorRoutes: () => ipcRenderer.invoke('tutor:routes:list'),
  saveTutorRoute: (plan, route, model, rating) => ipcRenderer.invoke('tutor:routes:save', plan, route, model, rating),
  rateTutorRoute: (routeId, rating) => ipcRenderer.invoke('tutor:routes:rate', routeId, rating),
  markTutorRoutePlayed: (routeId) => ipcRenderer.invoke('tutor:routes:played', routeId),
  deleteTutorRoute: (routeId) => ipcRenderer.invoke('tutor:routes:delete', routeId).then(() => undefined),
  tutorStep: (request) => ipcRenderer.invoke('tutor:step', request),
  tutorStepStream: async (request, handlers) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onDelta = (_e: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onDelta(delta);
    };
    const onReasoning = (_e: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onReasoning?.(delta);
    };
    ipcRenderer.on('tutor:stepStream:delta', onDelta);
    ipcRenderer.on('tutor:stepStream:reasoning', onReasoning);
    try {
      return await ipcRenderer.invoke('tutor:stepStream', requestId, request);
    } finally {
      ipcRenderer.removeListener('tutor:stepStream:delta', onDelta);
      ipcRenderer.removeListener('tutor:stepStream:reasoning', onReasoning);
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

  getNotesTree: () => ipcRenderer.invoke('notes:tree'),
  createNoteFolder: (input) => ipcRenderer.invoke('notes:folders:create', input),
  renameNoteFolder: (id, name) => ipcRenderer.invoke('notes:folders:rename', id, name),
  moveNoteFolder: (id, parentId) => ipcRenderer.invoke('notes:folders:move', id, parentId),
  deleteNoteFolder: (id) => ipcRenderer.invoke('notes:folders:delete', id).then(() => undefined),
  createNote: (input) => ipcRenderer.invoke('notes:create', input),
  getNote: (id) => ipcRenderer.invoke('notes:get', id),
  updateNote: (input) => ipcRenderer.invoke('notes:update', input),
  moveNote: (id, folderId) => ipcRenderer.invoke('notes:move', id, folderId),
  deleteNote: (id) => ipcRenderer.invoke('notes:delete', id).then(() => undefined),

  createManualIdea: (input) => ipcRenderer.invoke('manualIdeas:create', input),
  saveManualIdea: (payload) => ipcRenderer.invoke('manualIdeas:save', payload).then(() => undefined),
  autoIndexManualIdea: (input) => ipcRenderer.invoke('manualIdeas:autoIndex', input),
  searchIdeaCandidates: (query, excludeIds, limit) =>
    ipcRenderer.invoke('manualIdeas:searchCandidates', query, excludeIds, limit),

  exportNotes: (options) => ipcRenderer.invoke('notes:export', options),
  reorderNotes: (noteIds) => ipcRenderer.invoke('notes:reorder', noteIds).then(() => undefined),
  reorderNotesByAI: (noteIds) => ipcRenderer.invoke('notes:reorderByAI', noteIds),
  updateNoteFolderSummary: (id, summary) => ipcRenderer.invoke('notes:folders:updateSummary', id, summary),
  suggestFolderIdeas: (folderId) => ipcRenderer.invoke('notes:folders:suggestIdeas', folderId),
  verifyCitations: (refs) => ipcRenderer.invoke('citations:verify', refs),
  globalSearch: (query, limitPerKind) => ipcRenderer.invoke('search:global', query, limitPerKind),
  semanticSearch: (query, options) => ipcRenderer.invoke('search:semantic', query, options),
  findSimilarToIdea: (globalId, limit) => ipcRenderer.invoke('search:similarIdea', globalId, limit),
  listSavedSearches: () => ipcRenderer.invoke('search:saved:list'),
  saveSearch: (input) => ipcRenderer.invoke('search:saved:create', input),
  deleteSavedSearch: (id) => ipcRenderer.invoke('search:saved:delete', id).then(() => undefined),
  getCorpusHealth: () => ipcRenderer.invoke('corpus:health'),
  suggestGapSearch: (statement, workTitles) =>
    ipcRenderer.invoke('gaps:suggestSearch', statement, workTitles),

  listProjects: () => ipcRenderer.invoke('projects:list'),
  getProject: (id) => ipcRenderer.invoke('projects:get', id),
  createProject: (input) => ipcRenderer.invoke('projects:create', input),
  updateProject: (input) => ipcRenderer.invoke('projects:update', input),
  deleteProject: (id) => ipcRenderer.invoke('projects:delete', id).then(() => undefined),
  updateProjectSection: (input) => ipcRenderer.invoke('projects:sections:update', input),
  addProjectLink: (input) => ipcRenderer.invoke('projects:links:add', input),
  deleteProjectLink: (id) => ipcRenderer.invoke('projects:links:delete', id).then(() => undefined),
  importProjectChapter: (input) => ipcRenderer.invoke('projects:chapters:import', input),
  updateProjectChapter: (chapterId, markdown) => ipcRenderer.invoke('projects:chapters:update', chapterId, markdown),
  listProjectChapterSuggestions: (chapterId) => ipcRenderer.invoke('projects:suggestions:list', chapterId),
  generateProjectSuggestions: (request) => ipcRenderer.invoke('projects:suggestions:generate', request),
  updateProjectSuggestionStatus: (id, status) =>
    ipcRenderer.invoke('projects:suggestions:updateStatus', id, status),
  applyProjectSuggestions: (request) => ipcRenderer.invoke('projects:suggestions:apply', request),
  listProjectChapterVersions: (chapterId) => ipcRenderer.invoke('projects:versions:list', chapterId),
  restoreProjectChapterVersion: (versionId) => ipcRenderer.invoke('projects:versions:restore', versionId),
  getChapterRelations: (chapterId) => ipcRenderer.invoke('projects:chapterRelations:get', chapterId),
  analyzeChapterRelations: (request) => ipcRenderer.invoke('projects:chapterRelations:analyze', request),
  onChapterRelationsProgress: (cb) => {
    const listener = (_e: unknown, p: ChapterRelationsProgress) => cb(p);
    ipcRenderer.on('projects:chapterRelations:progress', listener);
    return () => ipcRenderer.removeListener('projects:chapterRelations:progress', listener);
  },
  exportProject: (request) => ipcRenderer.invoke('projects:export', request),
  exportProjectChapter: (request) => ipcRenderer.invoke('projects:chapters:export', request),

  exportData: () => ipcRenderer.invoke('data:export'),
  importData: (password) => ipcRenderer.invoke('data:import', password),
  resetGraph: () => ipcRenderer.invoke('data:resetGraph').then(() => undefined),

  hasAnyData: () => ipcRenderer.invoke('data:hasData'),
  seedDemoData: () => ipcRenderer.invoke('data:seedDemo'),
  clearDemoData: () => ipcRenderer.invoke('data:clearDemo').then(() => undefined),

  startEmbedding: (nodusIds) => ipcRenderer.invoke('embeddings:start', nodusIds).then(() => undefined),
  reindexAll: () => ipcRenderer.invoke('embeddings:reindexAll').then(() => undefined),
  pauseEmbedding: () => ipcRenderer.invoke('embeddings:pause').then(() => undefined),
  resumeEmbedding: () => ipcRenderer.invoke('embeddings:resume').then(() => undefined),
  stopEmbedding: () => ipcRenderer.invoke('embeddings:stop').then(() => undefined),
  clearEmbeddingProgress: () => ipcRenderer.invoke('embeddings:clearProgress').then(() => undefined),
  getEmbeddingStatus: () => ipcRenderer.invoke('embeddings:status'),
  getWorkEmbeddingStatuses: (nodusIds) => ipcRenderer.invoke('embeddings:workStatuses', nodusIds),
  onEmbeddingProgress: (cb) => {
    const listener = (_e: unknown, p: EmbeddingPipelineProgress) => cb(p);
    ipcRenderer.on('embeddings:progress', listener);
    return () => ipcRenderer.removeListener('embeddings:progress', listener);
  },

  startPassageEmbedding: (nodusIds) => ipcRenderer.invoke('passages:start', nodusIds).then(() => undefined),
  pausePassageEmbedding: () => ipcRenderer.invoke('passages:pause').then(() => undefined),
  resumePassageEmbedding: () => ipcRenderer.invoke('passages:resume').then(() => undefined),
  stopPassageEmbedding: () => ipcRenderer.invoke('passages:stop').then(() => undefined),
  clearPassageProgress: () => ipcRenderer.invoke('passages:clearProgress').then(() => undefined),
  getPassageStatus: () => ipcRenderer.invoke('passages:status'),
  getWorkPassageStatuses: (nodusIds) => ipcRenderer.invoke('passages:workStatuses', nodusIds),
  getPassage: (passageId) => ipcRenderer.invoke('passages:get', passageId),
  onPassageProgress: (cb) => {
    const listener = (_e: unknown, p: PassageEmbeddingProgress) => cb(p);
    ipcRenderer.on('passages:progress', listener);
    return () => ipcRenderer.removeListener('passages:progress', listener);
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
