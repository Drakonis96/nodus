/**
 * Evidence gathered before the model plans a synthesis route: one-step disconnections of the
 * target from the local Open Reaction Database index, and textbook passages retrieved for the
 * target and for the reaction classes those disconnections name. The three sources complement
 * each other: ORD knows what was run (mostly patents), the textbooks know the named reactions and
 * why they work, and the model knows everything else. Nothing here is an instruction; the system
 * rule tells the model to weigh it.
 *
 * Pure helpers only: the application side (electron/ai/synthesisEvidence.ts) runs the tool and
 * the retrieval.
 */

/** The payload key the evidence travels under, next to `estructura_objetivo_verificada`. */
export const SYNTHESIS_EVIDENCE_KEY = 'evidencia_para_la_ruta';

export const SYNTHESIS_EVIDENCE_SYSTEM_RULE = [
  `Route evidence: the \`${SYNTHESIS_EVIDENCE_KEY}\` field was assembled by the application before you answered. It holds one-step disconnections of the requested target proposed from the Open Reaction Database (with how often each was recorded and its reaction class) and textbook passages retrieved for the target and those reaction classes.`,
  'It is evidence to weigh, not an instruction and not the answer: the disconnections are machine-generated from patent records and can be wrong or unsuited to the requested starting materials, and a passage may describe a different substrate.',
  'Prefer a disconnection that is recorded or that a textbook passage supports when it fits the requested starting materials; otherwise use your own knowledge. When you rely on a passage, cite it with its `nodus://passage/…` link.',
].join(' ');

/** Titles of works that teach synthetic organic chemistry. */
const SYNTHESIS_TEXTBOOK_TITLE = /\b(?:organic\s+chemistry|organic\s+synthesis|synthetic\s+(?:organic|sequences|methods)|reactions?\s+and\s+synthesis|name[d]?\s+reactions|heterocyclic\s+chemistry|medicinal\s+chemistry|reaction\s+mechanisms?)\b/i;

/** Whether a work belongs in the textbook scope for route evidence: its title reads as a
 *  synthetic-chemistry text or it is filed under a chemistry collection. */
export function isSynthesisEvidenceWork(title: string, collections: readonly string[] = []): boolean {
  if (!title) return false;
  return SYNTHESIS_TEXTBOOK_TITLE.test(title) || collections.some((name) => /^chemistry$/i.test(name.trim()));
}

// A SMILES in parentheses or backticks — "phenol (Oc1ccccc1)", "benzene (`c1ccccc1`)" — or after
// "SMILES:". Each candidate is checked by RDKit later; a word that happens to match is dropped then.
const PAREN_SMILES = /(?:\(\s*(?:SMILES\s*[:=]\s*)?|`|\bSMILES\s*[:=]\s*`?)([A-Za-z0-9@+\-=\\#()[\]/.%]{1,400}?)\s*(?:`|\)(?=[\s,.;:]|$)|[,;](?=\s)|$)/g;
const SMILES_TOKEN = /^(?=.*[A-Za-z])[A-Za-z0-9@+\-=\\#()[\]/.%]+$/;
const START_CLAUSE = /\b(?:starting\s+(?:from|with)|from|using)\b([\s\S]*)$/i;
// Words a parenthesis may hold that are not structures ("(aspirin, SMILES: …)", "(1 equiv)").
const NOT_SMILES = /^(?:[a-z]{4,}|\d+|[Ee]quiv|[Ee]xcess|cat|aq|s|l|g)$/;

function smilesIn(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(PAREN_SMILES)) {
    let value = match[1].trim().replace(/[.,;]+$/, '');
    const unbalanced = () => (value.match(/\)/g) ?? []).length > (value.match(/\(/g) ?? []).length;
    while (value.endsWith(')') && unbalanced()) value = value.slice(0, -1);
    if (!value || !SMILES_TOKEN.test(value) || NOT_SMILES.test(value)) continue;
    // A lowercase word longer than an aromatic ring label is prose, not a structure.
    if (/^[a-z]{5,}$/.test(value) && !/^c1/.test(value)) continue;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

/** The starting materials the request names with a structure: every SMILES after "starting
 *  from/with", "from" or "using", except the target itself. At most sixteen. */
export function findStartingSmiles(text: string, target?: string | null): string[] {
  const clause = START_CLAUSE.exec(text);
  if (!clause) return [];
  return smilesIn(clause[1]).filter((value) => value !== target).slice(0, 16);
}

/** The target's name as written before its SMILES ("a synthesis of 3-bromoaniline (SMILES: …)"),
 *  for the textbook query. Null when the request gives no name. */
export function findTargetName(text: string): string | null {
  // The parenthesis before SMILES may hold a synonym with its own parentheses:
  // "ibuprofen (2-(4-isobutylphenyl)propanoic acid, SMILES: …)".
  const match = /\b(?:synthes[a-z]*(?:\s+(?:of|for))?|preparation\s+of|route\s+(?:to|for))\s+([\s\S]{2,160}?)\s*\((?:[^()]|\([^()]*\))*?\bSMILES\s*[:=]/i.exec(text);
  if (!match) return null;
  const name = match[1].replace(/\s+/g, ' ').replace(/^(?:the|a|an)\s+/i, '').trim();
  return name.length >= 2 ? name : null;
}

export interface DisconnectionProposal {
  /** Precursor SMILES, dot-separated. */
  precursors: string;
  /** Reaction-class names, most specific first. */
  classes: string[];
  /** How many ORD records hold exactly this disconnection (0: template only). */
  recorded: number;
  /** Whether every organic precursor is a common ORD reactant. */
  available: boolean;
  /** Whether it is made only from the requested starting materials and routine reagents. */
  fromStarts?: boolean;
}

export interface TargetDisconnections {
  /** The molecule as sent; `target` is the package's canonical form of it. */
  input: string;
  target: string;
  /** ORD reactions that make this molecule, most recorded first. */
  recordedRoutes: Array<{ precursors: string; count: number }>;
  proposals: DisconnectionProposal[];
}

const asNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const asString = (value: unknown) => (typeof value === 'string' ? value : '');

/** Reads the tool's `reaction-disconnections` artifact into the brief the model sees, dropping
 *  what it does not need (template counts, sample ids, per-molecule use counts). */
export function normalizeDisconnections(data: unknown, perTarget = 6): TargetDisconnections[] {
  const entries = (data as { disconnections?: unknown })?.disconnections;
  if (!Array.isArray(entries)) return [];
  const out: TargetDisconnections[] = [];
  for (const raw of entries) {
    const entry = raw as Record<string, unknown> | null;
    const target = asString(entry?.target);
    if (!target) continue;
    const madeBy = (entry?.madeBy as { reactions?: unknown[] } | null)?.reactions;
    const recordedRoutes: TargetDisconnections['recordedRoutes'] = [];
    for (const reaction of Array.isArray(madeBy) ? madeBy : []) {
      const smiles = asString((reaction as Record<string, unknown>)?.reaction);
      const precursors = smiles.split('>>')[0];
      if (!precursors || recordedRoutes.some((route) => route.precursors === precursors)) continue;
      recordedRoutes.push({ precursors, count: asNumber((reaction as Record<string, unknown>).count) });
      if (recordedRoutes.length >= 3) break;
    }
    const proposals: DisconnectionProposal[] = [];
    for (const rawProposal of Array.isArray(entry?.proposals) ? entry.proposals : []) {
      const proposal = rawProposal as Record<string, unknown>;
      const precursors = asString(proposal.precursors);
      if (!precursors) continue;
      proposals.push({
        precursors,
        classes: Array.isArray(proposal.classes) ? proposal.classes.filter((name): name is string => typeof name === 'string').slice(0, 3) : [],
        recorded: asNumber(proposal.recorded),
        available: proposal.available === true,
        ...(typeof proposal.fromStarts === 'boolean' ? { fromStarts: proposal.fromStarts } : {}),
      });
      if (proposals.length >= perTarget) break;
    }
    out.push({ input: asString(entry?.input) || target, target, recordedRoutes, proposals });
  }
  return out;
}

/** The distinct reaction classes the disconnections name, in rank order. */
export function disconnectionClasses(briefs: TargetDisconnections[], max = 4): string[] {
  const classes: string[] = [];
  for (const brief of briefs) {
    for (const proposal of brief.proposals) {
      for (const name of proposal.classes) {
        if (!classes.includes(name)) classes.push(name);
        if (classes.length >= max) return classes;
      }
    }
  }
  return classes;
}

/** The precursors worth a second disconnection: organic ones from the top proposals that are not
 *  starting materials already. Small molecules (six heavy atoms or fewer by a rough count) are
 *  treated as reagents. */
export function secondLevelTargets(briefs: TargetDisconnections[], starting: readonly string[], max = 4): string[] {
  const out: string[] = [];
  const heavy = (smiles: string) => (smiles.replace(/\[[^\]]*\]/g, 'X').match(/Cl|Br|[BCNOPSFIcnops]|X/g) ?? []).length;
  for (const brief of briefs) {
    for (const proposal of brief.proposals.slice(0, 3)) {
      for (const molecule of proposal.precursors.split('.')) {
        if (!molecule || starting.includes(molecule) || out.includes(molecule) || !/[Cc]/.test(molecule) || heavy(molecule) <= 6) continue;
        out.push(molecule);
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

// A textbook indexes a reaction under its textbook name; where the class name the tagger uses is
// descriptive, search for that name instead. A class with no textbook meaning is not searched.
const CLASS_QUERIES: Record<string, string | null> = {
  'enolate alkylation (malonic or acetoacetic ester synthesis)': 'malonic ester synthesis acetoacetic ester synthesis',
  'intramolecular aldol condensation (Robinson annulation)': 'Robinson annulation',
  'amide hydrolysis (deprotection of an acetamide)': 'hydrolysis of amides',
  'diazonium salt substitution (Sandmeyer)': 'Sandmeyer reaction diazonium salts',
  'Kolbe-Schmitt carboxylation of a phenol': 'Kolbe-Schmitt carboxylation phenoxide',
  'nitro group reduction to amine': 'reduction of nitro compounds to arylamines',
  'acylation of an alcohol or phenol': 'acetylation acetic anhydride ester',
  'amide formation by acylation of an amine': 'amides from acid chlorides and amines',
  'rearrangement or isomerization': null,
};

/** The textbook queries for a route request: the target by name, then each reaction class the
 *  ORD disconnections name, as its textbook name. Short queries on purpose: the lexical lane
 *  ranks by how many query roots a passage covers, and generic words dilute a named reaction. */
export function synthesisEvidenceQueries(targetName: string | null, classes: readonly string[]): string[] {
  const queries: string[] = [];
  if (targetName) queries.push(`${targetName} synthesis`);
  for (const name of classes) {
    const query = textbookQueryForClass(name);
    if (query && !queries.includes(query)) queries.push(query);
  }
  return queries.slice(0, 7);
}

/** The textbook search for one reaction class, or null for a class with no textbook name. */
export function textbookQueryForClass(name: string): string | null {
  return name in CLASS_QUERIES ? CLASS_QUERIES[name] : name;
}

/** The query the research chat retrieves its corpus context with for a route request: the
 *  target's name and the reaction classes in play, instead of a prompt that is mostly output
 *  rules. Falls back to the request when it names no target. */
export function synthesisRetrievalQuery(question: string, evidence: SynthesisEvidence | null): string {
  const name = findTargetName(question);
  const classes = evidence ? disconnectionClasses(evidence.disconnections, 4) : [];
  const query = synthesisEvidenceQueries(name, classes).join('; ');
  return query || question;
}

/** What a passage must say to count as a textbook account of a reaction class: every pattern in
 *  `all` must match, and none in `not`. Retrieval alone is a keyword or embedding match, so a
 *  page on the enzyme that decarboxylates L-DOPA was offered for heating a malonic acid, and a
 *  page on lead tetraacetate for a Beckmann rearrangement. A class not listed needs its own
 *  name's first word. */
const CLASS_RELEVANCE: Record<string, { all: RegExp[]; not?: RegExp[] }> = {
  'enolate alkylation (malonic or acetoacetic ester synthesis)': { all: [/malonic|acetoacetic|enolate/i, /alkylat/i] },
  'intramolecular aldol condensation (Robinson annulation)': { all: [/robinson annulation|aldol/i] },
  'amide hydrolysis (deprotection of an acetamide)': { all: [/hydroly/i, /amide/i] },
  'diazonium salt substitution (Sandmeyer)': { all: [/sandmeyer|diazonium/i] },
  'Kolbe-Schmitt carboxylation of a phenol': { all: [/kolbe/i] },
  'nitro group reduction to amine': { all: [/nitro|nitrat/i, /reduc|hydrogenat/i, /amine|aniline/i] },
  'aromatic nitration': { all: [/nitrat/i] },
  'Fischer esterification': { all: [/esterif/i] },
  'acylation of an alcohol or phenol': { all: [/acylat|acetylat|esterif/i] },
  'amide formation by acylation of an amine': { all: [/amide/i, /amine|ammonia/i, /acid chloride|acyl chloride|acylat|anhydride/i] },
  'ester hydrolysis': { all: [/hydroly|saponif/i, /ester/i] },
  'nitrile hydrolysis': { all: [/nitrile/i, /hydroly/i] },
  'acid chloride formation with thionyl chloride': { all: [/thionyl chloride|SOCl\s*2/i, /acid chloride|acyl chloride|carboxylic acid/i] },
  'oxidation to a carboxylic acid': { all: [/oxidi[sz]|oxidation/i, /carboxylic acid/i] },
  'oxidation of an alcohol': { all: [/oxidi[sz]|oxidation/i, /alcohol/i] },
  'benzylic oxidation': { all: [/benzylic/i, /oxidi[sz]|oxidation/i] },
  'reduction of a carbonyl compound': { all: [/reduc/i, /aldehyde|ketone|carbonyl/i] },
  'Suzuki cross-coupling': { all: [/suzuki/i] },
  'nucleophilic aromatic substitution': { all: [/nucleophilic aromatic substitution|S\s*N\s*Ar/i] },
  'Friedel-Crafts acylation': { all: [/friedel.crafts/i] },
  'halogenation': { all: [/halogenat|brominat|chlorinat/i] },
  'conversion of an alcohol to an alkyl halide': { all: [/alcohol/i, /halide|PBr3|SOCl2|HBr|HCl/i] },
  'SN2 alkylation': { all: [/S\s*_?N\s*_?2|nucleophilic substitution/i] },
  'Grignard reaction': { all: [/grignard/i] },
  'Wittig reaction': { all: [/wittig/i] },
  'partial hydrogenation of an alkyne': { all: [/alkyne|lindlar/i, /hydrogenat/i] },
  'hydrogenation of an alkene': { all: [/hydrogenat/i, /alkene|double bond/i] },
  'Michael addition': { all: [/michael/i] },
  'alkylation of an acetylide': { all: [/acetylide/i] },
  'benzoin condensation': { all: [/benzoin/i] },
  'benzilic acid rearrangement': { all: [/benzilic/i] },
  'oxime formation': { all: [/oxime/i] },
  'Beckmann rearrangement': { all: [/beckmann/i] },
  decarboxylation: { all: [/decarboxylat/i], not: [/decarboxylase|pyridoxal|enzym|\bPLP\b|L-?DOPA/i] },
  chlorosulfonation: { all: [/chlorosulfon/i] },
  'sulfonamide formation': { all: [/sulfonamide/i] },
  'Diels-Alder cycloaddition': { all: [/diels.alder/i] },
};

function classRule(name: string): { all: RegExp[]; not?: RegExp[] } {
  const rule = CLASS_RELEVANCE[name];
  if (rule) return rule;
  const word = name.split(/[\s(]+/).find((item) => item.length > 3);
  return { all: word ? [new RegExp(word.slice(0, Math.max(5, word.length - 3)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')] : [] };
}

/** Where in a passage the reaction class is discussed: the offset of the first stretch of about
 *  two sentences that names every term the class needs, or -1 when none does (or an excluded
 *  term appears anywhere). */
function relevantOffset(name: string, flat: string): number {
  const rule = classRule(name);
  if ((rule.not ?? []).some((pattern) => pattern.test(flat))) return -1;
  // The terms must appear together: a page that mentions an acid chloride in one paragraph and a
  // reduction in another is not about either reaction.
  for (let start = 0; start < Math.max(1, flat.length); start += RELEVANCE_STEP) {
    const window = flat.slice(start, start + RELEVANCE_WINDOW);
    if (!rule.all.every((pattern) => pattern.test(window))) continue;
    // Where the discussion starts: the earliest required term in the window.
    const first = Math.min(...rule.all.map((pattern) => window.search(pattern)).filter((at) => at >= 0), 0 + window.length);
    return start + (Number.isFinite(first) ? first : 0);
  }
  return -1;
}

/** Whether a passage is a textbook account of the reaction class. */
export function passageFitsClass(name: string, text: string): boolean {
  return relevantOffset(name, text.replace(/\s+/g, ' ')) >= 0;
}

/** The excerpt to quote for a reaction class: the stretch that discusses it, from a sentence
 *  start, not the passage's first characters (often the tail of an unrelated paragraph). */
export function relevantExcerpt(name: string, text: string, chars: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  let start = Math.max(0, relevantOffset(name, flat));
  if (start > 0) {
    // Back to the start of that sentence, when it began not long before.
    const before = flat.slice(Math.max(0, start - 200), start);
    const boundary = Math.max(before.lastIndexOf('. '), before.lastIndexOf('? '), before.lastIndexOf('! '));
    start = boundary >= 0 ? start - before.length + boundary + 2 : start;
  }
  const body = flat.slice(start);
  const cut = body.length > chars ? `${body.slice(0, chars).replace(/\s+\S*$/, '')}…` : body;
  return start > 0 ? `…${cut}` : cut;
}
const RELEVANCE_WINDOW = 300;
const RELEVANCE_STEP = 100;

/** Whether a passage found for a query fits it: a reaction-class query must pass that class's
 *  relevance rule; the target query ("<name> synthesis") must name the target. */
export function passageFitsQuery(query: string, text: string): boolean {
  for (const name of [...Object.keys(CLASS_QUERIES), ...Object.keys(CLASS_RELEVANCE)]) {
    if (textbookQueryForClass(name) === query) return passageFitsClass(name, text);
  }
  const target = /^(.+) synthesis$/.exec(query)?.[1];
  if (target) return text.toLowerCase().includes(target.toLowerCase());
  return true;
}

/** A back-of-book index or a reference list: mostly page numbers, no chemistry to read. */
export function isIndexLikePassage(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean).length;
  return words > 0 && (text.match(/\d+/g) ?? []).length / words > 0.25;
}

export interface EvidencePassage {
  text: string;
  location: string | null;
  work: { title: string; year: number | null };
  /** The query that found it (the target, or a reaction class). */
  retrievedFor: string;
  citation: string;
}

export interface SynthesisEvidence {
  target: string;
  startingMaterials: string[];
  disconnections: TargetDisconnections[];
  passages: EvidencePassage[];
}

/** The payload value, or null when there is nothing to add. */
export function synthesisEvidencePayload(evidence: SynthesisEvidence | null): Record<string, unknown> | null {
  if (!evidence || (!evidence.disconnections.length && !evidence.passages.length)) return null;
  return {
    target: evidence.target,
    ...(evidence.startingMaterials.length ? { starting_materials: evidence.startingMaterials } : {}),
    ...(evidence.disconnections.length ? {
      ord_disconnections: evidence.disconnections.map((brief) => ({
        molecule: brief.target,
        ...(brief.recordedRoutes.length ? { recorded_preparations: brief.recordedRoutes } : {}),
        proposals: brief.proposals,
      })),
    } : {}),
    ...(evidence.passages.length ? { textbook_passages: evidence.passages } : {}),
  };
}
