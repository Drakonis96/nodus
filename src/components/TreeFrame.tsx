import type { ReactNode } from 'react';

/**
 * Wooden portrait frames for the family tree, drawn as SVG so they live inside the
 * tree canvas. Each design is a wood gradient (defined once in TreeFrameDefs) with a
 * recessed inner opening and bevel highlights. Men and women get a subtly different
 * variant: women's frames are more rounded with a slim inner keyline; men's are
 * squarer with a slightly heavier border.
 */

interface WoodStops {
  a: string;
  b: string;
  c: string;
  d: string;
}

export const FRAME_WOODS: Record<string, WoodStops> = {
  oak: { a: '#c8934a', b: '#a0692e', c: '#b67c39', d: '#845528' },
  walnut: { a: '#6b4426', b: '#3f2513', c: '#573620', d: '#2e1b0e' },
  gilded: { a: '#e7c86c', b: '#a97f28', c: '#d3ab45', d: '#8a6a20' },
  rustic: { a: '#9c8568', b: '#6a5640', c: '#826d52', d: '#544634' },
};

/** Gradients for every frame design. Render once inside the tree <svg>. */
export function TreeFrameDefs() {
  return (
    <defs>
      {Object.entries(FRAME_WOODS).map(([id, w]) => (
        <linearGradient key={id} id={`frame-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={w.a} />
          <stop offset="35%" stopColor={w.c} />
          <stop offset="55%" stopColor={w.b} />
          <stop offset="78%" stopColor={w.c} />
          <stop offset="100%" stopColor={w.d} />
        </linearGradient>
      ))}
    </defs>
  );
}

export function TreeFrame({
  x,
  y,
  w,
  h,
  frame,
  sex,
  portrait,
  onClick,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  frame: string;
  sex: string;
  portrait: ReactNode;
  onClick?: () => void;
}) {
  const female = sex === 'female';
  const border = female ? 11 : 12;
  const rx = female ? 12 : 4;
  const innerRx = Math.max(0, rx - 3);
  const ix = x + border;
  const iy = y + border;
  const iw = w - 2 * border;
  const ih = h - 2 * border;

  return (
    <g onClick={onClick} style={{ cursor: onClick ? 'pointer' : undefined }}>
      {/* Wood body + drop of depth. */}
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={`url(#frame-${frame})`} stroke="#000000" strokeOpacity={0.35} strokeWidth={1} />
      {/* Recessed inner well behind the portrait. */}
      <rect x={ix - 2} y={iy - 2} width={iw + 4} height={ih + 4} rx={innerRx + 1} fill="#000000" fillOpacity={0.28} />
      {/* Portrait. */}
      <foreignObject x={ix} y={iy} width={iw} height={ih}>
        <div style={{ width: '100%', height: '100%', borderRadius: innerRx, overflow: 'hidden' }}>{portrait}</div>
      </foreignObject>
      {/* Bevels: outer highlight + inner shadow, plus the feminine keyline. */}
      <rect x={x + 1.5} y={y + 1.5} width={w - 3} height={h - 3} rx={rx} fill="none" stroke="#ffffff" strokeOpacity={0.18} strokeWidth={1} />
      <rect x={ix - 1} y={iy - 1} width={iw + 2} height={ih + 2} rx={innerRx} fill="none" stroke="#000000" strokeOpacity={0.45} strokeWidth={1.5} />
      {female && (
        <rect x={x + border / 2} y={y + border / 2} width={w - border} height={h - border} rx={rx - 2} fill="none" stroke="#ffffff" strokeOpacity={0.14} strokeWidth={1} />
      )}
    </g>
  );
}
