import path from 'node:path';
import fs from 'node:fs';
import { ipcMain, BrowserWindow, dialog, app } from 'electron';

import {
  showImportOpenDialog,
} from './privacy';
import type {
  AppLanguage,
  AppSettings,
  UpdateCheckResponse,
  CreateVaultInput,
  VaultSummary,
  VaultSwitchOptions,
  VaultSwitchResult,
  VaultType,
} from '@shared/types';

import { getSettings, updateSettings } from './db/settingsRepo';
import * as protect from './protect/protectService';
import { createIpcContext } from './ipc/context';
import { registerProsopographyIpc } from './ipc/prosopography';
import { registerTestimoniesIpc } from './ipc/testimonies';
import { registerToolkitIpc } from './ipc/toolkit';
import { registerTeachingIpc } from './ipc/teaching';
import { registerDatabasesIpc } from './ipc/databases';
import { registerPrimarySourcesIpc } from './ipc/primarySources';
import { registerArchiveIpc } from './ipc/archive';
import { registerWorldbuildingIpc } from './ipc/worldbuilding';
import { registerPlatformIpc } from './ipc/platform';
import { registerRecordsIpc } from './ipc/records';
import { registerAcademicIpc } from './ipc/academic';
import {
  restartMcpServer,
  startMcpServer,
  startMcpTunnelIfConfigured,
  stopMcpServer,
  stopMcpTunnel,
} from './mcp';
import { restartCopilotServer, startCopilotServer, stopCopilotServer } from './copilot/server';
import {
  restartZoteroPluginServer,
  startZoteroPluginServer,
  stopZoteroPluginServer,
} from './zotero-plugin/server';
import {
  applyMascotWindow,
  beginMascotWindowDrag,
  dragMascotWindow,
  endMascotWindowDrag,
  getMascotWindowPlacement,
  setMascotTutorialVisible,
  setMascotWindowExpanded,
} from './mascotWindow';
import {
  listNotifications,
  markAllNotificationsRead,
  clearNotifications,
  setNotificationsNotifier,
} from './notifications';
import { getNodiViewContext, setNodiViewContext, streamNodiChat } from './ai/nodiChat';
import type { NodiChatRequest } from '@shared/types';
import { clearNodiConversations, deleteNodiConversation, getNodiConversation, listNodiConversations, saveNodiConversation } from './nodiConversations';
import { deleteNodiNote, listNodiNotes, saveNodiNote } from './nodiNotes';
import { copyApiKeysBetweenVaults, listApiKeyProvidersForVault, setBackupPassword, clearBackupPassword, hasBackupPassword, getBackupPassword, getBackupRecoveryKey } from './secrets/secretStore';
import { runAutoBackupNow } from './export/autoBackup';
import { MIN_BACKUP_PASSWORD_LENGTH } from './export/backupCrypto';
import {
  onChatGptSubscriptionStatusChanged,
} from './ai/codexSubscription';
import {
  onGitHubCopilotSubscriptionStatusChanged,
} from './ai/githubCopilotSubscription';
import { onOpenCodeGoUsageStatusChanged } from './ai/openCodeGoUsage';
import {
  interruptDecorativeImageGenerations,
} from './ai/decorativeImages';
import { reconcileAuthorLayerOnce } from './db/authorsRepo';
import { getSyncLog } from './db/syncRepo';
import { fullSync, startRealtimeSync, stopRealtimeSync } from './sync/syncService';
import {
  restartNodusServerSync,
  startNodusServerSync,
  stopNodusServerSync,
} from './serverSync/serverSyncService';
import { scanQueue } from './pipeline/scanQueue';
import {
  getRecoveryStatus,
  initializeRecoveryFolder,
  inspectRecoveryFolder,
  restoreRecoverySnapshot,
} from './recovery/recoveryManager';
import { getTutorialCatalogue } from './tutorialCatalogue';
import { clearSuperseded, countSuperseded, listSuperseded, restoreSuperseded } from './db/syncSupersededRepo';
import { clearSyncPassphrase, getSyncPassphrase, hasSyncPassphrase, setSyncPassphrase } from './secrets/secretStore';
import {
  upgradeWorldbuildingDemoDynasties,
  upgradeWorldbuildingDemoImageQuality,
  upgradeWorldbuildingDemoNarrativeDepth,
  relocalizeWorldbuildingDemoData,
} from './db/worldbuildingDemoData';
import { getEmbeddingSnapshot } from './ai/embeddingPipeline';
import {
  getPassageSnapshot,
} from './ai/passageEmbeddingPipeline';
import { isSemanticBridgeRunning } from './ai/semanticBridges';
import { cancelDeepResearchJobsForOtherVaults, isDeepResearchLaneBusy } from './ai/deepResearchQueue';
import { closeDb, getDb } from './db/database';
import {
  createVault,
  createVaultFromDatabaseFile,
  deleteVault,
  getActiveVault,
  getVault,
  listVaults,
  renameVault,
  resetVaultDatabase,
  setActiveVault,
  setVaultType,
} from './vaults/vaultRegistry';
import { reuseVaultAnalysisForWorks } from './vaults/vaultAnalysisImport';
import { initializeVaultModelSelection, validateVaultModelSelection } from './vaults/vaultCreationSettings';
import { setPersistentDockIcon } from './dockIcon';
import { closeCrossVaultConnections } from './db/crossVault';


function withVaultKeyProviders(vault: VaultSummary): VaultSummary {
  return { ...vault, apiKeyProviders: listApiKeyProvidersForVault(vault.id) };
}

function vaultBusyMessage(): string | null {
  if (scanQueue.isBusy()) {
    return 'No se puede cambiar de bóveda con la cola de análisis activa. Pausa o termina los trabajos pendientes antes de cargar otra bóveda.';
  }
  if (getEmbeddingSnapshot().running) {
    return 'No se puede cambiar de bóveda mientras se están indexando embeddings de ideas.';
  }
  if (getPassageSnapshot().running) {
    return 'No se puede cambiar de bóveda mientras se están indexando pasajes.';
  }
  if (isSemanticBridgeRunning()) {
    return 'No se puede cambiar de bóveda mientras se descubren relaciones semánticas.';
  }
  // A report in flight reads the corpus for minutes. Switching closes the database
  // under it — and a report can now be running because an MCP client asked for it,
  // with nothing on screen unless the user is looking at Deep Research.
  if (isDeepResearchLaneBusy()) {
    return 'No se puede cambiar de bóveda mientras se genera un informe de Deep Research. Espera a que termine; en Deep Research puedes quitar de la cola los que aún no han empezado.';
  }
  return null;
}

function vaultSwitchMessage(base: string, copiedProviders: VaultSwitchResult['copiedProviders']): string {
  const parts = [base];
  if (copiedProviders.length > 0) parts.push(`Claves API copiadas: ${copiedProviders.length}.`);
  return parts.join(' ');
}






/** Register every IPC channel backing the window.nodus API. */
export function registerIpc(
  getWindow: () => BrowserWindow | null,
  checkForUpdates: () => Promise<UpdateCheckResponse>,
  installUpdate: () => Promise<UpdateCheckResponse>
): void {
  const context = createIpcContext(getWindow);
  const { h } = context;

  // Domains extracted from this file, each owning its own channels and repo
  // imports. What remains below is everything not yet split out.
  registerProsopographyIpc(context);
  registerAcademicIpc(context);
  registerRecordsIpc(context);
  registerPlatformIpc(context);
  registerWorldbuildingIpc(context);
  registerArchiveIpc(context);
  registerPrimarySourcesIpc(context);
  registerDatabasesIpc(context);
  registerTeachingIpc(context);
  registerToolkitIpc(context);
  registerTestimoniesIpc(context);

  const nodiChatAborters = new Map<string, AbortController>();

  onChatGptSubscriptionStatusChanged((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('ai:chatgptSubscription:statusChanged', status);
    }
  });
  onGitHubCopilotSubscriptionStatusChanged((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('ai:githubCopilotSubscription:statusChanged', status);
    }
  });
  onOpenCodeGoUsageStatusChanged((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('ai:openCodeGo:usageChanged', status);
    }
  });

  const emitVaultChanged = () => {
    const payload = withVaultKeyProviders(getActiveVault());
    // Broadcast to every window (main + the Nodi overlay) so Nodi's per-vault look
    // updates live wherever it is shown.
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('vaults:changed', payload);
    }
  };

  const switchVaultSafely = async (id: string, options?: VaultSwitchOptions): Promise<VaultSwitchResult> => {
    const target = getVault(id);
    if (!target) {
      return { ok: false, message: 'Bóveda no encontrada.', copiedProviders: [] };
    }

    const sourceVaultId = options?.copyApiKeysFromVaultId?.trim() || null;
    if (sourceVaultId && sourceVaultId !== id && !getVault(sourceVaultId)) {
      return { ok: false, message: 'No se encontró la bóveda de origen de las claves API.', copiedProviders: [] };
    }

    let copiedProviders: VaultSwitchResult['copiedProviders'] = [];
    if (getActiveVault().id === id) {
      if (sourceVaultId && sourceVaultId !== id) {
        copiedProviders = copyApiKeysBetweenVaults(sourceVaultId, id);
      }
      const activeVault = withVaultKeyProviders(getActiveVault());
      emitVaultChanged();
      return {
        ok: true,
        message: vaultSwitchMessage('Esta bóveda ya está cargada.', copiedProviders),
        activeVault,
        copiedProviders,
      };
    }

    const busy = vaultBusyMessage();
    if (busy) return { ok: false, message: busy, copiedProviders: [] };

    if (sourceVaultId && sourceVaultId !== id) {
      if (!getVault(sourceVaultId)) {
        return { ok: false, message: 'No se encontró la bóveda de origen de las claves API.', copiedProviders: [] };
      }
      copiedProviders = copyApiKeysBetweenVaults(sourceVaultId, id);
    }

    stopRealtimeSync();
    stopNodusServerSync();
    await stopMcpTunnel();
    await stopMcpServer();
    await stopCopilotServer();
    await stopZoteroPluginServer();
    interruptDecorativeImageGenerations();
    protect.invalidateProtectVaultReferences();
    closeCrossVaultConnections(); // drop read-only handles to sibling vaults before switching
    closeDb();
    setActiveVault(id);
    getDb();
    // Reports still waiting were researched against the corpus just closed; running
    // them now would answer about a vault nobody asked about.
    cancelDeepResearchJobsForOtherVaults(id);
    upgradeWorldbuildingDemoDynasties();
    upgradeWorldbuildingDemoImageQuality();
    upgradeWorldbuildingDemoNarrativeDepth();
    relocalizeWorldbuildingDemoData();
    reconcileAuthorLayerOnce();

    const settings = getSettings();
    if (settings.syncMode === 'realtime') startRealtimeSync();
    startNodusServerSync();
    if (settings.mcpEnabled) void startMcpServer().then(() => startMcpTunnelIfConfigured());
    if (settings.copilotEnabled) void startCopilotServer();
    if (settings.zoteroPluginEnabled) void startZoteroPluginServer();

    const activeVault = withVaultKeyProviders(getActiveVault());
    emitVaultChanged();
    return {
      ok: true,
      message: vaultSwitchMessage('Bóveda cargada.', copiedProviders),
      activeVault,
      copiedProviders,
    };
  };

  // settings + secrets
  h('settings:get', async () => getSettings());
  h('settings:update', async (_e, patch: Partial<AppSettings>) => {
    const previous = getSettings();
    const next = updateSettings(patch);
    if (patch.uiLanguage !== undefined && next.uiLanguage !== previous.uiLanguage) {
      relocalizeWorldbuildingDemoData(next.uiLanguage);
    }
    if (patch.syncMode) {
      if (next.syncMode === 'realtime') startRealtimeSync();
      else stopRealtimeSync();
    }
    if (patch.mcpEnabled !== undefined || patch.mcpPort !== undefined || patch.mcpToken !== undefined) {
      await stopMcpTunnel();
      if (next.mcpEnabled) {
        await restartMcpServer();
        void startMcpTunnelIfConfigured();
      } else await stopMcpServer();
    }
    if (
      patch.nodusServerEnabled !== undefined ||
      patch.nodusServerAutoSync !== undefined ||
      patch.nodusServerUrl !== undefined ||
      patch.nodusServerSpaceId !== undefined ||
      patch.nodusServerIncludeUserContent !== undefined ||
      patch.nodusServerIncludePassages !== undefined
    ) {
      restartNodusServerSync();
    }
    if (patch.copilotEnabled !== undefined || patch.copilotPort !== undefined) {
      if (next.copilotEnabled) await restartCopilotServer();
      else await stopCopilotServer();
    }
    if (
      patch.zoteroPluginEnabled !== undefined ||
      patch.zoteroPluginPort !== undefined ||
      patch.zoteroPluginToken !== undefined
    ) {
      if (next.zoteroPluginEnabled) await restartZoteroPluginServer();
      else await stopZoteroPluginServer();
    }
    if (patch.mascotEnabled !== undefined || patch.mascotAlwaysOnTop !== undefined) {
      applyMascotWindow();
    }
    // Let other windows (the Nodi overlay) react to setting changes, e.g. costumes.
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('settings:changed', next);
    }
    return next;
  });

  // Nodi companion: notifications, chat, and overlay-window helpers.
  h('nodi:tutorialVisible', (_e, visible: boolean) => setMascotTutorialVisible(Boolean(visible)));
  setNotificationsNotifier(() => {
    const list = listNotifications();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('nodi:notifications:changed', list);
    }
  });
  h('nodi:notifications:list', async () => listNotifications());
  h('nodi:notifications:markRead', async () => {
    markAllNotificationsRead();
    return listNotifications();
  });
  h('nodi:notifications:clear', async () => {
    clearNotifications();
    return listNotifications();
  });
  h('nodi:conversations:list', async () => listNodiConversations());
  h('nodi:conversations:get', async (_e, id: string) => getNodiConversation(id));
  h('nodi:conversations:save', async (_e, input) => saveNodiConversation(input));
  h('nodi:conversations:delete', async (_e, id: string) => deleteNodiConversation(id));
  h('nodi:conversations:clear', async () => clearNodiConversations());
  h('nodi:notes:list', async () => listNodiNotes());
  h('nodi:notes:save', async (_e, input) => saveNodiNote(input));
  h('nodi:notes:delete', async (_e, id: string) => deleteNodiNote(id));
  h('nodi:chatStream', async (e, requestId: string, request: NodiChatRequest) => {
    const controller = new AbortController();
    nodiChatAborters.set(requestId, controller);
    try {
      return await streamNodiChat(request, (delta) => e.sender.send('nodi:chatStream:delta', requestId, delta), controller.signal);
    } finally {
      nodiChatAborters.delete(requestId);
    }
  });
  h('nodi:chatStream:cancel', async (_e, requestId: string) => {
    nodiChatAborters.get(requestId)?.abort();
  });
  h('nodi:viewContext:set', async (_e, context) => setNodiViewContext(context));
  h('nodi:viewContext:get', async () => getNodiViewContext());
  // The overlay's mouse hit-test transition. Asynchronous on purpose: the flag is
  // applied when the main process next reaches its event loop, which is exactly
  // when a `sendSync` would have been serviced too — the synchronous form only
  // added a stall of Nodi's own renderer while heavy work held the loop.
  ipcMain.on('nodi:setMouseIgnore:async', (e, ignore: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    win?.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
  });
  h('nodi:overlayPlacement:get', async () => getMascotWindowPlacement());
  h('nodi:setExpanded', async (e, expanded: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return { x: 16, y: 16, horizontal: 'left', vertical: 'up' };
    const nextPlacement = setMascotWindowExpanded(win, Boolean(expanded));
    return nextPlacement;
  });
  h('nodi:openMainWindow', async () => {
    const win = getWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  h('nodi:openSettings', async () => {
    const win = getWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send('nodi:navigate', 'settings');
    }
  });
  h('nodi:openWorldEntry', async (_e, kind: string, id: string) => {
    const viewByKind: Record<string, string> = {
      character: 'characters',
      place: 'places',
      group: 'factions',
      scene: 'scenes',
      article: 'encyclopedia',
      map: 'map',
      rule: 'rules',
      conflict: 'conflicts',
    };
    const view = viewByKind[kind];
    const win = getWindow();
    if (!view || !win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send('nodi:navigate', { view, kind, id });
  });
  h('nodi:windowDrag:begin', async (e, screenX: number, screenY: number) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return { x: 16, y: 16, horizontal: 'left', vertical: 'up' };
    return beginMascotWindowDrag(win, screenX, screenY);
  });
  h('nodi:windowDrag:move', async (e, screenX: number, screenY: number) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return { x: 16, y: 16, horizontal: 'left', vertical: 'up' };
    return dragMascotWindow(win, screenX, screenY);
  });
  h('nodi:windowDrag:end', async () => {
    endMascotWindowDrag();
  });
  h('vaults:list', async () => listVaults().map(withVaultKeyProviders));
  h('vaults:getActive', async () => withVaultKeyProviders(getActiveVault()));
  h('vaults:create', async (_e, input: CreateVaultInput) => {
    const modelSelection = validateVaultModelSelection(input);
    const vault = createVault(input.name, input.type);
    try {
      if (modelSelection) initializeVaultModelSelection(vault.path, modelSelection);
    } catch (cause) {
      deleteVault(vault.id, true);
      throw cause;
    }
    return { vault: withVaultKeyProviders(vault) };
  });
  h('vaults:rename', async (_e, id: string, name: string) => withVaultKeyProviders(renameVault(id, name)));
  h('vaults:setType', async (_e, id: string, type: VaultType) => withVaultKeyProviders(setVaultType(id, type)));
  h('vaults:switch', async (_e, id: string, options?: VaultSwitchOptions) => switchVaultSafely(id, options));
  h('vaults:duplicate', async (_e, id: string, name: string, options?: VaultSwitchOptions) => {
    const source = getVault(id);
    if (!source) throw new Error('Bóveda no encontrada.');
    const tmp = path.join(app.getPath('temp'), `nodus-vault-copy-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    try {
      if (source.active) {
        await getDb().backup(tmp);
      } else {
        fs.copyFileSync(source.path, tmp);
      }
      const vault = createVaultFromDatabaseFile(tmp, name, source.type);
      const hasExplicitSource = options && Object.prototype.hasOwnProperty.call(options, 'copyApiKeysFromVaultId');
      const keySource = hasExplicitSource ? options.copyApiKeysFromVaultId ?? null : id;
      const copiedProviders = keySource && keySource !== vault.id ? copyApiKeysBetweenVaults(keySource, vault.id) : [];
      return { vault: withVaultKeyProviders(vault), copiedProviders };
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  });
  h('vaults:delete', async (_e, id: string, deleteFiles?: boolean) => {
    deleteVault(id, Boolean(deleteFiles));
  });
  h('vaults:reset', async (_e, id: string) => {
    const target = getVault(id);
    if (!target) throw new Error('Bóveda no encontrada.');
    if (target.active) {
      const busy = vaultBusyMessage();
      if (busy) throw new Error(busy);
      stopRealtimeSync();
      stopNodusServerSync();
      await stopMcpTunnel();
      await stopMcpServer();
      await stopCopilotServer();
      await stopZoteroPluginServer();
      interruptDecorativeImageGenerations();
      closeDb();
      const reset = resetVaultDatabase(id);
      getDb();
      reconcileAuthorLayerOnce();
      const settings = getSettings();
      if (settings.syncMode === 'realtime') startRealtimeSync();
      startNodusServerSync();
      if (settings.mcpEnabled) void startMcpServer().then(() => startMcpTunnelIfConfigured());
      if (settings.copilotEnabled) void startCopilotServer();
      if (settings.zoteroPluginEnabled) void startZoteroPluginServer();
      emitVaultChanged();
      return withVaultKeyProviders(reset);
    }
    return withVaultKeyProviders(resetVaultDatabase(id));
  });
  h('vaults:reuseAnalysis', async (_e, nodusIds: string[]) => {
    const busy = vaultBusyMessage();
    if (busy) throw new Error(busy);
    return reuseVaultAnalysisForWorks(nodusIds);
  });
  h('vaults:copyApiKeys', async (_e, sourceVaultId: string, targetVaultId: string) => ({
    copiedProviders: copyApiKeysBetweenVaults(sourceVaultId, targetVaultId),
  }));




  // ── Core: sync, backups, recovery, updates ─────────────────────────────────
  // Regrouped here so the academic and study channels above form one range. They
  // used to sit inside it, which is why extracting that range needed this first.
  h('sync:now', async () => fullSync('manual'));
  h('sync:log', async () => getSyncLog());
  // automatic encrypted backups (master password lives in the OS keychain)
  h('sync:hasPassphrase', async () => hasSyncPassphrase());
  h('sync:setPassphrase', async (_e, passphrase: string) => {
    const clean = passphrase.trim();
    if (clean.length < MIN_BACKUP_PASSWORD_LENGTH) {
      throw new Error(`La frase de sincronización debe tener al menos ${MIN_BACKUP_PASSWORD_LENGTH} caracteres.`);
    }
    setSyncPassphrase(clean);
  });
  h('sync:clearPassphrase', async () => clearSyncPassphrase());
  h('backup:setPassword', async (_e, password: string) => {
    const clean = password.trim();
    if (clean.length < MIN_BACKUP_PASSWORD_LENGTH) {
      throw new Error(`La contraseña maestra debe tener al menos ${MIN_BACKUP_PASSWORD_LENGTH} caracteres.`);
    }
    setBackupPassword(clean);
  });
  h('backup:clearPassword', async () => clearBackupPassword());
  h('backup:hasPassword', async () => hasBackupPassword());
  h('backup:chooseFolder', async () => {
    const { canceled, filePaths } = await showImportOpenDialog({
      title: 'Elegir carpeta para copias automáticas',
      properties: ['openDirectory', 'createDirectory'],
    });
    return canceled || filePaths.length === 0 ? null : filePaths[0];
  });
  h('backup:runNow', async () => runAutoBackupNow(app.getVersion()));
  h('backup:saveRecoveryKit', async () => {
    const password = getBackupPassword();
    const recoveryKey = getBackupRecoveryKey();
    const language = getSettings().uiLanguage;
    const es = language === 'es';
    if (!password) return { ok: false, message: es ? 'No hay contraseña maestra configurada.' : 'No master password is configured.' };
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: es ? 'Guardar kit de recuperación' : 'Save recovery kit',
      defaultPath: path.join(app.getPath('documents'), es ? 'nodus-kit-de-recuperacion.txt' : 'nodus-recovery-kit.txt'),
      filters: [{ name: es ? 'Texto' : 'Text', extensions: ['txt'] }],
    });
    if (canceled || !filePath) return { ok: false, message: es ? 'Cancelado' : 'Cancelled' };
    fs.writeFileSync(
      filePath,
      (es ? [
        'NODUS — KIT DE RECUPERACIÓN DE COPIAS DE SEGURIDAD', '',
        `Contraseña maestra: ${password}`,
        `Clave de recuperación independiente: ${recoveryKey ?? 'No disponible en copias antiguas'}`,
        `Frase de sincronización (.nodussync): ${getSyncPassphrase() ?? 'No configurada'}`, '',
        'Puedes restaurar las copias nuevas con cualquiera de las dos credenciales.',
        'Guárdalas fuera de este dispositivo, preferiblemente en un gestor de contraseñas',
        'o impresas en un lugar seguro. Las copias cifradas incluyen todo Nodus,',
        'también las claves API. El token MCP local nunca se exporta.',
        `Generado: ${new Date().toISOString()}`,
      ] : [
        'NODUS — BACKUP RECOVERY KIT', '',
        `Master password: ${password}`,
        `Independent recovery key: ${recoveryKey ?? 'Not available for legacy snapshots'}`,
        `Sync passphrase (.nodussync): ${getSyncPassphrase() ?? 'Not configured'}`, '',
        'New snapshots can be restored with either credential.',
        'Store them away from this device, preferably in a password manager or',
        'printed in a safe place. Encrypted snapshots include all of Nodus, including',
        'API keys. The local MCP token is never exported.',
        `Generated: ${new Date().toISOString()}`,
      ]).join('\n')
    );
    return { ok: true, message: filePath };
  });
  // Never rejects: the built-in list is always a complete answer (see tutorialCatalogue).
  h('tutorials:catalogue', async () => getTutorialCatalogue());
  h('recovery:status', async () => getRecoveryStatus());
  h('recovery:chooseFolder', async (_e, mode: 'create' | 'restore', language: AppLanguage = 'es') => {
    const titles: Record<AppLanguage, string> = {
      en: mode === 'restore' ? 'Select a Nodus recovery folder' : 'Select an empty folder to protect Nodus',
      es: mode === 'restore' ? 'Seleccionar una carpeta de recuperación de Nodus' : 'Seleccionar una carpeta vacía para proteger Nodus',
      fr: mode === 'restore' ? 'Sélectionner un dossier de récupération Nodus' : 'Sélectionner un dossier vide pour protéger Nodus',
      de: mode === 'restore' ? 'Nodus-Wiederherstellungsordner auswählen' : 'Leeren Ordner zum Schutz von Nodus auswählen',
      pt: mode === 'restore' ? 'Selecionar uma pasta de recuperação do Nodus' : 'Selecionar uma pasta vazia para proteger o Nodus',
      'pt-BR': mode === 'restore' ? 'Selecionar uma pasta de recuperação do Nodus' : 'Selecionar uma pasta vazia para proteger o Nodus',
      it: mode === 'restore' ? 'Seleziona una cartella di ripristino Nodus' : 'Seleziona una cartella vuota per proteggere Nodus',
      tr: mode === 'restore' ? 'Bir Nodus kurtarma klasörü seçin' : 'Nodus\'u korumak için boş bir klasör seçin',
    };
    const { canceled, filePaths } = await showImportOpenDialog(getWindow() ?? undefined!, {
      title: titles[language],
      properties: mode === 'restore' ? ['openDirectory'] : ['openDirectory', 'createDirectory'],
    });
    return canceled || filePaths.length === 0 ? null : inspectRecoveryFolder(filePaths[0], language);
  });
  h('recovery:initialize', async (_e, folder: string, password: string, language: AppLanguage = 'es') =>
    initializeRecoveryFolder(folder, password, app.getVersion(), language)
  );
  h('recovery:restore', async (_e, root: string, fileName: string, password: string, language: AppLanguage = 'es') => {
    const result = await restoreRecoverySnapshot(root, fileName, password, app.getVersion(), language);
    if (result.ok) {
      stopNodusServerSync();
      await stopMcpTunnel();
      await stopMcpServer();
    }
    return result;
  });
  // Versions a merge discarded. Read/restore only — nothing here deletes on a timer.
  h('sync:supersededCount', async () => countSuperseded());
  h('sync:supersededList', async (_e, limit?: number, offset?: number) => listSuperseded(limit, offset));
  h('sync:supersededRestore', async (_e, id: string) => restoreSuperseded(id));
  h('sync:supersededClear', async (_e, ids?: string[]) => clearSuperseded(ids));

  h('updates:check', async () => checkForUpdates());
  h('updates:install', async () => installUpdate());

  // Dynamic macOS dock icon. The renderer rasterises a themed, vault-coloured
  // Nodus mark to a PNG data URL and pushes it here; only macOS exposes
  // app.dock. No-op (and never throws) on Windows/Linux.
  h('dock:setIcon', async (_e, pngDataUrl: string) => {
    setPersistentDockIcon(pngDataUrl);
  });
}
