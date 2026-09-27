/** The output-format addendum appended to a synthesis-route request, so the author types
 *  only the problem. It is the contract the name-first route path expects: the model supplies
 *  the route, the roles and the systematic IUPAC names, and the application derives every
 *  structure and every balanced equation from the names. */

import { ROUTE_SPECIES_RULES } from './routeRules';

// « is a backtick and ¤ is a backslash; written as placeholders so the literal text is not
// mangled by source escaping.
const HEAD = [
  'Output format — follow exactly.',
  '1. Number every step. For each step write the reagents and conditions in prose, then list EVERY species',
  '   under these four labels, each label on its own line:',
  '   «Reactants:» (species consumed), «Products:» (the intended products), «Byproducts:» (every other',
  '   species on the product side), and «Agents:» (true catalysts or solvents only). For example:',
  '     Reactants: ethanoic acid; sodium hydroxide',
  '     Products: sodium ethanoate',
  '     Byproducts: water',
  '     Agents: none',
  '   This applies to EVERY species at EVERY step, including the intermediates you create. A worked route',
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
  '   Rules for every step:',
];

const TAIL = [
  '2. Draw ONLY the final target: emit exactly one fenced code block tagged chemistry-plan, kind',
  '   "structure", using the exact target identity quoted from my request. If my request gives the',
  '   target\'s SMILES, use it (kind "smiles"): it is the structure itself and needs no lookup. Only',
  '   when no SMILES is given, use the exact name (kind "name"). Exact shape:',
  '   {"version":2,"kind":"structure","depiction":"skeletal","species":[{"id":"target","input":{"kind":"smiles","value":"EXACT TARGET SMILES FROM MY REQUEST"}}]}',
  '   Emit no other chemistry-plan, chemfig, smiles, json or SVG block, and never emit a',
  '   nodus-view, nodus-artifact or nodus-capability-result block: those are application results,',
  '   the application draws and verifies every step itself.',
];

const placeholders = (lines: string[]) => lines.join('\n').split('«').join('`').split('»').join('`').split('¤').join('\\');

/** The species rules are shared with every correction the application offers afterwards
 *  (`ROUTE_SPECIES_RULES`), so the first answer and its fixes are held to the same contract. */
export const SYNTHESIS_TEMPLATE_ADDENDUM = [
  placeholders(HEAD),
  ...ROUTE_SPECIES_RULES.map((rule) => `   - ${rule}`),
  placeholders(TAIL),
].join('\n');

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
