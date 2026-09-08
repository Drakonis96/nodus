import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Molecule } from 'openchemlib';
import { overlayElectronArrows, prepareElectronArrows } from './chemfigElectronArrows';

type Tex2Svg = (input: string, options?: {
  texPackages?: Record<string, string>;
  showConsole?: boolean;
  disableOptimize?: boolean;
}) => Promise<string>;

const nodeRequire = createRequire(import.meta.url);
let chemfigEngine: Tex2Svg | null = null;

const MAX_CHEMFIG_SOURCE = 8_000;
const MAX_SMILES_SOURCE = 1_000;
const COMPILE_TIMEOUT_MS = 15_000;
const MAX_CACHE_ENTRIES = 160;
const cache = new Map<string, string>();
// The TeX WASM engine is process-global and non-reentrant, including for old
// chat cards that compile concurrently through IPC. Never reuse it after a
// timeout: Promise.race cannot cancel the underlying WASM operation.
let compilationTail: Promise<unknown> = Promise.resolve();
let compilerTimedOut = false;

const VALENCE_ELECTRONS: Record<number, number> = {
  1: 1, 3: 1, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7,
  14: 4, 15: 5, 16: 6, 17: 7, 35: 7, 53: 7,
};

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Chemfig is intentionally narrower than arbitrary TeX. The WASM engine has no
// shell escape, host filesystem, or network access; this blocklist also rejects
// commands whose only purpose here would be escaping the drawing grammar.
const FORBIDDEN_TEX = /\\(?:input|include|write|read|openin|openout|catcode|(?:[gex])?def|let|csname|usepackage|RequirePackage|documentclass|special|immediate|directlua|latelua|pdfliteral|escapechar|loop|repeat)\b|\\begin\s*\{\s*document\s*\}/i;

function getChemfigEngine(): Tex2Svg {
  if (chemfigEngine) return chemfigEngine;
  const loaded = nodeRequire('node-tikzjax') as { default?: Tex2Svg } | Tex2Svg;
  const candidate = typeof loaded === 'function' ? loaded : loaded.default;
  if (typeof candidate !== 'function') throw new Error('The Chemfig compiler is unavailable.');
  chemfigEngine = candidate;
  return chemfigEngine;
}

function remember(key: string, svg: string): string {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, svg);
  return svg;
}

function decorateSvg(svg: string, title: string, description: string, paddingRatio = 0): string {
  let clean = svg.trim();
  if (!/^<svg[\s>]/i.test(clean) || clean.length > 300_000) throw new Error('The chemistry renderer produced no usable SVG.');
  let background = '<rect x="0" y="0" width="100%" height="100%" fill="#ffffff"/>';
  const viewBox = clean.match(/\bviewBox="([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)"/i);
  if (viewBox && paddingRatio > 0) {
    const [, rawX, rawY, rawWidth, rawHeight] = viewBox;
    const x = Number(rawX), y = Number(rawY), width = Number(rawWidth), height = Number(rawHeight);
    if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) {
      // node-tikzjax measures Computer Modern glyphs, while the sanitizer makes
      // the browser use its local fallback. Extra viewBox room prevents those
      // replacement glyphs and wedge endpoints from being clipped in previews.
      const pad = Math.max(14, Math.max(width, height) * paddingRatio);
      const next = [x - pad, y - pad, width + 2 * pad, height + 2 * pad];
      clean = clean.replace(viewBox[0], `viewBox="${next.map(value => value.toFixed(3)).join(' ')}"`)
        .replace(/\bwidth="[^"]*"/i, `width="${next[2].toFixed(3)}"`)
        .replace(/\bheight="[^"]*"/i, `height="${next[3].toFixed(3)}"`);
      background = `<rect x="${next[0].toFixed(3)}" y="${next[1].toFixed(3)}" width="${next[2].toFixed(3)}" height="${next[3].toFixed(3)}" fill="#ffffff"/>`;
    }
  }
  return clean.replace(/^(<svg\b[^>]*>)/i,
    `$1<title>${escapeXml(title)}</title><desc>${escapeXml(description)}</desc>${background}`);
}

function angularDistance(a: number, b: number): number {
  const delta = Math.abs(a - b) % (Math.PI * 2);
  return Math.min(delta, Math.PI * 2 - delta);
}

function normalizeHydrogenCoordinates(molecule: Molecule): void {
  const atomCount = molecule.getAllAtoms();
  const bonds = Array.from({ length: molecule.getAllBonds() }, (_, bond) => ({
    a: molecule.getBondAtom(0, bond),
    b: molecule.getBondAtom(1, bond),
  }));
  for (let parent = 0; parent < atomCount; parent++) {
    if (molecule.getAtomicNo(parent) === 1) continue;
    const neighbours = bonds.flatMap(({ a, b }) => a === parent ? [b] : b === parent ? [a] : []);
    const hydrogens = neighbours.filter(atom => molecule.getAtomicNo(atom) === 1);
    if (!hydrogens.length) continue;
    const px = molecule.getAtomX(parent), py = molecule.getAtomY(parent);
    const occupied = neighbours.filter(atom => molecule.getAtomicNo(atom) !== 1).map(atom =>
      Math.atan2(molecule.getAtomY(atom) - py, molecule.getAtomX(atom) - px));
    const chosen: number[] = [];
    const candidates = Array.from({ length: 24 }, (_, index) => index * Math.PI / 12);
    for (const hydrogen of hydrogens) {
      const angle = candidates.reduce((best, candidate) => {
        const score = Math.min(...[...occupied, ...chosen].map(other => angularDistance(candidate, other)), Math.PI);
        const bestScore = Math.min(...[...occupied, ...chosen].map(other => angularDistance(best, other)), Math.PI);
        return score > bestScore ? candidate : best;
      }, candidates[0]);
      chosen.push(angle);
      molecule.setAtomX(hydrogen, px + Math.cos(angle));
      molecule.setAtomY(hydrogen, py + Math.sin(angle));
    }
  }
}

/** Render explicit Lewis structures from a compact JSON request. Connectivity and
 * coordinates come from OpenChemLib; lone-pair counts are computed from valence,
 * formal charge and bond order rather than delegated to the language model. */
export async function compileLewis(source: string): Promise<string> {
  if (source.length > 8_000) throw new Error('Lewis structure request is too large to render.');
  let parsed: { structures?: Array<{ label?: unknown; smiles?: unknown }> };
  try { parsed = JSON.parse(source); } catch { throw new Error('Lewis structure data must be valid JSON.'); }
  const structures = parsed?.structures;
  if (!Array.isArray(structures) || structures.length < 1 || structures.length > 8) throw new Error('Lewis structure data must contain one to eight structures.');
  const clean = structures.map((item, index) => {
    const label = typeof item.label === 'string' ? item.label.trim().slice(0, 100) : `Structure ${index + 1}`;
    const smiles = typeof item.smiles === 'string' ? item.smiles.trim() : '';
    if (!smiles || smiles.length > MAX_SMILES_SOURCE || /\r|\n|```|>>>?/.test(smiles)) throw new Error(`Invalid SMILES for ${label}.`);
    let molecule: Molecule;
    try { molecule = Molecule.fromSmiles(smiles); } catch { throw new Error(`Could not parse the SMILES for ${label}.`); }
    molecule.inventCoordinates();
    // Coordinate invention intentionally removes implicit-H helper atoms, so it
    // must happen first. We then expand and place every H explicitly for Lewis
    // notation, including single-heavy-atom molecules such as H2S.
    molecule.addImplicitHydrogens();
    normalizeHydrogenCoordinates(molecule);
    return { label, smiles, molecule };
  });
  const key = `lewis:${createHash('sha256').update(JSON.stringify(clean.map(({ label, smiles }) => ({ label, smiles })))).digest('hex')}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const columns = clean.length === 1 ? 1 : 2;
  const rows = Math.ceil(clean.length / columns);
  const width = 960, panelWidth = width / columns, panelHeight = 350, height = 70 + rows * panelHeight;
  const groups: string[] = [];
  for (let panel = 0; panel < clean.length; panel++) {
    const { label, molecule } = clean[panel];
    const col = panel % columns, row = Math.floor(panel / columns);
    const panelX = col * panelWidth, panelY = 60 + row * panelHeight;
    const atomCount = molecule.getAllAtoms();
    const xs = Array.from({ length: atomCount }, (_, atom) => molecule.getAtomX(atom));
    const ys = Array.from({ length: atomCount }, (_, atom) => molecule.getAtomY(atom));
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
    const scale = Math.min(70, (panelWidth - 150) / spanX, (panelHeight - 120) / spanY);
    const offsetX = panelX + panelWidth / 2 - ((minX + maxX) / 2) * scale;
    const offsetY = panelY + panelHeight / 2 + 20 + ((minY + maxY) / 2) * scale;
    const point = (atom: number) => ({ x: offsetX + molecule.getAtomX(atom) * scale, y: offsetY - molecule.getAtomY(atom) * scale });
    const bonds: string[] = [];
    for (let bond = 0; bond < molecule.getAllBonds(); bond++) {
      const a = molecule.getBondAtom(0, bond), b = molecule.getBondAtom(1, bond);
      const pa = point(a), pb = point(b), order = Math.max(1, Math.min(3, molecule.getBondOrder(bond)));
      const length = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
      const nx = -(pb.y - pa.y) / length, ny = (pb.x - pa.x) / length;
      for (let line = 0; line < order; line++) {
        const shift = (line - (order - 1) / 2) * 6;
        bonds.push(`<line x1="${(pa.x + nx * shift).toFixed(1)}" y1="${(pa.y + ny * shift).toFixed(1)}" x2="${(pb.x + nx * shift).toFixed(1)}" y2="${(pb.y + ny * shift).toFixed(1)}" stroke="#111827" stroke-width="3" stroke-linecap="round"/>`);
      }
    }
    const atoms: string[] = [];
    for (let atom = 0; atom < atomCount; atom++) {
      const p = point(atom), atomicNo = molecule.getAtomicNo(atom), charge = molecule.getAtomCharge(atom);
      const base = molecule.getAtomLabel(atom);
      const chargeText = charge > 0 ? `${charge === 1 ? '' : charge}+` : charge < 0 ? `${charge === -1 ? '' : Math.abs(charge)}-` : '';
      atoms.push(`<text x="${p.x.toFixed(1)}" y="${(p.y + 8).toFixed(1)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" font-weight="600" fill="#111827" stroke="#ffffff" stroke-width="7" paint-order="stroke">${escapeXml(base + chargeText)}</text>`);
      let bondOrder = 0;
      const bondAngles: number[] = [];
      for (let bond = 0; bond < molecule.getAllBonds(); bond++) {
        const a = molecule.getBondAtom(0, bond), b = molecule.getBondAtom(1, bond);
        if (a !== atom && b !== atom) continue;
        bondOrder += molecule.getBondOrder(bond);
        const other = point(a === atom ? b : a);
        bondAngles.push(Math.atan2(other.y - p.y, other.x - p.x));
      }
      const electrons = (VALENCE_ELECTRONS[atomicNo] ?? 0) - charge - bondOrder;
      const pairs = Math.max(0, Math.min(4, Math.floor(electrons / 2)));
      const chosen: number[] = [];
      const candidates = Array.from({ length: 16 }, (_, index) => index * Math.PI / 8);
      for (let pair = 0; pair < pairs; pair++) {
        const angle = candidates.reduce((best, candidate) => {
          const score = Math.min(...[...bondAngles, ...chosen].map(other => angularDistance(candidate, other)), Math.PI);
          const bestScore = Math.min(...[...bondAngles, ...chosen].map(other => angularDistance(best, other)), Math.PI);
          return score > bestScore ? candidate : best;
        }, candidates[0]);
        chosen.push(angle);
        const cx = p.x + Math.cos(angle) * 28, cy = p.y + Math.sin(angle) * 28;
        const tx = -Math.sin(angle) * 4, ty = Math.cos(angle) * 4;
        atoms.push(`<circle cx="${(cx + tx).toFixed(1)}" cy="${(cy + ty).toFixed(1)}" r="2.6" fill="#111827"/><circle cx="${(cx - tx).toFixed(1)}" cy="${(cy - ty).toFixed(1)}" r="2.6" fill="#111827"/>`);
      }
    }
    groups.push(`<g><text x="${(panelX + 28).toFixed(1)}" y="${(panelY + 30).toFixed(1)}" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#13263a">${escapeXml(label)}</text>${bonds.join('')}${atoms.join('')}</g>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>Lewis structures</title><desc>Deterministic line-bond structures with calculated nonbonding electron pairs.</desc><rect width="${width}" height="${height}" fill="#ffffff"/>${groups.join('')}</svg>`;
  return remember(key, svg);
}

/** Deterministic SMILES to 2D SVG. OpenChemLib owns atom parsing, aromaticity,
 * stereochemistry and layout; the language model never positions bonds. */
export async function compileSmiles(smiles: string): Promise<string> {
  const source = String(smiles ?? '').trim();
  if (!source) throw new Error('Empty SMILES source.');
  if (source.length > MAX_SMILES_SOURCE) throw new Error('SMILES source is too large to render.');
  if (/\r|\n|```|>>>?/.test(source)) throw new Error('Use one molecular SMILES string without fences or reaction arrows.');
  const key = `smiles:${createHash('sha256').update(source).digest('hex')}`;
  const cached = cache.get(key);
  if (cached) return cached;
  let molecule: Molecule;
  try { molecule = Molecule.fromSmiles(source); }
  catch { throw new Error('Could not parse the SMILES structure.'); }
  if (molecule.getAllAtoms() < 1) throw new Error('SMILES describes no atoms.');
  molecule.inventCoordinates();
  const id = `nodus-molecule-${key.slice(7, 19)}`;
  const svg = molecule.toSVG(960, 640, id);
  return remember(key, decorateSvg(svg, 'Molecular structure', 'Deterministic two-dimensional structure rendered from SMILES.'));
}

/** Compile a narrowly scoped Chemfig drawing to SVG using the bundled WASM TeX
 * runtime. The returned SVG is still sanitized by ChatVisual before display. */
export async function compileChemfig(source: string): Promise<string> {
  const run = compilationTail.then(() => compileChemfigSerial(source));
  compilationTail = run.catch(() => undefined);
  return run;
}

async function compileChemfigSerial(source: string): Promise<string> {
  if (compilerTimedOut) throw new Error('ChemFig engine timed out; restart the application before compiling again.');
  const code = String(source ?? '').trim();
  if (!code) throw new Error('Empty Chemfig source.');
  if (code.length > MAX_CHEMFIG_SOURCE) throw new Error('Chemfig source is too large to render.');
  if (FORBIDDEN_TEX.test(code)) throw new Error('Unsupported TeX command in Chemfig source.');
  const drawable = /\\(?:chemfig|schemestart|chemname|lewis)\b/.test(code) ? code : `\\chemfig{${code}}`;
  const key = `chemfig:${createHash('sha256').update(drawable).digest('hex')}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const layout = prepareElectronArrows(drawable);
  // TeX's bundled input buffer is 5000 characters per line. Generated schemes
  // can be larger after adding measurement hooks; whitespace between molecules
  // is semantically inert and keeps every input line bounded.
  const input = `\\begin{document}\n${layout.source.replace(/\\chemfig\b/g, '\n\\chemfig')}\n\\end{document}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const raw = await Promise.race([
    getChemfigEngine()(input, { texPackages: { amsmath: '', chemfig: '' }, showConsole: process.env.NODUS_CHEMFIG_DEBUG === '1' }),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { compilerTimedOut = true; reject(new Error('Chemfig compilation timed out.')); }, COMPILE_TIMEOUT_MS);
    }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
  // The bundled DVI converter drops the stroke inside nested TikZ pictures
  // (notably schemestart). Bond paths survive, but inherit stroke="none" from
  // text groups. Restore the unfilled chemical paths before sanitization.
  const visible = overlayElectronArrows(raw, layout).replace(/<text\b([^>]*\bfont-family="cmsy\d+"[^>]*)>¡<\/text>/g,
    '<text$1>−</text>').replace(/<path\b[^>]*>/g, tag => /\bfill="none"/.test(tag) && !/\bstroke="(?!none")[^"]+"/.test(tag)
    ? tag.replace(/\s+stroke="[^"]*"/g, '').replace(/<path\b/, '<path stroke="#000"')
    : tag);
  return remember(key, decorateSvg(visible, 'Chemical structure', 'Static chemical drawing compiled from Chemfig notation.', 0.08));
}
