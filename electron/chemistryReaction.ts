import type { ChemistryReactionArtifact, ChemistryValidationRequest, ChemistryValidationResult, ReactionSpecies } from '@shared/chemistryDocument';
import { compileChemfig } from './chemistry';

type Validate = (request: ChemistryValidationRequest) => Promise<ChemistryValidationResult>;

/** Each complete species and each disconnected component goes through the same
 * independent graph/stereo checks as a standalone drawing. A balanced equation
 * is not a prediction of chemical feasibility or a verified mechanism. */
export async function renderBalancedReaction(species: ReactionSpecies[], validate: Validate): Promise<ChemistryReactionArtifact> {
  if (!Array.isArray(species) || species.length < 2 || species.length > 12) throw new Error('A scheme needs two to twelve species.');
  const ids = new Set<string>();
  const totals = { reactant: { atoms: {} as Record<string, number>, charge: 0 }, product: { atoms: {} as Record<string, number>, charge: 0 } };
  const fragments: string[] = [];
  const canonical: ReactionSpecies[] = [];
  for (const item of species) {
    if (!item || !/^[a-z][a-z0-9-]{0,39}$/.test(item.id) || ids.has(item.id)
      || !['reactant', 'product', 'agent'].includes(item.role) || !Number.isInteger(item.coefficient) || item.coefficient < 1 || item.coefficient > 12
      || typeof item.smiles !== 'string' || !item.smiles || item.smiles.length > 2000) throw new Error('Invalid reaction species or coefficient.');
    ids.add(item.id);
    const checked = await validate({ references: [item.smiles] });
    canonical.push({ ...item, smiles: checked.graph.canonicalSmiles });
    if (item.role !== 'agent') {
      const total = totals[item.role];
      for (const atom of checked.graph.atoms) {
        const key = `${atom.atomicNumber}:${atom.isotope}`;
        total.atoms[key] = (total.atoms[key] ?? 0) + item.coefficient;
        if (atom.hydrogens) total.atoms['1:0'] = (total.atoms['1:0'] ?? 0) + atom.hydrogens * item.coefficient;
        total.charge += atom.charge * item.coefficient;
      }
    }
    // Preserve every counterion/disconnected fragment. Never silently export
    // only the first spanning tree, as single-component SMILES converters can.
    const components = checked.graph.canonicalSmiles.split('.');
    if (components.length > 8) throw new Error('Too many disconnected components in a species.');
    const sources: string[] = [];
    for (const [index, component] of components.entries()) {
      const result = await validate({ references: [component], exportChemfig: true });
      if (result.chemfig?.status !== 'validated' || !result.chemfig.source) throw new Error(`Reaction component export failed: ${result.chemfig?.reason ?? 'missing checked export'}`);
      sources.push(result.chemfig.source.replace(/@\{([ab]\d+)\}/g, `@{${item.id}c${index}$1}`));
    }
    const molecule = sources.join(' \\quad ');
    // Make it unambiguous that a salt's coefficient multiplies every ion.
    fragments.push(`{${item.coefficient > 1 ? `${item.coefficient}\\,` : ''}${sources.length > 1 ? `(${molecule})` : molecule}}`);
  }
  if (!species.some(s => s.role === 'reactant') || !species.some(s => s.role === 'product')) throw new Error('Both reaction sides are required.');
  for (const key of new Set([...Object.keys(totals.reactant.atoms), ...Object.keys(totals.product.atoms)])) {
    if (totals.reactant.atoms[key] !== totals.product.atoms[key]) throw new Error(`Unbalanced reaction: atom/isotope ${key} is not conserved.`);
  }
  if (totals.reactant.charge !== totals.product.charge) throw new Error('Unbalanced reaction: net formal charge is not conserved.');
  const group = (role: ReactionSpecies['role']) => species.flatMap((s, i) => s.role === role ? [fragments[i]] : []).join(' \\+ ');
  const equation = `\\schemestart ${group('reactant')} \\arrow{->} ${group('product')} \\schemestop`;
  const agents = group('agent');
  const source = agents ? `\\vbox{\\hbox{${equation}}\\vskip16pt\\hbox{Agents (not in balance): \\schemestart ${agents} \\schemestop}}` : equation;
  const svg = await compileChemfig(source);
  return { scope: 'balanced-scheme-not-mechanism', svg, species: canonical, balance: totals.reactant,
    chemfig: { status: 'validated', source, checks: ['Every species/component independently graph- and stereo-checked', 'Integer coefficients; all atoms, isotopes and net charge conserved', 'Every molecular export round-tripped; combined ChemFig compiled', 'All declared agents displayed separately, not consumed in the equation'] },
    limitations: ['This is a balanced scheme, not a verified mechanism or prediction of feasibility, conditions, yield or major product.', 'Balance checks the declared species, coefficients and roles; it does not prove the interpretation of a prose request is complete. Agents are shown separately and excluded from stoichiometric balance.'] };
}
