import type { RDKitModule } from '@rdkit/rdkit';
import type { ElectronFlowBond, ElectronFlowSelector, ElectronFlowEvent } from '@shared/chemistryDocument';
import { canonicalScene, sceneFromMolfile, sceneMolfile, type ChemicalScene } from './chemistryScene';
import { validateMechanismLedger, type CheckedMechanism } from './chemistryMechanisms';

/** Valence electrons, used only to keep the lone-pair and formal-charge books. */
const VALENCE_ELECTRONS: Record<string, number> = {
  H: 1, He: 2, Li: 1, Be: 2, B: 3, C: 4, N: 5, O: 6, F: 7, Ne: 8,
  Na: 1, Mg: 2, Al: 3, Si: 4, P: 5, S: 6, Cl: 7, Ar: 8, K: 1, Ca: 2,
  Ge: 4, As: 5, Se: 6, Br: 7, Sn: 4, Sb: 5, Te: 6, I: 7,
};

function bondOrderSum(scene: ChemicalScene, atom: number): number {
  return scene.bonds.reduce((total, bond) => total + (bond.a === atom || bond.b === atom ? bond.order : 0), 0);
}

function valenceOf(element: string): number {
  const valence = VALENCE_ELECTRONS[element];
  if (valence == null) throw new Error(`Electron flow is not supported for element ${element}.`);
  return valence;
}

/**
 * Non-bonding electrons on an atom, derived from its formal charge rather than assumed.
 * formal charge = valence − non-bonding − bonds, so non-bonding = valence − charge − bonds.
 */
function nonBondingElectrons(scene: ChemicalScene, atom: number): number {
  return valenceOf(scene.atoms[atom].element) - scene.atoms[atom].charge - bondOrderSum(scene, atom);
}

function atomLabel(element: string, isotope: number, charge: number): string {
  return `${isotope ? `^{${isotope}}` : ''}${element}${charge ? `^{${Math.abs(charge) > 1 ? Math.abs(charge) : ''}${charge > 0 ? '+' : '-'}}` : ''}`;
}

/**
 * Resolve a chemical selector to exactly one atom.
 *
 * The model never sees the resolved graph, so it names what a chemist would say out
 * loud — "the oxygen of the base" — and the application turns that into an index. An
 * ambiguous selector is an error stating how many things it matched, so the next
 * attempt can add the distinguishing detail instead of guessing at coordinates.
 */
function resolveAtom(scene: ChemicalScene, selector: ElectronFlowSelector, label: string): number {
  const matches = scene.atoms.flatMap((atom, index) => atom.element === selector.element ? [index] : []);
  if (!matches.length) throw new Error(`${label}: this species contains no ${selector.element} atom.`);
  if (selector.index != null) {
    if (selector.index < 1 || selector.index > matches.length) throw new Error(`${label}: index ${selector.index} is out of range; this species has ${matches.length} ${selector.element} atom(s).`);
    return matches[selector.index - 1];
  }
  if (matches.length > 1) throw new Error(`${label}: "${selector.element}" matches ${matches.length} atoms in this species. Add "index" (1 to ${matches.length}, in the order the atoms appear) to say which one.`);
  return matches[0];
}

/**
 * Resolve a bond selector. Equivalent bonds are the rule rather than the exception in
 * resonance, so a tie can be broken by bond order — which is how a chemist would say
 * it, "the N=O rather than the N–O" — or, failing that, by position.
 */
function resolveBond(scene: ChemicalScene, selector: ElectronFlowBond, label: string): number {
  const between = Array.isArray(selector) ? selector : selector.between;
  const order = Array.isArray(selector) ? undefined : selector.order;
  const index = Array.isArray(selector) ? undefined : selector.index;
  const wanted = [...between].sort().join('-');
  let matches = scene.bonds.flatMap((bond, position) =>
    [scene.atoms[bond.a].element, scene.atoms[bond.b].element].sort().join('-') === wanted ? [position] : []);
  if (!matches.length) throw new Error(`${label}: this species has no ${between.join('–')} bond.`);
  if (order != null) {
    matches = matches.filter(position => scene.bonds[position].order === order);
    if (!matches.length) throw new Error(`${label}: this species has no ${between.join('–')} bond of order ${order}.`);
  }
  if (index != null) {
    if (index < 1 || index > matches.length) throw new Error(`${label}: index ${index} is out of range; ${matches.length} matching bond(s).`);
    return matches[index - 1];
  }
  if (matches.length > 1) throw new Error(`${label}: ${between.join('–')} matches ${matches.length} bonds in this species. Add "order" (for example {"between":["N","O"],"order":2}) or "index" to say which one.`);
  return matches[0];
}

interface CombinedGraph {
  scene: ChemicalScene;
  atomOffset: number[];
  bondOffset: number[];
}

/** Lay the reactants side by side in one graph so an arrow may cross between species. */
function combine(reactants: ChemicalScene[]): CombinedGraph {
  const scene: ChemicalScene = { atoms: [], bonds: [] };
  const atomOffset: number[] = [];
  const bondOffset: number[] = [];
  let shift = 0;
  for (const species of reactants) {
    atomOffset.push(scene.atoms.length);
    bondOffset.push(scene.bonds.length);
    const xs = species.atoms.map(atom => atom.x);
    const width = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
    const base = scene.atoms.length;
    for (const atom of species.atoms) scene.atoms.push({ ...atom, x: atom.x + shift, id: `a${scene.atoms.length}` });
    for (const bond of species.bonds) scene.bonds.push({ ...bond, a: bond.a + base, b: bond.b + base, id: `b${scene.bonds.length}` });
    shift += width + 3;
  }
  return { scene, atomOffset, bondOffset };
}

/**
 * An endpoint is carried in two coordinate systems at once: the combined graph, where
 * the electron bookkeeping happens, and the species it came from, which is what the
 * renderer and the conservation check address.
 */
interface ResolvedEndpoint { species: number; atom?: number; bond?: number; localAtom?: number; localBond?: number }

function resolveEndpoint(reactants: ChemicalScene[], graph: CombinedGraph, order: string[], side: ElectronFlowEvent['from'], label: string): ResolvedEndpoint {
  const species = order.indexOf(side.species);
  if (species < 0) throw new Error(`${label}: "${side.species}" is not one of the species ids in this intent (${order.join(', ')}).`);
  if ((side.atom == null) === (side.bond == null)) throw new Error(`${label}: give exactly one of "atom" or "bond".`);
  if (side.bond) {
    const localBond = resolveBond(reactants[species], side.bond, label);
    return { species, localBond, bond: graph.bondOffset[species] + localBond };
  }
  const localAtom = resolveAtom(reactants[species], side.atom!, label);
  return { species, localAtom, atom: graph.atomOffset[species] + localAtom };
}

/**
 * Apply declared curved arrows to the reactant graphs and return what they produce.
 *
 * Every arrow moves one electron pair. The tail says where the pair comes from — a
 * lone pair on an atom, or an existing bond — and the head says where it ends up: at
 * an atom it forms a bond from the donor, and at a bond it raises that bond's order.
 * Formal charges are then recomputed from the finished graph rather than patched arrow
 * by arrow, so the arrows cannot quietly produce an unbalanced structure. Either they
 * describe real electron movement, or the product they build will not match the
 * product the model declared, and the mismatch is what gets reported.
 */
export function applyElectronFlow(reactants: ChemicalScene[], order: string[], flows: ElectronFlowEvent[], kit: RDKitModule): {
  products: ChemicalScene[];
  origins: number[][];
  electronFlow: CheckedMechanism['electronFlow'];
  bondEdits: string[];
} {
  if (!flows.length) throw new Error('An electron-flow mechanism needs at least one curved arrow.');
  if (flows.length > 12) throw new Error('At most twelve curved arrows are supported in one mechanism.');
  const graph = combine(reactants);
  const product: ChemicalScene = structuredClone(graph.scene);
  const nonBonding = graph.scene.atoms.map((_, index) => nonBondingElectrons(graph.scene, index));
  const electronFlow: CheckedMechanism['electronFlow'] = [];
  const bondEdits: string[] = [];

  flows.forEach((flow, position) => {
    const label = `electronFlow[${position}]`;
    if (flow.kind === 'single') throw new Error(`${label}: single-electron (fishhook) arrows are not supported yet; use paired arrows.`);
    const from = resolveEndpoint(reactants, graph, order, flow.from, `${label}.from`);
    const to = resolveEndpoint(reactants, graph, order, flow.to, `${label}.to`);

    let donor: number;
    if (from.atom != null) {
      if (nonBonding[from.atom] < 2) throw new Error(`${label}.from: ${graph.scene.atoms[from.atom].element} has no lone pair left to donate.`);
      nonBonding[from.atom] -= 2;
      donor = from.atom;
    } else {
      const bond = product.bonds[from.bond!];
      if (!bond || bond.order < 1) throw new Error(`${label}.from: that bond no longer exists to be broken.`);
      bond.order -= 1;
      donor = bond.a;
      bondEdits.push(`Break one ${graph.scene.atoms[bond.a].element}–${graph.scene.atoms[bond.b].element} bonding pair.`);
    }

    if (to.atom != null) {
      if (from.atom != null) {
        const existing = product.bonds.find(bond => (bond.a === donor && bond.b === to.atom) || (bond.a === to.atom && bond.b === donor));
        if (existing) existing.order += 1;
        else product.bonds.push({ id: `b${product.bonds.length}`, a: donor, b: to.atom, order: 1, stereo: 0 });
        bondEdits.push(`Form ${graph.scene.atoms[donor].element}–${graph.scene.atoms[to.atom].element} from a lone pair.`);
      } else {
        nonBonding[to.atom] += 2;
        bondEdits.push(`The broken pair becomes non-bonding on ${graph.scene.atoms[to.atom].element}.`);
      }
    } else {
      const bond = product.bonds[to.bond!];
      if (!bond) throw new Error(`${label}.to: that destination bond does not exist.`);
      bond.order += 1;
      bondEdits.push(`Raise ${graph.scene.atoms[bond.a].element}–${graph.scene.atoms[bond.b].element} bond order.`);
    }

    // Report the arrow against the species the renderer draws, not the working graph.
    electronFlow.push({
      from: from.localAtom != null ? { molecule: from.species, atom: from.localAtom } : { molecule: from.species, bond: from.localBond! },
      to: to.localAtom != null ? { molecule: to.species, atom: to.localAtom } : { molecule: to.species, bond: to.localBond! },
    });
  });

  product.bonds = product.bonds.filter(bond => bond.order > 0).map((bond, index) => ({ ...bond, id: `b${index}` }));
  product.atoms.forEach((atom, index) => {
    atom.charge = valenceOf(atom.element) - nonBonding[index] - bondOrderSum(product, index);
    atom.label = atomLabel(atom.element, atom.isotope, atom.charge);
  });

  const split = splitConnected(product);
  for (const piece of split) {
    const probe = kit.get_mol(sceneMolfile(piece.scene));
    if (!probe) throw new Error('The declared arrows produce a structure that cannot be read back; check the electron bookkeeping.');
    probe.delete();
  }
  return { products: split.map(piece => piece.scene), origins: split.map(piece => piece.origin), electronFlow, bondEdits: [...new Set(bondEdits)] };
}

/** Separate the edited graph into the molecules that actually result, keeping provenance. */
function splitConnected(scene: ChemicalScene): Array<{ scene: ChemicalScene; origin: number[] }> {
  const group = scene.atoms.map((_, index) => index);
  const find = (index: number): number => group[index] === index ? index : (group[index] = find(group[index]));
  for (const bond of scene.bonds) group[find(bond.a)] = find(bond.b);
  const buckets = new Map<number, number[]>();
  scene.atoms.forEach((_, index) => {
    const root = find(index);
    buckets.set(root, [...(buckets.get(root) ?? []), index]);
  });
  return [...buckets.values()].map(origin => {
    const remap = new Map(origin.map((atom, position) => [atom, position]));
    return {
      origin,
      scene: {
        atoms: origin.map((atom, position) => ({ ...scene.atoms[atom], id: `a${position}` })),
        bonds: scene.bonds.filter(bond => remap.has(bond.a) && remap.has(bond.b))
          .map((bond, position) => ({ ...bond, id: `b${position}`, a: remap.get(bond.a)!, b: remap.get(bond.b)! })),
      },
    };
  });
}

/**
 * Build the same checked-mechanism record the hardwired rules produce, from declared
 * arrows rather than from a rule that had to be written in advance.
 */
export function deriveElectronFlowMechanism(inputs: string[], order: string[], flows: ElectronFlowEvent[], resonance: boolean, kit: RDKitModule): CheckedMechanism {
  const reactants = inputs.map(source => {
    const molecule = kit.get_mol(source);
    if (!molecule) throw new Error('Invalid mechanism input.');
    try {
      // Explicit hydrogens: a proton transfer cannot be described at all if the
      // hydrogen being moved is not an addressable atom.
      return sceneFromMolfile(molecule.add_hs());
    } finally { molecule.delete(); }
  });
  if (reactants.reduce((total, scene) => total + scene.atoms.length, 0) > 80) throw new Error('Electron-flow mechanisms are limited to eighty atoms in total.');
  const graph = combine(reactants);
  const { products, origins, electronFlow, bondEdits } = applyElectronFlow(reactants, order, flows, kit);
  const scenes = [...reactants, ...products];
  const productBase = reactants.length;

  // Electron flow never creates or destroys atoms, so every reactant atom has exactly
  // one product atom, found through the combined-graph index both sides were built on.
  const atomMap: CheckedMechanism['atomMap'] = [];
  const placement = new Map<number, [number, number]>();
  origins.forEach((origin, piece) => origin.forEach((combined, position) => placement.set(combined, [productBase + piece, position])));
  reactants.forEach((scene, species) => scene.atoms.forEach((_, atom) => {
    const destination = placement.get(graph.atomOffset[species] + atom);
    if (!destination) throw new Error('The declared arrows do not conserve atoms.');
    atomMap.push({ from: [species, atom], to: destination });
  }));

  const result: CheckedMechanism = {
    rule: 'electron-flow',
    scope: 'conditional-elementary-rule-not-product-prediction',
    source: 'https://openstax.org/books/organic-chemistry/pages/2-11-acids-and-bases-the-lewis-definition',
    scenes,
    reactants: reactants.map((_, index) => index),
    products: products.map((_, index) => productBase + index),
    atomMap,
    electronFlow,
    bondEdits,
    resonance,
    canonicalProducts: [],
    limitations: resonance
      ? ['These are resonance contributors, not distinct intermediates, an equilibrium or a temporal reaction.',
        'The electron movement is checked against the structure it produces; the drawn position of each arrow is a layout heuristic.']
      : ['Conditional electron flow exactly as declared, not a prediction of dominant product, rate or yield.',
        'The electron movement is checked against the structure it produces; the drawn position of each arrow is a layout heuristic.'],
  };
  result.canonicalProducts = result.products.map(index => canonicalScene(result.scenes[index], kit));
  // The arrows are only believable if what they build balances against what went in.
  validateMechanismLedger(result, kit);
  return result;
}
