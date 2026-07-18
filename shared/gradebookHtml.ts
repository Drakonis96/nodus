/**
 * Printable gradebook documents.
 *
 * Two of them, because they answer different questions:
 *
 *  · The ACTA is the class list — every student, one row each, the record the plan
 *    actually emits. A plan that records no number emits no number here either; the
 *    projection layer decides, not this renderer.
 *  · The BOLETÍN is one student's own sheet with the full derivation, which is what a
 *    family (or a grade challenge) actually asks for: not "a 7" but why a 7.
 *
 * Pure string building, shared by the PDF and DOCX paths so both stay identical —
 * the same split exams and rubrics already use.
 */
import type { GradeResult, TraceNode, TraceRule } from './assessment/model';

export interface GradebookDocHeader {
  institution?: string;
  subject?: string;
  group?: string;
  teacher?: string;
  academicYear?: string;
  convocatoria?: string;
  date?: string;
}

export interface ActaRow {
  code: string;
  name: string;
  /** Already projected by the engine — number, term, or both. */
  numeric: number | null;
  qualitative: string | null;
  notPresented: boolean;
  passed: boolean;
  honours?: boolean;
}

export interface GradebookDocLabels {
  acta: string;
  boletin: string;
  student: string;
  identifier: string;
  grade: string;
  status: string;
  passed: string;
  failed: string;
  notPresented: string;
  honours: string;
  breakdown: string;
  weight: string;
  signature: string;
  generated: string;
}

export const GRADEBOOK_LABELS_ES: GradebookDocLabels = {
  acta: 'Acta de calificaciones',
  boletin: 'Boletín de calificaciones',
  student: 'Alumno/a',
  identifier: 'Identificador',
  grade: 'Calificación',
  status: 'Situación',
  passed: 'Apto',
  failed: 'No apto',
  notPresented: 'No presentado',
  honours: 'Mención',
  breakdown: 'Desglose',
  weight: 'Peso',
  signature: 'Firma',
  generated: 'Generado con Nodus',
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const STYLE = `
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #111; margin: 28px; font-size: 12px; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  .meta { color: #555; font-size: 11px; margin-bottom: 14px; }
  .meta span { margin-right: 14px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #bbb; padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; font-weight: 600; }
  td.num { text-align: right; white-space: nowrap; }
  .code { font-family: ui-monospace, Menlo, monospace; font-size: 10px; color: #555; }
  .np { color: #8a6d00; }
  .fail { color: #a11; }
  .rule { color: #8a6d00; font-size: 10px; }
  .sign { margin-top: 32px; font-size: 11px; }
  .foot { margin-top: 18px; color: #888; font-size: 10px; }
`;

function metaHtml(header: GradebookDocHeader): string {
  const parts = [header.institution, header.subject, header.group, header.academicYear, header.convocatoria, header.teacher, header.date]
    .filter((value): value is string => !!value && value.trim().length > 0);
  return parts.length ? `<p class="meta">${parts.map((p) => `<span>${escapeHtml(p)}</span>`).join('')}</p>` : '';
}

function recordCell(row: ActaRow, labels: GradebookDocLabels): string {
  if (row.notPresented) return `<span class="np">${escapeHtml(row.qualitative || labels.notPresented)}</span>`;
  const parts: string[] = [];
  if (row.numeric != null) parts.push(String(row.numeric));
  if (row.qualitative) parts.push(escapeHtml(row.qualitative));
  return parts.join(' · ') || '—';
}

/** The class list. */
export function renderActaHtml(
  header: GradebookDocHeader,
  rows: ActaRow[],
  labels: GradebookDocLabels = GRADEBOOK_LABELS_ES,
  options: { showCodes?: boolean } = {},
): string {
  const showCodes = options.showCodes !== false;
  const head = [
    '<th style="width:32px">#</th>',
    showCodes ? `<th style="width:90px">${escapeHtml(labels.identifier)}</th>` : '',
    `<th>${escapeHtml(labels.student)}</th>`,
    `<th style="width:110px">${escapeHtml(labels.grade)}</th>`,
    `<th style="width:90px">${escapeHtml(labels.status)}</th>`,
  ].filter(Boolean).join('');

  const body = rows.map((row, index) => [
    `<td class="num">${index + 1}</td>`,
    showCodes ? `<td class="code">${escapeHtml(row.code)}</td>` : '',
    `<td>${escapeHtml(row.name || '—')}</td>`,
    `<td class="num">${recordCell(row, labels)}</td>`,
    `<td>${row.notPresented ? `<span class="np">${escapeHtml(labels.notPresented)}</span>`
      : row.passed ? escapeHtml(labels.passed)
      : `<span class="fail">${escapeHtml(labels.failed)}</span>`}${
      row.honours ? ` · ${escapeHtml(labels.honours)}` : ''}</td>`,
  ].filter(Boolean).join('')).map((cells) => `<tr>${cells}</tr>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>
<h1>${escapeHtml(labels.acta)}</h1>${metaHtml(header)}
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
<p class="sign">${escapeHtml(labels.signature)}: ______________________________</p>
<p class="foot">${escapeHtml(labels.generated)}</p>
</body></html>`;
}

/** One student's sheet, with the derivation that produced the mark. */
export function renderBoletinHtml(
  header: GradebookDocHeader,
  student: { code: string; name: string },
  result: Pick<GradeResult, 'record' | 'passed' | 'trace' | 'rules'>,
  scaleMax: number,
  labels: GradebookDocLabels = GRADEBOOK_LABELS_ES,
  ruleText: (rule: TraceRule) => string = () => '',
): string {
  const rows: string[] = [];
  const walk = (node: TraceNode, depth: number) => {
    const value = node.fraction == null ? '—' : String(Math.round(node.fraction * scaleMax * 100) / 100);
    const share = node.effectiveWeight > 0 && node.effectiveWeight <= 1
      ? `${Math.round(node.effectiveWeight * 100)} %` : '';
    const notes = node.rules.map(ruleText).filter(Boolean)
      .map((text) => `<div class="rule">${escapeHtml(text)}</div>`).join('');
    rows.push(
      `<tr><td style="padding-left:${7 + depth * 14}px">${escapeHtml(node.name || '—')}${notes}</td>` +
      `<td class="num">${share}</td><td class="num">${value}</td></tr>`,
    );
    for (const child of node.children) walk(child, depth + 1);
  };
  if (result.trace) walk(result.trace, 0);

  const overall = result.record.notPresented
    ? escapeHtml(result.record.qualitative || labels.notPresented)
    : [result.record.numeric != null ? String(result.record.numeric) : '', result.record.qualitative ?? '']
        .filter(Boolean).map(escapeHtml).join(' · ') || '—';
  const notes = result.rules.map(ruleText).filter(Boolean)
    .map((text) => `<div class="rule">${escapeHtml(text)}</div>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>
<h1>${escapeHtml(labels.boletin)}</h1>${metaHtml(header)}
<p><strong>${escapeHtml(student.name || '—')}</strong> <span class="code">${escapeHtml(student.code)}</span></p>
<p>${escapeHtml(labels.grade)}: <strong>${overall}</strong> — ${
    result.record.notPresented ? escapeHtml(labels.notPresented)
    : result.passed ? escapeHtml(labels.passed) : escapeHtml(labels.failed)}</p>
${notes}
<h2 style="font-size:13px;margin:16px 0 6px">${escapeHtml(labels.breakdown)}</h2>
<table><thead><tr><th>${escapeHtml(labels.breakdown)}</th><th style="width:70px">${escapeHtml(labels.weight)}</th>
<th style="width:70px">${escapeHtml(labels.grade)}</th></tr></thead><tbody>${rows.join('')}</tbody></table>
<p class="foot">${escapeHtml(labels.generated)}</p>
</body></html>`;
}
