// Nodus Toolkit — A5, Markdown / HTML → PDF. This is the one conversion that is
// NOT Electron-free: it re-typesets the document with Nodus's own print CSS in a
// hidden BrowserWindow and captures it with printToPDF. That is asynchronous
// Chromium I/O (it never blocks the main event loop), so it runs in main. It is
// covered by the e2e run, not the unit suite (there is no headless printToPDF).
import fs from 'node:fs';
import path from 'node:path';
import { htmlToPdfBytes } from '../../export/htmlToPdf';
import { markdownToHtml } from '@shared/toolkitMarkdown';
import type { ToolkitOpRegistry } from '../toolkitJobs';
import type { ToolkitProduced } from '@shared/toolkitTypes';

// A neutral, readable print stylesheet — a "re-layout in Nodus's style", not a
// faithful reproduction of the source's original formatting.
const PRINT_CSS = `
  :root { color-scheme: light; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; line-height: 1.55; margin: 0; }
  h1,h2,h3,h4,h5,h6 { line-height: 1.25; margin: 1.4em 0 0.5em; font-weight: 600; }
  h1 { font-size: 1.9em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }
  p, li { font-size: 12pt; } ul, ol { padding-left: 1.4em; }
  code { font-family: SFMono-Regular, Consolas, monospace; background: #f2f2f2; padding: 0.1em 0.3em; border-radius: 3px; }
  pre { background: #f6f6f6; padding: 0.8em 1em; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #ccc; margin: 1em 0; padding: 0.2em 1em; color: #555; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #bbb; padding: 0.4em 0.6em; text-align: left; font-size: 11pt; }
  th { background: #f2f2f2; }
  a { color: #1d4ed8; }
`;

function buildPrintableHtml(input: string): string {
  const raw = fs.readFileSync(input, 'utf8');
  const ext = path.extname(input).toLowerCase();
  const body = ext === '.html' || ext === '.htm' ? raw.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '') || raw : markdownToHtml(raw);
  const title = path.basename(input, ext);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${title}</title><style>${PRINT_CSS}</style></head><body>${body}</body></html>`;
}

/**
 * Uses the shared helper so this converter inherits the deferred window teardown:
 * destroying the BrowserWindow synchronously after `printToPDF` races Chromium's own
 * cleanup and the NEXT conversion in the session fails with `ERR_FAILED (-2)` — which
 * matters here more than anywhere, since converting several files is the normal case.
 *
 * This stylesheet has no `@page` rule, so the printer margins have to come from here.
 */
async function renderToPdf(input: string): Promise<ToolkitProduced[]> {
  const pdf = await htmlToPdfBytes(buildPrintableHtml(input), {
    margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
  });
  return [{ data: new Uint8Array(pdf), ext: 'pdf' }];
}

export const renderPdfOps: ToolkitOpRegistry = {
  'text-to-pdf': { arity: 'each', run: ([input]) => renderToPdf(input) },
};
