import { deleteResearchAttachments } from '../researchAttachments';
import { chatAssetOwner, deleteChatAssets, reconcileChatAssets } from '../chatAssets';
import { getActiveVault } from '../vaults/vaultRegistry';
import { v4 as uuid } from 'uuid';
import type { DatabaseChatConversation, DatabaseChatConversationSummary, DbChatTurn } from '@shared/types';
import { getDb } from './database';
import { createChatOrganizer } from './chatOrganizerRepo';
import { DATABASE_CHAT_TABLES } from './chatHistoryTables';

/** Projects, folders, pins and notebooks of the database chat history: the shared rules. */
export const databaseChatOrganizer = createChatOrganizer(DATABASE_CHAT_TABLES);

interface Row {
  id: string;
  title: string;
  database_ids_json: string;
  messages_json: string;
  created_at: string;
  updated_at: string;
  archived?: number;
  project_id?: string | null;
  folder_id?: string | null;
  pinned_at?: string | null;
  notebook_id?: string | null;
}

/** The history's columns: the conversation joined with where it sits. */
const WITH_PLACEMENT = `SELECT c.*, p.project_id, p.folder_id, p.pinned_at, p.notebook_id FROM database_chat_conversations c
  LEFT JOIN database_chat_placements p ON p.conversation_id = c.id`;

function parseArray<T>(value: string): T[] {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed as T[] : []; } catch { return []; }
}

function toConversation(row: Row): DatabaseChatConversation {
  const messages = parseArray<DbChatTurn>(row.messages_json);
  return {
    id: row.id, title: row.title, databaseIds: parseArray<string>(row.database_ids_json), messages, messageCount: messages.length, createdAt: row.created_at, updatedAt: row.updated_at,
    archived: row.archived === 1, projectId: row.project_id ?? null, folderId: row.folder_id ?? null, pinnedAt: row.pinned_at ?? null, notebookId: row.notebook_id ?? null,
  };
}

/** The history, newest first; archived chats only when asked for, after the others. */
export function listDatabaseChatConversations(includeArchived = false): DatabaseChatConversationSummary[] {
  return (getDb().prepare(`${WITH_PLACEMENT} ${includeArchived ? '' : 'WHERE c.archived = 0'} ORDER BY c.archived ASC, c.updated_at DESC`).all() as Row[]).map((row) => {
    const conversation = toConversation(row);
    const { messages: _messages, ...summary } = conversation;
    return summary;
  });
}

export function getDatabaseChatConversation(id: string): DatabaseChatConversation | null {
  const row = getDb().prepare(`${WITH_PLACEMENT} WHERE c.id = ?`).get(id) as Row | undefined;
  return row ? toConversation(row) : null;
}

/** A chat can start inside a project (and one of its folders) or inside a notebook. */
export function createDatabaseChatConversation(input: { title: string; databaseIds: string[]; projectId?: string | null; folderId?: string | null; notebookId?: string | null }): DatabaseChatConversation {
  const now = new Date().toISOString(); const id = uuid();
  getDb().prepare('INSERT INTO database_chat_conversations (id,title,database_ids_json,messages_json,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(id, input.title.trim().slice(0, 120) || 'Chat de datos', JSON.stringify(input.databaseIds), '[]', now, now);
  if (input.notebookId) databaseChatOrganizer.setConversationNotebook(id, input.notebookId);
  else if (input.projectId) {
    databaseChatOrganizer.setConversationProject(id, input.projectId);
    if (input.folderId) databaseChatOrganizer.setConversationFolder(id, input.folderId);
  }
  return getDatabaseChatConversation(id)!;
}

export function renameDatabaseChatConversation(id: string, title: string): void {
  getDb().prepare('UPDATE database_chat_conversations SET title = ?, updated_at = ? WHERE id = ?').run(title.trim().slice(0, 120) || 'Chat de datos', new Date().toISOString(), id);
}

export function setDatabaseChatConversationArchived(id: string, archived: boolean): void {
  databaseChatOrganizer.setConversationArchived(id, archived);
}

export function saveDatabaseChatConversation(id: string, messages: DbChatTurn[], databaseIds: string[]): DatabaseChatConversation | null {
  getDb().prepare('UPDATE database_chat_conversations SET messages_json = ?, database_ids_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(messages), JSON.stringify(databaseIds), new Date().toISOString(), id);
  const conversation = getDatabaseChatConversation(id);
  if (conversation) reconcileChatAssets(chatAssetOwner('database', id, getActiveVault().id), conversation.messages);
  return conversation;
}

export function deleteDatabaseChatConversation(id: string): void {
  deleteResearchAttachments({ surface: 'database', conversationId: id });
  const db = getDb();
  db.transaction(() => {
    // A deleted chat leaves no place behind: no project, folder, pin or notebook.
    databaseChatOrganizer.deleteConversationPlacement(id);
    db.prepare('DELETE FROM database_chat_conversations WHERE id = ?').run(id);
  })();
  deleteChatAssets(chatAssetOwner('database', id, getActiveVault().id));
}
