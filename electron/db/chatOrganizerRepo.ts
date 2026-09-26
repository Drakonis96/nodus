import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import { cleanAppearanceColor, cleanAppearanceIcon } from './chatAppearance';
import type { ChatHistoryTables } from './chatHistoryTables';
import { RESEARCH_CHAT_PIN_LIMIT, type ChatHistoryNotebook, type ResearchChatProject, type ResearchChatProjectFolder } from '@shared/types';

/*
 * Projects, the folders nested inside them, pins and (where a surface keeps its own)
 * notebooks, for every chat history stored in the vault's database. One implementation,
 * handed the tables of one surface, so Research Chat, Databases and Worldbuilding follow
 * the same rules and refuse with the same error codes:
 *   · a project is flat; its folders nest, and a folder never moves into its own subtree;
 *   · a chat's folder always belongs to the chat's project: filing a chat in a folder puts
 *     it in that folder's project, and moving it to another project clears its folder;
 *   · deleting a folder takes its subfolders and unfiles their chats, deleting a project
 *     takes its folders and returns its chats to the general history, deleting a notebook
 *     returns its chats too: none of them ever deletes a conversation;
 *   · creating a folder moves nothing into it;
 *   · at most RESEARCH_CHAT_PIN_LIMIT unarchived chats are pinned; one more is refused.
 * The table names come from the fixed descriptors in chatHistoryTables.ts, never from input.
 */

type ProjectRow = { id: string; name: string; icon: string | null; color: string | null; created_at: string; updated_at: string };
type FolderRow = { folder_id: string; project_id: string; parent_id: string | null; name: string; position: number; created_at: string; updated_at: string | null };
type NotebookRow = { id: string; name: string; icon: string | null; color: string | null; selection_json: string; created_at: string; updated_at: string };

export type ChatPlacement = { projectId: string | null; folderId: string | null; pinnedAt: string | null; notebookId: string | null };

const decodeProject = (row: ProjectRow): ResearchChatProject => ({ id: row.id, name: row.name, icon: row.icon, color: row.color, createdAt: row.created_at, updatedAt: row.updated_at });
const decodeFolder = (row: FolderRow): ResearchChatProjectFolder => ({
  id: row.folder_id, projectId: row.project_id, parentId: row.parent_id, name: row.name, position: row.position, createdAt: row.created_at,
});
function parseSelection(value: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { return {}; }
}
const decodeNotebook = (row: NotebookRow): ChatHistoryNotebook => ({
  id: row.id, name: row.name, icon: row.icon, color: row.color, selection: parseSelection(row.selection_json), createdAt: row.created_at, updatedAt: row.updated_at,
});

const cleanName = (name: unknown, code: string): string => {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) throw new Error(code);
  return name.trim();
};
/** What a notebook reads, as the surface describes it: a small JSON object. */
const cleanSelection = (selection: unknown): string => {
  const json = JSON.stringify(selection ?? {});
  if (!selection || typeof selection !== 'object' || Array.isArray(selection) || json.length > 200_000) throw new Error('research_chat_notebook_invalid_selection');
  return json;
};
const byName = <T extends { name: string; id: string }>(a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id);

export function createChatOrganizer(tables: ChatHistoryTables) {
  const { conversations, projects, folders, placements, notebooks } = tables;
  const now = () => new Date().toISOString();

  /** Projects in alphabetical order, the way the history lists them. */
  function listChatProjects(): ResearchChatProject[] {
    return (getDb().prepare(`SELECT * FROM ${projects}`).all() as ProjectRow[]).map(decodeProject).sort(byName);
  }

  function getChatProject(id: string): ResearchChatProject | null {
    const row = getDb().prepare(`SELECT * FROM ${projects} WHERE id=?`).get(id) as ProjectRow | undefined;
    return row ? decodeProject(row) : null;
  }

  function createChatProject(input: { name: string; icon?: string | null; color?: string | null }): ResearchChatProject {
    const stamp = now();
    const id = randomUUID();
    getDb().prepare(`INSERT INTO ${projects} (id,name,icon,color,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .run(id, cleanName(input.name, 'research_chat_project_invalid_name'), cleanAppearanceIcon(input.icon ?? 'folder'), cleanAppearanceColor(input.color ?? null), stamp, stamp);
    return getChatProject(id)!;
  }

  function updateChatProject(id: string, patch: { name?: string; icon?: string | null; color?: string | null }): ResearchChatProject {
    const existing = getChatProject(id);
    if (!existing) throw new Error('research_chat_project_not_found');
    const next = {
      name: 'name' in patch ? cleanName(patch.name, 'research_chat_project_invalid_name') : existing.name,
      icon: 'icon' in patch ? cleanAppearanceIcon(patch.icon) : existing.icon,
      color: 'color' in patch ? cleanAppearanceColor(patch.color) : existing.color,
    };
    getDb().prepare(`UPDATE ${projects} SET name=?, icon=?, color=?, updated_at=? WHERE id=?`).run(next.name, next.icon, next.color, now(), id);
    return getChatProject(id)!;
  }

  /** Deleting a project never deletes its chats: they return to the general history. Its
   * folders go with it. */
  function deleteChatProject(id: string): void {
    const db = getDb();
    db.transaction(() => {
      db.prepare(`UPDATE ${placements} SET project_id=NULL, folder_id=NULL, updated_at=? WHERE project_id=?`).run(now(), id);
      dropEmptyPlacements();
      db.prepare(`DELETE FROM ${projects} WHERE id=?`).run(id);
    })();
  }

  /** Every folder of every project, siblings in their order. */
  function listChatProjectFolders(): ResearchChatProjectFolder[] {
    return (getDb().prepare(`SELECT * FROM ${folders} ORDER BY project_id, parent_id, position, created_at`).all() as FolderRow[]).map(decodeFolder);
  }

  function getChatProjectFolder(id: string): ResearchChatProjectFolder | null {
    const row = getDb().prepare(`SELECT * FROM ${folders} WHERE folder_id=?`).get(id) as FolderRow | undefined;
    return row ? decodeFolder(row) : null;
  }

  /** The folder and everything below it. */
  function subtreeIds(id: string): string[] {
    return (getDb().prepare(`WITH RECURSIVE subtree(id) AS (
        SELECT folder_id FROM ${folders} WHERE folder_id=?
        UNION SELECT f.folder_id FROM ${folders} f JOIN subtree s ON f.parent_id=s.id
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
    const siblings = (db.prepare(`SELECT folder_id FROM ${folders} WHERE project_id=? AND parent_id IS ? AND folder_id IS NOT ?
      ORDER BY position, created_at`).all(projectId, parentId, moving) as { folder_id: string }[]).map(row => row.folder_id);
    if (moving) siblings.splice(Math.max(0, Math.min(index ?? siblings.length, siblings.length)), 0, moving);
    // Only a folder whose place changed is stamped: renumbering must not make every sibling
    // look freshly edited to the next sync.
    const write = db.prepare(`UPDATE ${folders} SET parent_id=?, position=?, updated_at=? WHERE folder_id=? AND (parent_id IS NOT ? OR position IS NOT ?)`);
    const stamp = now();
    siblings.forEach((id, position) => write.run(parentId, position, stamp, id, parentId, position));
  }

  function createChatProjectFolder(input: { projectId: string; parentId?: string | null; name: string }): ResearchChatProjectFolder {
    const db = getDb();
    if (!getChatProject(input.projectId)) throw new Error('research_chat_project_not_found');
    const parentId = input.parentId ?? null;
    const name = cleanName(input.name, 'research_chat_folder_invalid_name');
    const id = randomUUID();
    db.transaction(() => {
      assertParent(input.projectId, parentId);
      const { n } = db.prepare(`SELECT COUNT(*) n FROM ${folders} WHERE project_id=? AND parent_id IS ?`).get(input.projectId, parentId) as { n: number };
      const stamp = now();
      db.prepare(`INSERT INTO ${folders} (folder_id,project_id,parent_id,name,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
        .run(id, input.projectId, parentId, name, n, stamp, stamp);
    })();
    return getChatProjectFolder(id)!;
  }

  function renameChatProjectFolder(id: string, name: string): ResearchChatProjectFolder {
    if (!getChatProjectFolder(id)) throw new Error('research_chat_folder_not_found');
    getDb().prepare(`UPDATE ${folders} SET name=?, updated_at=? WHERE folder_id=?`).run(cleanName(name, 'research_chat_folder_invalid_name'), now(), id);
    return getChatProjectFolder(id)!;
  }

  /**
   * Nest a folder under another of the same project (null: the project's root) at `index`
   * among its new siblings. A folder never moves into its own subtree.
   */
  function moveChatProjectFolder(id: string, parentId: string | null, index?: number): ResearchChatProjectFolder {
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
  function deleteChatProjectFolder(id: string): void {
    const db = getDb();
    db.transaction(() => {
      const folder = getChatProjectFolder(id);
      if (!folder) return;
      const unfile = db.prepare(`UPDATE ${placements} SET folder_id=NULL, updated_at=? WHERE folder_id=?`);
      const stamp = now();
      for (const folderId of subtreeIds(id)) unfile.run(stamp, folderId);
      db.prepare(`DELETE FROM ${folders} WHERE folder_id=?`).run(id);
      reorderSiblings(folder.projectId, folder.parentId, null);
    })();
  }

  /** A placement that places nowhere is not kept. */
  function dropEmptyPlacements(): void {
    getDb().prepare(`DELETE FROM ${placements} WHERE project_id IS NULL AND pinned_at IS NULL${notebooks ? ' AND notebook_id IS NULL' : ''}`).run();
  }

  /** The one writer of a placement. A folder only ever sits in its own project. */
  function writePlacement(conversationId: string, placement: ChatPlacement): void {
    const db = getDb();
    const { projectId, pinnedAt } = placement;
    const folderId = projectId ? placement.folderId : null;
    const notebookId = notebooks ? placement.notebookId : null;
    if (folderId && getChatProjectFolder(folderId)?.projectId !== projectId) throw new Error('research_chat_folder_wrong_project');
    if (!projectId && !pinnedAt && !notebookId) { db.prepare(`DELETE FROM ${placements} WHERE conversation_id=?`).run(conversationId); return; }
    const columns = notebooks ? 'conversation_id,project_id,folder_id,pinned_at,updated_at,notebook_id' : 'conversation_id,project_id,folder_id,pinned_at,updated_at';
    const values = [conversationId, projectId, folderId, pinnedAt, now(), ...(notebooks ? [notebookId] : [])];
    db.prepare(`INSERT INTO ${placements} (${columns}) VALUES (${values.map(() => '?').join(',')})
      ON CONFLICT(conversation_id) DO UPDATE SET project_id=excluded.project_id, folder_id=excluded.folder_id, pinned_at=excluded.pinned_at,
      updated_at=excluded.updated_at${notebooks ? ', notebook_id=excluded.notebook_id' : ''}`).run(...values);
  }

  function placementFor(conversationId: string): ChatPlacement {
    const row = getDb().prepare(`SELECT * FROM ${placements} WHERE conversation_id=?`).get(conversationId) as
      { project_id: string | null; folder_id: string | null; pinned_at: string | null; notebook_id?: string | null } | undefined;
    return { projectId: row?.project_id ?? null, folderId: row?.folder_id ?? null, pinnedAt: row?.pinned_at ?? null, notebookId: row?.notebook_id ?? null };
  }

  function assertConversation(conversationId: string): void {
    if (!getDb().prepare(`SELECT 1 FROM ${conversations} WHERE id=?`).get(conversationId)) throw new Error('research_chat_conversation_not_found');
  }

  /** Moving a chat to another project (or out of projects) takes it out of its folder. */
  function setConversationProject(conversationId: string, projectId: string | null): void {
    assertConversation(conversationId);
    if (projectId && !getChatProject(projectId)) throw new Error('research_chat_project_not_found');
    const current = placementFor(conversationId);
    writePlacement(conversationId, { ...current, projectId, folderId: current.projectId === projectId ? current.folderId : null });
  }

  /** File a chat in a folder, which also puts it in the folder's project; null unfiles it
   * and leaves it in its project. */
  function setConversationFolder(conversationId: string, folderId: string | null): void {
    assertConversation(conversationId);
    const current = placementFor(conversationId);
    if (!folderId) { writePlacement(conversationId, { ...current, folderId: null }); return; }
    const folder = getChatProjectFolder(folderId);
    if (!folder) throw new Error('research_chat_folder_not_found');
    writePlacement(conversationId, { ...current, projectId: folder.projectId, folderId });
  }

  /** At most RESEARCH_CHAT_PIN_LIMIT conversations are pinned; a sixth is refused, not rotated. */
  function setConversationPinned(conversationId: string, pinned: boolean): void {
    assertConversation(conversationId);
    const db = getDb();
    db.transaction(() => {
      const current = placementFor(conversationId);
      if (pinned && current.pinnedAt) return;
      if (pinned) {
        const { n } = db.prepare(`SELECT COUNT(*) n FROM ${placements} p JOIN ${conversations} c ON c.id=p.conversation_id
          WHERE p.pinned_at IS NOT NULL AND c.archived=0`).get() as { n: number };
        if (n >= RESEARCH_CHAT_PIN_LIMIT) throw new Error('research_chat_pin_limit');
      }
      writePlacement(conversationId, { ...current, pinnedAt: pinned ? now() : null });
    })();
  }

  /** Archiving takes a chat out of the pinned section and frees its place. */
  function setConversationArchived(conversationId: string, archived: boolean): void {
    getDb().prepare(`UPDATE ${conversations} SET archived=?, updated_at=? WHERE id=?`).run(archived ? 1 : 0, now(), conversationId);
    if (archived && placementFor(conversationId).pinnedAt) setConversationPinned(conversationId, false);
  }

  function deleteConversationPlacement(conversationId: string): void {
    getDb().prepare(`DELETE FROM ${placements} WHERE conversation_id=?`).run(conversationId);
  }

  // ── Notebooks, for a surface that keeps its own ─────────────────────────────
  function requireNotebooks(): string {
    if (!notebooks) throw new Error('research_chat_notebooks_unsupported');
    return notebooks;
  }

  function listChatNotebooks(): ChatHistoryNotebook[] {
    if (!notebooks) return [];
    return (getDb().prepare(`SELECT * FROM ${notebooks}`).all() as NotebookRow[]).map(decodeNotebook).sort(byName);
  }

  function getChatNotebook(id: string): ChatHistoryNotebook | null {
    const row = getDb().prepare(`SELECT * FROM ${requireNotebooks()} WHERE id=?`).get(id) as NotebookRow | undefined;
    return row ? decodeNotebook(row) : null;
  }

  function createChatNotebook(input: { name: string; icon?: string | null; color?: string | null; selection: unknown }): ChatHistoryNotebook {
    const table = requireNotebooks();
    const stamp = now();
    const id = randomUUID();
    getDb().prepare(`INSERT INTO ${table} (id,name,icon,color,selection_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
      .run(id, cleanName(input.name, 'research_chat_notebook_invalid_name'), cleanAppearanceIcon(input.icon ?? 'notebook'), cleanAppearanceColor(input.color ?? null), cleanSelection(input.selection), stamp, stamp);
    return getChatNotebook(id)!;
  }

  function updateChatNotebook(id: string, patch: { name?: string; icon?: string | null; color?: string | null; selection?: unknown }): ChatHistoryNotebook {
    const table = requireNotebooks();
    const existing = getChatNotebook(id);
    if (!existing) throw new Error('research_chat_notebook_not_found');
    getDb().prepare(`UPDATE ${table} SET name=?, icon=?, color=?, selection_json=?, updated_at=? WHERE id=?`).run(
      'name' in patch ? cleanName(patch.name, 'research_chat_notebook_invalid_name') : existing.name,
      'icon' in patch ? cleanAppearanceIcon(patch.icon) : existing.icon,
      'color' in patch ? cleanAppearanceColor(patch.color) : existing.color,
      'selection' in patch ? cleanSelection(patch.selection) : JSON.stringify(existing.selection),
      now(), id);
    return getChatNotebook(id)!;
  }

  /** Deleting a notebook never deletes its chats: they return to the general history. */
  function deleteChatNotebook(id: string): void {
    const table = requireNotebooks();
    const db = getDb();
    db.transaction(() => {
      db.prepare(`UPDATE ${placements} SET notebook_id=NULL, updated_at=? WHERE notebook_id=?`).run(now(), id);
      dropEmptyPlacements();
      db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
    })();
  }

  /** A notebook's chat lives in its notebook, not in a project; null takes it out. */
  function setConversationNotebook(conversationId: string, notebookId: string | null): void {
    requireNotebooks();
    assertConversation(conversationId);
    if (notebookId && !getChatNotebook(notebookId)) throw new Error('research_chat_notebook_not_found');
    const current = placementFor(conversationId);
    writePlacement(conversationId, notebookId ? { ...current, notebookId, projectId: null, folderId: null } : { ...current, notebookId: null });
  }

  return {
    listChatProjects, getChatProject, createChatProject, updateChatProject, deleteChatProject,
    listChatProjectFolders, getChatProjectFolder, createChatProjectFolder, renameChatProjectFolder, moveChatProjectFolder, deleteChatProjectFolder,
    placementFor, setConversationProject, setConversationFolder, setConversationPinned, setConversationArchived, deleteConversationPlacement,
    listChatNotebooks, getChatNotebook, createChatNotebook, updateChatNotebook, deleteChatNotebook, setConversationNotebook,
  };
}

export type ChatOrganizer = ReturnType<typeof createChatOrganizer>;
