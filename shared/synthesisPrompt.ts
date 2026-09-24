/** The output-format addendum appended to a synthesis-route request, so the author types
 *  only the problem. It is the contract the name-first route path expects: the model supplies
 *  the route, the roles and the systematic IUPAC names, and the application derives every
 *  structure and every balanced equation from the names. */

// « is a backtick and ¤ is a backslash; written as placeholders so the literal text is not
// mangled by source escaping.
const RAW = [
  'Output format — follow exactly.',
  '1. Number every step. For each step write the reagents and conditions, then list EVERY species under',
  '   these four labels, each label on its own line:',
  '   «Reactants:» (species consumed), «Products:» (the intended products), «Byproducts:» (every other',
  '   species on the product side), and «Agents:» (true catalysts or solvents only).',
  '   Give each species as its systematic IUPAC name ONLY — no SMILES, no formula, no backticks. List',
  '   species separated by semicolons. For example:',
  '     Reactants: ethanoic acid; sodium hydroxide',
  '     Products: sodium ethanoate; water',
  '   This applies to EVERY species at EVERY step, including the intermediates you create.',
  '   A multi-component step lists every consumed species under Reactants and every released species',
  '   under Byproducts — a condensation often releases water, carbon dioxide, or both. A worked route',
  '   (a different target, shown only for the shape and the roles):',
  '     Step 1  Reactants: phenylmethanol; hydrogen peroxide',
  '             Products: benzaldehyde',
  '             Byproducts: water',
  '             Agents: none',
  '     Step 2  Reactants: benzaldehyde; propanedioic acid',
  '             Products: (E)-3-phenylprop-2-enoic acid',
  '             Byproducts: carbon dioxide; water',
  '             Agents: pyridine',
  '   In step 2 the consumed propanedioic acid is a Reactant even though the prose may call it a reagent,',
  '   while pyridine — a true catalyst — is the only Agent.',
  '   - Use a true systematic IUPAC name that a reference service can resolve. Keep stereodescriptors',
  '     ((2R), (3Z), …) whenever the species is stereodefined. If an outcome is racemic or a centre is',
  '     unspecified, say so in the prose; do not drop a descriptor silently.',
  '   - A trivial or trade name will not resolve. Give the systematic name wherever one exists. A',
  '     catalyst or solvent with no systematic name may be written as prose in the Agents line.',
  '   - List every species that is consumed or produced, exactly once per side, under the correct role.',
  '     A byproduct is a species on the product side: list it under Byproducts, never repeat a product',
  '     there. Put only a true catalyst or solvent under Agents, and never a species that takes no part. A',
  '     species the step consumes is a Reactant, never an Agent — even when the prose calls it a catalyst,',
  '     or says it is derived from another reagent before it reacts.',
  '   - Every step MUST end with the four labelled lines. A step that gives only a product in prose,',
  '     with no Reactants/Products/Byproducts/Agents list, is incomplete and cannot be checked.',
  '   - A metal that enters as a reagent must leave as a salt: name the metal-containing product or',
  '     byproduct (for example «sodium salicylate», «sodium bromide»), never leave a metal on one side',
  '     only.',
  '   - For a metal-oxo oxidation (dichromate, permanganate, chromium trioxide), name the reduced',
  '     metal as its salt with the acid anion (for example «chromium(III) sulfate», «manganese(II)',
  '     sulfate») and balance hydrogen with water. Do not list an acid and a free anion of the same',
  '     acid separately, and do not repeat an ion that two salts share.',
  '   - A rearrangement or isomerisation that gains and loses no atoms (a Beckmann, Claisen or',
  '     pinacol rearrangement) is written as substrate → product: put the acid or catalyst under',
  '     Agents, and do not invent salt byproducts for it.',
  '   - One net transformation per step, balanced as a single equation. If a step cannot balance as',
  '     one equation, split it into consecutive steps rather than merging transformations.',
  '   - The step prose is the fixed reference: each name must describe the same structure the prose',
  '     describes. Never change the prose to fit a name.',
  '   - Do NOT write any SMILES, molecular formula, reaction string or «reactants>agents>products»',
  '     line anywhere. The application derives every structure and every balanced equation from your',
  '     names, so an equation is never your job.',
  '2. Draw ONLY the final target: emit exactly one fenced code block tagged chemistry-plan, kind',
  '   "structure", using the exact target identity quoted from my request. If a name is given, prefer',
  '   it (kind "name"); otherwise use the SMILES (kind "smiles"). Exact shape:',
  '   {"version":2,"kind":"structure","depiction":"skeletal","species":[{"id":"target","input":{"kind":"name","value":"EXACT TARGET NAME FROM MY REQUEST"}}]}',
  '   Emit no other chemistry-plan, chemfig, smiles, json or SVG block, and never emit a',
  '   nodus-view, nodus-artifact or nodus-capability-result block: those are application results,',
  '   the application draws and verifies every step itself.',
].join('\n');

export const SYNTHESIS_TEMPLATE_ADDENDUM = RAW.split('«').join('`').split('»').join('`').split('¤').join('\\');

const ALREADY_TEMPLATED = 'Output format — follow exactly.';
const CHEMISTRY = /\b(chemistry|chemical|smiles|molecule|molecular|laboratory|reagent|catalyst|solvent|reaction|synthesi[sz]e|retrosynthe|compound|acid|ester|amide|amine|alkene|alkyne|benzene|hydrox|methyl|ethyl|phenyl|oxide|salt)/i;

/** True when a composer message reads like a synthesis problem rather than the full prompt.
 *  Either an explicit "chemistry synthesis" request, or the word synthesis with a chemistry
 *  context — so "synthesis of factions" in another vault is not a chemistry question. */
export function looksLikeSynthesisRequest(text: string): boolean {
  const value = text.trim();
  if (value.length < 12 || value.length > 8000) return false;
  if (value.includes(ALREADY_TEMPLATED)) return false;
  if (/\b(chemistry|chemical)\s+synthesis\b/i.test(value)) return true;
  return /\bsynthes/i.test(value) && CHEMISTRY.test(value);
}
