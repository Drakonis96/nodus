import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import { RESEARCH_CHAT_PIN_LIMIT, type ResearchChatProject } from '@shared/types';

type ProjectRow = { id: string; name: string; icon: string | null; color: string | null; created_at: string; updated_at: string };
const decode = (row: ProjectRow): ResearchChatProject => ({ id: row.id, name: row.name, icon: row.icon, color: row.color, createdAt: row.created_at, updatedAt: row.updated_at });

const cleanName = (name: unknown): string => {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) throw new Error('research_chat_project_invalid_name');
  return name.trim();
};
const cleanIcon = (icon: unknown): string | null => {
  if (icon == null) return null;
  if (typeof icon !== 'string' || !/^[a-zA-Z]{1,40}$/.test(icon)) throw new Error('research_chat_project_invalid_icon');
  return icon;
};
const cleanColor = (color: unknown): string | null => {
  if (color == null) return null;
  if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('research_chat_project_invalid_color');
  return color.toLowerCase();
};

/** Projects in alphabetical order, the way the history lists them. */
export function listChatProjects(): ResearchChatProject[] {
  const rows = getDb().prepare('SELECT * FROM research_chat_projects').all() as ProjectRow[];
  return rows.map(decode).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id));
}

export function getChatProject(id: string): ResearchChatProject | null {
  const row = getDb().prepare('SELECT * FROM research_chat_projects WHERE id=?').get(id) as ProjectRow | undefined;
  return row ? decode(row) : null;
}

export function createChatProject(input: { name: string; icon?: string | null; color?: string | null }): ResearchChatProject {
  const now = new Date().toISOString();
  const id = randomUUID();
  getDb().prepare('INSERT INTO research_chat_projects (id,name,icon,color,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(id, cleanName(input.name), cleanIcon(input.icon ?? 'folder'), cleanColor(input.color ?? null), now, now);
  return getChatProject(id)!;
}

export function updateChatProject(id: string, patch: { name?: string; icon?: string | null; color?: string | null }): ResearchChatProject {
  const existing = getChatProject(id);
  if (!existing) throw new Error('research_chat_project_not_found');
  const next = {
    name: 'name' in patch ? cleanName(patch.name) : existing.name,
    icon: 'icon' in patch ? cleanIcon(patch.icon) : existing.icon,
    color: 'color' in patch ? cleanColor(patch.color) : existing.color,
  };
  getDb().prepare('UPDATE research_chat_projects SET name=?, icon=?, color=?, updated_at=? WHERE id=?')
    .run(next.name, next.icon, next.color, new Date().toISOString(), id);
  return getChatProject(id)!;
}

/** Deleting a project never deletes its chats: they return to the general history. */
export function deleteChatProject(id: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('UPDATE research_chat_placements SET project_id=NULL WHERE project_id=?').run(id);
    db.prepare('DELETE FROM research_chat_placements WHERE project_id IS NULL AND pinned_at IS NULL').run();
    db.prepare('DELETE FROM research_chat_projects WHERE id=?').run(id);
  })();
}

function writePlacement(conversationId: string, projectId: string | null, pinnedAt: string | null): void {
  const db = getDb();
  if (!projectId && !pinnedAt) db.prepare('DELETE FROM research_chat_placements WHERE conversation_id=?').run(conversationId);
  else db.prepare(`INSERT INTO research_chat_placements (conversation_id,project_id,pinned_at) VALUES (?,?,?)
    ON CONFLICT(conversation_id) DO UPDATE SET project_id=excluded.project_id, pinned_at=excluded.pinned_at`).run(conversationId, projectId, pinnedAt);
}

export function placementFor(conversationId: string): { projectId: string | null; pinnedAt: string | null } {
  const row = getDb().prepare('SELECT project_id, pinned_at FROM research_chat_placements WHERE conversation_id=?').get(conversationId) as { project_id: string | null; pinned_at: string | null } | undefined;
  return { projectId: row?.project_id ?? null, pinnedAt: row?.pinned_at ?? null };
}

function assertConversation(conversationId: string): void {
  if (!getDb().prepare('SELECT 1 FROM chat_conversations WHERE id=?').get(conversationId)) throw new Error('research_chat_conversation_not_found');
}

export function setConversationProject(conversationId: string, projectId: string | null): void {
  assertConversation(conversationId);
  if (projectId && !getChatProject(projectId)) throw new Error('research_chat_project_not_found');
  writePlacement(conversationId, projectId, placementFor(conversationId).pinnedAt);
}

/** At most RESEARCH_CHAT_PIN_LIMIT conversations are pinned; a sixth is refused, not rotated. */
export function setConversationPinned(conversationId: string, pinned: boolean): void {
  assertConversation(conversationId);
  const db = getDb();
  db.transaction(() => {
    const current = placementFor(conversationId);
    if (pinned && current.pinnedAt) return;
    if (pinned) {
      const { n } = db.prepare(`SELECT COUNT(*) n FROM research_chat_placements p JOIN chat_conversations c ON c.id=p.conversation_id
        WHERE p.pinned_at IS NOT NULL AND c.archived=0`).get() as { n: number };
      if (n >= RESEARCH_CHAT_PIN_LIMIT) throw new Error('research_chat_pin_limit');
    }
    writePlacement(conversationId, current.projectId, pinned ? new Date().toISOString() : null);
  })();
}

export function deleteConversationPlacement(conversationId: string): void {
  getDb().prepare('DELETE FROM research_chat_placements WHERE conversation_id=?').run(conversationId);
}
