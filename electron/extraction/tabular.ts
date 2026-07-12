// Text extraction for tabular sources (CSV / XLSX). These formats are not full
// text and Zotero does not index them, but they are the backbone of primary-source
// and genealogical work (census exports, record dumps). We linearise them into a
// faithful, searchable text form: a schema line plus one "Header: value" record per
// row, so downstream retrieval — and, later, entity extraction — can read them.
//
// XLSX is parsed the same hand-rolled zip+XML way as the EPUB extractor rather than
// pulling in a heavyweight (and historically CVE-prone) spreadsheet dependency.

import fs from 'node:fs';
import AdmZip from 'adm-zip';

const DELIMITERS = [',', ';', '\t', '|'];

function decodeXmlEntities(text: string): string {
  const named: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"', nbsp: ' ' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    const lower = body.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return named[lower] ?? entity;
  });
}

/** Pick the delimiter that appears most on the first non-empty line (outside quotes). */
export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  let best = ',';
  let bestCount = -1;
  for (const delim of DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === delim && !inQuotes) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = delim;
    }
  }
  return best;
}

/**
 * Parse RFC-4180-ish delimited text into rows of string cells. Handles quoted
 * fields, escaped quotes (""), and delimiters/newlines inside quotes; tolerates
 * both LF and CRLF. The delimiter is auto-detected when not given.
 */
export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const delim = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      if (text[i + 1] === '\n') continue; // CRLF — the \n ends the row
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface RowsToTextOptions {
  sheetName?: string;
}

/**
 * Linearise a grid into searchable text. With a plausible header row (>1 column,
 * all non-empty), each data row becomes a numbered "Header: value" record and the
 * header is emitted once as a schema hint. Otherwise the grid is emitted as-is.
 * Fully-empty rows are dropped and empty cells omitted from records.
 */
export function rowsToText(rows: string[][], opts: RowsToTextOptions = {}): string {
  const clean = rows.filter((r) => r.some((c) => (c ?? '').trim() !== ''));
  if (clean.length === 0) return '';

  const parts: string[] = [];
  if (opts.sheetName) parts.push(`# ${opts.sheetName}`);

  const header = clean[0].map((h) => (h ?? '').trim());
  const looksLikeHeader = header.length > 1 && header.every((h) => h !== '');

  if (clean.length >= 2 && looksLikeHeader) {
    parts.push(`Campos: ${header.join(' · ')}`);
    for (let i = 1; i < clean.length; i++) {
      const cells = clean[i];
      const pairs: string[] = [];
      for (let j = 0; j < cells.length; j++) {
        const value = (cells[j] ?? '').trim();
        if (value === '') continue;
        pairs.push(`${header[j] ?? `col${j + 1}`}: ${value}`);
      }
      if (pairs.length) parts.push(`${i}. ${pairs.join(' · ')}`);
    }
  } else {
    for (const r of clean) parts.push(r.map((c) => (c ?? '').trim()).join(' · '));
  }
  return parts.join('\n');
}

export function csvToText(input: string): string {
  return rowsToText(parseCsv(input));
}

export function csvFileToText(filePath: string): string {
  return csvToText(fs.readFileSync(filePath, 'utf8'));
}

// ── XLSX (Office Open XML) ────────────────────────────────────────────────────

function parseSharedStrings(zip: AdmZip): string[] {
  const entry = zip.getEntry('xl/sharedStrings.xml');
  if (!entry) return [];
  const xml = entry.getData().toString('utf8');
  const out: string[] = [];
  for (const si of xml.match(/<si\b[^>]*>[\s\S]*?<\/si>/gi) ?? []) {
    const texts = [...si.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((m) => decodeXmlEntities(m[1]));
    out.push(texts.join(''));
  }
  return out;
}

/** Column index (0-based) from a cell ref like "B2" → 1. Defaults to 0 when absent. */
function columnIndexFromRef(attrs: string): number | null {
  const ref = attrs.match(/\br="([A-Z]+)\d+"/i);
  if (!ref) return null;
  const letters = ref[1].toUpperCase();
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

function cellValue(attrs: string, inner: string, shared: string[]): string {
  const type = attrs.match(/\bt="([^"]+)"/i)?.[1] ?? '';
  if (type === 'inlineStr') {
    const texts = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((m) => decodeXmlEntities(m[1]));
    return texts.join('');
  }
  const raw = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? '';
  if (type === 's') {
    const index = Number.parseInt(decodeXmlEntities(raw), 10);
    return Number.isFinite(index) ? shared[index] ?? '' : '';
  }
  return decodeXmlEntities(raw);
}

function parseSheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowXml of xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/gi) ?? []) {
    const cells: string[] = [];
    let cursor = 0;
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi;
    let match: RegExpExecArray | null;
    while ((match = cellRe.exec(rowXml)) !== null) {
      const attrs = match[1] ?? '';
      const inner = match[2] ?? '';
      const col = columnIndexFromRef(attrs);
      const index = col ?? cursor;
      cells[index] = cellValue(attrs, inner, shared);
      cursor = index + 1;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}

export function xlsxFileToText(filePath: string): string {
  const zip = new AdmZip(filePath);
  const shared = parseSharedStrings(zip);
  const sheets = zip
    .getEntries()
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.entryName.replace(/\\/g, '/')))
    .sort((a, b) => {
      const na = Number.parseInt(a.entryName.match(/sheet(\d+)\.xml/i)?.[1] ?? '0', 10);
      const nb = Number.parseInt(b.entryName.match(/sheet(\d+)\.xml/i)?.[1] ?? '0', 10);
      return na - nb;
    });

  const multi = sheets.length > 1;
  const parts: string[] = [];
  sheets.forEach((entry, i) => {
    const rows = parseSheetRows(entry.getData().toString('utf8'), shared);
    const text = rowsToText(rows, multi ? { sheetName: `Hoja ${i + 1}` } : {});
    if (text) parts.push(text);
  });
  return parts.join('\n\n');
}
