import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  NodusApi,
  NodiOverlayPlacement,
  QueueProgress,
  UpdateProgressEvent,
  ReprocessProgress,
  EmbeddingPipelineProgress,
  PassageEmbeddingProgress,
  SemanticBridgeProgress,
  ChapterRelationsProgress,
} from '@shared/types';
import type { PresenterAction as PresenterControlAction } from '@shared/presenterState';

// Tracks the research-chat stream currently in flight so `cancelResearchChat`
// can abort it without the renderer having to juggle request ids. Only one chat
// stream runs at a time (the composer is disabled while sending).
let activeChatRequestId: string | null = null;
let activeDbChatRequestId: string | null = null;
let activeWorldChatRequestId: string | null = null;
let activeNodiChatRequestId: string | null = null;
let activeStudyImproveRequestId: string | null = null;
let activeStudyAssistantRequestId: string | null = null;
let activeStudySttRequestId: string | null = null;

const DEFAULT_OVERLAY_PLACEMENT: NodiOverlayPlacement = { x: 16, y: 16, horizontal: 'left', vertical: 'up' };

/**
 * The mascot window's placement for the overlay's first frame, read from the
 * page URL rather than fetched over IPC.
 *
 * mascotWindow.ts positions the native window *before* it loads mascot.html, so
 * the value is already known at load time; carrying it in the URL keeps the
 * first frame correct without a synchronous round-trip into a main process that
 * may be busy with a backup or a scan.
 */
function readInitialOverlayPlacement(): NodiOverlayPlacement {
  try {
    // The preload shares the renderer's frame, so `location` is there at runtime;
    // this tsconfig deliberately omits the DOM lib, hence the narrow cast.
    const search = (globalThis as unknown as { location?: { search?: string } }).location?.search ?? '';
    const raw = new URLSearchParams(search).get('placement');
    if (!raw) return DEFAULT_OVERLAY_PLACEMENT;
    const parsed = JSON.parse(raw) as Partial<NodiOverlayPlacement>;
    if (typeof parsed?.x !== 'number' || typeof parsed?.y !== 'number') return DEFAULT_OVERLAY_PLACEMENT;
    return {
      x: parsed.x,
      y: parsed.y,
      horizontal: parsed.horizontal === 'right' ? 'right' : 'left',
      vertical: parsed.vertical === 'down' ? 'down' : 'up',
    };
  } catch {
    return DEFAULT_OVERLAY_PLACEMENT;
  }
}

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
  listNodiNotes: () => ipcRenderer.invoke('nodi:notes:list'),
  saveNodiNote: (input) => ipcRenderer.invoke('nodi:notes:save', input),
  deleteNodiNote: (id) => ipcRenderer.invoke('nodi:notes:delete', id).then(() => undefined),
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
  // Deliberately fire-and-forget. `sendSync` was used here to make the hit-test
  // transition land before a following physical mouse-down, but it cannot buy
  // that: the main process handles either message at the same point in its event
  // loop. All the synchronous form added was a full stall of the overlay
  // renderer — so while the main process was busy (auto backup, a scan, an
  // import) Nodi froze mid-animation the moment the pointer crossed it.
  nodiSetMouseIgnore: async (ignore) => {
    ipcRenderer.send('nodi:setMouseIgnore:async', ignore);
  },
  // The main process places the window before it loads mascot.html and passes
  // the result in the URL, so the very first frame draws Nodi in the right spot
  // with no IPC at all. `nodi:overlayPlacement:get` refreshes it afterwards.
  nodiGetOverlayPlacement: () => readInitialOverlayPlacement(),
  nodiRefreshOverlayPlacement: () => ipcRenderer.invoke('nodi:overlayPlacement:get'),
  nodiSetExpanded: (expanded) => ipcRenderer.invoke('nodi:setExpanded', expanded),
  onNodiDismiss: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('nodi:dismiss', listener);
    return () => ipcRenderer.removeListener('nodi:dismiss', listener);
  },
  nodiOpenMainWindow: () => ipcRenderer.invoke('nodi:openMainWindow'),
  nodiOpenSettings: () => ipcRenderer.invoke('nodi:openSettings'),
  nodiOpenWorldEntry: (kind, id) => ipcRenderer.invoke('nodi:openWorldEntry', kind, id),
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
  // Worldbuilding characters — the person-side bridges above (portrait, names,
  // events, kinship, relations) are reused as they are.
  listCharacters: (filter) => ipcRenderer.invoke('characters:list', filter),
  getCharacter: (personId) => ipcRenderer.invoke('characters:get', personId),
  createCharacter: (input) => ipcRenderer.invoke('characters:create', input),
  updateCharacter: (personId, patch) => ipcRenderer.invoke('characters:update', personId, patch),
  deleteCharacter: (personId) => ipcRenderer.invoke('characters:delete', personId).then(() => undefined),
  listCharacterEvents: (personId) => ipcRenderer.invoke('characters:listEvents', personId),
  setCharacterEventWorldDate: (eventId, worldYear, worldOrder) =>
    ipcRenderer.invoke('characters:setEventWorldDate', eventId, worldYear, worldOrder).then(() => undefined),
  characterCounts: () => ipcRenderer.invoke('characters:counts'),
  listWorldEvents: () => ipcRenderer.invoke('characters:listWorldEvents'),
  listWorldPlaces: () => ipcRenderer.invoke('places:listWorld'),
  getWorldPlace: (placeId) => ipcRenderer.invoke('places:getWorld', placeId),
  createWorldPlace: (input) => ipcRenderer.invoke('places:createWorld', input),
  updateWorldPlace: (placeId, patch) => ipcRenderer.invoke('places:updateWorld', placeId, patch),
  deleteWorldPlace: (placeId) => ipcRenderer.invoke('places:deleteWorld', placeId).then(() => undefined),
  placeInhabitants: (placeId) => ipcRenderer.invoke('places:inhabitants', placeId),
  listSecrets: () => ipcRenderer.invoke('story:listSecrets'),
  secretsForCharacter: (personId) => ipcRenderer.invoke('story:secretsForCharacter', personId),
  createSecret: (input) => ipcRenderer.invoke('story:createSecret', input),
  updateSecret: (id, patch) => ipcRenderer.invoke('story:updateSecret', id, patch),
  deleteSecret: (id) => ipcRenderer.invoke('story:deleteSecret', id).then(() => undefined),
  listKnowers: (secretId) => ipcRenderer.invoke('story:listKnowers', secretId),
  addKnower: (input) => ipcRenderer.invoke('story:addKnower', input),
  removeKnower: (id) => ipcRenderer.invoke('story:removeKnower', id).then(() => undefined),
  listScenes: (order) => ipcRenderer.invoke('story:listScenes', order),
  createScene: (input) => ipcRenderer.invoke('story:createScene', input),
  updateScene: (id, patch) => ipcRenderer.invoke('story:updateScene', id, patch),
  deleteScene: (id) => ipcRenderer.invoke('story:deleteScene', id).then(() => undefined),
  listSceneCharacters: (sceneId) => ipcRenderer.invoke('story:listSceneCharacters', sceneId),
  appearancesOfCharacter: (personId) => ipcRenderer.invoke('story:appearances', personId),
  addSceneCharacter: (sceneId, personId, role) => ipcRenderer.invoke('story:addSceneCharacter', sceneId, personId, role),
  removeSceneCharacter: (id) => ipcRenderer.invoke('story:removeSceneCharacter', id).then(() => undefined),
  listWorldGroups: (kind) => ipcRenderer.invoke('groups:list', kind),
  getWorldGroup: (groupId) => ipcRenderer.invoke('groups:get', groupId),
  createWorldGroup: (input) => ipcRenderer.invoke('groups:create', input),
  updateWorldGroup: (groupId, patch) => ipcRenderer.invoke('groups:update', groupId, patch),
  deleteWorldGroup: (groupId) => ipcRenderer.invoke('groups:delete', groupId).then(() => undefined),
  listAffiliationsForCharacter: (personId) => ipcRenderer.invoke('groups:listAffiliationsForCharacter', personId),
  listAffiliationsForGroup: (groupId) => ipcRenderer.invoke('groups:listAffiliationsForGroup', groupId),
  addAffiliation: (input) => ipcRenderer.invoke('groups:addAffiliation', input),
  updateAffiliation: (id, patch) => ipcRenderer.invoke('groups:updateAffiliation', id, patch),
  deleteAffiliation: (id) => ipcRenderer.invoke('groups:deleteAffiliation', id).then(() => undefined),
  listWorldImages: (entityKind, entityId) => ipcRenderer.invoke('world:listImages', entityKind, entityId),
  getWorldImageBlob: (imageId) => ipcRenderer.invoke('world:getImageBlob', imageId),
  deleteWorldImage: (imageId) => ipcRenderer.invoke('world:deleteImage', imageId).then(() => undefined),
  addWorldImageFromFile: (entityKind, entityId, kind) =>
    ipcRenderer.invoke('world:addImageFromFile', entityKind, entityId, kind),
  generateWorldImage: (entityKind, entityId, kind, style) =>
    ipcRenderer.invoke('world:generateImage', entityKind, entityId, kind, style),
  exportCharacterSheet: (personId, options) => ipcRenderer.invoke('characters:exportSheet', personId, options),
  listWorldEntries: () => ipcRenderer.invoke('encyclopedia:list'),
  getWorldEntry: (ref) => ipcRenderer.invoke('encyclopedia:get', ref),
  searchWorldBodies: (query) => ipcRenderer.invoke('encyclopedia:searchBodies', query),
  createWorldArticle: (input) => ipcRenderer.invoke('encyclopedia:createArticle', input),
  updateWorldArticle: (articleId, patch) => ipcRenderer.invoke('encyclopedia:updateArticle', articleId, patch),
  deleteWorldArticle: (articleId) => ipcRenderer.invoke('encyclopedia:deleteArticle', articleId).then(() => undefined),
  worldBacklinks: (ref) => ipcRenderer.invoke('encyclopedia:backlinks', ref),
  worldUnresolvedLinks: () => ipcRenderer.invoke('encyclopedia:unresolved'),
  resolveWorldLink: (text, target) => ipcRenderer.invoke('encyclopedia:resolveLink', text, target),
  rebuildWorldLinks: () => ipcRenderer.invoke('encyclopedia:rebuildLinks'),
  indexWorldEntry: (ref) => ipcRenderer.invoke('encyclopedia:indexEntry', ref),
  draftWorldArticle: (articleId, mode) => ipcRenderer.invoke('encyclopedia:draft', articleId, mode),
  acceptWorldArticleDraft: (articleId) => ipcRenderer.invoke('encyclopedia:acceptDraft', articleId),
  rejectWorldArticleDraft: (articleId) => ipcRenderer.invoke('encyclopedia:rejectDraft', articleId).then(() => undefined),
  analyzeMissingEntries: () => ipcRenderer.invoke('encyclopedia:analyzeMissing'),
  listEntryProposals: (status) => ipcRenderer.invoke('encyclopedia:listProposals', status),
  acceptEntryProposal: (proposalId) => ipcRenderer.invoke('encyclopedia:acceptProposal', proposalId),
  dismissEntryProposal: (proposalId) => ipcRenderer.invoke('encyclopedia:dismissProposal', proposalId).then(() => undefined),
  exportWorldBible: (options) => ipcRenderer.invoke('encyclopedia:exportBible', options),
  listSceneDayLinks: () => ipcRenderer.invoke('scenes:dayLinks'),
  setSceneDayLink: (sceneId, link) => ipcRenderer.invoke('scenes:setDayLink', sceneId, link),
  clearSceneDayLink: (sceneId) => ipcRenderer.invoke('scenes:clearDayLink', sceneId),
  reorderScene: (sceneId, toIndex) => ipcRenderer.invoke('scenes:reorder', sceneId, toIndex),
  listWorldThreads: (kind) => ipcRenderer.invoke('threads:list', kind),
  getWorldThread: (threadId) => ipcRenderer.invoke('threads:get', threadId),
  createWorldThread: (input) => ipcRenderer.invoke('threads:create', input),
  updateWorldThread: (threadId, patch) => ipcRenderer.invoke('threads:update', threadId, patch),
  deleteWorldThread: (threadId) => ipcRenderer.invoke('threads:delete', threadId).then(() => undefined),
  setThreadParties: (threadId, parties) => ipcRenderer.invoke('threads:setParties', threadId, parties),
  threadsForParty: (partyKind, partyId) => ipcRenderer.invoke('threads:forParty', partyKind, partyId),
  listWorldBeats: () => ipcRenderer.invoke('threads:beats'),
  threadBoardData: () => ipcRenderer.invoke('threads:board'),
  threadSceneContext: () => ipcRenderer.invoke('threads:sceneContext'),
  beatsForScene: (sceneId) => ipcRenderer.invoke('threads:beatsForScene', sceneId),
  setWorldBeat: (input) => ipcRenderer.invoke('threads:setBeat', input).then(() => undefined),
  deleteWorldBeat: (threadKind, threadId, sceneId) =>
    ipcRenderer.invoke('threads:deleteBeat', threadKind, threadId, sceneId).then(() => undefined),
  runWorldContinuity: () => ipcRenderer.invoke('continuity:run'),
  runWorldContinuityUnfiltered: () => ipcRenderer.invoke('continuity:runAll'),
  listNoticeMutes: () => ipcRenderer.invoke('continuity:mutes'),
  muteNotice: (input) => ipcRenderer.invoke('continuity:mute', input),
  unmuteNotice: (fingerprint) => ipcRenderer.invoke('continuity:unmute', fingerprint),
  continuitySummary: () => ipcRenderer.invoke('continuity:summary'),
  listWorldRules: () => ipcRenderer.invoke('rules:list'),
  getWorldRule: (ruleId) => ipcRenderer.invoke('rules:get', ruleId),
  createWorldRule: (input) => ipcRenderer.invoke('rules:create', input),
  updateWorldRule: (ruleId, patch) => ipcRenderer.invoke('rules:update', ruleId, patch),
  deleteWorldRule: (ruleId) => ipcRenderer.invoke('rules:delete', ruleId).then(() => undefined),
  rulesInPlay: (sceneId) => ipcRenderer.invoke('rules:inPlay', sceneId),
  draftWorldRule: (ruleId) => ipcRenderer.invoke('rules:draft', ruleId),
  acceptRuleDraft: (ruleId) => ipcRenderer.invoke('rules:acceptDraft', ruleId),
  rejectRuleDraft: (ruleId) => ipcRenderer.invoke('rules:rejectDraft', ruleId).then(() => undefined),
  questionFeed: (includeSettled) => ipcRenderer.invoke('questions:feed', includeSettled === true),
  listWorldQuestions: () => ipcRenderer.invoke('questions:list'),
  getWorldQuestion: (questionId) => ipcRenderer.invoke('questions:get', questionId),
  ensureQuestion: (input) => ipcRenderer.invoke('questions:ensure', input),
  updateWorldQuestion: (questionId, patch) => ipcRenderer.invoke('questions:update', questionId, patch),
  deleteWorldQuestion: (questionId) => ipcRenderer.invoke('questions:delete', questionId).then(() => undefined),
  setQuestionOption: (input) => ipcRenderer.invoke('questions:setOption', input),
  deleteQuestionOption: (optionId) => ipcRenderer.invoke('questions:deleteOption', optionId).then(() => undefined),
  applyQuestionOption: (optionId) => ipcRenderer.invoke('questions:apply', optionId),
  undoQuestionOption: (optionId) => ipcRenderer.invoke('questions:undo', optionId),
  canUndoQuestionOption: (optionId) => ipcRenderer.invoke('questions:canUndo', optionId),
  questionRemainingHoles: (optionId) => ipcRenderer.invoke('questions:remainingHoles', optionId),
  questionAnchorText: (kind, id, field) => ipcRenderer.invoke('questions:anchorText', kind, id, field),
  questionsForScene: (sceneId) => ipcRenderer.invoke('questions:forScene', sceneId),
  proposeQuestionOptions: (questionId) => ipcRenderer.invoke('questions:propose', questionId),
  worldChatStream: async (request, handlers) => {
    const requestId = `world-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onDelta = (_e: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onDelta(delta);
    };
    ipcRenderer.on('worldChat:delta', onDelta);
    activeWorldChatRequestId = requestId;
    try {
      return await ipcRenderer.invoke('worldChat:stream', requestId, request);
    } finally {
      if (activeWorldChatRequestId === requestId) activeWorldChatRequestId = null;
      ipcRenderer.removeListener('worldChat:delta', onDelta);
    }
  },
  listWorldChatConversations: () => ipcRenderer.invoke('worldChat:history:list'),
  getWorldChatConversation: (id) => ipcRenderer.invoke('worldChat:history:get', id),
  createWorldChatConversation: (input) => ipcRenderer.invoke('worldChat:history:create', input),
  saveWorldChatConversation: (id, messages, selection, focus, model) =>
    ipcRenderer.invoke('worldChat:history:save', id, messages, selection, focus, model),
  deleteWorldChatConversation: (id) => ipcRenderer.invoke('worldChat:history:delete', id).then(() => undefined),
  manuscriptSpine: () => ipcRenderer.invoke('manuscript:spine'),
  getSceneText: (sceneId) => ipcRenderer.invoke('manuscript:getText', sceneId),
  saveSceneText: (sceneId, text) => ipcRenderer.invoke('manuscript:saveText', sceneId, text),
  setChapterBreak: (sceneId, input) => ipcRenderer.invoke('manuscript:setChapter', sceneId, input).then(() => undefined),
  setBookStart: (sceneId, input) => ipcRenderer.invoke('manuscript:setBook', sceneId, input).then(() => undefined),
  listSceneSnapshots: (sceneId) => ipcRenderer.invoke('manuscript:snapshots', sceneId),
  takeSceneSnapshot: (sceneId) => ipcRenderer.invoke('manuscript:snapshot', sceneId),
  restoreSceneSnapshot: (snapshotId) => ipcRenderer.invoke('manuscript:restore', snapshotId),
  getSnapshotText: (snapshotId) => ipcRenderer.invoke('manuscript:snapshotText', snapshotId),
  manuscriptProgress: () => ipcRenderer.invoke('manuscript:progress'),
  reviewWorldProse: (sceneId) => ipcRenderer.invoke('manuscript:review', sceneId),
  exportManuscript: (options) => ipcRenderer.invoke('manuscript:export', options),
  cancelWorldChat: async () => {
    if (activeWorldChatRequestId) await ipcRenderer.invoke('worldChat:cancel', activeWorldChatRequestId);
  },
  recomputeSceneDays: () => ipcRenderer.invoke('scenes:recomputeDays'),
  listWorldMaps: () => ipcRenderer.invoke('maps:list'),
  getWorldMap: (mapId) => ipcRenderer.invoke('maps:get', mapId),
  createWorldMap: (input) => ipcRenderer.invoke('maps:create', input),
  updateWorldMap: (mapId, patch) => ipcRenderer.invoke('maps:update', mapId, patch),
  deleteWorldMap: (mapId) => ipcRenderer.invoke('maps:delete', mapId).then(() => undefined),
  childMaps: (mapId) => ipcRenderer.invoke('maps:children', mapId),
  mapAncestry: (mapId) => ipcRenderer.invoke('maps:ancestry', mapId),
  placeMapAppearances: (placeId) => ipcRenderer.invoke('maps:placeAppearances', placeId),
  mapCoverage: () => ipcRenderer.invoke('maps:coverage'),
  getMapImageBlob: (imageId) => ipcRenderer.invoke('maps:imageBlob', imageId),
  getMapThumbnail: (mapId) => ipcRenderer.invoke('maps:thumbnail', mapId),
  importMapImage: (mapId) => ipcRenderer.invoke('maps:importImage', mapId),
  growMapCanvas: (mapId, growth) => ipcRenderer.invoke('maps:growCanvas', mapId, growth),
  generateMapImage: (request) => ipcRenderer.invoke('maps:generateImage', request),
  zoomMapRegion: (request) => ipcRenderer.invoke('maps:zoomRegion', request),
  expandMapCanvas: (request) => ipcRenderer.invoke('maps:expandCanvas', request),
  suggestMapMarkers: (mapId) => ipcRenderer.invoke('maps:suggestMarkers', mapId),
  listMapMarkers: (mapId) => ipcRenderer.invoke('maps:listMarkers', mapId),
  createMapMarker: (input) => ipcRenderer.invoke('maps:createMarker', input),
  updateMapMarker: (markerId, patch) => ipcRenderer.invoke('maps:updateMarker', markerId, patch),
  deleteMapMarker: (markerId) => ipcRenderer.invoke('maps:deleteMarker', markerId).then(() => undefined),
  circleToPolygon: (markerId, aspect, vertices) => ipcRenderer.invoke('maps:circleToPolygon', markerId, aspect, vertices),
  listMapLayers: (mapId) => ipcRenderer.invoke('maps:listLayers', mapId),
  createMapLayer: (mapId, input) => ipcRenderer.invoke('maps:createLayer', mapId, input),
  updateMapLayer: (layerId, patch) => ipcRenderer.invoke('maps:updateLayer', layerId, patch),
  deleteMapLayer: (layerId) => ipcRenderer.invoke('maps:deleteLayer', layerId).then(() => undefined),
  listWorldPresences: () => ipcRenderer.invoke('maps:presences'),
  listTravelModes: () => ipcRenderer.invoke('maps:listTravelModes'),
  ensureTravelModes: () => ipcRenderer.invoke('maps:ensureTravelModes'),
  createTravelMode: (input) => ipcRenderer.invoke('maps:createTravelMode', input),
  updateTravelMode: (modeId, patch) => ipcRenderer.invoke('maps:updateTravelMode', modeId, patch),
  deleteTravelMode: (modeId) => ipcRenderer.invoke('maps:deleteTravelMode', modeId).then(() => undefined),
  getWorldCalendar: () => ipcRenderer.invoke('world:getCalendar'),
  saveWorldCalendar: (input) => ipcRenderer.invoke('world:saveCalendar', input),
  getEventWorldDate: (eventId) => ipcRenderer.invoke('world:getEventDate', eventId),
  setEventWorldDate: (eventId, date, worldOrder) =>
    ipcRenderer.invoke('world:setEventDate', eventId, date, worldOrder).then(() => undefined),
  generateCharacterBiography: (personId, mode) => ipcRenderer.invoke('characters:generateBiography', personId, mode),
  interviewCharacter: (personId, question, history) =>
    ipcRenderer.invoke('characters:interview', personId, question, history),
  listCharacterChatConversations: (personId) =>
    ipcRenderer.invoke('characters:listChatConversations', personId),
  getCharacterChatConversation: (id) =>
    ipcRenderer.invoke('characters:getChatConversation', id),
  createCharacterChatConversation: (input) =>
    ipcRenderer.invoke('characters:createChatConversation', input),
  setCharacterChatImagesEnabled: (id, enabled) =>
    ipcRenderer.invoke('characters:setChatImagesEnabled', id, enabled),
  sendCharacterChatMessage: (id, question) =>
    ipcRenderer.invoke('characters:sendChatMessage', id, question),
  deleteCharacterChatConversation: (id) =>
    ipcRenderer.invoke('characters:deleteChatConversation', id).then(() => undefined),
  acceptProposedBiography: (personId) => ipcRenderer.invoke('characters:acceptProposedBiography', personId),
  discardProposedBiography: (personId) => ipcRenderer.invoke('characters:discardProposedBiography', personId),
  generateCharacterPortrait: (personId, style, extra) =>
    ipcRenderer.invoke('characters:generatePortrait', personId, style, extra),
  listCharacterImages: (personId) => ipcRenderer.invoke('characters:listImages', personId),
  getCharacterImageBlob: (imageId) => ipcRenderer.invoke('characters:getImageBlob', imageId),
  addCharacterImageFromFile: (personId, kind) => ipcRenderer.invoke('characters:addImageFromFile', personId, kind),
  generateCharacterImage: (personId, kind, style, extra) =>
    ipcRenderer.invoke('characters:generateImage', personId, kind, style, extra),
  updateCharacterImage: (imageId, patch) =>
    ipcRenderer.invoke('characters:updateImage', imageId, patch).then(() => undefined),
  deleteCharacterImage: (imageId) => ipcRenderer.invoke('characters:deleteImage', imageId).then(() => undefined),
  setCharacterAvatarFromImage: (imageId) =>
    ipcRenderer.invoke('characters:setAvatarFromImage', imageId).then(() => undefined),
  listCharacterAbilities: (personId) => ipcRenderer.invoke('characters:listAbilities', personId),
  addCharacterAbility: (personId, input) => ipcRenderer.invoke('characters:addAbility', personId, input),
  updateCharacterAbility: (abilityId, patch) => ipcRenderer.invoke('characters:updateAbility', abilityId, patch),
  deleteCharacterAbility: (abilityId) =>
    ipcRenderer.invoke('characters:deleteAbility', abilityId).then(() => undefined),
  setCharacterName: (personId, name, kind, secret, knownBy) =>
    ipcRenderer.invoke('characters:setName', personId, name, kind, secret, knownBy),
  deleteCharacterName: (personId, name) => ipcRenderer.invoke('characters:deleteName', personId, name),
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
  runDatabaseComparisonCell: (rowId, columnId) => ipcRenderer.invoke('db:runComparisonCell', rowId, columnId),
  runDatabaseComparisonColumn: (databaseId, columnId) => ipcRenderer.invoke('db:runComparisonColumn', databaseId, columnId),
  onDatabaseComparisonProgress: (cb) => {
    const listener = (
      _e: unknown,
      payload: { vaultId: string; databaseId: string; columnId: string; done: number; total: number }
    ) => cb(payload);
    ipcRenderer.on('db:comparisonProgress', listener);
    return () => ipcRenderer.removeListener('db:comparisonProgress', listener);
  },
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
    const listener = (
      _e: unknown,
      payload: { vaultId: string; databaseId: string; columnId: string; done: number; total: number }
    ) => cb(payload);
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
  getMcpTunnelStatus: () => ipcRenderer.invoke('mcp:tunnel:status'),
  connectMcpTunnel: (input) => ipcRenderer.invoke('mcp:tunnel:connect', input),
  disconnectMcpTunnel: () => ipcRenderer.invoke('mcp:tunnel:disconnect'),
  forgetMcpTunnel: () => ipcRenderer.invoke('mcp:tunnel:forget'),
  getNodusServerOverview: () => ipcRenderer.invoke('nodusServer:overview'),
  pairNodusServer: (url, code) => ipcRenderer.invoke('nodusServer:pair', url, code),
  setNodusServerLanguage: (language, vaultId) => ipcRenderer.invoke('nodusServer:setLanguage', language, vaultId),
  syncNodusServerVaultNow: (vaultId) => ipcRenderer.invoke('nodusServer:syncVaultNow', vaultId),
  disconnectNodusServerVault: (vaultId) => ipcRenderer.invoke('nodusServer:disconnectVault', vaultId),
  getCopilotStatus: () => ipcRenderer.invoke('copilot:status'),
  regenerateCopilotToken: () => ipcRenderer.invoke('copilot:regenerateToken'),
  getZoteroPluginStatus: () => ipcRenderer.invoke('zoteroPlugin:status'),
  regenerateZoteroPluginToken: () => ipcRenderer.invoke('zoteroPlugin:regenerateToken'),
  getZoteroInstallInfo: () => ipcRenderer.invoke('zoteroPlugin:installInfo'),
  installZoteroPlugin: () => ipcRenderer.invoke('zoteroPlugin:install'),
  downloadZoteroPluginXpi: () => ipcRenderer.invoke('zoteroPlugin:downloadXpi'),
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

  getChatGptSubscriptionStatus: () => ipcRenderer.invoke('ai:chatgptSubscription:status'),
  startChatGptSubscriptionLogin: () => ipcRenderer.invoke('ai:chatgptSubscription:login'),
  cancelChatGptSubscriptionLogin: (loginId) => ipcRenderer.invoke('ai:chatgptSubscription:cancelLogin', loginId),
  logoutChatGptSubscription: () => ipcRenderer.invoke('ai:chatgptSubscription:logout'),
  onChatGptSubscriptionStatusChanged: (cb) => {
    const listener = (_e: unknown, status: Parameters<typeof cb>[0]) => cb(status);
    ipcRenderer.on('ai:chatgptSubscription:statusChanged', listener);
    return () => ipcRenderer.removeListener('ai:chatgptSubscription:statusChanged', listener);
  },
  getGitHubCopilotSubscriptionStatus: () => ipcRenderer.invoke('ai:githubCopilotSubscription:status'),
  startGitHubCopilotSubscriptionLogin: () => ipcRenderer.invoke('ai:githubCopilotSubscription:login'),
  cancelGitHubCopilotSubscriptionLogin: () => ipcRenderer.invoke('ai:githubCopilotSubscription:cancelLogin'),
  logoutGitHubCopilotSubscription: () => ipcRenderer.invoke('ai:githubCopilotSubscription:logout'),
  onGitHubCopilotSubscriptionStatusChanged: (cb) => {
    const listener = (_e: unknown, status: Parameters<typeof cb>[0]) => cb(status);
    ipcRenderer.on('ai:githubCopilotSubscription:statusChanged', listener);
    return () => ipcRenderer.removeListener('ai:githubCopilotSubscription:statusChanged', listener);
  },
  getOpenCodeGoUsageStatus: () => ipcRenderer.invoke('ai:openCodeGo:usage'),
  onOpenCodeGoUsageStatusChanged: (cb) => {
    const listener = (_e: unknown, status: Parameters<typeof cb>[0]) => cb(status);
    ipcRenderer.on('ai:openCodeGo:usageChanged', listener);
    return () => ipcRenderer.removeListener('ai:openCodeGo:usageChanged', listener);
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
  cancelNodusLocalDownloads: () => ipcRenderer.invoke('ai:nodusLocal:cancelDownloads'),
  deleteNodusLocalModel: (model) => ipcRenderer.invoke('ai:nodusLocal:deleteModel', model),
  getNodusLocalImageStatus: () => ipcRenderer.invoke('ai:nodusLocalImage:status'),
  installNodusLocalImageRuntime: async (onProgress) => {
    const requestId = `nodus-local-image-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const listener = (_event: unknown, id: string, fraction: number) => { if (id === requestId) onProgress?.(fraction); };
    ipcRenderer.on('ai:nodusLocalImage:progress', listener);
    try { return await ipcRenderer.invoke('ai:nodusLocalImage:installRuntime', requestId); }
    finally { ipcRenderer.removeListener('ai:nodusLocalImage:progress', listener); }
  },
  downloadNodusLocalImageModel: async (model, onProgress) => {
    const requestId = `nodus-local-image-model-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const listener = (_event: unknown, id: string, fraction: number) => { if (id === requestId) onProgress?.(fraction); };
    ipcRenderer.on('ai:nodusLocalImage:progress', listener);
    try { return await ipcRenderer.invoke('ai:nodusLocalImage:downloadModel', requestId, model); }
    finally { ipcRenderer.removeListener('ai:nodusLocalImage:progress', listener); }
  },
  deleteNodusLocalImageModel: (model) => ipcRenderer.invoke('ai:nodusLocalImage:deleteModel', model),
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
  openThirdPartyNotices: () => ipcRenderer.invoke('shell:openThirdPartyNotices').then(() => undefined),
  openPrivacyPolicy: () => ipcRenderer.invoke('shell:openPrivacyPolicy').then(() => undefined),
  onStudyMaterialAiProcessingRequest: (cb) => {
    const listener = (_e: unknown, request: Parameters<typeof cb>[0]) => cb(request);
    ipcRenderer.on('study:knowledge:processing:request', listener);
    return () => ipcRenderer.removeListener('study:knowledge:processing:request', listener);
  },
  resolveStudyMaterialAiProcessingRequest: (requestId, decision) =>
    ipcRenderer.invoke('study:knowledge:processing:resolve', requestId, decision).then(() => undefined),
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
  deleteIdea: (globalId) => ipcRenderer.invoke('ideas:delete', globalId).then(() => undefined),
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
  getStudySchedule: (academicYearId) => ipcRenderer.invoke('study:schedule:get', academicYearId ?? null),
  saveStudySchedule: (schedule) => ipcRenderer.invoke('study:schedule:save', schedule),
  copyStudySchedule: (fromAcademicYearId, toAcademicYearId) => ipcRenderer.invoke('study:schedule:copy', fromAcademicYearId, toAcademicYearId),
  createStudyAcademicYear: (input) => ipcRenderer.invoke('study:academicYear:create', input),
  updateStudyAcademicYear: (id, patch) => ipcRenderer.invoke('study:academicYear:update', id, patch),
  deleteStudyAcademicYear: (id) => ipcRenderer.invoke('study:academicYear:delete', id).then(() => undefined),
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
  setStudyLifecycle: (kind, id, action, options) => ipcRenderer.invoke('study:lifecycle:set', kind, id, action, options).then(() => undefined),
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
  setStudyMaterialLifecycle: (id, action, options) => ipcRenderer.invoke('study:materials:lifecycle', id, action, options).then(() => undefined),
  listStudyRecordings: (options) => ipcRenderer.invoke('study:recordings:list', options),
  getStudyRecording: (id) => ipcRenderer.invoke('study:recordings:get', id),
  getStudyRecordingContent: (id) => ipcRenderer.invoke('study:recordings:content', id),
  listAssessmentPlans: (options) => ipcRenderer.invoke('teaching:plans:list', options),
  getAssessmentPlan: (id) => ipcRenderer.invoke('teaching:plans:get', id),
  createAssessmentPlan: (input) => ipcRenderer.invoke('teaching:plans:create', input),
  updateAssessmentPlan: (id, patch) => ipcRenderer.invoke('teaching:plans:update', id, patch),
  publishAssessmentPlan: (id) => ipcRenderer.invoke('teaching:plans:publish', id),
  reviseAssessmentPlan: (id) => ipcRenderer.invoke('teaching:plans:revise', id),
  deleteAssessmentPlan: (id) => ipcRenderer.invoke('teaching:plans:delete', id).then(() => undefined),
  createAssessmentItem: (planId, input) => ipcRenderer.invoke('teaching:items:create', planId, input),
  updateAssessmentItem: (id, patch) => ipcRenderer.invoke('teaching:items:update', id, patch),
  deleteAssessmentItem: (id) => ipcRenderer.invoke('teaching:items:delete', id).then(() => undefined),
  reorderAssessmentItems: (planId, orderedIds) => ipcRenderer.invoke('teaching:items:reorder', planId, orderedIds),
  listGradeEntries: (planId, convocatoria) => ipcRenderer.invoke('teaching:entries:list', planId, convocatoria),
  setGradeEntry: (input) => ipcRenderer.invoke('teaching:entries:set', input),
  clearGradeEntry: (studentId, itemId, convocatoria) => ipcRenderer.invoke('teaching:entries:clear', studentId, itemId, convocatoria).then(() => undefined),
  gradebookCohortStats: (planId, groupId, convocatoria) => ipcRenderer.invoke('teaching:entries:cohort', planId, groupId, convocatoria),
  gradebookRatchetBaseline: (planId, groupId, convocatoria) => ipcRenderer.invoke('teaching:entries:ratchet', planId, groupId, convocatoria),
  exportGradebookActa: (format, input, grid) => ipcRenderer.invoke('teaching:export:acta', format, input, grid),
  exportGradebookBoletin: (input) => ipcRenderer.invoke('teaching:export:boletin', input),
  addExamBlock: (planId, examId, weight) => ipcRenderer.invoke('teaching:items:fromExam', planId, examId, weight),
  addRubricItem: (planId, rubricId, weight) => ipcRenderer.invoke('teaching:items:fromRubric', planId, rubricId, weight),
  setRubricEvaluation: (input) => ipcRenderer.invoke('teaching:entries:rubric:set', input),
  getRubricEvaluation: (studentId, itemId, convocatoria) => ipcRenderer.invoke('teaching:entries:rubric:get', studentId, itemId, convocatoria),
  importAssessmentPlan: (request) => ipcRenderer.invoke('teaching:plans:import', request),
  applyProposedPlan: (planId, proposal) => ipcRenderer.invoke('teaching:plans:apply', planId, proposal),
  listTeachingGroups: (options) => ipcRenderer.invoke('teaching:groups:list', options),
  getTeachingGroup: (id) => ipcRenderer.invoke('teaching:groups:get', id),
  createTeachingGroup: (input) => ipcRenderer.invoke('teaching:groups:create', input),
  updateTeachingGroup: (id, patch) => ipcRenderer.invoke('teaching:groups:update', id, patch),
  deleteTeachingGroup: (id) => ipcRenderer.invoke('teaching:groups:delete', id).then(() => undefined),
  addTeachingStudent: (groupId, count) => ipcRenderer.invoke('teaching:groups:student:add', groupId, count),
  updateTeachingStudent: (id, patch) => ipcRenderer.invoke('teaching:groups:student:update', id, patch),
  deleteTeachingStudent: (id) => ipcRenderer.invoke('teaching:groups:student:delete', id).then(() => undefined),
  importStudentsFromGroup: (targetGroupId, sourceGroupId) => ipcRenderer.invoke('teaching:groups:import', targetGroupId, sourceGroupId),
  listTeachingRubrics: (options) => ipcRenderer.invoke('teaching:rubrics:list', options),
  getTeachingRubric: (id) => ipcRenderer.invoke('teaching:rubrics:get', id),
  createTeachingRubric: (input) => ipcRenderer.invoke('teaching:rubrics:create', input),
  updateTeachingRubric: (id, patch) => ipcRenderer.invoke('teaching:rubrics:update', id, patch),
  deleteTeachingRubric: (id) => ipcRenderer.invoke('teaching:rubrics:delete', id).then(() => undefined),
  duplicateTeachingRubric: (id) => ipcRenderer.invoke('teaching:rubrics:duplicate', id),
  setTeachingRubricCell: (id, criterionId, levelId, text) => ipcRenderer.invoke('teaching:rubrics:cell', id, criterionId, levelId, text),
  fillRubricCell: (request) => ipcRenderer.invoke('teaching:rubrics:cell:fill', request),
  generateRubric: (request) => ipcRenderer.invoke('teaching:rubrics:generate', request),
  pickRubricSourceFile: () => ipcRenderer.invoke('teaching:rubrics:pickFile'),
  exportTeachingRubric: (id, format, options) => ipcRenderer.invoke('teaching:rubrics:export', id, format, options),
  listTeachingExams: (options) => ipcRenderer.invoke('teaching:exams:list', options),
  getTeachingExam: (id) => ipcRenderer.invoke('teaching:exams:get', id),
  createTeachingExam: (input) => ipcRenderer.invoke('teaching:exams:create', input),
  updateTeachingExam: (id, patch) => ipcRenderer.invoke('teaching:exams:update', id, patch),
  deleteTeachingExam: (id) => ipcRenderer.invoke('teaching:exams:delete', id).then(() => undefined),
  duplicateTeachingExam: (id) => ipcRenderer.invoke('teaching:exams:duplicate', id),
  addTeachingExamQuestion: (examId, input) => ipcRenderer.invoke('teaching:exams:question:add', examId, input),
  updateTeachingExamQuestion: (id, patch) => ipcRenderer.invoke('teaching:exams:question:update', id, patch),
  deleteTeachingExamQuestion: (id) => ipcRenderer.invoke('teaching:exams:question:delete', id).then(() => undefined),
  reorderTeachingExamQuestions: (examId, orderedIds) => ipcRenderer.invoke('teaching:exams:question:reorder', examId, orderedIds),
  generateExamQuestion: (request) => ipcRenderer.invoke('teaching:exams:question:generate', request),
  pickExamImage: (kind) => ipcRenderer.invoke('teaching:exams:pickImage', kind),
  listTeachingLogos: () => ipcRenderer.invoke('teaching:logos:list'),
  addTeachingLogo: (name, dataUrl) => ipcRenderer.invoke('teaching:logos:add', name, dataUrl),
  importTeachingLogo: () => ipcRenderer.invoke('teaching:logos:import'),
  deleteTeachingLogo: (id) => ipcRenderer.invoke('teaching:logos:delete', id).then(() => undefined),
  exportTeachingExam: (id, format, options) => ipcRenderer.invoke('teaching:exams:export', id, format, options),
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
  deleteStudyIdea: (id) => ipcRenderer.invoke('study:knowledge:idea:delete', id).then(() => undefined),
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
  exportImmersionSessionPdf: (id) => ipcRenderer.invoke('immersion:exportPdf', id),
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
  importSyncPackage: (passphrase?: string) => ipcRenderer.invoke('data:importSync', passphrase),
  hasSyncPassphrase: () => ipcRenderer.invoke('sync:hasPassphrase'),
  setSyncPassphrase: (passphrase: string) => ipcRenderer.invoke('sync:setPassphrase', passphrase),
  clearSyncPassphrase: () => ipcRenderer.invoke('sync:clearPassphrase'),
  countSupersededVersions: () => ipcRenderer.invoke('sync:supersededCount'),
  listSupersededVersions: (limit?: number, offset?: number) => ipcRenderer.invoke('sync:supersededList', limit, offset),
  restoreSupersededVersion: (id: string) => ipcRenderer.invoke('sync:supersededRestore', id),
  clearSupersededVersions: (ids?: string[]) => ipcRenderer.invoke('sync:supersededClear', ids),
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
  getTutorialCatalogue: () => ipcRenderer.invoke('tutorials:catalogue'),
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
  seedTeachingDemoData: () => ipcRenderer.invoke('data:seedTeachingDemo'),
  seedWorldbuildingDemoData: () => ipcRenderer.invoke('data:seedWorldbuildingDemo'),
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

  // Nodus Toolkit (Convert). Progress is pushed on 'toolkit:job:event' filtered
  // by a per-run jobId, mirroring the Nodi chat-stream pattern.
  runToolkitJob: async (request, handlers) => {
    const jobId = `toolkit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onEvent = (_e: unknown, id: string, progress: Parameters<typeof handlers.onProgress>[0]) => {
      if (id === jobId) handlers.onProgress(progress);
    };
    ipcRenderer.on('toolkit:job:event', onEvent);
    try {
      return await ipcRenderer.invoke('toolkit:job:run', jobId, request);
    } finally {
      ipcRenderer.removeListener('toolkit:job:event', onEvent);
    }
  },
  cancelToolkitJob: (jobId) => ipcRenderer.invoke('toolkit:job:cancel', jobId).then(() => undefined),
  pickToolkitFiles: (extensions) => ipcRenderer.invoke('toolkit:pickFiles', extensions),
  pickToolkitOutputDir: () => ipcRenderer.invoke('toolkit:pickOutputDir'),
  revealToolkitOutput: (filePath) => ipcRenderer.invoke('toolkit:showInFolder', filePath).then(() => undefined),

  // Nodus Translate. A per-run id keeps simultaneous/late events isolated in the
  // renderer and gives cancellation an unambiguous main-process target.
  runTranslateJob: async (request, handlers) => {
    const jobId = `translate-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onEvent = (_e: unknown, id: string, progress: Parameters<typeof handlers.onProgress>[0]) => {
      if (id === jobId) handlers.onProgress(progress);
    };
    ipcRenderer.on('translate:job:event', onEvent);
    try {
      return await ipcRenderer.invoke('translate:job:run', jobId, request);
    } finally {
      ipcRenderer.removeListener('translate:job:event', onEvent);
    }
  },
  cancelTranslateJob: (jobId) => ipcRenderer.invoke('translate:job:cancel', jobId).then(() => undefined),
  saveTranslatedText: (text, targetLanguage, extension) => ipcRenderer.invoke('translate:text:save', text, targetLanguage, extension),
  listTranslateHistory: () => ipcRenderer.invoke('translate:history:list'),
  removeTranslateHistory: (id, deleteOutput) => ipcRenderer.invoke('translate:history:remove', id, deleteOutput),

  // Nodus AI OCR (OCR Workspace). Progress is pushed on 'aiOcr:event' (docId + snapshot).
  createOcrDocs: (input) => ipcRenderer.invoke('aiOcr:create', input),
  listOcrDocs: () => ipcRenderer.invoke('aiOcr:list'),
  searchOcrDocs: (query) => ipcRenderer.invoke('aiOcr:search', query),
  getOcrDoc: (id) => ipcRenderer.invoke('aiOcr:get', id),
  deleteOcrDoc: (id) => ipcRenderer.invoke('aiOcr:delete', id).then(() => undefined),
  cancelOcrDoc: (id) => ipcRenderer.invoke('aiOcr:cancel', id).then(() => undefined),
  reprocessOcrPage: (id, index, patch) => ipcRenderer.invoke('aiOcr:reprocessPage', id, index, patch).then(() => undefined),
  reprocessOcrDocument: (id, patch) => ipcRenderer.invoke('aiOcr:reprocessDocument', id, patch).then(() => undefined),
  getOcrPageImage: (id, index) => ipcRenderer.invoke('aiOcr:pageImage', id, index),
  getOcrPageText: (id, index) => ipcRenderer.invoke('aiOcr:pageText', id, index),
  saveOcrPageEdit: (id, index, text) => ipcRenderer.invoke('aiOcr:updatePage', id, index, text).then(() => undefined),
  getOcrTranscript: (id) => ipcRenderer.invoke('aiOcr:transcript', id),
  exportOcrDoc: (id, format) => ipcRenderer.invoke('aiOcr:export', id, format),
  exportOcrDocsZip: (ids, format) => ipcRenderer.invoke('aiOcr:exportZip', ids, format),
  saveOcrToVault: (id) => ipcRenderer.invoke('aiOcr:saveToVault', id),
  pickOcrFiles: () => ipcRenderer.invoke('aiOcr:pickFiles'),
  onOcrEvent: (cb) => {
    const listener = (_e: unknown, docId: string, progress: Parameters<typeof cb>[1]) => cb(docId, progress);
    ipcRenderer.on('aiOcr:event', listener);
    return () => ipcRenderer.removeListener('aiOcr:event', listener);
  },
  pickProtectFiles: (multiple) => ipcRenderer.invoke('protect:pickFiles', multiple),
  registerProtectDroppedFiles: (files) => ipcRenderer.invoke(
    'protect:registerDroppedFiles',
    files.map((file) => webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0])),
  ),
  listProtectVaultSources: (request) => ipcRenderer.invoke('protect:listVaultSources', request),
  readProtectSource: (ref) => ipcRenderer.invoke('protect:readSource', ref),
  saveProtectArtifactToDisk: (artifact) => ipcRenderer.invoke('protect:saveDisk', artifact),
  shareProtectArtifact: (artifact) => ipcRenderer.invoke('protect:share', artifact),
  listProtectCopies: (query) => ipcRenderer.invoke('protect:copies:list', query),
  saveProtectArtifactToVault: (artifact) => ipcRenderer.invoke('protect:copies:save', artifact),
  downloadProtectCopy: (copyId) => ipcRenderer.invoke('protect:copies:download', copyId),
  deleteProtectCopy: (copyId) => ipcRenderer.invoke('protect:copies:delete', copyId).then(() => undefined),

  // Nodus Apps — sandboxed mini-app generation + temporary LAN sessions.
  generateToolkitApp: async (request, onProgress) => {
    const requestId = `toolkit-app-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const listener = (_e: unknown, id: string, progress: Parameters<NonNullable<typeof onProgress>>[0]) => {
      if (id === requestId) onProgress?.(progress);
    };
    ipcRenderer.on('toolkitApps:generate:progress', listener);
    try {
      return await ipcRenderer.invoke('toolkitApps:generate', requestId, request);
    } finally {
      ipcRenderer.removeListener('toolkitApps:generate:progress', listener);
    }
  },
  downloadToolkitAppPackage: (manifest) => ipcRenderer.invoke('toolkitApps:package:download', manifest),
  startToolkitAppSession: (manifest) => ipcRenderer.invoke('toolkitApps:session:start', manifest),
  stopToolkitAppSession: () => ipcRenderer.invoke('toolkitApps:session:stop').then(() => undefined),
  getToolkitAppSessionInfo: () => ipcRenderer.invoke('toolkitApps:session:info'),
  getToolkitAppSessionSnapshot: () => ipcRenderer.invoke('toolkitApps:session:snapshot'),
  sendToolkitAppSessionMessage: (channel, payload) => ipcRenderer.invoke('toolkitApps:session:send', channel, payload).then(() => undefined),
  onToolkitAppSessionEvent: (cb) => {
    const listener = (_e: unknown, event: Parameters<typeof cb>[0]) => cb(event);
    ipcRenderer.on('toolkitApps:session:event', listener);
    return () => ipcRenderer.removeListener('toolkitApps:session:event', listener);
  },

  // PDF Presenter — global library of imported PDFs (Toolkit). The PDF bytes are
  // fetched over IPC (offline; no file:// or CDN) for pdfjs to render.
  getPresenterLibrary: () => ipcRenderer.invoke('presenter:library:get'),
  savePresenterLibrary: (lib) => ipcRenderer.invoke('presenter:library:save', lib).then(() => undefined),
  pickPresenterImport: () => ipcRenderer.invoke('presenter:import:pick'),
  importPresenterFile: (token) => ipcRenderer.invoke('presenter:import:file', token),
  getPresenterPdfData: (id) => ipcRenderer.invoke('presenter:pdf:getData', id),
  deletePresenterPresentation: (id) => ipcRenderer.invoke('presenter:delete', id).then(() => undefined),
  importPresenterPptxNotes: () => ipcRenderer.invoke('presenter:import:pptxNotes'),
  exportPresenterNotesTxt: (presentation) => ipcRenderer.invoke('presenter:export:txtNotes', presentation),
  importPresenterNotesTxt: () => ipcRenderer.invoke('presenter:import:txtNotes'),
  startPresenter: (pdfId, startSlide) => ipcRenderer.invoke('presenter:start', pdfId, startSlide).then(() => undefined),
  startPresenterMode: (pdfId, startSlide) => ipcRenderer.invoke('presenter:startPresenterMode', pdfId, startSlide).then(() => undefined),
  stopPresenter: () => ipcRenderer.invoke('presenter:stop').then(() => undefined),
  getPresenterState: () => ipcRenderer.invoke('presenter:state:get'),
  getPresenterServerInfo: () => ipcRenderer.invoke('presenter:server:info'),
  getPresenterVolume: () => ipcRenderer.invoke('presenter:volume:get'),
  setPresenterVolume: (volume) => ipcRenderer.invoke('presenter:volume:set', volume).then(() => undefined),
  openPresenterCast: () => ipcRenderer.invoke('presenter:cast'),
  sendPresenterControl: (action) => ipcRenderer.send('presenter:control', action),
  onPresenterControl: (cb) => {
    const listener = (_e: unknown, action: PresenterControlAction) => cb(action);
    ipcRenderer.on('presenter:control:event', listener);
    return () => ipcRenderer.removeListener('presenter:control:event', listener);
  },
  onPresenterEnded: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('presenter:ended', listener);
    return () => ipcRenderer.removeListener('presenter:ended', listener);
  },
};

contextBridge.exposeInMainWorld('nodus', api);
