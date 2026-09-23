import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import { validateRetrievalSettings, type ResearchNotebook, type ResearchNotebookInput, type ResolvedResearchScope } from '@shared/researchCorpus';

type NotebookRow = { id: string; name: string; description: string; revision: number; mode: 'fixed' | 'linked'; sources_json: string; exclusions_json: string; resolved_ids_json: string; settings_json: string | null; notes_json: string; conversation_settings_json: string | null; created_at: string; updated_at: string };
function decode(row: NotebookRow): ResearchNotebook {
  return { id: row.id, name: row.name, description: row.description, revision: row.revision, mode: row.mode,
    sources: JSON.parse(row.sources_json), exclusions: JSON.parse(row.exclusions_json), resolvedDocumentIds: JSON.parse(row.resolved_ids_json),
    settings: row.settings_json ? JSON.parse(row.settings_json) : undefined, noteIds: JSON.parse(row.notes_json),
    conversationSettings: row.conversation_settings_json ? JSON.parse(row.conversation_settings_json) : undefined,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
export function listResearchNotebooks(): ResearchNotebook[] {
  return (getDb().prepare('SELECT * FROM research_notebooks ORDER BY updated_at DESC, id').all() as NotebookRow[]).map(decode);
}
export function getResearchNotebook(id: string): ResearchNotebook | null {
  const row = getDb().prepare('SELECT * FROM research_notebooks WHERE id=?').get(id) as NotebookRow | undefined;
  return row ? decode(row) : null;
}

/** resolvedIds must come from the backend's authorized inventory. */
export function saveResearchNotebook(input: ResearchNotebookInput, resolvedIds: string[]): ResearchNotebook {
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 160) throw new Error('Invalid notebook name');
  if (!['fixed', 'linked'].includes(input.mode) || !Array.isArray(input.sources) || input.sources.length > 10000
    || !Array.isArray(input.exclusions) || input.exclusions.length > 10000 || input.exclusions.some(id => typeof id !== 'string')) throw new Error('Invalid notebook selection');
  for (const source of input.sources) {
    if (!source || !['work', 'library-item', 'library-collection', 'zotero-collection'].includes(source.kind)
      || typeof source.id !== 'string' || !source.id || source.id.length > 500
      || (source.kind === 'zotero-collection' && (!['user', 'group'].includes(source.libraryType ?? '') || !source.libraryId))) throw new Error('Invalid notebook source');
  }
  if ((input.description?.length ?? 0) > 10000 || input.noteIds?.some(id => typeof id !== 'string')) throw new Error('Invalid notebook metadata');
  const existing = input.id ? getResearchNotebook(input.id) : null;
  if (input.id && !existing) throw new Error('Notebook not found');
  const id = existing?.id ?? randomUUID();
  const now = new Date().toISOString();
  getDb().prepare(`INSERT INTO research_notebooks
    (id,name,description,revision,mode,sources_json,exclusions_json,resolved_ids_json,settings_json,notes_json,conversation_settings_json,created_at,updated_at)
    VALUES (@id,@name,@description,@revision,@mode,@sources,@exclusions,@resolved,@settings,@notes,@conversation,@created,@now)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,revision=excluded.revision,mode=excluded.mode,
    sources_json=excluded.sources_json,exclusions_json=excluded.exclusions_json,resolved_ids_json=excluded.resolved_ids_json,
    settings_json=excluded.settings_json,notes_json=excluded.notes_json,conversation_settings_json=excluded.conversation_settings_json,updated_at=excluded.updated_at`).run({
    id, name: input.name.trim(), description: input.description ?? '', revision: (existing?.revision ?? 0) + 1, mode: input.mode,
    sources: JSON.stringify(input.sources), exclusions: JSON.stringify([...new Set(input.exclusions)]), resolved: JSON.stringify([...new Set(resolvedIds)].sort()),
    settings: input.settings ? JSON.stringify(validateRetrievalSettings(input.settings)) : null, notes: JSON.stringify(input.noteIds ?? []),
    conversation: input.conversationSettings ? JSON.stringify(input.conversationSettings) : null, created: existing?.createdAt ?? now, now,
  });
  return getResearchNotebook(id)!;
}
export function deleteResearchNotebook(id: string): void {
  // Only the association is cascaded. Conversations, messages, works and indexes survive.
  const db = getDb();
  db.transaction(() => {
    db.prepare(`UPDATE chat_conversations SET selection_json=json_remove(selection_json,'$.notebookId')
      WHERE json_valid(selection_json) AND json_extract(selection_json,'$.notebookId')=?`).run(id);
    db.prepare('DELETE FROM research_notebooks WHERE id=?').run(id);
  })();
}
export function associateNotebookConversation(notebookId: string | null, conversationId: string): void {
  const db = getDb();
  if (!notebookId) { db.prepare('DELETE FROM research_notebook_conversations WHERE conversation_id=?').run(conversationId); return; }
  db.prepare(`INSERT INTO research_notebook_conversations(conversation_id,notebook_id) VALUES (?,?)
    ON CONFLICT(conversation_id) DO UPDATE SET notebook_id=excluded.notebook_id`).run(conversationId, notebookId);
}
export function notebookForConversation(conversationId: string): string | null {
  return (getDb().prepare('SELECT notebook_id FROM research_notebook_conversations WHERE conversation_id=?').get(conversationId) as { notebook_id: string } | undefined)?.notebook_id ?? null;
}
export function recordResearchScope(scope: ResolvedResearchScope): void {
  getDb().prepare('INSERT OR IGNORE INTO research_run_scopes(id,notebook_id,scope_json,created_at) VALUES (?,?,?,?)')
    .run(scope.id, scope.notebookId, JSON.stringify(scope), scope.resolvedAt);
}
