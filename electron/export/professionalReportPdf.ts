import { PDFDocument, StandardFonts, rgb, LineCapStyle, type PDFPage } from 'pdf-lib';
// Only what this file uses itself. Everything the old callers imported from here is re-exported
// below, and a re-export needs no import of its own.
import {
  pdfSafe,
  renderProfessionalReportHtml,
  type ProfessionalReportInput,
} from '@shared/professionalReport';
import { htmlToPdfBytes } from './htmlToPdf';

// The design moved to `shared/professionalReport.ts` so the Nodus Server can serve the same
// document to a phone. What stays here is the half that needs this process: a real Chromium
// to print the HTML, and pdf-lib to stamp the running footer onto the printed pages.
//
// Re-exported so every existing caller keeps its import.
export {
  PROFESSIONAL_REPORT_THEMES,
  renderProfessionalReportHtml,
  anchoredMarkdown,
  reportLink,
  reportList,
} from '@shared/professionalReport';
export type {
  ProfessionalReportInput,
  ProfessionalReportMetric,
  ProfessionalReportSection,
  ProfessionalReportTheme,
  ProfessionalReportTocItem,
  AnchoredMarkdown,
} from '@shared/professionalReport';

function fitText(value: string, font: Awaited<ReturnType<PDFDocument['embedFont']>>, size: number, maxWidth: number): string {
  const text = pdfSafe(value);
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && font.widthOfTextAtSize(`${clipped}...`, size) > maxWidth) clipped = clipped.slice(0, -1);
  return `${clipped.trim()}...`;
}

// The Nodus brand mark: the same stylized "N" as the app icon — bold strokes
// with round caps and prominent nodes at each vertex, drawn taller than wide
// (28×32 in the source SVG) so it reads as the logo rather than a bare letter.
function drawNodusMark(page: PDFPage, centerX: number, y: number, accent: ReturnType<typeof rgb>): void {
  const halfW = 4.9;
  const halfH = 5.8;
  const left = centerX - halfW;
  const right = centerX + halfW;
  const bottom = y - halfH;
  const top = y + halfH;
  const stroke = { thickness: 2.4, color: accent, lineCap: LineCapStyle.Round };
  page.drawLine({ start: { x: left, y: bottom }, end: { x: left, y: top }, ...stroke });
  page.drawLine({ start: { x: left, y: top }, end: { x: right, y: bottom }, ...stroke });
  page.drawLine({ start: { x: right, y: bottom }, end: { x: right, y: top }, ...stroke });
  for (const [x, cy] of [[left, bottom], [left, top], [right, bottom], [right, top]] as const) {
    page.drawCircle({ x, y: cy, size: 2.5, color: accent });
  }
}

async function stampProfessionalPdf(bytes: Buffer, input: ProfessionalReportInput): Promise<Buffer> {
  const doc = await PDFDocument.load(bytes);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const accent = rgb(...input.theme.accentRgb);
  const gray = rgb(0.46, 0.49, 0.56);
  const line = rgb(0.84, 0.86, 0.9);
  const pages = doc.getPages();

  doc.setTitle(input.title);
  doc.setAuthor('Nodus');
  doc.setCreator('Nodus');
  doc.setProducer('Nodus Professional PDF');
  doc.setSubject(input.kindLabel);
  doc.setCreationDate(new Date());

  pages.forEach((page, index) => {
    const { width, height } = page.getSize();
    const margin = 56.7;
    const centerX = width / 2;
    const headerY = height - 25;
    // The cover is a clean title page: no header/footer rules framing the image.
    if (index === 0) return;
    page.drawLine({ start: { x: margin, y: height - 39 }, end: { x: centerX - 16, y: height - 39 }, thickness: 0.45, color: line });
    page.drawLine({ start: { x: centerX + 16, y: height - 39 }, end: { x: width - margin, y: height - 39 }, thickness: 0.45, color: line });
    drawNodusMark(page, centerX, headerY, accent);

    page.drawLine({ start: { x: margin, y: 39 }, end: { x: width - margin, y: 39 }, thickness: 0.45, color: line });
    const kind = fitText(input.kindLabel.toUpperCase(), bold, 6.5, 145);
    page.drawText(kind, { x: margin, y: 22, size: 6.5, font: bold, color: gray });
    const brand = 'NODUS';
    const brandWidth = bold.widthOfTextAtSize(brand, 6.5);
    page.drawText(brand, { x: width - margin - brandWidth, y: 22, size: 6.5, font: bold, color: accent });
    const pageLabel = `${index + 1} / ${pages.length}`;
    const pageWidth = regular.widthOfTextAtSize(pageLabel, 7.5);
    page.drawText(pageLabel, { x: centerX - pageWidth / 2, y: 21.5, size: 7.5, font: regular, color: gray });
  });

  return Buffer.from(await doc.save());
}

export async function professionalReportPdf(input: ProfessionalReportInput): Promise<Buffer> {
  const printed = await htmlToPdfBytes(renderProfessionalReportHtml(input));
  return stampProfessionalPdf(printed, input);
}
