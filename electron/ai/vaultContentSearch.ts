import { literalRelevance, mergeHybridResults, searchSnippet } from '@shared/hybridSearch';
import type { VaultContentHit, VaultContentSearchResponse } from '@shared/hybridSearch';
import { getDb } from '../db/database';
import { listDatabases } from '../db/databasesRepo';
import { searchProsopography } from '../db/prosopSearchRepo';
import { entryIndexableProse, listWorldEntries } from '../db/worldEncyclopediaRepo';
import { getActiveVault } from '../vaults/vaultRegistry';
import { searchHybridCorpus } from './hybridCorpusSearch';

export async function searchVaultContent(query: string, kinds?: string[], semantic = true, requestedLimit = 80): Promise<VaultContentSearchResponse> {
  if (query.trim().length < 2 || kinds?.length === 0) return { results: [], semanticAvailable: true };
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.floor(requestedLimit)) : 80;
  const type = getActiveVault().type;
  let candidates: VaultContentHit[] = [];
  if (type === 'databases') {
    candidates = kinds && !kinds.includes('database') ? [] : listDatabases().map((db) => ({ kind: 'database', id: db.id, title: db.name, subtitle: db.shortId, databaseId: db.id }));
    if (!kinds || kinds.includes('row')) {
      const rows = getDb().prepare(`SELECT f.row_id AS id, f.database_id AS databaseId, d.name AS databaseName,
      COALESCE(tc.value_text, '') AS title, group_concat(f.content, char(10)) AS content
      FROM db_search_fts f JOIN db_databases d ON d.id=f.database_id
      LEFT JOIN db_columns c ON c.database_id=f.database_id AND c.type='title'
      LEFT JOIN db_cells tc ON tc.row_id=f.row_id AND tc.column_id=c.id AND tc.database_id=f.database_id
      WHERE f.row_id IS NOT NULL GROUP BY f.database_id, f.row_id`).all() as Array<{ id: string; databaseId: string; databaseName: string; title: string; content: string }>;
      candidates.push(...rows.map((row) => ({ kind: 'row', id: row.id, title: row.title || row.databaseName, subtitle: row.databaseName, snippet: row.content, databaseId: row.databaseId })));
    }
  } else if (type === 'prosopography') {
    // Local visibility does not authorize sending restricted sources or sensitive profiles to an embedding provider.
    const db = getDb();
    const sources = new Map((db.prepare('SELECT source_id, access_status FROM prosop_sources').all() as Array<{ source_id: string; access_status: string }>).map((row) => [row.source_id, row.access_status]));
    const persons = new Map((db.prepare('SELECT person_id, privacy_status FROM prosop_person_profiles').all() as Array<{ person_id: string; privacy_status: string }>).map((row) => [row.person_id, row.privacy_status]));
    const sensitiveStatements = new Set((db.prepare("SELECT s.statement_id FROM prosop_statements s JOIN prosop_variable_revisions v ON v.revision_id=s.variable_revision_id WHERE v.sensitivity!='ordinary'").all() as Array<{ statement_id: string }>).map((row) => row.statement_id));
    candidates = searchProsopography('', undefined, true).map((hit) => ({ ...hit, snippet: hit.subtitle,
      semanticAllowed: (!hit.sourceId || sources.get(hit.sourceId) === 'open')
        && (!hit.personId || persons.get(hit.personId) === 'ordinary')
        && (hit.kind !== 'statement' || !sensitiveStatements.has(hit.id)),
    }));
  } else if (type === 'worldbuilding') {
    candidates = listWorldEntries().filter((entry) => !kinds || kinds.includes(entry.kind)).map((entry) => ({
      kind: entry.kind, id: entry.id, title: entry.title, subtitle: entry.aliases.join(' · '),
      snippet: [entry.summary, ...entryIndexableProse(entry).map((field) => field.text)].filter(Boolean).join('\n'),
    }));
  }
  const selected = kinds ? new Set(kinds) : undefined;
  const response = semantic ? await searchHybridCorpus(query, candidates, selected, limit + 1) : {
    results: mergeHybridResults(query, candidates.filter((hit) => literalRelevance(query, hit) > 0), [], selected, limit + 1), semanticAvailable: true,
  };
  return { ...response, hasMore: response.results.length > limit, results: response.results.slice(0, limit).map((hit) => ({ ...hit, snippet: searchSnippet(hit.snippet, query) })) };
}
