import type { RDKitModule } from '@rdkit/rdkit';
import { canonicalScene, type ChemicalScene, type SceneAtom } from './chemistryScene';

const atom = (element: string, label: string, x: number, y: number, depth?: number): SceneAtom => ({ id: '', element, label, charge: 0, isotope: 0, x, y, ...(depth == null ? {} : { depth }) });
function finish(scene: ChemicalScene): ChemicalScene {
  scene.atoms.forEach((a, i) => { a.id = `a${i}`; }); scene.bonds.forEach((b, i) => { b.id = `b${i}`; }); return scene;
}

export function fischerAldoseScene(carbons: number, right: boolean[]): ChemicalScene {
  if (carbons < 3 || carbons > 8 || right.length !== carbons - 2) throw new Error('Unsupported Fischer aldose size.');
  const scene: ChemicalScene = { convention: 'fischer', description: 'Fischer: horizontal bonds point towards the viewer; vertical bonds point away.', atoms: [], bonds: [] };
  const add = (a: number, value: SceneAtom, order = 1, stereo = 0) => { const b = scene.atoms.push(value) - 1; scene.bonds.push({ id: '', a, b, order, stereo, plain: true }); };
  for (let i = 0; i < carbons; i++) { scene.atoms.push(atom('C', i === carbons - 1 ? 'CH_2' : 'C', 0, -1.5 * i)); if (i) scene.bonds.push({ id: '', a: i - 1, b: i, order: 1, stereo: 0 }); }
  add(0, atom('O', 'O', -.85, .9), 2); add(0, atom('H', 'H', .85, .9));
  for (let i = 1; i < carbons - 1; i++) {
    const side = right[i - 1] ? 1 : -1;
    // Encoding one horizontal bond as towards the viewer has the same parity
    // as Fischer's two horizontal-towards / two vertical-away convention.
    add(i, atom('O', 'OH', side * 1.15, -1.5 * i), 1, side < 0 ? 1 : 0);
    add(i, atom('H', 'H', -side * 1.15, -1.5 * i), 1, side > 0 ? 1 : 0);
  }
  add(carbons - 1, atom('O', 'OH', 0, -1.5 * carbons));
  return finish(scene);
}

export function haworthAldohexoseScene(up: boolean[]): ChemicalScene {
  if (up.length !== 5) throw new Error('A Haworth aldohexopyranose needs five configurations.');
  const scene: ChemicalScene = { convention: 'haworth', description: 'Haworth: vertical substituents lie above or below the idealised ring plane.', atoms: [], bonds: [] };
  const ring = [[1.6,0],[.8,-1.4],[-.8,-1.4],[-1.6,0],[-.8,1.4],[.8,1.4]];
  ring.forEach(([x, y], i) => scene.atoms.push(atom(i === 5 ? 'O' : 'C', i === 5 ? 'O' : 'C', x, .45 * y, 0)));
  for (let i = 0; i < 6; i++) scene.bonds.push({ id: '', a: i, b: (i + 1) % 6, order: 1, stereo: 0 });
  for (let i = 0; i < 5; i++) {
    // Short interior substituents avoid the opposite ring vertex; their sign,
    // not their length, encodes the configuration in the idealised 3D scene.
    const z = (up[i] ? 1 : -1) * (i === 4 ? 1.3 : .7), [x, y] = ring[i], b = scene.atoms.length;
    scene.atoms.push(atom(i === 4 ? 'C' : 'O', i === 4 ? 'CH_2' : 'OH', x, .45 * y + .8 * z, z));
    scene.bonds.push({ id: '', a: i, b, order: 1, stereo: 0 });
    if (i === 4) { const end = scene.atoms.length; scene.atoms.push(atom('O', 'OH', x - 1.25, .45 * y + .8 * z, z)); scene.bonds.push({ id: '', a: b, b: end, order: 1, stereo: 0 }); }
  }
  return finish(scene);
}

/** Exhaust a bounded projection space, compare entire stereochemical graphs.
 * No D/L mnemonic, atom-locant guess, or LLM direction array participates. */
export function deriveProjection(canonical: string, kind: 'fischer' | 'haworth', kit: RDKitModule): ChemicalScene {
  const ref = kit.get_mol(canonical);
  if (!ref) throw new Error('Invalid projection reference.');
  let carbons: number;
  try { const json = JSON.parse(ref.get_json()); carbons = json.molecules[0].atoms.filter((a: { z?: number }) => (a.z ?? json.defaults.atom.z) === 6).length; }
  finally { ref.delete(); }
  const positions = kind === 'haworth' ? 5 : carbons - 2;
  if (kind === 'haworth' ? carbons !== 6 : carbons < 3 || carbons > 8) throw new Error('Projection is outside the aldose/aldohexopyranose scope.');
  const matches: ChemicalScene[] = [];
  for (let mask = 0; mask < 2 ** positions; mask++) {
    const directions = Array.from({ length: positions }, (_, i) => !!(mask & (1 << i)));
    const scene = kind === 'haworth' ? haworthAldohexoseScene(directions) : fischerAldoseScene(carbons, directions);
    if (canonicalScene(scene, kit) === canonical) matches.push(scene);
  }
  if (matches.length !== 1) throw new Error('No unique supported projection matches the reference graph; specify the exact open-chain aldose or pyranose anomer.');
  return matches[0];
}
