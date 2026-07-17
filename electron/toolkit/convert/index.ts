// Nodus Toolkit — the operation registry: maps each catalogued operation id to
// its implementation. The engine (toolkitJobs.ts) is generic; this is where the
// concrete work lives. Every module here is Electron-free (Node + libraries only,
// heavy deps imported lazily) so each can be unit-tested with esbuild + node:test.
//
// Operations are added phase by phase (see design/nodus-toolkit-plan.md):
//   F1 — file-checksum (proves the engine end-to-end with a dependency-light op)
//   F2 — PDF utilities (pdfOps)   F3 — documents (docs)
//   F4 — OCR (ocrOps)             F5 — images (imageOps)
//   F6 — text (textOps, incl. E4 checksums)
import type { ToolkitOpRegistry } from '../toolkitJobs';
import { pdfOps } from './pdfOps';
import { docOps } from './docs';
import { renderPdfOps } from './renderPdf';
import { ocrOps } from './ocrOps';
import { imageOps } from './imageOps';
import { textOps } from './textOps';

/** The full registry, assembled from every category module. */
export const TOOLKIT_REGISTRY: ToolkitOpRegistry = {
  ...pdfOps,
  ...docOps,
  ...renderPdfOps,
  ...ocrOps,
  ...imageOps,
  ...textOps,
};
