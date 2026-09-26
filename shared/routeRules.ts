/** The rules every names-first synthesis-route prompt shares: the output contract appended to the
 *  first request and every correction the application offers afterwards. One copy, so the first
 *  answer and its corrections can never ask for different things. */

/** The four labelled lines each step ends with, as the model is asked to write them. */
export const ROUTE_LABEL_LINES = [
  'Reactants: <systematic IUPAC name>; <systematic IUPAC name>',
  'Products: <systematic IUPAC name>',
  'Byproducts: <systematic IUPAC name>',
  'Agents: <catalyst or solvent, or none>',
];

/** How species are named and assigned to roles, how a step is shaped, and when prose may change. */
export const ROUTE_SPECIES_RULES = [
  'Give each species as its systematic IUPAC name ONLY, separated by semicolons. Do not write SMILES, a formula, backticks, a reaction string or a `reactants>agents>products` line anywhere, except in the single structure fallback below and the one target chemistry-plan: the application derives every structure from your names and solves every balanced equation itself.',
  'If, and only if, you cannot give a systematic name a reference service will resolve — an exotic fused cage or a named literature intermediate — write that species as its name followed by its isomeric SMILES in backticks, for example `the photodimer — `C1=CC2(C=C1)OCCO2``. The application takes the SMILES as the structure and checks it with RDKit. Never use this fallback for a species you can name.',
  'A trivial or trade name will not resolve: give the systematic name wherever one exists. A catalyst or solvent with no systematic name may be written as prose in the Agents line.',
  'Keep stereodescriptors ((2R), (3Z), …) whenever a species is stereodefined. If an outcome is racemic, meso or achiral, or a centre is genuinely not controlled, say so in that step\'s prose; never drop a descriptor silently.',
  'List every species that is consumed or produced exactly once per side, under one role: Reactants (consumed), Products (the intended products), Byproducts (every other species on the product side — never repeat a product there) and Agents (true catalysts or solvents only — never a species that takes no part). A species the step consumes is a Reactant, never an Agent, even when the prose calls it a catalyst or says it is derived from another reagent before it reacts.',
  'A multi-component step lists every consumed species under Reactants and every released species under Byproducts — a condensation often releases water, carbon dioxide, or both.',
  'A metal that enters as a reagent leaves as a salt: name the metal-containing product or byproduct (for example `sodium salicylate`, `sodium bromide`); never leave a metal on one side only.',
  'For a metal-oxo oxidation (dichromate, permanganate, chromium trioxide), name the reduced metal as its salt with the acid anion (for example `chromium(III) sulfate`, `manganese(II) sulfate`) and list the water it releases. Do not list an acid and a free anion of the same acid separately, and do not repeat an ion that two salts share.',
  'A rearrangement or isomerisation that gains and loses no atoms (a Beckmann, Claisen or pinacol rearrangement) is written as substrate → product: put the acid or catalyst under Agents, and do not invent salt byproducts for it.',
  'You never choose coefficients: the application solves them from the species you list. What you must get right is which species are present. When a step does not balance, a species is missing (a consumed reagent under Reactants, or a released species under Byproducts) or one is listed that takes no part: add or remove that species by name rather than adjusting any numbers.',
  'One net transformation per step, balanced as a single equation. If a step cannot balance as one equation, split it into consecutive steps. Combine two consecutive steps into one only when together they are one net transformation that balances as a single equation (a one-pot cascade); never combine two distinct transformations. A workup — an acidification, basification or quench that turns a step\'s product into another form (freeing an acid from its salt) — is always its own step, never folded into the step before it.',
  'Carry an intermediate from one step into the next with exactly the same systematic IUPAC name, including its stereodescriptors.',
  'The step prose is the reference for what each step does: every name must describe the structure the prose describes, and you never change the prose just to make a name fit. Prose changes only to state a racemic or uncontrolled outcome, or where a step is rewritten, split, combined or inserted — then write that step\'s prose and names together.',
  'Every step ends with the four labelled lines. A step that gives its product only in prose cannot be checked.',
];

/** What a correction says about the target drawing. The drawing tool accepts only an identity
 *  quoted in the current message, so a correction quotes the target exactly as the original
 *  request did; with no such target it asks for no drawing rather than one that is refused. */
export function correctionTargetPlanRule(target: string | null | undefined): string {
  const never = 'Never emit a chemistry-plan for a step, and never a nodus-view, nodus-artifact or nodus-capability-result block: the application draws and checks every step itself.';
  if (!target) return `Do not emit a chemistry-plan block in this correction: the application keeps the target from the original request. ${never}`;
  return [
    `The requested target, exactly as the original request gave it: \`${target}\`.`,
    `Draw only that target: emit exactly one fenced code block tagged chemistry-plan with {"version":2,"kind":"structure","depiction":"skeletal","species":[{"id":"target","input":{"kind":"smiles","value":"${target}"}}]}, copying the target exactly as quoted above. ${never}`,
  ].join('\n');
}
