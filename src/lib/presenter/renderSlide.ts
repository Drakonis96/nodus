// PDF Presenter — fit-to-container slide rendering with last-wins cancellation.
// Shared by the audience and presenter windows. Each renderer owns one canvas and
// a generation counter: a newer render() supersedes any in-flight one, so holding
// an arrow key never queues hundreds of renders (part of the F7 performance story).
import type { PDFDocumentProxy } from 'pdfjs-dist';

export class FittedSlideRenderer {
  private generation = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly container: HTMLElement,
    /** Cap the render scale so a huge display doesn't rasterise absurd bitmaps. */
    private readonly maxScale = 2,
  ) {}

  /** Render `pageNum` fitted to the container. Safe to call rapidly. */
  async render(doc: PDFDocumentProxy, pageNum: number): Promise<void> {
    const gen = ++this.generation;
    let page;
    try {
      page = await doc.getPage(pageNum);
    } catch {
      return;
    }
    if (gen !== this.generation) {
      page.cleanup?.();
      return;
    }

    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    if (cw === 0 || ch === 0) {
      page.cleanup?.();
      return;
    }

    const base = page.getViewport({ scale: 1 });
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(cw / base.width, ch / base.height, this.maxScale);
    const viewport = page.getViewport({ scale: scale * dpr });

    // Render into a buffer first, then blit — avoids showing a half-painted canvas
    // when a fast navigation cancels mid-render.
    const buffer = document.createElement('canvas');
    buffer.width = Math.ceil(viewport.width);
    buffer.height = Math.ceil(viewport.height);
    const bctx = buffer.getContext('2d', { alpha: false });
    if (!bctx) {
      page.cleanup?.();
      return;
    }
    try {
      await page.render({ canvasContext: bctx, viewport }).promise;
    } catch {
      page.cleanup?.();
      return;
    } finally {
      page.cleanup?.();
    }
    if (gen !== this.generation) return;

    this.canvas.width = buffer.width;
    this.canvas.height = buffer.height;
    this.canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
    this.canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
    const ctx = this.canvas.getContext('2d', { alpha: false });
    ctx?.drawImage(buffer, 0, 0);
  }
}
