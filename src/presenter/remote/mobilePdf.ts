// PDF Presenter — pdfjs loader for the MOBILE remote page. Unlike the desktop
// windows (which get PDF bytes over the nodus IPC bridge), the phone is a plain
// browser served by the presenter's LAN server, so it streams the PDF from
// /api/pdf/:id. The worker is the bundled pdfjs worker, served from /assets by the
// same server — so the phone renders fully offline (no CDN).
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorker;

export function loadMobilePdf(url: string): Promise<PDFDocumentProxy> {
  return getDocument({ url }).promise;
}
