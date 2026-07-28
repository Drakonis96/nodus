import { v4 as uuid } from 'uuid';
import type {
  DbChatTurn,
  ModelRef,
  WorldChatConversation,
  WorldChatConversationSummary,
  WorldChatResult,
  WorldChatSelection,
} from '@shared/types';
import { getDb } from './database';

interface Row {
  id: string;
  title: string;
  selection_json: string;
  focus_json: string;
  messages_json: string;
  model_json: string | null;
  created_at: string;
  updated_at: string;
}

const DEFAULT_SELECTION: WorldChatSelection = { scope: 'auto', entryKeys: [], keepFocus: false };

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function cleanSelection(value: WorldChatSelection | null | undefined): WorldChatSelection {
  return {
    scope: value?.scope === 'manual' ? 'manual' : 'auto',
    entryKeys: Array.isArray(value?.entryKeys)
      ? value.entryKeys.filter((key): key is string => typeof key === 'string')
      : [],
    keepFocus: value?.keepFocus === true,
  };
}

function toConversation(row: Row): WorldChatConversation {
  const messages = parseJson<DbChatTurn[]>(row.messages_json, []);
  return {
    id: row.id,
    title: row.title,
    selection: cleanSelection(parseJson(row.selection_json, DEFAULT_SELECTION)),
    focus: parseJson<WorldChatResult['focus']>(row.focus_json, []),
    model: parseJson<ModelRef | null>(row.model_json, null),
    messages,
    messageCount: messages.length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listWorldChatConversations(): WorldChatConversationSummary[] {
  return (
    getDb()
      .prepare('SELECT * FROM world_chat_conversations ORDER BY updated_at DESC')
      .all() as Row[]
  ).map((row) => {
    const { messages: _messages, ...summary } = toConversation(row);
    return summary;
  });
}

export function getWorldChatConversation(id: string): WorldChatConversation | null {
  const row = getDb().prepare('SELECT * FROM world_chat_conversations WHERE id = ?').get(id) as Row | undefined;
  return row ? toConversation(row) : null;
}

export function createWorldChatConversation(input: {
  title: string;
  selection: WorldChatSelection;
  model: ModelRef | null;
}): WorldChatConversation {
  const now = new Date().toISOString();
  const id = uuid();
  getDb()
    .prepare(
      `INSERT INTO world_chat_conversations
       (id, title, selection_json, focus_json, messages_json, model_json, created_at, updated_at)
       VALUES (?, ?, ?, '[]', '[]', ?, ?, ?)`
    )
    .run(
      id,
      input.title.trim().slice(0, 120) || 'Chat del mundo',
      JSON.stringify(cleanSelection(input.selection)),
      input.model ? JSON.stringify(input.model) : null,
      now,
      now
    );
  return getWorldChatConversation(id)!;
}

export function saveWorldChatConversation(
  id: string,
  messages: DbChatTurn[],
  selection: WorldChatSelection,
  focus: WorldChatResult['focus'],
  model: ModelRef | null
): WorldChatConversation | null {
  getDb()
    .prepare(
      `UPDATE world_chat_conversations
          SET messages_json = ?, selection_json = ?, focus_json = ?, model_json = ?, updated_at = ?
        WHERE id = ?`
    )
    .run(
      JSON.stringify(messages),
      JSON.stringify(cleanSelection(selection)),
      JSON.stringify(focus),
      model ? JSON.stringify(model) : null,
      new Date().toISOString(),
      id
    );
  return getWorldChatConversation(id);
}

export function deleteWorldChatConversation(id: string): void {
  getDb().prepare('DELETE FROM world_chat_conversations WHERE id = ?').run(id);
}
