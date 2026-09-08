import type { RDKitModule } from '@rdkit/rdkit';
import { canonicalScene, sceneMolfile, type ChemicalScene } from './chemistryScene';
import { atom, finishRule, readScene, refreshScene, reindex, relayout, subset, type RulePanels } from './chemistryRuleUtils';
import type { CheckedMechanism } from './chemistryMechanisms';

/** Enumerate anti conformers and distinct alkene graphs, not "the major
 * product". Only an unbranched C2–C6 monoalkyl-halide family is admitted. */
export function deriveE2(inputs: string[], kit: RDKitModule): RulePanels {
  if (inputs.length !== 2 || !['[OH-]', 'CC[O-]'].includes(inputs[1])) throw new Error('E2 requires substrate then explicit hydroxide or ethoxide.');
  const original = readScene(inputs[0], kit), base = readScene(inputs[1], kit);
  const neighbours = (s: ChemicalScene, a: number) => s.bonds.filter(b => b.a === a || b.b === a).map(b => b.a === a ? b.b : b.a);
  const cs = original.atoms.flatMap((a, i) => a.element === 'C' ? [i] : []), xs = original.atoms.flatMap((a, i) => ['Cl', 'Br', 'I'].includes(a.element) ? [i] : []);
  if (cs.length < 2 || cs.length > 6 || xs.length !== 1 || original.atoms.length !== cs.length + 1 || original.atoms.some(a => a.charge || a.isotope)
    || original.bonds.some(b => b.order !== 1) || original.bonds.length !== original.atoms.length - 1
    || cs.some(c => neighbours(original, c).filter(a => original.atoms[a].element === 'C').length > 2)) throw new Error('E2 currently supports unbranched saturated acyclic C2–C6 monohalides only; no cyclic, branched, isotope or multifunctional substrates.');
  const leaving = xs[0], alpha = neighbours(original, leaving)[0], baseO = base.atoms.findIndex(a => a.element === 'O' && a.charge === -1);
  const results = new Map<string, CheckedMechanism>();
  for (const beta of neighbours(original, alpha).filter(a => original.atoms[a].element === 'C')) {
    const expanded = structuredClone(original);
    for (const c of [alpha, beta]) while (neighbours(expanded, c).length < 4) {
      const h = expanded.atoms.push(atom('H', 'H')) - 1; expanded.bonds.push({ id: '', a: c, b: h, order: 1, stereo: 0 });
    }
    reindex(expanded);
    const hydrogen = neighbours(expanded, beta).find(a => expanded.atoms[a].element === 'H');
    if (hydrogen == null) continue;
    const front = neighbours(expanded, alpha).filter(a => a !== beta && a !== leaving), rear = neighbours(expanded, beta).filter(a => a !== alpha && a !== hydrogen);
    for (const flipFront of [false, true]) for (const flipRear of [false, true]) {
      const conformer = structuredClone(expanded), coords = conformer.atoms.map(() => ({ x: 0, y: 0, z: 0 }));
      coords[alpha] = { x: 0, y: 0, z: 0 }; coords[beta] = { x: 1.5, y: 0, z: 0 };
      const place = (parent: number, a: number, angle: number, side: number) => {
        const radians = angle * Math.PI / 180, vector = { x: .5 * side, y: Math.cos(radians), z: Math.sin(radians) };
        const walk = (i: number, previous: number, depth: number) => {
          coords[i] = { x: coords[parent].x + vector.x * (1 + 2 * depth), y: vector.y * (1 + .6 * depth), z: vector.z * (1 + .6 * depth) };
          for (const next of neighbours(conformer, i)) if (next !== previous && next !== alpha && next !== beta) walk(next, i, depth + 1);
        };
        walk(a, parent, 0);
      };
      place(alpha, leaving, 0, -1); place(beta, hydrogen, 180, 1);
      (flipFront ? [...front].reverse() : front).forEach((a, i) => place(alpha, a, 120 + 120 * i, -1));
      (flipRear ? [...rear].reverse() : rear).forEach((a, i) => place(beta, a, 60 + 240 * i, 1));
      conformer.spatial = coords;
      if (canonicalScene(conformer, kit) !== inputs[0]) continue;
      // Hβ–Cβ–Cα–X: projections perpendicular to the C–C axis must be opposite.
      const h = coords[hydrogen], x = coords[leaving], cosine = (h.y * x.y + h.z * x.z) / (Math.hypot(h.y, h.z) * Math.hypot(x.y, x.z));
      const dihedral = Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
      if (Math.abs(dihedral - 180) > .001) throw new Error('E2 anti-periplanar geometry failed.');
      const molfile3D = sceneMolfile(conformer);
      delete conformer.spatial;
      conformer.atoms.forEach((a, i) => { a.x = 2.5 * (coords[i].x + .45 * coords[i].z); a.y = 2.5 * (coords[i].y + .15 * coords[i].z); });
      // Extend achiral chain tails along their displayed spoke. Do not move
      // either centre or any directly attached ligand: the anti geometry and
      // the local stereo projection remain fixed. Otherwise a remote CH2 can
      // overlap a different spoke's H in the foreshortened sawhorse view.
      for (const centre of [alpha, beta]) for (const first of neighbours(conformer, centre).filter(i => i !== alpha && i !== beta && conformer.atoms[i].element === 'C')) {
        const origin = { ...conformer.atoms[first] }, dx = origin.x - conformer.atoms[centre].x, dy = origin.y - conformer.atoms[centre].y, length = Math.hypot(dx, dy);
        const extend = (i: number, previous: number, depth: number) => {
          conformer.atoms[i].x = origin.x + dx / length * 1.5 * depth;
          conformer.atoms[i].y = origin.y + dy / length * 1.5 * depth;
          for (const next of neighbours(conformer, i)) if (next !== previous) extend(next, i, depth + 1);
        };
        for (const next of neighbours(conformer, first)) if (next !== centre) extend(next, first, 1);
      }
      conformer.bonds.forEach(b => {
        b.stereo = 0;
        const c = [alpha, beta].find(c => (b.a === c || b.b === c) && b.a !== alpha + beta - c && b.b !== alpha + beta - c);
        if (c != null) { const other = b.a === c ? b.b : b.a; b.a = c; b.b = other; if (Math.abs(coords[other].z) > .001) b.stereo = coords[other].z > 0 ? 1 : 6; }
      });
      if (canonicalScene(conformer, kit) !== inputs[0]) throw new Error('E2 sawhorse projection failed the independent 2D stereo check.');
      const drawn = refreshScene(conformer, kit), retained = conformer.atoms.map((_, i) => i).filter(i => i !== leaving && i !== hydrogen), index = (a: number) => retained.indexOf(a);
      let alkene = subset(conformer, retained);
      alkene.bonds.forEach(b => { b.stereo = 0; if ((b.a === index(alpha) && b.b === index(beta)) || (b.b === index(alpha) && b.a === index(beta))) b.order = 2; });
      for (const c of [alpha, beta]) {
        alkene.atoms[index(c)].x = c === alpha ? 0 : 1.5; alkene.atoms[index(c)].y = 0;
        for (const first of neighbours(conformer, c).filter(a => a !== alpha && a !== beta && a !== leaving && a !== hydrogen)) {
          const sign = coords[first].z > 0 ? 1 : -1, side = c === alpha ? -1 : 1;
          const walk = (a: number, parent: number, depth: number) => {
            alkene.atoms[index(a)].x = (c === alpha ? 0 : 1.5) + side * (1 + depth); alkene.atoms[index(a)].y = sign * (1 + .5 * depth);
            for (const next of neighbours(conformer, a)) if (next !== parent && retained.includes(next)) walk(next, a, depth + 1);
          };
          walk(first, c, 0);
        }
      }
      alkene = refreshScene(alkene, kit);
      const canonical = canonicalScene(alkene, kit);
      if (results.has(canonical)) continue;
      let acid = structuredClone(base); const transferred = acid.atoms.length;
      acid.atoms[baseO].charge = 0; acid.atoms.push(atom('H', 'H')); acid.bonds.push({ id: '', a: baseO, b: transferred, order: 1, stereo: 0 }); acid = relayout(reindex(acid), kit);
      const ion = reindex({ atoms: [atom(original.atoms[leaving].element, `${original.atoms[leaving].element}^{-}`, 0, 0, -1)], bonds: [] });
      const leavingBond = drawn.bonds.findIndex(b => b.a === leaving || b.b === leaving), hBond = drawn.bonds.findIndex(b => b.a === hydrogen || b.b === hydrogen), axisBond = drawn.bonds.findIndex(b => [b.a, b.b].includes(alpha) && [b.a, b.b].includes(beta));
      const panel: CheckedMechanism = { rule: 'e2', scope: 'conditional-elementary-rule-not-product-prediction', source: 'https://openstax.org/books/organic-chemistry/pages/11-8-the-e2-reaction-and-the-deuterium-isotope-effect', title: `E2 anti: alternative ${results.size + 1}`, scenes: [base, drawn, alkene, acid, ion], reactants: [0, 1], products: [2, 3, 4], canonicalProducts: [],
        atomMap: [...base.atoms.map((_, i) => ({ from: [0, i] as [number, number], to: [3, i] as [number, number] })), ...drawn.atoms.map((_, i) => ({ from: [1, i] as [number, number], to: (i === leaving ? [4, 0] : i === hydrogen ? [3, transferred] : [2, index(i)]) as [number, number] }))],
        electronFlow: [{ from: { molecule: 0, atom: baseO }, to: { molecule: 1, atom: hydrogen } }, { from: { molecule: 1, bond: hBond }, to: { molecule: 1, bond: axisBond } }, { from: { molecule: 1, bond: leavingBond }, to: { molecule: 1, atom: leaving } }],
        bondEdits: ['Break beta C–H and alpha C–X; form C=C and base O–H in a single concerted step.'], geometry: { description: 'Anti H-beta–C-beta–C-alpha–halogen conformer, with the same input stereochemistry; displayed as a checked sawhorse projection.', molfile3D, dihedralDegrees: dihedral },
        limitations: ['Distinct regio/E/Z outcomes are alternatives, not consecutive steps. No major-product ratio, yield, solvent or SN2/E2 competition is predicted.', 'Idealised anti conformers are not an energy calculation; cyclic trans-diaxial eliminations require a separate rule.'] };
      results.set(canonical, finishRule(panel, kit));
    }
  }
  if (!results.size) throw new Error('No reference-preserving anti E2 conformer was found.');
  const panels = [...results.values()]; return { panels, finalProducts: [...results.keys()], limitations: panels[0].limitations };
}
