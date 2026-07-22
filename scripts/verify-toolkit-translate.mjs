// Reproducible visual fixtures for Nodus Translate. The output directory is
// deliberately disposable: render the DOCX/PDF, inspect every page, then remove it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import {
  Document, Footer, FootnoteReferenceRun, Header, HeadingLevel, ImageRun, Packer,
  Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(repoRoot, 'tmp', 'translate-visual-qa');
const bundleDir = path.join(outputDir, '.bundles');
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(bundleDir, { recursive: true });

const require = createRequire(import.meta.url);
function bundle(file, name, external = []) {
  const out = path.join(bundleDir, `${name}.cjs`);
  execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
    path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    `--alias:@shared=${path.join(repoRoot, 'shared')}`,
    ...external.map((value) => `--external:${value}`),
    `--outfile=${out}`,
  ], { cwd: repoRoot, stdio: 'inherit' });
  return require(out);
}

const documents = bundle('electron/toolkit/translate/documents.ts', 'documents', ['adm-zip']);
const facsimile = bundle('electron/toolkit/translate/facsimile.ts', 'facsimile', ['pdfjs-dist', '@napi-rs/canvas', 'pdf-lib']);

const replacements = [
  ['ENCABEZADO INSTITUCIONAL', 'INSTITUTIONAL HEADER'],
  ['Informe de investigacion', 'Research Report'],
  ['Contexto y objetivos', 'Context and Objectives'],
  ['Marco metodologico', 'Methodological Framework'],
  ['Resultados principales', 'Main Results'],
  ['Este documento comprueba la traduccion estructural', 'This document verifies structure-preserving translation'],
  ['manteniendo una parte en negrita', 'while keeping one part in bold'],
  ['El analisis combina fuentes primarias y evidencia visual.', 'The analysis combines primary sources and visual evidence.'],
  ['Las conclusiones conservan estilos, tablas e imagenes.', 'The conclusions retain styles, tables and images.'],
  ['Indicador', 'Metric'],
  ['Resultado', 'Result'],
  ['Cobertura', 'Coverage'],
  ['Alta', 'High'],
  ['Nota al pie con procedencia archivistica.', 'Footnote with archival provenance.'],
  ['Pie confidencial de prueba', 'Confidential test footer'],
  ['DOCUMENTO DE PRUEBA', 'TEST DOCUMENT'],
  ['Resumen ejecutivo', 'Executive Summary'],
  ['La investigacion cualitativa requiere rigor documental y trazabilidad.', 'Qualitative research requires documentary rigor and traceability.'],
  ['La imagen y la banda lateral deben permanecer exactamente en su posicion.', 'The image and side panel must remain exactly in place.'],
  ['Nota: muestra generada para verificar el modo facsimil.', 'Note: sample generated to verify facsimile mode.'],
  ['Pagina', 'Page'],
];

function translateWords(value) {
  return replacements.reduce((text, [source, target]) => text.replaceAll(source, target), value);
}

const adapterTranslate = async (segments) => segments.map((segment) => ({ ...segment, translated: translateWords(segment.text) }));

function buildIllustration() {
  const canvas = createCanvas(720, 320);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 720, 320);
  gradient.addColorStop(0, '#243b67');
  gradient.addColorStop(1, '#63c7b2');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 720, 320);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 46px sans-serif';
  ctx.fillText('NODUS', 48, 85);
  ctx.fillStyle = '#ffcf66';
  ctx.fillRect(50, 130, 170, 110);
  ctx.fillStyle = '#f4f7fb';
  ctx.beginPath();
  ctx.arc(360, 185, 58, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e96b73';
  ctx.fillRect(500, 115, 155, 140);
  return canvas.toBuffer('image/png');
}

async function buildAndTranslateDocx() {
  const illustration = buildIllustration();
  const doc = new Document({
    footnotes: {
      1: { children: [new Paragraph('Nota al pie con procedencia archivistica.')] },
    },
    sections: [{
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: 'ENCABEZADO INSTITUCIONAL', bold: true, color: '335B78' })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ children: [new TextRun({ text: 'Pie confidencial de prueba', italics: true, color: '777777' })] })] }) },
      children: [
        new Paragraph({ text: 'Informe de investigacion', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: 'Contexto y objetivos', heading: HeadingLevel.HEADING_2 }),
        new Paragraph({
          children: [
            new TextRun('Este documento comprueba la traduccion estructural, '),
            new TextRun({ text: 'manteniendo una parte en negrita', bold: true, color: '9B2C2C' }),
            new TextRun('.'),
            new FootnoteReferenceRun(1),
          ],
        }),
        new Paragraph({ text: 'Marco metodologico', heading: HeadingLevel.HEADING_3 }),
        new Paragraph('El analisis combina fuentes primarias y evidencia visual.'),
        new Paragraph({ children: [new ImageRun({ data: illustration, transformation: { width: 500, height: 222 }, type: 'png' })] }),
        new Paragraph({ text: 'Resultados principales', heading: HeadingLevel.HEADING_2 }),
        new Paragraph('Las conclusiones conservan estilos, tablas e imagenes.'),
        new Table({
          width: { size: 7600, type: WidthType.DXA },
          columnWidths: [3800, 3800],
          rows: [
            new TableRow({ children: [new TableCell({ width: { size: 3800, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: 'Indicador', bold: true })] })] }), new TableCell({ width: { size: 3800, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: 'Resultado', bold: true })] })] })] }),
            new TableRow({ children: [new TableCell({ width: { size: 3800, type: WidthType.DXA }, children: [new Paragraph('Cobertura')] }), new TableCell({ width: { size: 3800, type: WidthType.DXA }, children: [new Paragraph('Alta')] })] }),
          ],
        }),
      ],
    }],
  });
  const source = await Packer.toBuffer(doc);
  const sourcePath = path.join(outputDir, 'source-structured.docx');
  const translatedPath = path.join(outputDir, 'translated-structured.docx');
  fs.writeFileSync(sourcePath, source);
  const translated = await documents.translateDocxBytes(source, { translate: adapterTranslate });
  fs.writeFileSync(translatedPath, translated);
}

async function buildAndTranslatePdf() {
  const illustration = buildIllustration();
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const png = await pdf.embedPng(illustration);
  for (let index = 0; index < 2; index += 1) {
    const page = pdf.addPage([595, 842]);
    page.drawRectangle({ x: 0, y: 808, width: 595, height: 34, color: rgb(0.11, 0.21, 0.35) });
    page.drawText('DOCUMENTO DE PRUEBA', { x: 48, y: 820, size: 10, font: bold, color: rgb(1, 1, 1) });
    page.drawText(index === 0 ? 'Informe de investigacion' : 'Resultados principales', { x: 48, y: 754, size: 27, font: bold, color: rgb(0.10, 0.18, 0.30) });
    page.drawText(index === 0 ? 'Resumen ejecutivo' : 'Contexto y objetivos', { x: 48, y: 716, size: 17, font: bold, color: rgb(0.20, 0.42, 0.52) });
    page.drawText('La investigacion cualitativa requiere rigor documental y trazabilidad.', { x: 48, y: 676, size: 11, font: regular });
    page.drawImage(png, { x: 48, y: 376, width: 360, height: 160 });
    page.drawRectangle({ x: 430, y: 376, width: 115, height: 160, color: rgb(0.94, 0.82, 0.45), borderColor: rgb(0.42, 0.32, 0.12), borderWidth: 1 });
    page.drawText('42', { x: 462, y: 446, size: 38, font: bold, color: rgb(0.25, 0.19, 0.07) });
    page.drawText('La imagen y la banda lateral deben permanecer exactamente en su posicion.', { x: 48, y: 338, size: 11, font: regular });
    page.drawText('Nota: muestra generada para verificar el modo facsimil.', { x: 48, y: 72, size: 8, font: regular, color: rgb(0.35, 0.35, 0.35) });
    page.drawLine({ start: { x: 48, y: 54 }, end: { x: 545, y: 54 }, color: rgb(0.75, 0.75, 0.75), thickness: 0.5 });
    page.drawText(`Pagina ${index + 1}`, { x: 500, y: 34, size: 8, font: regular, color: rgb(0.35, 0.35, 0.35) });
  }
  const sourcePath = path.join(outputDir, 'source-facsimile.pdf');
  const translatedPath = path.join(outputDir, 'translated-facsimile.pdf');
  fs.writeFileSync(sourcePath, await pdf.save());
  const translated = await facsimile.buildFacsimilePdf(sourcePath, { translate: adapterTranslate });
  fs.writeFileSync(translatedPath, translated.data);
  fs.writeFileSync(path.join(outputDir, 'facsimile-report.json'), JSON.stringify({ pageCount: translated.pageCount, overflowPages: translated.overflowPages, warnings: translated.warnings }, null, 2));
}

await buildAndTranslateDocx();
await buildAndTranslatePdf();
fs.rmSync(bundleDir, { recursive: true, force: true });
console.log(outputDir);
