/* Nodus Protect watermark renderer — faithful TypeScript port of the
 * IDprotector v0.4.1 MIT engine. */
import type { ProtectWatermark, ProtectWatermarkPattern } from '@shared/protectTypes';

export const PROTECT_PATTERNS: ReadonlyArray<{ id: ProtectWatermarkPattern; label: string }> = [
  { id: 'dense', label: 'Seguro' },
  { id: 'topographic', label: 'Topográfico' },
  { id: 'diagonal', label: 'Diagonal' },
  { id: 'mesh', label: 'Malla' },
  { id: 'grid', label: 'Rejilla' },
  { id: 'single', label: 'Central' },
  { id: 'manual', label: 'Manual' },
];

export const PROTECT_SWATCHES = ['#111111', '#e0362a', '#1d6fd6', '#178a4c', '#7a3ff2', '#8a8a8a'] as const;

export function defaultWatermark(): ProtectWatermark {
  return {
    enabled: true,
    text: '',
    pattern: 'dense',
    opacity: 0.18,
    size: 22,
    color: '#111111',
    footer: true,
    manual: {
      items: [{ text: '', x: 0.5, y: 0.82, angle: 0 }],
      randomizePerPage: false,
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fraction(value: number): number {
  return value - Math.floor(value);
}

export function manualPageOffset(pageIndex: number, itemIndex: number): { x: number; y: number } {
  const page = pageIndex || 0;
  const item = (itemIndex || 0) + 1;
  if (!page) return { x: 0, y: 0 };
  const amplitude = 0.17;
  const rx = fraction(Math.sin(page * 73.13 + item * 19.19) * 43758.5453) * 2 - 1;
  const ry = fraction(Math.sin(page * 11.71 + item * 97.37) * 15731.743) * 2 - 1;
  return { x: rx * amplitude, y: ry * amplitude };
}

interface TileOptions {
  text: string;
  color: string;
  alpha: number;
  fontPx: number;
  angle: number;
  diamonds: boolean;
  lineFactor: number;
  wave?: boolean;
}

function tile(ctx: CanvasRenderingContext2D, width: number, height: number, options: TileOptions): void {
  const angle = options.angle * Math.PI / 180;
  const diagonal = Math.hypot(width, height);
  ctx.save();
  ctx.globalAlpha = options.alpha;
  ctx.fillStyle = options.color;
  ctx.font = `600 ${options.fontPx}px Georgia, 'Times New Roman', serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.translate(width / 2, height / 2);
  ctx.rotate(angle);

  const separator = options.diamonds ? '   ◆   ' : '      ';
  const unit = options.text + separator;
  const unitWidth = Math.max(ctx.measureText(unit).width, 1);
  const lineHeight = options.fontPx * options.lineFactor;
  const repetitions = Math.ceil((diagonal * 1.4) / unitWidth) + 2;
  const row = unit.repeat(repetitions);
  const rowWidth = ctx.measureText(row).width;
  const amplitude = options.wave ? options.fontPx * 0.42 : 0;
  const waveK = 2 * Math.PI / (options.fontPx * 5.5);
  let rowIndex = 0;
  for (let y = -diagonal; y <= diagonal; y += lineHeight) {
    const offset = rowIndex % 2 === 0 ? 0 : unitWidth / 2;
    if (options.wave) drawWavyRow(ctx, row, -rowWidth / 2 - offset, y, amplitude, waveK, rowIndex * 1.3);
    else ctx.fillText(row, -rowWidth / 2 - offset, y);
    rowIndex += 1;
  }
  ctx.restore();
}

function drawWavyRow(
  ctx: CanvasRenderingContext2D,
  text: string,
  x0: number,
  y0: number,
  amplitude: number,
  waveK: number,
  phase: number,
): void {
  let penX = x0;
  for (const character of text) {
    const characterWidth = ctx.measureText(character).width;
    const centerX = penX + characterWidth / 2;
    const y = y0 + amplitude * Math.sin(centerX * waveK + phase);
    const slope = Math.atan(amplitude * waveK * Math.cos(centerX * waveK + phase));
    ctx.save();
    ctx.translate(centerX, y);
    ctx.rotate(slope);
    ctx.fillText(character, -characterWidth / 2, 0);
    ctx.restore();
    penX += characterWidth;
  }
}

function drawFieldRow(
  ctx: CanvasRenderingContext2D,
  text: string,
  x0: number,
  rowY: number,
  field: (x: number, y: number) => number,
): void {
  let penX = x0;
  for (const character of text) {
    const characterWidth = ctx.measureText(character).width;
    const centerX = penX + characterWidth / 2;
    const y = field(centerX, rowY);
    const slope = Math.atan2(field(centerX + 4, rowY) - field(centerX - 4, rowY), 8);
    ctx.save();
    ctx.translate(centerX, y);
    ctx.rotate(slope);
    ctx.fillText(character, -characterWidth / 2, 0);
    ctx.restore();
    penX += characterWidth;
  }
}

function topographic(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: Pick<TileOptions, 'text' | 'color' | 'alpha' | 'fontPx'>,
): void {
  const diagonal = Math.hypot(width, height);
  const fieldFor = (a1: number, a2: number, a3: number, phase: number) => {
    const k1 = 2 * Math.PI / (options.fontPx * 14);
    const k2 = 2 * Math.PI / (options.fontPx * 24);
    const k3 = 2 * Math.PI / (options.fontPx * 40);
    const ky1 = 2 * Math.PI / (options.fontPx * 20);
    const ky2 = 2 * Math.PI / (options.fontPx * 34);
    return (x: number, rowY: number) => rowY
      + a1 * Math.sin(x * k1 + rowY * ky1 + phase)
      + a2 * Math.sin(x * k2 - rowY * ky2 + phase * 1.7)
      + a3 * Math.cos((x * 0.7 + rowY * 1.6) * k3 + phase);
  };

  const pass = (
    angle: number,
    lineHeight: number,
    rowOffset: boolean,
    fontScale: number,
    alpha: number,
    field: (x: number, y: number) => number,
  ) => {
    const fontSize = options.fontPx * fontScale;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = options.color;
    ctx.font = `600 ${fontSize}px Georgia, 'Times New Roman', serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.translate(width / 2, height / 2);
    ctx.rotate(angle * Math.PI / 180);
    const unit = `${options.text}  ◆  `;
    const unitWidth = Math.max(ctx.measureText(unit).width, 1);
    const repetitions = Math.ceil((diagonal * 1.6) / unitWidth) + 2;
    const row = unit.repeat(repetitions);
    const rowWidth = ctx.measureText(row).width;
    for (let y = -diagonal; y <= diagonal; y += lineHeight) {
      drawFieldRow(ctx, row, -rowWidth / 2 - (rowOffset ? unitWidth / 2 : 0), y, field);
    }
    ctx.restore();
  };

  const lineHeight = options.fontPx * 1.5;
  pass(-12, lineHeight, false, 1, options.alpha, fieldFor(options.fontPx * 0.66, options.fontPx * 0.34, options.fontPx * 0.2, 0));
  pass(-12, lineHeight, true, 0.7, options.alpha * 0.5, fieldFor(options.fontPx * 0.58, options.fontPx * 0.3, options.fontPx * 0.18, 1.9));
}

function single(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: Pick<TileOptions, 'text' | 'color' | 'alpha' | 'fontPx'>,
): void {
  const diagonal = Math.hypot(width, height);
  ctx.save();
  ctx.globalAlpha = options.alpha;
  ctx.fillStyle = options.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-Math.PI / 6);
  let fontSize = options.fontPx * 3.2;
  ctx.font = `700 ${fontSize}px Georgia, serif`;
  let guard = 0;
  while (ctx.measureText(options.text).width > diagonal * 0.86 && fontSize > 8 && guard++ < 200) {
    fontSize -= 2;
    ctx.font = `700 ${fontSize}px Georgia, serif`;
  }
  ctx.fillText(options.text, 0, 0);
  ctx.restore();
}

function drawManualStamp(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  x: number,
  y: number,
  angle: number,
  text: string,
  options: Pick<TileOptions, 'color' | 'alpha' | 'fontPx'>,
): void {
  let fontSize = options.fontPx * 1.55;
  const maxWidth = width * 0.84;
  ctx.save();
  ctx.globalAlpha = options.alpha;
  ctx.fillStyle = options.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(x * width, y * height);
  ctx.rotate(angle);
  ctx.font = `700 ${fontSize}px Georgia, serif`;
  let guard = 0;
  while (ctx.measureText(text).width > maxWidth && fontSize > 8 && guard++ < 200) {
    fontSize -= 1;
    ctx.font = `700 ${fontSize}px Georgia, serif`;
  }
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function manual(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  watermark: ProtectWatermark,
  options: Pick<TileOptions, 'text' | 'color' | 'alpha' | 'fontPx'>,
  pageIndex: number,
): void {
  const items = watermark.manual?.items?.length
    ? watermark.manual.items
    : [{ text: '', x: 0.5, y: 0.82, angle: 0 }];
  items.forEach((item, index) => {
    let x = clamp(typeof item.x === 'number' ? item.x : 0.5, 0.03, 0.97);
    let y = clamp(typeof item.y === 'number' ? item.y : 0.82, 0.03, 0.97);
    if (watermark.manual?.randomizePerPage) {
      const offset = manualPageOffset(pageIndex, index);
      x = clamp(x + offset.x, 0.03, 0.97);
      y = clamp(y + offset.y, 0.03, 0.97);
    }
    const angle = clamp(typeof item.angle === 'number' ? item.angle : 0, -60, 60) * Math.PI / 180;
    const text = item.text?.trim() || options.text;
    drawManualStamp(ctx, width, height, x, y, angle, text, options);
  });
}
export interface WatermarkCopy {
  unauthorized: string;
  protectedWith: string;
  brand?: string;
  version?: string;
}

export function renderWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  watermark: ProtectWatermark,
  scale = 1,
  pageIndex = 0,
  copy: WatermarkCopy = { unauthorized: 'SIN AUTORIZAR', protectedWith: 'Protegido con' },
): void {
  if (!watermark?.enabled) return;
  const text = watermark.text?.trim() || copy.unauthorized;
  const fontPx = Math.max(6, watermark.size * scale);
  const color = watermark.color || '#111111';
  const alpha = clamp(watermark.opacity, 0.02, 0.95);
  const base = { text, color, fontPx };
  switch (watermark.pattern) {
    case 'single': single(ctx, width, height, { ...base, alpha }); break;
    case 'manual': manual(ctx, width, height, watermark, { ...base, alpha }, pageIndex); break;
    case 'topographic': topographic(ctx, width, height, { ...base, alpha }); break;
    case 'grid': tile(ctx, width, height, { ...base, angle: 0, alpha, diamonds: false, lineFactor: 2.6 }); break;
    case 'mesh':
      tile(ctx, width, height, { ...base, angle: -28, alpha: alpha * 0.8, diamonds: false, lineFactor: 2.4 });
      tile(ctx, width, height, { ...base, angle: 28, alpha: alpha * 0.8, diamonds: false, lineFactor: 2.4 });
      break;
    case 'diagonal': tile(ctx, width, height, { ...base, angle: -30, alpha, diamonds: true, lineFactor: 2.3 }); break;
    case 'dense':
    default:
      tile(ctx, width, height, { ...base, angle: -30, alpha, diamonds: true, lineFactor: 1.9, wave: true });
      tile(ctx, width, height, { ...base, fontPx: fontPx * 0.82, angle: 22, alpha: alpha * 0.62, diamonds: true, lineFactor: 2.5, wave: true });
      tile(ctx, width, height, { ...base, fontPx: fontPx * 0.7, angle: 0, alpha: alpha * 0.5, diamonds: false, lineFactor: 3.1, wave: true });
      break;
  }
  if (watermark.footer) drawFooter(ctx, width, height, scale, color, copy);
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number,
  color: string,
  copy: WatermarkCopy,
): void {
  const padding = 14 * scale;
  const fontSize = Math.max(9, 12 * scale);
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.font = `italic ${fontSize}px Georgia, serif`;
  ctx.textAlign = 'left';
  ctx.fillText(`${copy.protectedWith} ${copy.brand ?? 'Nodus Protect'}`, padding, height - padding);
  ctx.textAlign = 'right';
  ctx.globalAlpha = 0.65;
  ctx.font = `${fontSize}px Georgia, serif`;
  ctx.fillText(copy.version ?? 'Nodus', width - padding, height - padding);
  ctx.restore();
}

export function renderWatermarkThumbnail(
  canvas: HTMLCanvasElement,
  pattern: ProtectWatermarkPattern,
  color = '#111111',
  copy?: Partial<WatermarkCopy>,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  renderWatermark(ctx, canvas.width, canvas.height, {
    enabled: true,
    text: 'ID',
    pattern,
    opacity: 0.55,
    size: 7,
    color,
    footer: false,
    manual: { items: [{ text: '', x: 0.5, y: 0.68, angle: 0 }], randomizePerPage: false },
  }, 1, 0, {
    unauthorized: copy?.unauthorized ?? 'SIN AUTORIZAR',
    protectedWith: copy?.protectedWith ?? 'Protegido con',
    brand: copy?.brand,
    version: copy?.version,
  });
}
