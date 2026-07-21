/* Nodus Protect redaction editor — TypeScript port of IDprotector v0.4.1
 * (MIT), with explicit lifecycle cleanup for React mounts. */

export type ProtectEditorTool = 'brush' | 'blur' | 'select' | 'pan' | 'crop';

export interface ProtectPoint { x: number; y: number }
export interface ProtectRect {
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
  type?: 'blur';
  blur?: number;
}

type UndoOperation =
  | { type: 'add'; index: number }
  | { type: 'delete'; index: number; rect: ProtectRect }
  | { type: 'update'; index: number; before: ProtectRect; after: ProtectRect };

export interface ProtectPage {
  base: HTMLCanvasElement;
  rects: ProtectRect[];
  undo: UndoOperation[];
  straighten: number;
  sourceName?: string;
  /** Internal lazy-raster state managed by the document engine. */
  deferred?: {
    loadOriginal: () => Promise<HTMLCanvasElement>;
    loaded: boolean;
    loading?: Promise<void>;
    snapshot?: Uint8Array;
  };
}

export interface ProtectCrop { x: number; y: number; w: number; h: number }

const REDACT_COLOR = '#000000';
const DEG = Math.PI / 180;
export const MIN_PROTECT_CROP = 24;

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No se pudo crear el lienzo de edición.');
  return context;
}

function whiteOut(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

export function cloneProtectRect(rect: ProtectRect): ProtectRect {
  return { ...rect };
}

export function fillRotatedRect(ctx: CanvasRenderingContext2D, rect: ProtectRect): void {
  ctx.save();
  ctx.translate(rect.cx, rect.cy);
  ctx.rotate(rect.angle);
  ctx.fillStyle = REDACT_COLOR;
  ctx.fillRect(-rect.w / 2, -rect.h / 2, rect.w, rect.h);
  ctx.restore();
}

export function blurRotatedRect(
  ctx: CanvasRenderingContext2D,
  page: ProtectPage,
  rect: ProtectRect,
  grayscale: boolean,
): void {
  const radius = Math.max(0.5, typeof rect.blur === 'number' ? rect.blur : 6);
  ctx.save();
  ctx.translate(rect.cx, rect.cy);
  ctx.rotate(rect.angle);
  ctx.beginPath();
  ctx.rect(-rect.w / 2, -rect.h / 2, rect.w, rect.h);
  ctx.clip();
  ctx.rotate(-rect.angle);
  ctx.translate(-rect.cx, -rect.cy);
  ctx.filter = `${grayscale ? 'grayscale(1) ' : ''}blur(${radius}px)`;
  ctx.drawImage(page.base, 0, 0);
  ctx.filter = 'none';
  ctx.restore();
}

export function paintProtectItem(
  ctx: CanvasRenderingContext2D,
  page: ProtectPage,
  item: ProtectRect,
  grayscale: boolean,
): void {
  if (item.type === 'blur') blurRotatedRect(ctx, page, item, grayscale);
  else fillRotatedRect(ctx, item);
}

export function paintProtectPage(ctx: CanvasRenderingContext2D, page: ProtectPage, grayscale: boolean): void {
  whiteOut(ctx, page.base.width, page.base.height);
  if (grayscale) ctx.filter = 'grayscale(1)';
  ctx.drawImage(page.base, 0, 0);
  if (grayscale) ctx.filter = 'none';
  for (const item of page.rects) paintProtectItem(ctx, page, item, grayscale);
}

export function rectFromTo(a: ProtectPoint, b: ProtectPoint, thickness: number): ProtectRect {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.6) return { cx: b.x, cy: b.y, w: thickness, h: thickness, angle: 0 };
  return {
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    w: length + thickness,
    h: thickness,
    angle: Math.atan2(dy, dx),
  };
}

function rectEndpoints(rect: ProtectRect): { a: ProtectPoint; b: ProtectPoint } {
  const dx = Math.cos(rect.angle) * rect.w / 2;
  const dy = Math.sin(rect.angle) * rect.w / 2;
  return {
    a: { x: rect.cx - dx, y: rect.cy - dy },
    b: { x: rect.cx + dx, y: rect.cy + dy },
  };
}

function localPoint(rect: ProtectRect, point: ProtectPoint): ProtectPoint {
  const dx = point.x - rect.cx;
  const dy = point.y - rect.cy;
  const cosine = Math.cos(rect.angle);
  const sine = Math.sin(rect.angle);
  return { x: dx * cosine + dy * sine, y: -dx * sine + dy * cosine };
}

function rectBounds(rect: ProtectRect): { minX: number; minY: number; maxX: number; maxY: number } {
  const cosine = Math.cos(rect.angle);
  const sine = Math.sin(rect.angle);
  const halfWidth = rect.w / 2;
  const halfHeight = rect.h / 2;
  const points = [
    { x: -halfWidth, y: -halfHeight }, { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight }, { x: -halfWidth, y: halfHeight },
  ].map((point) => ({
    x: rect.cx + point.x * cosine - point.y * sine,
    y: rect.cy + point.x * sine + point.y * cosine,
  }));
  return points.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function intersectsCrop(rect: ProtectRect, crop: ProtectCrop): boolean {
  const bounds = rectBounds(rect);
  return !(
    bounds.maxX < crop.x || bounds.minX > crop.x + crop.w
    || bounds.maxY < crop.y || bounds.minY > crop.y + crop.h
  );
}

function normalizeCrop(a: ProtectPoint, b: ProtectPoint, page: ProtectPage): ProtectCrop {
  const x1 = Math.max(0, Math.min(page.base.width, a.x));
  const y1 = Math.max(0, Math.min(page.base.height, a.y));
  const x2 = Math.max(0, Math.min(page.base.width, b.x));
  const y2 = Math.max(0, Math.min(page.base.height, b.y));
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

function drawIntoCanvas(
  source: HTMLCanvasElement,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, image: HTMLCanvasElement, canvas: HTMLCanvasElement) => void,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvasContext(canvas);
  whiteOut(ctx, canvas.width, canvas.height);
  draw(ctx, source, canvas);
  return canvas;
}

export function rotatedSize(width: number, height: number, degrees: number): {
  w: number; h: number; rad: number; cos: number; sin: number;
} {
  const radians = degrees * DEG;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    w: Math.ceil(Math.abs(width * cosine) + Math.abs(height * sine)),
    h: Math.ceil(Math.abs(width * sine) + Math.abs(height * cosine)),
    rad: radians,
    cos: cosine,
    sin: sine,
  };
}

function transformRect(rect: ProtectRect, transform: (point: ProtectPoint) => ProtectPoint, angleAdd: number): ProtectRect {
  const center = transform({ x: rect.cx, y: rect.cy });
  return { ...rect, cx: center.x, cy: center.y, angle: rect.angle + angleAdd };
}

export function rotateProtectPage(page: ProtectPage, direction: number): boolean {
  if (!page?.base) return false;
  const source = page.base;
  const oldWidth = source.width;
  const oldHeight = source.height;
  const clockwise = direction >= 0;
  page.base = drawIntoCanvas(source, oldHeight, oldWidth, (ctx, image, canvas) => {
    if (clockwise) {
      ctx.translate(canvas.width, 0);
      ctx.rotate(Math.PI / 2);
    } else {
      ctx.translate(0, canvas.height);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(image, 0, 0);
  });
  page.rects = page.rects.map((rect) => transformRect(rect, (point) => (
    clockwise
      ? { x: oldHeight - point.y, y: point.x }
      : { x: point.y, y: oldWidth - point.x }
  ), clockwise ? Math.PI / 2 : -Math.PI / 2));
  page.undo = [];
  return true;
}

export function straightenProtectPage(page: ProtectPage, degrees: number): boolean {
  if (!page?.base || Math.abs(degrees) < 0.05) return false;
  const source = page.base;
  const oldWidth = source.width;
  const oldHeight = source.height;
  const radians = degrees * DEG;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const newWidth = Math.ceil(Math.abs(oldWidth * cosine) + Math.abs(oldHeight * sine));
  const newHeight = Math.ceil(Math.abs(oldWidth * sine) + Math.abs(oldHeight * cosine));
  page.base = drawIntoCanvas(source, newWidth, newHeight, (ctx, image, canvas) => {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(radians);
    ctx.drawImage(image, -oldWidth / 2, -oldHeight / 2);
  });
  page.rects = page.rects.map((rect) => transformRect(rect, (point) => {
    const dx = point.x - oldWidth / 2;
    const dy = point.y - oldHeight / 2;
    return {
      x: newWidth / 2 + dx * cosine - dy * sine,
      y: newHeight / 2 + dx * sine + dy * cosine,
    };
  }, radians));
  page.undo = [];
  return true;
}

export function cropProtectPage(page: ProtectPage, crop: ProtectCrop): boolean {
  if (!page?.base || !crop) return false;
  const x = Math.max(0, Math.min(page.base.width - 1, Math.round(crop.x)));
  const y = Math.max(0, Math.min(page.base.height - 1, Math.round(crop.y)));
  const width = Math.max(1, Math.min(page.base.width - x, Math.round(crop.w)));
  const height = Math.max(1, Math.min(page.base.height - y, Math.round(crop.h)));
  if (width < MIN_PROTECT_CROP || height < MIN_PROTECT_CROP) return false;
  const source = page.base;
  page.base = drawIntoCanvas(source, width, height, (ctx, image) => {
    ctx.drawImage(image, x, y, width, height, 0, 0, width, height);
  });
  page.rects = page.rects
    .filter((rect) => intersectsCrop(rect, { x, y, w: width, h: height }))
    .map((rect) => ({ ...rect, cx: rect.cx - x, cy: rect.cy - y }));
  page.undo = [];
  return true;
}

export function cloneRedactionForPage(rect: ProtectRect, fromPage: ProtectPage, toPage: ProtectPage): ProtectRect {
  const scaleX = toPage.base.width / fromPage.base.width;
  const scaleY = toPage.base.height / fromPage.base.height;
  const average = (scaleX + scaleY) / 2;
  const ends = rectEndpoints(rect);
  const clone = rectFromTo(
    { x: ends.a.x * scaleX, y: ends.a.y * scaleY },
    { x: ends.b.x * scaleX, y: ends.b.y * scaleY },
    rect.h * average,
  );
  if (rect.type) clone.type = rect.type;
  if (typeof rect.blur === 'number') clone.blur = rect.blur * average;
  return clone;
}

interface EditState {
  mode: 'start' | 'end' | 'move';
  start: ProtectPoint;
  before: ProtectRect;
  anchor: ProtectPoint;
  thick: number;
  changed: boolean;
}

export class ProtectEditor {
  readonly host: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  page: ProtectPage | null = null;
  tool: ProtectEditorTool = 'brush';
  brush = 34;
  blurThickness = 52;
  blurIntensity = 8;
  scale = 1;
  fit = 1;
  tx = 0;
  ty = 0;
  readonly dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  grayscale = false;
  selectedIndex = -1;
  onChange?: () => void;
  onSelectionChange?: (rect: ProtectRect | null) => void;
  onCropChange?: (crop: ProtectCrop | null) => void;
  onPageChange?: () => void;
  onStraightenApplied?: () => void;

  private drawing = false;
  private anchor: ProtectPoint | null = null;
  private pending: ProtectRect | null = null;
  private editing: EditState | null = null;
  private cropRect: ProtectCrop | null = null;
  private cropDraft: ProtectCrop | null = null;
  private cropAnchor: ProtectPoint | null = null;
  private panStart: { x: number; y: number; tx: number; ty: number } | null = null;
  private pointers = new Map<number, ProtectPoint>();
  private pinch: { dist: number; cx: number; cy: number } | null = null;
  // Live size/intensity preview for the brush + blur tools: a translucent ghost of the
  // current thickness that follows the cursor and flashes at the page centre while the
  // slider is being dragged, so the user can gauge the size before committing a mark.
  private hoverPoint: ProtectPoint | null = null;
  private sizePreviewUntil = 0;
  private sizePreviewTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly resizeObserver: ResizeObserver;
  private readonly keyHandler: (event: KeyboardEvent) => void;

  constructor(host: HTMLElement) {
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'block touch-none select-none rounded-lg shadow-lg';
    this.ctx = canvasContext(this.canvas);
    host.appendChild(this.canvas);
    this.bindPointerEvents();
    this.resizeObserver = new ResizeObserver(() => this.relayout());
    this.resizeObserver.observe(host);
    this.keyHandler = (event) => {
      const tag = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && this.getSelectedRect()) {
        event.preventDefault();
        this.deleteSelected();
      }
    };
    globalThis.addEventListener('keydown', this.keyHandler);
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    globalThis.removeEventListener('keydown', this.keyHandler);
    if (this.sizePreviewTimer) clearTimeout(this.sizePreviewTimer);
    this.canvas.remove();
  }

  setPage(page: ProtectPage | null): void {
    if (page && typeof page.straighten !== 'number') page.straighten = 0;
    this.page = page;
    this.selectedIndex = -1;
    this.editing = null;
    this.cropRect = null;
    this.cropDraft = null;
    this.notifySelection();
    this.notifyCrop();
    this.relayout(true);
  }

  setTool(tool: ProtectEditorTool): void {
    if (tool === 'crop') this.bakeStraighten();
    this.tool = tool;
    if (tool !== 'select') {
      this.selectedIndex = -1;
      this.notifySelection();
    }
    if (tool !== 'brush' && tool !== 'blur') this.hoverPoint = null;
    this.render();
  }

  setBrush(value: number): void { this.brush = value; this.flashSizePreview(); }
  setBlurThickness(value: number): void { this.blurThickness = value; this.flashSizePreview(); }
  setBlurIntensity(value: number): void { this.blurIntensity = value; this.flashSizePreview(); }
  setGrayscale(value: boolean): void { this.grayscale = value; this.render(); }

  /** Show the size ghost at the page centre for a beat after a slider change. */
  private flashSizePreview(): void {
    if (this.tool !== 'brush' && this.tool !== 'blur') return;
    this.sizePreviewUntil = this.now() + 1100;
    this.render();
    if (this.sizePreviewTimer) clearTimeout(this.sizePreviewTimer);
    this.sizePreviewTimer = setTimeout(() => { this.sizePreviewTimer = null; this.render(); }, 1160);
  }

  private now(): number {
    return globalThis.performance?.now?.() ?? Date.now();
  }

  private currentStraighten(): number {
    return this.page && Math.abs(this.page.straighten || 0) >= 0.05 ? this.page.straighten : 0;
  }

  private pageSize(): { w: number; h: number; rad: number } {
    if (!this.page) return { w: 1, h: 1, rad: 0 };
    const degrees = this.currentStraighten();
    return degrees ? rotatedSize(this.page.base.width, this.page.base.height, degrees) : {
      w: this.page.base.width, h: this.page.base.height, rad: 0,
    };
  }

  private displayToBase(x: number, y: number): ProtectPoint {
    const degrees = this.currentStraighten();
    if (!degrees || !this.page) return { x, y };
    const size = this.pageSize();
    const cosine = Math.cos(size.rad);
    const sine = Math.sin(size.rad);
    const dx = x - size.w / 2;
    const dy = y - size.h / 2;
    return {
      x: this.page.base.width / 2 + dx * cosine + dy * sine,
      y: this.page.base.height / 2 - dx * sine + dy * cosine,
    };
  }

  private notifySelection(): void { this.onSelectionChange?.(this.getSelectedRect()); }
  private notifyCrop(): void { this.onCropChange?.(this.getCropRect()); }

  getSelectedRect(): ProtectRect | null {
    if (!this.page || this.selectedIndex < 0 || this.selectedIndex >= this.page.rects.length) return null;
    return this.page.rects[this.selectedIndex];
  }

  getCropRect(): ProtectCrop | null {
    return this.cropRect && this.cropRect.w >= MIN_PROTECT_CROP && this.cropRect.h >= MIN_PROTECT_CROP
      ? this.cropRect
      : null;
  }

  clearCrop(): void {
    this.cropRect = null;
    this.cropDraft = null;
    this.notifyCrop();
    this.render();
  }

  relayout(reset = false): void {
    if (!this.page) return;
    const hostWidth = this.host.clientWidth || 600;
    const compact = hostWidth < 560;
    const maxHeight = Math.min(globalThis.innerHeight * (compact ? 0.46 : 0.5), compact ? 420 : 620);
    const size = this.pageSize();
    this.fit = Math.min(hostWidth / size.w, maxHeight / size.h);
    const cssWidth = size.w * this.fit;
    const cssHeight = size.h * this.fit;
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.width = Math.round(cssWidth * this.dpr);
    this.canvas.height = Math.round(cssHeight * this.dpr);
    if (reset) { this.scale = 1; this.tx = 0; this.ty = 0; }
    this.clampPan();
    this.render();
  }

  private viewMatrix(): { s: number; tx: number; ty: number } {
    return { s: this.fit * this.scale * this.dpr, tx: this.tx, ty: this.ty };
  }

  private toImage(clientX: number, clientY: number): ProtectPoint {
    const bounds = this.canvas.getBoundingClientRect();
    const x = (clientX - bounds.left) * (this.canvas.width / bounds.width);
    const y = (clientY - bounds.top) * (this.canvas.height / bounds.height);
    const matrix = this.viewMatrix();
    return this.displayToBase((x - matrix.tx) / matrix.s, (y - matrix.ty) / matrix.s);
  }

  private hitTest(point: ProtectPoint): { index: number; part: 'start' | 'end' | 'move' } | null {
    if (!this.page) return null;
    const tolerance = Math.max(5, 12 / Math.max(this.fit * this.scale, 0.01));
    for (let index = this.page.rects.length - 1; index >= 0; index -= 1) {
      const rect = this.page.rects[index];
      const local = localPoint(rect, point);
      const onStart = Math.abs(local.x + rect.w / 2) <= tolerance * 1.8 && Math.abs(local.y) <= rect.h / 2 + tolerance;
      const onEnd = Math.abs(local.x - rect.w / 2) <= tolerance * 1.8 && Math.abs(local.y) <= rect.h / 2 + tolerance;
      if (onStart) return { index, part: 'start' };
      if (onEnd) return { index, part: 'end' };
      if (Math.abs(local.x) <= rect.w / 2 + tolerance && Math.abs(local.y) <= rect.h / 2 + tolerance) {
        return { index, part: 'move' };
      }
    }
    return null;
  }

  private clampPan(): void {
    const scale = this.fit * this.scale * this.dpr;
    const size = this.pageSize();
    const contentWidth = size.w * scale;
    const contentHeight = size.h * scale;
    if (contentWidth <= this.canvas.width) this.tx = (this.canvas.width - contentWidth) / 2;
    else this.tx = Math.min(0, Math.max(this.canvas.width - contentWidth, this.tx));
    if (contentHeight <= this.canvas.height) this.ty = (this.canvas.height - contentHeight) / 2;
    else this.ty = Math.min(0, Math.max(this.canvas.height - contentHeight, this.ty));
  }

  render(): void {
    if (!this.page) return;
    const matrix = this.viewMatrix();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.setTransform(matrix.s, 0, 0, matrix.s, matrix.tx, matrix.ty);
    this.ctx.save();
    const degrees = this.currentStraighten();
    if (degrees) {
      const size = this.pageSize();
      this.ctx.translate(size.w / 2, size.h / 2);
      this.ctx.rotate(size.rad);
      this.ctx.translate(-this.page.base.width / 2, -this.page.base.height / 2);
    }
    paintProtectPage(this.ctx, this.page, this.grayscale);
    if (this.pending) paintProtectItem(this.ctx, this.page, this.pending, this.grayscale);
    this.drawSelection(matrix);
    this.drawCrop(matrix);
    this.drawSizePreview(matrix);
    this.ctx.restore();
  }

  /** Translucent ghost of the brush/blur mark at the current thickness + blur intensity,
   *  shown under the cursor (hover) or at the page centre right after a slider change. */
  private drawSizePreview(matrix: { s: number }): void {
    if (!this.page || this.drawing || this.editing) return;
    if (this.tool !== 'brush' && this.tool !== 'blur') return;
    const point = this.hoverPoint ?? (this.now() < this.sizePreviewUntil
      ? { x: this.page.base.width / 2, y: this.page.base.height / 2 }
      : null);
    if (!point) return;
    const thickness = this.tool === 'blur' ? this.blurThickness : this.brush;
    const half = Math.min(this.page.base.width * 0.42, Math.max(70, thickness * 1.4));
    const preview = this.makeStroke({ x: point.x - half, y: point.y }, { x: point.x + half, y: point.y });
    this.ctx.save();
    this.ctx.globalAlpha = 0.55;
    paintProtectItem(this.ctx, this.page, preview, this.grayscale);
    this.ctx.restore();
    this.ctx.save();
    this.ctx.translate(preview.cx, preview.cy);
    this.ctx.rotate(preview.angle);
    this.ctx.lineWidth = Math.max(1, 1.5 / matrix.s);
    this.ctx.setLineDash([Math.max(4, 7 / matrix.s), Math.max(3, 4 / matrix.s)]);
    this.ctx.strokeStyle = '#f59e0b';
    this.ctx.strokeRect(-preview.w / 2, -preview.h / 2, preview.w, preview.h);
    this.ctx.restore();
  }

  private drawSelection(matrix: { s: number }): void {
    if (this.tool !== 'select') return;
    const rect = this.getSelectedRect();
    if (!rect) return;
    const line = Math.max(1, 2 / matrix.s);
    const handle = Math.max(4, 7 / matrix.s);
    const ends = rectEndpoints(rect);
    this.ctx.save();
    this.ctx.translate(rect.cx, rect.cy);
    this.ctx.rotate(rect.angle);
    this.ctx.lineWidth = line;
    this.ctx.strokeStyle = '#17c3d6';
    this.ctx.setLineDash([Math.max(4, 8 / matrix.s), Math.max(3, 5 / matrix.s)]);
    this.ctx.strokeRect(-rect.w / 2, -rect.h / 2, rect.w, rect.h);
    this.ctx.restore();
    this.ctx.save();
    this.ctx.lineWidth = line;
    this.ctx.strokeStyle = '#171512';
    this.ctx.fillStyle = '#ffffff';
    for (const point of [ends.a, ends.b]) {
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, handle, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  private drawCrop(matrix: { s: number }): void {
    if (!this.page) return;
    const crop = this.cropDraft || this.cropRect;
    if (!crop?.w || !crop.h) return;
    const line = Math.max(1, 2 / matrix.s);
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(0,0,0,0.42)';
    this.ctx.fillRect(0, 0, this.page.base.width, crop.y);
    this.ctx.fillRect(0, crop.y + crop.h, this.page.base.width, this.page.base.height - crop.y - crop.h);
    this.ctx.fillRect(0, crop.y, crop.x, crop.h);
    this.ctx.fillRect(crop.x + crop.w, crop.y, this.page.base.width - crop.x - crop.w, crop.h);
    this.ctx.lineWidth = line;
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.setLineDash([Math.max(6, 10 / matrix.s), Math.max(4, 6 / matrix.s)]);
    this.ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
    this.ctx.strokeStyle = '#17c3d6';
    this.ctx.setLineDash([]);
    this.ctx.strokeRect(crop.x + line, crop.y + line, Math.max(0, crop.w - line * 2), Math.max(0, crop.h - line * 2));
    this.ctx.restore();
  }

  zoomAt(factor: number, x: number, y: number): void {
    const oldScale = this.fit * this.scale * this.dpr;
    const imageX = (x - this.tx) / oldScale;
    const imageY = (y - this.ty) / oldScale;
    this.scale = Math.min(8, Math.max(1, this.scale * factor));
    const newScale = this.fit * this.scale * this.dpr;
    this.tx = x - imageX * newScale;
    this.ty = y - imageY * newScale;
    this.clampPan();
    this.render();
  }

  zoomButton(factor: number): void { this.zoomAt(factor, this.canvas.width / 2, this.canvas.height / 2); }
  resetView(): void { this.scale = 1; this.tx = 0; this.ty = 0; this.clampPan(); this.render(); }

  private makeStroke(a: ProtectPoint, b: ProtectPoint): ProtectRect {
    if (this.tool === 'blur') return { ...rectFromTo(a, b, this.blurThickness), type: 'blur', blur: this.blurIntensity };
    return rectFromTo(a, b, this.brush);
  }

  private beginStroke(point: ProtectPoint): void {
    this.drawing = true;
    this.anchor = point;
    this.pending = this.makeStroke(point, point);
    this.render();
  }

  private updateStroke(point: ProtectPoint): void {
    if (!this.drawing || !this.anchor) return;
    this.pending = this.makeStroke(this.anchor, point);
    this.render();
  }

  private commitStroke(): void {
    if (!this.drawing || !this.page) return;
    this.drawing = false;
    if (this.pending) {
      const index = this.page.rects.length;
      this.page.rects.push(this.pending);
      this.page.undo.push({ type: 'add', index });
      this.selectedIndex = index;
      this.notifySelection();
    }
    this.pending = null;
    this.anchor = null;
    this.render();
    this.onChange?.();
  }

  private beginEdit(hit: { index: number; part: 'start' | 'end' | 'move' }, point: ProtectPoint): void {
    if (!this.page) return;
    this.selectedIndex = hit.index;
    const rect = this.page.rects[hit.index];
    const ends = rectEndpoints(rect);
    this.editing = {
      mode: hit.part,
      start: point,
      before: cloneProtectRect(rect),
      anchor: hit.part === 'start' ? ends.b : ends.a,
      thick: rect.h,
      changed: false,
    };
    this.notifySelection();
    this.render();
  }

  private updateEdit(point: ProtectPoint): void {
    if (!this.page || !this.editing || this.selectedIndex < 0) return;
    const rect = this.page.rects[this.selectedIndex];
    const edit = this.editing;
    if (edit.mode === 'move') {
      Object.assign(rect, edit.before, {
        cx: edit.before.cx + point.x - edit.start.x,
        cy: edit.before.cy + point.y - edit.start.y,
      });
    } else {
      const next = rectFromTo(edit.anchor, point, edit.thick);
      Object.assign(rect, next, { w: Math.max(edit.thick, next.w), type: edit.before.type, blur: edit.before.blur });
    }
    edit.changed = true;
    this.render();
  }

  private commitEdit(): void {
    if (!this.page || !this.editing) return;
    const edit = this.editing;
    this.editing = null;
    if (edit.changed && this.selectedIndex >= 0) {
      this.page.undo.push({
        type: 'update', index: this.selectedIndex, before: edit.before,
        after: cloneProtectRect(this.page.rects[this.selectedIndex]),
      });
      this.onChange?.();
    }
  }

  deleteSelected(): boolean {
    if (!this.page || this.selectedIndex < 0 || this.selectedIndex >= this.page.rects.length) return false;
    const index = this.selectedIndex;
    const rect = this.page.rects.splice(index, 1)[0];
    this.page.undo.push({ type: 'delete', index, rect: cloneProtectRect(rect) });
    this.selectedIndex = -1;
    this.notifySelection();
    this.render();
    this.onChange?.();
    return true;
  }

  undo(): void {
    if (!this.page?.undo.length) return;
    const operation = this.page.undo.pop()!;
    if (operation.type === 'add') this.page.rects.splice(operation.index, 1);
    else if (operation.type === 'delete') this.page.rects.splice(operation.index, 0, cloneProtectRect(operation.rect));
    else this.page.rects[operation.index] = cloneProtectRect(operation.before);
    this.selectedIndex = -1;
    this.notifySelection();
    this.render();
    this.onChange?.();
  }

  applyCrop(): boolean {
    const crop = this.getCropRect();
    if (!crop || !this.page || !cropProtectPage(this.page, crop)) return false;
    this.selectedIndex = -1;
    this.cropRect = null;
    this.cropDraft = null;
    this.notifySelection();
    this.notifyCrop();
    this.relayout(true);
    this.onChange?.();
    this.onPageChange?.();
    return true;
  }

  rotatePage(direction: number): boolean {
    if (!this.page) return false;
    this.bakeStraighten();
    if (!rotateProtectPage(this.page, direction)) return false;
    this.selectedIndex = -1;
    this.cropRect = null;
    this.cropDraft = null;
    this.notifySelection();
    this.notifyCrop();
    this.relayout(true);
    this.onChange?.();
    this.onPageChange?.();
    return true;
  }

  bakeStraighten(): boolean {
    if (!this.page) return false;
    const degrees = this.page.straighten || 0;
    if (Math.abs(degrees) < 0.05) { this.page.straighten = 0; return false; }
    straightenProtectPage(this.page, degrees);
    this.page.straighten = 0;
    this.selectedIndex = -1;
    this.notifySelection();
    this.relayout(false);
    this.onStraightenApplied?.();
    this.onChange?.();
    this.onPageChange?.();
    return true;
  }

  setStraightenPreview(degrees: number): void {
    if (!this.page) return;
    const next = Math.abs(degrees) < 0.05 ? 0 : degrees;
    if (next === (this.page.straighten || 0)) return;
    this.page.straighten = next;
    if (next) {
      this.cropRect = null;
      this.cropDraft = null;
      this.drawing = false;
      this.pending = null;
      this.editing = null;
      this.notifyCrop();
    }
    this.relayout(false);
    this.onChange?.();
  }

  private bindPointerEvents(): void {
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', (event) => {
      try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic event */ }
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size === 2) {
        this.drawing = false; this.pending = null; this.editing = null; this.cropDraft = null;
        this.render(); this.startPinch(); return;
      }
      if (this.tool === 'pan') {
        this.panStart = { x: event.clientX, y: event.clientY, tx: this.tx, ty: this.ty };
        return;
      }
      const point = this.toImage(event.clientX, event.clientY);
      if (this.tool === 'crop') {
        this.cropAnchor = point;
        this.cropDraft = { x: point.x, y: point.y, w: 0, h: 0 };
        this.render();
        return;
      }
      if (this.tool === 'select') {
        const hit = this.hitTest(point);
        if (hit) this.beginEdit(hit, point);
        else { this.selectedIndex = -1; this.notifySelection(); this.render(); }
        return;
      }
      this.selectedIndex = -1;
      this.notifySelection();
      this.beginStroke(point);
    });

    canvas.addEventListener('pointermove', (event) => {
      if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size === 2) { this.movePinch(); return; }
      if (this.tool === 'pan' && this.panStart) {
        const bounds = canvas.getBoundingClientRect();
        const factor = canvas.width / bounds.width;
        this.tx = this.panStart.tx + (event.clientX - this.panStart.x) * factor;
        this.ty = this.panStart.ty + (event.clientY - this.panStart.y) * factor;
        this.clampPan(); this.render(); return;
      }
      const point = this.toImage(event.clientX, event.clientY);
      if (this.tool === 'crop' && this.cropDraft && this.cropAnchor && this.page) {
        this.cropDraft = normalizeCrop(this.cropAnchor, point, this.page); this.render(); return;
      }
      if (this.editing) { this.updateEdit(point); return; }
      if (this.drawing) { this.updateStroke(point); return; }
      // Idle over the page with the brush/blur tool: track the cursor for the size ghost.
      if (this.tool === 'brush' || this.tool === 'blur') { this.hoverPoint = point; this.render(); }
    });

    canvas.addEventListener('pointerleave', () => {
      if (this.hoverPoint) { this.hoverPoint = null; this.render(); }
    });

    const endPointer = (event: PointerEvent) => {
      try { if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); } catch { /* ignored */ }
      this.pointers.delete(event.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.tool === 'crop' && this.cropDraft) {
        if (this.cropDraft.w >= MIN_PROTECT_CROP && this.cropDraft.h >= MIN_PROTECT_CROP) {
          this.cropRect = this.cropDraft;
          this.notifyCrop();
        }
        this.cropDraft = null; this.cropAnchor = null; this.render();
      }
      if (this.editing) this.commitEdit();
      if (this.drawing) this.commitStroke();
      this.panStart = null;
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const bounds = canvas.getBoundingClientRect();
      const x = (event.clientX - bounds.left) * (canvas.width / bounds.width);
      const y = (event.clientY - bounds.top) * (canvas.height / bounds.height);
      this.zoomAt(event.deltaY < 0 ? 1.12 : 0.89, x, y);
    }, { passive: false });
  }

  private startPinch(): void {
    const points = Array.from(this.pointers.values());
    if (points.length < 2) return;
    this.pinch = {
      dist: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
      cx: (points[0].x + points[1].x) / 2,
      cy: (points[0].y + points[1].y) / 2,
    };
  }

  private movePinch(): void {
    if (!this.pinch) { this.startPinch(); return; }
    const points = Array.from(this.pointers.values());
    if (points.length < 2) return;
    const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    const bounds = this.canvas.getBoundingClientRect();
    const factor = this.canvas.width / bounds.width;
    const midpointX = (points[0].x + points[1].x) / 2;
    const midpointY = (points[0].y + points[1].y) / 2;
    this.zoomAt(
      distance / (this.pinch.dist || distance),
      (midpointX - bounds.left) * factor,
      (midpointY - bounds.top) * factor,
    );
    this.pinch = { dist: distance, cx: midpointX, cy: midpointY };
  }
}
