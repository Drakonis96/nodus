import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { BrowserWindow } from 'electron';

/**
 * Print a self-contained HTML document to PDF with Chromium.
 *
 * Shared by every "styled document" export (exams, rubrics) so they all inherit the
 * same two hard-won details:
 *
 *  - The HTML goes to a temp FILE, not a `data:` URL: logos and figures are inlined as
 *    base64 and would otherwise blow past the URL length limit.
 *  - The window is destroyed on the NEXT tick, never synchronously. Tearing it down the
 *    instant `printToPDF` resolves races Chromium's own cleanup, and the *following*
 *    export then dies with `ERR_FAILED (-2)` before loading anything — any URL scheme —
 *    followed by a SIGTRAP. Deferring one tick makes repeated exports reliable.
 *
 * Printer margins default to zero: the page box comes from the stylesheet's `@page`
 * rule, so the PDF matches the on-screen preview instead of stacking a second margin on
 * top of it. Callers whose stylesheet has no `@page` rule pass their own margins.
 */
export interface HtmlToPdfOptions {
  landscape?: boolean;
  /** Inches. Defaults to zero — see above. */
  margins?: { top: number; bottom: number; left: number; right: number };
}

export async function htmlToPdfBytes(html: string, options: HtmlToPdfOptions = {}): Promise<Buffer> {
  const file = path.join(os.tmpdir(), `nodus-doc-${crypto.randomUUID()}.html`);
  fs.writeFileSync(file, html, 'utf8');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await win.loadFile(file);
    return await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      landscape: options.landscape ?? false,
      margins: options.margins ?? { top: 0, bottom: 0, left: 0, right: 0 },
    });
  } finally {
    setImmediate(() => {
      if (!win.isDestroyed()) win.destroy();
      fs.rmSync(file, { force: true });
    });
  }
}
