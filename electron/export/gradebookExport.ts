/**
 * Gradebook exports: acta, boletín, CSV and XLSX.
 *
 * Everything reuses what exams and rubrics already use — one shared HTML renderer
 * feeding both the PDF and the DOCX path — so the two can never drift apart. The
 * tabular formats fall out of the grid adapter without any gradebook-specific code:
 * the adapter already presents the marks as `(DatabaseColumn[], DatabaseRow[])`, which
 * is exactly what the database vault's CSV and XLSX writers consume.
 *
 * Names are included on purpose here: an acta is a document FOR the institution, so it
 * carries who each mark belongs to. The identifier column rides along so a teacher can
 * still cross-reference it against an AI conversation.
 */
import { htmlToPdfBytes } from './htmlToPdf';
import { buildXlsx } from './databaseExport';
import { databaseToCsv } from '@shared/databaseExport';
import type { DatabaseColumn, DatabaseRow } from '@shared/databases';
import {
  renderActaHtml,
  renderBoletinHtml,
  GRADEBOOK_LABELS_ES,
  type ActaRow,
  type GradebookDocHeader,
  type GradebookDocLabels,
} from '@shared/gradebookHtml';
import type { GradeResult, TraceRule } from '@shared/assessment';
import type { GradeScale } from '@shared/itemAnalysis';

export type GradebookExportFormat = 'pdf' | 'docx' | 'csv' | 'xlsx';

export interface ActaExportInput {
  header: GradebookDocHeader;
  rows: ActaRow[];
  labels?: GradebookDocLabels;
  showCodes?: boolean;
}

export async function actaPdfBytes(input: ActaExportInput): Promise<Buffer> {
  return htmlToPdfBytes(renderActaHtml(input.header, input.rows, input.labels ?? GRADEBOOK_LABELS_ES, {
    showCodes: input.showCodes,
  }));
}

/**
 * DOCX built from the same data as the PDF, following the exam/rubric pattern: a real
 * Word table rather than an HTML blob, so the document stays editable.
 */
export async function actaDocxBytes(input: ActaExportInput): Promise<Buffer> {
  const { BorderStyle, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } =
    await import('docx');
  const labels = input.labels ?? GRADEBOOK_LABELS_ES;
  const showCodes = input.showCodes !== false;
  const border = { style: BorderStyle.SINGLE, size: 6, color: '999999' };
  const borders = { top: border, bottom: border, left: border, right: border };

  const cell = (text: string, bold = false) =>
    new TableCell({ borders, children: [new Paragraph({ children: [new TextRun({ text, bold })] })] });

  const headerCells = ['#', ...(showCodes ? [labels.identifier] : []), labels.student, labels.grade, labels.status]
    .map((text) => cell(text, true));

  const bodyRows = input.rows.map((row, index) => new TableRow({
    children: [
      cell(String(index + 1)),
      ...(showCodes ? [cell(row.code)] : []),
      cell(row.name || '—'),
      cell(row.notPresented
        ? row.qualitative || labels.notPresented
        : [row.numeric != null ? String(row.numeric) : '', row.qualitative ?? ''].filter(Boolean).join(' · ') || '—'),
      cell(row.notPresented ? labels.notPresented : row.passed ? labels.passed : labels.failed),
    ],
  }));

  const meta = [input.header.institution, input.header.subject, input.header.group,
    input.header.academicYear, input.header.convocatoria, input.header.date]
    .filter((value): value is string => !!value?.trim()).join(' · ');

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: labels.acta, heading: HeadingLevel.HEADING_1 }),
        ...(meta ? [new Paragraph({ children: [new TextRun({ text: meta, size: 20, color: '555555' })] })] : []),
        new Paragraph({ text: '' }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [new TableRow({ children: headerCells }), ...bodyRows],
        }),
        new Paragraph({ text: '' }),
        new Paragraph({ children: [new TextRun({ text: `${labels.signature}: ______________________________`, size: 20 })] }),
      ],
    }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

export interface BoletinExportInput {
  header: GradebookDocHeader;
  student: { code: string; name: string };
  result: Pick<GradeResult, 'record' | 'passed' | 'trace' | 'rules'>;
  /** The plan's full scale: its minimum is not always 0. */
  scale: GradeScale;
  labels?: GradebookDocLabels;
  /** Injected so the rule wording follows the user's language, not this module's. */
  ruleText?: (rule: TraceRule) => string;
}

export async function boletinPdfBytes(input: BoletinExportInput): Promise<Buffer> {
  return htmlToPdfBytes(renderBoletinHtml(
    input.header, input.student, input.result, input.scale,
    input.labels ?? GRADEBOOK_LABELS_ES, input.ruleText,
  ));
}

/** Tabular exports, straight off the grid adapter's output. */
export function gradebookCsv(columns: DatabaseColumn[], rows: DatabaseRow[]): string {
  return databaseToCsv(columns, rows);
}

export function gradebookXlsx(columns: DatabaseColumn[], rows: DatabaseRow[]): Buffer {
  const header = columns.map((column) => column.name);
  const body = rows.map((row) => columns.map((column) => {
    const raw = row.cells[column.id] ?? '';
    const numeric = column.type === 'number' && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null;
    return { text: raw, numeric };
  }));
  return buildXlsx(header, body);
}
