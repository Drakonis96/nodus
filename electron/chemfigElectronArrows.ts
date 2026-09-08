/** Measure anchors in their own molecular picture. The single-pass DVI engine
 * cannot resolve Chemfig's cross-picture remembered positions reliably. */
interface Point { x: number; y: number }
interface Anchor { name: string; color: string; bond: boolean }
interface Arrow { from: string; to: string; a: number; ar: number; b: number; br: number }
export interface ElectronArrowLayout { source: string; anchors: Anchor[]; arrows: Arrow[] }
type Matrix = [number, number, number, number, number, number];
const identity = (): Matrix => [1, 0, 0, 1, 0, 0];
function multiply(p: Matrix, q: Matrix): Matrix {
  return [p[0]*q[0]+p[2]*q[1], p[1]*q[0]+p[3]*q[1], p[0]*q[2]+p[2]*q[3], p[1]*q[2]+p[3]*q[3], p[0]*q[4]+p[2]*q[5]+p[4], p[1]*q[4]+p[3]*q[5]+p[5]];
}
function transform(tag: string): Matrix {
  const source = /\btransform="([^"]*)"/.exec(tag)?.[1] ?? '';
  let result = identity();
  const remaining = source.replace(/(matrix|translate|scale|rotate)\(([^)]*)\)/g, (_all, kind: string, values: string) => {
    const n = (values.match(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    let next: Matrix;
    if (kind === 'matrix' && n.length === 6) next = n as Matrix;
    else if (kind === 'translate' && n.length >= 1) next = [1, 0, 0, 1, n[0], n[1] ?? 0];
    else if (kind === 'scale' && n.length >= 1) next = [n[0], 0, 0, n[1] ?? n[0], 0, 0];
    else if (kind === 'rotate' && (n.length === 1 || n.length === 3)) {
      const a = n[0] * Math.PI / 180, x = n[1] ?? 0, y = n[2] ?? 0;
      next = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), x-x*Math.cos(a)+y*Math.sin(a), y-x*Math.sin(a)-y*Math.cos(a)];
    } else throw new Error('Unsupported electron anchor SVG transform.');
    result = multiply(result, next); return '';
  });
  if (remaining.trim()) throw new Error('Unsupported electron anchor SVG transform.');
  return result;
}

function group(source: string, start: number, open = '{', close = '}'): { content: string; end: number } {
  if (source[start] !== open) throw new Error('Malformed Chemfig group.');
  let depth = 1;
  for (let i = start + 1; i < source.length; i++) {
    if (source[i - 1] === '\\') continue;
    if (source[i] === open) depth++;
    if (source[i] === close && --depth === 0) return { content: source.slice(start + 1, i), end: i + 1 };
  }
  throw new Error('Unclosed Chemfig group.');
}

const lengthInPt = (value: string, unit: string) => Number(value) * (unit === 'mm' ? 72.27 / 25.4 : unit === 'cm' ? 72.27 / 2.54 : 1);

export function prepareElectronArrows(source: string): ElectronArrowLayout {
  const anchors: Anchor[] = [], arrows: Arrow[] = [];
  if (!/\\chemmove\b/.test(source)) return { source, anchors, arrows };
  const move = /\\chemmove\s*\{/.exec(source);
  if (!move) throw new Error('Electron arrows require a plain chemmove group.');
  const body = group(source, move.index + move[0].length - 1);
  const pattern = /\\draw\s*\[->\]\s*\(([a-zA-Z][\w-]*)\)\s*\.\.\s*controls\s*\+\((-?\d+(?:\.\d+)?):(\d+(?:\.\d+)?)(pt|mm|cm)\)\s*and\s*\+\((-?\d+(?:\.\d+)?):(\d+(?:\.\d+)?)(pt|mm|cm)\)\s*\.\.\s*\(([a-zA-Z][\w-]*)\)\s*;/g;
  const remainder = body.content.replace(pattern, (_all, from, a, ar, au, b, br, bu, to) => {
    arrows.push({ from, to, a: Number(a), ar: lengthInPt(ar, au), b: Number(b), br: lengthInPt(br, bu) });
    return '';
  });
  if (arrows.some(arrow => arrow.ar <= 0 || arrow.br <= 0 || arrow.ar > 200 || arrow.br > 200)) throw new Error('Electron-arrow control distances must be between 0 and 200pt.');
  if (remainder.trim() || !arrows.length || arrows.length > 30) throw new Error('Unsupported electron-arrow syntax. Use draw[->](source).. controls +(45:8mm) and +(135:8mm).. (target);');
  const clean = source.slice(0, move.index) + source.slice(body.end);
  if (/\\chemmove\b/.test(clean)) throw new Error('Use one final chemmove group.');
  let output = '', cursor = 0;
  const molecule = /\\chemfig\b/g;
  for (let match; (match = molecule.exec(clean));) {
    let start = molecule.lastIndex;
    while (start < clean.length && /\s/.test(clean[start])) start++;
    let options = '';
    if (clean[start] === '[') { const option = group(clean, start, '[', ']'); options = option.content; start = option.end; }
    while (start < clean.length && /\s/.test(clean[start])) start++;
    const content = group(clean, start);
    const local: Anchor[] = [];
    for (const marker of content.content.matchAll(/@\{([a-zA-Z][\w-]*)\}/g)) {
      if (!arrows.some(arrow => arrow.from === marker[1] || arrow.to === marker[1])) continue;
      if (anchors.some(anchor => anchor.name === marker[1])) throw new Error('Duplicate electron-flow anchor: ' + marker[1]);
      if (anchors.length >= 60) throw new Error('Too many electron-flow anchors.');
      const before = content.content.slice(0, marker.index);
      const color = (0x010200 + anchors.length + 1).toString(16).padStart(6, '0');
      const anchor = { name: marker[1], color, bond: before.lastIndexOf('[') > before.lastIndexOf(']') };
      anchors.push(anchor); local.push(anchor);
    }
    if (local.length) {
      if (/chemfig style|execute at end picture/.test(options)) throw new Error('Electron-arrow measurement cannot override custom picture hooks.');
      const marks = local.map(anchor => '\\path[fill={rgb,255:red,1;green,2;blue,' + parseInt(anchor.color.slice(4), 16) + '}] (' + anchor.name + ') rectangle +(0.01pt,0.01pt);').join('');
      options += (options ? ',' : '') + 'chemfig style={execute at end picture={' + marks + '}}';
    }
    output += clean.slice(cursor, match.index) + '\\chemfig' + (options ? '[' + options + ']' : '') + '{' + content.content + '}';
    cursor = content.end; molecule.lastIndex = content.end;
  }
  output += clean.slice(cursor);
  for (const arrow of arrows) for (const name of [arrow.from, arrow.to]) if (!anchors.some(anchor => anchor.name === name)) throw new Error('Unknown electron-flow anchor: ' + name);
  return { source: output, anchors, arrows };
}

export function overlayElectronArrows(svg: string, layout: ElectronArrowLayout): string {
  if (!layout.arrows.length) return svg;
  const points = new Map<string, Point>();
  const transforms: Matrix[] = [identity()];
  let clean = svg.replace(/<g\b[^>]*>|<\/g>|<path\b[^>]*\/>/g, tag => {
    if (tag.startsWith('<g')) { if (!tag.endsWith('/>')) transforms.push(multiply(transforms.at(-1)!, transform(tag))); return tag; }
    if (tag === '</g>') { transforms.pop(); return tag; }
    const color = /\bfill="#([\da-f]{6})"/i.exec(tag)?.[1].toLowerCase();
    const anchor = layout.anchors.find(item => item.color === color);
    if (!anchor) return tag;
    const location = /\bd="[Mm]\s*(-?\d*\.?\d+)[ ,]*(-?\d*\.?\d+)/.exec(tag);
    if (!location || points.has(anchor.name)) throw new Error('Electron anchor could not be measured uniquely.');
    const matrix = multiply(transforms.at(-1)!, transform(tag)), x = Number(location[1]), y = Number(location[2]);
    points.set(anchor.name, { x: matrix[0]*x+matrix[2]*y+matrix[4], y: matrix[1]*x+matrix[3]*y+matrix[5] });
    return '';
  });
  const allPoints: Point[] = [];
  const control = (origin: Point, angle: number, radius: number): Point => ({ x: origin.x + Math.cos(angle * Math.PI / 180) * radius, y: origin.y - Math.sin(angle * Math.PI / 180) * radius });
  const fmt = (point: Point) => point.x.toFixed(3) + ' ' + point.y.toFixed(3);
  const paths = layout.arrows.map(arrow => {
    const from = points.get(arrow.from), to = points.get(arrow.to);
    if (!from || !to) throw new Error('Electron arrow is missing its measured molecular anchor.');
    const c1 = control(from, arrow.a, arrow.ar), c2 = control(to, arrow.b, arrow.br);
    const begin = layout.anchors.find(anchor => anchor.name === arrow.from)!.bond ? from : control(from, arrow.a, Math.min(5.5, arrow.ar / 3));
    const end = layout.anchors.find(anchor => anchor.name === arrow.to)!.bond ? to : control(to, arrow.b, Math.min(5.5, arrow.br / 3));
    allPoints.push(begin, end, c1, c2);
    const angle = Math.atan2(end.y - c2.y, end.x - c2.x);
    const wing = (side: number) => ({ x: end.x - 3.4 * Math.cos(angle) + side * 1.4 * Math.sin(angle), y: end.y - 3.4 * Math.sin(angle) - side * 1.4 * Math.cos(angle) });
    return '<path d="M' + fmt(begin) + ' C' + fmt(c1) + ' ' + fmt(c2) + ' ' + fmt(end) + '" fill="none" stroke="#000" stroke-width="0.5"/><path d="M' + fmt(wing(-1)) + ' L' + fmt(end) + ' L' + fmt(wing(1)) + '" fill="none" stroke="#000" stroke-width="0.5"/>';
  }).join('');
  clean = clean.replace(/viewBox="([^"]+)"/, (_all, bounds: string) => {
    const [x, y, w, h] = bounds.split(/\s+/).map(Number);
    const left = Math.min(x, ...allPoints.map(point => point.x)), top = Math.min(y, ...allPoints.map(point => point.y));
    const right = Math.max(x + w, ...allPoints.map(point => point.x)), bottom = Math.max(y + h, ...allPoints.map(point => point.y));
    return 'viewBox="' + left + ' ' + top + ' ' + (right - left) + ' ' + (bottom - top) + '"';
  });
  return clean.replace('</svg>', '<g data-electron-flow="measured">' + paths + '</g></svg>');
}
