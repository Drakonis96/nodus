// The whole window.nodus contract, assembled from the per-domain slices.
//
// It lives here rather than in the entry file because three window classes now
// build their bridge from it: the main window exposes all of it, while Nodi and
// the Presenter expose a named subset (see ./nodi.ts and ./presenter.ts). Keeping
// one assembled object means those subsets can never drift from the real binding.
//
// `NodusApi` on the object is what makes a method lost during a domain move a
// typecheck failure rather than an `undefined` the renderer discovers at runtime.
import { ipcRenderer, webUtils } from 'electron';
import type {
  NodusApi,
  NodiOverlayPlacement,
  RecoveryRestoreProgress,
  UpdateProgressEvent,
} from '@shared/types';
import { prosopographyApi } from './prosopography';
import { testimoniesApi } from './testimonies';
import { toolkitApi } from './toolkit';
import { teachingApi } from './teaching';
import { databasesApi } from './databases';
import { pagesApi } from './pages';
import { primarySourcesApi } from './primarySources';
import { archiveApi } from './archive';
import { worldbuildingApi } from './worldbuilding';
import { platformApi } from './platform';
import { recordsApi } from './records';
import { academicApi } from './academic';
import { libraryApi } from './library';
import { browserApi } from './browser';
import { radarApi } from './radar';

// Tracks the Nodi chat stream currently in flight so `cancelNodiChat` can abort
// it without the renderer having to juggle request ids. Only one chat stream
// runs at a time (the composer is disabled while sending).
let activeNodiChatRequestId: string | null = null;

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

export const nodusApi: NodusApi = {
  ...libraryApi,
  ...browserApi,
  ...radarApi,
  ...prosopographyApi,
  ...academicApi,
  ...recordsApi,
  ...platformApi,
  ...worldbuildingApi,
  ...archiveApi,
  ...primarySourcesApi,
  ...databasesApi,
  ...pagesApi,
  ...teachingApi,
  ...toolkitApi,
  ...testimoniesApi,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  listVaults: () => ipcRenderer.invoke('vaults:list'),
  // Nodi companion: notifications
  listNotifications: () => ipcRenderer.invoke('nodi:notifications:list'),
  refreshNotifications: () => ipcRenderer.invoke('nodi:notifications:refresh'),
  markNotificationsRead: () => ipcRenderer.invoke('nodi:notifications:markRead'),
  clearNotifications: () => ipcRenderer.invoke('nodi:notifications:clear'),
  openNotification: (id) => ipcRenderer.invoke('nodi:notifications:open', id).then(() => undefined),
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
  // Published announcements
  listAnnouncements: () => ipcRenderer.invoke('announcements:list'),
  markAnnouncementRead: (id) => ipcRenderer.invoke('announcements:markRead', id),
  onAnnouncementsChanged: (cb) => {
    const listener = (_e: unknown, list: Parameters<typeof cb>[0]) => cb(list);
    ipcRenderer.on('announcements:changed', listener);
    return () => ipcRenderer.removeListener('announcements:changed', listener);
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
  quoteNodiSelection: (text) => ipcRenderer.invoke('nodi:quoteSelection:set', text),
  consumeNodiQuoteSelection: () => ipcRenderer.invoke('nodi:quoteSelection:consume'),
  onNodiQuoteSelection: (cb) => {
    const listener = (_e: unknown, selection: Parameters<typeof cb>[0]) => cb(selection);
    ipcRenderer.on('nodi:quoteSelection', listener);
    return () => ipcRenderer.removeListener('nodi:quoteSelection', listener);
  },
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
  onAiModelRequired: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('ai:modelRequired', listener);
    return () => ipcRenderer.removeListener('ai:modelRequired', listener);
  },
  onDeepLink: (cb) => {
    const listener = (_e: unknown, url: string) => cb(url);
    ipcRenderer.on('deeplink:received', listener);
    return () => ipcRenderer.removeListener('deeplink:received', listener);
  },
  getActiveVault: () => ipcRenderer.invoke('vaults:getActive'),
  createVault: (input) => ipcRenderer.invoke('vaults:create', input),
  remoteSignIn: (url, email, password) => ipcRenderer.invoke('vaults:remoteSignIn', url, email, password),
  createConnectedVault: (input) => ipcRenderer.invoke('vaults:createConnected', input),
  replicaOverview: () => ipcRenderer.invoke('vaults:replicaOverview'),
  replicaSyncNow: (vaultId) => ipcRenderer.invoke('vaults:replicaSyncNow', vaultId),
  replicaPresence: (vaultId) => ipcRenderer.invoke('vaults:replicaPresence', vaultId),
  replicaUpdatePresence: (vaultId, input) => ipcRenderer.invoke('vaults:replicaUpdatePresence', vaultId, input),
  replicaDetach: (vaultId) => ipcRenderer.invoke('vaults:replicaDetach', vaultId),
  renameVault: (id, name) => ipcRenderer.invoke('vaults:rename', id, name),
  setVaultType: (id, type) => ipcRenderer.invoke('vaults:setType', id, type),
  switchVault: (id, options) => ipcRenderer.invoke('vaults:switch', id, options),
  duplicateVault: (id, name, options) => ipcRenderer.invoke('vaults:duplicate', id, name, options),
  deleteVault: (id, deleteFiles) => ipcRenderer.invoke('vaults:delete', id, deleteFiles).then(() => undefined),
  resetVault: (id) => ipcRenderer.invoke('vaults:reset', id),
  reuseVaultAnalysis: (nodusIds, operationId) => ipcRenderer.invoke('vaults:reuseAnalysis', nodusIds, operationId),
  cancelVaultAnalysisReuse: (operationId) => ipcRenderer.invoke('vaults:cancelReuseAnalysis', operationId),
  copyVaultApiKeys: (sourceVaultId, targetVaultId) =>
    ipcRenderer.invoke('vaults:copyApiKeys', sourceVaultId, targetVaultId),
  listMigrationRecoverySnapshots: () => ipcRenderer.invoke('migrationRecovery:list'),
  openMigrationRecoverySnapshot: (id) => ipcRenderer.invoke('migrationRecovery:open', id),


  // Core: sync, backups, recovery. Regrouped here so the academic and study
  // bindings above form one range — they used to sit inside it.
  syncNow: () => ipcRenderer.invoke('sync:now'),
  getSyncLog: () => ipcRenderer.invoke('sync:log'),
  hasSyncPassphrase: () => ipcRenderer.invoke('sync:hasPassphrase'),
  setSyncPassphrase: (passphrase: string) => ipcRenderer.invoke('sync:setPassphrase', passphrase),
  clearSyncPassphrase: () => ipcRenderer.invoke('sync:clearPassphrase'),
  countSupersededVersions: () => ipcRenderer.invoke('sync:supersededCount'),
  listSupersededVersions: (limit?: number, offset?: number) => ipcRenderer.invoke('sync:supersededList', limit, offset),
  restoreSupersededVersion: (id: string) => ipcRenderer.invoke('sync:supersededRestore', id),
  clearSupersededVersions: (ids?: string[]) => ipcRenderer.invoke('sync:supersededClear', ids),
  setBackupPassword: (password) => ipcRenderer.invoke('backup:setPassword', password),
  clearBackupPassword: () => ipcRenderer.invoke('backup:clearPassword'),
  hasBackupPassword: () => ipcRenderer.invoke('backup:hasPassword'),
  chooseBackupFolder: () => ipcRenderer.invoke('backup:chooseFolder'),
  runBackupNow: () => ipcRenderer.invoke('backup:runNow'),
  previewBackupCleanup: () => ipcRenderer.invoke('backup:cleanupPreview'),
  runBackupCleanupNow: (scopeToken: string) => ipcRenderer.invoke('backup:cleanupRunNow', scopeToken),
  saveBackupRecoveryKit: () => ipcRenderer.invoke('backup:saveRecoveryKit'),
  getTutorialCatalogue: () => ipcRenderer.invoke('tutorials:catalogue'),
  getRecoveryStatus: () => ipcRenderer.invoke('recovery:status'),
  chooseRecoveryFolder: (mode, language) => ipcRenderer.invoke('recovery:chooseFolder', mode, language),
  initializeRecoveryFolder: (folder, password, language) => ipcRenderer.invoke('recovery:initialize', folder, password, language),
  restoreRecoverySnapshot: (root, fileName, password, language, onProgress) => {
    const requestId = `recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const listener = (_event: unknown, id: string, progress: RecoveryRestoreProgress) => {
      if (id === requestId) onProgress?.(progress);
    };
    ipcRenderer.on('recovery:restore:progress', listener);
    return ipcRenderer.invoke('recovery:restore', root, fileName, password, language, requestId)
      .finally(() => ipcRenderer.removeListener('recovery:restore:progress', listener));
  },

  // Dropped-file paths come from webUtils, not from a channel, so this one lives
  // wherever the bridge itself lives rather than with any domain slice.
  getPathForDroppedFile: (file) => webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0]),

  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateProgress: (cb) => {
    const listener = (_e: unknown, event: UpdateProgressEvent) => cb(event);
    ipcRenderer.on('updates:progress', listener);
    return () => ipcRenderer.removeListener('updates:progress', listener);
  },

  setDockIcon: (pngDataUrl) => ipcRenderer.invoke('dock:setIcon', pngDataUrl),

};
