import { v4 as uuid } from 'uuid';
import type {
  CharacterChatConversation,
  CharacterChatConversationSummary,
  CharacterChatImage,
  CharacterChatMessage,
} from '@shared/types';
import { getDb } from './database';

interface ConversationRow {
  id: string;
  person_id: string;
  title: string;
  image_enabled: number;
  created_at: string;
  updated_at: string;
  message_count?: number;
  image_count?: number;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'author' | 'character';
  content: string;
  created_at: string;
  image_id: string | null;
  mime_type: string | null;
  bytes: number | null;
  prompt: string | null;
  provider: string | null;
  model: string | null;
  image_created_at: string | null;
}

function summary(row: ConversationRow): CharacterChatConversationSummary {
  return {
    id: row.id,
    personId: row.person_id,
    title: row.title,
    imageEnabled: row.image_enabled === 1,
    messageCount: row.message_count ?? 0,
    imageCount: row.image_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COUNTS = `
  SELECT c.*,
         (SELECT COUNT(*) FROM character_chat_messages m WHERE m.conversation_id = c.id) AS message_count,
         (SELECT COUNT(*) FROM character_chat_images i WHERE i.conversation_id = c.id) AS image_count
    FROM character_chat_conversations c`;

export function listCharacterChatConversations(personId: string): CharacterChatConversationSummary[] {
  return (
    getDb()
      .prepare(`${COUNTS} WHERE c.person_id = ? ORDER BY c.updated_at DESC`)
      .all(personId) as ConversationRow[]
  ).map(summary);
}

export function getCharacterChatConversation(id: string): CharacterChatConversation | null {
  const row = getDb().prepare(`${COUNTS} WHERE c.id = ?`).get(id) as ConversationRow | undefined;
  if (!row) return null;
  const messages = getDb()
    .prepare(
      `SELECT m.*, i.image_id, i.mime_type, i.bytes, i.prompt, i.provider, i.model,
              i.created_at AS image_created_at
         FROM character_chat_messages m
         LEFT JOIN character_chat_images i ON i.message_id = m.id
        WHERE m.conversation_id = ?
        ORDER BY m.seq`
    )
    .all(id) as MessageRow[];
  return {
    ...summary(row),
    messages: messages.map((message): CharacterChatMessage => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.created_at,
      image: message.image_id
        ? {
            imageId: message.image_id,
            mimeType: message.mime_type!,
            bytes: message.bytes!,
            prompt: message.prompt,
            provider: message.provider,
            model: message.model,
            createdAt: message.image_created_at!,
          }
        : null,
    })),
  };
}

export function createCharacterChatConversation(input: {
  personId: string;
  title: string;
  imageEnabled?: boolean;
}): CharacterChatConversation {
  const id = uuid();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO character_chat_conversations
       (id, person_id, title, image_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, input.personId, input.title.trim().slice(0, 120) || 'Conversación', input.imageEnabled ? 1 : 0, now, now);
  return getCharacterChatConversation(id)!;
}

export function setCharacterChatImagesEnabled(id: string, enabled: boolean): CharacterChatConversation | null {
  getDb()
    .prepare('UPDATE character_chat_conversations SET image_enabled = ?, updated_at = ? WHERE id = ?')
    .run(enabled ? 1 : 0, new Date().toISOString(), id);
  return getCharacterChatConversation(id);
}

export function appendCharacterChatMessage(
  conversationId: string,
  role: 'author' | 'character',
  content: string
): CharacterChatMessage {
  const db = getDb();
  const id = uuid();
  const now = new Date().toISOString();
  const seq = (
    db.prepare('SELECT COALESCE(MAX(seq), -1) + 1 AS seq FROM character_chat_messages WHERE conversation_id = ?').get(
      conversationId
    ) as { seq: number }
  ).seq;
  const write = db.transaction(() => {
    db.prepare(
      'INSERT INTO character_chat_messages (id, conversation_id, seq, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, conversationId, seq, role, content, now);
    db.prepare('UPDATE character_chat_conversations SET updated_at = ? WHERE id = ?').run(now, conversationId);
  });
  write();
  return { id, role, content, image: null, createdAt: now };
}

export function attachCharacterChatImage(input: {
  conversationId: string;
  messageId: string;
  blob: Buffer;
  thumbnailBlob?: Buffer | null;
  mimeType: string;
  prompt: string;
  provider: string;
  model: string;
}): CharacterChatImage {
  const db = getDb();
  const owner = db
    .prepare('SELECT conversation_id FROM character_chat_messages WHERE id = ?')
    .get(input.messageId) as { conversation_id: string } | undefined;
  if (!owner || owner.conversation_id !== input.conversationId) {
    throw new Error('La conversación se eliminó antes de guardar la imagen.');
  }
  const imageId = uuid();
  const now = new Date().toISOString();
  db
    .prepare(
      `INSERT INTO character_chat_images
       (image_id, conversation_id, message_id, mime_type, bytes, blob, thumbnail_blob, prompt, provider, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      imageId,
      input.conversationId,
      input.messageId,
      input.mimeType,
      input.blob.byteLength,
      input.blob,
      input.thumbnailBlob ?? null,
      input.prompt,
      input.provider,
      input.model,
      now
    );
  return {
    imageId,
    mimeType: input.mimeType,
    bytes: input.blob.byteLength,
    prompt: input.prompt,
    provider: input.provider,
    model: input.model,
    createdAt: now,
  };
}

export function getCharacterChatImageBlob(imageId: string): { blob: Buffer; mime: string } | null {
  const row = getDb()
    .prepare('SELECT blob, mime_type FROM character_chat_images WHERE image_id = ?')
    .get(imageId) as { blob: Buffer; mime_type: string } | undefined;
  return row ? { blob: row.blob, mime: row.mime_type } : null;
}

export function getCharacterChatImageThumbnail(imageId: string): { blob: Buffer; mime: string } | null {
  const row = getDb()
    .prepare('SELECT COALESCE(thumbnail_blob, blob) AS blob FROM character_chat_images WHERE image_id = ?')
    .get(imageId) as { blob: Buffer } | undefined;
  return row ? { blob: row.blob, mime: 'image/jpeg' } : null;
}

function deleteConversationRows(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM character_chat_images WHERE conversation_id = ?').run(id);
  db.prepare('DELETE FROM character_chat_messages WHERE conversation_id = ?').run(id);
  db.prepare('DELETE FROM character_chat_conversations WHERE id = ?').run(id);
}

export function deleteCharacterChatConversation(id: string): void {
  getDb().transaction(() => deleteConversationRows(id))();
}

export function deleteCharacterChatConversations(personId: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    const rows = db.prepare('SELECT id FROM character_chat_conversations WHERE person_id = ?').all(personId) as { id: string }[];
    for (const row of rows) deleteConversationRows(row.id);
  });
  tx();
}
