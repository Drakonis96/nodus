import type { RDKitModule } from '@rdkit/rdkit';
import type { NewmanConformation } from '@shared/chemistryDocument';
import { canonicalScene, sceneMolfile, type ChemicalScene } from './chemistryScene';

interface Slot { rear: boolean; angle: number; length: number; label: 'H' | 'CH_3' }
export interface NewmanProjection { scene: ChemicalScene; slots: Slot[]; axis: [string, string]; dihedralDegrees: number; convention: string }
const PREFIX = '\\chemfig[atom sep=30pt,chemfig style={execute at end picture={\\draw (rear) circle (12pt);\\fill (front) circle (1.5pt);}}]{';
// PGF divides by bond length even for an invisible bond. A 0.003 pt offset
// avoids division by zero; the chemical viewing axis remains defined in 3D.
const AXIS = '-[0,0.0001,,,draw=none]@{rear}';

function fromSlots(slots: Slot[]): ChemicalScene {
  const scene: ChemicalScene = { atoms: [0, 1].map(i => ({ id: `a${i}`, element: 'C', label: 'C', charge: 0, isotope: 0, x: 0, y: 0 })), bonds: [{ id: 'b0', a: 0, b: 1, order: 1, stereo: 0 }], spatial: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1.5 }] };
  for (const slot of slots) {
    const angle = slot.angle * Math.PI / 180, i = scene.atoms.length;
    scene.atoms.push({ id: `a${i}`, element: slot.label === 'H' ? 'H' : 'C', label: slot.label, charge: 0, isotope: 0, x: slot.length * Math.cos(angle), y: slot.length * Math.sin(angle) });
    scene.bonds.push({ id: `b${i - 1}`, a: slot.rear ? 1 : 0, b: i, order: 1, stereo: 0 });
    scene.spatial!.push({ x: 1.4 * Math.cos(angle), y: 1.4 * Math.sin(angle), z: slot.rear ? 2 : -.5 });
  }
  return scene;
}

/** A Newman projection is a view down a named bond, not a molecular identity.
 * The deliberately small scope avoids guessing an axis in a complex graph. */
export function deriveNewman(canonical: string, kit: RDKitModule, requested: NewmanConformation = 'staggered'): NewmanProjection {
  if (!['CC', 'CCC', 'CCCC'].includes(canonical)) throw new Error('Newman currently supports ethane, propane and n-butane only.');
  if (!['anti', 'gauche', 'eclipsed', 'staggered'].includes(requested)) throw new Error('Unsupported Newman conformation.');
  if (canonical !== 'CCCC' && ['anti', 'gauche'].includes(requested)) throw new Error('Anti/gauche methyl–methyl labels require n-butane; request staggered or eclipsed.');
  const torsion = requested === 'eclipsed' ? 0 : requested === 'gauche' ? 60 : 180;
  const slots: Slot[] = [];
  for (const rear of [false, true]) for (let i = 0; i < 3; i++) {
    const methyl = i === 0 && (canonical === 'CCCC' || canonical === 'CCC' && rear);
    slots.push({ rear, angle: (90 + i * 120 + (rear ? torsion : 0)) % 360, length: rear ? 2.5 : 1.65, label: methyl ? 'CH_3' : 'H' });
  }
  const scene = fromSlots(slots);
  if (canonicalScene(scene, kit) !== canonical) throw new Error('Newman reconstruction changed the reference graph.');
  return { scene, slots, axis: canonical === 'CCCC' ? ['C2', 'C3'] : ['C1', 'C2'], dihedralDegrees: torsion,
    convention: `Newman ${requested}; view ${canonical === 'CCCC' ? 'C2 to C3' : 'C1 to C2'}. Dot: front carbon; circle: rear carbon. An idealised selected conformer, not an experimental population. For eclipsed bonds the rear labels extend farther along the same rays.` };
}

export function exportNewman(projection: NewmanProjection): string {
  const branches = (rear: boolean) => projection.slots.filter(s => s.rear === rear).map(s => `(-[:${s.angle},${s.length}${rear ? ',,,shorten <=12pt' : ''}]${s.label})`).join('');
  return PREFIX + '@{front}' + branches(false) + AXIS + branches(true) + '}';
}

export function verifyNewman(source: string, projection: NewmanProjection, canonical: string, kit: RDKitModule): void {
  if (!source.startsWith(PREFIX + '@{front}') || !source.endsWith('}')) throw new Error('Newman circle, front marker or convention changed.');
  const halves = source.slice((PREFIX + '@{front}').length, -1).split(AXIS);
  if (halves.length !== 2) throw new Error('Newman viewing bond changed.');
  const slots: Slot[] = [];
  halves.forEach((half, side) => {
    const regex = side ? /\(-\[:(\d+),(\d+(?:\.\d+)?),,,shorten <=12pt\](H|CH_3)\)/g : /\(-\[:(\d+),(\d+(?:\.\d+)?)\](H|CH_3)\)/g;
    const matches = [...half.matchAll(regex)];
    if (matches.length !== 3 || half.replace(regex, '')) throw new Error('Invalid Newman substituent list.');
    matches.forEach(m => slots.push({ rear: !!side, angle: Number(m[1]), length: Number(m[2]), label: m[3] as Slot['label'] }));
  });
  if (JSON.stringify(slots) !== JSON.stringify(projection.slots)) throw new Error('Newman torsion, labels or ray lengths changed.');
  if (canonicalScene(fromSlots(slots), kit) !== canonical) throw new Error('Newman ChemFig reconstruction changed the reference graph.');
}

export function renderNewman(projection: NewmanProjection): string {
  const cx = 235, cy = 220, scale = 62;
  const rays = projection.slots.map(s => {
    const a = s.angle * Math.PI / 180, dx = Math.cos(a), dy = -Math.sin(a), start = s.rear ? 25 : 0;
    return `<path d="M${cx + dx * start},${cy + dy * start} L${cx + dx * s.length * scale},${cy + dy * s.length * scale}"/>`;
  }).join('');
  const labels = projection.slots.map(s => {
    const a = s.angle * Math.PI / 180, x = cx + Math.cos(a) * s.length * scale, y = cy - Math.sin(a) * s.length * scale, text = s.label === 'H' ? 'H' : 'CH₃';
    return `<rect x="${x - 23}" y="${y - 14}" width="46" height="28" fill="white"/><text x="${x}" y="${y + 7}" text-anchor="middle" font-family="Arial" font-size="21">${text}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="470" height="440" viewBox="0 0 470 440"><rect width="470" height="440" fill="white"/><g stroke="black" stroke-width="1.8" fill="none"><circle cx="${cx}" cy="${cy}" r="25"/>${rays}</g><circle cx="${cx}" cy="${cy}" r="3.5"/>${labels}</svg>`;
}

export const newmanEvidence = (p: NewmanProjection) => ({ convention: p.convention, axis: p.axis, dihedralDegrees: p.dihedralDegrees, molfile3D: sceneMolfile(p.scene) });
