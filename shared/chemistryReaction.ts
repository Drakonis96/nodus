import type { ChemistryIntent } from './chemistryDocument';

/** Split only an explicit, complete reaction SMILES. No guessing from prose,
 * automatic balancing, omitted agents, or empty dot-components. */
export function reactionSmilesSpecies(source: string): ChemistryIntent['species'] {
  if (!source || source.length > 4000 || /\s/.test(source)) throw new Error('Provide one complete reaction SMILES without whitespace.');
  const fields = source.split('>');
  if (fields.length !== 3 || !fields[0] || !fields[2]) throw new Error('Reaction SMILES must be reactants>agents>products or reactants>>products.');
  const roles = ['reactant', 'agent', 'product'] as const;
  const species = fields.flatMap((field, i) => {
    if (!field && i === 1) return [];
    return field.split('.').map((value, j) => {
      if (!value) throw new Error('Empty species in reaction SMILES.');
      return { id: `${roles[i]}-${j}`, input: { kind: 'smiles' as const, value }, role: roles[i], coefficient: 1 };
    });
  });
  if (species.length > 12) throw new Error('A reaction scheme supports at most twelve species.');
  return species;
}
