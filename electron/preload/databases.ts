// databases half of the renderer bridge, paired with electron/ipc/databases.ts.
// Typed as DatabasesApi so the compiler, not a test, guarantees the slice is complete.
import { ipcRenderer } from 'electron';

import type { DatabasesApi } from '@shared/api/databases';

// Tracks the data-chat stream currently in flight so cancelDatabaseChat can abort it
// without the renderer juggling request ids. Only one runs at a time (the composer is
// disabled while sending). It lived in preload.ts next to the research-chat one; it
// belongs with the bindings that are its only users.
let activeDbChatRequestId: string | null = null;

export const databasesApi: DatabasesApi = {
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
};
