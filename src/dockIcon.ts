// Dynamic macOS dock icon.
//
// The main process can't rasterise an SVG (no DOM), so the renderer draws the
// Nodus mark onto an offscreen canvas — background following the light/dark
// theme, the "N" tinted with the active vault's accent — and hands the PNG data
// URL to main via `window.nodus.setDockIcon`, which calls `app.dock.setIcon`.
//
// Fully dynamic: App re-invokes this whenever the theme or the active vault
// changes, so no icon variants need to be pre-baked at build time.

import markGeometry from '@shared/nodusMark.json';
import { vaultTypeColor } from '@shared/vaultTypes';

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [99, 102, 241]; // indigo fallback
  const int = parseInt(m[1], 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

function toHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((c) => clamp(c).toString(16).padStart(2, '0')).join('');
}

/** Mix `hex` toward white (amt>0) or black (amt<0) by |amt| (0..1). */
function shade(hex: string, amt: number): string {
  const [r, g, b] = parseHex(hex);
  const target = amt >= 0 ? 255 : 0;
  const t = Math.abs(amt);
  return toHex([r + (target - r) * t, g + (target - g) * t, b + (target - b) * t]);
}

/** Nodus "N" mark, tinted from a single accent colour (same geometry as the
 *  shipped brand SVGs). */
function markSvg(color: string): string {
  const light = shade(color, 0.55);
  const dark = shade(color, -0.4);
  const g = markGeometry;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.viewBoxSize} ${g.viewBoxSize}">
    <defs><linearGradient id="g" x1="${g.gradient.x1}" y1="${g.gradient.y1}" x2="${g.gradient.x2}" y2="${g.gradient.y2}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${light}"/>
      <stop offset="0.45" stop-color="${color}"/>
      <stop offset="1" stop-color="${dark}"/>
    </linearGradient></defs>
    <path d="M${g.leftX} ${g.bottomY}V${g.topY}L${g.rightX} ${g.bottomY}V${g.topY}" fill="none" stroke="url(#g)" stroke-width="${g.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${g.leftX}" cy="${g.topY}" r="${g.nodeRadius}" fill="${light}"/>
    <circle cx="${g.leftX}" cy="${g.bottomY}" r="${g.nodeRadius}" fill="${color}"/>
    <circle cx="${g.rightX}" cy="${g.bottomY}" r="${g.nodeRadius}" fill="${shade(color, -0.15)}"/>
    <circle cx="${g.rightX}" cy="${g.topY}" r="${g.nodeRadius}" fill="${dark}"/>
  </svg>`;
}

/**
 * Render the dock icon to a PNG data URL. Returns null if a canvas can't be
 * obtained or the SVG fails to decode (caller then leaves the icon untouched).
 */
export async function buildDockIconDataUrl(color: string, dark: boolean): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  const SIZE = 512;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Rounded-rect app-icon plate, with a transparent margin like other macOS icons.
  const inset = SIZE * markGeometry.plateInsetRatio;
  const x = inset;
  const y = inset;
  const w = SIZE - inset * 2;
  const h = SIZE - inset * 2;
  const radius = w * markGeometry.plateRadiusRatio;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  ctx.fillStyle = dark ? '#141417' : '#ffffff';
  ctx.fill();
  // Hairline edge so the white plate reads on a light dock and the dark plate
  // separates from a black dock.
  ctx.lineWidth = SIZE * 0.006;
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
  ctx.stroke();

  const img = new Image();
  img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(markSvg(color));
  try {
    await img.decode();
  } catch {
    return null;
  }
  const markSize = w * markGeometry.markScaleRatio;
  ctx.drawImage(img, x + (w - markSize) / 2, y + (h - markSize) / 2, markSize, markSize);

  return canvas.toDataURL('image/png');
}

/** Accent colour for a vault type — the app logos and the vault switcher use the same map. */
export function dockColorForVaultType(type: string | undefined): string {
  return vaultTypeColor(type);
}
