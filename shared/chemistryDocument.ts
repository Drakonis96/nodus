export type ChemistryRule = 'sn2' | 'amide-resonance' | 'e2' | 'aldol' | 'diels-alder' | 'electron-flow';
export type NewmanConformation = 'anti' | 'gauche' | 'eclipsed' | 'staggered';
/**
 * Which atom an arrow touches, named the way a chemist would say it rather than by a
 * coordinate the model cannot know. The element must pick out exactly one atom in its
 * species; `index` breaks a tie among equivalent atoms, counted in the order they
 * appear. This keeps the version-2 rule intact: the model states chemistry, never
 * geometry, and the application resolves it against the structure it fetched.
 */
export interface ElectronFlowSelector { element: string; index?: number }

/**
 * One curved arrow: an electron pair leaving a lone pair or a bond, and arriving at an
 * atom (forming a bond from the donor) or at a bond (raising its order).
 */
export type ElectronFlowBond = [string, string] | { between: [string, string]; order?: number; index?: number };

export interface ElectronFlowEvent {
  from: { species: string; atom?: ElectronFlowSelector; bond?: ElectronFlowBond };
  to: { species: string; atom?: ElectronFlowSelector; bond?: ElectronFlowBond };
  kind?: 'pair' | 'single';
}

/** Model-authored intent is deliberately distinct from application-authored evidence. */
export interface ChemistryIntent {
  version: 2;
  kind: 'structure' | 'comparison' | 'mechanism' | 'reaction' | 'resonance';
  depiction: 'skeletal' | 'fischer' | 'haworth' | 'newman';
  rule?: ChemistryRule;
  conformation?: NewmanConformation;
  approach?: 'endo' | 'exo';
  /**
   * Declared curved arrows. Present for a mechanism or resonance the bounded rule
   * library does not cover, which is most of them: the arrows are checked by applying
   * them and seeing whether the structure they build conserves atoms and charge.
   */
  electronFlow?: ElectronFlowEvent[];
  species: Array<{ id: string; input: { kind: 'name' | 'pubchem-cid' | 'smiles'; value: string }; role?: ReactionRole; coefficient?: number }>;
}

export type ReactionRole = 'reactant' | 'product' | 'agent';
export interface ReactionSpecies { id: string; smiles: string; role: ReactionRole; coefficient: number }
export interface ChemistryReactionArtifact {
  scope: 'balanced-scheme-not-mechanism';
  svg: string;
  chemfig: ChemistryChemfigExport;
  species: ReactionSpecies[];
  balance: { atoms: Record<string, number>; charge: number };
  limitations: string[];
}

export interface ChemistryReference {
  provider: 'opsin' | 'pubchem' | 'user';
  query: string;
  smiles: string;
  url?: string;
  retrievedAt: string;
}

export interface ChemistryGraph {
  canonicalSmiles: string;
  molfile: string;
  atoms: Array<{ id: string; atomicNumber: number; charge: number; isotope: number; hydrogens: number; cip?: string }>;
  bonds: Array<{ id: string; atoms: [string, string]; order: number; cip?: string }>;
}

/**
 * Why a drawing could not be fully certified. Scope limits are the application's
 * own boundary, never the user's mistake, so they degrade the trust level instead
 * of refusing the drawing.
 */
export type ChemistryPartialReason =
  | 'element-outside-cip-scope'
  | 'stereochemistry-not-assignable'
  | 'layout-roundtrip-changed-geometry'
  | 'structure-above-validated-size'
  | 'arrow-geometry-heuristic';

export interface ChemistryDocument {
  version: 2;
  /**
   * Created only by the resolver, never accepted in model JSON.
   * `verified` — identity cross-checked and the graph survived the molfile round-trip.
   * `partial`  — the graph is valid and balanced, but something listed in
   *              `partialReasons` fell outside what this build can certify.
   */
  status: 'verified' | 'partial';
  scope: 'reference-graph-and-molfile-roundtrip' | 'graph-valid-validation-incomplete';
  engine: { name: 'RDKit'; version: string };
  species: Array<{ id: string; input: ChemistryIntent['species'][number]['input']; references: ChemistryReference[]; graph: ChemistryGraph; svg: string; depiction?: ChemistryIntent['depiction']; chemfig?: ChemistryChemfigExport; projection?: { convention: string; axis: [string, string]; dihedralDegrees: number; molfile3D: string } }>;
  mechanism?: ChemistryMechanismArtifact;
  reaction?: ChemistryReactionArtifact;
  limitations: string[];
  /** Present when `status` is `partial`; states exactly what was not checked. */
  partialReasons?: ChemistryPartialReason[];
  reason?: string;
  /** Set when a common name was resolved to a curated form the user did not spell out. */
  assumedIdentity?: string;
}

export type ChemistryResolution = ChemistryDocument | {
  version: 2;
  status: 'needs-clarification' | 'unsupported';
  reason: string;
};

export interface ChemistryChemfigExport { status: 'validated' | 'unsupported'; source?: string; reason?: string; checks?: string[] }
export interface ChemistryMechanismArtifact {
  rule: ChemistryRule; scope: 'conditional-elementary-rule-not-product-prediction'; source: string;
  svg: string; chemfig: ChemistryChemfigExport; canonicalProducts: string[]; limitations: string[];
  atomMap: Array<{ from: [number, number]; to: [number, number] }>;
  electronFlow: Array<{ from: { molecule: number; atom?: number; bond?: number }; to: { molecule: number; atom?: number; bond?: number } }>;
  bondEdits: string[];
  /** Atom/bond indices in mappings and flows address these V2000 records. */
  molecules: Array<{ id: string; role: 'reactant' | 'product'; canonicalSmiles: string; molfile: string }>;
  title?: string;
  geometry?: { description: string; molfile3D: string; dihedralDegrees?: number };
  panels?: ChemistryMechanismArtifact[];
}
export interface ChemistryValidationRequest {
  references: string[];
  depiction?: ChemistryIntent['depiction'];
  conformation?: NewmanConformation;
  exportChemfig?: boolean;
  mechanism?: {
    rule: ChemistryRule;
    inputs: string[];
    approach?: 'endo' | 'exo';
    /** Declared arrows, with the species ids they address, in the same order as `inputs`. */
    electronFlow?: ElectronFlowEvent[];
    order?: string[];
    resonance?: boolean;
  };
  reaction?: ReactionSpecies[];
}
export interface ChemistryValidationResult { graph: ChemistryGraph; svg: string; engineVersion: string; chemfig?: ChemistryChemfigExport; mechanism?: ChemistryMechanismArtifact; reaction?: ChemistryReactionArtifact; projection?: ChemistryDocument['species'][number]['projection']; partialReasons?: ChemistryPartialReason[];
  /** Set when references agreed on the graph but only one supplied stereochemistry. */
  reconciledStereochemistry?: boolean }
