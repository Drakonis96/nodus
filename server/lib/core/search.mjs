// Lexical search over a published snapshot.
//
// Extracted from the `nodus_search` MCP tool so the REST surface and the MCP surface
// cannot answer the same query differently — and now called by both, which the extraction
// alone did not achieve: the MCP tool kept its own copy of the loop beside this one until
// a fix landed here and not there. The table list below is the contract; adding a table
// adds it to both surfaces at once.

import { rows } from './snapshot.mjs';

/**
 * Table, the column that names one of its rows, and the text searched in it.
 *
 * The key column is declared here because most of these tables do not have one called
 * `id`: SQLite gives each its own — `theme_id`, `person_id`, `scene_id`. Guessing at
 * `id ?? nodus_id ?? global_id ?? passage_id` instead produced two failures. A theme, a
 * character or a scene has none of those, so `id` came out `undefined`, `JSON.stringify`
 * dropped the key, and the hit reached the client with no id at all — the mobile decoder
 * refuses the whole response, so one theme label matching the query broke the entire
 * Search tab. And a passage does have `nodus_id`, but it is the id of the WORK the
 * passage was cut from: every passage hit was labelled with its source work instead of
 * itself, which is worse than missing, because it looks like an answer.
 */
export const SEARCH_FIELDS = [
  ['works', 'nodus_id', ['title', 'abstract', 'citation']],
  ['ideas', 'global_id', ['label', 'statement']],
  ['themes', 'theme_id', ['label', 'description']],
  ['gaps', 'id', ['text', 'description']],
  ['notes', 'id', ['title', 'content']],
  ['passages', 'passage_id', ['text']],
  ['persons', 'person_id', ['display_name', 'notes', 'biography']],
  ['character_profiles', 'person_id', ['species', 'gender', 'pronouns', 'appearance', 'personality', 'backstory']],
  ['places', 'place_id', ['name', 'kind', 'notes']],
  ['place_profiles', 'place_id', ['appearance', 'atmosphere', 'history']],
  ['world_groups', 'group_id', ['name', 'summary', 'description', 'notes']],
  ['world_scenes', 'scene_id', ['title', 'summary', 'notes']],
  ['world_scene_text', 'scene_id', ['text']],
  ['world_articles', 'article_id', ['title', 'summary', 'body', 'aka', 'notes']],
  ['world_threads', 'thread_id', ['title', 'pitch', 'stakes', 'outcome']],
  ['world_rules', 'rule_id', ['title', 'statement', 'cost', 'limits']],
  ['world_questions', 'question_id', ['question']],
  ['world_secrets', 'secret_id', ['title', 'content', 'notes']],
];

const EXCERPT_CHARS = 600;

/**
 * The id a hit carries: the table's declared key, or one of the generic keys if a
 * snapshot published by an older desktop is missing it. Always a non-empty string —
 * clients type this field as a plain string, so a number or a `null` fails to decode
 * just as loudly as an absent key.
 */
function hitId(row, key) {
  for (const candidate of [key, 'id', 'nodus_id', 'global_id', 'passage_id']) {
    const value = row[candidate];
    if (typeof value === 'string' && value !== '') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function lexicalSearch(snapshot, query, limit = 20) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return [];
  const results = [];
  for (const [table, key, fields] of SEARCH_FIELDS) {
    for (const row of rows(snapshot, table)) {
      const text = fields.map((field) => row[field]).filter((value) => typeof value === 'string').join('\n');
      if (text.toLowerCase().includes(needle)) {
        // A row nothing can name is dropped rather than served: an unnameable hit is one
        // the reader cannot open anyway, and emitting it costs them every other hit too.
        const id = hitId(row, key);
        if (id !== null) {
          results.push({
            type: table,
            id,
            title: row.title ?? row.label ?? text.slice(0, 120),
            excerpt: text.slice(0, EXCERPT_CHARS),
          });
        }
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
