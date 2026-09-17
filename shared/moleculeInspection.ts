/** Deterministic molecule description shared with the chemistry capability.
 *
 * The `nodus:chemistry` package exposes a read-only `inspect` tool that parses a
 * SMILES with RDKit and returns a `molecule-dossier` artifact whose `data` is a
 * `MoleculeDossier`. Research Chat injects that dossier as authoritative context
 * so a model reasons over a verified graph instead of re-reading SMILES text. */

export interface MoleculeAtom {
  /** 0-based position in the parsed graph; bond endpoints use this index. */
  index: number;
  element: string;
  charge?: number;
  isotope?: number;
  /** Explicit plus implicit hydrogen count on the atom, when reported. */
  hydrogens?: number;
  /** CIP descriptor for a stereocentre (R/S) or stereogenic bond (E/Z). */
  cip?: string;
}

export interface MoleculeBond {
  a: number;
  b: number;
  order: number;
  stereo?: string;
}

export interface MoleculeDossier {
  canonicalSmiles: string;
  inputSmiles?: string;
  formula?: string;
  molecularWeight?: number;
  atomCount: number;
  bondCount: number;
  atoms: MoleculeAtom[];
  bonds: MoleculeBond[];
  caveats?: string[];
}

/** Appended to the Research Chat system prompt when a dossier is present. */
export const MOLECULE_DOSSIER_SYSTEM_RULE = [
  'Verified molecular structure: the `estructura_objetivo_verificada` field was produced by RDKit, not by you, and is authoritative.',
  'Reason from its canonical SMILES, atom table (including CIP stereochemistry) and bond table, never from re-reading the raw SMILES text.',
  'If a proposed reaction, intermediate or product implies a connectivity or stereochemistry absent from that table, it is wrong and must be corrected before it is written.',
].join(' ');

/** Appended when Chemistry Studio is enabled: a multi-step route is one object, and the
 *  intermediate that leaves one step has to be the exact molecule that enters the next. */
export const ROUTE_CONTINUITY_SYSTEM_RULE = [
  'Synthesis route continuity: when you plan more than one reaction step, the intermediate carried from one step into the next must be written with the exact same isomeric SMILES in both places, so RDKit can confirm it is the same molecule.',
  'Do not rename, re-protonate, re-canonicalise or otherwise rewrite a carried intermediate. If a structure genuinely changes between steps, say so explicitly and justify it; otherwise the route is rejected as discontinuous.',
  'Give each step as one balanced reaction in the form `reactants>agents>products` (separate species with `.`), on its own line inside backticks.',
].join(' ');

/** One species of a route step, as the chemistry capability reports it. */
export interface RouteSpeciesSummary {
  input: string;
  canonicalSmiles: string;
  skeletonSmiles: string;
  formula: string;
  charge: number;
  heavyAtoms: number;
  stereocentres: number;
  unspecifiedStereocentres: number;
}

export interface RouteStepAudit {
  index: number;
  reaction: string;
  ok: boolean;
  error?: string;
  reactants: RouteSpeciesSummary[];
  agents: RouteSpeciesSummary[];
  products: RouteSpeciesSummary[];
  balanced: boolean | null;
  chargeBalanced: boolean | null;
  differences: string[];
  unspecifiedStereocentres: number;
  /** The request declared this step racemic; its open centres are a stated outcome. */
  racemic?: boolean;
}

export interface RouteLinkAudit {
  from: number;
  to: number;
  ok: boolean;
  reason: 'carried' | 'constitution-only' | 'no-overlap' | 'declared-mismatch' | 'parse-failed';
  carried: Array<{ canonicalSmiles: string; formula: string; heavyAtoms: number }>;
  skeletonOnly: Array<{ product: string; reactant: string; skeletonSmiles: string }>;
  declaredCarrier?: { input: string; canonicalSmiles: string | null; inProduct: boolean; inReactant: boolean };
}

export interface RouteAudit {
  steps: RouteStepAudit[];
  links: RouteLinkAudit[];
  continuous: boolean;
  blocked: string[];
}

const SMILES_CHARS = /^[A-Za-z0-9@+\-=\\#()[\]/.,%*:]+$/;
const STRUCTURAL = /[()[\]\\=#@/]|\d/;

/** A SMILES never begins or ends with a bond, a separator or a stereodescriptor. A token
 *  that does is a fragment the reply quoted in backticks (`/C=C\`, `=O`), not a species. */
const BOND_EDGE = /^[.\\/=#\-@]|[.\\/=#\-@]$/;

/** Sentence punctuation glued to a SMILES by prose ("...CC(=O)O.", "\"CCO\""). A
 *  SMILES never starts or ends with a quote or a bare separator, so peeling these off
 *  before the structural test recovers the molecule the author meant. Interior dots are
 *  a salt or reaction separator and stay, so `[Na+].[Cl-]` is left whole. */
const SENTENCE_LEADING = /^[\s"'\u2018\u2019\u201c\u201d]+/;
const SENTENCE_TRAILING = /[\s"'\u2018\u2019\u201c\u201d.,;:!?]+$/;
function trimSentenceEdges(token: string): string {
  return token.replace(SENTENCE_LEADING, '').replace(SENTENCE_TRAILING, '');
}

function isSmilesLike(token: string, minLength: number): boolean {
  return token.length >= minLength
    && token.length <= 2000
    && !BOND_EDGE.test(token)
    && SMILES_CHARS.test(token)
    && STRUCTURAL.test(token)
    && /[A-Za-z]/.test(token);
}

/** SMILES-shaped runs, with composer line wraps reassembled. Prose is rejected by the
 *  structural/length filters; the capability parses each candidate and is the final
 *  authority on whether it is a real molecule. */
export function findSmilesCandidates(text: string): string[] {
  const out: string[] = [];
  const push = (token: string) => {
    if (!token || out.includes(token) || out.length >= 4) return;
    out.push(token);
  };
  let run: string[] = [];
  const flush = () => {
    if (!run.length) return;
    const joined = trimSentenceEdges(run.join(''));
    if (isSmilesLike(joined, 4)) push(joined);
    run = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }
    const whole = trimSentenceEdges(trimmed);
    if (isSmilesLike(whole, 4)) { run.push(whole); continue; }
    const first = trimSentenceEdges(trimmed.split(/\s+/)[0]);
    if (isSmilesLike(first, 8)) { run.push(first); flush(); continue; }
    flush();
    for (const raw of trimmed.split(/\s+/)) {
      const token = trimSentenceEdges(raw);
      if (isSmilesLike(token, 8)) push(token);
    }
  }
  flush();
  return out;
}

export function formatMoleculeDossier(dossier: MoleculeDossier): string {
  const lines: string[] = [`Canonical isomeric SMILES: ${dossier.canonicalSmiles}`];
  if (dossier.formula) {
    lines.push(`Formula: ${dossier.formula}${typeof dossier.molecularWeight === 'number' ? ` (MW ${dossier.molecularWeight.toFixed(2)})` : ''}`);
  }
  lines.push(`Atoms: ${dossier.atomCount}, bonds: ${dossier.bondCount}`);
  lines.push('Atom table (index element charge hydrogens CIP):');
  for (const atom of dossier.atoms) {
    const parts = [`#${atom.index}`, atom.element];
    if (typeof atom.charge === 'number' && atom.charge !== 0) parts.push(`charge ${atom.charge}`);
    if (typeof atom.isotope === 'number') parts.push(`isotope ${atom.isotope}`);
    if (typeof atom.hydrogens === 'number') parts.push(`H${atom.hydrogens}`);
    if (atom.cip) parts.push(atom.cip);
    lines.push(`  ${parts.join(' ')}`);
  }
  lines.push('Bond table (a-b order stereo):');
  for (const bond of dossier.bonds) {
    lines.push(`  ${bond.a}-${bond.b} ${bond.order}${bond.stereo ? ` ${bond.stereo}` : ''}`);
  }
  if (dossier.caveats?.length) {
    lines.push('Caveats:');
    for (const caveat of dossier.caveats) lines.push(`  - ${caveat}`);
  }
  return lines.join('\n');
}

const SMILES_TOKEN_ONLY = /^[A-Za-z0-9@+\-=\\#()[\]/.,%*:]+$/;
const SMILES_SIGNAL = /[()[\]@=#/\\]|[A-Z]/;

function isSpeciesToken(token: string): boolean {
  return token.length >= 1 && token.length <= 2000 && !BOND_EDGE.test(token) && SMILES_TOKEN_ONLY.test(token) && SMILES_SIGNAL.test(token);
}

/** Species the model proposed in its answer: backticked reaction SMILES (split into every
 *  reactant/product/agent) and backticked single species. Only code spans are read — free
 *  prose is not scanned, because a chemical name, a markdown link or a path would otherwise
 *  be reported as an unparseable molecule and drown the real findings. */
export function findAnswerSpecies(answer: string): string[] {
  const out: string[] = [];
  const push = (token: string) => {
    if (!token || out.includes(token) || out.length >= 24) return;
    out.push(token);
  };
  for (const match of answer.matchAll(/`([^`\n]{1,4000})`/g)) {
    const span = match[1].trim();
    if (!span) continue;
    if (span.includes('>')) {
      for (const field of span.split('>')) for (const part of field.split('.')) if (isSpeciesToken(part.trim())) push(part.trim());
    } else if (isSpeciesToken(span)) {
      push(span);
    }
  }
  return out;
}

/** A deterministic appendix: what RDKit made of every species the model wrote. Generated
 *  by the app, so the model cannot claim a structure was verified when it was not. */
export function formatStructureAudit(candidates: string[], dossiers: MoleculeDossier[]): string {
  const byInput = new Map(dossiers.map((dossier) => [dossier.inputSmiles ?? dossier.canonicalSmiles, dossier]));
  const lines = [
    '### Structure check (RDKit)',
    '',
    'Every SMILES below was parsed with RDKit. This block is generated by the application, not by the model.',
    '',
  ];
  for (const smiles of candidates) {
    const dossier = byInput.get(smiles);
    if (!dossier) {
      lines.push(`- FAIL \`${smiles}\` — could not be parsed as a molecule`);
      continue;
    }
    const stereo = dossier.atoms.filter((atom) => atom.cip).length;
    const notes = [`${dossier.atomCount} atoms`, ...(stereo ? [`${stereo} stereocentres`] : []), ...(dossier.caveats ?? [])];
    const canonical = dossier.canonicalSmiles && dossier.canonicalSmiles !== smiles ? ` → \`${dossier.canonicalSmiles}\`` : '';
    lines.push(`- OK \`${smiles}\`${canonical} — ${notes.join(', ')}`);
  }
  return lines.join('\n');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

/** Accepts only a dossier the capability can actually have produced, so a malformed
 *  artifact degrades to "no dossier" instead of injecting junk into the prompt. */
export function normalizeMoleculeDossier(data: unknown, inputSmiles: string): MoleculeDossier | null {
  const value = asRecord(data);
  if (!value) return null;
  const canonicalSmiles = typeof value.canonicalSmiles === 'string' ? value.canonicalSmiles.trim() : '';
  if (!canonicalSmiles || !Array.isArray(value.atoms) || !Array.isArray(value.bonds)) return null;

  const atoms: MoleculeAtom[] = [];
  for (const entry of value.atoms) {
    const atom = asRecord(entry);
    if (!atom) continue;
    const element = atom.element;
    if (typeof element !== 'string' || !element) continue;
    const index = atom.index;
    const charge = atom.charge;
    const isotope = atom.isotope;
    const hydrogens = atom.hydrogens;
    const cip = atom.cip;
    atoms.push({
      index: typeof index === 'number' ? index : atoms.length,
      element,
      ...(typeof charge === 'number' ? { charge } : {}),
      ...(typeof isotope === 'number' ? { isotope } : {}),
      ...(typeof hydrogens === 'number' ? { hydrogens } : {}),
      ...(typeof cip === 'string' && cip ? { cip } : {}),
    });
  }
  if (!atoms.length) return null;

  const bonds: MoleculeBond[] = [];
  for (const entry of value.bonds) {
    const bond = asRecord(entry);
    if (!bond) continue;
    const a = bond.a;
    const b = bond.b;
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    const order = bond.order;
    const stereo = bond.stereo;
    bonds.push({
      a,
      b,
      order: typeof order === 'number' ? order : 1,
      ...(typeof stereo === 'string' && stereo ? { stereo } : {}),
    });
  }

  return {
    canonicalSmiles,
    inputSmiles,
    ...(typeof value.formula === 'string' ? { formula: value.formula } : {}),
    ...(typeof value.molecularWeight === 'number' ? { molecularWeight: value.molecularWeight } : {}),
    atomCount: typeof value.atomCount === 'number' ? value.atomCount : atoms.length,
    bondCount: typeof value.bondCount === 'number' ? value.bondCount : bonds.length,
    atoms,
    bonds,
    ...(Array.isArray(value.caveats)
      ? { caveats: value.caveats.filter((entry): entry is string => typeof entry === 'string').slice(0, 12) }
      : {}),
  };
}

// ---------------------------------------------------------------- synthesis routes

const REACTION_CHARS = /^[A-Za-z0-9@+\-=\\#()[\]/.,%*:>]+$/;

/** A reaction the answer actually draws: a backticked span containing `>`, one line of a
 *  fenced code block, or the `reactionSmiles` a `chemistry-plan` intent carries. Models
 *  differ — some write each step inline in backticks, others in a fenced block — so both are
 *  read. Prose and single molecules are ignored, so exactly the steps the route checker can
 *  group are collected, in document order. */
const CODE_REGION = /```[^\n`]*\r?\n([\s\S]*?)```|`([^`\n]{3,4000})`/g;
const REACTION_SMILES_FIELD = /"reactionSmiles"\s*:\s*"((?:[^"\\]|\\.)*)"/g;

function unescapeJsonString(value: string): string {
  try { return JSON.parse(`"${value}"`) as string; } catch { return value; }
}

/** A reaction span the route checker can group: a backticked SMILES with `>`, one line of a
 *  fenced block, or the `reactionSmiles` a `chemistry-plan` carries. Prose and single
 *  molecules are not steps. */
function reactionSpan(raw: string): string | null {
  const span = raw.trim();
  // A real step carries an element symbol or a ring-closure digit; the literal
  // `reactants>agents>products` placeholder the shared addendum quotes does not. The strict
  // character/no-space guard also rejects the JSON of an artifact or a view fence, so a
  // fenced block is safe to scan line by line.
  if (!span || !span.includes('>') || /\s/.test(span) || !REACTION_CHARS.test(span) || !/[A-Z0-9]/.test(span)) return null;
  return span;
}

export function findReactionLines(text: string): string[] {
  const out: string[] = [];
  const fencedRoutes: string[][] = [];
  const collect = (raw: string, sink: string[]) => {
    const span = reactionSpan(raw);
    if (span && !sink.includes(span)) sink.push(span);
  };
  const collectFields = (chunk: string, sink: string[]) => {
    for (const field of chunk.matchAll(REACTION_SMILES_FIELD)) collect(unescapeJsonString(field[1] ?? ''), sink);
  };
  for (const match of text.matchAll(CODE_REGION)) {
    if (match[1] !== undefined) {
      // A `chemistry-plan` fence holds JSON; a plain reaction fence holds one step per line.
      const block: string[] = [];
      if ([...match[1].matchAll(REACTION_SMILES_FIELD)].length) collectFields(match[1], block);
      else for (const line of match[1].split(/\r?\n/)) collect(line, block);
      for (const reaction of block) if (!out.includes(reaction)) out.push(reaction);
      if (block.length > 1) fencedRoutes.push(block);
    } else {
      collect(match[2] ?? '', out);
    }
  }
  // An unfenced `reactionSmiles` (no code span) is still a drawn reaction.
  if (!out.length) collectFields(text, out);
  // A correction repeats the rejected equation before the fixed route. When the answer also
  // gives a multi-line route fence, that fence is the whole corrected route — prefer it, so
  // the quoted old equation is not audited as a step and does not shift every later step.
  const fenced = fencedRoutes[fencedRoutes.length - 1];
  return (fenced ?? out).slice(0, 16);
}

const CONDITIONS_PATTERN = /\b(?:reagents?\s+and\s+)?conditions?\s*\*{0,3}\s*:\s*([^\n]{3,400})/gi;

/** The model writes a step's conditions as a sentence; an arrow label has room for a phrase.
 *  Take the first clause, drop the parenthesised asides, and cap the length. */
function conciseConditions(value: string): string {
  const clause = (value.split(';')[0] ?? value).replace(/\s*\([^)]*\)/g, '');
  return clause.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 72).trim();
}

/** The “Reagents and conditions: …” prose for each step, in step order, aligned with
 *  `findReactionLines` by position, reduced to a short phrase for the arrow. This is the only
 *  source for the temperature, time and workup the schema cannot hold; it is annotation only,
 *  never checked. Missing steps are empty strings. */
export function findStepConditions(text: string, count: number): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(CONDITIONS_PATTERN)) {
    const value = conciseConditions(match[1]);
    if (value) found.push(value);
  }
  const out: string[] = [];
  for (let index = 0; index < count; index++) out.push(found[index] ?? '');
  return out;
}

const RACEMIC_PATTERN = /\bracemic\b|\bracemate\b|\bracemi[cs]\b/i;

/** Whether the answer declares a racemic outcome. This is model prose, not a verification: it
 *  only lets the route audit report an open centre as a stated racemate instead of refusing
 *  the step for leaving it unspecified. */
export function declaresRacemic(text: string): boolean {
  return RACEMIC_PATTERN.test(text);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeRouteSpecies(entry: unknown): RouteSpeciesSummary | null {
  const value = asRecord(entry);
  if (!value) return null;
  const canonicalSmiles = typeof value.canonicalSmiles === 'string' ? value.canonicalSmiles.trim() : '';
  if (!canonicalSmiles) return null;
  const input = typeof value.input === 'string' ? value.input.trim() : '';
  return {
    input: input || canonicalSmiles,
    canonicalSmiles,
    skeletonSmiles: typeof value.skeletonSmiles === 'string' && value.skeletonSmiles ? value.skeletonSmiles : canonicalSmiles,
    formula: typeof value.formula === 'string' ? value.formula : '',
    charge: numberOr(value.charge, 0),
    heavyAtoms: numberOr(value.heavyAtoms, 0),
    stereocentres: numberOr(value.stereocentres, 0),
    unspecifiedStereocentres: numberOr(value.unspecifiedStereocentres, 0),
  };
}

const routeSpecies = (list: unknown): RouteSpeciesSummary[] =>
  (Array.isArray(list) ? list.map(normalizeRouteSpecies).filter((entry): entry is RouteSpeciesSummary => entry !== null) : []).slice(0, 24);

const ROUTE_LINK_REASONS: RouteLinkAudit['reason'][] = ['carried', 'constitution-only', 'no-overlap', 'declared-mismatch', 'parse-failed'];

function normalizeRouteStep(entry: unknown, index: number): RouteStepAudit | null {
  const value = asRecord(entry);
  const reaction = value && typeof value.reaction === 'string' ? value.reaction : '';
  if (!value || !reaction) return null;
  return {
    index: numberOr(value.index, index),
    reaction,
    ok: boolOr(value.ok, false),
    ...(typeof value.error === 'string' && value.error ? { error: value.error.slice(0, 400) } : {}),
    reactants: routeSpecies(value.reactants),
    agents: routeSpecies(value.agents),
    products: routeSpecies(value.products),
    balanced: typeof value.balanced === 'boolean' ? value.balanced : null,
    chargeBalanced: typeof value.chargeBalanced === 'boolean' ? value.chargeBalanced : null,
    differences: stringArray(value.differences).map((entry) => entry.slice(0, 200)),
    unspecifiedStereocentres: numberOr(value.unspecifiedStereocentres, 0),
    ...(value.racemic === true ? { racemic: true } : {}),
  };
}

function normalizeRouteLink(entry: unknown, index: number): RouteLinkAudit | null {
  const value = asRecord(entry);
  if (!value) return null;
  const reason = typeof value.reason === 'string' && (ROUTE_LINK_REASONS as string[]).includes(value.reason)
    ? value.reason as RouteLinkAudit['reason'] : 'parse-failed';
  const carried = (Array.isArray(value.carried) ? value.carried : []).map((item) => {
    const record = asRecord(item);
    const canonicalSmiles = record && typeof record.canonicalSmiles === 'string' ? record.canonicalSmiles : '';
    if (!canonicalSmiles) return null;
    return { canonicalSmiles, formula: record && typeof record.formula === 'string' ? record.formula : '', heavyAtoms: record ? numberOr(record.heavyAtoms, 0) : 0 };
  }).filter((item): item is { canonicalSmiles: string; formula: string; heavyAtoms: number } => item !== null).slice(0, 24);
  const skeletonOnly = (Array.isArray(value.skeletonOnly) ? value.skeletonOnly : []).map((item) => {
    const record = asRecord(item);
    if (!record || typeof record.product !== 'string' || typeof record.reactant !== 'string') return null;
    return { product: record.product, reactant: record.reactant, skeletonSmiles: typeof record.skeletonSmiles === 'string' ? record.skeletonSmiles : '' };
  }).filter((item): item is { product: string; reactant: string; skeletonSmiles: string } => item !== null).slice(0, 24);
  const declared = asRecord(value.declaredCarrier);
  return {
    from: numberOr(value.from, index),
    to: numberOr(value.to, index + 1),
    ok: boolOr(value.ok, false),
    reason,
    carried,
    skeletonOnly,
    ...(declared ? {
      declaredCarrier: {
        input: typeof declared.input === 'string' ? declared.input : '',
        canonicalSmiles: typeof declared.canonicalSmiles === 'string' ? declared.canonicalSmiles : null,
        inProduct: boolOr(declared.inProduct, false),
        inReactant: boolOr(declared.inReactant, false),
      },
    } : {}),
  };
}

/** Accepts only a route audit the capability can actually have produced. */
export function normalizeRouteAudit(data: unknown): RouteAudit | null {
  const value = asRecord(data);
  if (!value || !Array.isArray(value.steps) || !value.steps.length) return null;
  const steps = value.steps.map((entry, index) => normalizeRouteStep(entry, index))
    .filter((entry): entry is RouteStepAudit => entry !== null).slice(0, 16);
  if (!steps.length) return null;
  const links = (Array.isArray(value.links) ? value.links : []).map((entry, index) => normalizeRouteLink(entry, index))
    .filter((entry): entry is RouteLinkAudit => entry !== null).slice(0, 15);
  const blocked = stringArray(value.blocked).map((entry) => entry.slice(0, 300)).slice(0, 32);
  return { steps, links, continuous: boolOr(value.continuous, blocked.length === 0), blocked };
}

const sideTrace = (species: RouteSpeciesSummary[]): string => species.map((entry) => entry.formula || entry.canonicalSmiles).join(' + ');

/** The deterministic appendix a reader can act on: per step balance and stereochemistry,
 *  then whether every intermediate is carried over as the same molecule. Generated by the
 *  application, so the model cannot claim a route was verified when it was not. */
export function formatRouteAudit(audit: RouteAudit): string {
  const lines: string[] = [
    '### Route check (RDKit)',
    '',
    'Every step was parsed with RDKit and every equation and intermediate link was checked. This block is generated by the application, not by the model.',
    '',
  ];
  for (const step of audit.steps) {
    const label = `Step ${step.index + 1}`;
    if (!step.ok) { lines.push(`- ${label} FAIL — ${step.error ?? 'could not be parsed'}`); continue; }
    const racemic = step.racemic === true && step.unspecifiedStereocentres > 0;
    const verdict = step.balanced && (step.unspecifiedStereocentres === 0 || racemic) ? 'OK' : 'FAIL';
    const stereo = step.unspecifiedStereocentres
      ? racemic
        ? ', declared racemic (stereochemistry not controlled)'
        : `, ${step.unspecifiedStereocentres} unspecified stereocentre(s) or double bond(s)`
      : '';
    const balance = step.balanced ? 'balanced' : `NOT balanced (${step.differences.join('; ')})`;
    const agents = step.agents.length ? ` [agents: ${sideTrace(step.agents)}]` : '';
    lines.push(`- ${label} ${verdict} — ${balance}${stereo}. ${sideTrace(step.reactants)}${agents} → ${sideTrace(step.products)}`);
  }
  if (audit.links.length) {
    lines.push('', 'Intermediate continuity:', '');
    for (const link of audit.links) {
      const label = `Step ${link.from + 1} → ${link.to + 1}`;
      if (link.ok) {
        const carried = link.carried.map((entry) => entry.formula || entry.canonicalSmiles).join(', ');
        lines.push(`- ${label} OK — carried ${carried || 'the declared intermediate'}`);
      } else if (link.reason === 'constitution-only') {
        lines.push(`- ${label} FAIL — same constitution but different stereochemistry or charge`);
      } else if (link.reason === 'no-overlap') {
        lines.push(`- ${label} FAIL — no product of the earlier step is a reactant of the later one`);
      } else if (link.reason === 'declared-mismatch') {
        lines.push(`- ${label} FAIL — the declared intermediate is not the same structure on both sides`);
      } else {
        lines.push(`- ${label} FAIL — could not be checked because a step failed to parse`);
      }
    }
  }
  lines.push('', audit.continuous
    ? 'Route verified: every intermediate is carried over as the same structure.'
    : `Route blocked: ${audit.blocked.join(' ')}`);
  return lines.join('\n');
}

/** Turn the checker's element/charge totals into an instruction that names the deficient
 *  side. Every failing step reports which element is short and on which side, and that is
 *  enough to say "add the missing reagent" or "add the missing byproduct" for any reaction,
 *  not just the one the model happened to get wrong. */
function prescriptiveBalance(step: RouteStepAudit): string {
  const parts: string[] = [];
  for (const difference of step.differences) {
    if (/more than one balanced equation/i.test(difference)) {
      parts.push('more than one equation balances — remove any species that is neither consumed nor produced (water and solvents are the usual culprits), list each distinct species once per side, and name the intended byproduct');
      continue;
    }
    const match = /^(.*?):\s*reactants\s+(-?\d+),\s*products\s+(-?\d+)\s*$/i.exec(difference.trim());
    if (!match) { parts.push(difference.trim()); continue; }
    const label = match[1].trim();
    const reactants = Number(match[2]), products = Number(match[3]);
    if (reactants === products) continue;
    parts.push(reactants < products
      ? `${label}: the products carry ${products - reactants} more — add the missing ${label}-containing reagent to the reactants, or remove an extra ${label}-containing product`
      : `${label}: the reactants carry ${reactants - products} more — add the missing ${label}-containing byproduct to the products, or remove an extra ${label}-containing reactant`);
  }
  return parts.join('; ');
}

/** One instruction per rejected step: the checker's own reason, made directional where the
 *  totals allow it. */
function stepFixInstruction(step: RouteStepAudit): string {
  if (!step.ok) {
    const error = step.error ?? 'could not be parsed';
    return /at most 12 species/i.test(error)
      ? `${error} — a salt is one species per side even when drawn as ions (for example \`[Na+].[Cl-]\`); do not repeat a species`
      : error;
  }
  if (step.balanced !== true) return `not balanced. ${prescriptiveBalance(step)}`;
  if (step.unspecifiedStereocentres > 0 && step.racemic !== true) return `${step.unspecifiedStereocentres} unspecified stereocentre(s) or double bond(s) — specify them, or write that the outcome is racemic`;
  return 'rejected by the checker';
}

/** A ready-to-send follow-up that asks the model to correct the steps the checker refused,
 *  giving each failing step a directional reason and the rules that resolve the common
 *  shortfalls. It is inert text the interface offers as a button; the model only proposes,
 *  and the reply is checked and drawn again, so determinism stays in the checker. Empty when
 *  there is nothing to fix. */
export function formatRouteFixPrompt(steps: string[], audit: RouteAudit): string {
  // A declared racemate is an accepted outcome, not a failure the model can fix by
  // specifying an enantiomer, so it is never offered back as a correction.
  const failures = audit.steps.filter(step => !(step.ok && step.balanced === true && (step.unspecifiedStereocentres === 0 || step.racemic === true)));
  if (!failures.length) return '';
  const lines = failures.map(step =>
    `- Step ${step.index + 1}: ${stepFixInstruction(step)}\n  Currently: \`${steps[step.index]}\` — change it; do not repeat it unchanged.`);
  const prompt = [
    'Correction needed for the synthesis route above.',
    '',
    'The route checker rejected these steps:',
    ...lines,
    '',
    'Re-output the same route in the same order. Rewrite only the rejected step(s) in place and leave the passing steps exactly as they are. You can split a rejected step into consecutive steps when the reason asks for it: for example Step 3 becomes 3a and 3b, or the route grows from four steps to five by adding the extra step where Step 3 was. The original steps keep their relative order. Rules that resolve these failures:',
    '- Keep the step order: never reorder, merge or duplicate a step, and never add a second copy of a step that already passes. You MAY split a rejected step into consecutive steps when the checker asks you to (e.g. 3 becomes 3a and 3b) — the new steps stay where the original was, so the route order is unchanged even if the numbering shifts.',
    '- Conserve every element and the total charge on both sides. A species that is short on one side is a reagent (on the reactant side) or a byproduct (on the product side) that is missing from the equation.',
    '- List every species that is consumed or produced, once per side. Never put the same species on both sides, and do not add water or a solvent unless the step consumes or produces it.',
    '- Every reactive group in a molecule reacts: saponify every ester, protonate every carboxylate, alkylate every position you intend. A group that leaves — an alcohol from an alkoxide, a hydrogen halide, water, ammonia, CO2 — is a product and must be written out.',
    '- A metal that enters as a reagent leaves as its salt (for example `[Na+].[Br-]`, `[Na+].[Cl-]`); never leave a metal ion on one side only, and count one equivalent of base or acid for each group that reacts.',
    '- Write each ion of a salt once per side and let the coefficient count it: if `[Na+]` appears once among the reactants, write it once among the products too. A disodium salt is one `[Na+]` with the dianion, not `[Na+].[Na+]` on one side only; hydrochloric acid is one `[H+].[Cl-]`, not two. An ion written a different number of times on the two sides is the usual reason a metal will not balance.',
    '- Write the organic product neutral, not protonated with a free counterion. With a metal and an acid (Sn/HCl, Fe/HCl, Zn/HCl) the acid anion leaves with the metal as its salt (`Cl[Sn]Cl`, `Cl[Fe]Cl`); the amine or alcohol is neutral (`Nc1ccccc1`), never `[NH3+]` beside a free `[Cl-]`.',
    '- Coefficients are solved for you: give each distinct species once and let the numbers come out. Use at most 12 species per equation; if a step genuinely cannot balance, split it into consecutive steps.',
    '- Give each step as one balanced reaction in the exact form `reactants>agents>products` (exactly two ">"), consumed reagents as reactants, byproducts as products, and only true catalysts or solvents as agents.',
  ].join('\n');
  return `\`\`\`nodus-route-fix\n${JSON.stringify({ label: 'Ask the model to fix the failed steps', prompt })}\n\`\`\``;
}
