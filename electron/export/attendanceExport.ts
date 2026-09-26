// Attendance exports (teaching vault). The renderer builds the labelled tables with
// `buildAttendanceExport` (so every header is in the interface language); this side
// only serialises them.
import { tableToCsv, type ExportCell } from '@shared/databaseExport';
import type { AttendanceExportTables, ExportValue } from '@shared/teachingAttendance';
import { buildXlsxWorkbook } from './databaseExport';

export type AttendanceExportFormat = 'csv' | 'xlsx';

function toCell(value: ExportValue): ExportCell {
  return typeof value === 'number' ? { text: String(value), numeric: value } : { text: value, numeric: null };
}

/** CSV cannot hold several sheets, so it takes the flat table with the group columns. */
export function attendanceCsv(tables: AttendanceExportTables): string {
  return tableToCsv(tables.flat.header, tables.flat.rows);
}

export function attendanceXlsx(tables: AttendanceExportTables): Buffer {
  return buildXlsxWorkbook(tables.sheets.map((sheet) => ({
    name: sheet.name,
    header: sheet.header,
    body: sheet.rows.map((row) => row.map(toCell)),
  })));
}
