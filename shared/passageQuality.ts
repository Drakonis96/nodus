/**
 * What a library passage is, from its text alone: readable prose, a reaction scheme flattened
 * into text, a reference list, or a back-of-book index. Chemistry textbooks lose their schemes to
 * text extraction even with a clean text layer — "O O BN H CH2Br OH NO 2 PhCH2 O 7 g 5 mol% 0.7
 * eq BH3 -S(CH3)2 84%, 94% e.e." — and a model given that as evidence spent its reasoning trying
 * to decode it (deepseek-flash on the Robinson tropinone synthesis, citing Carey & Sundberg).
 * Deterministic and cheap, so it is computed where it is needed rather than stored.
 */

export type PassageKind = 'prose' | 'scheme' | 'references' | 'index';

/** A token that belongs to a drawn structure or a scheme's annotations, not to a sentence: an
 *  atom or group label (O, OH, CH2Br, PhCH2, OTBDMS, BH3, S(CH3)2), a charge, a number,
 *  a percentage, an equivalent or catalyst loading, an e.e., an entry letter. */
const SCHEME_TOKEN = new RegExp([
  String.raw`^[-–+]?(?:\(?(?:[A-Z][a-z]?\d*)+\)?\d*)+[-–+]?[,;]?$`,
  String.raw`^[-–]?\d+(?:[.,]\d+)?%?[,;]?$`,
  // The tail of a formula a subscript split off: "H 2NCH3" is H₂NCH₃.
  String.raw`^\d+(?:[A-Z][a-z]?\d*)+[,;]?$`,
  String.raw`^(?:equiv|eq|mol%|e\.e\.|ee|d\.r\.|dr|h|min|°C|rt|g|mg|mL|mmol|M|cat\.|[a-z]|[ivx]+|\d+[a-z]|[a-z]\d*)[,;.]?$`,
  String.raw`^[→⇌+=/\-–−:;,.()\[\]{}|]+$`,
].join('|'));

const tokensOf = (text: string): string[] => text.split(/\s+/).filter(Boolean);

function schemeShare(tokens: string[]): number {
  if (!tokens.length) return 0;
  return tokens.filter((token) => SCHEME_TOKEN.test(token)).length / tokens.length;
}

/** A back-of-book index or a numbered list of pages: mostly page numbers. */
function indexLike(tokens: string[]): boolean {
  return tokens.length > 0 && tokens.filter((token) => /\d/.test(token)).length / tokens.length > 0.25
    && schemeShare(tokens) < 0.6;
}

/** A reference list: author initials and journal volume–page–year citations, densely. */
function referenceLike(text: string, tokens: string[]): boolean {
  const citations = (text.match(/\b[A-Z][a-z]*\.?(?:\s[A-Z][a-z]*\.?)*,\s*\d{1,4},\s*\d{1,5}(?:[–-]\d+)?\s*\((?:19|20)\d{2}\)/g) ?? []).length
    + (text.match(/\b(?:J\.\s?Am\.\s?Chem\.\s?Soc|J\.\s?Org\.\s?Chem|Tetrahedron(?:\sLett)?|Org\.\s?Lett|Angew\.\s?Chem|Chem\.\s?Rev|Synthesis|Org\.\s?Synth)\b/g) ?? []).length;
  const initials = (text.match(/\b[A-Z]\.\s?(?:[A-Z]\.\s?)?[A-Z][a-z]+/g) ?? []).length;
  return citations >= 3 && (citations + initials) / Math.max(1, tokens.length) > 0.08;
}

export function passageKind(text: string): PassageKind {
  const tokens = tokensOf(text);
  if (!tokens.length) return 'prose';
  if (referenceLike(text, tokens)) return 'references';
  if (schemeShare(tokens) >= 0.55) return 'scheme';
  if (indexLike(tokens)) return 'index';
  return 'prose';
}

/** Runs of this many scheme tokens in a row are a flattened structure, not a formula in a
 *  sentence ("using PBr 3" or "Ph 3 P–Cl 2" are shorter and stay). */
const SCHEME_RUN = 6;

/** The passage with its flattened schemes cut out and marked "[scheme]", so the prose around a
 *  structure stays readable and the model is not asked to decode atom labels. */
export function stripSchemeRuns(text: string): string {
  const tokens = text.split(/(\s+)/);
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    const words = run.filter((part) => part.trim());
    if (words.length >= SCHEME_RUN) out.push(' [scheme] ');
    else out.push(...run);
    run = [];
  };
  for (const part of tokens) {
    if (!part.trim()) { (run.length ? run : out).push(part); continue; }
    if (SCHEME_TOKEN.test(part)) run.push(part);
    else { flush(); out.push(part); }
  }
  flush();
  // A few scheme tokens right beside a cut scheme belong to it ("+ H 2NCH3 [scheme]"): too short
  // to be a run of their own, but a label of the same drawing, not prose.
  const parts = out.join('').split(/(\s+)/);
  const marker = (index: number) => parts[index]?.trim() === '[scheme]';
  for (let index = 0; index < parts.length; index += 1) {
    if (!marker(index)) continue;
    for (const step of [-1, 1]) {
      let at = index + step, taken = 0;
      while (at >= 0 && at < parts.length && taken < 5) {
        if (!parts[at].trim()) { at += step; continue; }
        if (!SCHEME_TOKEN.test(parts[at]) || parts[at] === '[scheme]') break;
        parts[at] = '';
        taken += 1;
        at += step;
      }
    }
  }
  return parts.join('').replace(/\s*\[scheme\]\s*(?:\[scheme\]\s*)*/g, ' [scheme] ').replace(/\s{2,}/g, ' ').trim();
}

/** Passage kinds worth sending to a model as evidence. */
export function isEvidenceKind(kind: PassageKind): boolean {
  return kind === 'prose';
}

/** A literature citation: authors (initials + surname, "and", "et al."), a journal, volume,
 *  pages and year, optionally led by a footnote number, as Carey & Sundberg interleave them with
 *  the text. Chains joined by ";" are one run. */
const CITATION = new RegExp(String.raw`(?:\b\d{1,3}\s+)?(?:(?:[A-Z]\.\s?(?:-?[A-Z]\.\s?){0,3}(?:[a-z]{1,3}\s)?[A-Z][\w'’-]+|and|et al\.)[,\s]+)+[A-Z][\w.'’ &-]{1,60}?,\s*(?:\d+[A-Z]?,\s*)?\d+(?:[–-]\d+)?\s*\((?:19|20)\d{2}\)[.;,]?`, 'g');
/** The tail of a citation cut by the passage boundary ("102, 1201 (1980);"). */
const CITATION_TAIL = /(?:^|\s)\d+[A-Z]?,\s*\d+(?:[–-]\d+)?\s*\((?:19|20)\d{2}\)[.;,]?/g;
/** A running page header or chapter line left inside a passage ("635 SECTION 7.2 Reactions…"). */
const RUNNING_HEAD = /\b\d{1,4}\s+(?:CHAPTER|SECTION)\s+\d+(?:\.\d+)?\s+(?:[A-Z][\w,-]*\s){1,12}/g;

/** Readable words: lower-case runs of three letters or more (prose, not atom labels). */
const proseWords = (text: string): number => (text.match(/\b[a-z]{3,}\b/g) ?? []).length;

/** The passage as evidence: schemes, citations and running heads cut out, or null when too little
 *  readable prose is left (a scheme page, a reference page, an index). */
export function evidenceText(text: string, minWords = 30): string | null {
  // Control characters PDFs leave after superscript footnote numbers ("134\u0005") first.
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  const flat = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/g, ' ').replace(/\s+/g, ' ').trim();
  if (passageKind(flat) === 'index') return null;
  const cleaned = stripSchemeRuns(flat.replace(CITATION, ' [ref] ').replace(CITATION_TAIL, ' [ref] ').replace(RUNNING_HEAD, ' '))
    // Footnote numbers left between cut citations, and the "(1996)." year of a cut tail.
    .replace(/(?:\s*(?:\b\d{1,3}\s+)?\[ref\]\s*)+/g, ' [ref] ')
    .replace(/^\(\s*(?:19|20)\d{2}\)[.;,]?\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return proseWords(cleaned) >= minWords ? cleaned : null;
}
