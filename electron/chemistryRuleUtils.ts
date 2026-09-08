import type { RDKitModule } from '@rdkit/rdkit';
import { canonicalScene, sceneMolfile, type ChemicalScene, type SceneAtom } from './chemistryScene';
import { validateMechanismLedger, type CheckedMechanism } from './chemistryMechanisms';

export const reindex = (s: ChemicalScene): ChemicalScene => { s.atoms.forEach((a, i) => { a.id = `a${i}`; }); s.bonds.forEach((b, i) => { b.id = `b${i}`; }); return s; };
export const atom = (element: string, label: string, x = 0, y = 0, charge = 0): SceneAtom => ({ id: '', element, label, x, y, charge, isotope: 0 });
/** Preserve molfile atom order, including transferred explicit H atoms. OCL's
 * helper preparation may reorder simple hydrogens, so do not use it here. */
function nativeScene(molfile: string, kit: RDKitModule): ChemicalScene {
  const m = kit.get_mol(molfile); if (!m) throw new Error('Invalid rule layout.');
  try {
    const lines = molfile.split('\n'), j = JSON.parse(m.get_json()), count = Number(lines[3].slice(0, 3)), nb = Number(lines[3].slice(3, 6));
    const atoms = j.molecules[0].atoms.map((raw: Record<string, number>, i: number) => {
      const a = { ...j.defaults.atom, ...raw }, line = lines[4 + i], element = line.slice(31, 34).trim(), h = a.impHs;
      return { ...atom(element, `${element}${h ? `H${h > 1 ? `_${h}` : ''}` : ''}${a.chg ? `^{${Math.abs(a.chg) > 1 ? Math.abs(a.chg) : ''}${a.chg > 0 ? '+' : '-'}}` : ''}`, Number(line.slice(0, 10)), Number(line.slice(10, 20)), a.chg), isotope: a.isotope };
    });
    if (atoms.length !== count) throw new Error('Rule layout changed atom count.');
    return reindex({ atoms, bonds: Array.from({ length: nb }, (_, i) => { const b = lines[4 + count + i]; return { id: '', a: Number(b.slice(0, 3)) - 1, b: Number(b.slice(3, 6)) - 1, order: Number(b.slice(6, 9)), stereo: Number(b.slice(9, 12)) }; }) });
  } finally { m.delete(); }
}
export const refreshScene = (s: ChemicalScene, kit: RDKitModule): ChemicalScene => nativeScene(sceneMolfile(s), kit);
export function readScene(smiles: string, kit: RDKitModule): ChemicalScene {
  const m = kit.get_mol(smiles); if (!m) throw new Error('Invalid rule input.');
  try { const s = nativeScene(m.get_new_coords(true), kit); if (canonicalScene(s, kit) !== m.get_smiles()) throw new Error('Rule input layout changed stereo.'); return s; } finally { m.delete(); }
}
export function relayout(s: ChemicalScene, kit: RDKitModule): ChemicalScene {
  const canonical = canonicalScene(s, kit), m = kit.get_mol(sceneMolfile(s));
  if (!m) throw new Error('Invalid rule product.');
  try { const output = nativeScene(m.get_new_coords(true), kit); if (canonicalScene(output, kit) !== canonical || output.atoms.length !== s.atoms.length || output.atoms.some((a, i) => a.element !== s.atoms[i].element || a.isotope !== s.atoms[i].isotope)) throw new Error('Rule product relayout changed stereo or atom indices.'); return output; } finally { m.delete(); }
}
export function subset(s: ChemicalScene, indices: number[]): ChemicalScene {
  const mapping = new Map(indices.map((a, i) => [a, i]));
  return reindex({ atoms: indices.map(i => ({ ...s.atoms[i] })), bonds: s.bonds.filter(b => mapping.has(b.a) && mapping.has(b.b)).map(b => ({ ...b, a: mapping.get(b.a)!, b: mapping.get(b.b)! })) });
}
export function combine(a: ChemicalScene, b: ChemicalScene, offset = 4): ChemicalScene {
  return reindex({ atoms: [...a.atoms.map(x => ({ ...x })), ...b.atoms.map(x => ({ ...x, x: x.x + offset }))], bonds: [...a.bonds.map(x => ({ ...x })), ...b.bonds.map(x => ({ ...x, a: x.a + a.atoms.length, b: x.b + a.atoms.length }))] });
}
export function finishRule(rule: CheckedMechanism, kit: RDKitModule): CheckedMechanism {
  rule.scenes.forEach(s => {
    const m = kit.get_mol(sceneMolfile(s)); if (!m) throw new Error('Invalid rule stage.');
    try {
      const j = JSON.parse(m.get_json());
      for (const a of j.molecules[0].atoms) if (a.nRad ?? j.defaults.atom.nRad) throw new Error('A rule created a radical.');
    } finally { m.delete(); }
  });
  rule.canonicalProducts = rule.products.map(i => canonicalScene(rule.scenes[i], kit));
  validateMechanismLedger(rule, kit); return rule;
}
export interface RulePanels { panels: CheckedMechanism[]; finalProducts: string[]; limitations: string[] }
