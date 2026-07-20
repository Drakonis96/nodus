// Nodus AI OCR — export a transcript to TXT / Markdown / HTML / EPUB. Electron-free and
// reuses the Toolkit's own building blocks (the shared Markdown→HTML converter and the
// zip writer) instead of pulling in a second stack. PDF is NOT here: it needs a
// BrowserWindow (printToPDF), so the wiring renders the HTML from transcriptToHtml with
// the app's htmlToPdf helper.
import { escapeHtml, markdownToHtml } from '@shared/toolkitMarkdown';
import type { AiOcrExportFormat } from '@shared/aiOcrTypes';
import { buildZip, crc32, type ZipEntry } from '../zip';

const enc = new TextEncoder();

export const AI_OCR_EXPORT_EXT: Record<AiOcrExportFormat, string> = {
  txt: 'txt', md: 'md', html: 'html', epub: 'epub', pdf: 'pdf',
};

/** A readable, light print/reader stylesheet — a clean re-layout, not a facsimile. */
const READER_CSS = `
  :root { color-scheme: light; }
  @page { margin: 2cm; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; line-height: 1.6; margin: 0 auto; max-width: 42rem; padding: 2rem; }
  h1,h2,h3,h4,h5,h6 { line-height: 1.25; margin: 1.5em 0 0.5em; font-weight: 600; font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
  h1 { font-size: 1.8em; } h2 { font-size: 1.45em; } h3 { font-size: 1.2em; }
  p, li { font-size: 12pt; } ul, ol { padding-left: 1.4em; }
  blockquote { border-left: 3px solid #ccc; margin: 1em 0; padding: 0.2em 1em; color: #555; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #bbb; padding: 0.4em 0.6em; text-align: left; font-size: 11pt; }
  th { background: #f2f2f2; }
  code { font-family: SFMono-Regular, Consolas, monospace; background: #f2f2f2; padding: 0.1em 0.3em; border-radius: 3px; }
  a { color: #1d4ed8; }
`;

/** Strip Markdown down to readable plain text (keeps code content, drops markers). */
export function markdownToPlainText(md: string): string {
  return md
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A self-contained HTML document — used both for HTML export and (via htmlToPdf) PDF. */
export function transcriptToHtml(md: string, title: string): string {
  return `<!doctype html>\n<html lang="es">\n<head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${READER_CSS}</style></head>\n<body>\n${markdownToHtml(md)}\n</body>\n</html>\n`;
}

function xhtmlChapter(title: string, bodyHtml: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/>' +
    `<title>${escapeHtml(title)}</title></head><body>\n${bodyHtml}\n</body></html>`
  );
}

/** Build a valid EPUB (OCF: mimetype first + STORED) from the transcript Markdown,
 *  splitting into chapters at top-level (#) headings. Mirrors the Convert MD→EPUB op. */
export function transcriptToEpubBytes(md: string, title: string): Uint8Array {
  const docTitle = md.match(/^#\s+(.*)$/m)?.[1]?.trim() || title || 'Documento';
  const sections: Array<{ title: string; body: string }> = [];
  let currentTitle = docTitle;
  let buf: string[] = [];
  const push = () => {
    if (buf.join('').trim()) sections.push({ title: currentTitle, body: markdownToHtml(buf.join('\n')) });
    buf = [];
  };
  for (const line of md.split('\n')) {
    const h1 = line.match(/^#\s+(.*)$/);
    if (h1) { push(); currentTitle = h1[1].trim(); }
    buf.push(line);
  }
  push();
  if (sections.length === 0) sections.push({ title: docTitle, body: markdownToHtml(md) });

  const manifestItems = sections
    .map((_, idx) => `<item id="c${idx + 1}" href="chap${idx + 1}.xhtml" media-type="application/xhtml+xml"/>`)
    .join('');
  const spineItems = sections.map((_, idx) => `<itemref idref="c${idx + 1}"/>`).join('');
  const uid = crc32(Buffer.from(md)).toString(16);
  const entries: ZipEntry[] = [
    { name: 'mimetype', data: Buffer.from('application/epub+zip'), store: true },
    {
      name: 'META-INF/container.xml',
      data: Buffer.from(
        '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
          '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      ),
      store: false,
    },
    {
      name: 'OEBPS/content.opf',
      data: Buffer.from(
        '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid">' +
          `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bid">urn:uuid:nodus-${uid}</dc:identifier>` +
          `<dc:title>${escapeHtml(docTitle)}</dc:title><dc:language>es</dc:language></metadata>` +
          `<manifest>${manifestItems}</manifest><spine>${spineItems}</spine></package>`,
      ),
      store: false,
    },
    ...sections.map((s, idx) => ({
      name: `OEBPS/chap${idx + 1}.xhtml`,
      data: Buffer.from(xhtmlChapter(s.title, s.body)),
      store: false,
    })),
  ];
  return new Uint8Array(buildZip(entries));
}

/** Non-PDF export bytes. PDF is handled by the wiring via transcriptToHtml + htmlToPdf. */
export function exportTranscriptBytes(md: string, format: Exclude<AiOcrExportFormat, 'pdf'>, title: string): Uint8Array {
  switch (format) {
    case 'txt': return enc.encode(markdownToPlainText(md) + '\n');
    case 'md': return enc.encode(md.endsWith('\n') ? md : md + '\n');
    case 'html': return enc.encode(transcriptToHtml(md, title));
    case 'epub': return transcriptToEpubBytes(md, title);
  }
}
