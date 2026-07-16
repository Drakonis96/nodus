import { contextBridge, ipcRenderer, webUtils } from 'electron';
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
let activeDbChatRequestId: string | null = null;
let activeNodiChatRequestId: string | null = null;
let activeStudyImproveRequestId: string | null = null;
let activeStudyAssistantRequestId: string | null = null;
let activeStudyGradingRequestId: string | null = null;
let activeStudySttRequestId: string | null = null;

// Minimal, typed surface exposed to the renderer. No Node, no direct IPC names leak.
const api: NodusApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  listVaults: () => ipcRenderer.invoke('vaults:list'),
  // Nodi companion: notifications
  listNotifications: () => ipcRenderer.invoke('nodi:notifications:list'),
  markNotificationsRead: () => ipcRenderer.invoke('nodi:notifications:markRead'),
  clearNotifications: () => ipcRenderer.invoke('nodi:notifications:clear'),
  listNodiConversations: () => ipcRenderer.invoke('nodi:conversations:list'),
  getNodiConversation: (id) => ipcRenderer.invoke('nodi:conversations:get', id),
  saveNodiConversation: (input) => ipcRenderer.invoke('nodi:conversations:save', input),
  deleteNodiConversation: (id) => ipcRenderer.invoke('nodi:conversations:delete', id).then(() => undefined),
  clearNodiConversations: () => ipcRenderer.invoke('nodi:conversations:clear').then(() => undefined),
  onNotificationsChanged: (cb) => {
    const listener = (_e: unknown, list: Parameters<typeof cb>[0]) => cb(list);
    ipcRenderer.on('nodi:notifications:changed', listener);
    return () => ipcRenderer.removeListener('nodi:notifications:changed', listener);
  },
  // Nodi companion: chat (streaming) + overlay-window helpers
  nodiChatStream: async (request, handlers) => {
    const requestId = `nodi-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onDelta = (_e: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onDelta(delta);
    };
    ipcRenderer.on('nodi:chatStream:delta', onDelta);
    activeNodiChatRequestId = requestId;
    try {
      return await ipcRenderer.invoke('nodi:chatStream', requestId, request);
    } finally {
      if (activeNodiChatRequestId === requestId) activeNodiChatRequestId = null;
      ipcRenderer.removeListener('nodi:chatStream:delta', onDelta);
    }
  },
  cancelNodiChat: async () => {
    if (activeNodiChatRequestId) await ipcRenderer.invoke('nodi:chatStream:cancel', activeNodiChatRequestId);
  },
  setNodiViewContext: (context) => ipcRenderer.invoke('nodi:viewContext:set', context).then(() => undefined),
  getNodiViewContext: () => ipcRenderer.invoke('nodi:viewContext:get'),
  setNodiTutorialVisible: (visible) => ipcRenderer.invoke('nodi:tutorialVisible', visible).then(() => undefined),
  nodiSetMouseIgnore: (ignore) => ipcRenderer.invoke('nodi:setMouseIgnore', ignore),
  nodiSetExpanded: (expanded) => ipcRenderer.invoke('nodi:setExpanded', expanded),
  onNodiDismiss: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('nodi:dismiss', listener);
    return () => ipcRenderer.removeListener('nodi:dismiss', listener);
  },
  nodiOpenMainWindow: () => ipcRenderer.invoke('nodi:openMainWindow'),
  nodiOpenSettings: () => ipcRenderer.invoke('nodi:openSettings'),
  onNodiNavigate: (cb) => {
    const listener = (_e: unknown, view: Parameters<typeof cb>[0]) => cb(view);
    ipcRenderer.on('nodi:navigate', listener);
    return () => ipcRenderer.removeListener('nodi:navigate', listener);
  },
  nodiBeginWindowDrag: (screenX, screenY) => ipcRenderer.invoke('nodi:windowDrag:begin', screenX, screenY),
  nodiDragWindow: (screenX, screenY) => ipcRenderer.invoke('nodi:windowDrag:move', screenX, screenY),
  nodiEndWindowDrag: () => ipcRenderer.invoke('nodi:windowDrag:end').then(() => undefined),
  onVaultChanged: (cb) => {
    const listener = (_e: unknown, vault: Parameters<typeof cb>[0]) => cb(vault);
    ipcRenderer.on('vaults:changed', listener);
    return () => ipcRenderer.removeListener('vaults:changed', listener);
  },
  onSettingsChanged: (cb) => {
    const listener = (_e: unknown, settings: Parameters<typeof cb>[0]) => cb(settings);
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.removeListener('settings:changed', listener);
  },
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
  generatePersonPortraitReference: (personId, description) =>
    ipcRenderer.invoke('entities:generatePersonPortraitReference', personId, description),
  listPlaces: () => ipcRenderer.invoke('entities:listPlaces'),
  createPlace: (input) => ipcRenderer.invoke('entities:createPlace', input),
  findOrCreatePlace: (name, kind) => ipcRenderer.invoke('entities:findOrCreatePlace', name, kind),
  updatePlace: (id, patch) => ipcRenderer.invoke('entities:updatePlace', id, patch),
  // Offline gazetteer + per-person place records (map)
  searchGazetteer: (query, limit) => ipcRenderer.invoke('geo:search', query, limit),
  resolveGazetteerPlace: (place) => ipcRenderer.invoke('geo:resolve', place),
  listPersonPlaces: (personId) => ipcRenderer.invoke('places:listForPerson', personId),
  addPersonPlace: (input) => ipcRenderer.invoke('places:add', input),
  updatePersonPlace: (id, patch) => ipcRenderer.invoke('places:update', id, patch),
  deletePersonPlace: (id) => ipcRenderer.invoke('places:delete', id).then(() => undefined),
  mapPoints: (personIds) => ipcRenderer.invoke('places:mapPoints', personIds),
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
  updateRelationship: (relId, fromPerson, toPerson, type, subtype) =>
    ipcRenderer.invoke('entities:updateRelationship', relId, fromPerson, toPerson, type, subtype),
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
  // Social-relations network (independent from kinship)
  listSocialContacts: (search) => ipcRenderer.invoke('social:listContacts', search),
  getSocialContact: (id) => ipcRenderer.invoke('social:getContact', id),
  createSocialContact: (input) => ipcRenderer.invoke('social:createContact', input),
  updateSocialContact: (id, patch) => ipcRenderer.invoke('social:updateContact', id, patch),
  deleteSocialContact: (id) => ipcRenderer.invoke('social:deleteContact', id).then(() => undefined),
  listSocialRelationsForPerson: (personId) => ipcRenderer.invoke('social:listRelationsForPerson', personId),
  listSocialRelationsTargetingPerson: (personId) => ipcRenderer.invoke('social:listRelationsTargetingPerson', personId),
  listSocialRelationsTargetingContact: (contactId) => ipcRenderer.invoke('social:listRelationsTargetingContact', contactId),
  createSocialRelation: (input) => ipcRenderer.invoke('social:createRelation', input),
  updateSocialRelation: (id, patch) => ipcRenderer.invoke('social:updateRelation', id, patch),
  deleteSocialRelation: (id) => ipcRenderer.invoke('social:deleteRelation', id).then(() => undefined),
  socialGraph: () => ipcRenderer.invoke('social:graph'),
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
  listArchiveItemFolders: (itemId) => ipcRenderer.invoke('archive:listItemFolders', itemId),
  setArchiveItemFolders: (itemId, folderIds) => ipcRenderer.invoke('archive:setItemFolders', itemId, folderIds),
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
  chooseArchiveEntryFiles: () => ipcRenderer.invoke('archive:chooseEntryFiles'),
  createArchiveEntry: (input) => ipcRenderer.invoke('archive:createEntry', input),
  importZoteroArchiveEntry: (input) => ipcRenderer.invoke('archive:importZoteroEntry', input),
  createArchiveTextEntry: (input) => ipcRenderer.invoke('archive:createTextEntry', input),
  scanWorkRecords: (nodusId) => ipcRenderer.invoke('works:scanRecords', nodusId),
  scanArchiveItem: (itemId) => ipcRenderer.invoke('archive:scanItem', itemId),
  analyzeArchiveItem: (itemId) => ipcRenderer.invoke('archive:analyzeItem', itemId),
  replaceArchiveFile: (itemId) => ipcRenderer.invoke('archive:replaceFile', itemId),
  suggestPersonsForItem: (itemId) => ipcRenderer.invoke('archive:suggestPersonsForItem', itemId),
  suggestDocumentsForPerson: (personId) => ipcRenderer.invoke('archive:suggestDocumentsForPerson', personId),
  indexArchive: () => ipcRenderer.invoke('archive:index'),
  archiveIndexStatus: () => ipcRenderer.invoke('archive:indexStatus'),
  // databases mode
  listDatabases: () => ipcRenderer.invoke('db:list'),
  searchDatabases: (query, includeContent) => ipcRenderer.invoke('db:search', query, includeContent),
  searchDatabaseRows: (query, limit) => ipcRenderer.invoke('db:searchRows', query, limit),
  getDatabase: (id) => ipcRenderer.invoke('db:get', id),
  getDatabaseDetail: (id) => ipcRenderer.invoke('db:detail', id),
  databaseStats: (id) => ipcRenderer.invoke('db:stats', id),
  createDatabase: (name, icon) => ipcRenderer.invoke('db:create', name, icon),
  renameDatabase: (id, name) => ipcRenderer.invoke('db:rename', id, name),
  setDatabaseIcon: (id, icon) => ipcRenderer.invoke('db:setIcon', id, icon),
  deleteDatabase: (id) => ipcRenderer.invoke('db:delete', id).then(() => undefined),
  reorderDatabases: (ids) => ipcRenderer.invoke('db:reorder', ids).then(() => undefined),
  createDatabaseColumn: (databaseId, name, type, config) =>
    ipcRenderer.invoke('db:createColumn', databaseId, name, type, config),
  updateDatabaseColumn: (id, patch) => ipcRenderer.invoke('db:updateColumn', id, patch),
  deleteDatabaseColumn: (id) => ipcRenderer.invoke('db:deleteColumn', id).then(() => undefined),
  reorderDatabaseColumns: (databaseId, ids) => ipcRenderer.invoke('db:reorderColumns', databaseId, ids).then(() => undefined),
  addDatabaseOption: (columnId, label, color) => ipcRenderer.invoke('db:addOption', columnId, label, color),
  updateDatabaseOption: (id, patch) => ipcRenderer.invoke('db:updateOption', id, patch).then(() => undefined),
  deleteDatabaseOption: (id) => ipcRenderer.invoke('db:deleteOption', id).then(() => undefined),
  reorderDatabaseOptions: (columnId, ids) => ipcRenderer.invoke('db:reorderOptions', columnId, ids).then(() => undefined),
  listDatabaseRows: (databaseId, opts) => ipcRenderer.invoke('db:listRows', databaseId, opts),
  getDatabaseRow: (id) => ipcRenderer.invoke('db:getRow', id),
  createDatabaseRow: (databaseId) => ipcRenderer.invoke('db:createRow', databaseId),
  deleteDatabaseRow: (id) => ipcRenderer.invoke('db:deleteRow', id).then(() => undefined),
  setDatabaseCell: (rowId, columnId, raw) => ipcRenderer.invoke('db:setCell', rowId, columnId, raw),
  listDatabaseAttachments: (rowId, columnId) => ipcRenderer.invoke('db:listAttachments', rowId, columnId),
  getDatabaseAttachmentBlob: (id) => ipcRenderer.invoke('db:getAttachmentBlob', id),
  getDatabaseAttachmentThumb: (id) => ipcRenderer.invoke('db:getAttachmentThumb', id),
  deleteDatabaseAttachment: (id) => ipcRenderer.invoke('db:deleteAttachment', id).then(() => undefined),
  downloadDatabaseAttachment: (id) => ipcRenderer.invoke('db:downloadAttachment', id),
  pickAndAttachDatabaseFiles: (rowId, columnId) => ipcRenderer.invoke('db:pickAndAttach', rowId, columnId),
  runDatabaseAiCell: (rowId, columnId) => ipcRenderer.invoke('db:runAiCell', rowId, columnId),
  runDatabaseAiColumn: (databaseId, columnId) => ipcRenderer.invoke('db:runAiColumn', databaseId, columnId),
  generateDatabaseAiImage: (rowId, columnId) => ipcRenderer.invoke('db:generateAiImage', rowId, columnId),
  generateDatabaseAiImageColumn: (databaseId, columnId) => ipcRenderer.invoke('db:generateAiImageColumn', databaseId, columnId),
  onDatabaseAiProgress: (cb) => {
    const listener = (_e: unknown, payload: { columnId: string; done: number; total: number }) => cb(payload);
    ipcRenderer.on('db:aiProgress', listener);
    return () => ipcRenderer.removeListener('db:aiProgress', listener);
  },
  listDatabaseRelations: (rowId, columnId) => ipcRenderer.invoke('db:listRelations', rowId, columnId),
  addDatabaseRelation: (rowId, columnId, targetKind, targetId, targetVaultId) =>
    ipcRenderer.invoke('db:addRelation', rowId, columnId, targetKind, targetId, targetVaultId),
  removeDatabaseRelation: (id) => ipcRenderer.invoke('db:removeRelation', id).then(() => undefined),
  searchDatabaseRelationTargets: (kind, query, databaseId) => ipcRenderer.invoke('db:searchRelationTargets', kind, query, databaseId),
  parseCsvForImport: () => ipcRenderer.invoke('db:parseCsvForImport'),
  createDatabaseFromCsv: (name, headers, rows, types) => ipcRenderer.invoke('db:createFromCsv', name, headers, rows, types),
  createDatabaseFromCsvToken: (token, name, types) => ipcRenderer.invoke('db:createFromCsvToken', token, name, types),
  releaseCsvImport: (token) => ipcRenderer.invoke('db:releaseCsvImport', token).then(() => undefined),
  onCsvImportProgress: (cb) => {
    const listener = (_e: unknown, payload: { done: number; total: number; finished: boolean }) => cb(payload);
    ipcRenderer.on('db:csvImportProgress', listener);
    return () => ipcRenderer.removeListener('db:csvImportProgress', listener);
  },
  exportDatabase: (databaseId, format) => ipcRenderer.invoke('db:export', databaseId, format),
  getDatabaseProfile: (databaseId) => ipcRenderer.invoke('db:profile', databaseId),
  analyzeDatabaseReport: (databaseId) => ipcRenderer.invoke('db:analyzeReport', databaseId),
  suggestDatabaseAnalyses: (databaseId) => ipcRenderer.invoke('db:suggestAnalyses', databaseId),
  runDatabaseAnalysis: (databaseId, request) => ipcRenderer.invoke('db:runAnalysis', databaseId, request),
  narrateDatabaseAnalysis: (result) => ipcRenderer.invoke('db:narrateAnalysis', result),
  dbChatStream: async (request, handlers) => {
    const requestId = `db-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onDelta = (_e: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onDelta(delta);
    };
    ipcRenderer.on('db:chatStream:delta', onDelta);
    activeDbChatRequestId = requestId;
    try {
      return await ipcRenderer.invoke('db:chatStream', requestId, request);
    } finally {
      if (activeDbChatRequestId === requestId) activeDbChatRequestId = null;
      ipcRenderer.removeListener('db:chatStream:delta', onDelta);
    }
  },
  cancelDbChat: async () => {
    if (activeDbChatRequestId) await ipcRenderer.invoke('db:chatStream:cancel', activeDbChatRequestId);
  },
  listDatabaseChatConversations: () => ipcRenderer.invoke('db:chatHistory:list'),
  getDatabaseChatConversation: (id) => ipcRenderer.invoke('db:chatHistory:get', id),
  createDatabaseChatConversation: (input) => ipcRenderer.invoke('db:chatHistory:create', input),
  saveDatabaseChatConversation: (id, messages, databaseIds) => ipcRenderer.invoke('db:chatHistory:save', id, messages, databaseIds),
  deleteDatabaseChatConversation: (id) => ipcRenderer.invoke('db:chatHistory:delete', id).then(() => undefined),
  listDatabaseViews: (databaseId) => ipcRenderer.invoke('db:listViews', databaseId),
  createDatabaseView: (databaseId, input) => ipcRenderer.invoke('db:createView', databaseId, input),
  updateDatabaseView: (id, patch) => ipcRenderer.invoke('db:updateView', id, patch),
  deleteDatabaseView: (id) => ipcRenderer.invoke('db:deleteView', id).then(() => undefined),
  pickBulkDatabaseFiles: (mode) => ipcRenderer.invoke('db:pickBulkFiles', mode ?? 'files'),
  bulkAttachDatabaseFiles: (databaseId, refColumnId, attachmentColumnId, files, options) =>
    ipcRenderer.invoke('db:bulkAttach', databaseId, refColumnId, attachmentColumnId, files, options ?? {}),
  onDatabaseBulkProgress: (cb) => {
    const listener = (
      _e: unknown,
      payload: { databaseId: string; done: number; total: number; attached: number; matched: number; finished: boolean }
    ) => cb(payload);
    ipcRenderer.on('db:bulkProgress', listener);
    return () => ipcRenderer.removeListener('db:bulkProgress', listener);
  },
  getMcpStatus: () => ipcRenderer.invoke('mcp:status'),
  regenerateMcpToken: () => ipcRenderer.invoke('mcp:regenerateToken'),
  getCopilotStatus: () => ipcRenderer.invoke('copilot:status'),
  regenerateCopilotToken: () => ipcRenderer.invoke('copilot:regenerateToken'),
  ensureCopilotCert: () => ipcRenderer.invoke('copilot:ensureCert'),
  installCopilotAddin: () => ipcRenderer.invoke('copilot:installAddin'),
  installLibreOfficeCopilot: () => ipcRenderer.invoke('copilot:installLibreOffice'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  onCopilotOpenIdea: (cb) => {
    const listener = (_e: unknown, target: import('@shared/types').CopilotOpenIdeaTarget) => cb(target);
    ipcRenderer.on('copilot:openIdea', listener);
    return () => ipcRenderer.removeListener('copilot:openIdea', listener);
  },
  setApiKey: (provider, key) => ipcRenderer.invoke('settings:setApiKey', provider, key),
  clearApiKey: (provider) => ipcRenderer.invoke('settings:clearApiKey', provider),
  recoverApiKeys: () => ipcRenderer.invoke('settings:recoverApiKeys'),
  onApiKeysRecovered: (cb) => {
    const listener = (_e: unknown, result: { recoveredProviders: import('@shared/types').AiProvider[]; remainingLockedProviders: import('@shared/types').AiProvider[] }) => cb(result);
    ipcRenderer.on('settings:apiKeysRecovered', listener);
    return () => ipcRenderer.removeListener('settings:apiKeysRecovered', listener);
  },

  listModels: (provider) => ipcRenderer.invoke('ai:listModels', provider),
  listEmbeddingModels: (provider) => ipcRenderer.invoke('ai:listEmbeddingModels', provider),
  testLocalProvider: (provider) => ipcRenderer.invoke('ai:testLocalProvider', provider),
  listImageModels: () => ipcRenderer.invoke('ai:listImageModels'),
  getNodusLocalAiStatus: () => ipcRenderer.invoke('ai:nodusLocal:status'),
  installNodusLocalRuntime: async (onProgress) => {
    const requestId = `nodus-local-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const listener = (_event: unknown, id: string, fraction: number) => { if (id === requestId) onProgress?.(fraction); };
    ipcRenderer.on('ai:nodusLocal:progress', listener);
    try { return await ipcRenderer.invoke('ai:nodusLocal:installRuntime', requestId); }
    finally { ipcRenderer.removeListener('ai:nodusLocal:progress', listener); }
  },
  downloadNodusLocalModel: async (model, onProgress) => {
    const requestId = `nodus-local-model-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const listener = (_event: unknown, id: string, fraction: number) => { if (id === requestId) onProgress?.(fraction); };
    ipcRenderer.on('ai:nodusLocal:progress', listener);
    try { return await ipcRenderer.invoke('ai:nodusLocal:downloadModel', requestId, model); }
    finally { ipcRenderer.removeListener('ai:nodusLocal:progress', listener); }
  },
  deleteNodusLocalModel: (model) => ipcRenderer.invoke('ai:nodusLocal:deleteModel', model),
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
  getAudioSegments: (entityKind, entityId, request) => ipcRenderer.invoke('audio:segments', entityKind, entityId, request),
  listAudioClips: (entityKind, entityId) => ipcRenderer.invoke('audio:listClips', entityKind, entityId),
  clearAudioClips: (entityKind, entityId) =>
    ipcRenderer.invoke('audio:clearClips', entityKind, entityId).then(() => undefined),
  saveAudioClip: (entityKind, entityId, input) => ipcRenderer.invoke('audio:saveClip', entityKind, entityId, input),
  getAudioClipDataUrl: (clipId) => ipcRenderer.invoke('audio:clipData', clipId),
  deleteAudioClip: (clipId) => ipcRenderer.invoke('audio:deleteClip', clipId).then(() => undefined),
  deleteEntityAudioClips: (entityKind, entityId) =>
    ipcRenderer.invoke('audio:deleteEntityClips', entityKind, entityId).then(() => undefined),
  exportAudioClip: (clipId) => ipcRenderer.invoke('audio:exportClip', clipId),
  listStudyAudioBookmarks: (entityKind, entityId) => ipcRenderer.invoke('audio:study:bookmarks', entityKind, entityId),
  createStudyAudioBookmark: (entityKind, entityId, segmentIndex, label) => ipcRenderer.invoke('audio:study:bookmark:create', entityKind, entityId, segmentIndex, label),
  deleteStudyAudioBookmark: (id) => ipcRenderer.invoke('audio:study:bookmark:delete', id).then(() => undefined),
  getStudyPronunciations: (subjectId) => ipcRenderer.invoke('audio:study:pronunciations', subjectId),
  setStudyPronunciations: (subjectId, entries) => ipcRenderer.invoke('audio:study:pronunciations:set', subjectId, entries),
  listStudyAudioPlaylist: (subjectId) => ipcRenderer.invoke('audio:study:playlist', subjectId),
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
  zoteroLibraries: () => ipcRenderer.invoke('zotero:libraries'),
  zoteroCollections: (library) => ipcRenderer.invoke('zotero:collections', library),
  zoteroChildCollections: (parentKey, library) => ipcRenderer.invoke('zotero:childCollections', parentKey, library),
  zoteroCollectionItems: (collectionKey, opts) =>
    ipcRenderer.invoke('zotero:collectionItems', collectionKey, opts),
  zoteroSearchItems: (library, query) => ipcRenderer.invoke('zotero:searchItems', library, query),
  zoteroItemAttachments: (itemKey, library) => ipcRenderer.invoke('zotero:itemAttachments', itemKey, library),

  getAcademicHomeSnapshot: () => ipcRenderer.invoke('home:academicSnapshot'),
  listWorks: (filter) => ipcRenderer.invoke('works:list', filter),
  listWorksPage: (filter, request) => ipcRenderer.invoke('works:listPage', filter, request),
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
  getGraphOverview: () => ipcRenderer.invoke('graph:overview'),
  getGraphTheme: (theme, cap) => ipcRenderer.invoke('graph:theme', theme, cap),
  listIdeasPage: (request) => ipcRenderer.invoke('ideas:listPage', request),
  listIdeaConnections: (globalId) => ipcRenderer.invoke('ideas:connections', globalId),
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
  listAuthorsPage: (request) => ipcRenderer.invoke('authors:listPage', request),
  getAuthorDossier: (authorId) => ipcRenderer.invoke('authors:dossier', authorId),
  synthesizeAuthor: (authorId, model) => ipcRenderer.invoke('authors:synthesize', authorId, model),
  getSynthesisMatrix: () => ipcRenderer.invoke('authors:matrix'),
  synthesizeMatrixCell: (authorId, themeId, model) =>
    ipcRenderer.invoke('authors:matrixCell', authorId, themeId, model),
  exportAuthorSyntheses: (request) => ipcRenderer.invoke('authors:exportSyntheses', request),

  getStudyWorkspace: (options) => ipcRenderer.invoke('study:workspace', options),
  getStudySchedule: () => ipcRenderer.invoke('study:schedule:get'),
  saveStudySchedule: (schedule) => ipcRenderer.invoke('study:schedule:save', schedule),
  createStudyCourse: (input) => ipcRenderer.invoke('study:course:create', input),
  createStudySubject: (input) => ipcRenderer.invoke('study:subject:create', input),
  createStudyTopic: (input) => ipcRenderer.invoke('study:topic:create', input),
  createStudyFolder: (input) => ipcRenderer.invoke('study:folder:create', input),
  createStudyDocument: (input) => ipcRenderer.invoke('study:document:create', input),
  updateStudyEntity: (kind, id, patch) => ipcRenderer.invoke('study:entity:update', kind, id, patch),
  moveStudyEntity: (kind, id, input) => ipcRenderer.invoke('study:entity:move', kind, id, input),
  addStudyPlacement: (documentId, input) => ipcRenderer.invoke('study:placement:add', documentId, input),
  setPrimaryStudyPlacement: (documentId, input) => ipcRenderer.invoke('study:placement:setPrimary', documentId, input),
  removeStudyPlacement: (id) => ipcRenderer.invoke('study:placement:remove', id).then(() => undefined),
  setStudyLifecycle: (kind, id, action) => ipcRenderer.invoke('study:lifecycle:set', kind, id, action).then(() => undefined),
  duplicateStudyTree: (kind, id) => ipcRenderer.invoke('study:tree:duplicate', kind, id),
  createStudyTag: (input) => ipcRenderer.invoke('study:tag:create', input),
  updateStudyTag: (id, patch) => ipcRenderer.invoke('study:tag:update', id, patch),
  deleteStudyTag: (id) => ipcRenderer.invoke('study:tag:delete', id).then(() => undefined),
  setStudyDocumentTags: (documentId, tagIds) => ipcRenderer.invoke('study:document:setTags', documentId, tagIds).then(() => undefined),
  createStudyTemplate: (input) => ipcRenderer.invoke('study:template:create', input),
  updateStudyTemplate: (id, patch) => ipcRenderer.invoke('study:template:update', id, patch),
  deleteStudyTemplate: (id) => ipcRenderer.invoke('study:template:delete', id).then(() => undefined),
  applyStudyTemplate: (id, name) => ipcRenderer.invoke('study:template:apply', id, name),
  getStudyDocEditorData: (documentId) => ipcRenderer.invoke('study:editor:data', documentId),
  updateStudyDoc: (documentId, input) => ipcRenderer.invoke('study:editor:update', documentId, input),
  restoreStudyDocVersion: (documentId, versionId) => ipcRenderer.invoke('study:editor:restore', documentId, versionId),
  createStudyAnnotation: (documentId, input) => ipcRenderer.invoke('study:annotation:create', documentId, input),
  updateStudyAnnotation: (id, patch) => ipcRenderer.invoke('study:annotation:update', id, patch),
  deleteStudyAnnotation: (id) => ipcRenderer.invoke('study:annotation:delete', id).then(() => undefined),
  transcribeStudyAudio: async (request, handlers = {}) => {
    const requestId = `study-stt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onProgress = (_event: unknown, id: string, fraction: number) => { if (id === requestId) handlers.onProgress?.(fraction); };
    const onPartial = (_event: unknown, id: string, text: string) => { if (id === requestId) handlers.onPartial?.(text); };
    let markStreamComplete: () => void = () => {};
    const streamComplete = new Promise<void>((resolve) => { markStreamComplete = resolve; });
    const onComplete = (_event: unknown, id: string) => { if (id === requestId) markStreamComplete(); };
    ipcRenderer.on('study:stt:progress', onProgress);
    ipcRenderer.on('study:stt:partial', onPartial);
    ipcRenderer.on('study:stt:complete', onComplete);
    activeStudySttRequestId = requestId;
    try {
      const result = await ipcRenderer.invoke('study:stt:transcribe', { ...request, requestId });
      // The invoke reply and webContents.send events travel through separate IPC
      // queues. On a busy runner the reply can win, so keep the listeners alive
      // until main confirms every partial/progress event has been enqueued.
      await Promise.race([streamComplete, new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
      return result;
    } finally {
      if (activeStudySttRequestId === requestId) activeStudySttRequestId = null;
      ipcRenderer.removeListener('study:stt:progress', onProgress);
      ipcRenderer.removeListener('study:stt:partial', onPartial);
      ipcRenderer.removeListener('study:stt:complete', onComplete);
    }
  },
  cancelStudyTranscription: async () => {
    if (activeStudySttRequestId) await ipcRenderer.invoke('study:stt:cancel', activeStudySttRequestId);
  },
  getWhisperCppStatus: () => ipcRenderer.invoke('study:stt:whisperCpp:status'),
  installWhisperCpp: () => ipcRenderer.invoke('study:stt:whisperCpp:install'),
  uninstallWhisperCpp: () => ipcRenderer.invoke('study:stt:whisperCpp:uninstall'),
  chooseWhisperCppExecutable: () => ipcRenderer.invoke('study:stt:whisperCpp:chooseExecutable'),
  downloadWhisperCppModel: async (model, onProgress) => {
    const requestId = `whisper-model-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const listener = (_event: unknown, id: string, fraction: number) => { if (id === requestId) onProgress?.(fraction); };
    ipcRenderer.on('study:stt:modelProgress', listener);
    try { return await ipcRenderer.invoke('study:stt:whisperCpp:download', requestId, model); }
    finally { ipcRenderer.removeListener('study:stt:modelProgress', listener); }
  },
  deleteWhisperCppModel: (model) => ipcRenderer.invoke('study:stt:whisperCpp:delete', model),
  listStudyStyles: (options) => ipcRenderer.invoke('study:styles:list', options),
  createStudyStyle: (input) => ipcRenderer.invoke('study:styles:create', input),
  updateStudyStyle: (id, patch) => ipcRenderer.invoke('study:styles:update', id, patch),
  duplicateStudyStyle: (id) => ipcRenderer.invoke('study:styles:duplicate', id),
  archiveStudyStyle: (id, archived) => ipcRenderer.invoke('study:styles:archive', id, archived),
  deleteStudyStyle: (id) => ipcRenderer.invoke('study:styles:delete', id).then(() => undefined),
  listStudyStyleVersions: (styleId) => ipcRenderer.invoke('study:styles:versions', styleId),
  restoreStudyStyleVersion: (styleId, versionId) => ipcRenderer.invoke('study:styles:restore', styleId, versionId),
  listStudyStyleAssociations: () => ipcRenderer.invoke('study:styles:associations'),
  setStudyStyleAssociation: (styleId, kind, targetId, isDefault) => ipcRenderer.invoke('study:styles:associate', styleId, kind, targetId, isDefault),
  resolveStudyStyleDefault: (subjectId, documentKind) => ipcRenderer.invoke('study:styles:default', subjectId, documentKind),
  exportStudyStyles: (styleIds) => ipcRenderer.invoke('study:styles:export', styleIds),
  importStudyStyles: () => ipcRenderer.invoke('study:styles:import'),
  improveStudyText: async (request, handlers) => {
    const requestId = `study-improve-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onDelta = (_e: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onDelta(delta);
    };
    ipcRenderer.on('study:improve:delta', onDelta);
    activeStudyImproveRequestId = requestId;
    try {
      return await ipcRenderer.invoke('study:improve', requestId, request);
    } finally {
      if (activeStudyImproveRequestId === requestId) activeStudyImproveRequestId = null;
      ipcRenderer.removeListener('study:improve:delta', onDelta);
    }
  },
  cancelStudyImprove: async () => {
    if (activeStudyImproveRequestId) await ipcRenderer.invoke('study:improve:cancel', activeStudyImproveRequestId);
  },
  listStudyImprovementLog: (documentId) => ipcRenderer.invoke('study:improve:log', documentId),
  updateStudyImprovementAction: (id, action) => ipcRenderer.invoke('study:improve:action', id, action).then(() => undefined),
  listStudyMaterials: (options) => ipcRenderer.invoke('study:materials:list', options),
  getStudyMaterial: (id) => ipcRenderer.invoke('study:materials:get', id),
  getStudyMaterialContent: (id) => ipcRenderer.invoke('study:materials:content', id),
  downloadStudyMaterial: (id) => ipcRenderer.invoke('study:materials:download', id),
  importStudyMaterials: (input) => ipcRenderer.invoke('study:materials:import', input),
  importStudyMaterialFolder: (input) => ipcRenderer.invoke('study:materials:importFolder', input),
  chooseStudyMaterialPaths: (folder) => ipcRenderer.invoke('study:materials:choosePaths', folder),
  getPathForDroppedFile: (file) => webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0]),
  importStudyMaterialPaths: (paths, input) => ipcRenderer.invoke('study:materials:importPaths', paths, input),
  importZoteroStudyMaterial: (input) => ipcRenderer.invoke('study:materials:importZotero', input),
  openStudyMaterialInZotero: (id) => ipcRenderer.invoke('study:materials:openZotero', id).then(() => undefined),
  reindexStudyMaterial: (id) => ipcRenderer.invoke('study:materials:reindex', id),
  onStudyMaterialIndexChanged: (cb) => {
    const listener = (_event: unknown, id: string) => cb(id);
    ipcRenderer.on('study:materials:indexChanged', listener);
    return () => ipcRenderer.removeListener('study:materials:indexChanged', listener);
  },
  replaceStudyMaterialFile: (id, ocr) => ipcRenderer.invoke('study:materials:replace', id, ocr),
  updateStudyMaterial: (id, patch) => ipcRenderer.invoke('study:materials:update', id, patch),
  restoreStudyMaterialVersion: (id, versionId) => ipcRenderer.invoke('study:materials:version:restore', id, versionId),
  addStudyMaterialPlacement: (id, input) => ipcRenderer.invoke('study:materials:placement:add', id, input),
  setPrimaryStudyMaterialPlacement: (id, input) => ipcRenderer.invoke('study:materials:placement:setPrimary', id, input),
  removeStudyMaterialPlacement: (id, placementId) => ipcRenderer.invoke('study:materials:placement:remove', id, placementId).then(() => undefined),
  createStudyMaterialAnnotation: (materialId, input) => ipcRenderer.invoke('study:materials:annotation:create', materialId, input),
  updateStudyMaterialAnnotation: (id, patch) => ipcRenderer.invoke('study:materials:annotation:update', id, patch),
  deleteStudyMaterialAnnotation: (id) => ipcRenderer.invoke('study:materials:annotation:delete', id).then(() => undefined),
  exportAnnotatedStudyMaterial: (id) => ipcRenderer.invoke('study:materials:annotation:export', id),
  createStudyNoteFromMaterial: (materialId, annotationId, title) => ipcRenderer.invoke('study:materials:note:create', materialId, annotationId, title),
  setStudyMaterialLifecycle: (id, action) => ipcRenderer.invoke('study:materials:lifecycle', id, action).then(() => undefined),
  listStudyRecordings: (options) => ipcRenderer.invoke('study:recordings:list', options),
  getStudyRecording: (id) => ipcRenderer.invoke('study:recordings:get', id),
  getStudyRecordingContent: (id) => ipcRenderer.invoke('study:recordings:content', id),
  createStudyRecording: (input) => ipcRenderer.invoke('study:recordings:create', input),
  importStudyRecordings: (scope) => ipcRenderer.invoke('study:recordings:import', scope),
  updateStudyRecording: (id, patch) => ipcRenderer.invoke('study:recordings:update', id, patch),
  createStudyAudioMarker: (recordingId, input) => ipcRenderer.invoke('study:recordings:marker:create', recordingId, input),
  updateStudyAudioMarker: (id, patch) => ipcRenderer.invoke('study:recordings:marker:update', id, patch),
  deleteStudyAudioMarker: (id) => ipcRenderer.invoke('study:recordings:marker:delete', id).then(() => undefined),
  saveStudyTranscript: (recordingId, input) => ipcRenderer.invoke('study:recordings:transcript:save', recordingId, input),
  updateStudyTranscript: (id, contentMarkdown, segments) => ipcRenderer.invoke('study:recordings:transcript:update', id, contentMarkdown, segments),
  updateStudyTranscriptSegment: (id, patch) => ipcRenderer.invoke('study:recordings:segment:update', id, patch),
  deleteStudyTranscript: (id) => ipcRenderer.invoke('study:recordings:transcript:delete', id).then(() => undefined),
  createStudyNoteFromTranscript: (recordingId, transcriptId, placements) => ipcRenderer.invoke('study:recordings:note:create', recordingId, transcriptId, placements),
  deleteStudyRecordingAudio: (id) => ipcRenderer.invoke('study:recordings:audio:delete', id),
  setStudyRecordingLifecycle: (id, action) => ipcRenderer.invoke('study:recordings:lifecycle', id, action).then(() => undefined),
  searchStudyCorpus: (query, options) => ipcRenderer.invoke('study:search:query', query, options),
  getStudySearchIndexStatus: () => ipcRenderer.invoke('study:search:status'),
  rebuildStudySearchIndex: () => ipcRenderer.invoke('study:search:rebuild'),
  pauseStudySearchIndex: () => ipcRenderer.invoke('study:search:pause').then(() => undefined),
  resumeStudySearchIndex: () => ipcRenderer.invoke('study:search:resume').then(() => undefined),
  stopStudySearchIndex: () => ipcRenderer.invoke('study:search:stop').then(() => undefined),
  deleteStudySearchIndex: () => ipcRenderer.invoke('study:search:deleteIndex').then(() => undefined),
  setStudySearchSourceExcluded: (sourceId, excluded) => ipcRenderer.invoke('study:search:exclude', sourceId, excluded),
  listStudySavedSearches: () => ipcRenderer.invoke('study:search:saved:list'),
  saveStudySearch: (name, query, options) => ipcRenderer.invoke('study:search:saved:create', name, query, options),
  deleteStudySavedSearch: (id) => ipcRenderer.invoke('study:search:saved:delete', id).then(() => undefined),
  listStudySearchHistory: () => ipcRenderer.invoke('study:search:history:list'),
  clearStudySearchHistory: () => ipcRenderer.invoke('study:search:history:clear').then(() => undefined),
  onStudySearchProgress: (cb) => {
    const listener = (_e: unknown, next: Parameters<typeof cb>[0]) => cb(next);
    ipcRenderer.on('study:search:progress', listener);
    return () => ipcRenderer.removeListener('study:search:progress', listener);
  },
  listStudyIdeas: (subjectId, query) => ipcRenderer.invoke('study:knowledge:ideas', subjectId, query),
  getStudyIdeaDetail: (id) => ipcRenderer.invoke('study:knowledge:idea', id),
  getStudyKnowledgeGraph: (subjectId) => ipcRenderer.invoke('study:knowledge:graph', subjectId),
  listStudyKnowledgeJobs: (subjectId) => ipcRenderer.invoke('study:knowledge:jobs', subjectId),
  getStudyKnowledgeProgress: () => ipcRenderer.invoke('study:knowledge:progress'),
  reanalyzeStudyKnowledgeSource: (sourceKind, sourceId) => ipcRenderer.invoke('study:knowledge:reanalyze', sourceKind, sourceId).then(() => undefined),
  onStudyKnowledgeChanged: (cb) => {
    const listener = (_event: unknown, next: Parameters<typeof cb>[0]) => cb(next);
    ipcRenderer.on('study:knowledge:changed', listener);
    return () => ipcRenderer.removeListener('study:knowledge:changed', listener);
  },
  listStudyAssistantSources: () => ipcRenderer.invoke('study:assistant:sources'),
  listStudyAssistantConversations: (includeArchived) => ipcRenderer.invoke('study:assistant:list', includeArchived),
  getStudyAssistantConversation: (id) => ipcRenderer.invoke('study:assistant:get', id),
  createStudyAssistantConversation: (input) => ipcRenderer.invoke('study:assistant:create', input),
  updateStudyAssistantConversation: (id, patch) => ipcRenderer.invoke('study:assistant:update', id, patch),
  deleteStudyAssistantConversation: (id) => ipcRenderer.invoke('study:assistant:delete', id).then(() => undefined),
  streamStudyAssistant: async (request, handlers) => {
    const requestId = `study-assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onDelta = (_e: unknown, id: string, delta: string) => { if (id === requestId) handlers.onDelta(delta); };
    const onReasoning = (_e: unknown, id: string, delta: string) => { if (id === requestId) handlers.onReasoning?.(delta); };
    ipcRenderer.on('study:assistant:delta', onDelta); ipcRenderer.on('study:assistant:reasoning', onReasoning);
    activeStudyAssistantRequestId = requestId;
    try { return await ipcRenderer.invoke('study:assistant:stream', requestId, request); }
    finally {
      if (activeStudyAssistantRequestId === requestId) activeStudyAssistantRequestId = null;
      ipcRenderer.removeListener('study:assistant:delta', onDelta); ipcRenderer.removeListener('study:assistant:reasoning', onReasoning);
    }
  },
  cancelStudyAssistant: async () => {
    if (activeStudyAssistantRequestId) await ipcRenderer.invoke('study:assistant:cancel', activeStudyAssistantRequestId);
  },
  exportStudyAssistantConversation: (id) => ipcRenderer.invoke('study:assistant:export', id),
  listStudyQuestions: (filters) => ipcRenderer.invoke('study:questions:list', filters),
  getStudyQuestion: (id) => ipcRenderer.invoke('study:questions:get', id),
  createStudyQuestion: (input) => ipcRenderer.invoke('study:questions:create', input),
  updateStudyQuestion: (id, patch) => ipcRenderer.invoke('study:questions:update', id, patch),
  duplicateStudyQuestion: (id) => ipcRenderer.invoke('study:questions:duplicate', id),
  listStudyQuestionVersions: (id) => ipcRenderer.invoke('study:questions:versions', id),
  restoreStudyQuestionVersion: (id, versionId) => ipcRenderer.invoke('study:questions:restore', id, versionId),
  setStudyQuestionLifecycle: (id, action) => ipcRenderer.invoke('study:questions:lifecycle', id, action).then(() => undefined),
  generateStudyQuestions: (request) => ipcRenderer.invoke('study:questions:generate', request),
  exportStudyQuestions: (ids) => ipcRenderer.invoke('study:questions:export', ids),
  importStudyQuestions: () => ipcRenderer.invoke('study:questions:import'),
  listStudyQuestionCollections: () => ipcRenderer.invoke('study:questions:collections:list'),
  createStudyQuestionCollection: (name, description) => ipcRenderer.invoke('study:questions:collections:create', name, description),
  setStudyQuestionCollectionItems: (collectionId, questionIds) => ipcRenderer.invoke('study:questions:collections:setItems', collectionId, questionIds).then(() => undefined),
  deleteStudyQuestionCollection: (id) => ipcRenderer.invoke('study:questions:collections:delete', id).then(() => undefined),
  getStudyQuestionAnalytics: (id) => ipcRenderer.invoke('study:questions:analytics', id),
  findSimilarStudyQuestions: (id, threshold) => ipcRenderer.invoke('study:questions:similar', id, threshold),
  listStudyAssessments: (kind, includeArchived) => ipcRenderer.invoke('study:assessments:list', kind, includeArchived),
  getStudyAssessment: (id) => ipcRenderer.invoke('study:assessments:get', id),
  createStudyAssessment: (input) => ipcRenderer.invoke('study:assessments:create', input),
  buildStudyTest: (input) => ipcRenderer.invoke('study:assessments:buildTest', input),
  updateStudyAssessment: (id, patch) => ipcRenderer.invoke('study:assessments:update', id, patch),
  deleteStudyAssessment: (id) => ipcRenderer.invoke('study:assessments:delete', id).then(() => undefined),
  listStudyAttempts: (assessmentId) => ipcRenderer.invoke('study:attempts:list', assessmentId),
  getStudyAttempt: (id) => ipcRenderer.invoke('study:attempts:get', id),
  startStudyAttempt: (input) => ipcRenderer.invoke('study:attempts:start', input),
  saveStudyAttemptAnswer: (id, input) => ipcRenderer.invoke('study:attempts:answer', id, input),
  submitStudyAttempt: (id, expired) => ipcRenderer.invoke('study:attempts:submit', id, expired),
  abandonStudyAttempt: (id) => ipcRenderer.invoke('study:attempts:abandon', id),
  exportStudyAssessment: (id, includeAnswers) => ipcRenderer.invoke('study:assessments:export', id, includeAnswers),
  listStudyRubrics: (includeArchived) => ipcRenderer.invoke('study:grading:rubrics:list', includeArchived),
  createStudyRubric: (input) => ipcRenderer.invoke('study:grading:rubrics:create', input),
  updateStudyRubric: (id, patch) => ipcRenderer.invoke('study:grading:rubrics:update', id, patch),
  duplicateStudyRubric: (id) => ipcRenderer.invoke('study:grading:rubrics:duplicate', id),
  deleteStudyRubric: (id) => ipcRenderer.invoke('study:grading:rubrics:delete', id).then(() => undefined),
  listStudyGradingRuns: (attemptAnswerId) => ipcRenderer.invoke('study:grading:runs:list', attemptAnswerId),
  gradeStudyAnswer: async (request, handlers) => {
    const requestId = `study-grading-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onDelta = (_e: unknown, id: string, delta: string) => { if (id === requestId) handlers.onDelta(delta); };
    const onReasoning = (_e: unknown, id: string, delta: string) => { if (id === requestId) handlers.onReasoning?.(delta); };
    ipcRenderer.on('study:grading:delta', onDelta); ipcRenderer.on('study:grading:reasoning', onReasoning); activeStudyGradingRequestId = requestId;
    try { return await ipcRenderer.invoke('study:grading:run', requestId, request); }
    finally { if (activeStudyGradingRequestId === requestId) activeStudyGradingRequestId = null; ipcRenderer.removeListener('study:grading:delta', onDelta); ipcRenderer.removeListener('study:grading:reasoning', onReasoning); }
  },
  cancelStudyGrading: async () => { if (activeStudyGradingRequestId) await ipcRenderer.invoke('study:grading:cancel', activeStudyGradingRequestId); },
  setStudyGradingManualScore: (id, score, comment) => ipcRenderer.invoke('study:grading:manual', id, score, comment),
  listStudyFlashcards: (options) => ipcRenderer.invoke('study:flashcards:list', options),
  createStudyFlashcard: (input) => ipcRenderer.invoke('study:flashcards:create', input),
  updateStudyFlashcard: (id, patch) => ipcRenderer.invoke('study:flashcards:update', id, patch),
  createStudyFlashcardsFromQuestions: (ids) => ipcRenderer.invoke('study:flashcards:fromQuestions', ids),
  reviewStudyFlashcard: (input) => ipcRenderer.invoke('study:flashcards:review', input),
  setStudyFlashcardState: (id, action) => ipcRenderer.invoke('study:flashcards:state', id, action).then(() => undefined),
  getStudyProgressDashboard: () => ipcRenderer.invoke('study:learning:progress'),
  getStudyPlanner: () => ipcRenderer.invoke('study:planner:get'),
  createStudyPlan: (input) => ipcRenderer.invoke('study:planner:create', input),
  createStudyPlanBlock: (input) => ipcRenderer.invoke('study:planner:block:create', input),
  createStudyCalendarEvent: (input) => ipcRenderer.invoke('study:planner:event:create', input),
  updateStudyCalendarEvent: (id, input) => ipcRenderer.invoke('study:planner:event:update', id, input),
  deleteStudyCalendarEvent: (id) => ipcRenderer.invoke('study:planner:event:delete', id).then(() => undefined),
  addStudyCalendarEventToExternal: (id, target) => ipcRenderer.invoke('study:planner:event:external', id, target).then(() => undefined),
  createStudyGoal: (input) => ipcRenderer.invoke('study:planner:goal:create', input),
  updateStudyPlannerItem: (kind, id, patch) => ipcRenderer.invoke('study:planner:item:update', kind, id, patch).then(() => undefined),
  startStudySession: (input) => ipcRenderer.invoke('study:planner:session:start', input),
  finishStudySession: (id, input) => ipcRenderer.invoke('study:planner:session:finish', id, input),
  exportStudyPlannerIcs: () => ipcRenderer.invoke('study:planner:exportIcs'),
  listStudyAiUsage: (limit) => ipcRenderer.invoke('study:ai:usage:list', limit),
  getStudyAiUsageSummary: () => ipcRenderer.invoke('study:ai:usage:summary'),
  clearStudyAiUsage: () => ipcRenderer.invoke('study:ai:usage:clear').then(() => undefined),

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
  restartImmersionSession: (id) => ipcRenderer.invoke('immersion:restart', id),
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
  getGapsPage: (offset, limit) => ipcRenderer.invoke('gaps:listPage', offset, limit),
  getContradictionCount: () => ipcRenderer.invoke('gaps:contradictionCount'),
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
  getStudyDataOverview: () => ipcRenderer.invoke('study:data:overview'),
  maintainStudyData: (action) => ipcRenderer.invoke('study:data:maintain', action),
  exportStudyDiagnostic: () => ipcRenderer.invoke('study:data:diagnostic'),
  exportStudyScope: (scope, format) => ipcRenderer.invoke('study:data:exportScope', scope, format),
  setBackupPassword: (password) => ipcRenderer.invoke('backup:setPassword', password),
  clearBackupPassword: () => ipcRenderer.invoke('backup:clearPassword'),
  hasBackupPassword: () => ipcRenderer.invoke('backup:hasPassword'),
  chooseBackupFolder: () => ipcRenderer.invoke('backup:chooseFolder'),
  runBackupNow: () => ipcRenderer.invoke('backup:runNow'),
  saveBackupRecoveryKit: () => ipcRenderer.invoke('backup:saveRecoveryKit'),
  getRecoveryStatus: () => ipcRenderer.invoke('recovery:status'),
  chooseRecoveryFolder: (mode, language) => ipcRenderer.invoke('recovery:chooseFolder', mode, language),
  initializeRecoveryFolder: (folder, password, language) => ipcRenderer.invoke('recovery:initialize', folder, password, language),
  restoreRecoverySnapshot: (root, fileName, password, language) => ipcRenderer.invoke('recovery:restore', root, fileName, password, language),
  resetGraph: () => ipcRenderer.invoke('data:resetGraph').then(() => undefined),

  hasAnyData: () => ipcRenderer.invoke('data:hasData'),
  seedDemoData: () => ipcRenderer.invoke('data:seedDemo'),
  clearDemoData: () => ipcRenderer.invoke('data:clearDemo').then(() => undefined),
  seedGenealogyDemoData: () => ipcRenderer.invoke('data:seedGenealogyDemo'),
  seedDatabasesDemoData: () => ipcRenderer.invoke('data:seedDatabasesDemo'),
  seedStudyDemoData: () => ipcRenderer.invoke('data:seedStudyDemo'),
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

  setDockIcon: (pngDataUrl) => ipcRenderer.invoke('dock:setIcon', pngDataUrl),
};

contextBridge.exposeInMainWorld('nodus', api);
