import { Molecule } from 'openchemlib';
import type { RDKitModule } from '@rdkit/rdkit';

export interface SceneAtom { id: string; element: string; charge: number; isotope: number; label: string; x: number; y: number; depth?: number }
export interface SceneBond { id: string; a: number; b: number; order: number; stereo: number; plain?: boolean }
export interface ChemicalScene { atoms: SceneAtom[]; bonds: SceneBond[]; convention?: 'fischer' | 'haworth'; description?: string; spatial?: Array<{ x: number; y: number; z: number }> }

export function sceneFromMolfile(molfile: string): ChemicalScene {
  const m = Molecule.fromMolfile(molfile);
  m.ensureHelperArrays(Molecule.cHelperCIP);
  return {
    atoms: Array.from({ length: m.getAllAtoms() }, (_, a) => {
      const element = m.getAtomLabel(a), h = m.getImplicitHydrogens(a), charge = m.getAtomCharge(a), isotope = m.getAtomMass(a);
      const label = `${isotope ? `^{${isotope}}` : ''}${element}${h ? `H${h > 1 ? `_${h}` : ''}` : ''}${charge ? `^{${Math.abs(charge) > 1 ? Math.abs(charge) : ''}${charge > 0 ? '+' : '-'}}` : ''}`;
      return { id: `a${a}`, element, charge, isotope, label, x: m.getAtomX(a), y: -m.getAtomY(a) };
    }),
    bonds: Array.from({ length: m.getAllBonds() }, (_, b) => ({ id: `b${b}`, a: m.getBondAtom(0, b), b: m.getBondAtom(1, b), order: m.getBondOrder(b),
      stereo: m.getBondType(b) === Molecule.cBondTypeUp ? 1 : m.getBondType(b) === Molecule.cBondTypeDown ? 6 : 0 })),
  };
}

/** Independent molfile writer: no OCL parity cache may override edited geometry. */
export function sceneMolfile(scene: ChemicalScene): string {
  const field = (n: number) => String(n).padStart(3);
  const xyz = (n: number) => n.toFixed(4).padStart(10);
  const is3D = scene.convention === 'haworth' || !!scene.spatial;
  const atoms = scene.atoms.map((a, i) => {
    // Haworth uses y(screen projection) = .45*y(ring plane) + .8*z.
    const z = scene.spatial?.[i].z ?? (is3D ? a.depth ?? 0 : 0);
    const y = scene.spatial?.[i].y ?? (is3D ? (a.y - .8 * z) / .45 : a.y);
    return `${xyz(scene.spatial?.[i].x ?? a.x)}${xyz(y)}${xyz(z)} ${a.element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`;
  });
  const bonds = scene.bonds.map(b => `${field(b.a + 1)}${field(b.b + 1)}${field(b.order)}${field(is3D ? 0 : b.stereo)}  0  0  0`);
  const props = scene.atoms.flatMap((a, i) => [
    ...(a.charge ? [`M  CHG  1${field(i + 1)}${field(a.charge)}`] : []),
    ...(a.isotope ? [`M  ISO  1${field(i + 1)}${field(a.isotope)}`] : []),
  ]);
  return `\n     Nodus          ${is3D ? '3D' : '2D'}\n\n${field(atoms.length)}${field(bonds.length)}  0  0  0  0  0  0  0  0999 V2000\n${[...atoms, ...bonds, ...props, 'M  END', ''].join('\n')}`;
}

export function canonicalScene(scene: ChemicalScene, kit: RDKitModule): string {
  const m = kit.get_mol(sceneMolfile(scene), JSON.stringify({ removeHs: true }));
  if (!m) throw new Error('The scene encodes an invalid chemical graph.');
  try { return m.get_smiles(); } finally { m.delete(); }
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const glyph = (s: string) => s.replace(/_([2-9])/g, (_, n) => '₀₁₂₃₄₅₆₇₈₉'[Number(n)]).replace(/\^\{([^}]+)\}/g, (_, text: string) => [...text].map(c => '0123456789+-'.includes(c) ? '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻'['0123456789+-'.indexOf(c)] : c).join(''));

export function renderScene(scene: ChemicalScene): string {
  const xs = scene.atoms.map(a => a.x), ys = scene.atoms.map(a => a.y);
  const minX = Math.min(...xs), maxY = Math.max(...ys), scale = 64;
  const w = Math.max(200, (Math.max(...xs) - minX) * scale + 100), h = (maxY - Math.min(...ys)) * scale + 100;
  const point = (i: number) => ({ x: 50 + (scene.atoms[i].x - minX) * scale, y: 50 + (maxY - scene.atoms[i].y) * scale });
  const paths = scene.bonds.map(b => {
    const a = point(b.a), c = point(b.b), dx = c.x - a.x, dy = c.y - a.y, length = Math.hypot(dx, dy);
    const px = -dy / length, py = dx / length;
    if (b.stereo && !b.plain) {
      if (b.stereo === 1) return `<path data-bond="${b.id}" d="M${a.x},${a.y} L${c.x + px * 5},${c.y + py * 5} L${c.x - px * 5},${c.y - py * 5}Z" fill="black"/>`;
      return Array.from({ length: 12 }, (_, i) => { const t = (i + 1) / 13, x = a.x + t * dx, y = a.y + t * dy; return `<path d="M${x - px * t * 5},${y - py * t * 5} L${x + px * t * 5},${y + py * t * 5}"/>`; }).join('');
    }
    return Array.from({ length: b.order }, (_, i) => { const offset = (i - (b.order - 1) / 2) * 4; return `<path data-bond="${b.id}" d="M${a.x + px * offset},${a.y + py * offset} L${c.x + px * offset},${c.y + py * offset}"/>`; }).join('');
  }).join('');
  const labels = scene.atoms.map((a, i) => { const p = point(i), label = glyph(a.label); return `<g data-atom="${a.id}"><rect x="${p.x - Math.max(9, label.length * 6)}" y="${p.y - 13}" width="${Math.max(18, label.length * 12)}" height="26" fill="white" stroke="none"/><text x="${p.x}" y="${p.y + 7}" text-anchor="middle" fill="black" stroke="none" font-family="Arial" font-size="21">${escape(label)}</text></g>`; }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><title>${escape(scene.description ?? 'Chemical scene')}</title><rect width="100%" height="100%" fill="white"/><g stroke="black" stroke-width="1.8" fill="none">${paths}${labels}</g></svg>`;
}

/** A deliberately narrow, reversible ChemFig dialect, not arbitrary TeX. */
export function exportSceneChemfig(scene: ChemicalScene): string {
  const emitted = new Set<number>(), tree = new Set<number>();
  // Wedges must be explicit tree edges, never implicit ring closures. Build a
  // spanning tree with those edges first without changing atom order or parity.
  const parents = scene.atoms.map((_, i) => i);
  const root = (i: number): number => parents[i] === i ? i : (parents[i] = root(parents[i]));
  const edges = scene.bonds.map((b, i) => ({ b, i })).sort((x, y) => Number(!!y.b.stereo && !y.b.plain) - Number(!!x.b.stereo && !x.b.plain));
  for (const { b, i } of edges) if (root(b.a) !== root(b.b)) { parents[root(b.a)] = root(b.b); tree.add(i); }
  if (tree.size !== scene.atoms.length - 1) throw new Error('Disconnected ChemFig scenes are unsupported.');
  const render = (a: number): string => {
    emitted.add(a);
    let text = `@{${scene.atoms[a].id}}${scene.atoms[a].label}`;
    scene.bonds.forEach((b, i) => { if (!tree.has(i) && (b.a === a || b.b === a)) {
      if (b.stereo && !b.plain) throw new Error('Stereochemical ring closures cannot be exported in this dialect.');
      text += `?[r${i},${b.order}]`;
    } });
    scene.bonds.forEach((b, i) => {
      const c = b.a === a ? b.b : b.b === a ? b.a : -1;
      if (c < 0 || !tree.has(i) || emitted.has(c)) return;
      const dx = scene.atoms[c].x - scene.atoms[a].x, dy = scene.atoms[c].y - scene.atoms[a].y;
      let symbol = b.order === 2 ? '=' : b.order === 3 ? '~' : '-';
      if (b.stereo && !b.plain) symbol = `${b.a === a ? '<' : '>'}${b.stereo === 6 ? ':' : ''}`;
      text += `(${symbol}[@{${b.id}}:${(Math.atan2(dy, dx) * 180 / Math.PI).toFixed(6)},${Math.hypot(dx, dy).toFixed(6)}]${render(c)})`;
    });
    return text;
  };
  const source = `\\chemfig[atom sep=30pt]{${render(0)}}`;
  if (source.length > 7500) throw new Error('ChemFig export exceeds the validated size limit.');
  return source;
}

/** Parse the actual emitted source, reconstruct coordinates/topology, then
 * check against the scene and the independent reference graph. */
export function verifySceneChemfig(source: string, expected: ChemicalScene, canonical: string, kit: RDKitModule): void {
  const prefix = '\\chemfig[atom sep=30pt]{';
  if (!source.startsWith(prefix) || !source.endsWith('}')) throw new Error('Unsupported ChemFig export dialect.');
  const body = source.slice(prefix.length, -1), atoms: SceneAtom[] = [], bonds: SceneBond[] = [], rings = new Map<string, [number, number]>();
  let p = 0;
  const read = (pattern: RegExp): RegExpExecArray => { const match = pattern.exec(body.slice(p)); if (!match) throw new Error(`Invalid ChemFig export at ${p}.`); p += match[0].length; return match; };
  const parse = (x: number, y: number): number => {
    const atom = read(/^@\{(a\d+)\}((?:\^\{\d+\})?[A-Z][a-z]?(?:H(?:_[2-9])?)?(?:\^\{\d*[+-]\})?)/);
    const definition = /^(?:\^\{(\d+)\})?([A-Z][a-z]?)(?:H(?:_[2-9])?)?(?:\^\{(\d*)([+-])\})?$/.exec(atom[2])!;
    const index = atoms.length;
    if (atoms.some(a => a.id === atom[1])) throw new Error('Duplicate exported atom ID.');
    atoms.push({ id: atom[1], label: atom[2], element: definition[2], isotope: Number(definition[1] ?? 0), charge: definition[4] ? Number(definition[3] || 1) * (definition[4] === '+' ? 1 : -1) : 0, x, y });
    while (p < body.length && body[p] !== ')') {
      if (body.startsWith('?[', p)) { const ring = read(/^\?\[(r\d+),([123])\]/), previous = rings.get(ring[1]);
        if (previous) { if (previous[1] !== Number(ring[2])) throw new Error('Inconsistent ring order.'); bonds.push({ id: '', a: previous[0], b: index, order: previous[1], stereo: 0 }); rings.delete(ring[1]); }
        else rings.set(ring[1], [index, Number(ring[2])]);
      } else {
        const bond = read(/^\((<:|>:|<|>|-|=|~)\[@\{(b\d+)\}:(-?[\d.]+),([\d.]+)\]/), angle = Number(bond[3]) * Math.PI / 180, length = Number(bond[4]);
        if (!Number.isFinite(angle) || !Number.isFinite(length) || length <= 0 || length > 100) throw new Error('Invalid export geometry.');
        const next = parse(x + length * Math.cos(angle), y + length * Math.sin(angle)); read(/^\)/);
        const reversed = bond[1].startsWith('>');
        bonds.push({ id: bond[2], a: reversed ? next : index, b: reversed ? index : next, order: bond[1] === '=' ? 2 : bond[1] === '~' ? 3 : 1, stereo: /[<>]/.test(bond[1]) ? bond[1].includes(':') ? 6 : 1 : 0 });
      }
    }
    return index;
  };
  parse(0, 0);
  if (p !== body.length || rings.size || atoms.length !== expected.atoms.length || bonds.length !== expected.bonds.length) throw new Error('Incomplete exported graph.');
  const origin = expected.atoms[0];
  for (const a of atoms) {
    const original = expected.atoms.find(e => e.id === a.id);
    if (!original || original.label !== a.label || Math.hypot(a.x - (original.x - origin.x), a.y - (original.y - origin.y)) > .0001) throw new Error('ChemFig changed an atom or its coordinates.');
    a.depth = original.depth;
  }
  for (const b of bonds) {
    const a = atoms[b.a].id, c = atoms[b.b].id;
    const original = expected.bonds.find(e => (expected.atoms[e.a].id === a && expected.atoms[e.b].id === c) || (!b.stereo && expected.atoms[e.a].id === c && expected.atoms[e.b].id === a));
    if (!original || (b.id && b.id !== original.id) || original.order !== b.order || (original.plain ? 0 : original.stereo) !== b.stereo) throw new Error('ChemFig changed a bond or wedge orientation.');
    // Reapply only the explicitly checked projection convention, never an
    // unconstrained stereochemical label supplied by the model.
    if (original.plain) { b.stereo = original.stereo; b.plain = true; if (expected.atoms[original.a].id !== a) [b.a, b.b] = [b.b, b.a]; }
  }
  // Restore absolute coordinates for Haworth's fixed ring-plane projection.
  atoms.forEach(a => { a.x += origin.x; a.y += origin.y; });
  if (canonicalScene({ atoms, bonds, convention: expected.convention }, kit) !== canonical) throw new Error('ChemFig round-trip changed the reference graph or stereochemistry.');
}
