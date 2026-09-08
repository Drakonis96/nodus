import type { RDKitModule } from '@rdkit/rdkit';
import { canonicalScene, sceneMolfile, type ChemicalScene } from './chemistryScene';
import { atom, combine, finishRule, reindex, relayout, type RulePanels } from './chemistryRuleUtils';
import type { CheckedMechanism } from './chemistryMechanisms';

function diene(cyclic: boolean): ChemicalScene {
  const s: ChemicalScene = { atoms: [atom('C', 'CH_2', -1, -1), atom('C', 'CH', -1, 1), atom('C', 'CH', 1, 1), atom('C', 'CH_2', 1, -1)], bonds: [[0, 1, 2], [1, 2, 1], [2, 3, 2]].map(([a, b, order]) => ({ id: '', a, b, order, stereo: 0 })) };
  if (cyclic) { s.atoms[0].label = s.atoms[3].label = 'CH'; s.atoms.push(atom('C', 'CH_2', 0, -2.1)); s.bonds.push({ id: '', a: 3, b: 4, order: 1, stereo: 0 }, { id: '', a: 4, b: 0, order: 1, stereo: 0 }); }
  return reindex(s);
}
function dienophile(anhydride: boolean): ChemicalScene {
  const s: ChemicalScene = { atoms: [atom('C', anhydride ? 'CH' : 'CH_2', -1, 0), atom('C', anhydride ? 'CH' : 'CH_2', 1, 0)], bonds: [{ id: '', a: 0, b: 1, order: 2, stereo: 0 }] };
  if (anhydride) {
    s.atoms.push(atom('C', 'C', 1.5, -1.5), atom('O', 'O', 2.7, -2), atom('O', 'O', 0, -2.5), atom('C', 'C', -1.5, -1.5), atom('O', 'O', -2.7, -2));
    s.bonds.push(...[[1, 2, 1], [2, 3, 2], [2, 4, 1], [4, 5, 1], [5, 6, 2], [5, 0, 1]].map(([a, b, order]) => ({ id: '', a, b, order, stereo: 0 })));
  }
  return reindex(s);
}

/** Suprafacial graph edits on two exactly matched reactant families. The
 * cyclopentadiene short bridge and anhydride are placed on checked opposite
 * sides (endo) or the same side (exo); no product name/SMILES catalog is used. */
export function deriveDielsAlder(inputs: string[], kit: RDKitModule, approach?: 'endo' | 'exo'): RulePanels {
  if (inputs.length !== 2) throw new Error('Diels–Alder requires diene then dienophile.');
  const ds = [false, true].map(diene), ps = [false, true].map(dienophile);
  const di = ds.findIndex(s => canonicalScene(s, kit) === inputs[0]), pi = ps.findIndex(s => canonicalScene(s, kit) === inputs[1]);
  if (di < 0 || pi < 0) throw new Error('Diels–Alder currently supports buta-1,3-diene or cyclopenta-1,3-diene with ethene or maleic anhydride. Substituted/asymmetric regiochemistry and alkynes require separate rules.');
  if (approach && (di !== 1 || pi !== 1)) throw new Error('Endo/exo selection here applies only to cyclopentadiene + maleic anhydride.');
  const approaches = di === 1 && pi === 1 ? approach ? [approach] : ['endo', 'exo'] as const : ['suprafacial'] as const;
  const panels: CheckedMechanism[] = [];
  for (const face of approaches) {
    const d = ds[di], p = ps[pi], product = combine(d, p), offset = d.atoms.length;
    product.bonds[0].order = product.bonds[2].order = product.bonds[d.bonds.length].order = 1;
    product.bonds[1].order = 2;
    product.bonds.push({ id: '', a: 0, b: offset, order: 1, stereo: 0 }, { id: '', a: 3, b: offset + 1, order: 1, stereo: 0 });
    const coordinates = [[-1, -1, 0], [-1, 1, 0], [1, 1, 0], [1, -1, 0]];
    if (di === 1) coordinates.push([0, -1.7, 1.2]);
    coordinates.push([-.7, -2, -1], [.7, -2, -1]);
    if (pi === 1) {
      const z = face === 'exo' ? .4 : -2.4;
      coordinates.push([1.2, -2.4, z], [2.3, -2.8, z], [0, -3, z], [-1.2, -2.4, z], [-2.3, -2.8, z]);
      if (di === 1) {
        // n = (A1-A0) cross (bridgehead-midpoint-A0), parallel to (0,-1,1).
        const sideLong = -2, sideSubstituent = .4 + z + 1;
        if ((sideLong * sideSubstituent > 0) !== (face === 'endo')) throw new Error('Diels–Alder endo/exo geometric relation failed.');
      }
    }
    product.spatial = coordinates.map(([x, y, z]) => ({ x, y, z }));
    const molfile3D = sceneMolfile(reindex(product)), drawn = relayout(product, kit);
    // The explicit CH2 bridge label needs clearance from the opposite C–C
    // bond; uniform scaling preserves every wedge and the 2D stereo check.
    drawn.atoms.forEach(a => { a.x *= 1.8; a.y *= 1.8; });
    const panel: CheckedMechanism = { rule: 'diels-alder', scope: 'conditional-elementary-rule-not-product-prediction', source: 'https://openstax.org/books/organic-chemistry/pages/14-5-characteristics-of-the-diels-alder-reaction', title: `Diels–Alder: ${face}`, scenes: [d, p, drawn], reactants: [0, 1], products: [2], canonicalProducts: [],
      atomMap: [...d.atoms.map((_, i) => ({ from: [0, i] as [number, number], to: [2, i] as [number, number] })), ...p.atoms.map((_, i) => ({ from: [1, i] as [number, number], to: [2, offset + i] as [number, number] }))],
      electronFlow: [{ from: { molecule: 0, bond: 0 }, to: { molecule: 1, atom: 0 } }, { from: { molecule: 1, bond: 0 }, to: { molecule: 0, atom: 3 } }, { from: { molecule: 0, bond: 2 }, to: { molecule: 0, bond: 1 } }],
      bondEdits: ['Three pi bonds become two sigma bonds and one shifted pi bond in one concerted suprafacial step.'],
      geometry: { description: 'Product 3D graph; cis dienophile ring retained. For bridged products, endo/exo is checked relative to the longer diene bridge, not inferred from R/S labels.', molfile3D },
      limitations: ['Conditional thermal suprafacial pathway; no rate, yield, catalyst or endo/exo ratio is predicted.', 'Where shown together, endo and exo are alternative pathways, not successive intermediates. The diene is drawn s-cis.'] };
    panels.push(finishRule(panel, kit));
  }
  return { panels, finalProducts: panels.flatMap(p => p.canonicalProducts), limitations: panels[0].limitations };
}
