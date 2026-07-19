import { renderRubricHtml, rubricDocumentLabels } from '@shared/rubricHtml';
import { htmlToPdfBytes } from './htmlToPdf';
import { criterionMaxPoints, rubricMaxScore, type RubricExportOptions, type TeachingRubric } from '@shared/teachingRubrics';

/** Landscape, because a rubric is a wide table — see renderRubricHtml. */
export async function rubricPdfBytes(rubric: TeachingRubric, options: RubricExportOptions = {}): Promise<Buffer> {
  return htmlToPdfBytes(renderRubricHtml(rubric, options), { landscape: true });
}

export async function rubricDocxBytes(rubric: TeachingRubric, options: RubricExportOptions = {}): Promise<Buffer> {
  const {
    BorderStyle,
    Document,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
    convertMillimetersToTwip,
    PageOrientation,
  } = await import('docx');

  const labels = rubricDocumentLabels(rubric.language);
  const showScores = options.includeScores !== false;

  /**
   * One TextRun per LINE. `docx` drops "\n" outright, so a descriptor written on three
   * lines arrived in Word as one — while the PDF, built from the shared HTML, showed
   * the breaks. Both documents come from the same data and must read the same.
   */
  const textRuns = (text: string, props: Record<string, unknown> = {}) =>
    String(text ?? '').split(/\r?\n/).map((line, index) =>
      new TextRun({ ...props, text: line, ...(index > 0 ? { break: 1 } : {}) }));
  const border = { style: BorderStyle.SINGLE, size: 6, color: '999999' };
  const cellBorders = { top: border, bottom: border, left: border, right: border };

  const headerCells = [
    new TableCell({
      borders: cellBorders,
      shading: { fill: 'F0F0F0' },
      width: { size: 20, type: WidthType.PERCENTAGE },
      children: [new Paragraph({ children: [new TextRun({ text: labels.criterion, bold: true, size: 18 })] })],
    }),
    ...rubric.levels.map(
      (level) =>
        new TableCell({
          borders: cellBorders,
          shading: { fill: 'F0F0F0' },
          children: [
            new Paragraph({ children: [new TextRun({ text: level.label, bold: true, size: 18 })] }),
            ...(showScores ? [new Paragraph({ children: [new TextRun({ text: String(level.score), size: 16, color: '555555' })] })] : []),
          ],
        })
    ),
    ...(options.includeScoreColumn
      ? [new TableCell({ borders: cellBorders, shading: { fill: 'F0F0F0' }, width: { size: 9, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: labels.score, bold: true, size: 18 })] })] })]
      : []),
  ];

  const bodyRows = rubric.criteria.map((criterion) => {
    const criterionParagraphs = [new Paragraph({ children: [new TextRun({ text: criterion.name, bold: true, size: 18 })] })];
    if (criterion.description.trim()) {
      criterionParagraphs.push(new Paragraph({ children: textRuns(criterion.description, { size: 16, color: '666666' }) }));
    }
    if (rubric.weighted) {
      criterionParagraphs.push(
        new Paragraph({ children: [new TextRun({ text: `${labels.weight}: ${criterion.weight}% · ${criterionMaxPoints(rubric, criterion)} ${labels.max}`, size: 15, color: '555555' })] })
      );
    }
    return new TableRow({
      children: [
        new TableCell({ borders: cellBorders, shading: { fill: 'FAFAFA' }, children: criterionParagraphs }),
        ...rubric.levels.map(
          (level) =>
            new TableCell({
              borders: cellBorders,
              children: [new Paragraph({ children: textRuns(criterion.cells[level.id] ?? '', { size: 17 }) })],
            })
        ),
        ...(options.includeScoreColumn ? [new TableCell({ borders: cellBorders, children: [new Paragraph({ text: '' })] })] : []),
      ],
    });
  });

  const document = new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 18 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { orientation: PageOrientation.LANDSCAPE },
            margin: {
              top: convertMillimetersToTwip(12),
              right: convertMillimetersToTwip(12),
              bottom: convertMillimetersToTwip(12),
              left: convertMillimetersToTwip(12),
            },
          },
        },
        children: [
          new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: rubric.title || 'Rúbrica', bold: true, size: 30 })] }),
          ...(rubric.description.trim()
            ? [new Paragraph({ spacing: { after: 160 }, children: textRuns(rubric.description, { size: 17, color: '555555' }) })]
            : [new Paragraph({ spacing: { after: 120 }, children: [] })]),
          new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: headerCells, tableHeader: true }), ...bodyRows] }),
          new Paragraph({
            spacing: { before: 200 },
            children: [new TextRun({ text: `${labels.total}: ____ / ${rubricMaxScore(rubric)}`, size: 18 })],
          }),
        ],
      },
    ],
  });
  return Packer.toBuffer(document);
}
