import type { ChatConversationSummary, ResearchChatProjectFolder } from './types';

/** The "no folder" node inside a project. */
export const UNFILED_FOLDER = 'unfiled';

/** What a project's tree has selected: its whole content (null), a folder, or its unfiled chats. */
export type ChatFolderSelection = { projectId: string; folderId: string | null };

/** A project's folders by parent (null: the root), each list in its stored order. */
export function folderChildren(folders: ResearchChatProjectFolder[], projectId: string): Map<string | null, ResearchChatProjectFolder[]> {
  const byParent = new Map<string | null, ResearchChatProjectFolder[]>();
  for (const folder of folders) if (folder.projectId === projectId) byParent.set(folder.parentId, [...(byParent.get(folder.parentId) ?? []), folder]);
  for (const list of byParent.values()) list.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  return byParent;
}

/** A folder and every folder below it. */
export function folderSubtree(folders: ResearchChatProjectFolder[], folderId: string): Set<string> {
  const ids = new Set([folderId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const folder of folders) if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) { ids.add(folder.id); grew = true; }
  }
  return ids;
}

/** The chats a selection shows: the whole project, the unfiled ones, or a folder with its subfolders. */
export function conversationsInSelection(conversations: ChatConversationSummary[], folders: ResearchChatProjectFolder[], projectId: string, folderId: string | null): ChatConversationSummary[] {
  const inProject = conversations.filter(conversation => conversation.projectId === projectId);
  if (!folderId) return inProject;
  if (folderId === UNFILED_FOLDER) return inProject.filter(conversation => !conversation.folderId || !folders.some(folder => folder.id === conversation.folderId));
  const subtree = folderSubtree(folders, folderId);
  return inProject.filter(conversation => !!conversation.folderId && subtree.has(conversation.folderId));
}

/** Where a dragged folder may land: never on itself, its subtree or another project. */
export function canNestFolder(folders: ResearchChatProjectFolder[], folder: ResearchChatProjectFolder, parentId: string | null): boolean {
  if (!parentId) return true;
  const parent = folders.find(item => item.id === parentId);
  return !!parent && parent.projectId === folder.projectId && !folderSubtree(folders, folder.id).has(parentId);
}

/** A free name among siblings: "base", then "base 2", "base 3"… */
export function nextFolderName(folders: ResearchChatProjectFolder[], projectId: string, parentId: string | null, base: string): string {
  const taken = new Set(folders.filter(folder => folder.projectId === projectId && folder.parentId === parentId).map(folder => folder.name));
  let name = base;
  for (let index = 2; taken.has(name); index++) name = `${base} ${index}`;
  return name;
}
