import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { backgroundProcess, type BackgroundProcess } from '../workers/backgroundProcess';
import type { ExtractedWebPage } from './webPageExtract';
import type { FetchedWebPage } from './webFetch';

/** One extraction process per web step: pages are parsed off the main thread and
 * the process ends with the step (or with a cancellation). */
export class WebExtractionHost {
  private worker: BackgroundProcess | null = null;
  private next = 1;
  private readonly pending = new Map<number, { resolve: (page: ExtractedWebPage) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  private start(): BackgroundProcess {
    if (this.worker) return this.worker;
    const packaged = path.join(__dirname, 'webExtractionWorker.js');
    const worker = backgroundProcess(fs.existsSync(packaged) ? packaged : path.join(app.getAppPath(), 'dist-electron/webExtractionWorker.js'), 'Nodus web extraction');
    worker.on('message', (message: { id: number; page?: ExtractedWebPage; error?: string }) => {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.page) entry.resolve(message.page); else entry.reject(new Error(message.error ?? 'extraction_failed'));
    });
    const fail = (error: Error) => { for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); } this.pending.clear(); this.worker = null; };
    worker.on('error', error => fail(error instanceof Error ? error : new Error(String(error))));
    worker.on('exit', () => fail(new Error('extraction_worker_exited')));
    this.worker = worker;
    return worker;
  }

  extract(page: FetchedWebPage, signal: AbortSignal, maxPdfPages = 40, timeoutMs = 15_000): Promise<ExtractedWebPage> {
    if (signal.aborted) return Promise.reject(new Error('cancelled'));
    const worker = this.start();
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // A page that keeps the parser busy this long would also delay the next one.
        this.pending.delete(id); reject(new Error('extraction_timeout')); void this.close();
      }, timeoutMs);
      const abort = () => { if (this.pending.delete(id)) { clearTimeout(timer); reject(new Error('cancelled')); } };
      signal.addEventListener('abort', abort, { once: true });
      this.pending.set(id, { resolve: value => { signal.removeEventListener('abort', abort); resolve(value); }, reject: error => { signal.removeEventListener('abort', abort); reject(error); }, timer });
      worker.postMessage({ id, url: page.finalUrl, kind: page.kind, body: page.body, maxPages: maxPdfPages });
    });
  }

  async close(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate().catch(() => 0);
  }
}
