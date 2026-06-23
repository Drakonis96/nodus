import type { Note, NoteFolder } from '@shared/types';

/** A folder with its child folders and the notes filed directly under it. */
export interface FolderNode {
  folder: NoteFolder;
  depth: number;
  children: FolderNode[];
  notes: Note[];
}

export interface NotesTreeView {
  roots: FolderNode[];
  /** Notes with no folder (folderId === null), shown at the workspace root. */
  unfiled: Note[];
}

/** Build the nested folder/note tree the Notes view renders from the flat payload. */
export function buildNotesTree(folders: NoteFolder[], notes: Note[]): NotesTreeView {
  const byId = new Map<string, FolderNode>();
  for (const folder of folders) {
    byId.set(folder.id, { folder, depth: 0, children: [], notes: [] });
  }

  const roots: FolderNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.folder.parentId;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const unfiled: Note[] = [];
  for (const note of notes) {
    if (note.folderId && byId.has(note.folderId)) {
      byId.get(note.folderId)!.notes.push(note);
    } else {
      unfiled.push(note);
    }
  }

  const sortNotes = (list: Note[]) => list.sort((a, b) => a.orderIdx - b.orderIdx || a.title.localeCompare(b.title));
  const assignDepth = (node: FolderNode, depth: number) => {
    node.depth = depth;
    node.children.sort((a, b) => a.folder.orderIdx - b.folder.orderIdx || a.folder.name.localeCompare(b.folder.name));
    sortNotes(node.notes);
    node.children.forEach((child) => assignDepth(child, depth + 1));
  };
  roots.sort((a, b) => a.folder.orderIdx - b.folder.orderIdx || a.folder.name.localeCompare(b.folder.name));
  roots.forEach((root) => assignDepth(root, 0));
  sortNotes(unfiled);

  return { roots, unfiled };
}

export interface FlatFolder {
  folder: NoteFolder;
  depth: number;
}

/** Depth-first flattening with indentation depth, for folder pickers (selects/menus). */
export function flattenFolders(folders: NoteFolder[]): FlatFolder[] {
  const { roots } = buildNotesTree(folders, []);
  const out: FlatFolder[] = [];
  const walk = (node: FolderNode) => {
    out.push({ folder: node.folder, depth: node.depth });
    node.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

/** Count notes filed anywhere inside a folder subtree (for badges). */
export function countNotesInSubtree(node: FolderNode): number {
  return node.notes.length + node.children.reduce((sum, child) => sum + countNotesInSubtree(child), 0);
}
