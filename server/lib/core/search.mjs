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
  ['authors', 'author_id', ['name', 'first_name', 'last_name', 'affiliation']],
  ['ideas', 'global_id', ['label', 'statement']],
  ['themes', 'theme_id', ['label', 'description']],
  ['gaps', 'id', ['text', 'description']],
  ['notes', 'id', ['title', 'content']],
  ['passages', 'passage_id', ['text']],
  ['document_profile_versions', 'version_id', ['overview', 'profile_json']],
  ['document_profile_fields', 'field_id', ['text']],
  ['document_sections', 'section_id', ['title', 'summary', 'concepts_json', 'claims_json']],
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
  // Study and teaching. These tables are published independently of the academic
  // corpus; keeping them here makes the global search contract useful when the
  // active vault is a study or classroom vault rather than silently returning 0.
  ['study_courses', 'id', ['name', 'description', 'code', 'notes']],
  ['study_subjects', 'id', ['name', 'description', 'code', 'notes']],
  ['study_topics', 'id', ['name', 'title', 'description', 'notes']],
  ['study_docs', 'id', ['title', 'summary', 'content', 'notes']],
  ['study_materials', 'id', ['title', 'description', 'summary', 'text']],
  ['study_flashcards', 'id', ['front', 'back', 'question', 'answer', 'notes']],
  ['study_questions', 'id', ['prompt', 'question', 'answer', 'explanation', 'notes']],
  ['study_ideas', 'id', ['label', 'statement', 'type']],
  ['study_plans', 'id', ['name', 'title', 'description', 'notes']],
  ['study_goals', 'id', ['name', 'title', 'description', 'notes']],
  ['study_calendar_events', 'id', ['title', 'description', 'notes']],
  ['teaching_exams', 'id', ['title', 'name', 'description', 'instructions']],
  ['teaching_exam_questions', 'id', ['prompt', 'question', 'answer', 'explanation']],
  ['teaching_rubrics', 'id', ['title', 'name', 'description', 'criteria']],
  // Primary-source and oral-history vaults.
  ['archive_items', 'item_id', ['title', 'description', 'date_display', 'date', 'notes', 'text']],
  ['archive_repositories', 'repository_id', ['name', 'title', 'description', 'location', 'access_notes']],
  ['archive_description_units', 'unit_id', ['title', 'description', 'scope', 'scope_content', 'notes']],
  ['archive_excerpts', 'excerpt_id', ['title', 'text', 'quoted_text', 'quote', 'notes']],
  ['archive_source_analyses', 'analysis_id', ['title', 'summary', 'analysis', 'origin_notes', 'notes']],
  ['testimony_interviews', 'id', ['title', 'abstract', 'summary', 'description', 'conducted_at', 'date', 'location_text', 'location']],
  ['testimony_transcripts', 'id', ['title', 'content_markdown', 'text', 'summary', 'language']],
  ['testimony_codes', 'id', ['label', 'name', 'title', 'description', 'notes']],
  ['testimony_contrasts', 'id', ['title', 'memo_markdown', 'summary', 'description', 'notes']],
  // Prosopography search is restricted to generated labels and counts. The raw
  // identity-resolution tables are intentionally absent from the snapshot.
  ['prosopography_public_search', 'id', ['title', 'snippet', 'type']],
  // Database vaults.
  ['db_databases', 'id', ['name', 'title', 'description', 'notes']],
  ['pages', 'id', ['title', 'content', 'summary', 'description']],
  ['db_views', 'id', ['name', 'title', 'description']],
];

const EXCERPT_CHARS = 600;

// Snapshots published before the testimony projection may still contain a legacy
// participant/speaker column. Search is another publication surface, so apply the same
// defense-in-depth filter before indexing those rows rather than trusting snapshot age.
function testimonySafeRow(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => {
    if (key === 'interview_id' || key === 'transcript_id' || key === 'annotation_id' || key === 'contrast_id' || key === 'code_id') return true;
    return !/(?:participant|speaker|narrator|informant|respondent|person|identity|contact)/i.test(key);
  }));
}

/**
 * The id a hit carries: the table's declared key, or one of the generic keys if a
 * snapshot published by an older desktop is missing it. Always a non-empty string —
 * clients type this field as a plain string, so a number or a `null` fails to decode
 * just as loudly as an absent key.
 */
function hitId(row, key) {
  for (const candidate of [key, 'id', 'nodus_id', 'global_id', 'passage_id', 'rel_id', 'person_id', 'place_id', 'event_id', 'group_id', 'scene_id', 'map_id', 'article_id', 'thread_id', 'rule_id', 'question_id', 'item_id', 'repository_id', 'unit_id', 'excerpt_id', 'analysis_id']) {
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
    for (const sourceRow of rows(snapshot, table)) {
      const row = table.startsWith('testimony_') ? testimonySafeRow(sourceRow) : sourceRow;
      const text = fields.map((field) => row[field]).filter((value) => typeof value === 'string').join('\n');
      if (text.toLowerCase().includes(needle)) {
        // A row nothing can name is dropped rather than served: an unnameable hit is one
        // the reader cannot open anyway, and emitting it costs them every other hit too.
        const id = hitId(row, key);
        if (id !== null) {
          results.push({
            type: typeof row.type === 'string' && row.type ? row.type : table,
            id,
            title: row.title ?? row.label ?? row.name ?? row.display_name ?? row.full_name
              ?? row.question ?? row.prompt ?? row.subject ?? text.slice(0, 120),
            excerpt: text.slice(0, EXCERPT_CHARS),
          });
        }
      }
      if (results.length >= limit) return results;
    }
  }
  // Database rows are EAV records: their searchable text lives in db_cells (and
  // derived values in db_computed_cells), not on db_rows itself. Search the public
  // cell projection as one row hit so the Web search can discover the same content
  // as Desktop's db_search_fts without exposing or changing the snapshot.
  const databaseNames = new Map(rows(snapshot, 'db_databases').map((entry) => [String(entry.id), String(entry.name ?? entry.title ?? entry.id)]));
  const columnNames = new Map(rows(snapshot, 'db_columns').map((entry) => [String(entry.id), String(entry.name ?? entry.id)]));
  const cellsByRow = new Map();
  for (const entry of [...rows(snapshot, 'db_cells'), ...rows(snapshot, 'db_computed_cells')]) {
    const id = String(entry.row_id ?? '');
    if (!id) continue;
    const value = entry.value_text ?? entry.value_json ?? entry.value_reference ?? entry.value_date ?? entry.value_number ?? entry.value_integer;
    if (value != null && String(value).toLowerCase().includes(needle)) {
      const matches = cellsByRow.get(id) ?? [];
      matches.push({ columnId: String(entry.column_id ?? ''), value: String(value) });
      cellsByRow.set(id, matches);
    }
  }
  for (const row of rows(snapshot, 'db_rows')) {
    const matches = cellsByRow.get(String(row.id));
    if (!matches?.length) continue;
    if (row.database_id == null || String(row.database_id) === '') continue;
    const titleColumn = rows(snapshot, 'db_columns').find((entry) => String(entry.database_id) === String(row.database_id) && entry.type === 'title');
    const titleCell = titleColumn && [...rows(snapshot, 'db_cells'), ...rows(snapshot, 'db_computed_cells')].find((entry) => String(entry.row_id) === String(row.id) && String(entry.column_id) === String(titleColumn.id));
    const title = String(titleCell?.value_text ?? titleCell?.value_json ?? row.id);
    const databaseName = databaseNames.get(String(row.database_id)) ?? String(row.database_id ?? 'Base de datos');
    const excerpt = matches.map((match) => `${columnNames.get(match.columnId) ?? 'Columna'}: ${match.value}`).join(' · ').slice(0, EXCERPT_CHARS);
    results.push({ type: 'db_rows', id: String(row.database_id ?? ''), title: `${title} · ${databaseName}`, excerpt });
    if (results.length >= limit) break;
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
