// Export a database to CSV / JSON / XLSX. CSV and JSON come from the pure serializers
// in shared/databaseExport.ts; XLSX is written here as a minimal, valid OOXML package
// (inline strings, no sharedStrings) with adm-zip.

import AdmZip from 'adm-zip';
import archiver from 'archiver';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { getDatabaseDetail, queryDatabaseRows } from '../db/databasesRepo';
import {
  databaseRowToCsv,
  databaseRowToJsonValue,
  databaseRowToMatrix,
  databaseToCsv,
  databaseToMatrix,
} from '@shared/databaseExport';
import type { ExportCell, ExportFormat } from '@shared/databaseExport';
import type { DatabaseRow } from '@shared/databases';
import { pageMarkdownForDatabaseRows } from '../db/pagesRepo';
import { listAutomationNotifications, listAutomationRules, listAutomationRuns, listDatabaseForms, listDatabaseFormSubmissions } from '../db/databaseAutomationsRepo';

const PAGE_CONTENT_HEADER = 'Contenido de página';

function csvValue(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Excel column letter for a 0-based index (0→A, 26→AA). */
function colLetter(i: number): string {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function cellXml(ref: string, cell: ExportCell): string {
  if (cell.numeric != null) return `<c r="${ref}"><v>${cell.numeric}</v></c>`;
  if (!cell.text) return `<c r="${ref}"/>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(cell.text)}</t></is></c>`;
}

function rowXml(rowIndex: number, cells: ExportCell[]): string {
  const r = rowIndex + 1;
  const inner = cells.map((c, i) => cellXml(`${colLetter(i)}${r}`, c)).join('');
  return `<row r="${r}">${inner}</row>`;
}

export function buildXlsx(header: string[], body: ExportCell[][]): Buffer {
  const headerCells: ExportCell[] = header.map((h) => ({ text: h, numeric: null }));
  const rowsXml = [rowXml(0, headerCells), ...body.map((cells, i) => rowXml(i + 1, cells))].join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Datos" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(rels, 'utf8'));
  zip.addFile('xl/workbook.xml', Buffer.from(workbook, 'utf8'));
  zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(workbookRels, 'utf8'));
  zip.addFile('xl/worksheets/sheet1.xml', Buffer.from(sheet, 'utf8'));
  return zip.toBuffer();
}

export interface DatabaseExportResult {
  fileName: string;
  mimeType: string;
  content: Buffer;
}

export interface DatabaseExportDescriptor {
  fileName: string;
  mimeType: string;
}

export interface DatabaseStreamingExportResult extends DatabaseExportDescriptor {
  rows: number;
  maxPageRows: number;
  bytes: number;
}

export function databaseExportDescriptor(databaseId: string, format: ExportFormat): DatabaseExportDescriptor | null {
  const detail = getDatabaseDetail(databaseId);
  if (!detail) return null;
  const base = detail.database.name.replace(/[/\\:*?"<>|]/g, '_') || 'base-de-datos';
  if (format === 'json') return { fileName: `${base}.json`, mimeType: 'application/json' };
  if (format === 'xlsx') return {
    fileName: `${base}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return { fileName: `${base}.csv`, mimeType: 'text/csv' };
}

async function writeChunk(stream: fs.WriteStream, chunk: string | Buffer): Promise<void> {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

async function streamPages(
  databaseId: string,
  visit: (rows: DatabaseRow[]) => Promise<void>,
): Promise<{ rows: number; maxPageRows: number }> {
  let cursor: string | null = null;
  let rows = 0;
  let maxPageRows = 0;
  do {
    const page = queryDatabaseRows({ databaseId, rowSort: 'position', cursor, limit: 500 });
    maxPageRows = Math.max(maxPageRows, page.rows.length);
    rows += page.rows.length;
    await visit(page.rows);
    cursor = page.nextCursor;
    if (cursor) await new Promise<void>((resolve) => setImmediate(resolve));
  } while (cursor);
  return { rows, maxPageRows };
}

function automationExportMetadata(databaseId: string) {
  const forms = listDatabaseForms(databaseId);
  return {
    automations: listAutomationRules(databaseId),
    automationRuns: listAutomationRuns(databaseId, 500),
    automationNotifications: listAutomationNotifications(databaseId, 500),
    forms,
    formSubmissions: Object.fromEntries(forms.map((form) => [form.id, listDatabaseFormSubmissions(form.id, 500)])),
  };
}

/** Production export path: bounded pages are written directly to the destination. */
export async function exportDatabaseToFile(
  databaseId: string,
  format: ExportFormat,
  destination: string,
): Promise<DatabaseStreamingExportResult | null> {
  const detail = getDatabaseDetail(databaseId);
  const descriptor = databaseExportDescriptor(databaseId, format);
  if (!detail || !descriptor) return null;
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  let metrics: { rows: number; maxPageRows: number };
  if (format === 'csv') {
    const output = fs.createWriteStream(destination);
    try {
      await writeChunk(output, Buffer.from([0xef, 0xbb, 0xbf]));
      await writeChunk(output, `${databaseToCsv(detail.columns, [])},${csvValue(PAGE_CONTENT_HEADER)}\r\n`);
      metrics = await streamPages(databaseId, async (rows) => {
        const pages = pageMarkdownForDatabaseRows(rows.map((row) => row.id));
        if (rows.length) await writeChunk(output, `${rows.map((row) =>
          `${databaseRowToCsv(detail.columns, row)},${csvValue(pages.get(row.id) ?? '')}`
        ).join('\r\n')}\r\n`);
      });
      output.end();
      await once(output, 'close');
    } catch (error) {
      output.destroy();
      throw error;
    }
  } else if (format === 'json') {
    const output = fs.createWriteStream(destination);
    let first = true;
    try {
      const metadata = automationExportMetadata(databaseId);
      await writeChunk(output, `{"columns":${JSON.stringify(detail.columns.map((column) => ({ name: column.name, type: column.type })))},"automations":${JSON.stringify(metadata.automations)},"automationRuns":${JSON.stringify(metadata.automationRuns)},"automationNotifications":${JSON.stringify(metadata.automationNotifications)},"forms":${JSON.stringify(metadata.forms)},"formSubmissions":${JSON.stringify(metadata.formSubmissions)},"rows":[`);
      metrics = await streamPages(databaseId, async (rows) => {
        const pages = pageMarkdownForDatabaseRows(rows.map((row) => row.id));
        for (const row of rows) {
          await writeChunk(output, `${first ? '' : ','}${JSON.stringify({
            ...databaseRowToJsonValue(detail.columns, row),
            _page: { markdown: pages.get(row.id) ?? '' },
          })}`);
          first = false;
        }
      });
      await writeChunk(output, ']}');
      output.end();
      await once(output, 'close');
    } catch (error) {
      output.destroy();
      throw error;
    }
  } else {
    const sheetPath = `${destination}.sheet-${process.pid}-${Date.now()}.xml`;
    const sheet = fs.createWriteStream(sheetPath);
    try {
      await writeChunk(sheet, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>');
      await writeChunk(sheet, rowXml(0, [
        ...detail.columns.map((column) => ({ text: column.name, numeric: null })),
        { text: PAGE_CONTENT_HEADER, numeric: null },
      ]));
      let rowIndex = 1;
      metrics = await streamPages(databaseId, async (rows) => {
        const pages = pageMarkdownForDatabaseRows(rows.map((row) => row.id));
        for (const row of rows) await writeChunk(sheet, rowXml(rowIndex++, [
          ...databaseRowToMatrix(detail.columns, row),
          { text: pages.get(row.id) ?? '', numeric: null },
        ]));
      });
      await writeChunk(sheet, '</sheetData></worksheet>');
      sheet.end();
      await once(sheet, 'close');

      const output = fs.createWriteStream(destination);
      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.pipe(output);
      archive.append('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>', { name: '[Content_Types].xml' });
      archive.append('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>', { name: '_rels/.rels' });
      archive.append('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Datos" sheetId="1" r:id="rId1"/></sheets></workbook>', { name: 'xl/workbook.xml' });
      archive.append('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>', { name: 'xl/_rels/workbook.xml.rels' });
      archive.file(sheetPath, { name: 'xl/worksheets/sheet1.xml' });
      const archiveError = new Promise<never>((_resolve, reject) => archive.on('error', reject));
      await Promise.race([Promise.all([archive.finalize(), once(output, 'close')]), archiveError]);
    } finally {
      if (!sheet.closed) sheet.destroy();
      fs.rmSync(sheetPath, { force: true });
    }
  }
  const bytes = fs.statSync(destination).size;
  return { ...descriptor, ...metrics, bytes };
}

function rowsForExport(databaseId: string): DatabaseRow[] {
  const rows: DatabaseRow[] = [];
  let cursor: string | null = null;
  do {
    const page = queryDatabaseRows({ databaseId, rowSort: 'position', cursor, limit: 500 });
    rows.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor);
  return rows;
}

/** Serialize a database to the requested format (in memory). */
export function exportDatabase(databaseId: string, format: ExportFormat): DatabaseExportResult | null {
  const detail = getDatabaseDetail(databaseId);
  if (!detail) return null;
  const rows = rowsForExport(databaseId);
  const pages = pageMarkdownForDatabaseRows(rows.map((row) => row.id));
  const base = detail.database.name.replace(/[/\\:*?"<>|]/g, '_') || 'base-de-datos';
  if (format === 'json') {
    return {
      fileName: `${base}.json`,
      mimeType: 'application/json',
      content: Buffer.from(JSON.stringify({
        columns: detail.columns.map((column) => ({ name: column.name, type: column.type })),
        ...automationExportMetadata(databaseId),
        rows: rows.map((row) => ({ ...databaseRowToJsonValue(detail.columns, row), _page: { markdown: pages.get(row.id) ?? '' } })),
      }, null, 2), 'utf8'),
    };
  }
  if (format === 'xlsx') {
    const { header, body } = databaseToMatrix(detail.columns, rows);
    return {
      fileName: `${base}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: buildXlsx(
        [...header, PAGE_CONTENT_HEADER],
        body.map((cells, index) => [...cells, { text: pages.get(rows[index].id) ?? '', numeric: null }]),
      ),
    };
  }
  // Prepend a UTF-8 BOM (bytes EF BB BF) so Excel opens accented CSV correctly.
  return {
    fileName: `${base}.csv`,
    mimeType: 'text/csv',
    content: Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from([
        `${databaseToCsv(detail.columns, [])},${csvValue(PAGE_CONTENT_HEADER)}`,
        ...rows.map((row) => `${databaseRowToCsv(detail.columns, row)},${csvValue(pages.get(row.id) ?? '')}`),
      ].join('\r\n'), 'utf8'),
    ]),
  };
}
