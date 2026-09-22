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
  /** The systematic name the author wrote for this species, when the answer carries one. */
  name?: string;
  /** Set by the capability when it could resolve the name: true when the name denotes this
   *  structure, false when it denotes a different one. Absent when no name was supplied or
   *  the name could not be resolved. */
  nameOk?: boolean;
  /** The species is a byproduct rather than the intended product. A display/authoring label
   *  only: like any other product it stays on the product side of the equation. */
  byproduct?: boolean;
}

export type RouteLabelRole = 'reactant' | 'product' | 'agent';

/** A species the author named in the step prose: the IUPAC name and the isomeric SMILES it
 *  was written with. The prose is the fixed reference; the checker compares the name and the
 *  structure to it. */
export interface RouteSpeciesLabel {
  role: RouteLabelRole;
  byproduct: boolean;
  name: string;
  smiles: string;
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
  /** One sentence per supplied name that denotes a different structure than the species it
   *  was written beside, as the capability resolved it. */
  nameProblems?: string[];
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

export interface RouteTargetAudit {
  input: string;
  canonicalSmiles: string | null;
  formula: string | null;
  formedAt: number | null;
  reason: 'formed' | 'stereo-mismatch' | 'not-formed' | 'unparsed';
}

export interface RouteAudit {
  steps: RouteStepAudit[];
  links: RouteLinkAudit[];
  continuous: boolean;
  blocked: string[];
  /** Steps connected to nothing. Older packages only say so in `blocked`. */
  isolated?: number[];
  /** Whether the route forms the requested target; absent when none was named. */
  target?: RouteTargetAudit;
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
/** A role heading a names-first step backticks ("`Reactants:`"). It is shaped like a SMILES
 *  token (letters plus the colon) but is a label, not a molecule the model proposed. */
const ROLE_LABEL = /^(?:reactants?|products?|byproducts?|agents?|reagents?|catalysts?|solvents?|conditions?|notes?):?$/i;

function isSpeciesToken(token: string): boolean {
  if (ROLE_LABEL.test(token)) return false;
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

// ---------------------------------------------------------------- species labels

/** A role marker wherever it appears: line-leading, bulleted, inline in a paragraph, and
 *  wrapped in the backticks or bold a model likes to use (`` `Reactants:` ``, `**Products:**`).
 *  The colon is required so ordinary prose ("each reactant") is never mistaken for a label. */
const ROLE_MARKER = /(?:`{1,2}|\*\*|__)?[ \t]*\b(reactants?|products?|by[-\s]?products?|agents?)[ \t]*[:：][ \t]*(?:`{1,2}|\*\*|__)?/gi;
/** The name-first path reads only the four plural labels the contract asks for. A model's
 *  prose sentence that begins with a singular "Product:" (its own summary, beside the real
 *  `Products:` list) is therefore not mistaken for a species label. The legacy path keeps the
 *  singular-tolerant `ROLE_MARKER` so older answers still parse. */
const NAME_ROLE_MARKER = /(?:`{1,2}|\*\*|__)?[ \t]*\b(reactants|products|by[-\s]?products|agents)[ \t]*[:：][ \t]*(?:`{1,2}|\*\*|__)?/gi;
/** A markdown heading (`## …`) or a wholly bold line (`**…**`). The route's step headings are
 *  the subset whose title begins with "Step N"; a heading like "Alternative for Step 3" is a
 *  section of the answer, not a step, and its labels are not part of the sequential route. */
const HASH_HEADING = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)\s*$/;
const BOLD_HEADING = /^[ \t]{0,3}\*\*([^*]+)\*\*[ \t]*$/;
const STEP_TITLE = /^step\b[ \t]*\d+/i;
/** A species pair as the answer writes it: `name — \`smiles\`` (the contract form) or the
 *  parenthesised `name (\`smiles\`)`. Names may contain hyphens, so a separated dash is
 *  required; the backticked SMILES is what makes the pair findable at all. */
const SPECIES_PAIR = /([^`—–;\n]+?)\s*(?:—|–|\s-\s)\s*`([^`\n]+)`/g;
const SPECIES_PAIR_PAREN = /([^`\n;]+?)\s*\(\s*`([^`\n]+)`\s*\)/g;

function roleOf(label: string): { role: RouteLabelRole; byproduct: boolean } | null {
  const value = label.toLowerCase().replace(/\s+/g, '');
  if (value.startsWith('reactant')) return { role: 'reactant', byproduct: false };
  if (value.startsWith('byproduct') || value.startsWith('by-product')) return { role: 'product', byproduct: true };
  if (value.startsWith('product')) return { role: 'product', byproduct: false };
  if (value.startsWith('agent')) return { role: 'agent', byproduct: false };
  return null;
}

function cleanSpeciesName(raw: string): string {
  return raw.replace(/^[\s>*_`:：-]+/, '').replace(/[\s*_`]+$/, '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function extractSpeciesPairs(fragment: string, role: RouteLabelRole, byproduct: boolean): RouteSpeciesLabel[] {
  const out: RouteSpeciesLabel[] = [];
  const seen = new Set<string>();
  const add = (name: string, smiles: string) => {
    const cleanName = cleanSpeciesName(name);
    const cleanSmiles = smiles.trim();
    if (!cleanSmiles || cleanSmiles.length > 2000 || /[\s|*]/.test(cleanSmiles)) return;
    const key = `${cleanSmiles}\u0000${cleanName}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ role, byproduct, name: cleanName, smiles: cleanSmiles });
  };
  for (const match of fragment.matchAll(SPECIES_PAIR)) add(match[1] ?? '', match[2] ?? '');
  for (const match of fragment.matchAll(SPECIES_PAIR_PAREN)) add(match[1] ?? '', match[2] ?? '');
  return out;
}

interface RoleSegment { role: RouteLabelRole; byproduct: boolean; start: number; end: number }

/** Every labelled segment, in document order, with the span of text that belongs to it. */
function roleSegments(text: string, pattern: RegExp = ROLE_MARKER): RoleSegment[] {
  const markers = [...text.matchAll(pattern)];
  const segments: RoleSegment[] = [];
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const parsed = roleOf(marker[1] ?? '');
    if (!parsed) continue;
    const start = (marker.index ?? 0) + marker[0].length;
    const end = index + 1 < markers.length ? (markers[index + 1].index ?? text.length) : text.length;
    segments.push({ role: parsed.role, byproduct: parsed.byproduct, start, end });
  }
  return segments;
}

interface SectionHeading { offset: number; step: boolean }

/** Every heading in the answer, flagged as a route step (its title starts with "Step N") or
 *  not (an alternative, a notes section, the target summary). */
function sectionHeadings(text: string): SectionHeading[] {
  const out: SectionHeading[] = [];
  let offset = 0;
  for (const line of text.split(/\r?\n/)) {
    const match = HASH_HEADING.exec(line) ?? BOLD_HEADING.exec(line);
    const title = (match?.[1] ?? '').trim();
    if (title) out.push({ offset, step: STEP_TITLE.test(title) });
    offset += line.length + 1;
  }
  return out;
}

/** The offset of the most recent heading at or before `offset`, if it is a step heading. A
 *  segment under a later non-step heading (an "Alternative…", a notes block) returns null. */
function lastStepHeadingOffset(headings: SectionHeading[], offset: number): number | null {
  let last: SectionHeading | null = null;
  for (const heading of headings) { if (heading.offset <= offset) last = heading; else break; }
  return last && last.step ? last.offset : null;
}

/** The step a role segment belongs to, or null when it sits in a non-step section (an
 *  "Alternative for Step 3", a notes block) and is not part of the sequential route. */
function stepIndexFor(headings: SectionHeading[], offset: number, count: number): number | null {
  let last: SectionHeading | null = null;
  for (const heading of headings) { if (heading.offset <= offset) last = heading; else break; }
  if (!last || !last.step) return null;
  const index = headings.filter((heading) => heading.step && heading.offset <= offset).length - 1;
  return Math.min(index, count - 1);
}

/** Every species the answer labels with a name and an isomeric SMILES, grouped by step.
 *
 *  The prose is the fixed reference for the route check. Labels are found wherever they are
 *  written — their own line, inline in a paragraph, wrapped in backticks or bold — and a step
 *  heading is an explicit boundary. When no heading is present, the role cycle the contract
 *  prescribes splits the steps: a step lists its reactants before its products, so the next
 *  `Reactants:` after a product begins a new step. Missing steps are empty arrays; the result
 *  always has `count` entries. */
export function findStepSpeciesLabels(text: string, count: number): RouteSpeciesLabel[][] {
  if (count < 1) return [];
  const steps: RouteSpeciesLabel[][] = Array.from({ length: count }, () => []);
  const segments = roleSegments(text);
  if (!segments.length) return steps;
  const headings = sectionHeadings(text);

  const add = (index: number, segment: RoleSegment, end: number) => {
    if (steps[index].length >= 24) return;
    for (const pair of extractSpeciesPairs(text.slice(segment.start, end), segment.role, segment.byproduct)) {
      if (steps[index].length >= 24) break;
      steps[index].push(pair);
    }
  };

  if (headings.some((heading) => heading.step)) {
    for (const segment of segments) {
      const index = stepIndexFor(headings, segment.start, count);
      if (index === null) continue; // an alternative or notes section, not a step
      // Keep a segment inside its own step: stop it at the next heading.
      const boundary = headings.find((heading) => heading.offset > segment.start && heading.offset < segment.end);
      add(index, segment, boundary?.offset ?? segment.end);
    }
    return steps;
  }

  let index = 0;
  let sawProduct = false;
  for (const segment of segments) {
    if (segment.role === 'reactant' && sawProduct) { index = Math.min(index + 1, count - 1); sawProduct = false; }
    if (segment.role === 'product') sawProduct = true;
    add(index, segment, segment.end);
  }
  return steps;
}

// ---------------------------------------------------------------- name-first route

/** A species the answer names without a structure: the model gives the IUPAC name and the
 *  role, and the application derives the SMILES from the name. `declaredSmiles` is kept only
 *  as a fallback for a name the references cannot resolve. */
export interface NamedSpecies {
  role: RouteLabelRole;
  byproduct: boolean;
  name: string;
  declaredSmiles?: string;
}

/** A named species after the reference services resolved it, or failed to. `source` is the
 *  resolver that produced the structure, or `declared` when the model's own SMILES was used
 *  as a fallback. */
export interface ResolvedSpecies extends NamedSpecies {
  status: 'resolved' | 'fallback' | 'unresolved';
  smiles?: string;
  formula?: string;
  source?: 'pubchem' | 'opsin' | 'declared';
  feedback?: string;
}

/** Where a role segment's species list ends: at the first blank line or block marker. Without
 *  this the last `Agents:` segment would run to the end of the answer and swallow the summary,
 *  the target artifacts and the route report as if they were species names. */
function speciesListEnd(text: string, start: number, end: number): number {
  let offset = start;
  const lines = text.slice(start, end).split('\n');
  for (let index = 0; index < lines.length && index < 8; index += 1) {
    const trimmed = lines[index].replace(/\r$/, '').trim();
    // The list ends at a blank line, a heading/block marker, or any further role label —
    // including a singular prose "Product:" that the name-first path does not treat as a label.
    const boundary = !trimmed
      || /^(#{1,6}\s|nodus-|```|\{|\||<\?xml|<\w|>)/.test(trimmed)
      || /^[>*_`\s]*(reactants?|products?|by[-\s]?products?|agents?)\b[ \t]*[:：]/i.test(trimmed);
    if (index > 0 && boundary) break;
    offset += lines[index].length + (index < lines.length - 1 ? 1 : 0);
  }
  return Math.min(offset, end);
}

interface RoleEntry { name: string; declaredSmiles?: string; start: number; end: number }

/** Entry spans split on `;`/newlines, but not inside parentheses — so "none (H₂SO₄ is consumed…;
  * the product is obtained after neutralization)" stays one entry. When the parentheses do not
  * balance (a name like "ε-caprolactam (azepan-2-one" with no closing), fall back to a plain
  * split so an unclosed bracket cannot swallow the rest of the list. */
function splitEntrySpans(list: string): Array<{ start: number; end: number }> {
  let balance = 0;
  for (const character of list) { if (character === '(') balance += 1; else if (character === ')') balance = Math.max(0, balance - 1); }
  const spans: Array<{ start: number; end: number }> = [];
  if (balance !== 0) {
    for (const match of list.matchAll(/[^;\n]+/g)) spans.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
    return spans;
  }
  let depth = 0;
  let start = 0;
  for (let index = 0; index <= list.length; index += 1) {
    const character = list[index];
    if (index === list.length || (depth === 0 && (character === ';' || character === '\n'))) {
      if (index > start) spans.push({ start, end: index });
      start = index + 1;
    } else if (character === '(') depth += 1;
    else if (character === ')') depth = Math.max(0, depth - 1);
  }
  return spans;
}

/** Split one role fragment into entries with their offsets, so the species list can be
 *  rewritten in place without touching the prose around it. An entry may still carry a legacy
 *  `name — \`smiles\`` pair, kept as a fallback; otherwise the entry is the name alone. */
function parseRoleEntries(fragment: string): RoleEntry[] {
  const out: RoleEntry[] = [];
  const list = fragment.slice(0, speciesListEnd(fragment, 0, fragment.length));
  for (const span of splitEntrySpans(list)) {
    const raw = list.slice(span.start, span.end);
    const entry = raw.replace(/^[\s>*_`]+/, '').trim();
    if (!entry) continue;
    const pair = /^(.+?)\s*[—–]\s*`([^`]+)`/.exec(entry);
    if (pair) {
      const name = cleanSpeciesName(pair[1]);
      if (name) out.push({ name, declaredSmiles: pair[2].trim(), start: span.start, end: span.end });
      continue;
    }
    const name = cleanSpeciesName(entry.replace(/[—–]?\s*`[^`]*`/g, '').replace(/[*_`]/g, '').replace(/[.,;:\s]+$/, ''));
    if (!name || /^(?:none|no|n\/a|nil)\b/i.test(name) || /^[—–-]+$/.test(name)) continue;
    out.push({ name, start: span.start, end: span.end });
  }
  return out;
}

interface NamedSegment { step: number; role: RouteLabelRole; byproduct: boolean; entries: RoleEntry[]; listStart: number }

/** Every named role segment, assigned to its step. In the name-first path only the plural
 *  labels count; a non-step section (an "Alternative…") is skipped; without headings the role
 *  cycle splits the steps. */
function namedSegments(text: string, count: number): NamedSegment[] {
  const segments = roleSegments(text, NAME_ROLE_MARKER);
  if (!segments.length) return [];
  const headings = sectionHeadings(text);
  const out: NamedSegment[] = [];
  if (headings.some((heading) => heading.step)) {
    // Assign by the step heading a segment actually sits under, so a duplicated summary heading
    // (a prose "Step 1" followed by a species-list "Step 1") does not create phantom steps.
    const active = [...new Set(segments.map((segment) => lastStepHeadingOffset(headings, segment.start)).filter((offset): offset is number => offset !== null))].sort((a, b) => a - b);
    for (const segment of segments) {
      const offset = lastStepHeadingOffset(headings, segment.start);
      if (offset === null) continue; // an alternative or notes section, not a step
      const step = Math.min(active.indexOf(offset), Math.max(0, count - 1));
      const boundary = headings.find((heading) => heading.offset > segment.start && heading.offset < segment.end)?.offset ?? segment.end;
      out.push({ step, role: segment.role, byproduct: segment.byproduct, listStart: segment.start, entries: parseRoleEntries(text.slice(segment.start, boundary)) });
    }
    return out;
  }
  let step = 0;
  let sawProduct = false;
  for (const segment of segments) {
    if (segment.role === 'reactant' && sawProduct) { step = Math.min(step + 1, count - 1); sawProduct = false; }
    if (segment.role === 'product') sawProduct = true;
    out.push({ step, role: segment.role, byproduct: segment.byproduct, listStart: segment.start, entries: parseRoleEntries(text.slice(segment.start, segment.end)) });
  }
  return out;
}

/** How many numbered steps the answer contains: the number of step headings that actually
 *  carry species, or the role cycle (a new step begins at a `Reactants:` that follows a
 *  product) when there are no headings. A prose summary heading with no species under it does
 *  not count, so a route written twice is still one route. */
export function countRouteSteps(text: string): number {
  const segments = roleSegments(text, NAME_ROLE_MARKER);
  const headings = sectionHeadings(text);
  const stepHeadings = headings.filter((heading) => heading.step);
  if (stepHeadings.length) {
    if (!segments.length) return stepHeadings.length;
    const active = new Set(segments.map((segment) => lastStepHeadingOffset(headings, segment.start)).filter((offset): offset is number => offset !== null));
    return active.size || stepHeadings.length;
  }
  if (!segments.length) return 0;
  let count = 1;
  let sawProduct = false;
  for (const segment of segments) {
    if (segment.role === 'reactant' && sawProduct) { count += 1; sawProduct = false; }
    if (segment.role === 'product') sawProduct = true;
  }
  return count;
}

/** The names the answer assigns to each step, in document order per step. */
export function findStepNamedSpecies(text: string, count: number): NamedSpecies[][] {
  if (count < 1) return [];
  const steps: NamedSpecies[][] = Array.from({ length: count }, () => []);
  for (const segment of namedSegments(text, count)) {
    for (const entry of segment.entries) {
      if (steps[segment.step].length >= 48) break;
      steps[segment.step].push({ role: segment.role, byproduct: segment.byproduct, name: entry.name, ...(entry.declaredSmiles ? { declaredSmiles: entry.declaredSmiles } : {}) });
    }
  }
  return steps;
}

/** Build one `reactants>agents>products` line per step from the resolved species. Each ion is
 *  written once per side and the coefficient is left to the solver, as the contract asks: a
 *  named salt resolves to its ions, and two salts sharing an ion (`chromium(III) sulfate` and
 *  `sodium sulfate`) would otherwise put the same token on one side twice, which admits more
 *  than one balance. A step with no reactant or no product cannot form an equation. */
export function buildRouteSteps(speciesByStep: ResolvedSpecies[][]): string[] {
  const fragments = (step: ResolvedSpecies[], role: RouteLabelRole): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of step.filter((item) => item.role === role)) {
      for (const part of (entry.smiles ?? '').split('.')) {
        const token = part.trim();
        if (!token || seen.has(token)) continue;
        seen.add(token);
        out.push(token);
      }
    }
    return out;
  };
  return speciesByStep.map((step) => {
    const reactants = fragments(step, 'reactant');
    const agents = fragments(step, 'agent');
    const products = fragments(step, 'product');
    if (!reactants.length || !products.length) return '';
    return `${reactants.join('.')}>${agents.join('.')}>${products.join('.')}`;
  }).filter(Boolean);
}

/** Attach the resolved SMILES to each species entry in place, replacing any declared SMILES.
 *  Only the species-list span of each role segment is rewritten, so a name that is a substring
 *  of another ("cyclohexanone" in "cyclohexanone oxime"), and the prose and headings around it,
 *  are left untouched. Each resolved entry lines up positionally with the parsed entry. */
export function annotateSpeciesSmiles(answer: string, speciesByStep: ResolvedSpecies[][]): string {
  const segments = namedSegments(answer, speciesByStep.length);
  const cursor = new Map<number, number>();
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  for (const segment of segments) {
    const start = cursor.get(segment.step) ?? 0;
    const resolved = speciesByStep[segment.step].slice(start, start + segment.entries.length);
    cursor.set(segment.step, start + segment.entries.length);
    segment.entries.forEach((entry, index) => {
      const match = resolved[index];
      const name = match?.name ?? entry.name;
      const smiles = match?.smiles;
      replacements.push({ start: segment.listStart + entry.start, end: segment.listStart + entry.end, text: smiles ? `${name} — \`${smiles}\`` : name });
    });
  }
  let out = answer;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, replacement.start) + replacement.text + out.slice(replacement.end);
  }
  return out;
}

/** A compact, user-facing note listing the names the resolver corrected, or the empty string
 *  when nothing changed. A full declared-vs-resolved table was a temporary debug aid. */
export function formatNameCorrectionNote(corrections: string[]): string {
  const unique = [...new Set(corrections.filter(Boolean))];
  return unique.length ? `Name corrections: ${unique.join('; ')}` : '';
}

/** A structure the answer lists under more than one role in the same step — most often a
 *  product repeated in the byproducts list, or a solvent listed as both an agent and a
 *  product. The contract asks for each species once, under exactly one role, so this is a
 *  deterministic failure that does not need a model to find. */
export function findDuplicateRoleProblems(labels: RouteSpeciesLabel[][]): RouteNameProblem[] {
  const problems: RouteNameProblem[] = [];
  labels.forEach((entries, index) => {
    const bySmiles = new Map<string, { roles: Set<string>; name: string }>();
    for (const entry of entries) {
      const role = entry.byproduct ? 'byproduct' : entry.role;
      const record = bySmiles.get(entry.smiles) ?? { roles: new Set<string>(), name: entry.name };
      record.roles.add(role);
      if (!record.name && entry.name) record.name = entry.name;
      bySmiles.set(entry.smiles, record);
    }
    for (const [smiles, record] of bySmiles) {
      if (record.roles.size < 2) continue;
      const roles = [...record.roles];
      problems.push({
        step: index + 1,
        role: roles.includes('reactant') ? 'reactant' : 'product',
        name: record.name,
        smiles,
        detail: `the same structure is listed as ${roles.join(' and ')}; list each species once under exactly one role`,
      });
      if (problems.length >= 24) break;
    }
  });
  return problems.slice(0, 24);
}

/** The three dot-separated fields of a reaction line, as species tokens. */
function reactionFields(reaction: string): { reactants: string[]; agents: string[]; products: string[] } {
  const parts = reaction.split('>');
  const split = (field: string | undefined) => (field ?? '').split('.').map((entry) => entry.trim()).filter(Boolean);
  return { reactants: split(parts[0]), agents: split(parts[1]), products: split(parts[2]) };
}

/** Whether the labelled species list and the step's reaction line describe the same things:
 *  every named species is written in the field its role claims, and every reactant and
 *  product in the equation is named. Agents are exempt from the second half — a catalyst or
 *  solvent is routinely named in prose without a SMILES, so an unnamed token above the arrow
 *  is not a failure — but a labelled agent must still be written in the agents field. This is
 *  the deterministic half of "the prose and the equation agree": it cannot judge intent, but
 *  it catches the common drift where a species or byproduct appears on one side of the pair
 *  but not the other. */
export function findStepEquationProblems(steps: string[], labels: RouteSpeciesLabel[][]): RouteNameProblem[] {
  const problems: RouteNameProblem[] = [];
  const limit = Math.min(steps.length, labels.length);
  for (let index = 0; index < limit; index += 1) {
    const entries = labels[index];
    if (!entries.length) continue;
    const fields = reactionFields(steps[index]);
    const named = new Set<string>();
    for (const entry of entries) {
      const expected = entry.role === 'reactant' ? fields.reactants : entry.role === 'agent' ? fields.agents : fields.products;
      const fieldName = entry.role === 'reactant' ? 'reactants' : entry.role === 'agent' ? 'agents' : 'products';
      const fragments = entry.smiles.split('.').map((fragment) => fragment.trim()).filter(Boolean);
      for (const fragment of fragments) named.add(fragment);
      if (fragments.some((fragment) => !expected.includes(fragment))) {
        problems.push({
          step: index + 1,
          role: entry.byproduct ? 'product' : entry.role,
          name: entry.name,
          smiles: entry.smiles,
          detail: `the ${entry.byproduct ? 'byproduct' : entry.role} ${entry.name ? `"${entry.name}" ` : ''}is not written in this step's ${fieldName} field of the reaction line`,
        });
      }
    }
    // Agents are deliberately excluded: a catalyst or solvent may be written as prose with no
    // SMILES, and demanding a name for its token above the arrow only produces false failures.
    for (const token of [...new Set([...fields.reactants, ...fields.products])]) {
      if (named.has(token)) continue;
      problems.push({ step: index + 1, role: 'product', name: '', smiles: token, detail: `the equation species \`${token}\` has no IUPAC name and SMILES in the species list` });
    }
    if (problems.length >= 24) break;
  }
  return problems.slice(0, 24);
}

/** The request's target, from the usual phrasing "a synthesis of <name> (SMILES: <smiles>)".
 *  A SMILES named after "from", "starting" or "using" is a starting material, not the target,
 *  so the match stops there rather than guess. */
const TARGET_PATTERN = /\bsynthes[a-z]*\s+(?:of|for)\b(?:(?!\b(?:from|starting|using|with)\b)[^\n]){0,160}?\bSMILES\s*[:=]\s*`?([^\s`,;]+)/i;

export function findRequestedTarget(text: string): string | null {
  const match = TARGET_PATTERN.exec(text);
  if (!match) return null;
  let value = match[1].replace(/\.+$/, '');
  // "(SMILES: CCO)" leaves the prose's closing parenthesis on the SMILES.
  const unbalanced = () => (value.match(/\)/g) ?? []).length > (value.match(/\(/g) ?? []).length;
  while (value.endsWith(')') && unbalanced()) value = value.slice(0, -1);
  return value && value.length <= 2000 && SMILES_CHARS.test(value) ? value : null;
}

/** The first line of the route-fix prompt, so the request behind a correction can be found. */
export const ROUTE_FIX_PROMPT_LEAD = 'Correction needed for the synthesis route above.';

/** The target of the conversation's current synthesis request. A correction sent from the
 *  route-fix button carries no target, so it is skipped for the request it corrects; any
 *  other message is the request. */
export function requestedTargetFor(userMessages: string[]): string | null {
  for (let index = userMessages.length - 1; index >= 0; index--) {
    if (userMessages[index].trimStart().startsWith(ROUTE_FIX_PROMPT_LEAD)) continue;
    return findRequestedTarget(userMessages[index]);
  }
  return null;
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
    ...(typeof value.name === 'string' && value.name.trim() ? { name: value.name.trim().slice(0, 200) } : {}),
    ...(typeof value.nameOk === 'boolean' ? { nameOk: value.nameOk } : {}),
    ...(value.byproduct === true ? { byproduct: true } : {}),
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
    ...(stringArray(value.nameProblems).length ? { nameProblems: stringArray(value.nameProblems).map((entry) => entry.slice(0, 300)).slice(0, 24) } : {}),
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
  const isolated = Array.isArray(value.isolated)
    ? value.isolated.filter((entry): entry is number => Number.isInteger(entry) && entry >= 0 && entry < 16).slice(0, 16)
    : undefined;
  const target = normalizeRouteTarget(value.target);
  return { steps, links, continuous: boolOr(value.continuous, blocked.length === 0), blocked, ...(isolated ? { isolated } : {}), ...(target ? { target } : {}) };
}

const ROUTE_TARGET_REASONS: RouteTargetAudit['reason'][] = ['formed', 'stereo-mismatch', 'not-formed', 'unparsed'];

function normalizeRouteTarget(entry: unknown): RouteTargetAudit | null {
  const value = asRecord(entry);
  if (!value || typeof value.input !== 'string' || !(ROUTE_TARGET_REASONS as unknown[]).includes(value.reason)) return null;
  return {
    input: value.input.slice(0, 2000),
    canonicalSmiles: typeof value.canonicalSmiles === 'string' ? value.canonicalSmiles.slice(0, 2000) : null,
    formula: typeof value.formula === 'string' ? value.formula.slice(0, 200) : null,
    formedAt: Number.isInteger(value.formedAt) ? value.formedAt as number : null,
    reason: value.reason as RouteTargetAudit['reason'],
  };
}

/** Steps connected to nothing, from the structured field or, for an older package, from the
 *  sentence it writes into `blocked`. */
function isolatedSteps(audit: RouteAudit): number[] {
  if (audit.isolated) return audit.isolated;
  return audit.blocked.flatMap((entry) => {
    const match = /^Step (\d+) is disconnected/.exec(entry);
    return match ? [Number(match[1]) - 1] : [];
  });
}

const sideTrace = (species: RouteSpeciesSummary[], names?: Map<string, string>): string => species.map((entry) => {
  const name = names?.get(entry.input) ?? names?.get(entry.canonicalSmiles) ?? entry.name;
  const identity = entry.formula || entry.canonicalSmiles;
  return name ? `${name} (${identity})` : identity;
}).join(' + ');

/** A lookup from a declared SMILES to the IUPAC name the author wrote beside it. The
 *  authoring labels carry the name and the exact token; the audit species carries the
 *  canonical form, so both are keyed. */
export function routeLabelNames(labels: RouteSpeciesLabel[][]): Map<string, string> {
  const names = new Map<string, string>();
  for (const step of labels) for (const label of step) if (label.name) names.set(label.smiles, label.name);
  return names;
}

/** The deterministic appendix a reader can act on: per step balance and stereochemistry,
 *  then whether every intermediate is carried over as the same molecule. Generated by the
 *  application, so the model cannot claim a route was verified when it was not. When the
 *  answer named the species, the IUPAC names are shown beside the structures they denote. */
export function formatRouteAudit(audit: RouteAudit, labels: RouteSpeciesLabel[][] = []): string {
  const names = routeLabelNames(labels);
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
    const nameFailure = (step.nameProblems?.length ?? 0) > 0;
    const verdict = !nameFailure && step.balanced && (step.unspecifiedStereocentres === 0 || racemic) ? 'OK' : 'FAIL';
    const stereo = step.unspecifiedStereocentres
      ? racemic
        ? ', declared racemic (stereochemistry not controlled)'
        : `, ${step.unspecifiedStereocentres} unspecified stereocentre(s) or double bond(s)`
      : '';
    const balance = step.balanced ? 'balanced' : `NOT balanced (${step.differences.join('; ')})`;
    const nameNote = nameFailure ? ` name check failed: ${step.nameProblems!.join('; ')}.` : '';
    const agents = step.agents.length ? ` [agents: ${sideTrace(step.agents, names)}]` : '';
    lines.push(`- ${label} ${verdict} — ${balance}${stereo}.${nameNote} ${sideTrace(step.reactants, names)}${agents} → ${sideTrace(step.products, names)}`);
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
  const target = audit.target;
  if (target) {
    const name = target.canonicalSmiles ? `\`${target.canonicalSmiles}\`${target.formula ? ` (${target.formula})` : ''}` : `\`${target.input}\``;
    lines.push('', target.reason === 'formed' && target.formedAt !== null
      ? `Target ${name}: formed in step ${target.formedAt + 1}.`
      : target.reason === 'stereo-mismatch'
        ? `Target ${name}: FAIL — a step forms its constitution but not its stereochemistry.`
        : target.reason === 'not-formed'
          ? `Target ${name}: FAIL — no step forms it.`
          : `Target ${name}: not checked — the requested structure could not be read.`);
  }
  // When the capability resolved the author's names against the structures, a name that
  // denotes a different molecule is reported here. The check is deterministic (OPSIN/PubChem
  // names resolved to a graph), so a silent rename is not mistaken for agreement.
  const named = audit.steps.flatMap((step) => [
    ...step.reactants.map((entry) => ({ role: 'reactant', entry })),
    ...step.agents.map((entry) => ({ role: 'agent', entry })),
    ...step.products.map((entry) => ({ role: entry.byproduct ? 'byproduct' : 'product', entry })),
  ]).filter((item) => item.entry.name && item.entry.nameOk === false);
  if (named.length) {
    lines.push('', 'Species names that do not match their structure:', '');
    for (const { role, entry } of named) {
      const structure = `\`${entry.canonicalSmiles}\`${entry.formula ? ` (${entry.formula})` : ''}`;
      lines.push(`- ${role} "${entry.name}" denotes a different structure than ${structure}.`);
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

/** The problems that belong to the route rather than to one equation: an intermediate that
 *  changes between steps, a step connected to nothing, and a target the route never forms.
 *  Each can pass every per-step check, so without these the route is blocked and no fix is
 *  offered. */
function routeFixProblems(steps: string[], audit: RouteAudit): string[] {
  const problems: string[] = [];
  for (const link of audit.links) {
    if (link.ok) continue;
    const pair = `Steps ${link.from + 1} → ${link.to + 1}`;
    if (link.reason === 'constitution-only') {
      const forms = link.skeletonOnly.map((item) => `\`${item.product}\` is made but \`${item.reactant}\` is used`).join('; ');
      problems.push(`- ${pair}: the intermediate changes stereochemistry or charge between the steps${forms ? ` (${forms})` : ''}. Write it with the same isomeric SMILES in both steps.`);
    } else if (link.reason === 'declared-mismatch') {
      problems.push(`- Step ${link.to + 1}: the declared intermediate is not both a product of an earlier step and a reactant of this one.`);
    } else if (link.reason === 'no-overlap') {
      problems.push(`- ${pair}: no intermediate is carried over.`);
    }
  }
  for (const index of isolatedSteps(audit)) {
    problems.push(`- Step ${index + 1} is disconnected: none of its reactants is made by an earlier step and none of its products is used by a later one. Either a step is missing between it and its neighbours, or an intermediate is written with different SMILES in the two steps. Insert the missing step(s) where they belong, or make the SMILES identical.${steps[index] ? `\n  Currently: \`${steps[index]}\`` : ''}`);
  }
  const target = audit.target;
  if (target && audit.steps.every((step) => step.ok)) {
    const wanted = `\`${target.canonicalSmiles ?? target.input}\`${target.formula ? ` (${target.formula})` : ''}`;
    const last = audit.steps[audit.steps.length - 1];
    const stops = last?.products.map((entry) => `\`${entry.canonicalSmiles}\``).join(', ');
    if (target.reason === 'not-formed') {
      problems.push(`- The route never forms the requested target ${wanted}${stops ? `; its last step stops at ${stops}` : ''}. Add the missing step(s) so that a final step's products include the target with exactly that SMILES.`);
    } else if (target.reason === 'stereo-mismatch') {
      problems.push(`- The route forms the target's constitution but not its stereochemistry. The target is ${wanted}: write the step that sets it with the target's stereodescriptors.`);
    }
  }
  return problems;
}

/** Every problem the correction must resolve: the structural ones the checker found, plus
 *  the name/consistency problems the prose check found. Both feed the same one-click fix. */
function routeProblemList(steps: string[], audit: RouteAudit, nameProblems: string[]): string[] {
  return [...routeFixProblems(steps, audit), ...nameProblems];
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
  if (step.nameProblems?.length) return step.nameProblems.join('; ');
  if (step.balanced !== true) return `not balanced. ${prescriptiveBalance(step)}`;
  if (step.unspecifiedStereocentres > 0 && step.racemic !== true) return `${step.unspecifiedStereocentres} unspecified stereocentre(s) or double bond(s) — specify them, or write that the outcome is racemic`;
  return 'rejected by the checker';
}

/** A ready-to-send follow-up that asks the model to correct the steps the checker refused,
 *  giving each failing step a directional reason and the rules that resolve the common
 *  shortfalls. It is inert text the interface offers as a button; the model only proposes,
 *  and the reply is checked and drawn again, so determinism stays in the checker. Empty when
 *  there is nothing to fix. */
export function formatRouteFixPrompt(steps: string[], audit: RouteAudit, nameProblems: string[] = []): string {
  // A declared racemate is an accepted outcome, not a failure the model can fix by
  // specifying an enantiomer, so it is never offered back as a correction.
  const failures = audit.steps.filter(step => step.nameProblems?.length
    || !(step.ok && step.balanced === true && (step.unspecifiedStereocentres === 0 || step.racemic === true)));
  const problems = routeProblemList(steps, audit, nameProblems);
  if (!failures.length && !problems.length) return '';
  const lines = failures.map(step =>
    `- Step ${step.index + 1}: ${stepFixInstruction(step)}\n  Currently: \`${steps[step.index]}\` — change it; do not repeat it unchanged.`);
  const prompt = [
    ROUTE_FIX_PROMPT_LEAD,
    '',
    ...(lines.length ? ['The route checker rejected these steps:', ...lines, ''] : []),
    ...(problems.length ? ['The route as a whole has these problems:', ...problems, ''] : []),
    `Re-output the same route in the same order. Rewrite only the rejected step(s) in place${problems.length ? ', insert any missing step(s) where the route problems say they belong,' : ''} and leave the passing steps exactly as they are. You can split a rejected step into consecutive steps when the reason asks for it: for example Step 3 becomes 3a and 3b, or the route grows from four steps to five by adding the extra step where Step 3 was. The original steps keep their relative order. Rules that resolve these failures:`,
    '- Keep the step order: never reorder, merge or duplicate a step, and never add a second copy of a step that already passes. You MAY split a rejected step into consecutive steps when the checker asks you to (e.g. 3 becomes 3a and 3b) — the new steps stay where the original was, so the route order is unchanged even if the numbering shifts. When the route problems say a step is missing, insert it where it belongs in the same way.',
    '- Conserve every element and the total charge on both sides. A species that is short on one side is a reagent (on the reactant side) or a byproduct (on the product side) that is missing from the equation.',
    '- List every species that is consumed or produced, once per side. Never put the same molecule on both sides; the only species that appears on both sides is a salt\'s counterion, as the salt rules below explain. Do not add water or a solvent unless the step consumes or produces it.',
    '- Every reactive group in a molecule reacts: saponify every ester, protonate every carboxylate, alkylate every position you intend. A group that leaves — an alcohol from an alkoxide, a hydrogen halide, water, ammonia, CO2 — is a product and must be written out.',
    '- A metal that enters as a reagent leaves as its salt (for example `[Na+].[Br-]`, `[Na+].[Cl-]`); never leave a metal ion on one side only, and count one equivalent of base or acid for each group that reacts.',
    '- Write each ion of a salt once per side and let the coefficient count it: if `[Na+]` appears once among the reactants, write it once among the products too. A disodium salt is one `[Na+]` with the dianion, not `[Na+].[Na+]` on one side only; hydrochloric acid is one `[H+].[Cl-]`, not two. An ion written a different number of times on the two sides is the usual reason a metal will not balance.',
    '- Write the organic product neutral, not protonated with a free counterion. With a metal and an acid (Sn/HCl, Fe/HCl, Zn/HCl) the acid anion leaves with the metal as its salt (`Cl[Sn]Cl`, `Cl[Fe]Cl`); the amine or alcohol is neutral (`Nc1ccccc1`), never `[NH3+]` beside a free `[Cl-]`.',
    '- Coefficients are solved for you: give each distinct species once and let the numbers come out. Use at most 12 species per equation; if a step genuinely cannot balance, split it into consecutive steps.',
    '- Give each step as one balanced reaction in the exact form `reactants>agents>products` (exactly two ">"), consumed reagents as reactants, byproducts as products, and only true catalysts or solvents as agents.',
    '- Every species must carry its systematic IUPAC name beside the exact isomeric SMILES, for example `ethanoic acid — `CC(=O)O``. The name and the SMILES must denote the same structure the prose describes; the prose is fixed and is never rewritten.',
  ].join('\n');
  return `\`\`\`nodus-route-fix\n${JSON.stringify({ label: 'Ask the model to fix the failed steps', prompt })}\n\`\`\``;
}

/** A names-first follow-up for a route that was derived from IUPAC names. It shows each failing
 *  step as its four labelled species lines (names only — never the derived SMILES) and asks the
 *  model to correct the names and roles; the application re-derives the structures and the
 *  equation. Empty when there is nothing to fix. */
export function formatNamedRouteFixPrompt(labels: RouteSpeciesLabel[][], audit: RouteAudit): string {
  const names = (index: number, role: RouteLabelRole, byproduct?: boolean): string => {
    const entries = (labels[index] ?? []).filter((entry) => entry.role === role && (byproduct === undefined || entry.byproduct === byproduct));
    return entries.map((entry) => entry.name).filter(Boolean).join('; ') || 'none';
  };
  const stepLines = (index: number): string => [
    `  Reactants: ${names(index, 'reactant')}`,
    `  Products: ${names(index, 'product', false)}`,
    `  Byproducts: ${names(index, 'product', true)}`,
    `  Agents: ${names(index, 'agent')}`,
  ].join('\n');

  const failures: string[] = [];
  for (const step of audit.steps) {
    if (step.nameProblems?.length) {
      failures.push(`- Step ${step.index + 1}: ${step.nameProblems.join('; ')}\n${stepLines(step.index)}`);
      continue;
    }
    if (step.ok && step.balanced === true && (step.unspecifiedStereocentres === 0 || step.racemic === true)) continue;
    const reason = !step.ok
      ? step.error ?? 'could not be parsed'
      : step.balanced !== true
        ? `not balanced (${step.differences.join('; ')})`
        : `${step.unspecifiedStereocentres} unspecified stereocentre(s) or double bond(s) — name the stereoisomer, or state that the outcome is racemic`;
    failures.push(`- Step ${step.index + 1}: ${reason}\n${stepLines(step.index)}`);
  }

  const problems: string[] = [];
  for (const index of isolatedSteps(audit)) {
    problems.push(`- Step ${index + 1} is disconnected: none of its species is made by an earlier step or used by a later one. Insert the missing step where it belongs, or write the carried species with the same IUPAC name in both steps.`);
  }
  const target = audit.target;
  if (target && audit.steps.every((step) => step.ok)) {
    const wanted = target.canonicalSmiles ?? target.input;
    const lastProducts = (labels[labels.length - 1] ?? []).filter((entry) => entry.role === 'product').map((entry) => entry.name).join(', ');
    if (target.reason === 'not-formed') problems.push(`- No step forms the requested target${target.formula ? ` (${target.formula})` : ''}${lastProducts ? `; the last step stops at ${lastProducts}` : ''}. Add the missing step so a final step's Products line names the target.`);
    else if (target.reason === 'stereo-mismatch') problems.push(`- The route forms the target's constitution but not its stereochemistry (${wanted}). Name the target with its stereodescriptors in the step that sets them.`);
  }
  if (!failures.length && !problems.length) return '';

  const prompt = [
    ROUTE_FIX_PROMPT_LEAD,
    '',
    ...(failures.length ? ['The route checker rejected these steps:', ...failures, ''] : []),
    ...(problems.length ? ['The route as a whole has these problems:', ...problems, ''] : []),
    'Re-output the same route in the same order, keeping the prose for each step. Rewrite only the rejected step(s) in place; you may split a rejected step into consecutive steps when the reason asks for it. Give EVERY step as four labelled lines of systematic IUPAC names, names only:',
    '  Reactants: <systematic IUPAC name>; <systematic IUPAC name>',
    '  Products: <systematic IUPAC name>',
    '  Byproducts: <systematic IUPAC name>',
    '  Agents: <catalyst or solvent, or none>',
    'Do not write SMILES, formulae or a reaction line — the application derives the structure and the balanced equation from your names. Rules that resolve these failures:',
    '- Keep the step order: never reorder, merge or duplicate a step, and never add a second copy of a step that already passes.',
    '- Conserve every element and the total charge on both sides. A species that is short on one side is a missing reagent (Reactants) or byproduct (Products/Byproducts); list it by systematic IUPAC name.',
    '- List every species that is consumed or produced once per side, under one role only. A true catalyst or solvent goes under Agents; never list a species that takes no part.',
    '- A metal that enters as a reagent leaves as its salt: name the metal-containing product or byproduct (for example sodium salicylate, sodium chloride).',
    '- Carry a species from one step into the next with the same systematic IUPAC name, including its stereodescriptors.',
    '- If a step cannot balance as one equation, split it into consecutive steps rather than merging transformations.',
  ].join('\n');
  return `\`\`\`nodus-route-fix\n${JSON.stringify({ label: 'Ask the model to fix the failed steps', prompt })}\n\`\`\``;
}

// ---------------------------------------------------------------- name/prose consistency

/** One species whose name, structure and prose do not agree. */
export interface RouteNameProblem {
  step: number;
  role: RouteLabelRole;
  name: string;
  smiles: string;
  detail: string;
}

export interface RouteConsistencyVerdict {
  status: 'ok' | 'mismatch' | 'ambiguous';
  problems: RouteNameProblem[];
  /** The clarification question, when the prose does not determine a single structure. */
  question?: string;
}

/** The system prompt for the gate: check that every named species' IUPAC name and isomeric
 *  SMILES denote the same structure the step prose describes. The prose is the reference. */
export const ROUTE_CONSISTENCY_SYSTEM = [
  'You check the species names in a proposed chemical synthesis against the prose that describes each step.',
  'The prose is the fixed reference. For every species you are given, decide whether (a) its IUPAC name denotes the same structure as its isomeric SMILES, and (b) that structure is the one the step prose describes.',
  'A species passes only when the name, the SMILES and the prose all describe the same molecule. A trivial or common name where a systematic name was required, a name naming a different isomer, a SMILES encoding a different compound, or a prose statement contradicted by the structure is a mismatch.',
  'The species the prose states the step makes must be the product named and encoded on the Products side. If the prose says the step makes an isomerised or further-transformed compound, a product entry that is the earlier intermediate, the wrong isomer, or a different compound is a mismatch — even when its own name and SMILES agree with each other. Check every reactant and byproduct against the transformation the prose describes as well.',
  'A species must not be listed under more than one role. A byproduct is a different molecule from the target products; repeating a product in the Byproducts list is a mismatch, and a consumed reagent that is neither consumed nor produced is a mismatch.',
  'Do not flag the standard SMILES of a simple molecule as wrong. Water is `O`, ammonia is `N`, hydrogen is `[H][H]`, hydrogen chloride is `Cl`, carbon dioxide is `O=C=O`; a short SMILES whose name matches the structure is not a mismatch.',
  'Agents are catalysts, solvents and modifiers. They are usually named in prose and do not need an IUPAC name or the exact SMILES of the active species; only flag an agent when the prose clearly names a different substance.',
  'Report a mismatch only for a clear, specific contradiction you can state in one sentence. When you are unsure, or the species is merely unusual, return {"status":"ok","problems":[]} — never invent a disagreement.',
  'If the prose is genuinely ambiguous and no single structure follows from it, say so rather than guessing.',
  'Return EXCLUSIVELY one JSON object, no prose around it:',
  '{"status":"ok","problems":[]}',
  '{"status":"mismatch","problems":[{"step":1,"role":"reactant","name":"...","smiles":"...","detail":"one sentence naming the disagreement"}]}',
  '{"status":"ambiguous","problems":[],"question":"the specific question, and the candidate structures if the prose allows more than one"}',
  'Use "step" 1-based, matching the step numbers given to you. Never rewrite the prose.',
].join('\n');

/** The check request: the whole answer (the prose reference) plus the parsed steps and
 *  species labels, so the model judges exactly the species the checker will act on. */
export function buildRouteConsistencyRequest(answer: string, steps: string[], labels: RouteSpeciesLabel[][]): string {
  const compact = labels.map((entries, index) => ({
    step: index + 1,
    reaction: steps[index] ?? '',
    species: entries.map((entry) => ({ role: entry.byproduct ? 'byproduct' : entry.role, name: entry.name, smiles: entry.smiles })),
  })).filter((entry) => entry.species.length > 0);
  return [
    'The proposed answer (the prose is authoritative and must not be changed):',
    answer.slice(0, 12000),
    '',
    'The steps and the species named in them:',
    JSON.stringify(compact),
  ].join('\n');
}

/** Whether text carries the checker's own request scaffolding. A repair that echoes our
 *  prompt back is not an answer — accepting it would paste the request into the conversation,
 *  which is exactly how a raw steps-JSON block once leaked into a reply. */
export function hasCheckerScaffolding(text: string): boolean {
  const value = typeof text === 'string' ? text : '';
  if (!value.trim()) return false;
  if (/^\s*\[\s*\{/.test(value)) return true;
  return [
    'The proposed answer (the prose is authoritative',
    'The steps and the species named in them:',
    'Reply with the corrected step(s):',
    'The species names in the synthesis route above do not match',
  ].some((marker) => value.includes(marker));
}

/** Parse the gate's verdict defensively: an unreadable reply means "not checked", never a
 *  fabricated failure. */
export function parseRouteConsistencyVerdict(raw: string): RouteConsistencyVerdict | null {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) return null;
  let value: unknown;
  try { value = JSON.parse(match[0]); } catch { return null; }
  const record = asRecord(value);
  if (!record) return null;
  const status = record.status;
  if (status !== 'ok' && status !== 'mismatch' && status !== 'ambiguous') return null;
  const roles: RouteLabelRole[] = ['reactant', 'product', 'agent'];
  const problems = (Array.isArray(record.problems) ? record.problems : []).map((entry) => {
    const item = asRecord(entry);
    if (!item) return null;
    const role = typeof item.role === 'string' && (roles as string[]).includes(item.role) ? item.role as RouteLabelRole : 'product';
    return {
      step: Number.isInteger(item.step) ? item.step as number : 0,
      role,
      name: typeof item.name === 'string' ? item.name.slice(0, 200) : '',
      smiles: typeof item.smiles === 'string' ? item.smiles.slice(0, 2000) : '',
      detail: typeof item.detail === 'string' ? item.detail.slice(0, 400) : '',
    };
  }).filter((entry): entry is RouteNameProblem => entry !== null).slice(0, 24);
  const question = typeof record.question === 'string' && record.question.trim() ? record.question.trim().slice(0, 1200) : undefined;
  if (status === 'mismatch' && !problems.length) return null;
  if (status === 'ambiguous' && !question) return null;
  return { status, problems, ...(question ? { question } : {}) };
}

/** The repair system prompt: rewrite only the names and the reaction SMILES so they agree
 *  with the fixed prose, returning the whole answer with everything else unchanged. */
export const ROUTE_REPAIR_SYSTEM = [
  'You correct the species names and reaction SMILES of a proposed synthesis so they agree with its prose.',
  'The prose is fixed. Do not add, remove, reorder or reword any prose, step heading, condition or explanation. Change only (i) the IUPAC name and isomeric SMILES written beside each species and (ii) the balanced reaction SMILES lines.',
  'For every species the prose describes, write the systematic IUPAC name and the exact isomeric SMILES of the structure it denotes. The name and the SMILES must denote the same molecule, and that molecule must be the one the prose describes.',
  'The Products side must be exactly the species the prose states the step produces, after every transformation the prose describes. Never leave the earlier intermediate as the product when the prose says it is converted on; list each species once, under one role only, and never repeat a product as a byproduct.',
  'Keep the reaction lines in the exact form `reactants>agents>products` (exactly two ">"), each species once per side, byproducts on the product side, only true catalysts or solvents as agents.',
  'If the prose does not determine a single structure for a species, do not guess: reply instead with exactly `AMBIGUOUS: ` followed by one specific question.',
  'Return the complete corrected answer and nothing else.',
].join('\n');

export function buildRouteRepairRequest(answer: string, steps: string[], labels: RouteSpeciesLabel[][], verdict: RouteConsistencyVerdict): string {
  return [
    buildRouteConsistencyRequest(answer, steps, labels),
    '',
    'These name/structure/prose disagreements were found and must be corrected:',
    verdict.problems.map((problem) => `- Step ${problem.step || '?'} ${problem.role} "${problem.name}" (\`${problem.smiles}\`): ${problem.detail}`).join('\n'),
  ].join('\n');
}

/** The escalation when the check cannot be resolved automatically: one click sends the
 *  question (and the candidate structures, when there are any) as the user's next message. */
export function formatRouteClarification(problems: RouteNameProblem[], question?: string): string {
  const lines = problems.map((problem) => `- Step ${problem.step || '?'} ${problem.role} "${problem.name}" (\`${problem.smiles}\`): ${problem.detail}`);
  const prompt = [
    'The species names in the synthesis route above do not match the prose, or the prose is ambiguous, and the correction could not be resolved automatically. Please confirm the intended chemistry.',
    ...(lines.length ? ['', 'Unresolved species:', ...lines] : []),
    ...(question ? ['', question] : []),
    '',
    'Reply with the corrected step(s): each species as a systematic IUPAC name and its exact isomeric SMILES, plus the balanced `reactants>agents>products` line.',
  ].join('\n');
  return `\`\`\`nodus-route-fix\n${JSON.stringify({ label: 'Confirm the intended structure', prompt })}\n\`\`\``;
}

// ---------------------------------------------------------------- name-resolution feedback

/** A species whose name the reference services could not resolve. */
export interface UnresolvedName {
  step: number;
  role: RouteLabelRole;
  byproduct: boolean;
  name: string;
  feedback?: string;
}

/** The system prompt for the resolution feedback loop: turn each name the references could
 *  not resolve into a true systematic IUPAC name without changing the species. */
export const ROUTE_NAME_FEEDBACK_SYSTEM = [
  'You fix chemical names so a reference service can resolve them to a structure.',
  'You are given species whose names PubChem and OPSIN could not resolve. For each, return the correct systematic IUPAC name of the same species, using the step prose for context and the resolver feedback for why the current name failed.',
  'Keep the identity: do not change which compound it is, do not drop stereochemistry the prose states, and do not invent a different reagent.',
  'Prefer a name a reference service holds — for example the systematic salt name «sodium but-1-yn-1-ide» rather than «sodium but-1-ynide».',
  'Return EXCLUSIVELY one JSON object: {"names":[{"from":"the name I gave you","to":"the corrected systematic IUPAC name"}]}.',
  'If you cannot name a species systematically, omit it from the array.',
].join('\n');

export function buildNameFeedbackRequest(species: UnresolvedName[], prose: string): string {
  return [
    'Species whose names did not resolve:',
    JSON.stringify(species.map((entry) => ({ step: entry.step, role: entry.byproduct ? 'byproduct' : entry.role, name: entry.name, resolver_feedback: entry.feedback ?? '' }))),
    '',
    'The route prose for context:',
    prose.slice(0, 8000),
  ].join('\n');
}

export function parseNameFeedback(raw: string): Array<{ from: string; to: string }> {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) return [];
  let value: unknown;
  try { value = JSON.parse(match[0]); } catch { return []; }
  const record = asRecord(value);
  const list = Array.isArray(record?.names) ? record.names as unknown[] : [];
  return list.map((entry) => {
    const item = asRecord(entry);
    if (!item || typeof item.from !== 'string' || typeof item.to !== 'string') return null;
    const from = item.from.trim().slice(0, 200);
    const to = item.to.trim().slice(0, 200);
    return from && to ? { from, to } : null;
  }).filter((entry): entry is { from: string; to: string } => entry !== null).slice(0, 48);
}

/** The escalation when a name cannot be resolved to a structure even after the feedback
 *  loop: name the species and why, so the user can confirm or correct it. */
export function formatUnresolvedNameClarification(unresolved: UnresolvedName[]): string {
  const lines = unresolved.map((entry) => `- Step ${entry.step} ${entry.byproduct ? 'byproduct' : entry.role} "${entry.name}"${entry.feedback ? `: ${entry.feedback}` : ''}`);
  const prompt = [
    'The application could not resolve some species names to structures, so those steps could not be built. Please give the correct systematic IUPAC name for each unresolved species.',
    '',
    'Unresolved species:',
    ...lines,
    '',
    'Reply with the corrected name for each species.',
  ].join('\n');
  return `\`\`\`nodus-route-fix\n${JSON.stringify({ label: 'Confirm the intended structure', prompt })}\n\`\`\``;
}

/** Offered when a route describes steps but lists no species under the four required labels, so
 *  nothing could be checked. One click asks the model to re-emit with the labelled lines. */
export function formatMissingSpeciesPrompt(): string {
  const prompt = [
    'The synthesis route describes steps but does not list the species under the four required labels, so the application could not check or draw it.',
    'Re-output the same route in the same order. Keep the prose for each step, and add exactly four lines after it:',
    'Reactants: <systematic IUPAC name>; <systematic IUPAC name>',
    'Products: <systematic IUPAC name>',
    'Byproducts: <systematic IUPAC name>',
    'Agents: <catalyst or solvent, or none>',
    'Give every species as a systematic IUPAC name only, separated by semicolons. Do not add SMILES or a reaction line.',
  ].join('\n');
  return `\`\`\`nodus-route-fix\n${JSON.stringify({ label: 'Ask the model to list the species', prompt })}\n\`\`\``;
}
