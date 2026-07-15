import { v4 as uuid } from 'uuid';
import type { DatabaseChatConversation, DatabaseChatConversationSummary, DbChatTurn } from '@shared/types';
import { getDb } from './database';

interface Row {
  id: string;
  title: string;
  database_ids_json: string;
  messages_json: string;
  created_at: string;
  updated_at: string;
}

function parseArray<T>(value: string): T[] {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed as T[] : []; } catch { return []; }
}

function toConversation(row: Row): DatabaseChatConversation {
  const messages = parseArray<DbChatTurn>(row.messages_json);
  return { id: row.id, title: row.title, databaseIds: parseArray<string>(row.database_ids_json), messages, messageCount: messages.length, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function listDatabaseChatConversations(): DatabaseChatConversationSummary[] {
  return (getDb().prepare('SELECT * FROM database_chat_conversations ORDER BY updated_at DESC').all() as Row[]).map((row) => {
    const conversation = toConversation(row);
    const { messages: _messages, ...summary } = conversation;
    return summary;
  });
}

export function getDatabaseChatConversation(id: string): DatabaseChatConversation | null {
  const row = getDb().prepare('SELECT * FROM database_chat_conversations WHERE id = ?').get(id) as Row | undefined;
  return row ? toConversation(row) : null;
}

export function createDatabaseChatConversation(input: { title: string; databaseIds: string[] }): DatabaseChatConversation {
  const now = new Date().toISOString(); const id = uuid();
  getDb().prepare('INSERT INTO database_chat_conversations (id,title,database_ids_json,messages_json,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(id, input.title.trim().slice(0, 120) || 'Chat de datos', JSON.stringify(input.databaseIds), '[]', now, now);
  return getDatabaseChatConversation(id)!;
}

export function saveDatabaseChatConversation(id: string, messages: DbChatTurn[], databaseIds: string[]): DatabaseChatConversation | null {
  getDb().prepare('UPDATE database_chat_conversations SET messages_json = ?, database_ids_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(messages), JSON.stringify(databaseIds), new Date().toISOString(), id);
  return getDatabaseChatConversation(id);
}

export function deleteDatabaseChatConversation(id: string): void {
  getDb().prepare('DELETE FROM database_chat_conversations WHERE id = ?').run(id);
}
