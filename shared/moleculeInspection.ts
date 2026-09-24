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
  'Synthesis route continuity: when you plan more than one reaction step, the intermediate carried from one step into the next must be written with the exact same systematic IUPAC name, including its stereodescriptors, in both places, so the application can confirm it is the same molecule.',
  'Do not rename, re-protonate or otherwise rewrite a carried intermediate. If a structure genuinely changes between steps, say so explicitly and justify it; otherwise the route is rejected as discontinuous.',
  'Do not write a reaction SMILES or a reaction line: the application derives every structure and every balanced equation from the species names you list.',
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
  /** The coefficient the checker solved for this species, when the step balances. */
  coefficient?: number;
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
  /** The equation balances only by assembling a product from more than one substrate. */
  assemblyProblem?: string;
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

/** The “Step N — <title>” heading and the paragraph under it for each step, in step order, so
 *  the route review can judge the transformation the author intended, not only the species.
 *  The heading already names the reaction ("Dehydration of citric acid…"); the prose explains
 *  it. Missing steps are empty strings. */
export function findStepProse(text: string, count: number): string[] {
  const found: string[] = [];
  let pending: { title: string; start: number } | null = null;
  let offset = 0;
  const commit = (end: number) => {
    if (!pending) return;
    const body = text.slice(pending.start, end).replace(/^[^\n]*\n?/, '');
    const cut = body.search(/(?:`{1,2}|\*\*|__)?[ \t]*\b(?:reactants?|products?|by[-\s]?products?|agents?)[ \t]*[:：]/i);
    const paragraph = (cut >= 0 ? body.slice(0, cut) : body).split(/\n{2,}/)[0] ?? '';
    const prose = paragraph.replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 360);
    found.push(prose ? `${pending.title} — ${prose}` : pending.title);
    pending = null;
  };
  for (const line of text.split(/\r?\n/)) {
    const heading = HASH_HEADING.exec(line) ?? BOLD_HEADING.exec(line);
    const title = (heading?.[1] ?? '').trim();
    if (title) {
      commit(offset);
      if (STEP_TITLE.test(title)) pending = { title, start: offset };
    }
    offset += line.length + 1;
  }
  commit(text.length);
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

/** A species name as the resolver feedback may return it: a short label with letters, and no
 *  markup or escaped syntax. A reply that smuggled an SVG, a JSON fragment or a newline into a
 *  name is not shown to the user as a "correction". */
function isPlausibleSpeciesName(value: string): boolean {
  return value.length >= 2 && value.length <= 200
    && /[A-Za-z]/.test(value)
    && !/[<>{}\\\n\r\t`|"]/.test(value)
    && !value.includes('→');
}

/** A compact, user-facing note listing the names the resolver corrected, or the empty string
 *  when nothing changed. A full declared-vs-resolved table was a temporary debug aid. Entries
 *  that are not two plausible names, and names corrected twice (A → B, B → C), are folded so
 *  the note stays a short list of the names that actually changed. */
export function formatNameCorrectionNote(corrections: string[]): string {
  const rename = new Map<string, string>();
  for (const raw of corrections) {
    const [from, to] = String(raw).split('→').map((part) => part.trim());
    if (!from || !to || from === to) continue;
    if (!isPlausibleSpeciesName(from) || !isPlausibleSpeciesName(to)) continue;
    rename.set(from, to);
  }
  const resolve = (name: string): string => {
    let current = name;
    const seen = new Set<string>();
    while (rename.has(current) && !seen.has(current)) { seen.add(current); current = rename.get(current)!; }
    return current;
  };
  const intermediates = new Set(rename.values());
  const entries: string[] = [];
  for (const from of rename.keys()) {
    if (intermediates.has(from)) continue; // a name that was itself only an intermediate
    const to = resolve(from);
    const entry = `${from} → ${to}`;
    if (from !== to && !entries.includes(entry)) entries.push(entry);
  }
  return entries.length ? `Name corrections: ${entries.join('; ')}` : '';
}

/** The request's target, from the usual phrasing "a synthesis of <name> (SMILES: <smiles>)".
 *  A SMILES named after "from", "starting" or "using" is a starting material, not the target,
 *  so the match stops there rather than guess. */
// The target named after "synthesis of/for … SMILES:". The name may wrap, so the run before
// SMILES crosses newlines; it stops at a "from/starting/using/with" clause so it never wanders
// into the starting materials.
const TARGET_PATTERN = /\bsynthes[a-z]*\s+(?:of|for)\b(?:(?!\b(?:from|starting|using|with)\b)[\s\S]){0,160}?\bSMILES\s*[:=]\s*`?([^\s`,;]+)/i;

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
/** The per-step chip starts differently from the all/backwards chips; keep the lead stable so
 *  every generated correction is recognisable. */
export const ROUTE_FIX_STEP_LEAD = 'Correction needed for step ';
export const ROUTE_CLARIFICATION_LEAD = 'The species names in the synthesis route above do not match the prose, or the prose is ambiguous, and the correction could not be resolved automatically. Please confirm the intended chemistry.';
export const ROUTE_UNRESOLVED_LEAD = 'The application could not resolve some species names to structures, so those steps could not be built. For each unresolved species give its correct systematic IUPAC name, or — when you cannot name it — its isomeric SMILES (write it as its name followed by the SMILES in backticks).';
export const ROUTE_MISSING_SPECIES_LEAD = 'The synthesis route describes steps but does not list the species under the four required labels, so the application could not check or draw it.';

/** Whether a user message is a correction the application generated (a route-fix chip or a
 *  clarification), not a fresh research request. A correction answers the route checker: it
 *  carries no target of its own and needs no citation. */
export function isRouteFixPrompt(text: string): boolean {
  const trimmed = typeof text === 'string' ? text.trimStart() : '';
  return trimmed.startsWith(ROUTE_FIX_PROMPT_LEAD)
    || trimmed.startsWith(ROUTE_FIX_STEP_LEAD)
    || trimmed.startsWith(ROUTE_CLARIFICATION_LEAD)
    || trimmed.startsWith(ROUTE_UNRESOLVED_LEAD)
    || trimmed.startsWith(ROUTE_MISSING_SPECIES_LEAD);
}

/** The target of the conversation's current synthesis request. A correction carries no target
 *  of its own, so every generated correction is skipped and the original request is used. */
export function requestedTargetFor(userMessages: string[]): string | null {
  for (let index = userMessages.length - 1; index >= 0; index--) {
    if (isRouteFixPrompt(userMessages[index])) continue;
    return findRequestedTarget(userMessages[index]);
  }
  return null;
}

const RACEMIC_PATTERN = /\bracemic\b|\bracemate\b|\bracemi[cs]\b|\bmeso\b|\bachiral\b|\bnot\s+stereodefined\b|\bnot\s+stereo(?:chemically\s+)?(?:defined|specified|assigned)\b|\bstereo(?:chemistry)?\s+(?:is\s+)?not\s+(?:controlled|defined|specified|assigned)\b|\b(?:mixture|pair)\s+of\s+(?:enantiomers|diastereomers)\b|\bunassigned\s+stereo(?:centres?|centers?|chemistry)?\b/i;

/** Whether the answer declares a stereochemically open outcome. The model may state it in
 *  several ways — a racemate, a meso/achiral product, or "stereochemistry not controlled" —
 *  and each is a stated outcome, so the route audit reports the open centre as declared
 *  instead of refusing the step for leaving it unspecified. This is model prose, not a
 *  verification. */
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
    ...(typeof value.coefficient === 'number' && Number.isInteger(value.coefficient) && value.coefficient > 0 ? { coefficient: value.coefficient } : {}),
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
    ...(typeof value.assemblyProblem === 'string' && value.assemblyProblem ? { assemblyProblem: value.assemblyProblem.slice(0, 400) } : {}),
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
  const label = name ? `${name} (${identity})` : identity;
  // The solved coefficient is shown when it is not 1, so an equation that only balances at an
  // odd stoichiometry is visible rather than hidden behind a bare "+".
  return entry.coefficient && entry.coefficient > 1 ? `${entry.coefficient} ${label}` : label;
}).join(' + ');

/** A lookup from a declared SMILES to the IUPAC name the author wrote beside it. The
 *  authoring labels carry the name and the exact token; the audit species carries the
 *  canonical form, so both are keyed. */
export function routeLabelNames(labels: RouteSpeciesLabel[][]): Map<string, string> {
  const names = new Map<string, string>();
  for (const step of labels) for (const label of step) if (label.name) names.set(label.smiles, label.name);
  return names;
}

// ---------------------------------------------------------------- route review (model)

/** A route-plan problem a balance checker cannot see: prose that does not describe the named
 *  step, a product that is a different compound from the target, an impossible step, or a
 *  redundant one. `step` is 1-based, or 0 for a route-level problem. */
export interface RouteReviewProblem {
  step: number;
  /** `blocking` only for a named structure that is wrong for the step; everything else —
   *  feasibility, conditions, mechanism, an unusual reaction — is `advisory` and never blocks
   *  a route the deterministic checker passed. An omitted or unreadable severity is advisory. */
  severity: 'blocking' | 'advisory';
  detail: string;
}

/** The review findings that block a route: the named structure is wrong for the step. */
export function blockingReviewProblems(review: RouteReview | null): RouteReviewProblem[] {
  return review?.status === 'problems' ? review.problems.filter((problem) => problem.severity === 'blocking') : [];
}

/** The review findings that are shown but never block: a model judgement about feasibility. */
export function advisoryReviewProblems(review: RouteReview | null): RouteReviewProblem[] {
  return review?.status === 'problems' ? review.problems.filter((problem) => problem.severity === 'advisory') : [];
}

/** The outcome of the route review. A `null` return means the review could not be read, which
 *  is never treated as a problem. */
export interface RouteReview {
  status: 'ok' | 'problems';
  problems: RouteReviewProblem[];
}

export const ROUTE_REVIEW_SYSTEM = [
  'You review a proposed multi-step synthesis for problems that a balance checker cannot see. Every equation may balance and every intermediate may carry over, yet the plan can still be wrong.',
  'You are given the researcher\'s request, the requested target, each step\'s own description of its transformation, and the species its author named.',
  'Each step carries its author\'s description (a heading such as "Dehydration of citric acid to aconitic acid" and the prose under it). Use it: a named, standard reaction — dehydration, decarboxylation, hydration, esterification, hydrolysis, reduction, oxidation, condensation, Mannich, Michael addition — is a possible step. Report a step only when the species named cannot come from the transformation described, never merely because the reaction is uncommon, advanced, or not one you would have chosen.',
  'A cheminformatics toolkit has already verified that every equation balances and that every intermediate is carried over as the same structure. Never report a balance, stoichiometry or "cannot be written as one balanced equation" problem: that is the checker\'s job and it has passed. A step that forms several bonds or combines bond-forming events into one balanced net equation is allowed — a one-pot cascade such as the Robinson tropinone synthesis is one step — so do not report a step merely for merging or splitting transformations.',
  'Every structure below is a canonical isomeric SMILES, and so is the target. Two identical SMILES strings are the same compound; two different strings are different compounds. The checker has already compared each product to the target by canonical structure and reports in the request whether the target is formed — when it says the target is formed, do not report that step\'s product as a different compound from the target.',
  'Report only a specific, confident problem from this list, and set its "severity":',
  '- "blocking" when the named structure is wrong for the step: a product that is a different compound than the requested target; a product whose formula matches the intended one but whose connectivity or regiochemistry differs — a swapped substituent, or the wrong ring or epoxide regioisomer; a step whose prose describes a different transformation than the species named; or an atom-inconsistent or impossible byproduct. These are the mistakes the balance checker cannot see, so they stop the route.',
  '- "advisory" for everything else — a step you doubt can give the named product under the stated conditions (the wrong reagent for the transformation, an unusual or advanced route, feasibility, conditions, yield or mechanism), a one-pot cascade, a named reaction you would not have chosen, or a redundant or pointless step. An advisory finding is shown to the reader but never blocks the route.',
  'Be conservative. Never invent a compound, reaction or mechanism, and never report a step that is merely unusual but chemically possible. Do not repeat an equation or continuity problem the checker already found.',
  'Return EXCLUSIVELY one JSON object: {"status":"ok"} when there is no such problem, or {"status":"problems","problems":[{"step":<1-based step number, or 0 for a route-level problem>,"severity":"blocking"|"advisory","detail":"<one sentence>"}]}. A problem with no severity is treated as advisory. Do not write anything outside the JSON.',
].join('\n');

export function buildRouteReviewRequest(question: string, labels: RouteSpeciesLabel[][], audit: RouteAudit, stepProse: string[] = []): string {
  return [
    'The researcher asked:',
    question.trim().slice(0, 4000) || '(the request text is not available)',
    '',
    `The requested target is: ${audit.target?.canonicalSmiles ?? audit.target?.input ?? 'the product described in the request'}`,
    '',
    'The proposed route, each step with its author\'s description and the species as systematic names — isomeric SMILES:',
    ...audit.steps.map((step) => {
      const prose = stepProse[step.index]?.trim();
      return [`Step ${step.index + 1}:`, ...(prose ? [`  ${prose}`] : []), labelledStepLines(labels, step)].join('\n');
    }),
    '',
    audit.blocked.length
      ? `The automatic checker already found: ${audit.blocked.join(' ')}`
      : 'The automatic checker found no equation or continuity problem.',
    '',
    'Report only the problems it cannot see. Return the JSON.',
  ].join('\n');
}

/** A finding is one sentence, so this only guards a runaway reply. Cut on a word boundary
 *  and mark the cut, so a long detail is never shown ending mid-word. */
const REVIEW_DETAIL_LIMIT = 1000;
export function clampReviewDetail(detail: string): string {
  const text = detail.trim();
  if (text.length <= REVIEW_DETAIL_LIMIT) return text;
  const cut = text.slice(0, REVIEW_DETAIL_LIMIT);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > 0 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

/** Parse the review defensively: an unreadable or inconsistent reply means "not checked",
 *  never a fabricated problem, so it never blocks a route. */
export function parseRouteReview(raw: string): RouteReview | null {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) return null;
  let value: unknown;
  try { value = JSON.parse(match[0]); } catch { return null; }
  const record = asRecord(value);
  if (!record) return null;
  if (record.status === 'ok') return { status: 'ok', problems: [] };
  if (record.status !== 'problems') return null;
  const problems = (Array.isArray(record.problems) ? record.problems : []).map((entry) => {
    const item = asRecord(entry);
    if (!item || typeof item.detail !== 'string' || !item.detail.trim()) return null;
    const step = Number.isInteger(item.step) ? Math.min(Math.max(item.step as number, 0), 15) : 0;
    // Only an explicit "blocking" stops the route; a missing or unreadable severity is advisory.
    const severity: RouteReviewProblem['severity'] = item.severity === 'blocking' ? 'blocking' : 'advisory';
    return { step, severity, detail: clampReviewDetail(item.detail) };
  }).filter((entry): entry is RouteReviewProblem => entry !== null).slice(0, 24);
  if (!problems.length) return null;
  return { status: 'problems', problems };
}

function formatRouteReview(review: RouteReview): string[] {
  const blocking = blockingReviewProblems(review);
  const advisory = advisoryReviewProblems(review);
  const lines: string[] = [];
  if (blocking.length) {
    lines.push(
      '',
      '### Route review (model)',
      '',
      'A model reviewed the route plan and prose. A finding here marks the route not verified; it is a model judgement, not an RDKit result.',
      '',
      ...blocking.map((problem) => `- ${problem.step > 0 ? `Step ${problem.step}: ` : ''}${problem.detail}`),
    );
  }
  if (advisory.length) {
    lines.push(
      '',
      '### Route review (model, advisory)',
      '',
      'A model reviewed the route plan and prose. These are its judgements, not RDKit results; they are shown for you to weigh and do not stop a route the checker passed.',
      '',
      ...advisory.map((problem) => `- ${problem.step > 0 ? `Step ${problem.step}: ` : ''}${problem.detail}`),
    );
  }
  return lines;
}

/** The deterministic appendix a reader can act on: a one-line verdict, then per step balance
 *  and stereochemistry, then whether every intermediate is carried over as the same molecule.
 *  Generated by the application, so the model cannot claim a route was verified when it was
 *  not. A model route review is folded into the verdict and shown below when it found a plan
 *  problem the checker cannot see. When the answer named the species, the IUPAC names are
 *  shown beside the structures they denote. */
/** A coefficient above this is called out as a likely wrong byproduct set. Redox steps can
 *  legitimately reach the high single digits, so this is an advisory note, never a refusal. */
const LARGE_COEFFICIENT = 6;

export function formatRouteAudit(audit: RouteAudit, labels: RouteSpeciesLabel[][] = [], review: RouteReview | null = null): string {
  const names = routeLabelNames(labels);
  const lines: string[] = [
    '### Route check (RDKit)',
    '',
    'Every step was parsed with RDKit and every equation and intermediate link was checked. This block is generated by the application, not by the model.',
    '',
  ];
  const failing = (step: RouteStepAudit): boolean => !step.ok || step.balanced !== true || Boolean(step.assemblyProblem) || (step.nameProblems?.length ?? 0) > 0 || (step.unspecifiedStereocentres > 0 && step.racemic !== true);
  const failedSteps = audit.steps.filter(failing).map((step) => step.index + 1);
  const assembled = audit.steps.filter((step) => Boolean(step.assemblyProblem)).map((step) => step.index + 1);
  const isolated = isolatedSteps(audit);
  const reviewProblems = blockingReviewProblems(review);
  const reasons: string[] = [];
  if (failedSteps.length) reasons.push(`${failedSteps.length} of ${audit.steps.length} step(s) do not pass (${failedSteps.map((index) => `step ${index}`).join(', ')})`);
  if (assembled.length) reasons.push(`${assembled.length === 1 ? 'a step' : 'steps'} cannot be assembled from a single substrate molecule (${assembled.map((index) => `step ${index}`).join(', ')})`);
  if (isolated.length) reasons.push(`${isolated.length} step(s) are disconnected from the rest of the route`);
  if (audit.target?.reason === 'not-formed') reasons.push('no step forms the requested target');
  else if (audit.target?.reason === 'stereo-mismatch') reasons.push('the target is formed only with the wrong stereochemistry');
  if (reviewProblems.length) reasons.push(`a route review raised ${reviewProblems.length} problem(s)`);
  const verified = !reasons.length;
  lines.push(verified
    ? `**Route verified** — every equation balances and every intermediate is carried over${audit.target ? ', and the target is formed' : ''}.`
    : `**Route not verified** — ${reasons.join('; ')}.`);
  for (const step of audit.steps) {
    const label = `Step ${step.index + 1}`;
    if (!step.ok) { lines.push(`- ${label} FAIL — ${step.error ?? 'could not be parsed'}`); continue; }
    const racemic = step.racemic === true && step.unspecifiedStereocentres > 0;
    const nameFailure = (step.nameProblems?.length ?? 0) > 0;
    const assemblyFailure = Boolean(step.assemblyProblem);
    const verdict = !nameFailure && !assemblyFailure && step.balanced && (step.unspecifiedStereocentres === 0 || racemic) ? 'OK' : 'FAIL';
    const stereo = step.unspecifiedStereocentres
      ? racemic
        ? ', declared racemic (stereochemistry not controlled)'
        : `, ${step.unspecifiedStereocentres} unspecified stereocentre(s) or double bond(s)`
      : '';
    const balance = step.balanced ? 'balanced' : `NOT balanced (${step.differences.join('; ')})`;
    const nameNote = nameFailure ? ` name check failed: ${step.nameProblems!.join('; ')}.` : '';
    // A step can balance only by solving an odd stoichiometry (8 citric acid → 9 …); the numbers
    // are shown, and a large one is called out, because that usually means a byproduct is wrong.
    const largest = Math.max(1, ...[...step.reactants, ...step.agents, ...step.products].map((entry) => entry.coefficient ?? 1));
    const largeNote = step.balanced && !assemblyFailure && largest > LARGE_COEFFICIENT
      ? ` The equation balances only with large coefficients (up to ${largest}); a byproduct is likely missing or wrong.`
      : '';
    const assemblyNote = assemblyFailure ? ` ${step.assemblyProblem}.` : '';
    const agents = step.agents.length ? ` [agents: ${sideTrace(step.agents, names)}]` : '';
    lines.push(`- ${label} ${verdict} — ${balance}${stereo}.${nameNote}${largeNote}${assemblyNote} ${sideTrace(step.reactants, names)}${agents} → ${sideTrace(step.products, names)}`);
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
  if (review?.status === 'problems' && review.problems.length) lines.push(...formatRouteReview(review));
  const recap = [...audit.blocked];
  if (reviewProblems.length) recap.push(`The route review raised ${reviewProblems.length} problem(s).`);
  lines.push('', verified
    ? 'Route verified: every intermediate is carried over as the same structure.'
    : `Not verified: ${recap.join(' ')}`.trimEnd());
  return lines.join('\n');
}

/** One click on a blocked route: the button label and the correction request it sends as the
 *  user's next message. Rendered as a `nodus-route-fix` fence. */
export interface RouteFixChip {
  label: string;
  prompt: string;
}

const routeFixFence = (chip: RouteFixChip): string =>
  `\`\`\`nodus-route-fix\n${JSON.stringify(chip)}\n\`\`\``;

/** The names the author wrote under one role of one step, never the derived SMILES. */
function namedRoleNames(labels: RouteSpeciesLabel[][], index: number, role: RouteLabelRole, byproduct?: boolean): string {
  const entries = (labels[index] ?? []).filter((entry) => entry.role === role && (byproduct === undefined || entry.byproduct === byproduct));
  return entries.map((entry) => entry.name).filter(Boolean).join('; ') || 'none';
}

/** The four labelled lines of a step, names only. */
function namedStepLines(labels: RouteSpeciesLabel[][], index: number): string {
  return [
    `  Reactants: ${namedRoleNames(labels, index, 'reactant')}`,
    `  Products: ${namedRoleNames(labels, index, 'product', false)}`,
    `  Byproducts: ${namedRoleNames(labels, index, 'product', true)}`,
    `  Agents: ${namedRoleNames(labels, index, 'agent')}`,
  ].join('\n');
}

/** The four labelled lines with the resolved structure beside each name, for the route review:
 *  it needs the connectivity to judge regiochemistry, which the names alone do not give. */
function labelledStepLines(labels: RouteSpeciesLabel[][], step: RouteStepAudit): string {
  // Show the audit's canonical isomeric SMILES, not the raw resolved writing: the reference
  // services write the same compound differently, and the target is compared canonically, so
  // handing the review the raw string makes it read identical compounds as different.
  const canonical = new Map<string, string>();
  for (const species of [...step.reactants, ...step.agents, ...step.products]) {
    if (species.input && species.canonicalSmiles) canonical.set(species.input, species.canonicalSmiles);
  }
  const shown = (entry: RouteSpeciesLabel): string => {
    if (!entry.smiles) return entry.name;
    const smiles = entry.smiles.split('.').map((part) => canonical.get(part.trim()) ?? part.trim()).join('.');
    return `${entry.name} — \`${smiles}\``;
  };
  const side = (role: RouteLabelRole, byproduct?: boolean): string => {
    const entries = (labels[step.index] ?? []).filter((entry) => entry.role === role && (byproduct === undefined || entry.byproduct === byproduct));
    return entries.map(shown).filter(Boolean).join('; ') || 'none';
  };
  return [
    `  Reactants: ${side('reactant')}`,
    `  Products: ${side('product', false)}`,
    `  Byproducts: ${side('product', true)}`,
    `  Agents: ${side('agent')}`,
  ].join('\n');
}

/** Why a step's own equation needs correcting, or null when it passes on its own terms. */
function namedStepFailure(step: RouteStepAudit): string | null {
  if (step.nameProblems?.length) return step.nameProblems.join('; ');
  if (!step.ok) return step.error ?? 'could not be parsed';
  if (step.balanced !== true) return `not balanced (${step.differences.join('; ')})`;
  // A balanced step can still be impossible: the packing check refuses an equation that
  // assembles a product from more than one substrate. The report already shows this, so the
  // one-click prompts must name it too, or they point at a different step than the checker did.
  if (step.assemblyProblem) return step.assemblyProblem;
  if (step.unspecifiedStereocentres > 0 && step.racemic !== true) return `${step.unspecifiedStereocentres} unspecified stereocentre(s) or double bond(s) — name the stereoisomer, or state in the prose that the outcome is racemic, that the product is meso or achiral, or that its stereochemistry is not controlled`;
  return null;
}

/** Every reason to offer a per-step fix for this step: its own failure, a disconnection, and
 *  any plan problem the model route review found in it. */
function namedStepReasons(step: RouteStepAudit, isolated: Set<number>, review: string[] = []): string[] {
  const reasons: string[] = [];
  const failure = namedStepFailure(step);
  if (failure) reasons.push(failure);
  if (isolated.has(step.index)) reasons.push('disconnected from the rest of the route — none of its species is made by an earlier step or used by a later one');
  for (const detail of review) reasons.push(`review: ${detail}`);
  return reasons;
}

const NAMES_ONLY_FORMAT = [
  '  Reactants: <systematic IUPAC name>; <systematic IUPAC name>',
  '  Products: <systematic IUPAC name>',
  '  Byproducts: <systematic IUPAC name>',
  '  Agents: <catalyst or solvent, or none>',
];

const NAMES_ONLY_RULES = [
  'Do not write SMILES, formulae or a reaction line — the application derives the structure and the balanced equation from your names, with one exception. Rules that resolve these failures:',
  '- If, and only if, you cannot give a systematic name a reference service will resolve — an exotic fused cage or a named literature intermediate — write that species as its name followed by its isomeric SMILES in backticks (`name — `SMILES``); the application uses the SMILES as the structure and checks it with RDKit. Give the name alone for every species a systematic name will resolve.',
  '- Keep every step that already passes exactly as it is, and never duplicate one. You may split a rejected step into consecutive steps. Combine two consecutive steps only when together they are one net transformation that balances as a single equation; never merge two distinct transformations. The route must still reach the requested target.',
  '- Keep the single target chemistry-plan block (kind "structure") for the requested target; re-emit it unchanged if it is missing. Never emit a chemistry-plan for a step.',
  '- Conserve every element and the total charge on both sides. A species that is short on one side is a missing reagent (Reactants) or byproduct (Products/Byproducts); list it by systematic IUPAC name.',
  '- List every species that is consumed or produced once per side, under one role only. A true catalyst or solvent goes under Agents; never list a species that takes no part.',
  '- Agents are true catalysts or solvents only. A species the step consumes is a Reactant, never an Agent, even when the prose calls it a catalyst or says it is derived from another reagent.',
  '- A multi-component step lists every consumed reactant and every byproduct it releases (a condensation often releases water, carbon dioxide, or both); name each of them.',
  '- Give every species you make its stereodescriptors. If an outcome is racemic or a centre is genuinely unspecified, say so in the prose; never drop a descriptor silently.',
  '- A metal that enters as a reagent leaves as its salt: name the metal-containing product or byproduct (for example sodium salicylate, sodium chloride).',
  '- Carry a species from one step into the next with the same systematic IUPAC name, including its stereodescriptors.',
  '- If a step cannot balance as one equation, split it into consecutive steps rather than merging transformations.',
];

/** The route-level problems: a step that connects to nothing, and a target no step forms. */
function namedRouteProblems(labels: RouteSpeciesLabel[][], audit: RouteAudit): string[] {
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
  return problems;
}

/** How the correction names the requested target: the route's own name for it when the audit
 *  matched one (a product whose canonical SMILES is the target), with the canonical SMILES as the
 *  authoritative anchor so the model cannot substitute a different compound. Empty with no target.
 */
function routeTargetDescriptor(audit: RouteAudit): string {
  const target = audit.target;
  if (!target) return '';
  const smiles = target.canonicalSmiles ?? target.input;
  const named = audit.steps
    .flatMap((step) => step.products)
    .find((product) => product.name && product.nameOk !== false && product.canonicalSmiles === target.canonicalSmiles);
  // The SMILES is the application's own anchor, not something to copy into the answer (the
  // surrounding prompt forbids SMILES), so label where it comes from.
  if (named?.name && smiles) return `${named.name}, canonical SMILES \`${smiles}\``;
  if (named?.name) return named.name;
  if (smiles && target.formula) return `canonical SMILES \`${smiles}\` (${target.formula})`;
  return smiles ? `canonical SMILES \`${smiles}\`` : '';
}

function namedFixPreamble(failures: string[], problems: string[], review: RouteReviewProblem[] = []): string[] {
  return [
    ROUTE_FIX_PROMPT_LEAD,
    '',
    ...(failures.length ? ['The route checker rejected these steps:', ...failures, ''] : []),
    ...(problems.length ? ['The route as a whole has these problems:', ...problems, ''] : []),
    ...(review.length ? ['A model review of the route plan also reported:', ...review.map((problem) => `- ${problem.step > 0 ? `Step ${problem.step}: ` : ''}${problem.detail}`), ''] : []),
  ];
}

/** A names-first route that was refused is offered as a small set of one-click corrections:
 *  fix all failed steps, work backwards from the target, or fix one flagged step on its own
 *  (with split/combine allowed). Each shows the species as IUPAC names only — never the
 *  derived SMILES, which the model did not write. Empty when nothing needs fixing. */
export function formatNamedRouteFixPrompts(labels: RouteSpeciesLabel[][], audit: RouteAudit, review: RouteReview | null = null): string {
  const problems = namedRouteProblems(labels, audit);
  const isolated = new Set(isolatedSteps(audit));
  const reviewProblems = blockingReviewProblems(review);
  const reviewByStep = new Map<number, string[]>();
  for (const problem of reviewProblems) {
    if (problem.step <= 0) continue;
    reviewByStep.set(problem.step, [...(reviewByStep.get(problem.step) ?? []), problem.detail]);
  }
  const flagged = audit.steps
    .map((step) => ({ step, reasons: namedStepReasons(step, isolated, reviewByStep.get(step.index + 1) ?? []) }))
    .filter((entry) => entry.reasons.length);
  const failures = flagged
    .filter((entry) => namedStepFailure(entry.step) !== null)
    .map((entry) => `- Step ${entry.step.index + 1}: ${namedStepFailure(entry.step)}\n${namedStepLines(labels, entry.step.index)}`);
  if (!flagged.length && !problems.length && !reviewProblems.length) return '';

  const target = routeTargetDescriptor(audit);
  const atTarget = target ? ` (${target})` : '';
  const chips: RouteFixChip[] = [];
  chips.push({
    label: 'Ask the model to fix the failed steps',
    prompt: [
      ...namedFixPreamble(failures, problems, reviewProblems),
      `Re-output the complete route, keeping the prose for each step. Keep every step that already passes exactly as it is; you may insert, remove, split or merge steps when that is what the failures require, as long as the route still reaches the requested target${atTarget}. Give every step as four labelled lines of systematic IUPAC names, names only:`,
      ...NAMES_ONLY_FORMAT,
      ...NAMES_ONLY_RULES,
    ].join('\n'),
  });
  chips.push({
    label: 'Fix from the target backwards',
    prompt: [
      ...namedFixPreamble(failures, problems, reviewProblems),
      `Work backwards from the final step. First make the last step name the requested target${atTarget} as a Product and balance it. Then move to the step before it and make its Products line name exactly the species the next step consumes as a Reactant, and balance it. Continue back to step 1, so every step's product is the next step's reactant (or a permitted starting material). Insert, remove, split or merge steps when that is what the failures require.`,
      'Give the complete route again, in order, as four labelled lines of systematic IUPAC names per step, names only:',
      ...NAMES_ONLY_FORMAT,
      ...NAMES_ONLY_RULES,
    ].join('\n'),
  });
  for (const entry of [...flagged].reverse()) {
    if (!entry.reasons.length) continue;
    const index = entry.step.index;
    const previous = index - 1;
    const next = index + 1;
    chips.push({
      label: `Fix step ${index + 1}`,
      prompt: [
        `${ROUTE_FIX_STEP_LEAD}${index + 1} of the synthesis route above.`,
        '',
        `Step ${index + 1} was rejected: ${entry.reasons.join('; ')}`,
        namedStepLines(labels, index),
        '',
        'For context:',
        previous >= 0
          ? `  Step ${previous + 1} Products: ${namedRoleNames(labels, previous, 'product', false)}; Byproducts: ${namedRoleNames(labels, previous, 'product', true)}`
          : '  It is the first step.',
        next < audit.steps.length
          ? `  Step ${next + 1} Reactants: ${namedRoleNames(labels, next, 'reactant')}`
          : `  It is the last step, so its Products must include the requested target${atTarget}.`,
        '',
        `Re-output the complete route, keeping every other step exactly as it is, and correcting only step ${index + 1}. You may split step ${index + 1} into consecutive steps, or combine it with an adjacent step when together they are one net transformation that balances as a single equation — combining folds the neighbour into step ${index + 1}, so its line disappears. Give every step as four labelled lines of systematic IUPAC names, names only:`,
        ...NAMES_ONLY_FORMAT,
        ...NAMES_ONLY_RULES,
      ].join('\n'),
    });
  }
  return chips.map(routeFixFence).join('\n\n');
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
  'Prefer a name a reference service holds — for example the systematic salt name `sodium but-1-yn-1-ide` rather than `sodium but-1-ynide`.',
  'If you cannot construct a name the reference services will resolve — an exotic fused polycycle, a cage, a named literature intermediate whose systematic name you cannot derive reliably — do not guess. Give the STRUCTURE instead: its isomeric SMILES. The application checks the structure with RDKit and, when PubChem holds it, reads its name back.',
  'Return EXCLUSIVELY one JSON object. For a name: {"names":[{"from":"the name I gave you","to":"the corrected systematic IUPAC name"}]}. For a structure you cannot name: {"names":[{"from":"the name I gave you","smiles":"the isomeric SMILES"}]}.',
  'Do not invent a name or a structure you are unsure of; a wrong structure is worse than a stated limitation.',
  'If you cannot name or describe a species at all, omit it from the array.',
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

/** A structure the model may hand back in place of a name: one line of isomeric SMILES, with no
 *  prose, markup or whitespace inside it. */
function isPlausibleStructure(value: string): boolean {
  return value.length >= 2 && value.length <= 2000 && /[A-Za-z]/.test(value) && !/[\s`<>{}"|]/.test(value);
}

/** One correction from the name-feedback loop: the model either fixes the name or, when it
 *  cannot name the species, supplies the structure instead. */
export interface NameFeedbackEntry {
  from: string;
  /** The corrected systematic name, or a structure (isomeric SMILES / PubChem CID). */
  to: string;
  kind: 'name' | 'structure';
}

export function parseNameFeedback(raw: string): NameFeedbackEntry[] {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) return [];
  let value: unknown;
  try { value = JSON.parse(match[0]); } catch { return []; }
  const record = asRecord(value);
  const list = Array.isArray(record?.names) ? record.names as unknown[] : [];
  return list.map((entry) => {
    const item = asRecord(entry);
    if (!item || typeof item.from !== 'string') return null;
    const from = item.from.trim().slice(0, 200);
    if (!from || !isPlausibleSpeciesName(from)) return null;
    if (typeof item.smiles === 'string' && item.smiles.trim()) {
      const smiles = item.smiles.trim().slice(0, 2000);
      if (isPlausibleStructure(smiles)) return { from, to: smiles, kind: 'structure' as const };
    }
    if (typeof item.to === 'string' && item.to.trim()) {
      const to = item.to.trim().slice(0, 200);
      if (to && isPlausibleSpeciesName(to)) return { from, to, kind: 'name' as const };
    }
    return null;
  }).filter((entry): entry is NameFeedbackEntry => entry !== null).slice(0, 48);
}

/** A short note naming the species the author supplied as structures because no reference
 *  would name them, so a checked route never hides that its structure came from the model. */
export function formatAuthorStructureNote(entries: string[]): string {
  const unique = [...new Set(entries.map((entry) => entry.trim()).filter(Boolean))];
  return unique.length ? `Author-supplied structures (no reference name was available): ${unique.join('; ')}` : '';
}

/** The escalation when a name cannot be resolved to a structure even after the feedback
 *  loop: name the species and why, so the user can confirm or correct it. */
export function formatUnresolvedNameClarification(unresolved: UnresolvedName[]): string {
  const lines = unresolved.map((entry) => `- Step ${entry.step} ${entry.byproduct ? 'byproduct' : entry.role} "${entry.name}"${entry.feedback ? `: ${entry.feedback}` : ''}`);
  const prompt = [
    ROUTE_UNRESOLVED_LEAD,
    '',
    'Unresolved species:',
    ...lines,
    '',
    'Reply with the corrected name for each species, or its isomeric SMILES when you cannot name it.',
  ].join('\n');
  return `\`\`\`nodus-route-fix\n${JSON.stringify({ label: 'Confirm the intended structure', prompt })}\n\`\`\``;
}

/** Offered when a route describes steps but lists no species under the four required labels, so
 *  nothing could be checked. One click asks the model to re-emit with the labelled lines. */
export function formatMissingSpeciesPrompt(): string {
  const prompt = [
    ROUTE_MISSING_SPECIES_LEAD,
    'Re-output the same route in the same order. Keep the prose for each step, and add exactly four lines after it:',
    'Reactants: <systematic IUPAC name>; <systematic IUPAC name>',
    'Products: <systematic IUPAC name>',
    'Byproducts: <systematic IUPAC name>',
    'Agents: <catalyst or solvent, or none>',
    'Give every species as a systematic IUPAC name only, separated by semicolons. Do not add SMILES or a reaction line.',
  ].join('\n');
  return `\`\`\`nodus-route-fix\n${JSON.stringify({ label: 'Ask the model to list the species', prompt })}\n\`\`\``;
}
