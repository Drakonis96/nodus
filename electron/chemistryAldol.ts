import type { RDKitModule } from '@rdkit/rdkit';
import { canonicalScene } from './chemistryScene';
import { atom, combine, finishRule, readScene, reindex, relayout, subset, type RulePanels } from './chemistryRuleUtils';
import type { CheckedMechanism } from './chemistryMechanisms';

/** Explicit three-step addition, not dehydration or a selected aldol stereoisomer.
 * Fixed substrate family removes competing enolate regiochemistry. */
export function deriveAldol(inputs: string[], kit: RDKitModule): RulePanels {
  if (inputs.length !== 3 || !['CC=O', 'CC(C)=O'].includes(inputs[0]) || !['C=O', 'CC=O', 'CC(C)=O'].includes(inputs[1]) || inputs[2] !== '[OH-]') throw new Error('Aldol supports ethanal/acetone donor, methanal/ethanal/acetone acceptor, then explicit hydroxide. No dehydration or asymmetric selectivity.');
  let donor = readScene(inputs[0], kit);
  const acceptor = readScene(inputs[1], kit);
  const carbonyl = (s: typeof donor) => {
    const b = s.bonds.findIndex(b => b.order === 2 && (s.atoms[b.a].element === 'O' || s.atoms[b.b].element === 'O'));
    const edge = s.bonds[b], o = s.atoms[edge.a].element === 'O' ? edge.a : edge.b;
    return { b, o, c: edge.a === o ? edge.b : edge.a };
  };
  const d = carbonyl(donor), a = carbonyl(acceptor), alphaBond = donor.bonds.findIndex(b => b.order === 1 && (b.a === d.c || b.b === d.c));
  const edge = donor.bonds[alphaBond], alpha = edge.a === d.c ? edge.b : edge.a;
  const h = donor.atoms.length;
  donor.atoms.push(atom('H', 'H', donor.atoms[alpha].x - 1, donor.atoms[alpha].y + 1));
  donor.bonds.push({ id: '', a: alpha, b: h, order: 1, stereo: 0 }); donor = relayout(reindex(donor), kit);
  const hBond = donor.bonds.findIndex(b => b.a === h || b.b === h), heavy = Array.from({ length: h }, (_, i) => i);
  let enolate = subset(donor, heavy);
  enolate.bonds[d.b].order = 1; enolate.bonds[alphaBond].order = 2; enolate.atoms[d.o].charge = -1; enolate = relayout(enolate, kit);
  let water = reindex({ atoms: [atom('O', 'OH'), atom('H', 'H', 1.3, 0)], bonds: [{ id: '', a: 0, b: 1, order: 1, stereo: 0 }] });
  water = relayout(water, kit);
  const hydroxide = readScene('[OH-]', kit), source = 'https://openstax.org/books/organic-chemistry/pages/23-1-carbonyl-condensations-the-aldol-reaction';
  const common = { rule: 'aldol' as const, scope: 'conditional-elementary-rule-not-product-prediction' as const, source, canonicalProducts: [] as string[], limitations: ['Conditional aldol addition in three elementary steps; no dehydration, equilibrium yield or cross-aldol selectivity is predicted.', 'New product stereocentres are deliberately unassigned: both faces are possible in this achiral model, not an enantiopure product.'] };
  const first: CheckedMechanism = { ...common, title: '1. Enolate formation', scenes: [hydroxide, donor, enolate, water], reactants: [0, 1], products: [2, 3],
    atomMap: [...heavy.map(i => ({ from: [1, i] as [number, number], to: [2, i] as [number, number] })), { from: [1, h], to: [3, 1] }, { from: [0, 0], to: [3, 0] }],
    electronFlow: [{ from: { molecule: 0, atom: 0 }, to: { molecule: 1, atom: h } }, { from: { molecule: 1, bond: hBond }, to: { molecule: 1, bond: alphaBond } }, { from: { molecule: 1, bond: d.b }, to: { molecule: 1, atom: d.o } }], bondEdits: ['Transfer alpha H to hydroxide; C-alpha–C=O becomes C-alpha=C–O−.'] };
  let adduct = combine(enolate, acceptor);
  const offset = enolate.atoms.length;
  adduct.bonds[d.b].order = 2; adduct.bonds[alphaBond].order = 1; adduct.atoms[d.o].charge = 0;
  adduct.bonds[enolate.bonds.length + a.b].order = 1; adduct.atoms[offset + a.o].charge = -1;
  adduct.bonds.push({ id: '', a: alpha, b: offset + a.c, order: 1, stereo: 0 }); adduct = relayout(reindex(adduct), kit);
  const second: CheckedMechanism = { ...common, title: '2. Carbon–carbon bond formation (either face)', scenes: [enolate, acceptor, adduct], reactants: [0, 1], products: [2],
    atomMap: [...enolate.atoms.map((_, i) => ({ from: [0, i] as [number, number], to: [2, i] as [number, number] })), ...acceptor.atoms.map((_, i) => ({ from: [1, i] as [number, number], to: [2, offset + i] as [number, number] }))],
    electronFlow: [{ from: { molecule: 0, atom: d.o }, to: { molecule: 0, bond: d.b } }, { from: { molecule: 0, bond: alphaBond }, to: { molecule: 1, atom: a.c } }, { from: { molecule: 1, bond: a.b }, to: { molecule: 1, atom: a.o } }], bondEdits: ['Restore donor C=O; form alpha-C–acceptor-C; reduce acceptor C=O to O−.'] };
  let aldol = structuredClone(adduct); const transferred = aldol.atoms.length;
  aldol.atoms[offset + a.o].charge = 0; aldol.atoms.push(atom('H', 'H'));
  aldol.bonds.push({ id: '', a: offset + a.o, b: transferred, order: 1, stereo: 0 }); aldol = relayout(reindex(aldol), kit);
  const third: CheckedMechanism = { ...common, title: '3. Alkoxide protonation; catalyst regenerated', scenes: [adduct, water, aldol, hydroxide], reactants: [0, 1], products: [2, 3],
    atomMap: [...adduct.atoms.map((_, i) => ({ from: [0, i] as [number, number], to: [2, i] as [number, number] })), { from: [1, 1], to: [2, transferred] }, { from: [1, 0], to: [3, 0] }],
    electronFlow: [{ from: { molecule: 0, atom: offset + a.o }, to: { molecule: 1, atom: 1 } }, { from: { molecule: 1, bond: 0 }, to: { molecule: 1, atom: 0 } }], bondEdits: ['Transfer water H to alkoxide and regenerate hydroxide.'] };
  const panels = [first, second, third].map(p => finishRule(p, kit));
  if (canonicalScene(panels[0].scenes[2], kit) !== canonicalScene(panels[1].scenes[0], kit) || canonicalScene(panels[1].scenes[2], kit) !== canonicalScene(panels[2].scenes[0], kit)) throw new Error('Aldol intermediate continuity failed.');
  return { panels, finalProducts: [canonicalScene(aldol, kit)], limitations: common.limitations };
}
