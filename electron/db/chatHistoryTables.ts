import type Database from 'better-sqlite3';

/*
 * The tables behind each chat history that keeps projects, folders and pins in the vault's
 * database, and the repair pass that keeps their references sound.
 *
 * A placement row says where one conversation sits: a project, a folder of that project,
 * pinned or not. Folders reach the placements through a foreign key (ON DELETE SET NULL),
 * but two things are outside what a key can guarantee: that a folder belongs to the SAME
 * project as the placement that names it, and that a reference still resolves after a
 * sync merge, which defers keys until it commits and may bring a placement written on a
 * device that had not yet heard a folder was deleted. The repair pass settles both, on
 * every open of the database and after every merge, so a conversation always shows: at
 * worst in its project with no folder, or in the general history.
 */

export interface ChatHistoryTables {
  /** The chat surface these tables belong to. */
  surface: 'research' | 'database' | 'world';
  conversations: string;
  projects: string;
  folders: string;
  placements: string;
  /** A surface that keeps notebooks of its own in this database (Research Chat's live in
   * the research corpus instead). Its placements then carry notebook_id. */
  notebooks?: string;
}

export const RESEARCH_CHAT_TABLES: ChatHistoryTables = {
  surface: 'research',
  conversations: 'chat_conversations',
  projects: 'research_chat_projects',
  folders: 'research_chat_project_folders',
  placements: 'research_chat_placements',
};

export const DATABASE_CHAT_TABLES: ChatHistoryTables = {
  surface: 'database',
  conversations: 'database_chat_conversations',
  projects: 'database_chat_projects',
  folders: 'database_chat_project_folders',
  placements: 'database_chat_placements',
  notebooks: 'database_chat_notebooks',
};

export const WORLD_CHAT_TABLES: ChatHistoryTables = {
  surface: 'world',
  conversations: 'world_chat_conversations',
  projects: 'world_chat_projects',
  folders: 'world_chat_project_folders',
  placements: 'world_chat_placements',
  notebooks: 'world_chat_notebooks',
};

/** Every table-backed chat history. The study history lives in a JSON file and repairs itself on read. */
export const CHAT_HISTORY_TABLES: readonly ChatHistoryTables[] = [RESEARCH_CHAT_TABLES, DATABASE_CHAT_TABLES, WORLD_CHAT_TABLES];

export interface ChatPlacementRepair {
  /** Placements whose folder did not exist or sat in another project: now unfiled. */
  folders: number;
  /** Placements whose project (or notebook) did not exist: back in the general history. */
  projects: number;
  /** Placements of conversations that no longer exist, or that were left empty. */
  removed: number;
}

function hasTable(db: Database.Database, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

/**
 * Clear every reference a placement cannot keep. Never deletes a conversation, a project
 * or a folder: it only takes a chat out of a folder or a project that cannot hold it.
 * Each repaired row is stamped now, so the repair itself travels on the next sync and the
 * devices converge on it instead of arguing over the dangling value.
 */
export function repairChatPlacements(db: Database.Database, tables: ChatHistoryTables, now = new Date().toISOString()): ChatPlacementRepair {
  const { conversations, projects, folders, placements, notebooks } = tables;
  if (![conversations, projects, folders, placements, ...(notebooks ? [notebooks] : [])].every((name) => hasTable(db, name))) return { folders: 0, projects: 0, removed: 0 };
  const repair = db.transaction((): ChatPlacementRepair => {
    // A project that is gone takes nothing with it: the chat returns to the general history.
    const projectsFixed = db.prepare(`UPDATE ${placements} SET project_id = NULL, folder_id = NULL, updated_at = ?
      WHERE project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${projects} p WHERE p.id = ${placements}.project_id)`).run(now).changes;
    // A folder must exist and belong to the placement's own project; otherwise the chat is
    // unfiled and stays in its project.
    const foldersFixed = db.prepare(`UPDATE ${placements} SET folder_id = NULL, updated_at = ?
      WHERE folder_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM ${folders} f WHERE f.folder_id = ${placements}.folder_id AND f.project_id IS ${placements}.project_id)`).run(now).changes;
    // A notebook that is gone returns its chat to the general history, like a project.
    const notebooksFixed = notebooks ? db.prepare(`UPDATE ${placements} SET notebook_id = NULL, updated_at = ?
      WHERE notebook_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${notebooks} n WHERE n.id = ${placements}.notebook_id)`).run(now).changes : 0;
    // A deleted conversation keeps no placement, and a placement that places nowhere is not kept.
    const orphans = db.prepare(`DELETE FROM ${placements} WHERE NOT EXISTS (SELECT 1 FROM ${conversations} c WHERE c.id = ${placements}.conversation_id)`).run().changes;
    const empty = db.prepare(`DELETE FROM ${placements} WHERE project_id IS NULL AND folder_id IS NULL AND pinned_at IS NULL${notebooks ? ' AND notebook_id IS NULL' : ''}`).run().changes;
    return { folders: foldersFixed, projects: projectsFixed + notebooksFixed, removed: orphans + empty };
  });
  return repair();
}

/** The repair pass over every table-backed chat history of a database. */
export function repairAllChatPlacements(db: Database.Database, now = new Date().toISOString()): ChatPlacementRepair {
  const total: ChatPlacementRepair = { folders: 0, projects: 0, removed: 0 };
  for (const tables of CHAT_HISTORY_TABLES) {
    const result = repairChatPlacements(db, tables, now);
    total.folders += result.folders;
    total.projects += result.projects;
    total.removed += result.removed;
  }
  return total;
}
