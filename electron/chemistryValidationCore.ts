import { Molecule } from 'openchemlib';
import initRDKit from '@rdkit/rdkit';
import type { RDKitLoader, RDKitModule, JSMol } from '@rdkit/rdkit';
import type { ChemistryGraph, ChemistryPartialReason, ChemistryValidationRequest, ChemistryValidationResult } from '@shared/chemistryDocument';
import { sceneFromMolfile, sceneMolfile, renderScene, exportSceneChemfig, verifySceneChemfig } from './chemistryScene';
import { deriveProjection } from './chemistryProjections';
import { deriveMechanism } from './chemistryMechanisms';
import { deriveNewman, exportNewman, verifyNewman, renderNewman, newmanEvidence } from './chemistryNewman';
import { renderCheckedMechanism, renderExtendedMechanism } from './chemistryRuleRender';

/**
 * Elements where RDKit's CIP labeller and implicit-valence model are dependable.
 * Anything outside still draws; it just downgrades the document to `partial`.
 */
const ORGANIC_CIP_ELEMENTS = new Set([1, 5, 6, 7, 8, 9, 14, 15, 16, 17, 35, 53]);

let engine: Promise<RDKitModule> | undefined;
function rdkit(): Promise<RDKitModule> {
  return engine ??= (initRDKit as unknown as RDKitLoader)();
}

/**
 * Whether an unspecified double bond is genuinely ambiguous.
 *
 * OpenChemLib exempts rings of seven atoms or fewer (`isSmallRingBond`) and treats
 * every larger ring double bond exactly like an acyclic one. That threshold is right
 * in general — trans-cyclooctene is isolable, so an eight-ring really does have two
 * geometries — but it misfires on a double bond fused into a smaller ring, where the
 * ring system already fixes the geometry. Porphyrin and chlorophyll cores are the
 * cases that matter: their meso bridges were reported as unspecified E/Z.
 */
function stereogenicRingBond(molecule: Molecule, bond: number, rings: ReturnType<Molecule['getRingSet']>): boolean {
  if (!molecule.isRingBond(bond)) return true;
  if (molecule.isAromaticBond(bond)) return false;
  if (molecule.getBondRingSize(bond) < 8) return false;
  const first = molecule.getBondAtom(0, bond), second = molecule.getBondAtom(1, bond);
  for (let ring = 0; ring < rings.getSize(); ring++) {
    const atoms = rings.getRingAtoms(ring);
    if (atoms.includes(first) || atoms.includes(second)) return false;
  }
  return true;
}

function layoutPenalty(molfile: string): number {
  const molecule = Molecule.fromMolfile(molfile);
  let length = 0;
  for (let b = 0; b < molecule.getAllBonds(); b++) {
    const a = molecule.getBondAtom(0, b), c = molecule.getBondAtom(1, b);
    length += Math.hypot(molecule.getAtomX(a) - molecule.getAtomX(c), molecule.getAtomY(a) - molecule.getAtomY(c));
  }
  const unit = length / Math.max(1, molecule.getAllBonds()) || 1;
  let penalty = 0;
  for (let a = 0; a < molecule.getAllAtoms(); a++) {
    for (let b = a + 1; b < molecule.getAllAtoms(); b++) {
      const distance = Math.hypot(molecule.getAtomX(a) - molecule.getAtomX(b), molecule.getAtomY(a) - molecule.getAtomY(b)) / unit;
      penalty += Math.max(0, 0.9 - distance) ** 2;
    }
  }
  return penalty;
}

/** Call only inside a killable process: WASM cannot be interrupted by Promise.race. */
export async function validateChemicalReferences(request: ChemistryValidationRequest): Promise<ChemistryValidationResult> {
  if (!Array.isArray(request.references) || request.references.length < 1 || request.references.length > 3
    || request.references.some(s => typeof s !== 'string' || !s || s.length > 2000 || /\s|\||\*/.test(s))) {
    throw new Error('Unsupported molecular input.');
  }
  if (request.references.some(s => /@(?:AL|SP|TB|OH|TH)/.test(s))) throw new Error('Extended or non-tetrahedral stereochemistry is outside the validated scope.');
  const kit = await rdkit();
  const owned: JSMol[] = [];
  const parse = (source: string): JSMol => {
    const molecule = kit.get_mol(source);
    if (!molecule) throw new Error('RDKit rejected the molecular graph.');
    owned.push(molecule);
    if (!molecule.is_valid()) throw new Error('Invalid molecular graph.');
    return molecule;
  };
  try {
    const refs = request.references.map(parse);
    for (const [index, molecule] of refs.entries()) {
      const specified = (request.references[index].match(/\[[^\]]*@{1,2}[^\]]*\]/g) ?? []).length;
      const tags = JSON.parse(molecule.get_stereo_tags()) as { CIP_atoms: Array<[number, string]>; CIP_bonds: unknown[] };
      if (specified !== tags.CIP_atoms.filter(([, tag]) => tag !== '(?)').length) throw new Error('A supplied stereochemical annotation was discarded or cannot be validated.');
      if (/[\\/]/.test(request.references[index]) && !tags.CIP_bonds.length) throw new Error('A supplied double-bond stereochemical annotation was discarded.');
    }
    // Same engine, same canonicalization, stereo/isotope/charge retained. Never
    // compare canonical strings produced by different toolkits or sorted CIP lists.
    let reference = refs[0];
    let reconciledStereochemistry = false;
    if (refs.some(m => m.get_smiles() !== reference.get_smiles())) {
      // OPSIN reads a systematic name literally, so it returns the flat skeleton where
      // PubChem returns the curated isomer. That is not a disagreement about which
      // molecule this is, and refusing it left the user holding a message they could do
      // nothing with. When the references agree on connectivity, charge and isotopes,
      // adopt the most specified form and declare it, rather than abstaining over the
      // other's silence. A real disagreement about the graph still refuses.
      // Re-canonicalize each reference with its stereo descriptors removed. Chirality
      // and double-bond direction are the only things `@`, `/` and `\` encode, so the
      // result is the bare skeleton, compared through the same engine as everything else.
      const skeletonOf = (molecule: JSMol): string => parse(molecule.get_smiles().replace(/@/g, '').replace(/[\\/]/g, '')).get_smiles();
      const skeleton = skeletonOf(reference);
      if (refs.some(m => skeletonOf(m) !== skeleton)) throw new Error('Chemical references disagree on connectivity, charge, isotope or stereochemistry.');
      const specified = (molecule: JSMol): number => {
        const tags = JSON.parse(molecule.get_stereo_tags()) as { CIP_atoms: Array<[number, string]>; CIP_bonds: unknown[] };
        return tags.CIP_atoms.filter(([, tag]) => tag !== '(?)').length + tags.CIP_bonds.length;
      };
      // Silence may be filled in; contradiction may not. Every other reference has to
      // be stereochemically mute, so this stays a case of one source saying nothing.
      // Two references that both specify and disagree — R against S — are a real
      // conflict about which compound this is, and still refuse.
      reference = refs.reduce((chosen, molecule) => specified(molecule) > specified(chosen) ? molecule : chosen, reference);
      if (refs.some(m => m !== reference && specified(m) > 0)) throw new Error('Chemical references disagree on connectivity, charge, isotope or stereochemistry.');
      reconciledStereochemistry = true;
    }
    const canonicalSmiles = reference.get_smiles();
    const partialReasons = new Set<ChemistryPartialReason>();
    const ocl = Molecule.fromSmiles(canonicalSmiles);
    // Size is a resource guard, not a chemical judgement: a large structure still
    // draws, it simply stops carrying a full-verification claim.
    if (ocl.getAllAtoms() > 600) throw new Error('Structures above 600 atoms cannot be drawn in the available time budget.');
    if (ocl.getAllAtoms() > 160) partialReasons.add('structure-above-validated-size');
    ocl.ensureHelperArrays(Molecule.cHelperCIP);
    for (let atom = 0; atom < ocl.getAllAtoms(); atom++) {
      let doubleBonds = 0;
      for (let b = 0; b < ocl.getAllBonds(); b++) {
        if (ocl.getBondOrder(b) === 2 && (ocl.getBondAtom(0, b) === atom || ocl.getBondAtom(1, b) === atom)) doubleBonds++;
      }
      if (doubleBonds > 1) throw new Error('Cumulated double bonds are outside the validated stereochemical scope.');
    }
    const rings = ocl.getRingSet();
    for (let b = 0; b < ocl.getAllBonds(); b++) {
      if (ocl.getBondParity(b) === Molecule.cBondParityUnknown && stereogenicRingBond(ocl, b, rings)) throw new Error('Bond stereochemistry is unspecified; provide the required E/Z isomer.');
      if (ocl.isBINAPChiralityBond(b)) throw new Error('Axial stereochemistry is outside the validated scope.');
    }
    // Two independent layout engines. A drawing is only usable if its coordinates
    // round-trip back to the same graph, so when OpenChemLib's coordinate inventor
    // rewrites geometry — it flips long conjugated polyenes inside macrolactones —
    // RDKit's own layout is tried before giving up. A wrong picture is never drawn.
    const oclMolfile = ocl.toMolfile();
    const rdkitMolfile = reference.get_new_coords(true);
    const faithful = (source: string): JSMol | undefined => {
      try { const candidate = parse(source); return candidate.get_smiles() === canonicalSmiles ? candidate : undefined; }
      catch { return undefined; }
    };
    const oclScene = faithful(oclMolfile), rdkitScene = faithful(rdkitMolfile);
    let molfile: string, scene: JSMol;
    if (oclScene && rdkitScene) {
      const preferRdkit = layoutPenalty(rdkitMolfile) < layoutPenalty(oclMolfile);
      molfile = preferRdkit ? rdkitMolfile : oclMolfile;
      scene = preferRdkit ? rdkitScene : oclScene;
    } else if (oclScene) { molfile = oclMolfile; scene = oclScene; }
    else if (rdkitScene) {
      molfile = rdkitMolfile; scene = rdkitScene;
      partialReasons.add('layout-roundtrip-changed-geometry');
    } else throw new Error('No available layout reproduced the reference graph and stereochemistry.');
    let drawing = sceneFromMolfile(molfile);
    const newman = request.depiction === 'newman' ? deriveNewman(canonicalSmiles, kit, request.conformation) : undefined;
    if (request.depiction === 'fischer' || request.depiction === 'haworth') {
      drawing = deriveProjection(canonicalSmiles, request.depiction, kit);
      molfile = sceneMolfile(drawing);
      scene = parse(molfile);
    }
    const stereo = JSON.parse(scene.get_stereo_tags()) as { CIP_atoms: Array<[number, string]>; CIP_bonds: Array<[number, number, string]> };
    const json = JSON.parse(scene.get_json());
    if (json.molecules.length !== 1) throw new Error('Only one molecular graph per species is supported.');
    const raw = json.molecules[0];
    const elementOf = (index: number): number => ({ ...json.defaults.atom, ...raw.atoms[index] }).z;
    // An unassigned centre on carbon is a real question for the user. On a metal it is
    // not: RDKit's CIP labeller reports a four-coordinate iron or cobalt as an
    // unspecified stereocentre, which is what made haem b and cyanocobalamin look
    // ambiguous when nothing about them was. Trust the labeller only where it is sound.
    for (const [index, tag] of stereo.CIP_atoms) {
      if (tag !== '(?)') continue;
      if (ORGANIC_CIP_ELEMENTS.has(elementOf(index))) throw new Error('A stereocentre is unspecified; provide the required stereoisomer.');
      partialReasons.add('stereochemistry-not-assignable');
    }
    const atoms = raw.atoms.map((a: Record<string, number>, i: number) => {
      const value = { ...json.defaults.atom, ...a };
      // Every element draws. Outside the organic set the CIP labeller and the implicit
      // valence model are not dependable, so the drawing keeps its graph and its balance
      // check but stops claiming stereochemical verification. Refusing an element the
      // toolkits parse perfectly well was this validator's own limit, not chemistry's.
      if (!ORGANIC_CIP_ELEMENTS.has(value.z)) partialReasons.add('element-outside-cip-scope');
      return { id: `a${i}`, atomicNumber: value.z, charge: value.chg, isotope: value.isotope, hydrogens: value.impHs,
        ...(stereo.CIP_atoms.find(([index]) => index === i) ? { cip: stereo.CIP_atoms.find(([index]) => index === i)![1].replace(/[()]/g, '') } : {}) };
    });
    const bonds = raw.bonds.map((b: { atoms: [number, number]; bo?: number }, i: number) => {
      const tag = stereo.CIP_bonds.find(([a, c]) => a === b.atoms[0] && c === b.atoms[1] || a === b.atoms[1] && c === b.atoms[0]);
      return { id: `b${i}`, atoms: b.atoms.map(a => `a${a}`) as [string, string], order: b.bo ?? json.defaults.bond.bo,
        ...(tag ? { cip: tag[2].replace(/[()]/g, '') } : {}) };
    });
    const graph: ChemistryGraph = { canonicalSmiles, molfile, atoms, bonds };
    // Render the exact round-tripped scene, not the original text or another layout.
    const size = atoms.length > 40 ? { width: 1000, height: 650 } : { width: 640, height: 420 };
    // Monochrome textbook notation for whatever elements the structure actually
    // contains, so a metal does not arrive in RDKit's default CPK colour.
    const atomColourPalette = Object.fromEntries([0, ...new Set(atoms.map((a: { atomicNumber: number }) => a.atomicNumber))].map(z => [z, [0, 0, 0]]));
    // CIP remains in the graph metadata; drawing it on every crowded centre can
    // obscure the bonds which actually carry stereochemistry.
    const svg = newman ? renderNewman(newman) : drawing.convention ? renderScene(drawing) : scene.get_svg_with_highlights(JSON.stringify({ ...size, atomColourPalette, prepareMolsBeforeDrawing: false, addStereoAnnotation: false }));
    if (!svg.includes('<svg') || /NaN|Infinity/.test(svg)) throw new Error('Invalid SVG geometry.');
    const result: ChemistryValidationResult = { graph, svg, engineVersion: kit.version(), ...(partialReasons.size ? { partialReasons: [...partialReasons] } : {}), ...(reconciledStereochemistry ? { reconciledStereochemistry } : {}) };
    if (request.reaction) {
      if (request.mechanism) throw new Error('A balanced scheme cannot also claim mechanism verification.');
      const { renderBalancedReaction } = await import('./chemistryReaction');
      result.reaction = await renderBalancedReaction(request.reaction, validateChemicalReferences);
    }
    if (newman) result.projection = newmanEvidence(newman);
    if (request.exportChemfig) {
      try {
        const source = newman ? exportNewman(newman) : exportSceneChemfig(drawing);
        if (newman) verifyNewman(source, newman, canonicalSmiles, kit);
        else verifySceneChemfig(source, drawing, canonicalSmiles, kit);
        const { compileChemfig } = await import('./chemistry');
        await compileChemfig(source);
        result.chemfig = { status: 'validated', source, checks: ['Parsed emitted topology, labels, bond orders and coordinates', 'RDKit stereochemical round-trip under the stated projection convention', 'Actual ChemFig compilation in a killable worker'] };
      } catch (error) { result.chemfig = { status: 'unsupported', reason: error instanceof Error ? error.message : 'ChemFig export failed validation.' }; }
    }
    if (request.mechanism) {
      const { rule, inputs, approach, electronFlow, order, resonance } = request.mechanism;
      if (rule === 'electron-flow') {
        const { deriveElectronFlowMechanism } = await import('./chemistryArrowLedger');
        result.mechanism = await renderCheckedMechanism(deriveElectronFlowMechanism(inputs, order ?? [], electronFlow ?? [], !!resonance, kit), kit);
        // The electron movement is proved by applying it; where each arrow is drawn is
        // still a heuristic, and the document says so rather than implying otherwise.
        partialReasons.add('arrow-geometry-heuristic');
        result.partialReasons = [...partialReasons];
      } else {
        result.mechanism = rule === 'sn2' || rule === 'amide-resonance'
          ? await renderCheckedMechanism(deriveMechanism(rule, inputs, kit), kit)
          : await renderExtendedMechanism(rule, inputs, kit, approach);
      }
    }
    return result;
  } finally {
    for (const molecule of owned) molecule.delete();
  }
}
