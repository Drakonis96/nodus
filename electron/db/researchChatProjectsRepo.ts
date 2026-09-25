import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import { cleanAppearanceColor, cleanAppearanceIcon } from './chatAppearance';
import { RESEARCH_CHAT_PIN_LIMIT, type ResearchChatProject, type ResearchChatProjectFolder } from '@shared/types';

type ProjectRow = { id: string; name: string; icon: string | null; color: string | null; created_at: string; updated_at: string };
const decode = (row: ProjectRow): ResearchChatProject => ({ id: row.id, name: row.name, icon: row.icon, color: row.color, createdAt: row.created_at, updatedAt: row.updated_at });

const cleanName = (name: unknown): string => {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) throw new Error('research_chat_project_invalid_name');
  return name.trim();
};
const cleanIcon = cleanAppearanceIcon;
const cleanColor = cleanAppearanceColor;

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

/** Deleting a project never deletes its chats: they return to the general history. Its
 * folders go with it. */
export function deleteChatProject(id: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('UPDATE research_chat_placements SET project_id=NULL, folder_id=NULL WHERE project_id=?').run(id);
    db.prepare('DELETE FROM research_chat_placements WHERE project_id IS NULL AND pinned_at IS NULL').run();
    db.prepare('DELETE FROM research_chat_projects WHERE id=?').run(id);
  })();
}

type FolderRow = { folder_id: string; project_id: string; parent_id: string | null; name: string; position: number; created_at: string };
const decodeFolder = (row: FolderRow): ResearchChatProjectFolder => ({
  id: row.folder_id, projectId: row.project_id, parentId: row.parent_id, name: row.name, position: row.position, createdAt: row.created_at,
});
const cleanFolderName = (name: unknown): string => {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) throw new Error('research_chat_folder_invalid_name');
  return name.trim();
};

/** Every folder of every project, siblings in their order. */
export function listChatProjectFolders(): ResearchChatProjectFolder[] {
  return (getDb().prepare('SELECT * FROM research_chat_project_folders ORDER BY project_id, parent_id, position, created_at').all() as FolderRow[]).map(decodeFolder);
}

export function getChatProjectFolder(id: string): ResearchChatProjectFolder | null {
  const row = getDb().prepare('SELECT * FROM research_chat_project_folders WHERE folder_id=?').get(id) as FolderRow | undefined;
  return row ? decodeFolder(row) : null;
}

/** The folder and everything below it. */
function subtreeIds(id: string): string[] {
  return (getDb().prepare(`WITH RECURSIVE subtree(id) AS (
      SELECT folder_id FROM research_chat_project_folders WHERE folder_id=?
      UNION SELECT f.folder_id FROM research_chat_project_folders f JOIN subtree s ON f.parent_id=s.id
    ) SELECT id FROM subtree`).all(id) as { id: string }[]).map(row => row.id);
}

/** A parent must exist and sit in the same project; null is the project's root. */
function assertParent(projectId: string, parentId: string | null): void {
  if (!parentId) return;
  const parent = getChatProjectFolder(parentId);
  if (!parent) throw new Error('research_chat_folder_not_found');
  if (parent.projectId !== projectId) throw new Error('research_chat_folder_wrong_project');
}

/** Renumber a folder's siblings 0..n-1, placing `moving` at `index` (the end when omitted). */
function reorderSiblings(projectId: string, parentId: string | null, moving: string | null, index?: number): void {
  const db = getDb();
  const siblings = (db.prepare(`SELECT folder_id FROM research_chat_project_folders WHERE project_id=? AND parent_id IS ? AND folder_id IS NOT ?
    ORDER BY position, created_at`).all(projectId, parentId, moving) as { folder_id: string }[]).map(row => row.folder_id);
  if (moving) siblings.splice(Math.max(0, Math.min(index ?? siblings.length, siblings.length)), 0, moving);
  const write = db.prepare('UPDATE research_chat_project_folders SET parent_id=?, position=? WHERE folder_id=?');
  siblings.forEach((id, position) => write.run(parentId, position, id));
}

export function createChatProjectFolder(input: { projectId: string; parentId?: string | null; name: string }): ResearchChatProjectFolder {
  const db = getDb();
  if (!getChatProject(input.projectId)) throw new Error('research_chat_project_not_found');
  const parentId = input.parentId ?? null;
  const name = cleanFolderName(input.name);
  const id = randomUUID();
  db.transaction(() => {
    assertParent(input.projectId, parentId);
    const { n } = db.prepare('SELECT COUNT(*) n FROM research_chat_project_folders WHERE project_id=? AND parent_id IS ?').get(input.projectId, parentId) as { n: number };
    db.prepare('INSERT INTO research_chat_project_folders (folder_id,project_id,parent_id,name,position,created_at) VALUES (?,?,?,?,?,?)')
      .run(id, input.projectId, parentId, name, n, new Date().toISOString());
  })();
  return getChatProjectFolder(id)!;
}

export function renameChatProjectFolder(id: string, name: string): ResearchChatProjectFolder {
  if (!getChatProjectFolder(id)) throw new Error('research_chat_folder_not_found');
  getDb().prepare('UPDATE research_chat_project_folders SET name=? WHERE folder_id=?').run(cleanFolderName(name), id);
  return getChatProjectFolder(id)!;
}

/**
 * Nest a folder under another of the same project (null: the project's root) at `index`
 * among its new siblings. A folder never moves into its own subtree.
 */
export function moveChatProjectFolder(id: string, parentId: string | null, index?: number): ResearchChatProjectFolder {
  const db = getDb();
  db.transaction(() => {
    const folder = getChatProjectFolder(id);
    if (!folder) throw new Error('research_chat_folder_not_found');
    assertParent(folder.projectId, parentId);
    if (parentId && subtreeIds(id).includes(parentId)) throw new Error('research_chat_folder_cycle');
    const leaving = folder.parentId !== parentId;
    reorderSiblings(folder.projectId, parentId, id, index);
    if (leaving) reorderSiblings(folder.projectId, folder.parentId, null);
  })();
  return getChatProjectFolder(id)!;
}

/**
 * Delete a folder and its subfolders. Their chats are never deleted: they stay in the
 * project, outside any folder.
 */
export function deleteChatProjectFolder(id: string): void {
  const db = getDb();
  db.transaction(() => {
    const folder = getChatProjectFolder(id);
    if (!folder) return;
    const ids = subtreeIds(id);
    const unfile = db.prepare('UPDATE research_chat_placements SET folder_id=NULL WHERE folder_id=?');
    for (const folderId of ids) unfile.run(folderId);
    db.prepare('DELETE FROM research_chat_project_folders WHERE folder_id=?').run(id);
    reorderSiblings(folder.projectId, folder.parentId, null);
  })();
}

type Placement = { projectId: string | null; folderId: string | null; pinnedAt: string | null };

/** The one writer of a placement. A folder only ever sits in its own project. */
function writePlacement(conversationId: string, placement: Placement): void {
  const db = getDb();
  const { projectId, pinnedAt } = placement;
  const folderId = projectId ? placement.folderId : null;
  if (folderId && getChatProjectFolder(folderId)?.projectId !== projectId) throw new Error('research_chat_folder_wrong_project');
  if (!projectId && !pinnedAt) db.prepare('DELETE FROM research_chat_placements WHERE conversation_id=?').run(conversationId);
  else db.prepare(`INSERT INTO research_chat_placements (conversation_id,project_id,folder_id,pinned_at) VALUES (?,?,?,?)
    ON CONFLICT(conversation_id) DO UPDATE SET project_id=excluded.project_id, folder_id=excluded.folder_id, pinned_at=excluded.pinned_at`).run(conversationId, projectId, folderId, pinnedAt);
}

export function placementFor(conversationId: string): Placement {
  const row = getDb().prepare('SELECT project_id, folder_id, pinned_at FROM research_chat_placements WHERE conversation_id=?').get(conversationId) as { project_id: string | null; folder_id: string | null; pinned_at: string | null } | undefined;
  return { projectId: row?.project_id ?? null, folderId: row?.folder_id ?? null, pinnedAt: row?.pinned_at ?? null };
}

function assertConversation(conversationId: string): void {
  if (!getDb().prepare('SELECT 1 FROM chat_conversations WHERE id=?').get(conversationId)) throw new Error('research_chat_conversation_not_found');
}

/** Moving a chat to another project (or out of projects) takes it out of its folder. */
export function setConversationProject(conversationId: string, projectId: string | null): void {
  assertConversation(conversationId);
  if (projectId && !getChatProject(projectId)) throw new Error('research_chat_project_not_found');
  const current = placementFor(conversationId);
  writePlacement(conversationId, { ...current, projectId, folderId: current.projectId === projectId ? current.folderId : null });
}

/** File a chat in a folder, which also puts it in the folder's project; null unfiles it
 * and leaves it in its project. */
export function setConversationFolder(conversationId: string, folderId: string | null): void {
  assertConversation(conversationId);
  const current = placementFor(conversationId);
  if (!folderId) { writePlacement(conversationId, { ...current, folderId: null }); return; }
  const folder = getChatProjectFolder(folderId);
  if (!folder) throw new Error('research_chat_folder_not_found');
  writePlacement(conversationId, { ...current, projectId: folder.projectId, folderId });
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
    writePlacement(conversationId, { ...current, pinnedAt: pinned ? new Date().toISOString() : null });
  })();
}

export function deleteConversationPlacement(conversationId: string): void {
  getDb().prepare('DELETE FROM research_chat_placements WHERE conversation_id=?').run(conversationId);
}
