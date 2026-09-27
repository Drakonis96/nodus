import { parentPort } from './backgroundParentPort';
import { extractHtmlPage, extractTextPage } from '../websearch/webPageExtract';
import { extractPdfPage } from '../websearch/webPdfExtract';

/** Parses fetched web pages outside Electron's main process: a hostile or merely
 * huge page can cost seconds of DOM work, which must never freeze the window. */
type Request = { id: number; url: string; kind: 'html' | 'text' | 'pdf'; body: string | Uint8Array; maxPages: number };

parentPort?.on('message', async (request: Request) => {
  try {
    const page = request.kind === 'pdf' ? await extractPdfPage(request.body instanceof Uint8Array ? request.body : new Uint8Array(request.body as unknown as ArrayBufferLike), request.url, request.maxPages)
      : request.kind === 'text' ? extractTextPage(String(request.body), request.url) : extractHtmlPage(String(request.body), request.url);
    parentPort!.postMessage({ id: request.id, page });
  } catch (error) {
    parentPort!.postMessage({ id: request.id, error: error instanceof Error ? error.message.slice(0, 300) : 'extraction_failed' });
  }
});
