import crypto from 'node:crypto';
import type { ChatFolder, ChatFolderSurface } from '@shared/types';
import { getDb } from './database';

/**
 * Conversation folders.
 *
 * One shared tree (`chat_folders`) serves every chat surface, keyed by `surface`. Each
 * SQLite-backed chat names its folder through a membership table with a real foreign key:
 * deleting a conversation cascades the membership away, and deleting a folder un-files its
 * conversations (`ON DELETE SET NULL`) rather than deleting them. Study conversations live in
 * a JSON store instead of a table, so they carry their folder id on the record and are handled
 * by `studyAssistant.ts`; `MEMBERSHIP_TABLE` has no entry for them.
 */
interface FolderRow {
  folder_id: string;
  surface: string;
  name: string;
  parent_id: string | null;
  position: number;
  created_at: string;
}

const rowToFolder = (row: FolderRow): ChatFolder => ({
  folderId: row.folder_id,
  surface: row.surface as ChatFolderSurface,
  name: row.name,
  parentId: row.parent_id,
  position: row.position,
  createdAt: row.created_at,
});

const MEMBERSHIP_TABLE: Partial<Record<ChatFolderSurface, string>> = {
  research: 'chat_conversation_folders',
  database: 'database_conversation_folders',
  world: 'world_conversation_folders',
};

function membershipTable(surface: ChatFolderSurface): string | null {
  return MEMBERSHIP_TABLE[surface] ?? null;
}

export function listChatFolders(surface: ChatFolderSurface): ChatFolder[] {
  return (getDb().prepare('SELECT * FROM chat_folders WHERE surface = ? ORDER BY position ASC, name ASC').all(surface) as FolderRow[]).map(rowToFolder);
}

export function getChatFolder(folderId: string): ChatFolder | null {
  const row = getDb().prepare('SELECT * FROM chat_folders WHERE folder_id = ?').get(folderId) as FolderRow | undefined;
  return row ? rowToFolder(row) : null;
}

/** Folder ids at or below `folderId` (itself included); used to block moving a folder into its own subtree. */
function subtreeIds(folderId: string): Set<string> {
  const rows = getDb().prepare('SELECT folder_id, parent_id FROM chat_folders').all() as Array<{ folder_id: string; parent_id: string | null }>;
  const children = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    children.set(row.parent_id, [...(children.get(row.parent_id) ?? []), row.folder_id]);
  }
  const out = new Set<string>([folderId]);
  const stack = [folderId];
  while (stack.length) {
    for (const child of children.get(stack.pop()!) ?? []) {
      if (!out.has(child)) { out.add(child); stack.push(child); }
    }
  }
  return out;
}

function nextPosition(surface: ChatFolderSurface, parentId: string | null): number {
  const row = getDb().prepare(
    'SELECT MAX(position) AS max FROM chat_folders WHERE surface = ? AND parent_id IS ?',
  ).get(surface, parentId) as { max: number | null } | undefined;
  return (row?.max ?? -1) + 1;
}

export function createChatFolder(surface: ChatFolderSurface, name: string, parentId: string | null = null): ChatFolder {
  const folderId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  getDb().prepare(
    'INSERT INTO chat_folders (folder_id, surface, name, parent_id, position, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(folderId, surface, name.trim() || 'Carpeta', parentId, nextPosition(surface, parentId), createdAt);
  return getChatFolder(folderId)!;
}

export function renameChatFolder(folderId: string, name: string): ChatFolder | null {
  getDb().prepare('UPDATE chat_folders SET name = ? WHERE folder_id = ?').run(name.trim() || 'Carpeta', folderId);
  return getChatFolder(folderId);
}

/** Re-parent (and optionally re-order) a folder. Refuses to move a folder into its own subtree. */
export function moveChatFolder(folderId: string, parentId: string | null, position?: number): ChatFolder | null {
  if (parentId !== null && subtreeIds(folderId).has(parentId)) return getChatFolder(folderId);
  const folder = getChatFolder(folderId);
  if (!folder) return null;
  const order = position ?? nextPosition(folder.surface, parentId);
  getDb().prepare('UPDATE chat_folders SET parent_id = ?, position = ? WHERE folder_id = ?').run(parentId, order, folderId);
  return getChatFolder(folderId);
}

/** Delete a folder. Subfolders cascade; conversations are un-filed (never deleted). */
export function deleteChatFolder(folderId: string): void {
  getDb().prepare('DELETE FROM chat_folders WHERE folder_id = ?').run(folderId);
}

/** conversation id → folder id (or null) for the surface's SQLite membership table. */
export function conversationFolderMap(surface: ChatFolderSurface): Record<string, string | null> {
  const table = membershipTable(surface);
  if (!table) return {};
  const rows = getDb().prepare(`SELECT conversation_id, folder_id FROM ${table}`).all() as Array<{ conversation_id: string; folder_id: string | null }>;
  return Object.fromEntries(rows.map((row) => [row.conversation_id, row.folder_id]));
}

/** File a conversation under a folder, or un-file it with `null`. No-op for JSON-backed surfaces. */
export function setConversationFolder(surface: ChatFolderSurface, conversationId: string, folderId: string | null): void {
  const table = membershipTable(surface);
  if (!table) return;
  if (folderId === null) {
    getDb().prepare(`DELETE FROM ${table} WHERE conversation_id = ?`).run(conversationId);
    return;
  }
  getDb().prepare(
    `INSERT INTO ${table} (conversation_id, folder_id, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(conversation_id) DO UPDATE SET folder_id = excluded.folder_id, updated_at = excluded.updated_at`,
  ).run(conversationId, folderId, new Date().toISOString());
}

/** Every folder id currently defined for a surface (used to detect orphans in the JSON store). */
export function chatFolderIds(surface: ChatFolderSurface): string[] {
  return (getDb().prepare('SELECT folder_id FROM chat_folders WHERE surface = ?').all(surface) as Array<{ folder_id: string }>).map((row) => row.folder_id);
}
