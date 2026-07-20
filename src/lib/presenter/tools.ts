// PDF Presenter — the annotation-tool overlays (flashlight, freehand draw, laser
// pointer, magnifier lens), painted over a slide "stage" element. Shared by the
// audience and presenter windows so both render identically; the messages come
// from local input or are relayed from the other window (ToolData in
// @shared/presenterState). Self-contained imperative DOM (no framework) so it can
// live over a React-managed canvas without fighting reconciliation.
import type { ToolData, ToolName, ToolSizes } from '@shared/presenterState';
import { DEFAULT_TOOL_SIZES } from '@shared/presenterState';

export class ToolOverlayController {
  private readonly root: HTMLDivElement;
  private readonly flashlight: HTMLDivElement;
  private readonly pointer: HTMLDivElement;
  private readonly drawCanvas: HTMLCanvasElement;
  private readonly zoom: HTMLDivElement;
  private readonly zoomCanvas: HTMLCanvasElement;
  private active: ToolName | null = null;
  private sizes: ToolSizes = { ...DEFAULT_TOOL_SIZES };
  private zoomFactor = 2;
  private drawing = false;
  private lastX = 0;
  private lastY = 0;

  constructor(
    private readonly stage: HTMLElement,
    private readonly getSlideCanvas: () => HTMLCanvasElement | null,
  ) {
    if (getComputedStyle(stage).position === 'static') stage.style.position = 'relative';

    this.root = document.createElement('div');
    Object.assign(this.root.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '5' } as CSSStyleDeclaration);

    this.flashlight = document.createElement('div');
    Object.assign(this.flashlight.style, { position: 'absolute', inset: '0', display: 'none' } as CSSStyleDeclaration);

    this.pointer = document.createElement('div');
    Object.assign(this.pointer.style, {
      position: 'absolute',
      display: 'none',
      borderRadius: '9999px',
      background: 'rgba(239,68,68,0.9)',
      boxShadow: '0 0 12px 3px rgba(239,68,68,0.7)',
      transform: 'translate(-50%,-50%)',
    } as CSSStyleDeclaration);

    this.drawCanvas = document.createElement('canvas');
    Object.assign(this.drawCanvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'none' } as CSSStyleDeclaration);

    this.zoom = document.createElement('div');
    Object.assign(this.zoom.style, {
      position: 'absolute',
      display: 'none',
      borderRadius: '9999px',
      overflow: 'hidden',
      border: '2px solid rgba(255,255,255,0.85)',
      boxShadow: '0 4px 18px rgba(0,0,0,0.5)',
      transform: 'translate(-50%,-50%)',
    } as CSSStyleDeclaration);
    this.zoomCanvas = document.createElement('canvas');
    Object.assign(this.zoomCanvas.style, { display: 'block', width: '100%', height: '100%' } as CSSStyleDeclaration);
    this.zoom.appendChild(this.zoomCanvas);

    this.root.append(this.flashlight, this.drawCanvas, this.pointer, this.zoom);
    stage.appendChild(this.root);
  }

  setActiveTool(tool: ToolName | null): void {
    this.active = tool;
    this.flashlight.style.display = tool === 'flashlight' ? 'block' : 'none';
    this.pointer.style.display = tool === 'pointer' ? 'block' : 'none';
    this.drawCanvas.style.display = tool === 'draw' ? 'block' : 'none';
    this.zoom.style.display = tool === 'zoom' ? 'block' : 'none';
    if (tool === 'draw') this.resizeDrawToStage();
  }

  setSize(tool: ToolName, size: number): void {
    this.sizes = { ...this.sizes, [tool]: size };
    if (tool === 'pointer' && this.active === 'pointer') this.applyPointerSize();
    if (tool === 'zoom' && this.active === 'zoom') this.applyZoomSize();
  }

  setZoomFactor(factor: number): void {
    this.zoomFactor = factor;
  }

  clearDraw(): void {
    const ctx = this.drawCanvas.getContext('2d');
    ctx?.clearRect(0, 0, this.drawCanvas.width, this.drawCanvas.height);
  }

  /** Match the draw canvas' pixel size to the stage (call on resize / slide change). */
  resizeDrawToStage(): void {
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    if (w > 0 && h > 0 && (this.drawCanvas.width !== w || this.drawCanvas.height !== h)) {
      this.drawCanvas.width = w;
      this.drawCanvas.height = h;
    }
  }

  applyToolData(data: ToolData): void {
    switch (data.tool) {
      case 'pointer':
        this.pointer.style.left = `${data.x}%`;
        this.pointer.style.top = `${data.y}%`;
        if (data.size) this.sizes = { ...this.sizes, pointer: data.size };
        this.applyPointerSize();
        break;
      case 'flashlight': {
        const r = data.r ?? this.sizes.flashlight;
        this.flashlight.style.background =
          `radial-gradient(circle at ${data.x}% ${data.y}%, rgba(0,0,0,0) 0, rgba(0,0,0,0) ${r}%, rgba(0,0,0,0.85) ${r + 1}%)`;
        break;
      }
      case 'zoom':
        this.zoom.style.left = `${data.x}%`;
        this.zoom.style.top = `${data.y}%`;
        this.applyZoomSize();
        this.paintZoom(data.x ?? 50, data.y ?? 50);
        break;
      case 'draw':
        this.paintDraw(data);
        break;
    }
  }

  private applyPointerSize(): void {
    const s = Math.max(4, this.sizes.pointer);
    this.pointer.style.width = `${s}px`;
    this.pointer.style.height = `${s}px`;
  }

  private applyZoomSize(): void {
    const s = Math.max(40, this.sizes.zoom);
    this.zoom.style.width = `${s}px`;
    this.zoom.style.height = `${s}px`;
  }

  private paintZoom(xPercent: number, yPercent: number): void {
    const slide = this.getSlideCanvas();
    if (!slide || slide.width === 0) return;
    const lens = Math.max(40, this.sizes.zoom);
    this.zoomCanvas.width = lens;
    this.zoomCanvas.height = lens;
    const ctx = this.zoomCanvas.getContext('2d');
    if (!ctx) return;
    const srcSize = lens / this.zoomFactor;
    const srcX = (xPercent / 100) * slide.width - srcSize / 2;
    const srcY = (yPercent / 100) * slide.height - srcSize / 2;
    ctx.clearRect(0, 0, lens, lens);
    ctx.drawImage(slide, srcX, srcY, srcSize, srcSize, 0, 0, lens, lens);
  }

  private paintDraw(data: ToolData): void {
    if (this.drawCanvas.style.display === 'none') this.drawCanvas.style.display = 'block';
    this.resizeDrawToStage();
    const ctx = this.drawCanvas.getContext('2d');
    if (!ctx) return;
    const w = this.drawCanvas.width;
    const h = this.drawCanvas.height;
    if (data.action === 'start') {
      this.drawing = true;
      this.lastX = ((data.x ?? 0) * w) / 100;
      this.lastY = ((data.y ?? 0) * h) / 100;
    } else if (data.action === 'move' && this.drawing) {
      const nx = ((data.x ?? 0) * w) / 100;
      const ny = ((data.y ?? 0) * h) / 100;
      ctx.beginPath();
      ctx.moveTo(this.lastX, this.lastY);
      ctx.lineTo(nx, ny);
      ctx.strokeStyle = data.color ?? '#ef4444';
      ctx.lineWidth = data.lineWidth ?? Math.max(1, this.sizes.draw);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      this.lastX = nx;
      this.lastY = ny;
    } else if (data.action === 'end') {
      this.drawing = false;
    } else if (data.action === 'clear') {
      this.clearDraw();
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
