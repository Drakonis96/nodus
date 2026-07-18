import { trueFalseAnswer, renderExamHtml } from '@shared/examHtml';
import { htmlToPdfBytes } from './htmlToPdf';
import {
  examAnswerLines,
  examDocumentLabels,
  examOptionLetter,
  examQuestionTypeDef,
  examExportContent,
  examTotalPoints,
  flattenExamBlocks,
  formatExamPoints,
  groupExamQuestions,
  type ExamExportOptions,
  type ExamQuestion,
  type TeachingExam,
} from '@shared/teachingExams';

/* ------------------------------------------------------------------ PDF ---- */

/**
 * The PDF is the exam HTML printed by Chromium, so the printed paper and the builder's
 * live preview come from one renderer.
 */
export async function examPdfBytes(exam: TeachingExam, questions: ExamQuestion[], options: ExamExportOptions = {}): Promise<Buffer> {
  return htmlToPdfBytes(renderExamHtml(exam, questions, options));
}

/* ----------------------------------------------------------------- DOCX ---- */

function dataUrlToBuffer(dataUrl: string): { bytes: Buffer; type: 'png' | 'jpg' | 'gif' | 'bmp' } | null {
  const match = /^data:image\/(png|jpe?g|gif|bmp|webp);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  const kind = match[1].toLowerCase();
  // Word has no WebP support; those images are skipped rather than corrupting the file.
  const type = kind === 'png' ? 'png' : kind === 'gif' ? 'gif' : kind === 'bmp' ? 'bmp' : kind.startsWith('jp') ? 'jpg' : null;
  if (!type) return null;
  return { bytes: Buffer.from(match[2], 'base64'), type };
}

/**
 * Intrinsic pixel size of a PNG/JPEG/GIF/BMP, so images keep their aspect ratio in the
 * .docx (docx requires an explicit width/height and has no decoder of its own).
 */
export function imagePixelSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return { width: bytes.readInt32LE(18), height: Math.abs(bytes.readInt32LE(22)) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      // SOF0..SOF15, excluding the non-frame markers DHT(c4) / JPG(c8) / DAC(cc).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  return null;
}

/** Scale an image into a box while preserving aspect ratio. */
export function fitImage(size: { width: number; height: number } | null, maxWidth: number, maxHeight: number): { width: number; height: number } {
  if (!size || !size.width || !size.height) return { width: maxWidth, height: maxHeight };
  const ratio = Math.min(maxWidth / size.width, maxHeight / size.height, 1);
  return { width: Math.max(1, Math.round(size.width * ratio)), height: Math.max(1, Math.round(size.height * ratio)) };
}

export async function examDocxBytes(exam: TeachingExam, questions: ExamQuestion[], options: ExamExportOptions = {}): Promise<Buffer> {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    ImageRun,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
    convertMillimetersToTwip,
  } = await import('docx');

  const labels = examDocumentLabels(exam.language);
  const header = exam.header;
  const content = examExportContent(options);
  const ordered = [...questions].sort((a, b) => a.position - b.position);
  const blocks = groupExamQuestions(ordered);
  const children: InstanceType<typeof Paragraph | typeof Table>[] = [];

  const noBorders = {
    top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  };

  const wantsPaper = content !== 'keyOnly';

  // ---- Header band: logos | title block | grade box ----
  const logoRuns = exam.logos
    .map((logo) => dataUrlToBuffer(logo.dataUrl))
    .filter((image): image is NonNullable<typeof image> => image !== null)
    .map((image) => new ImageRun({ data: image.bytes, type: image.type, transformation: fitImage(imagePixelSize(image.bytes), 110, 52) }));

  const titleRuns: InstanceType<typeof Paragraph>[] = [];
  if (header.institution.trim()) {
    // `allCaps` renders uppercase while keeping the teacher's own text in the file,
    // mirroring the HTML's `text-transform` instead of destroying the original casing.
    titleRuns.push(new Paragraph({ children: [new TextRun({ text: header.institution, allCaps: true, size: 17, color: '444444' })] }));
  }
  titleRuns.push(new Paragraph({ children: [new TextRun({ text: header.examTitle?.trim() || exam.title, bold: true, size: 32 })] }));
  const metaParts: string[] = [];
  if (header.subjectName.trim()) metaParts.push(header.subjectName);
  if (header.teachers.trim()) metaParts.push(header.teachers);
  if (header.durationMinutes) metaParts.push(`${labels.duration}: ${header.durationMinutes} ${labels.minutes}`);
  if (header.showPoints) metaParts.push(`${labels.total}: ${formatExamPoints(examTotalPoints(ordered), exam.language)}`);
  if (metaParts.length) {
    titleRuns.push(new Paragraph({ children: [new TextRun({ text: metaParts.join('  ·  '), size: 19, color: '444444' })] }));
  }

  const headerCells = [
    ...(logoRuns.length
      ? [new TableCell({ borders: noBorders, width: { size: 22, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: logoRuns })] })]
      : []),
    new TableCell({ borders: noBorders, width: { size: logoRuns.length ? 60 : 82, type: WidthType.PERCENTAGE }, children: titleRuns }),
    new TableCell({
      borders: noBorders,
      width: { size: 18, type: WidthType.PERCENTAGE },
      children: header.showGradeBox
        ? [
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: labels.grade, size: 17, color: '444444' })] }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              border: {
                top: { style: BorderStyle.SINGLE, size: 8, color: '111111' },
                bottom: { style: BorderStyle.SINGLE, size: 8, color: '111111' },
                left: { style: BorderStyle.SINGLE, size: 8, color: '111111' },
                right: { style: BorderStyle.SINGLE, size: 8, color: '111111' },
              },
              spacing: { before: 60, after: 260 },
              children: [new TextRun({ text: ' ' })],
            }),
          ]
        : [new Paragraph({ text: '' })],
    }),
  ];
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorders, rows: [new TableRow({ children: headerCells })] }));

  children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: '111111' } }, spacing: { after: 160 }, children: [] }));

  // ---- Student identification fields ----
  const fieldLine = (label: string, filler: number) => new TextRun({ text: `${label}: ${'_'.repeat(filler)}   `, size: 20 });
  const fieldRuns: InstanceType<typeof TextRun>[] = [];
  if (header.showStudentName) fieldRuns.push(fieldLine(labels.studentName, 40));
  if (header.showStudentId) fieldRuns.push(fieldLine(labels.studentId, 16));
  if (header.showGroup) fieldRuns.push(fieldLine(labels.group, 10));
  if (header.showDate) fieldRuns.push(fieldLine(labels.date, header.dateText.trim() ? 0 : 14));
  if (header.showDate && header.dateText.trim()) fieldRuns.push(new TextRun({ text: header.dateText, size: 20 }));
  if (wantsPaper && fieldRuns.length) children.push(new Paragraph({ spacing: { after: 160 }, children: fieldRuns }));

  if (wantsPaper && header.instructions.trim()) {
    children.push(
      new Paragraph({
        shading: { fill: 'F4F4F4' },
        spacing: { after: 200 },
        children: [new TextRun({ text: `${labels.instructions}: `, bold: true, size: 19 }), new TextRun({ text: header.instructions, size: 19 })],
      })
    );
  }

  // ---- Questions ----
  const ruledLine = (indent = 0) =>
    new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C4C4C4' } }, indent: { left: indent }, spacing: { before: 130, after: 0 }, children: [new TextRun({ text: ' ' })] });

  /**
   * One question, at top level or indented under a section statement. The numbers come
   * from `groupExamQuestions`, the same source the PDF and the on-screen preview use, so
   * the three documents can never disagree.
   */
  const pushQuestion = (question: ExamQuestion, number: string, nested: boolean) => {
    const indent = nested ? 300 : 0;
    const points = header.showPoints ? `   (${formatExamPoints(question.points, exam.language)})` : '';
    children.push(
      new Paragraph({
        spacing: { before: nested ? 140 : 220, after: 40 },
        indent: { left: indent },
        children: [
          new TextRun({ text: `${number}${nested ? ') ' : '. '}`, bold: true }),
          new TextRun({ text: question.prompt }),
          ...(points ? [new TextRun({ text: points, size: 17, color: '444444' })] : []),
        ],
      })
    );

    if (question.type === 'multiple_choice') {
      question.options.filter((option) => option.text.trim()).forEach((option, optionIndex) => {
        children.push(new Paragraph({ indent: { left: indent + 340 }, spacing: { after: 30 }, children: [new TextRun({ text: `☐  ${examOptionLetter(optionIndex)}) ${option.text}` })] }));
      });
    } else if (question.type === 'true_false') {
      children.push(new Paragraph({ indent: { left: indent + 340 }, children: [new TextRun({ text: `☐  ${labels.trueLabel}        ☐  ${labels.falseLabel}` })] }));
    } else if (question.type === 'matching') {
      const pairs = question.pairs.filter((pair) => pair.left.trim() && pair.right.trim());
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: noBorders,
          rows: [
            new TableRow({
              children: [labels.columnA, '', labels.columnB].map(
                (text) => new TableCell({ borders: noBorders, children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 17, color: '555555' })] })] })
              ),
            }),
            ...pairs.map(
              (pair, pairIndex) =>
                new TableRow({
                  children: [
                    new TableCell({ borders: noBorders, children: [new Paragraph({ children: [new TextRun({ text: `${pairIndex + 1}. ${pair.left}` })] })] }),
                    new TableCell({ borders: noBorders, width: { size: 16, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '•        •', color: '888888' })] })] }),
                    new TableCell({ borders: noBorders, children: [new Paragraph({ children: [new TextRun({ text: `${examOptionLetter(pairIndex)}) ${pair.right}` })] })] }),
                  ],
                })
            ),
          ],
        })
      );
    } else if (question.type === 'ordering') {
      question.items.filter((item) => item.trim()).forEach((item) => {
        children.push(new Paragraph({ indent: { left: indent + 340 }, spacing: { after: 30 }, children: [new TextRun({ text: `☐   ${item}` })] }));
      });
    } else if (question.type === 'image_comment') {
      const image = question.imageDataUrl ? dataUrlToBuffer(question.imageDataUrl) : null;
      if (image) {
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 100, after: 60 },
            children: [new ImageRun({ data: image.bytes, type: image.type, transformation: fitImage(imagePixelSize(image.bytes), 420, 300) })],
          })
        );
      }
      if (question.imageCaption.trim()) {
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: question.imageCaption, italics: true, size: 17, color: '555555' })] }));
      }
    }

    for (let line = 0; line < examAnswerLines(question); line += 1) children.push(ruledLine(indent));
  };

  for (const block of wantsPaper ? blocks : []) {
    if (block.section) {
      const points = header.showPoints ? `   (${formatExamPoints(block.points, exam.language)})` : '';
      children.push(
        new Paragraph({
          spacing: { before: 260, after: 60 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D5D5D5' } },
          children: [
            new TextRun({ text: `${block.number}. `, bold: true }),
            new TextRun({ text: block.section.prompt, bold: true }),
            ...(points ? [new TextRun({ text: points, size: 17, color: '444444' })] : []),
          ],
        })
      );
      const image = block.section.imageDataUrl ? dataUrlToBuffer(block.section.imageDataUrl) : null;
      if (image) {
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 100, after: 60 },
            children: [new ImageRun({ data: image.bytes, type: image.type, transformation: fitImage(imagePixelSize(image.bytes), 420, 300) })],
          })
        );
      }
      if (block.section.imageCaption.trim()) {
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: block.section.imageCaption, italics: true, size: 17, color: '555555' })] }));
      }
    }
    for (const entry of block.questions) pushQuestion(entry.question, entry.number, block.section != null);
  }

  // ---- Optional answer key, on its own page ----
  if (content !== 'exam') {
    children.push(new Paragraph({ pageBreakBefore: wantsPaper, spacing: { after: 140 }, children: [new TextRun({ text: labels.answerKey, bold: true, size: 26 })] }));
    flattenExamBlocks(blocks).forEach(({ question, number }) => {
      const def = examQuestionTypeDef(question.type);
      let answer = question.solution;
      if (question.type === 'multiple_choice') {
        const shownOptions = question.options.filter((option) => option.text.trim());
        const correct = shownOptions.findIndex((option) => option.correct);
        answer = [correct >= 0 ? `${examOptionLetter(correct)}) ${shownOptions[correct]?.text ?? ''}` : '', answer].filter(Boolean).join(' — ');
      } else if (question.type === 'true_false') {
        const tfAnswer = trueFalseAnswer(question);
        answer = [tfAnswer == null ? '' : tfAnswer ? labels.trueLabel : labels.falseLabel, answer].filter(Boolean).join(' — ');
      } else if (question.type === 'matching') {
        const pairs = question.pairs.filter((pair) => pair.left.trim() && pair.right.trim()).map((_, pairIndex) => `${pairIndex + 1}–${examOptionLetter(pairIndex)}`).join(', ');
        answer = [pairs, answer].filter(Boolean).join(' — ');
      } else if (question.type === 'ordering') {
        answer = [question.items.filter((item) => item.trim()).join(' → '), answer].filter(Boolean).join(' — ');
      }
      children.push(
        new Paragraph({
          spacing: { after: 70 },
          children: [
            new TextRun({ text: `${labels.question} ${number} `, bold: true, size: 19 }),
            new TextRun({ text: `(${def.label}): `, size: 19, color: '555555' }),
            new TextRun({ text: answer || '—', size: 19 }),
          ],
        })
      );
    });
  }

  const document = new Document({
    styles: { default: { document: { run: { font: 'Georgia', size: 23 } } } },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertMillimetersToTwip(16),
              right: convertMillimetersToTwip(15),
              bottom: convertMillimetersToTwip(18),
              left: convertMillimetersToTwip(15),
            },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(document);
}
