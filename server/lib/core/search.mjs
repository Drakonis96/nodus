// Lexical search over a published snapshot.
//
// Extracted verbatim from the `nodus_search` MCP tool so the REST surface and the MCP
// surface cannot answer the same query differently. The field lists are the contract:
// adding a table here adds it to both at once.

import { rows } from './snapshot.mjs';

export const SEARCH_FIELDS = [
  ['works', ['title', 'abstract', 'citation']],
  ['ideas', ['label', 'statement']],
  ['themes', ['label', 'description']],
  ['gaps', ['text', 'description']],
  ['notes', ['title', 'content']],
  ['passages', ['text']],
  ['persons', ['display_name', 'notes', 'biography']],
  ['character_profiles', ['species', 'gender', 'pronouns', 'appearance', 'personality', 'backstory']],
  ['places', ['name', 'kind', 'notes']],
  ['place_profiles', ['appearance', 'atmosphere', 'history']],
  ['world_groups', ['name', 'summary', 'description', 'notes']],
  ['world_scenes', ['title', 'summary', 'notes']],
  ['world_scene_text', ['text']],
  ['world_articles', ['title', 'summary', 'body', 'aka', 'notes']],
  ['world_threads', ['title', 'pitch', 'stakes', 'outcome']],
  ['world_rules', ['title', 'statement', 'cost', 'limits']],
  ['world_questions', ['question']],
  ['world_secrets', ['title', 'content', 'notes']],
];

const EXCERPT_CHARS = 600;

export function lexicalSearch(snapshot, query, limit = 20) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return [];
  const results = [];
  for (const [table, fields] of SEARCH_FIELDS) {
    for (const row of rows(snapshot, table)) {
      const text = fields.map((field) => row[field]).filter((value) => typeof value === 'string').join('\n');
      if (text.toLowerCase().includes(needle)) {
        results.push({
          type: table,
          id: row.id ?? row.nodus_id ?? row.global_id ?? row.passage_id,
          title: row.title ?? row.label ?? text.slice(0, 120),
          excerpt: text.slice(0, EXCERPT_CHARS),
        });
      }
      if (results.length >= limit) return results;
    }
  }
  return results;
}

/** Case-insensitive substring match across a row's own string values. Used by list filters. */
export function matchesRow(row, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return true;
  for (const value of Object.values(row ?? {})) {
    if (typeof value === 'string' && value.toLowerCase().includes(needle)) return true;
  }
  return false;
}
