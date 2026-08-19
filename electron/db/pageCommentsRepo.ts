import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import type { PageComment, PageCommentReaction, WorkspaceActor, WorkspaceNotification } from '@shared/pages';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const MENTION = /@\[actor:([A-Za-z0-9._:-]{1,128})\]/g;

function actor(row: Row): WorkspaceActor {
  return { id: String(row.id), displayName: String(row.display_name), email: row.email == null ? null : String(row.email),
    avatar: row.avatar == null ? null : String(row.avatar), kind: String(row.kind) as WorkspaceActor['kind'],
    revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

function requireActor(id: string): void {
  if (!getDb().prepare('SELECT 1 FROM workspace_actors WHERE id = ?').get(id)) throw new Error('La persona no existe en este vault.');
}

export function listWorkspaceActors(): WorkspaceActor[] {
  return (getDb().prepare("SELECT * FROM workspace_actors WHERE kind <> 'system' ORDER BY display_name COLLATE NOCASE, id").all() as Row[]).map(actor);
}

export function createWorkspaceActor(input: { displayName: string; email?: string | null; kind?: 'member' | 'guest' }): WorkspaceActor {
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error('El nombre de la persona es obligatorio.');
  const id = `actor_${randomUUID()}`; const timestamp = now();
  getDb().prepare(`INSERT INTO workspace_actors
    (id, display_name, email, kind, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`)
    .run(id, displayName, input.email?.trim() || null, input.kind ?? 'member', timestamp, timestamp);
  return actor(getDb().prepare('SELECT * FROM workspace_actors WHERE id = ?').get(id) as Row);
}

function reactions(commentId: string): PageCommentReaction[] {
  const rows = getDb().prepare(
    `SELECT emoji, group_concat(actor_id, char(31)) AS actors, COUNT(*) AS count
     FROM page_comment_reactions WHERE comment_id = ? GROUP BY emoji ORDER BY MIN(created_at), emoji`,
  ).all(commentId) as Array<{ emoji: string; actors: string; count: number }>;
  return rows.map((row) => ({ emoji: row.emoji, count: Number(row.count), actorIds: row.actors ? row.actors.split(String.fromCharCode(31)) : [] }));
}

function comment(row: Row): PageComment {
  const id = String(row.id);
  return { id, pageId: String(row.page_id), blockId: row.block_id == null ? null : String(row.block_id),
    parentCommentId: row.parent_comment_id == null ? null : String(row.parent_comment_id), body: String(row.body),
    revision: Number(row.revision), createdBy: String(row.created_by), updatedBy: String(row.updated_by),
    authorName: String(row.author_name), resolvedAt: row.resolved_at == null ? null : String(row.resolved_at),
    resolvedBy: row.resolved_by == null ? null : String(row.resolved_by), reactions: reactions(id),
    mentionedActorIds: (getDb().prepare('SELECT actor_id FROM page_comment_mentions WHERE comment_id = ? ORDER BY actor_id').all(id) as Array<{ actor_id: string }>).map((entry) => entry.actor_id),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

const commentProjection = `SELECT c.*, actor.display_name AS author_name FROM page_comments c
  JOIN workspace_actors actor ON actor.id = c.created_by`;

export function getComment(id: string): PageComment | null {
  const row = getDb().prepare(`${commentProjection} WHERE c.id = ? AND c.deleted_at IS NULL`).get(id) as Row | undefined;
  return row ? comment(row) : null;
}

export function listPageComments(pageId: string, includeResolved = false): PageComment[] {
  const rows = getDb().prepare(`${commentProjection}
    WHERE c.page_id = ? AND c.deleted_at IS NULL
    ORDER BY COALESCE(c.parent_comment_id, c.id), c.parent_comment_id IS NOT NULL, c.created_at, c.id LIMIT 500`)
    .all(pageId) as Row[];
  const items = rows.map(comment);
  if (includeResolved) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  return items.filter((item) => {
    let current: PageComment | undefined = item;
    const seen = new Set<string>();
    while (current) {
      if (current.resolvedAt) return false;
      if (!current.parentCommentId || seen.has(current.parentCommentId)) break;
      seen.add(current.parentCommentId);
      current = byId.get(current.parentCommentId);
    }
    return true;
  });
}

function refreshMentions(commentId: string, body: string, sourceActorId: string): void {
  const db = getDb(); const timestamp = now();
  db.prepare("DELETE FROM workspace_notifications WHERE comment_id = ? AND kind = 'mention'").run(commentId);
  db.prepare('DELETE FROM page_comment_mentions WHERE comment_id = ?').run(commentId);
  const ids = new Set([...body.matchAll(MENTION)].map((match) => match[1]).filter((id) => id !== sourceActorId));
  const row = db.prepare('SELECT page_id, block_id FROM page_comments WHERE id = ?').get(commentId) as { page_id: string; block_id: string | null };
  const page = db.prepare('SELECT title FROM pages WHERE id = ?').get(row.page_id) as { title: string };
  for (const id of ids) {
    if (!db.prepare('SELECT 1 FROM workspace_actors WHERE id = ?').get(id)) continue;
    db.prepare('INSERT INTO page_comment_mentions (comment_id, actor_id, created_at) VALUES (?, ?, ?)').run(commentId, id, timestamp);
    db.prepare(`INSERT INTO workspace_notifications
      (id, actor_id, kind, page_id, block_id, comment_id, title, body, is_read, created_at)
      VALUES (?, ?, 'mention', ?, ?, ?, ?, ?, 0, ?)`)
      .run(`notify_${randomUUID()}`, id, row.page_id, row.block_id, commentId, page.title, body.slice(0, 300), timestamp);
  }
}

export function createPageComment(input: { pageId: string; blockId?: string | null; parentCommentId?: string | null; body: string; actorId?: string }): PageComment {
  const db = getDb(); const body = input.body.trim(); const actorId = input.actorId ?? 'local';
  requireActor(actorId); if (!body || body.length > 10_000) throw new Error('El comentario debe tener entre 1 y 10.000 caracteres.');
  if (!db.prepare('SELECT 1 FROM pages WHERE id = ?').get(input.pageId)) throw new Error('La página no existe.');
  if (input.blockId && !db.prepare('SELECT 1 FROM page_blocks WHERE id = ? AND page_id = ?').get(input.blockId, input.pageId)) throw new Error('El bloque no pertenece a esta página.');
  let parent: PageComment | null = null;
  if (input.parentCommentId) { parent = getComment(input.parentCommentId); if (!parent || parent.pageId !== input.pageId) throw new Error('El comentario padre no pertenece a esta página.'); }
  const id = `pcomment_${randomUUID()}`; const timestamp = now();
  db.transaction(() => {
    db.prepare(`INSERT INTO page_comments
      (id, page_id, block_id, parent_comment_id, body, revision, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
      .run(id, input.pageId, input.blockId ?? parent?.blockId ?? null, input.parentCommentId ?? null, body, actorId, actorId, timestamp, timestamp);
    refreshMentions(id, body, actorId);
    if (parent && parent.createdBy !== actorId) {
      const page = db.prepare('SELECT title FROM pages WHERE id = ?').get(input.pageId) as { title: string };
      db.prepare(`INSERT INTO workspace_notifications
        (id, actor_id, kind, page_id, block_id, comment_id, title, body, is_read, created_at)
        VALUES (?, ?, 'comment_reply', ?, ?, ?, ?, ?, 0, ?)`)
        .run(`notify_${randomUUID()}`, parent.createdBy, input.pageId, input.blockId ?? parent.blockId, id, page.title, body.slice(0, 300), timestamp);
    }
  })();
  return getComment(id)!;
}

export function updatePageComment(id: string, bodyValue: string, expectedRevision: number, actorId = 'local'): PageComment {
  requireActor(actorId); const body = bodyValue.trim(); if (!body || body.length > 10_000) throw new Error('El comentario debe tener entre 1 y 10.000 caracteres.');
  const timestamp = now();
  return getDb().transaction(() => {
    const result = getDb().prepare(`UPDATE page_comments SET body = ?, revision = revision + 1, updated_by = ?, updated_at = ?
      WHERE id = ? AND revision = ? AND deleted_at IS NULL`).run(body, actorId, timestamp, id, expectedRevision);
    if (result.changes !== 1) throw new Error('El comentario cambió o ya no existe.');
    refreshMentions(id, body, actorId); return getComment(id)!;
  })();
}

export function resolvePageComment(id: string, resolved: boolean, expectedRevision: number, actorId = 'local'): PageComment {
  requireActor(actorId); const timestamp = now(); const db = getDb();
  return db.transaction(() => {
    const previous = getComment(id);
    if (!previous) throw new Error('El comentario cambió o ya no existe.');
    const result = db.prepare(`UPDATE page_comments SET resolved_at = ?, resolved_by = ?, revision = revision + 1,
      updated_by = ?, updated_at = ? WHERE id = ? AND revision = ? AND deleted_at IS NULL`)
      .run(resolved ? timestamp : null, resolved ? actorId : null, actorId, timestamp, id, expectedRevision);
    if (result.changes !== 1) throw new Error('El comentario cambió o ya no existe.');
    db.prepare("DELETE FROM workspace_notifications WHERE comment_id = ? AND kind = 'comment_resolved'").run(id);
    if (resolved && previous.createdBy !== actorId) {
      const page = db.prepare('SELECT title FROM pages WHERE id = ?').get(previous.pageId) as { title: string };
      db.prepare(`INSERT INTO workspace_notifications
        (id, actor_id, kind, page_id, block_id, comment_id, title, body, is_read, created_at)
        VALUES (?, ?, 'comment_resolved', ?, ?, ?, ?, ?, 0, ?)`)
        .run(`notify_${randomUUID()}`, previous.createdBy, previous.pageId, previous.blockId, id, page.title, previous.body.slice(0, 300), timestamp);
    }
    return getComment(id)!;
  })();
}

export function setPageCommentReaction(id: string, emojiValue: string, active: boolean, actorId = 'local'): PageComment {
  requireActor(actorId); const emoji = emojiValue.trim(); if (!emoji || emoji.length > 32) throw new Error('La reacción no es válida.');
  if (!getComment(id)) throw new Error('El comentario no existe.');
  if (active) getDb().prepare('INSERT OR IGNORE INTO page_comment_reactions (comment_id, actor_id, emoji, created_at) VALUES (?, ?, ?, ?)').run(id, actorId, emoji, now());
  else getDb().prepare('DELETE FROM page_comment_reactions WHERE comment_id = ? AND actor_id = ? AND emoji = ?').run(id, actorId, emoji);
  return getComment(id)!;
}

function notification(row: Row): WorkspaceNotification {
  return { id: String(row.id), actorId: String(row.actor_id), kind: String(row.kind) as WorkspaceNotification['kind'],
    pageId: row.page_id == null ? null : String(row.page_id), blockId: row.block_id == null ? null : String(row.block_id),
    commentId: row.comment_id == null ? null : String(row.comment_id), title: String(row.title), body: String(row.body),
    read: Number(row.is_read) === 1, createdAt: String(row.created_at) };
}

export function listWorkspaceNotifications(actorId = 'local', unreadOnly = false, limit = 100): WorkspaceNotification[] {
  requireActor(actorId); const bounded = Math.min(200, Math.max(1, Math.floor(limit)));
  return (getDb().prepare(`SELECT * FROM workspace_notifications WHERE actor_id = ? AND (? = 0 OR is_read = 0)
    ORDER BY created_at DESC, id DESC LIMIT ?`).all(actorId, Number(unreadOnly), bounded) as Row[]).map(notification);
}

export function markWorkspaceNotificationRead(id: string, read = true, actorId = 'local'): void {
  requireActor(actorId);
  getDb().prepare('UPDATE workspace_notifications SET is_read = ? WHERE id = ? AND actor_id = ?').run(Number(read), id, actorId);
}
