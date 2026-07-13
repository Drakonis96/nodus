// Export a database to CSV / JSON / XLSX. CSV and JSON come from the pure serializers
// in shared/databaseExport.ts; XLSX is written here as a minimal, valid OOXML package
// (inline strings, no sharedStrings) with adm-zip.

import AdmZip from 'adm-zip';
import { getDatabaseDetail, listRows } from '../db/databasesRepo';
import { databaseToCsv, databaseToJson, databaseToMatrix } from '@shared/databaseExport';
import type { ExportCell, ExportFormat } from '@shared/databaseExport';

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

/** Serialize a database to the requested format (in memory). */
export function exportDatabase(databaseId: string, format: ExportFormat): DatabaseExportResult | null {
  const detail = getDatabaseDetail(databaseId);
  if (!detail) return null;
  const rows = listRows(databaseId, { sort: 'position' });
  const base = detail.database.name.replace(/[/\\:*?"<>|]/g, '_') || 'base-de-datos';
  if (format === 'json') {
    return { fileName: `${base}.json`, mimeType: 'application/json', content: Buffer.from(databaseToJson(detail.columns, rows), 'utf8') };
  }
  if (format === 'xlsx') {
    const { header, body } = databaseToMatrix(detail.columns, rows);
    return {
      fileName: `${base}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: buildXlsx(header, body),
    };
  }
  // Prepend a UTF-8 BOM (bytes EF BB BF) so Excel opens accented CSV correctly.
  return {
    fileName: `${base}.csv`,
    mimeType: 'text/csv',
    content: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(databaseToCsv(detail.columns, rows), 'utf8')]),
  };
}
