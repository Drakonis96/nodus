// archive half of the renderer bridge, paired with electron/ipc/archive.ts.
// Typed as ArchiveApi so the compiler, not a test, guarantees the slice is complete.
import { ipcRenderer } from 'electron';

import type { ArchiveApi } from '@shared/api/archive';

export const archiveApi: ArchiveApi = {
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
  scanArchiveItem: (itemId) => ipcRenderer.invoke('archive:scanItem', itemId),
  analyzeArchiveItem: (itemId) => ipcRenderer.invoke('archive:analyzeItem', itemId),
  replaceArchiveFile: (itemId) => ipcRenderer.invoke('archive:replaceFile', itemId),
  suggestPersonsForItem: (itemId) => ipcRenderer.invoke('archive:suggestPersonsForItem', itemId),
  suggestDocumentsForPerson: (personId) => ipcRenderer.invoke('archive:suggestDocumentsForPerson', personId),
  indexArchive: () => ipcRenderer.invoke('archive:index'),
  archiveIndexStatus: () => ipcRenderer.invoke('archive:indexStatus'),
};
