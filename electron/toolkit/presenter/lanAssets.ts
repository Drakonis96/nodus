import fs from 'node:fs';
import crypto from 'node:crypto';
import { openPdf } from '../../extraction/pdfjsLoader';

/** A session owns one PDF. No peer may supply a file path. Loaded only on Windows/Linux. */
export class LanPresenterAssets {
  private document: Promise<any> | null = null;
  private digest: Promise<string> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private cache = new Map<number, Buffer>();
  private cacheSize = 0;
  private disposed = false;

  constructor(readonly file: string, readonly size: number) {}

  hash(): Promise<string> {
    return this.digest ??= new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(this.file);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  preview(pageNumber: number): Promise<Buffer> {
    const render = async () => {
      if (this.disposed) throw new Error('Session ended');
      const cached = this.cache.get(pageNumber);
      if (cached) { this.cache.delete(pageNumber); this.cache.set(pageNumber, cached); return cached; }
      this.document ??= openPdf(this.file, { forRendering: true });
      const document = await this.document;
      if (this.disposed || pageNumber > document.numPages) throw new Error('Invalid page');
      const page = await document.getPage(pageNumber);
      try {
        const bounds = page.getViewport({ scale: 1 });
        const scale = Math.min(1280 / bounds.width, 1280 / bounds.height);
        if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid page bounds');
        const viewport = page.getViewport({ scale });
        const { createCanvas } = await import('@napi-rs/canvas');
        const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const jpeg = canvas.toBuffer('image/jpeg', 80);
        if (this.disposed || jpeg.length > 700_000) throw new Error('Preview unavailable');
        this.cache.set(pageNumber, jpeg); this.cacheSize += jpeg.length;
        while (this.cache.size > 8 || this.cacheSize > 8 * 1024 * 1024) {
          const first = this.cache.keys().next().value!;
          this.cacheSize -= this.cache.get(first)!.length; this.cache.delete(first);
        }
        return jpeg;
      } finally { page.cleanup(); }
    };
    const result = this.queue.then(render);
    this.queue = result.catch(() => {});
    return result;
  }

  dispose(): void {
    this.disposed = true; this.cache.clear(); this.cacheSize = 0;
    void this.queue.then(async () => { try { await (await this.document)?.destroy(); } catch { /* failed load */ } });
  }
}
