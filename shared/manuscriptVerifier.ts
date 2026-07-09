import type {
  AppLanguage,
  ManuscriptClaimCheck,
  ManuscriptClaimSeverity,
  ManuscriptClaimStatus,
  ManuscriptEvidenceCandidate,
} from './types';

export interface ExtractedManuscriptClaim {
  id: string;
  excerpt: string;
  paragraphIndex: number;
  sentenceIndex: number;
  hasCitation: boolean;
  existingCitations: string[];
  ownContribution: boolean;
}

const DEFAULT_MAX_CLAIMS = 80;
const MIN_WORDS = 10;
const MAX_WORDS = 90;

const AUTHOR_CONTRIBUTION_PATTERNS = [
  /\b(en esta tesis|en este articulo|en este articulo|en este capitulo|mi argumento|mi tesis|propongo|argumento que|sostengo que|defiendo que|planteo que)\b/i,
  /\b(nuestra tesis|nuestro argumento|nuestro estudio|esta investigacion|este trabajo propone|este estudio propone)\b/i,
  /\b(this thesis|this article|this chapter|this paper|i argue|we argue|my argument|our argument|i propose|we propose|i contend|we contend)\b/i,
];

const CLAIM_VERB_PATTERNS = [
  /\b(muestra|demuestra|indica|sugiere|senala|sostiene|argumenta|afirma|revela|constituye|produce|genera|explica|depende|implica|permite|organiza|configura|refuerza|limita|transforma|desplaza|articula)\b/i,
  /\b(shows|demonstrates|indicates|suggests|argues|claims|reveals|constitutes|produces|generates|explains|depends|implies|enables|organizes|configures|reinforces|limits|transforms|displaces|articulates)\b/i,
  /\b(es|son|resulta|funciona como|opera como|se basa en|se vincula con|is|are|works as|operates as|is based on|is linked to)\b/i,
];

const NON_CLAIM_STARTS = [
  /^(por tanto|por consiguiente|sin embargo|ademas|asimismo|en primer lugar|en segundo lugar|finally|therefore|however|moreover|first|second),?\s*$/i,
  /^(tabla|figura|grafico|cuadro|table|figure)\s+\d+/i,
];

const CITATION_PATTERNS = [
  /nodus:\/\/(?:idea|work|gap|contradiction|passage)\/[^\s)"'<>]+/gi,
  /\[@[^\]]+\]/g,
  /\[[0-9]+(?:\s*,\s*[0-9]+)*(?:\s*[-–]\s*[0-9]+)?\]/g,
  /\b[A-ZÁÉÍÓÚÑ][A-Za-zÀ-ÿ'’.-]+(?:\s+(?:et\s+al\.?|and|y|&)\s+[A-ZÁÉÍÓÚÑ][A-Za-zÀ-ÿ'’.-]+)?\s+\((?:19|20)\d{2}[a-z]?(?:[:;,]\s*\d+(?:[-–]\d+)?)?\)/g,
  /\(\s*(?:cf\.?\s+|see\s+|véase\s+|vease\s+)?[A-ZÁÉÍÓÚÑ][A-Za-zÀ-ÿ'’.-]+(?:\s+(?:et\s+al\.?|and|y|&)\s+[A-ZÁÉÍÓÚÑ][A-Za-zÀ-ÿ'’.-]+)?(?:,\s*|\s+)(?:19|20)\d{2}[a-z]?(?:[:;,]\s*\d+(?:[-–]\d+)?)?\s*\)/g,
  /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/gi,
  /https?:\/\/(?:dx\.)?doi\.org\/[^\s)"'<>]+/gi,
];

const ABBREVIATIONS = [
  'art.',
  'cap.',
  'cf.',
  'dr.',
  'dra.',
  'ed.',
  'eds.',
  'e.g.',
  'etc.',
  'fig.',
  'i.e.',
  'mr.',
  'ms.',
  'p.',
  'pp.',
  'prof.',
  'sr.',
  'sra.',
  'vs.',
];

const STOPWORDS = new Set([
  'about',
  'after',
  'also',
  'ante',
  'bajo',
  'because',
  'been',
  'between',
  'cada',
  'como',
  'con',
  'contra',
  'cuando',
  'debe',
  'desde',
  'donde',
  'during',
  'entre',
  'esta',
  'este',
  'estos',
  'from',
  'have',
  'hacia',
  'into',
  'la',
  'las',
  'los',
  'mas',
  'more',
  'para',
  'pero',
  'por',
  'que',
  'se',
  'segun',
  'sin',
  'sobre',
  'that',
  'the',
  'their',
  'this',
  'through',
  'una',
  'under',
  'with',
  'without',
]);

export function extractManuscriptClaims(markdown: string, maxClaims = DEFAULT_MAX_CLAIMS): ExtractedManuscriptClaim[] {
  const paragraphs = normalizeMarkdown(markdown);
  const out: ExtractedManuscriptClaim[] = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    splitSentences(paragraph).forEach((sentence, sentenceIndex) => {
      const excerpt = cleanupSentence(sentence);
      if (!isLikelyClaim(excerpt)) return;
      const existingCitations = detectCitations(excerpt);
      out.push({
        id: `c-${paragraphIndex + 1}-${sentenceIndex + 1}`,
        excerpt,
        paragraphIndex,
        sentenceIndex,
        hasCitation: existingCitations.length > 0,
        existingCitations,
        ownContribution: looksLikeAuthorContribution(excerpt),
      });
    });
  });
  return out.slice(0, Math.max(1, maxClaims));
}

export function detectCitations(sentence: string): string[] {
  const matches: string[] = [];
  for (const pattern of CITATION_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sentence)) !== null) matches.push(match[0]);
  }
  return [...new Set(matches.map((m) => m.trim()).filter(Boolean))];
}

export function looksLikeAuthorContribution(sentence: string): boolean {
  const normalized = stripAccents(sentence).toLowerCase();
  return AUTHOR_CONTRIBUTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function tokenizeForMatch(text: string): string[] {
  return stripAccents(text)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/nodus:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

export function scoreLexicalMatch(query: string, target: string): number {
  const queryTokens = new Set(tokenizeForMatch(query));
  const targetTokens = new Set(tokenizeForMatch(target));
  if (queryTokens.size === 0 || targetTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of queryTokens) {
    if (targetTokens.has(token)) overlap += 1;
  }
  if (overlap === 0) return 0;
  const cosineLike = overlap / Math.sqrt(queryTokens.size * targetTokens.size);
  const queryCoverage = overlap / queryTokens.size;
  return Number(Math.min(1, cosineLike * 0.7 + queryCoverage * 0.3).toFixed(4));
}

export function classifyClaimLocally(input: {
  claim: ExtractedManuscriptClaim;
  evidence: ManuscriptEvidenceCandidate[];
  language?: AppLanguage;
}): ManuscriptClaimCheck {
  const language = input.language === 'en' ? 'en' : 'es';
  const evidence = pruneDistantCandidates(input.evidence);
  const top = evidence[0] ?? null;
  const strong = Boolean(top && (top.score >= 0.32 || (top.score >= 0.24 && evidence.length >= 2)));
  const direct = Boolean(top && top.score >= 0.2);
  let status: ManuscriptClaimStatus;
  let severity: ManuscriptClaimSeverity;
  let rationale: string;

  if (input.claim.hasCitation) {
    status = 'covered';
    severity = 'info';
    rationale =
      language === 'en'
        ? 'The sentence already contains a citation marker, so it is not flagged as missing.'
        : 'La frase ya contiene una marca de cita, por lo que no se marca como falta.';
  } else if (input.claim.ownContribution) {
    status = 'own_argument';
    severity = 'info';
    rationale =
      language === 'en'
        ? 'The wording frames this as the author’s own contribution.'
        : 'La formulacion presenta esto como aportacion propia del autor.';
  } else if (strong) {
    status = 'missing_citation';
    severity = top!.score >= 0.42 ? 'high' : 'medium';
    rationale =
      language === 'en'
        ? 'A close corpus match was found and the sentence has no citation marker.'
        : 'Hay una coincidencia cercana en el corpus y la frase no tiene marca de cita.';
  } else if (direct) {
    status = 'weak_match';
    severity = 'low';
    rationale =
      language === 'en'
        ? 'The corpus has related material, but the match is not strong enough to demand a citation.'
        : 'El corpus contiene material relacionado, pero la coincidencia no basta para exigir cita.';
  } else {
    status = 'own_argument';
    severity = 'info';
    rationale =
      language === 'en'
        ? 'No direct match was found in listed or indexed corpus ideas.'
        : 'No se encontro una coincidencia directa en ideas listadas o indexadas del corpus.';
  }

  return {
    id: input.claim.id,
    excerpt: input.claim.excerpt,
    paragraphIndex: input.claim.paragraphIndex,
    sentenceIndex: input.claim.sentenceIndex,
    hasCitation: input.claim.hasCitation,
    existingCitations: input.claim.existingCitations,
    status,
    severity,
    rationale,
    suggestedCitations: evidence,
    replacementHint: top ? citationHint(top) : null,
  };
}

/**
 * Keeps only citation candidates that are pertinent to the claim, dropping the
 * long tail of weak/off-topic matches that clutter the verifier. Candidates far
 * below the best match (relative gap) or below an absolute affinity floor are
 * removed, so the sentence is offered a short, ranked list instead of everything
 * the retrieval step happened to surface.
 */
export function pruneDistantCandidates(candidates: ManuscriptEvidenceCandidate[], limit = 4): ManuscriptEvidenceCandidate[] {
  const sorted = candidates.slice().sort((a, b) => b.score - a.score);
  if (sorted.length === 0) return sorted;
  const top = sorted[0].score;
  const floor = Math.max(0.24, top * 0.62);
  return sorted.filter((candidate, index) => index === 0 || candidate.score >= floor).slice(0, limit);
}

/**
 * Inserts `citationMarkdown` into `markdown` right before the terminal
 * punctuation of the sentence that matches `excerpt`. Matching tolerates
 * whitespace/newline differences between the verifier excerpt and the stored
 * draft. Returns `applied: false` when the sentence cannot be located or the
 * citation is already present there.
 */
export function insertCitationIntoDraft(
  markdown: string,
  excerpt: string,
  citationMarkdown: string
): { markdown: string; applied: boolean } {
  const citation = citationMarkdown.trim();
  if (!markdown || !excerpt.trim() || !citation) return { markdown, applied: false };
  const pattern = buildExcerptRegex(excerpt);
  if (!pattern) return { markdown, applied: false };
  const match = pattern.exec(markdown);
  if (!match) return { markdown, applied: false };
  const matched = match[0];
  if (matched.includes(citation)) return { markdown, applied: false };
  const end = match.index + matched.length;
  const tail = matched.match(/[.!?]+["'”’)\]]*\s*$/);
  const insertAt = tail ? end - tail[0].length : end;
  const needsSpace = insertAt > 0 && !/\s$/.test(markdown.slice(0, insertAt));
  const next = markdown.slice(0, insertAt) + (needsSpace ? ' ' : '') + citation + markdown.slice(insertAt);
  return { markdown: next, applied: true };
}

function buildExcerptRegex(excerpt: string): RegExp | null {
  const escaped = excerpt
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  if (!escaped) return null;
  try {
    return new RegExp(escaped);
  } catch {
    return null;
  }
}

export function summarizeChecks(checks: ManuscriptClaimCheck[], totalClaims = checks.length) {
  return {
    totalClaims,
    checkedClaims: checks.length,
    missingCitations: checks.filter((claim) => claim.status === 'missing_citation').length,
    covered: checks.filter((claim) => claim.status === 'covered').length,
    ownArguments: checks.filter((claim) => claim.status === 'own_argument').length,
    weakMatches: checks.filter((claim) => claim.status === 'weak_match').length,
    citedClaims: checks.filter((claim) => claim.hasCitation).length,
  };
}

function citationHint(candidate: ManuscriptEvidenceCandidate): string {
  return `[${candidate.label}](${candidate.citation})`;
}

function normalizeMarkdown(markdown: string): string[] {
  const withoutBlocks = markdown
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/~~~[\s\S]*?~~~/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '\n');
  return withoutBlocks
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .filter((line) => {
          const trimmed = line.trim();
          if (!trimmed) return false;
          if (/^#{1,6}\s/.test(trimmed)) return false;
          if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+$/.test(trimmed)) return false;
          return true;
        })
        .map((line) => line.replace(/^\s{0,3}[-*+]\s+/, '').replace(/^\s{0,3}\d+[.)]\s+/, '').trim())
        .join(' ')
    )
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function splitSentences(paragraph: string): string[] {
  let protectedText = paragraph;
  ABBREVIATIONS.forEach((abbr, index) => {
    const safe = abbr.replace(/\./g, '<dot>');
    protectedText = protectedText.replace(new RegExp(escapeRegExp(abbr), 'gi'), `__ABBR${index}_${safe}__`);
  });
  return protectedText
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡0-9])/u)
    .map((sentence) =>
      sentence.replace(/__ABBR(\d+)_([^_]+?)__/g, (_m, _index, value: string) => value.replace(/<dot>/g, '.'))
    )
    .map(cleanupSentence)
    .filter(Boolean);
}

function cleanupSentence(sentence: string): string {
  return sentence
    .replace(/\s+/g, ' ')
    .replace(/^[>"'“”‘’\s]+/, '')
    .replace(/[>"'“”‘’\s]+$/, '')
    .trim();
}

function isLikelyClaim(sentence: string): boolean {
  if (!sentence || sentence.endsWith('?') || sentence.endsWith('¿')) return false;
  if (NON_CLAIM_STARTS.some((pattern) => pattern.test(stripAccents(sentence).toLowerCase()))) return false;
  const words = sentence.split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS || words.length > MAX_WORDS) return false;
  if (/^(referencias|bibliografia|bibliography|references)$/i.test(stripAccents(sentence))) return false;
  return CLAIM_VERB_PATTERNS.some((pattern) => pattern.test(stripAccents(sentence).toLowerCase()));
}

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
