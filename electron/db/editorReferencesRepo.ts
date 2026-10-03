import { editorReferenceCatalog } from '@shared/editorReferences';
import { getDb } from './database';
import { getSettings } from './settingsRepo';
import { manualIdeaVisible } from './manualIdeaVisibility';

export function listEditorReferences(options?:{includePassages?:boolean;search?:string}) {
  const db = getDb();
  const rows = (sql: string) => db.prepare(sql).all() as Array<Record<string, unknown>>;
  // No text documents, blobs or embeddings cross IPC. Use the same visibility
  // predicate as Ideas; the active database provides the vault boundary.
  return editorReferenceCatalog({
    ideas: rows(`SELECT global_id, label, substr(statement,1,180) AS statement FROM ideas WHERE orphaned_at IS NULL ${getSettings().academicMode === 'manual' ? `AND ${manualIdeaVisible('ideas.global_id')}` : ''}`),
    authors: rows('SELECT author_id, name, affiliation FROM authors'),
    passages: options?.includePassages?db.prepare('SELECT p.passage_id, substr(p.text,1,160) AS text, p.page_label, p.page_number FROM passages p JOIN works w ON w.nodus_id=p.nodus_id WHERE w.archived=0 AND p.text LIKE ? LIMIT 50').all('%'+String(options.search??'').slice(0,200)+'%') as Array<Record<string,unknown>>:[],
    works: rows('SELECT nodus_id, title, year, item_type, authors_json, creators_json, doi FROM works WHERE archived = 0'),
    notes: rows('SELECT id, title, source_json FROM notes WHERE trashed_at IS NULL'),
    study_docs: rows('SELECT id, title, substr(description,1,180) AS description FROM study_docs WHERE deleted_at IS NULL AND archived_at IS NULL'),
    study_materials: rows('SELECT id, title, substr(description,1,180) AS description FROM study_materials WHERE deleted_at IS NULL AND archived_at IS NULL'),
  });
}
