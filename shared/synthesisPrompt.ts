/** The output-format addendum appended to a synthesis-route request, so the author types
 *  only the problem. It is the same contract the route checker and the drawing path expect:
 *  one balanced `reactants>agents>products` string per step and one target plan. */

// « is a backtick and ¤ is a backslash; written as placeholders so the literal text is not
// mangled by source escaping.
const RAW = [
  'Output format — follow exactly.',
  '1. Number every step. For each step give: the reagents and conditions; each reactant as an isomeric',
  "   SMILES; and the product's name and isomeric SMILES. This applies to EVERY species at EVERY step,",
  '   including the intermediates you create.',
  '2. After the list, print exactly one BALANCED reaction SMILES per step, each on its own line inside',
  '   backticks, in the form «reactants>agents>products».',
  '   - Exactly TWO ">" characters per string — one before the agents field, one after it. Never write',
  '     three. If there are no agents the middle field is empty and there are still two:',
  '     «reactants>>products». With one agent it is «reactants>agent>products» — for example',
  '     «CCC#CCC.[H][H]>[Pd]>CC/C=C¤CC». Never write «>agent>>products» (three ">").',
  '   - No spaces and no "+" signs. Separate species with ".".',
  '   - Every species must be valid SMILES. Never write a name, a formula, or a bracketed formula.',
  '     Use: hydrogen «[H][H]» (not «[H2]»); sodium amide «[Na+].[NH2-]» (not «[NaNH2]»); sodium',
  '     hydroxide «[Na+].[OH-]» (not «NaOH»); sodium ethoxide «[Na+].[O-]CC»; water «O» (not «H2O»);',
  '     carbon dioxide «O=C=O»; ammonia «N»; hydrogen bromide «Br»; sodium bromide «[Na+].[Br-]»;',
  '     hydroxide «[OH-]».',
  '   - Consumed reagents are reactants; every byproduct is a product. Put in the agents field ONLY a',
  '     true catalyst — a species regenerated unchanged, such as H2SO4 in nitration. Anything consumed',
  '     or produced — water, CO2, a hydrogen halide, a metal salt, a quenched base, or H2SO4 when it is',
  '     the sulfonating agent — MUST be a reactant or a product, so its atoms stay in the mass and',
  '     charge balance. Never put light, heat, workup, or the word "heat" inside the string — keep',
  '     those in the prose.',
  '   - Every equation must be atom- and charge-balanced. Do NOT write stoichiometric coefficients and',
  '     do NOT repeat a species to stand for a coefficient; list each distinct species once per side and',
  '     let the coefficients be solved.',
  '   - Write each ion of a salt once per side and let the coefficient count the equivalents: if «[Na+]»',
  '     appears once among the reactants, write it once among the products too. A disodium salt is one',
  '     «[Na+]» with the dianion, not «[Na+].[Na+]» on one side only; hydrochloric acid is one',
  '     «[H+].[Cl-]», not two. A counterion written a different number of times on the two sides is the',
  '     usual reason a metal will not balance.',
  '   - Write an organic product neutral, not protonated with a free counterion. When a metal and an',
  '     acid reduce a substrate (Sn/HCl, Fe/HCl, Zn/HCl), the acid anion leaves with the metal as its',
  '     salt — «Cl[Sn]Cl», «Cl[Fe]Cl» — and the amine or alcohol is written neutral («Nc1ccccc1»),',
  '     never as «[NH3+]…» beside a free «[Cl-]».',
  '   - Never omit a product or a reactant. Every species that is consumed or formed must appear on the',
  '     correct side, or the equation cannot balance.',
  '   - A metal counterion balances too. A metal that enters as a reagent (sodium from «[Na+].[OH-]»,',
  '     potassium from «[K+].[OH-]») must leave as a salt: the cation with its anion on the product side',
  '     (sodium salicylate «O=C([O-])c1ccccc1O.[Na+]») or as a salt byproduct such as «[Na+].[Cl-]».',
  '     Never leave a metal ion on one side only.',
  '   - A metal base is consumed and its product is a salt. Carboxylating a metal phenoxide (NaOH or',
  '     KOH, then CO2) gives the carboxylate salt with the cation on the product side; the free acid',
  '     appears only after a separate acid-workup step with its own acid. Do not write the neutral acid',
  '     as that step\'s product, and do not also list the consumed base in the agents field.',
  '   - Every equation MUST survive the balance check on its own: the element totals AND the total',
  '     charge must match exactly on both sides (mass balance and charge balance). You may combine',
  '     operations into a single line only if the combined equation still balances; if it does not,',
  '     split it into separate numbered steps rather than write an equation that will fail the check.',
  '   - One net transformation per equation. Never put a base and an acid in the same step: their',
  '     neutralisation is a second, independent balanced equation and the step becomes ambiguous.',
  '     Hydrolyse an ester with water (an acid catalyst goes in the agents field), or saponify with',
  '     hydroxide and protonate in a separate step — not NaOH and H2SO4 together.',
  '   - Carry an intermediate between consecutive steps with the exact same isomeric SMILES in both',
  '     places. Specify every stereocentre (@/@@) and every double-bond geometry (/¤) explicitly; never',
  '     leave a newly formed one unspecified — unless the target is racemic, in which case write the',
  '     word racemic in the step that forms it and leave that centre unspecified, and the checker will',
  '     report a declared racemate instead of refusing the step.',
  "   - The product SMILES in the prose list must be character-for-character the same as the one in that",
  "     step's reaction string.",
  '   - If a step genuinely cannot be written as one balanced equation, say so in the prose and omit its',
  '     reaction line rather than inventing one.',
  '3. Draw ONLY the final target: emit exactly one fenced code block tagged chemistry-plan, kind',
  '   "structure", using the exact target identity quoted from my request. If a name is given, prefer',
  '   it (kind "name") because it needs no escaping; otherwise use the SMILES (kind "smiles") and make',
  '   the JSON valid by escaping every backslash as ¤¤. Exact shape:',
  '   {"version":2,"kind":"structure","depiction":"skeletal","species":[{"id":"target","input":{"kind":"name","value":"EXACT TARGET NAME FROM MY REQUEST"}}]}',
  '   Emit no other chemistry-plan, chemfig, smiles, json or SVG block, and never emit a',
  '   nodus-view, nodus-artifact or nodus-capability-result block: those are application results,',
  '   the application draws and verifies every verified step itself. Do not redraw a step to',
  '   "show" it; just give the corrected reaction SMILES and the drawing is produced for you.',
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
