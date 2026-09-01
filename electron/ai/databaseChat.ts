// Database chat orchestrator: builds a bounded context (statistical profile + a sample
// of rows) for the selected databases and streams an analyst answer that may include a
// native chart spec. The context assembly is pure (shared/databaseChat.ts); this module
// wires the repo + the streaming model.

import { getDatabase, getColumns, queryDatabaseRows } from '../db/databasesRepo';
import { computeProfile, profileToText } from '@shared/dataProfile';
import { buildDbChatContext, buildDbChatUser, databaseChatSystem } from '@shared/databaseChat';
import { decodeCheckbox, decodeMultiSelect } from '@shared/databases';
import type { DbChatPart } from '@shared/databaseChat';
import type { DatabaseChatRequest, DatabaseColumn, DatabaseRow, PromptLanguage } from '@shared/types';
import { getSettings } from '../db/settingsRepo';

export type { DatabaseChatRequest };

/**
 * The sample only has to show what a row looks like — the profile is what answers questions —
 * so it stays small enough to leave the profile the bulk of the context. Ollama runs models at
 * a 4096-token window by default and silently drops the overflow, so a context that fits it is
 * the difference between the chat working out of the box on a local model and refusing.
 */
const SAMPLE_ROWS = 10;
const SAMPLE_COLS = 8;
/**
 * Longest a single value may be in the sample. Rows and columns were already bounded, but a
 * cell was not: one `Descripcion visual` in a real catalogue runs to 3k characters, so 15
 * rows became ~24k of a 27k context. That buried the profile the answers are supposed to come
 * from, pushed the whole prompt past a local model's window, and left the model answering
 * "15 rows" for a 7k-row table from the only thing it could still see. The sample exists to
 * show the shape of a row, and a clipped value shows that just as well.
 */
const SAMPLE_VALUE_CHARS = 120;

const clip = (v: string) => (v.length > SAMPLE_VALUE_CHARS ? `${v.slice(0, SAMPLE_VALUE_CHARS).trimEnd()}…` : v);

/** One compact line per row: "col: value; …" resolving option labels. */
function sampleText(columns: DatabaseColumn[], rows: DatabaseRow[], language: PromptLanguage = 'es'): string {
  const booleanCopy = {
    es: ['sí', 'no'], en: ['yes', 'no'], fr: ['oui', 'non'], de: ['ja', 'nein'],
    pt: ['sim', 'não'], 'pt-BR': ['sim', 'não'], it: ['sì', 'no'], tr: ['evet', 'hayır'],
  } as const;
  const [yes, no] = booleanCopy[language] ?? booleanCopy.es;
  const cols = columns.filter((c) => c.type !== 'ai').slice(0, SAMPLE_COLS);
  return rows
    .slice(0, SAMPLE_ROWS)
    .map((row, i) => {
      const parts = cols
        .map((col) => {
          const raw = row.cells[col.id] ?? null;
          let v = '';
          if (col.type === 'select' || col.type === 'status') v = col.options.find((o) => o.id === raw)?.label ?? '';
          else if (col.type === 'multi_select')
            v = decodeMultiSelect(raw)
              .map((id) => col.options.find((o) => o.id === id)?.label ?? '')
              .filter(Boolean)
              .join('/');
          else if (col.type === 'checkbox') v = decodeCheckbox(raw) ? yes : no;
          else if (col.type === 'attachment' || col.type === 'files') v = String((row.attachments?.[col.id] ?? []).length);
          else if (col.type === 'relation') v = String(row.relationCounts?.[col.id] ?? 0);
          else v = raw ?? '';
          return v && v.trim() ? `${col.name}: ${clip(v.trim())}` : '';
        })
        .filter(Boolean);
      return `${i + 1}. ${parts.join('; ')}`;
    })
    .join('\n');
}

function queryAllRows(databaseId: string): DatabaseRow[] {
  const rows: DatabaseRow[] = [];
  let cursor: string | null = null;
  do {
    const page = queryDatabaseRows({ databaseId, cursor, limit: 500 });
    rows.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor);
  return rows;
}

/** Build the bounded context string for the selected databases. */
export function buildDatabaseChatContext(databaseIds: string[], language = getSettings().promptLanguage ?? 'es'): { context: string; names: string[] } {
  const parts: DbChatPart[] = [];
  const names: string[] = [];
  for (const id of databaseIds) {
    const database = getDatabase(id);
    if (!database) continue;
    const columns = getColumns(id);
    const rows = queryAllRows(id);
    const profile = computeProfile(columns, rows);
    parts.push({
      name: database.name,
      profileText: profileToText(database.name, profile, language),
      sample: sampleText(columns, rows, language),
      rowCount: rows.length,
      sampleSize: Math.min(rows.length, SAMPLE_ROWS),
    });
    names.push(database.name);
  }
  return { context: buildDbChatContext(parts, language), names };
}

export interface DatabaseChatDeps {
  stream?: (
    opts: { system: string; user: string; plainContext?: boolean; temperature?: number; maxTokens?: number },
    onDelta: (delta: string) => void,
    signal?: AbortSignal
  ) => Promise<string>;
}

/** Stream an answer over the selected databases' data. Returns the full text. */
export async function streamDatabaseChat(
  request: DatabaseChatRequest,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
  deps: DatabaseChatDeps = {}
): Promise<{ text: string }> {
  if (!request.databaseIds.length) throw new Error('Elige al menos una base de datos.');
  const language = getSettings().promptLanguage ?? 'es';
  const { context } = buildDatabaseChatContext(request.databaseIds, language);
  const user = buildDbChatUser(context, request.question, request.history ?? [], language);

  const stream =
    deps.stream ??
    (async (opts, cb, sig) => {
      const { completeTextStream } = await import('./aiClient');
      const { getSettings } = await import('../db/settingsRepo');
      const s = getSettings();
      return completeTextStream(opts, (delta, kind) => {
        if (kind !== 'reasoning') cb(delta);
      }, s.chatModel ?? s.synthesisModel ?? null, sig);
    });

  const text = await stream(
    { system: databaseChatSystem(language), user, plainContext: true, temperature: 0.3, maxTokens: 1500 },
    onDelta,
    signal
  );
  return { text };
}
