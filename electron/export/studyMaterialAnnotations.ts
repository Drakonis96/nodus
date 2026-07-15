import path from 'node:path';
import AdmZip from 'adm-zip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { StudyMaterialAnnotation, StudyMaterialContent, StudyMaterialDetail } from '../../shared/types';

function hexColor(value: string) {
  const match = /^#?([0-9a-f]{6})$/i.exec(value);
  const hex = match?.[1] ?? 'fde68a';
  return rgb(Number.parseInt(hex.slice(0, 2), 16) / 255, Number.parseInt(hex.slice(2, 4), 16) / 255, Number.parseInt(hex.slice(4, 6), 16) / 255);
}
function annotationLabel(annotation: StudyMaterialAnnotation): string {
  return annotation.kind === 'highlight' ? 'Resaltado' : annotation.kind === 'underline' ? 'Subrayado' : annotation.kind === 'brush' ? 'Pincel' : annotation.kind === 'sticky' ? 'Sticker' : 'Comentario';
}

function wrap(text: string, width = 82): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (`${line} ${word}`.trim().length > width && line) { lines.push(line); line = word; } else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  return lines;
}

export async function annotatedPdfBytes(content: StudyMaterialContent, material: StudyMaterialDetail): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(content.bytes, { ignoreEncryption: true });
  const pages = pdf.getPages();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const notes: Array<{ annotation: StudyMaterialAnnotation; number: number }> = [];
  for (const annotation of material.annotations) {
    const page = annotation.pageNumber ? pages[annotation.pageNumber - 1] : undefined;
    if (!page) { if (annotation.note) notes.push({ annotation, number: notes.length + 1 }); continue; }
    const width = page.getWidth(); const height = page.getHeight(); const color = hexColor(annotation.color);
    const rects = annotation.rects.length ? annotation.rects : annotation.rect ? [annotation.rect] : [];
    if (annotation.kind === 'highlight') {
      for (const rect of rects) page.drawRectangle({ x: rect.x * width, y: height - (rect.y + rect.height) * height, width: rect.width * width, height: rect.height * height, color, opacity: 0.38 });
    } else if (annotation.kind === 'underline') {
      for (const rect of rects) page.drawLine({ start: { x: rect.x * width, y: height - (rect.y + rect.height) * height }, end: { x: (rect.x + rect.width) * width, y: height - (rect.y + rect.height) * height }, color, thickness: annotation.thickness });
    } else if (annotation.kind === 'brush' && annotation.path.length > 1) {
      for (let index = 1; index < annotation.path.length; index += 1) page.drawLine({ start: { x: annotation.path[index - 1].x * width, y: height - annotation.path[index - 1].y * height }, end: { x: annotation.path[index].x * width, y: height - annotation.path[index].y * height }, color, thickness: annotation.thickness, opacity: 0.82 });
    }
    if ((annotation.kind === 'sticky' || annotation.kind === 'comment') && annotation.rect) {
      const number = notes.length + 1; notes.push({ annotation, number });
      const x = annotation.rect.x * width; const y = height - annotation.rect.y * height;
      page.drawRectangle({ x, y: y - 15, width: 15, height: 15, color, opacity: 0.95, borderColor: rgb(0.35, 0.25, 0.05), borderWidth: 0.6 });
      page.drawText(String(number), { x: x + 4, y: y - 11.5, size: 8, font: bold, color: rgb(0.15, 0.12, 0.05) });
    } else if (annotation.note) notes.push({ annotation, number: notes.length + 1 });
  }
  if (notes.length) {
    let page = pdf.addPage(); let y = page.getHeight() - 52;
    page.drawText('Anotaciones de Nodus', { x: 48, y, size: 18, font: bold, color: rgb(0.08, 0.32, 0.32) }); y -= 28;
    for (const { annotation, number } of notes) {
      const lines = [
        `${number}. ${annotationLabel(annotation)}${annotation.pageNumber ? ` - pagina ${annotation.pageNumber}` : ''}`,
        ...(annotation.selectedText ? wrap(`Texto: ${annotation.selectedText}`) : []),
        ...wrap(annotation.note),
      ];
      const required = lines.length * 14 + 14;
      if (y - required < 45) { page = pdf.addPage(); y = page.getHeight() - 48; }
      page.drawText(lines[0], { x: 48, y, size: 10, font: bold, color: rgb(0.2, 0.2, 0.2) }); y -= 15;
      for (const line of lines.slice(1)) { page.drawText(line, { x: 58, y, size: 9, font, color: rgb(0.25, 0.25, 0.25) }); y -= 13; }
      y -= 10;
    }
  }
  pdf.setProducer('Nodus');
  pdf.setSubject('Documento de estudio con anotaciones aplanadas compatibles');
  return pdf.save();
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function annotatedEpubBytes(content: StudyMaterialContent, material: StudyMaterialDetail): Uint8Array {
  const zip = new AdmZip(Buffer.from(content.bytes));
  const container = zip.readAsText('META-INF/container.xml');
  const opfPath = /full-path=["']([^"']+)["']/.exec(container)?.[1];
  if (!opfPath) throw new Error('El EPUB no contiene un paquete OPF válido.');
  const opf = zip.readAsText(opfPath);
  const annotationPath = path.posix.join(path.posix.dirname(opfPath), 'nodus-annotations.xhtml');
  const relativeAnnotationPath = path.posix.basename(annotationPath);
  const items = material.annotations.map((annotation, index) => `<article class="annotation ${annotation.kind}"><h2>${index + 1}. ${escapeHtml(annotationLabel(annotation))}${annotation.pageNumber ? ` · ${annotation.pageNumber}` : ''}</h2>${annotation.selectedText ? `<blockquote>${escapeHtml(annotation.selectedText)}</blockquote>` : ''}${annotation.note ? `<p>${escapeHtml(annotation.note)}</p>` : ''}</article>`).join('\n');
  const xhtml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Anotaciones de Nodus</title><style>body{font-family:serif;line-height:1.55;margin:6%;color:#222}.annotation{border-left:.35em solid #9ca3af;padding:.25em 1em;margin:1.5em 0}.highlight{border-color:#f6c453}.underline{border-color:#ef4444}.brush{border-color:#14b8a6}.sticky{border-color:#f59e0b}.comment{border-color:#6366f1}h1{color:#0f766e}h2{font-size:1em}blockquote{font-style:italic;color:#555}</style></head><body><h1>Anotaciones de Nodus</h1>${items || '<p>Este documento no contiene anotaciones.</p>'}</body></html>`;
  zip.addFile(annotationPath, Buffer.from(xhtml, 'utf8'));
  const manifestItem = `<item id="nodus-annotations" href="${relativeAnnotationPath}" media-type="application/xhtml+xml"/>`;
  const spineItem = '<itemref idref="nodus-annotations"/>';
  const updated = opf.replace(/<\/manifest>/i, `${manifestItem}</manifest>`).replace(/<\/spine>/i, `${spineItem}</spine>`);
  zip.updateFile(opfPath, Buffer.from(updated, 'utf8'));
  return new Uint8Array(zip.toBuffer());
}
