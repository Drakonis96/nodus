import { Molecule } from 'openchemlib';
import initRDKit from '@rdkit/rdkit';
import type { RDKitLoader, RDKitModule, JSMol } from '@rdkit/rdkit';
import type { ChemistryGraph, ChemistryValidationRequest, ChemistryValidationResult } from '@shared/chemistryDocument';
import { sceneFromMolfile, sceneMolfile, renderScene, exportSceneChemfig, verifySceneChemfig } from './chemistryScene';
import { deriveProjection } from './chemistryProjections';
import { deriveMechanism } from './chemistryMechanisms';
import { deriveNewman, exportNewman, verifyNewman, renderNewman, newmanEvidence } from './chemistryNewman';
import { renderCheckedMechanism, renderExtendedMechanism } from './chemistryRuleRender';

let engine: Promise<RDKitModule> | undefined;
function rdkit(): Promise<RDKitModule> {
  return engine ??= (initRDKit as unknown as RDKitLoader)();
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
    const canonicalSmiles = refs[0].get_smiles();
    if (refs.some(m => m.get_smiles() !== canonicalSmiles)) throw new Error('Chemical references disagree on connectivity, charge, isotope or stereochemistry.');
    const ocl = Molecule.fromSmiles(canonicalSmiles);
    if (ocl.getAllAtoms() > 160) throw new Error('Structures above 160 atoms are outside the validated scope.');
    ocl.ensureHelperArrays(Molecule.cHelperCIP);
    for (let atom = 0; atom < ocl.getAllAtoms(); atom++) {
      let doubleBonds = 0;
      for (let b = 0; b < ocl.getAllBonds(); b++) {
        if (ocl.getBondOrder(b) === 2 && (ocl.getBondAtom(0, b) === atom || ocl.getBondAtom(1, b) === atom)) doubleBonds++;
      }
      if (doubleBonds > 1) throw new Error('Cumulated double bonds are outside the validated stereochemical scope.');
    }
    for (let b = 0; b < ocl.getAllBonds(); b++) {
      if (ocl.getBondParity(b) === Molecule.cBondParityUnknown) throw new Error('Bond stereochemistry is unspecified; provide the required E/Z isomer.');
      if (ocl.isBINAPChiralityBond(b)) throw new Error('Axial stereochemistry is outside the validated scope.');
    }
    let molfile = ocl.toMolfile();
    let scene = parse(molfile);
    if (scene.get_smiles() !== canonicalSmiles) throw new Error('The OpenChemLib layout changed the chemical graph or stereochemistry.');
    // Try a deterministic independent layout for crowded bridged/polycyclic
    // structures. Any change must pass the same stereo-preserving round-trip.
    const alternative = refs[0].get_new_coords(true);
    if (layoutPenalty(alternative) < layoutPenalty(molfile)) {
      const candidate = parse(alternative);
      if (candidate.get_smiles() === canonicalSmiles) { molfile = alternative; scene = candidate; }
    }
    let drawing = sceneFromMolfile(molfile);
    const newman = request.depiction === 'newman' ? deriveNewman(canonicalSmiles, kit, request.conformation) : undefined;
    if (request.depiction === 'fischer' || request.depiction === 'haworth') {
      drawing = deriveProjection(canonicalSmiles, request.depiction, kit);
      molfile = sceneMolfile(drawing);
      scene = parse(molfile);
    }
    const stereo = JSON.parse(scene.get_stereo_tags()) as { CIP_atoms: Array<[number, string]>; CIP_bonds: Array<[number, number, string]> };
    if (stereo.CIP_atoms.some(([, tag]) => tag === '(?)')) throw new Error('A stereocentre is unspecified; provide the required stereoisomer.');
    const json = JSON.parse(scene.get_json());
    if (json.molecules.length !== 1) throw new Error('Only one molecular graph per species is supported.');
    const raw = json.molecules[0];
    const atoms = raw.atoms.map((a: Record<string, number>, i: number) => {
      const value = { ...json.defaults.atom, ...a };
      if (value.nRad || ![1,5,6,7,8,9,14,15,16,17,35,53].includes(value.z)) throw new Error('Radicals and this element are outside the validated organic scope.');
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
    const atomColourPalette = Object.fromEntries([0,1,5,6,7,8,9,14,15,16,17,35,53].map(z => [z, [0, 0, 0]]));
    // CIP remains in the graph metadata; drawing it on every crowded centre can
    // obscure the bonds which actually carry stereochemistry.
    const svg = newman ? renderNewman(newman) : drawing.convention ? renderScene(drawing) : scene.get_svg_with_highlights(JSON.stringify({ ...size, atomColourPalette, prepareMolsBeforeDrawing: false, addStereoAnnotation: false }));
    if (!svg.includes('<svg') || /NaN|Infinity/.test(svg)) throw new Error('Invalid SVG geometry.');
    const result: ChemistryValidationResult = { graph, svg, engineVersion: kit.version() };
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
      const { rule, inputs, approach } = request.mechanism;
      result.mechanism = rule === 'sn2' || rule === 'amide-resonance'
        ? await renderCheckedMechanism(deriveMechanism(rule, inputs, kit), kit)
        : await renderExtendedMechanism(rule, inputs, kit, approach);
    }
    return result;
  } finally {
    for (const molecule of owned) molecule.delete();
  }
}
