import type {
  CreatePageInput,
  Page,
  PageAsset,
  PageBacklink,
  PageComment,
  PageDocument,
  PageMutationResult,
  PageRevisionPage,
  PageRevisionSnapshot,
  PageSearchResult,
  PageTreeItem,
  SavePageDocumentInput,
  SyncedBlockSource,
  WorkspaceActor,
  WorkspaceNotification,
  WorkspaceGroup,
  AclEntry,
  AclPrincipalType,
  AclResourceType,
  AclRole,
  EffectiveAcl,
  WorkspaceShareLink,
} from '../pages';

export interface PagesApi {
  getPage(id: string, actorId?: string): Promise<Page | null>;
  getPageDocument(id: string, actorId?: string): Promise<PageDocument | null>;
  getPageForDatabaseRow(rowId: string, actorId?: string): Promise<PageDocument | null>;
  getPageForNote(noteId: string, actorId?: string): Promise<PageDocument | null>;
  listPages(state?: 'active' | 'trashed' | 'all', actorId?: string): Promise<PageTreeItem[]>;
  listPageBreadcrumbs(pageId: string, actorId?: string): Promise<Page[]>;
  listPageBacklinks(pageId: string, actorId?: string): Promise<PageBacklink[]>;
  listBrokenPageLinks(actorId?: string): Promise<PageBacklink[]>;
  searchPages(query: string, mode?: 'lexical' | 'semantic', limit?: number, actorId?: string): Promise<PageSearchResult[]>;
  getSyncedBlockSource(blockId: string, actorId?: string): Promise<SyncedBlockSource | null>;
  listPageRevisions(pageId: string, cursor?: string | null, limit?: number, actorId?: string): Promise<PageRevisionPage>;
  getPageRevision(pageId: string, revision: number, actorId?: string): Promise<PageRevisionSnapshot | null>;
  restorePageRevision(
    pageId: string,
    revision: number,
    expectedDocumentRevision: number,
    actorId?: string,
  ): Promise<PageMutationResult>;
  listWorkspaceActors(): Promise<WorkspaceActor[]>;
  createWorkspaceActor(input: { displayName: string; email?: string | null; kind?: 'member' | 'guest' }): Promise<WorkspaceActor>;
  listPageComments(pageId: string, includeResolved?: boolean, actorId?: string): Promise<PageComment[]>;
  createPageComment(input: {
    pageId: string; blockId?: string | null; parentCommentId?: string | null; body: string; actorId?: string;
  }): Promise<PageComment>;
  updatePageComment(id: string, body: string, expectedRevision: number, actorId?: string): Promise<PageComment>;
  resolvePageComment(id: string, resolved: boolean, expectedRevision: number, actorId?: string): Promise<PageComment>;
  setPageCommentReaction(id: string, emoji: string, active: boolean, actorId?: string): Promise<PageComment>;
  listWorkspaceNotifications(actorId?: string, unreadOnly?: boolean, limit?: number): Promise<WorkspaceNotification[]>;
  markWorkspaceNotificationRead(id: string, read?: boolean, actorId?: string): Promise<void>;
  listWorkspaceGroups(): Promise<WorkspaceGroup[]>;
  createWorkspaceGroup(name: string): Promise<WorkspaceGroup>;
  setWorkspaceGroupMembers(groupId: string, actorIds: string[], expectedRevision: number): Promise<WorkspaceGroup>;
  listAclEntries(resourceType: AclResourceType, resourceId: string, actorId?: string): Promise<AclEntry[]>;
  setAclEntry(input: { resourceType: AclResourceType; resourceId: string; principalType: AclPrincipalType; principalId: string; role: AclRole; actorId?: string }): Promise<AclEntry>;
  deleteAclEntry(id: string, expectedRevision: number, actorId?: string): Promise<void>;
  getEffectiveAcl(resourceType: AclResourceType, resourceId: string, actorId?: string): Promise<EffectiveAcl>;
  createWorkspaceShareLink(input: { resourceType: 'page' | 'database' | 'view'; resourceId: string; role: 'comment' | 'view'; password?: string | null; expiresAt?: string | null; allowIndexing?: boolean; actorId?: string }): Promise<WorkspaceShareLink>;
  listWorkspaceShareLinks(resourceType: 'page' | 'database' | 'view', resourceId: string, actorId?: string): Promise<WorkspaceShareLink[]>;
  revokeWorkspaceShareLink(id: string, expectedRevision: number, actorId?: string): Promise<void>;
  authorizeWorkspaceShareLink(token: string, password?: string | null): Promise<{ resourceType: 'page' | 'database' | 'view'; resourceId: string; role: 'comment' | 'view'; allowIndexing: boolean } | null>;
  createPage(input?: CreatePageInput): Promise<PageDocument>;
  updatePage(
    id: string,
    patch: { title?: string; icon?: string | null; coverBlobHash?: string | null; fullWidth?: boolean; locked?: boolean },
    expectedRevision: number, actorId?: string,
  ): Promise<Page | null>;
  movePage(id: string, parentPageId: string | null, expectedRevision: number, actorId?: string): Promise<Page>;
  setPageFavorite(id: string, favorite: boolean): Promise<void>;
  setPageState(id: string, state: 'active' | 'trashed', expectedRevision: number, actorId?: string): Promise<Page[]>;
  savePageDocument(input: SavePageDocumentInput): Promise<PageMutationResult>;
  applyPageDocumentUpdate(
    pageId: string,
    update: Uint8Array,
    expectedRevision: number,
    actorId?: string, principalId?: string,
  ): Promise<PageMutationResult>;
  replacePageFromMarkdown(
    pageId: string,
    markdown: string,
    expectedRevision: number, actorId?: string,
  ): Promise<PageMutationResult>;
  exportPageMarkdown(pageId: string, actorId?: string): Promise<{ title: string; markdown: string; markdownHash: string } | null>;
  storePageAsset(input: { name: string; mimeType?: string | null; bytes: Uint8Array }): Promise<PageAsset>;
  pickPageAsset(kind: 'image' | 'file' | 'audio' | 'video'): Promise<PageAsset | null>;
  getPageAsset(blobHash: string): Promise<Uint8Array | null>;
}
