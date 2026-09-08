export type ChemistryRule = 'sn2' | 'amide-resonance' | 'e2' | 'aldol' | 'diels-alder';
export type NewmanConformation = 'anti' | 'gauche' | 'eclipsed' | 'staggered';
/** Model-authored intent is deliberately distinct from application-authored evidence. */
export interface ChemistryIntent {
  version: 2;
  kind: 'structure' | 'comparison' | 'mechanism' | 'reaction';
  depiction: 'skeletal' | 'fischer' | 'haworth' | 'newman';
  rule?: ChemistryRule;
  conformation?: NewmanConformation;
  approach?: 'endo' | 'exo';
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

export interface ChemistryDocument {
  version: 2;
  /** This status is created only by the resolver, never accepted in model JSON. */
  status: 'verified';
  scope: 'reference-graph-and-molfile-roundtrip';
  engine: { name: 'RDKit'; version: string };
  species: Array<{ id: string; input: ChemistryIntent['species'][number]['input']; references: ChemistryReference[]; graph: ChemistryGraph; svg: string; depiction?: ChemistryIntent['depiction']; chemfig?: ChemistryChemfigExport; projection?: { convention: string; axis: [string, string]; dihedralDegrees: number; molfile3D: string } }>;
  mechanism?: ChemistryMechanismArtifact;
  reaction?: ChemistryReactionArtifact;
  limitations: string[];
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
export interface ChemistryValidationRequest { references: string[]; depiction?: ChemistryIntent['depiction']; conformation?: NewmanConformation; exportChemfig?: boolean; mechanism?: { rule: ChemistryRule; inputs: string[]; approach?: 'endo' | 'exo' }; reaction?: ReactionSpecies[] }
export interface ChemistryValidationResult { graph: ChemistryGraph; svg: string; engineVersion: string; chemfig?: ChemistryChemfigExport; mechanism?: ChemistryMechanismArtifact; reaction?: ChemistryReactionArtifact; projection?: ChemistryDocument['species'][number]['projection'] }
