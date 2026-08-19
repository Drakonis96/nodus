import { ipcRenderer } from 'electron';
import type { PagesApi } from '@shared/api/pages';

const qaPageDelayMs = process.env.NODUS_QA_ROOT
  ? Math.min(2_000, Math.max(0, Number.parseInt(process.env.NODUS_QA_PAGE_DELAY_MS ?? '0', 10) || 0))
  : 0;
const qaFailedRowId = process.env.NODUS_QA_ROOT ? (process.env.NODUS_QA_PAGE_FAIL_ROW_ID ?? '') : '';
const qaFailedPageId = process.env.NODUS_QA_ROOT ? (process.env.NODUS_QA_PAGE_FAIL_PAGE_ID ?? '') : '';
const pageDelay = async () => {
  if (qaPageDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, qaPageDelayMs));
};

export const pagesApi: PagesApi = {
  getPage: (id, actorId) => ipcRenderer.invoke('page:get', id, actorId ?? 'local'),
  getPageDocument: async (id, actorId) => {
    await pageDelay();
    if (qaFailedPageId && id === qaFailedPageId) throw new Error('Fallo de carga QA controlado.');
    return ipcRenderer.invoke('page:document', id, actorId ?? 'local');
  },
  getPageForDatabaseRow: async (rowId, actorId) => {
    await pageDelay();
    if (qaFailedRowId && rowId === qaFailedRowId) throw new Error('Fallo de carga QA controlado.');
    return ipcRenderer.invoke('page:forRow', rowId, actorId ?? 'local');
  },
  getPageForNote: (noteId, actorId) => ipcRenderer.invoke('page:forNote', noteId, actorId ?? 'local'),
  listPages: (state, actorId) => ipcRenderer.invoke('page:list', state ?? 'active', actorId ?? 'local'),
  listPageBreadcrumbs: (pageId, actorId) => ipcRenderer.invoke('page:breadcrumbs', pageId, actorId ?? 'local'),
  listPageBacklinks: (pageId, actorId) => ipcRenderer.invoke('page:backlinks', pageId, actorId ?? 'local'),
  listBrokenPageLinks: (actorId) => ipcRenderer.invoke('page:brokenLinks', actorId ?? 'local'),
  searchPages: (query, mode, limit, actorId) => ipcRenderer.invoke('page:search', query, mode ?? 'lexical', limit ?? 50, actorId ?? 'local'),
  getSyncedBlockSource: (blockId, actorId) => ipcRenderer.invoke('page:syncedBlock', blockId, actorId ?? 'local'),
  listPageRevisions: (pageId, cursor, limit, actorId) => ipcRenderer.invoke('page:revisions', pageId, cursor ?? null, limit ?? 50, actorId ?? 'local'),
  getPageRevision: (pageId, revision, actorId) => ipcRenderer.invoke('page:revision', pageId, revision, actorId ?? 'local'),
  restorePageRevision: (pageId, revision, expectedDocumentRevision, actorId) =>
    ipcRenderer.invoke('page:restoreRevision', pageId, revision, expectedDocumentRevision, actorId),
  listWorkspaceActors: () => ipcRenderer.invoke('workspace:actors'),
  createWorkspaceActor: (input) => ipcRenderer.invoke('workspace:createActor', input),
  listPageComments: (pageId, includeResolved, actorId) => ipcRenderer.invoke('page:comments', pageId, includeResolved ?? false, actorId ?? 'local'),
  createPageComment: (input) => ipcRenderer.invoke('page:createComment', input),
  updatePageComment: (id, body, expectedRevision, actorId) => ipcRenderer.invoke('page:updateComment', id, body, expectedRevision, actorId),
  resolvePageComment: (id, resolved, expectedRevision, actorId) => ipcRenderer.invoke('page:resolveComment', id, resolved, expectedRevision, actorId),
  setPageCommentReaction: (id, emoji, active, actorId) => ipcRenderer.invoke('page:reactComment', id, emoji, active, actorId),
  listWorkspaceNotifications: (actorId, unreadOnly, limit) => ipcRenderer.invoke('workspace:notifications', actorId ?? 'local', unreadOnly ?? false, limit ?? 100),
  markWorkspaceNotificationRead: (id, read, actorId) => ipcRenderer.invoke('workspace:readNotification', id, read ?? true, actorId ?? 'local'),
  listWorkspaceGroups: () => ipcRenderer.invoke('workspace:groups'),
  createWorkspaceGroup: (name) => ipcRenderer.invoke('workspace:createGroup', name),
  setWorkspaceGroupMembers: (groupId, actorIds, expectedRevision) => ipcRenderer.invoke('workspace:setGroupMembers', groupId, actorIds, expectedRevision),
  listAclEntries: (resourceType, resourceId, actorId) => ipcRenderer.invoke('acl:list', resourceType, resourceId, actorId ?? 'local'),
  setAclEntry: (input) => ipcRenderer.invoke('acl:set', input),
  deleteAclEntry: (id, expectedRevision, actorId) => ipcRenderer.invoke('acl:delete', id, expectedRevision, actorId ?? 'local'),
  getEffectiveAcl: (resourceType, resourceId, actorId) => ipcRenderer.invoke('acl:effective', resourceType, resourceId, actorId ?? 'local'),
  createWorkspaceShareLink: (input) => ipcRenderer.invoke('share:create', input),
  listWorkspaceShareLinks: (resourceType, resourceId, actorId) => ipcRenderer.invoke('share:list', resourceType, resourceId, actorId ?? 'local'),
  revokeWorkspaceShareLink: (id, expectedRevision, actorId) => ipcRenderer.invoke('share:revoke', id, expectedRevision, actorId ?? 'local'),
  authorizeWorkspaceShareLink: (token, password) => ipcRenderer.invoke('share:authorize', token, password ?? null),
  createPage: (input) => ipcRenderer.invoke('page:create', input ?? {}),
  updatePage: (id, patch, expectedRevision, actorId) => ipcRenderer.invoke('page:update', id, patch, expectedRevision, actorId ?? 'local'),
  movePage: (id, parentPageId, expectedRevision, actorId) => ipcRenderer.invoke('page:move', id, parentPageId, expectedRevision, actorId ?? 'local'),
  setPageFavorite: (id, favorite) => ipcRenderer.invoke('page:favorite', id, favorite),
  setPageState: (id, state, expectedRevision, actorId) => ipcRenderer.invoke('page:state', id, state, expectedRevision, actorId ?? 'local'),
  savePageDocument: (input) => ipcRenderer.invoke('page:saveDocument', input),
  applyPageDocumentUpdate: (pageId, update, expectedRevision, actorId, principalId) =>
    ipcRenderer.invoke('page:applyUpdate', pageId, update, expectedRevision, actorId, principalId ?? 'local'),
  replacePageFromMarkdown: (pageId, markdown, expectedRevision, actorId) =>
    ipcRenderer.invoke('page:replaceMarkdown', pageId, markdown, expectedRevision, actorId ?? 'local'),
  exportPageMarkdown: (pageId, actorId) => ipcRenderer.invoke('page:exportMarkdown', pageId, actorId ?? 'local'),
  storePageAsset: (input) => ipcRenderer.invoke('page:storeAsset', input),
  pickPageAsset: (kind) => ipcRenderer.invoke('page:pickAsset', kind),
  getPageAsset: (blobHash) => ipcRenderer.invoke('page:getAsset', blobHash),
};
