import { openPdfData, pageText } from '../extraction/pdfjsLoader';
import type { ExtractedWebPage } from './webPageExtract';

/** Text of a downloaded PDF, page by page, so a web citation can name its page. */
export async function extractPdfPage(data: Uint8Array, url: string, maxPages: number): Promise<ExtractedWebPage> {
  const document = await openPdfData(data);
  try {
    const info = await document.getMetadata().catch(() => null) as { info?: Record<string, unknown> } | null;
    const blocks = [];
    for (let number = 1; number <= Math.min(document.numPages, maxPages); number++) {
      const page = await document.getPage(number);
      const text = await pageText(page);
      page.cleanup();
      // Lines become paragraphs where a new one starts; running lines are joined.
      for (const part of text.split(/\n\s*\n|\n(?=[A-ZÁÉÍÓÚÑ0-9][^\n]{0,80}\n)/)) {
        const paragraph = part.replace(/\s*\n\s*/g, ' ').trim();
        if (paragraph.length >= 25) blocks.push({ heading: null, text: paragraph, pageNumber: number });
      }
    }
    const declared = typeof info?.info?.Title === 'string' ? info.info.Title.trim() : '';
    const title = declared.length > 3 ? declared.slice(0, 300) : decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '').slice(0, 200);
    return { kind: 'pdf', title, siteName: null, byline: typeof info?.info?.Author === 'string' && info.info.Author.trim() ? info.info.Author.slice(0, 300) : null,
      publishedAt: null, doi: null, pdfUrl: null, language: null, blocks, challenge: false };
  } finally { await document.destroy(); }
}
