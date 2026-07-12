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

// Tracks the research-chat stream currently in flight so `cancelResearchChat`
// can abort it without the renderer having to juggle request ids. Only one chat
// stream runs at a time (the composer is disabled while sending).
let activeChatRequestId: string | null = null;

// Minimal, typed surface exposed to the renderer. No Node, no direct IPC names leak.
const api: NodusApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  listVaults: () => ipcRenderer.invoke('vaults:list'),
  getActiveVault: () => ipcRenderer.invoke('vaults:getActive'),
  createVault: (input) => ipcRenderer.invoke('vaults:create', input),
  renameVault: (id, name) => ipcRenderer.invoke('vaults:rename', id, name),
  setVaultType: (id, type) => ipcRenderer.invoke('vaults:setType', id, type),
  switchVault: (id, options) => ipcRenderer.invoke('vaults:switch', id, options),
  duplicateVault: (id, name, options) => ipcRenderer.invoke('vaults:duplicate', id, name, options),
  deleteVault: (id, deleteFiles) => ipcRenderer.invoke('vaults:delete', id, deleteFiles).then(() => undefined),
  resetVault: (id) => ipcRenderer.invoke('vaults:reset', id),
  reuseVaultAnalysis: (nodusIds) => ipcRenderer.invoke('vaults:reuseAnalysis', nodusIds),
  copyVaultApiKeys: (sourceVaultId, targetVaultId) =>
    ipcRenderer.invoke('vaults:copyApiKeys', sourceVaultId, targetVaultId),
  // Records ontology (primary sources / genealogy)
  recordCounts: () => ipcRenderer.invoke('entities:counts'),
  listPersons: (search) => ipcRenderer.invoke('entities:listPersons', search),
  getPerson: (id) => ipcRenderer.invoke('entities:getPerson', id),
  createPerson: (input) => ipcRenderer.invoke('entities:createPerson', input),
  updatePerson: (id, patch) => ipcRenderer.invoke('entities:updatePerson', id, patch),
  deletePerson: (id) => ipcRenderer.invoke('entities:deletePerson', id).then(() => undefined),
  addPersonName: (id, name, kind) => ipcRenderer.invoke('entities:addPersonName', id, name, kind),
  setPersonPortraitFromFile: (personId) => ipcRenderer.invoke('entities:setPersonPortraitFromFile', personId),
  getPersonPortrait: (personId) => ipcRenderer.invoke('entities:getPersonPortrait', personId),
  updatePortraitFocus: (personId, focus) => ipcRenderer.invoke('entities:updatePortraitFocus', personId, focus).then(() => undefined),
  clearPersonPortrait: (personId) => ipcRenderer.invoke('entities:clearPersonPortrait', personId).then(() => undefined),
  listPlaces: () => ipcRenderer.invoke('entities:listPlaces'),
  createPlace: (input) => ipcRenderer.invoke('entities:createPlace', input),
  findOrCreatePlace: (name, kind) => ipcRenderer.invoke('entities:findOrCreatePlace', name, kind),
  updatePlace: (id, patch) => ipcRenderer.invoke('entities:updatePlace', id, patch),
  listEvents: (opts) => ipcRenderer.invoke('entities:listEvents', opts),
  getEvent: (id) => ipcRenderer.invoke('entities:getEvent', id),
  createEvent: (input) => ipcRenderer.invoke('entities:createEvent', input),
  updateEvent: (id, patch) => ipcRenderer.invoke('entities:updateEvent', id, patch),
  deleteEvent: (id) => ipcRenderer.invoke('entities:deleteEvent', id).then(() => undefined),
  addParticipant: (eventId, personId, role) => ipcRenderer.invoke('entities:addParticipant', eventId, personId, role),
  removeParticipant: (eventId, personId, role) =>
    ipcRenderer.invoke('entities:removeParticipant', eventId, personId, role),
  addRecordEvidence: (input) => ipcRenderer.invoke('entities:addEvidence', input),
  listRecordEvidence: (targetKind, targetId) => ipcRenderer.invoke('entities:listEvidence', targetKind, targetId),
  deleteRecordEvidence: (id) => ipcRenderer.invoke('entities:deleteEvidence', id).then(() => undefined),
  addRelationship: (fromPerson, toPerson, type, provenance, subtype) =>
    ipcRenderer.invoke('entities:addRelationship', fromPerson, toPerson, type, provenance, subtype),
  setPersonFrame: (personId, frameStyle) =>
    ipcRenderer.invoke('entities:setPersonFrame', personId, frameStyle).then(() => undefined),
  generatePersonBiography: (personId) => ipcRenderer.invoke('entities:generateBiography', personId),
  removeRelationship: (relId) => ipcRenderer.invoke('entities:removeRelationship', relId).then(() => undefined),
  listRelationships: (personId) => ipcRenderer.invoke('entities:listRelationships', personId),
  allRelationships: () => ipcRenderer.invoke('entities:allRelationships'),
  kinOf: (personId) => ipcRenderer.invoke('entities:kinOf', personId),
  importGedcom: () => ipcRenderer.invoke('genealogy:importGedcom'),
  exportGedcom: () => ipcRenderer.invoke('genealogy:exportGedcom'),
  findMatches: () => ipcRenderer.invoke('entities:findMatches'),
  mergePersons: (targetId, sourceId) => ipcRenderer.invoke('entities:mergePersons', targetId, sourceId),
  dismissMatch: (a, b) => ipcRenderer.invoke('entities:dismissMatch', a, b).then(() => undefined),
  // Evidence-driven kinship suggestions
  listKinSuggestions: () => ipcRenderer.invoke('kinship:listSuggestions'),
  kinSuggestionsForPerson: (personId) => ipcRenderer.invoke('kinship:suggestionsForPerson', personId),
  kinSuggestionCount: () => ipcRenderer.invoke('kinship:suggestionCount'),
  confirmKinSuggestion: (suggestionId) => ipcRenderer.invoke('kinship:confirmSuggestion', suggestionId),
  dismissKinSuggestion: (suggestionId) => ipcRenderer.invoke('kinship:dismissSuggestion', suggestionId),
  // Evidence archive
  archiveCounts: () => ipcRenderer.invoke('archive:counts'),
  listArchiveFolders: () => ipcRenderer.invoke('archive:listFolders'),
  createArchiveFolder: (name, parentId) => ipcRenderer.invoke('archive:createFolder', name, parentId),
  renameArchiveFolder: (id, name) => ipcRenderer.invoke('archive:renameFolder', id, name),
  deleteArchiveFolder: (id) => ipcRenderer.invoke('archive:deleteFolder', id).then(() => undefined),
  listArchiveItems: (opts) => ipcRenderer.invoke('archive:listItems', opts),
  getArchiveItem: (id) => ipcRenderer.invoke('archive:getItem', id),
  getArchiveItemBlob: (id) => ipcRenderer.invoke('archive:getItemBlob', id),
  createArchiveItem: (input) => ipcRenderer.invoke('archive:createItem', input),
  updateArchiveItem: (id, patch) => ipcRenderer.invoke('archive:updateItem', id, patch),
  deleteArchiveItem: (id) => ipcRenderer.invoke('archive:deleteItem', id).then(() => undefined),
  addArchiveTag: (id, tag) => ipcRenderer.invoke('archive:addTag', id, tag).then(() => undefined),
  removeArchiveTag: (id, tag) => ipcRenderer.invoke('archive:removeTag', id, tag).then(() => undefined),
  listArchiveTags: () => ipcRenderer.invoke('archive:listTags'),
  linkArchivePerson: (itemId, personId) => ipcRenderer.invoke('archive:linkPerson', itemId, personId).then(() => undefined),
  unlinkArchivePerson: (itemId, personId) => ipcRenderer.invoke('archive:unlinkPerson', itemId, personId).then(() => undefined),
  listArchiveItemsForPerson: (personId) => ipcRenderer.invoke('archive:listItemsForPerson', personId),
  pickAndIngestArchive: (folderId, docType) => ipcRenderer.invoke('archive:pickAndIngest', folderId, docType),
  createArchiveTextEntry: (input) => ipcRenderer.invoke('archive:createTextEntry', input),
  scanArchiveItem: (itemId) => ipcRenderer.invoke('archive:scanItem', itemId),
  analyzeArchiveItem: (itemId) => ipcRenderer.invoke('archive:analyzeItem', itemId),
  suggestPersonsForItem: (itemId) => ipcRenderer.invoke('archive:suggestPersonsForItem', itemId),
  suggestDocumentsForPerson: (personId) => ipcRenderer.invoke('archive:suggestDocumentsForPerson', personId),
  indexArchive: () => ipcRenderer.invoke('archive:index'),
  archiveIndexStatus: () => ipcRenderer.invoke('archive:indexStatus'),
  getMcpStatus: () => ipcRenderer.invoke('mcp:status'),
  regenerateMcpToken: () => ipcRenderer.invoke('mcp:regenerateToken'),
  getCopilotStatus: () => ipcRenderer.invoke('copilot:status'),
  regenerateCopilotToken: () => ipcRenderer.invoke('copilot:regenerateToken'),
  ensureCopilotCert: () => ipcRenderer.invoke('copilot:ensureCert'),
  installCopilotAddin: () => ipcRenderer.invoke('copilot:installAddin'),
  installLibreOfficeCopilot: () => ipcRenderer.invoke('copilot:installLibreOffice'),
  onCopilotOpenIdea: (cb) => {
    const listener = (_e: unknown, target: import('@shared/types').CopilotOpenIdeaTarget) => cb(target);
    ipcRenderer.on('copilot:openIdea', listener);
    return () => ipcRenderer.removeListener('copilot:openIdea', listener);
  },
  setApiKey: (provider, key) => ipcRenderer.invoke('settings:setApiKey', provider, key),
  clearApiKey: (provider) => ipcRenderer.invoke('settings:clearApiKey', provider),

  listModels: (provider) => ipcRenderer.invoke('ai:listModels', provider),
  listEmbeddingModels: (provider) => ipcRenderer.invoke('ai:listEmbeddingModels', provider),
  testLocalProvider: (provider) => ipcRenderer.invoke('ai:testLocalProvider', provider),
  listImageModels: () => ipcRenderer.invoke('ai:listImageModels'),
  getDecorativeImage: (entityKind, entityId) => ipcRenderer.invoke('images:get', entityKind, entityId),
  getDecorativeImageDataUrl: (entityKind, entityId, thumbnail) =>
    ipcRenderer.invoke('images:data', entityKind, entityId, thumbnail),
  queueDecorativeImage: (request) => ipcRenderer.invoke('images:queue', request),
  uploadDecorativeImage: (entityKind, entityId, bytes, style) =>
    ipcRenderer.invoke('images:upload', entityKind, entityId, bytes, style),
  revertDecorativeImage: (entityKind, entityId) => ipcRenderer.invoke('images:revert', entityKind, entityId),
  deleteDecorativeImage: (entityKind, entityId) => ipcRenderer.invoke('images:delete', entityKind, entityId),
  onDecorativeImageChanged: (cb) => {
    const listener = (_e: unknown, image: import('@shared/types').DecorativeImage) => cb(image);
    ipcRenderer.on('images:changed', listener);
    return () => ipcRenderer.removeListener('images:changed', listener);
  },

  // audio / text-to-speech (synthesis runs in the renderer; main persists WAVs)
  getAudioSegments: (entityKind, entityId) => ipcRenderer.invoke('audio:segments', entityKind, entityId),
  listAudioClips: (entityKind, entityId) => ipcRenderer.invoke('audio:listClips', entityKind, entityId),
  clearAudioClips: (entityKind, entityId) =>
    ipcRenderer.invoke('audio:clearClips', entityKind, entityId).then(() => undefined),
  saveAudioClip: (entityKind, entityId, input) => ipcRenderer.invoke('audio:saveClip', entityKind, entityId, input),
  getAudioClipDataUrl: (clipId) => ipcRenderer.invoke('audio:clipData', clipId),
  deleteAudioClip: (clipId) => ipcRenderer.invoke('audio:deleteClip', clipId).then(() => undefined),
  deleteEntityAudioClips: (entityKind, entityId) =>
    ipcRenderer.invoke('audio:deleteEntityClips', entityKind, entityId).then(() => undefined),
  humeStatus: () => ipcRenderer.invoke('audio:humeStatus'),
  humeSetKey: (key) => ipcRenderer.invoke('audio:humeSetKey', key),
  humeClearKey: () => ipcRenderer.invoke('audio:humeClearKey'),
  humeVoices: (language) => ipcRenderer.invoke('audio:humeVoices', language),
  humeSynthesize: (voiceId, provider, text) =>
    ipcRenderer.invoke('audio:humeSynthesize', voiceId, provider, text),

  listContentTranslations: (entityKind, entityId) =>
    ipcRenderer.invoke('translations:list', entityKind, entityId),
  getContentTranslation: (id) => ipcRenderer.invoke('translations:get', id),
  generateContentTranslation: (request) => ipcRenderer.invoke('translations:generate', request),
  deleteContentTranslation: (id) => ipcRenderer.invoke('translations:delete', id).then(() => undefined),

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
  rescanDegraded: (model) => ipcRenderer.invoke('works:rescanDegraded', model),
  summarizeWork: (nodusId, model) => ipcRenderer.invoke('works:summarize', nodusId, model).then(() => undefined),
  summarizeBulk: (nodusIds, model) => ipcRenderer.invoke('works:summarizeBulk', nodusIds, model).then(() => undefined),
  summarizeAll: (model) => ipcRenderer.invoke('works:summarizeAll', model).then(() => undefined),
  getWorkSummary: (nodusId) => ipcRenderer.invoke('works:getSummary', nodusId),
  listCollectionFacets: () => ipcRenderer.invoke('works:collectionFacets'),
  listDuplicateWorks: () => ipcRenderer.invoke('works:listDuplicates'),
  mergeWorks: (canonicalId, duplicateIds) => ipcRenderer.invoke('works:merge', canonicalId, duplicateIds),
  listDuplicateIdeas: () => ipcRenderer.invoke('ideas:listDuplicates'),
  mergeIdeas: (canonicalId, duplicateIds) => ipcRenderer.invoke('ideas:merge', canonicalId, duplicateIds),
  backupDatabase: () => ipcRenderer.invoke('ideas:backup'),
  getWorkMeta: (nodusId) => ipcRenderer.invoke('works:meta', nodusId),
  openInZotero: (zoteroKey) => ipcRenderer.invoke('works:openInZotero', zoteroKey).then(() => undefined),
  openEvidenceAtPage: (nodusId, location) => ipcRenderer.invoke('works:openAtPage', nodusId, location),
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
  setEdgeFeedback: (fromId, toId, type, verdict, note) => ipcRenderer.invoke('graph:edgeFeedback:set', fromId, toId, type, verdict, note),
  listEdgeFeedback: () => ipcRenderer.invoke('graph:edgeFeedback:list'),
  getIdeasByWork: (nodusId, limit, offset) => ipcRenderer.invoke('works:ideasByWork', nodusId, limit, offset),
  getWorkIdeaSynthesis: (nodusId) => ipcRenderer.invoke('works:getIdeaSynthesis', nodusId),
  synthesizeWorkIdeas: (nodusId, model) => ipcRenderer.invoke('works:synthesizeIdeas', nodusId, model),
  getThemes: () => ipcRenderer.invoke('graph:themes'),

  listAuthors: () => ipcRenderer.invoke('authors:list'),
  getAuthorDossier: (authorId) => ipcRenderer.invoke('authors:dossier', authorId),
  synthesizeAuthor: (authorId, model) => ipcRenderer.invoke('authors:synthesize', authorId, model),
  getSynthesisMatrix: () => ipcRenderer.invoke('authors:matrix'),
  synthesizeMatrixCell: (authorId, themeId, model) =>
    ipcRenderer.invoke('authors:matrixCell', authorId, themeId, model),
  exportAuthorSyntheses: (request) => ipcRenderer.invoke('authors:exportSyntheses', request),

  getStudyPlan: (request) => ipcRenderer.invoke('study:plan', request),
  setStudyProgress: (record) => ipcRenderer.invoke('study:progress:set', record),
  generateStudySession: (request) => ipcRenderer.invoke('study:session', request),
  evaluateStudyAnswer: (request) => ipcRenderer.invoke('study:answer', request),

  buildImmersionScope: (request) => ipcRenderer.invoke('immersion:scope', request),
  generateImmersionSession: async (request, handlers) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onProgress = (_e: unknown, id: string, progress: import('@shared/types').ImmersionBuildProgress) => {
      if (id === requestId) handlers?.onProgress?.(progress);
    };
    ipcRenderer.on('immersion:generate:progress', onProgress);
    try {
      return await ipcRenderer.invoke('immersion:generate', requestId, request);
    } finally {
      ipcRenderer.removeListener('immersion:generate:progress', onProgress);
    }
  },
  listImmersionSessions: () => ipcRenderer.invoke('immersion:list'),
  getImmersionSession: (id) => ipcRenderer.invoke('immersion:get', id),
  setImmersionProgress: (id, progress) => ipcRenderer.invoke('immersion:progress:set', id, progress).then(() => undefined),
  answerImmersionQuestion: (request) => ipcRenderer.invoke('immersion:answer', request),
  deleteImmersionSession: (id) => ipcRenderer.invoke('immersion:delete', id).then(() => undefined),

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
  generateHypothesisLab: (request) => ipcRenderer.invoke('hypothesis:generate', request),
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
    activeChatRequestId = requestId;
    try {
      const response = await ipcRenderer.invoke('research:chatStream', requestId, request);
      handlers.onStats?.(response.stats);
      return response;
    } finally {
      if (activeChatRequestId === requestId) activeChatRequestId = null;
      ipcRenderer.removeListener('research:chatStream:delta', onDelta);
      ipcRenderer.removeListener('research:chatStream:reasoning', onReasoning);
    }
  },
  cancelResearchChat: async () => {
    if (activeChatRequestId) await ipcRenderer.invoke('research:chatStream:cancel', activeChatRequestId);
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
  getCitationPreview: (ref) => ipcRenderer.invoke('citations:preview', ref),
  globalSearch: (query, limitPerKind) => ipcRenderer.invoke('search:global', query, limitPerKind),
  getSearchResultDetail: (kind, id) => ipcRenderer.invoke('search:detail', kind, id),
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
  verifyManuscriptCitations: (request) => ipcRenderer.invoke('projects:manuscript:verify', request),
  applyManuscriptCitation: (request) => ipcRenderer.invoke('projects:manuscript:applyCitation', request),
  exportProject: (request) => ipcRenderer.invoke('projects:export', request),
  exportProjectChapter: (request) => ipcRenderer.invoke('projects:chapters:export', request),

  exportData: () => ipcRenderer.invoke('data:export'),
  importData: (password) => ipcRenderer.invoke('data:import', password),
  exportSyncPackage: () => ipcRenderer.invoke('data:exportSync'),
  importSyncPackage: () => ipcRenderer.invoke('data:importSync'),
  setBackupPassword: (password) => ipcRenderer.invoke('backup:setPassword', password),
  clearBackupPassword: () => ipcRenderer.invoke('backup:clearPassword'),
  hasBackupPassword: () => ipcRenderer.invoke('backup:hasPassword'),
  chooseBackupFolder: () => ipcRenderer.invoke('backup:chooseFolder'),
  runBackupNow: () => ipcRenderer.invoke('backup:runNow'),
  saveBackupRecoveryKit: () => ipcRenderer.invoke('backup:saveRecoveryKit'),
  resetGraph: () => ipcRenderer.invoke('data:resetGraph').then(() => undefined),

  hasAnyData: () => ipcRenderer.invoke('data:hasData'),
  seedDemoData: () => ipcRenderer.invoke('data:seedDemo'),
  clearDemoData: () => ipcRenderer.invoke('data:clearDemo').then(() => undefined),
  seedGenealogyDemoData: () => ipcRenderer.invoke('data:seedGenealogyDemo'),
  generateDemoPortraits: () => ipcRenderer.invoke('data:generateDemoPortraits'),
  onDemoPortraitsProgress: (cb) => {
    const listener = (_e: unknown, p: { done: number; total: number }) => cb(p);
    ipcRenderer.on('demo:portraits', listener);
    return () => ipcRenderer.removeListener('demo:portraits', listener);
  },

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
