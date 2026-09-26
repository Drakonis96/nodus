import { deleteResearchAttachments } from '../researchAttachments';
import { chatAssetOwner, deleteChatAssets, reconcileChatAssets } from '../chatAssets';
import { getActiveVault } from '../vaults/vaultRegistry';
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
import { createChatOrganizer } from './chatOrganizerRepo';
import { WORLD_CHAT_TABLES } from './chatHistoryTables';

/** Projects, folders, pins and notebooks of the world chat history: the shared rules. */
export const worldChatOrganizer = createChatOrganizer(WORLD_CHAT_TABLES);

interface Row {
  id: string;
  title: string;
  selection_json: string;
  focus_json: string;
  messages_json: string;
  model_json: string | null;
  created_at: string;
  updated_at: string;
  archived?: number;
  project_id?: string | null;
  folder_id?: string | null;
  pinned_at?: string | null;
  notebook_id?: string | null;
}

/** The history's columns: the conversation joined with where it sits. */
const WITH_PLACEMENT = `SELECT c.*, p.project_id, p.folder_id, p.pinned_at, p.notebook_id FROM world_chat_conversations c
  LEFT JOIN world_chat_placements p ON p.conversation_id = c.id`;

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
    archived: row.archived === 1,
    projectId: row.project_id ?? null,
    folderId: row.folder_id ?? null,
    pinnedAt: row.pinned_at ?? null,
    notebookId: row.notebook_id ?? null,
  };
}

/** The history, newest first; archived chats only when asked for, after the others. */
export function listWorldChatConversations(includeArchived = false): WorldChatConversationSummary[] {
  return (
    getDb()
      .prepare(`${WITH_PLACEMENT} ${includeArchived ? '' : 'WHERE c.archived = 0'} ORDER BY c.archived ASC, c.updated_at DESC`)
      .all() as Row[]
  ).map((row) => {
    const { messages: _messages, ...summary } = toConversation(row);
    return summary;
  });
}

export function getWorldChatConversation(id: string): WorldChatConversation | null {
  const row = getDb().prepare(`${WITH_PLACEMENT} WHERE c.id = ?`).get(id) as Row | undefined;
  return row ? toConversation(row) : null;
}

/** A chat can start inside a project (and one of its folders) or inside a notebook. */
export function createWorldChatConversation(input: {
  title: string;
  selection: WorldChatSelection;
  model: ModelRef | null;
  projectId?: string | null;
  folderId?: string | null;
  notebookId?: string | null;
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
  if (input.notebookId) worldChatOrganizer.setConversationNotebook(id, input.notebookId);
  else if (input.projectId) {
    worldChatOrganizer.setConversationProject(id, input.projectId);
    if (input.folderId) worldChatOrganizer.setConversationFolder(id, input.folderId);
  }
  return getWorldChatConversation(id)!;
}

export function renameWorldChatConversation(id: string, title: string): void {
  getDb().prepare('UPDATE world_chat_conversations SET title = ?, updated_at = ? WHERE id = ?').run(title.trim().slice(0, 120) || 'Chat del mundo', new Date().toISOString(), id);
}

export function setWorldChatConversationArchived(id: string, archived: boolean): void {
  worldChatOrganizer.setConversationArchived(id, archived);
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
  reconcileChatAssets(chatAssetOwner('world-assistant', id, getActiveVault().id), messages);
  return getWorldChatConversation(id);
}

export function deleteWorldChatConversation(id: string): void {
  deleteResearchAttachments({ surface: 'world', conversationId: id });
  deleteChatAssets(chatAssetOwner('world-assistant', id, getActiveVault().id));
  const db = getDb();
  db.transaction(() => {
    // A deleted chat leaves no place behind: no project, folder, pin or notebook.
    worldChatOrganizer.deleteConversationPlacement(id);
    db.prepare('DELETE FROM world_chat_conversations WHERE id = ?').run(id);
  })();
}
