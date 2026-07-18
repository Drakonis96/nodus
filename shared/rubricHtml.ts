import {
  criterionMaxPoints,
  rubricMaxScore,
  type RubricExportOptions,
  type TeachingRubric,
} from './teachingRubrics';

/**
 * Renders a rubric as a self-contained LANDSCAPE A4 document — the same markup feeds
 * the builder's live preview and the exported PDF, so what the teacher sees is what
 * prints. Landscape because a rubric is a wide table: four descriptor columns in
 * portrait squeeze the text into unreadable ribbons.
 */

export interface RubricHtmlOptions extends RubricExportOptions {
  forPreview?: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeMultiline(value: string): string {
  return escapeHtml(value).replace(/\n/g, '<br />');
}

const LABELS: Record<string, { criterion: string; weight: string; score: string; total: string; max: string }> = {
  es: { criterion: 'Criterio', weight: 'Peso', score: 'Puntuación', total: 'Puntuación total', max: 'máximo' },
  en: { criterion: 'Criterion', weight: 'Weight', score: 'Score', total: 'Total score', max: 'maximum' },
  fr: { criterion: 'Critère', weight: 'Pondération', score: 'Note', total: 'Note totale', max: 'maximum' },
  de: { criterion: 'Kriterium', weight: 'Gewichtung', score: 'Punkte', total: 'Gesamtpunktzahl', max: 'Maximum' },
  pt: { criterion: 'Critério', weight: 'Peso', score: 'Pontuação', total: 'Pontuação total', max: 'máximo' },
  'pt-BR': { criterion: 'Critério', weight: 'Peso', score: 'Pontuação', total: 'Pontuação total', max: 'máximo' },
};

export function rubricDocumentLabels(language: string) {
  return LABELS[language] ?? LABELS.es;
}

const STYLES = `
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Helvetica Neue", Arial, sans-serif; font-size: 9.5pt; line-height: 1.35; color: #111; background: #fff; }
  h1 { font-size: 15pt; margin: 0 0 2px; }
  .subtitle { color: #555; font-size: 9pt; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 0.8pt solid #999; padding: 6px 7px; vertical-align: top; text-align: left; word-wrap: break-word; }
  thead th { background: #f0f0f0; font-size: 9pt; }
  thead th .score { display: block; font-weight: 400; color: #555; font-size: 8pt; margin-top: 1px; }
  .criterion { width: 20%; background: #fafafa; }
  .criterion strong { display: block; }
  .criterion em { display: block; font-style: normal; color: #666; font-size: 8.5pt; margin-top: 2px; }
  .criterion .weight { display: block; color: #555; font-size: 8pt; margin-top: 3px; }
  .mark { width: 9%; background: #fbfbfb; }
  .total { margin-top: 10px; text-align: right; font-size: 9pt; }
  .total strong { font-size: 10.5pt; }
  tr { page-break-inside: avoid; }
  .preview-body { background: #f1f1f1; padding: 20px; }
  .preview-body .sheet { background: #fff; width: 297mm; min-height: 210mm; margin: 0 auto; padding: 12mm; box-shadow: 0 2px 14px rgba(0,0,0,.18); }
  /* The sheet is a real landscape A4 (297mm ≈ 1123px) and the preview pane is much
     narrower, so scale it to fit rather than forcing a horizontal scrollbar. Media
     queries read the IFRAME width, keeping this pure CSS (the preview has no JS). */
  @media (max-width: 1100px) { .preview-body .sheet { zoom: 0.8; } }
  @media (max-width: 900px)  { .preview-body { padding: 14px; } .preview-body .sheet { zoom: 0.62; } }
  @media (max-width: 720px)  { .preview-body .sheet { zoom: 0.5; } }
  @media (max-width: 560px)  { .preview-body { padding: 10px; } .preview-body .sheet { zoom: 0.38; } }
`;

export function renderRubricHtml(rubric: TeachingRubric, options: RubricHtmlOptions = {}): string {
  const labels = rubricDocumentLabels(rubric.language);
  const showScores = options.includeScores !== false;
  const head = [
    `<th class="criterion">${escapeHtml(labels.criterion)}</th>`,
    ...rubric.levels.map(
      (level) =>
        `<th>${escapeHtml(level.label)}${showScores ? `<span class="score">${level.score}</span>` : ''}</th>`
    ),
    ...(options.includeScoreColumn ? [`<th class="mark">${escapeHtml(labels.score)}</th>`] : []),
  ].join('');

  const body = rubric.criteria
    .map((criterion) => {
      const cells = rubric.levels
        .map((level) => `<td>${escapeMultiline(criterion.cells[level.id] ?? '')}</td>`)
        .join('');
      const weight = rubric.weighted
        ? `<span class="weight">${labels.weight}: ${criterion.weight}% · ${criterionMaxPoints(rubric, criterion)} ${labels.max}</span>`
        : '';
      const description = criterion.description.trim() ? `<em>${escapeMultiline(criterion.description)}</em>` : '';
      return `<tr><td class="criterion"><strong>${escapeHtml(criterion.name)}</strong>${description}${weight}</td>${cells}${options.includeScoreColumn ? '<td class="mark"></td>' : ''}</tr>`;
    })
    .join('');

  const subtitleParts = [rubric.description.trim()].filter(Boolean).map(escapeHtml);
  const lang = rubric.language === 'pt-BR' ? 'pt-BR' : rubric.language;

  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head><meta charset="utf-8" /><title>${escapeHtml(rubric.title || 'Rúbrica')}</title><style>${STYLES}</style></head>
<body class="${options.forPreview ? 'preview-body' : ''}">
  <div class="sheet">
    <h1>${escapeHtml(rubric.title || 'Rúbrica')}</h1>
    ${subtitleParts.length ? `<p class="subtitle">${subtitleParts.join(' · ')}</p>` : ''}
    <table>
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
    <p class="total">${escapeHtml(labels.total)}: <strong>____ / ${rubricMaxScore(rubric)}</strong></p>
  </div>
</body>
</html>`;
}
