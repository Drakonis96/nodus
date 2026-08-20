import fs from 'node:fs';
import path from 'node:path';
import type { FileFilter } from 'electron';
import type { IpcContext } from './context';
import type { CreatePageInput, SavePageDocumentInput } from '@shared/pages';
import * as pages from '../db/pagesRepo';
import * as comments from '../db/pageCommentsRepo';
import * as acl from '../db/aclRepo';
import { showImportOpenDialog } from '../privacy';

const filters: Record<'image' | 'file' | 'audio' | 'video', FileFilter[]> = {
  image: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }],
  audio: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'ogg', 'flac'] }],
  video: [{ name: 'Vídeo', extensions: ['mp4', 'webm', 'mov', 'm4v'] }],
  file: [{ name: 'Todos los archivos', extensions: ['*'] }],
};

function mimeFromPath(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  const values: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
    '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.mp4': 'video/mp4',
    '.webm': 'video/webm', '.mov': 'video/quicktime', '.pdf': 'application/pdf',
    '.md': 'text/markdown', '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json',
  };
  return values[ext] ?? null;
}

export function registerPagesIpc({ h, getWindow }: IpcContext): void {
  const mayView = (pageId: string, actorId = 'local') => acl.getEffectiveAcl('page', pageId, actorId).canView;
  h('page:get', async (_event, id: string, actorId = 'local') => mayView(id, actorId) ? pages.getPage(id) : null);
  h('page:document', async (_event, id: string, actorId = 'local') => mayView(id, actorId) ? pages.getPageDocument(id) : null);
  h('page:forRow', async (_event, rowId: string, actorId = 'local') => {
    const page = pages.getPageForRow(rowId); return page && mayView(page.id, actorId) ? pages.getPageDocument(page.id) : null;
  });
  h('page:forNote', async (_event, noteId: string, actorId = 'local') => {
    const page = pages.getPageForNote(noteId); return page && mayView(page.id, actorId) ? pages.getPageDocument(page.id) : null;
  });
  h('page:list', async (_event, state: 'active' | 'trashed' | 'all', actorId = 'local') =>
    pages.listPages(state).filter((page) => mayView(page.id, actorId)));
  h('page:breadcrumbs', async (_event, pageId: string, actorId = 'local') => mayView(pageId, actorId)
    ? pages.listPageBreadcrumbs(pageId).filter((page) => mayView(page.id, actorId)) : []);
  h('page:backlinks', async (_event, pageId: string, actorId = 'local') => mayView(pageId, actorId)
    ? pages.listPageBacklinks(pageId).filter((link) => mayView(link.sourcePageId, actorId)) : []);
  h('page:brokenLinks', async (_event, actorId = 'local') => pages.listBrokenPageLinks().filter((link) => mayView(link.sourcePageId, actorId)));
  h('page:search', async (_event, query: string, mode: 'lexical' | 'semantic', limit: number, actorId = 'local') =>
    pages.searchPages(query, mode, Math.min(100, Math.max(limit, limit * 3))).filter((result) => result.pageId && mayView(result.pageId, actorId)).slice(0, limit));
  h('page:syncedBlock', async (_event, blockId: string, actorId = 'local') => {
    const source = pages.getSyncedBlockSource(blockId); return source && mayView(source.page.id, actorId) ? source : null;
  });
  h('page:revisions', async (_event, pageId: string, cursor: string | null, limit: number, actorId = 'local') =>
    mayView(pageId, actorId) ? pages.listPageRevisions(pageId, cursor, limit) : { items: [], nextCursor: null });
  h('page:revision', async (_event, pageId: string, revision: number, actorId = 'local') =>
    mayView(pageId, actorId) ? pages.getPageRevision(pageId, revision) : null);
  h('page:restoreRevision', async (
    _event, pageId: string, revision: number, expectedDocumentRevision: number, actorId?: string,
  ) => { acl.assertAcl('page', pageId, actorId ?? 'local', 'edit_content'); return pages.restorePageRevision(pageId, revision, expectedDocumentRevision, actorId); });
  h('workspace:actors', async () => comments.listWorkspaceActors());
  h('workspace:createActor', async (_event, input: { displayName: string; email?: string | null; kind?: 'member' | 'guest' }) => comments.createWorkspaceActor(input));
  h('page:comments', async (_event, pageId: string, includeResolved: boolean, actorId = 'local') => mayView(pageId, actorId) ? comments.listPageComments(pageId, includeResolved) : []);
  h('page:createComment', async (_event, input: { pageId: string; blockId?: string | null; parentCommentId?: string | null; body: string; actorId?: string }) => {
    acl.assertAcl('page', input.pageId, input.actorId ?? 'local', 'comment'); return comments.createPageComment(input);
  });
  h('page:updateComment', async (_event, id: string, body: string, expectedRevision: number, actorId?: string) => {
    const item = comments.getComment(id); if (!item) throw new Error('El comentario no existe.');
    acl.assertAcl('page', item.pageId, actorId ?? 'local', 'comment'); return comments.updatePageComment(id, body, expectedRevision, actorId);
  });
  h('page:resolveComment', async (_event, id: string, resolved: boolean, expectedRevision: number, actorId?: string) => {
    const item = comments.getComment(id); if (!item) throw new Error('El comentario no existe.');
    acl.assertAcl('page', item.pageId, actorId ?? 'local', 'edit_content'); return comments.resolvePageComment(id, resolved, expectedRevision, actorId);
  });
  h('page:reactComment', async (_event, id: string, emoji: string, active: boolean, actorId?: string) => {
    const item = comments.getComment(id); if (!item) throw new Error('El comentario no existe.');
    acl.assertAcl('page', item.pageId, actorId ?? 'local', 'comment'); return comments.setPageCommentReaction(id, emoji, active, actorId);
  });
  h('workspace:notifications', async (_event, actorId: string, unreadOnly: boolean, limit: number) => comments.listWorkspaceNotifications(actorId, unreadOnly, limit));
  h('workspace:readNotification', async (_event, id: string, read: boolean, actorId: string) => comments.markWorkspaceNotificationRead(id, read, actorId));
  h('workspace:groups', async () => acl.listWorkspaceGroups());
  h('workspace:createGroup', async (_event, name: string) => acl.createWorkspaceGroup(name));
  h('workspace:setGroupMembers', async (_event, groupId: string, actorIds: string[], expectedRevision: number) => acl.setWorkspaceGroupMembers(groupId, actorIds, expectedRevision));
  h('acl:list', async (_event, resourceType, resourceId, actorId = 'local') => {
    acl.assertAcl(resourceType, resourceId, actorId, 'manage_access'); return acl.listAclEntries(resourceType, resourceId);
  });
  h('acl:set', async (_event, input) => acl.setAclEntry(input));
  h('acl:delete', async (_event, id: string, expectedRevision: number, actorId?: string) => acl.deleteAclEntry(id, expectedRevision, actorId));
  h('acl:effective', async (_event, resourceType, resourceId, actorId?: string) => acl.getEffectiveAcl(resourceType, resourceId, actorId));
  h('share:create', async (_event, input) => acl.createWorkspaceShareLink(input));
  h('share:list', async (_event, resourceType, resourceId, actorId?: string) => acl.listWorkspaceShareLinks(resourceType, resourceId, actorId));
  h('share:revoke', async (_event, id: string, expectedRevision: number, actorId?: string) => acl.revokeWorkspaceShareLink(id, expectedRevision, actorId));
  h('share:authorize', async (_event, token: string, password?: string | null) => acl.authorizeWorkspaceShareLink(token, password));
  h('page:create', async (_event, input: CreatePageInput) => {
    const actorId = input.actorId ?? 'local';
    acl.assertAcl(input.parentPageId ? 'page' : 'vault', input.parentPageId ?? 'vault', actorId, 'edit');
    return pages.createPage(input);
  });
  h('page:update', async (
    _event,
    id: string,
    patch: { title?: string; icon?: string | null; coverBlobHash?: string | null; fullWidth?: boolean; locked?: boolean },
    expectedRevision: number, actorId = 'local',
  ) => { acl.assertAcl('page', id, actorId, 'edit'); return pages.updatePage(id, patch, expectedRevision, actorId); });
  h('page:move', async (_event, id: string, parentPageId: string | null, expectedRevision: number, actorId = 'local') => {
    acl.assertAcl('page', id, actorId, 'edit');
    acl.assertAcl(parentPageId ? 'page' : 'vault', parentPageId ?? 'vault', actorId, 'edit');
    return pages.movePage(id, parentPageId, expectedRevision, actorId);
  });
  h('page:favorite', async (_event, id: string, favorite: boolean) => { acl.assertAcl('page', id, 'local', 'view'); return pages.setPageFavorite(id, favorite); });
  h('page:state', async (_event, id: string, state: 'active' | 'trashed', expectedRevision: number, actorId = 'local') => {
    acl.assertAcl('page', id, actorId, 'edit'); return pages.setPageState(id, state, expectedRevision, actorId);
  });
  h('page:saveDocument', async (_event, input: SavePageDocumentInput) => {
    acl.assertAcl('page', input.pageId, input.principalId ?? 'local', 'edit_content'); return pages.savePageDocument(input);
  });
  h('page:applyUpdate', async (
    _event, pageId: string, update: Uint8Array, expectedRevision: number, actorId?: string, principalId = 'local',
  ) => { acl.assertAcl('page', pageId, principalId, 'edit_content'); return pages.applyPageDocumentUpdate(pageId, update, expectedRevision, actorId); });
  h('page:replaceMarkdown', async (_event, pageId: string, markdown: string, expectedRevision: number, actorId = 'local') => {
    acl.assertAcl('page', pageId, actorId, 'edit_content'); return pages.replacePageFromMarkdown(pageId, markdown, expectedRevision);
  });
  h('page:exportMarkdown', async (_event, pageId: string, actorId = 'local') => mayView(pageId, actorId) ? pages.exportPageMarkdown(pageId) : null);
  h('page:storeAsset', async (_event, input: { name: string; mimeType?: string | null; bytes: Uint8Array }) =>
    pages.storePageAsset(input));
  h('page:getAsset', async (_event, blobHash: string) => pages.getPageAsset(blobHash));
  h('page:pickAsset', async (_event, kind: 'image' | 'file' | 'audio' | 'video') => {
    if (!filters[kind]) throw new Error('Tipo de archivo no válido.');
    const picked = await showImportOpenDialog(getWindow() ?? undefined!, {
      title: kind === 'image' ? 'Elegir imagen' : kind === 'audio' ? 'Elegir audio' : kind === 'video' ? 'Elegir vídeo' : 'Elegir archivo',
      properties: ['openFile'],
      filters: filters[kind],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const filePath = picked.filePaths[0];
    const data = fs.readFileSync(filePath);
    return pages.storePageAsset({ name: path.basename(filePath), mimeType: mimeFromPath(filePath), bytes: data });
  });
}
