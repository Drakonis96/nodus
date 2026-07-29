import type { JsonValue } from './prosopography';

/** RFC-4180-style parser used for local CSV/TSV staging; it never creates people. */
export function parseProsopDelimited(text: string, delimiter?: ',' | '\t' | ';'): {
  delimiter: ',' | '\t' | ';';
  headers: string[];
  rows: Array<Record<string, JsonValue>>;
} {
  const sample = text.slice(0, 4096);
  const chosen = delimiter ?? (sample.split('\t').length > sample.split(',').length ? '\t' : sample.split(';').length > sample.split(',').length ? ';' : ',');
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === chosen && !quoted) {
      row.push(cell); cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell); cell = '';
      if (row.some((value) => value.length)) records.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.length)) records.push(row);
  if (!records.length) return { delimiter: chosen, headers: [], rows: [] };
  const seen = new Map<string, number>();
  const headers = records[0].map((value, index) => {
    const base = value.trim() || `columna_${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}_${count + 1}` : base;
  });
  return {
    delimiter: chosen,
    headers,
    rows: records.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? '']))),
  };
}
