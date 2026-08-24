/**
 * Deterministic quality signals for every Deep Research variant.
 *
 * This is deliberately provider-free. It does not pretend to decide whether a
 * historical interpretation is true. It measures the properties the engine can
 * enforce reproducibly: grounding, source distribution, cross-source synthesis,
 * argumentative development and internal writing discipline. The same yardstick is
 * used while generating a report, in the reader, and by offline audits.
 */

export type DeepResearchQualityMode = 'academic' | 'study' | 'teaching' | 'genealogy' | 'client';

export interface DeepResearchQualitySource {
  /** Exact nodus:// URL, without the surrounding Markdown label. */
  citation: string;
  /** The underlying work/document/material, used to measure real diversity. */
  sourceId: string;
  /** Literal text/document evidence is stronger than a generated idea summary. */
  evidence: 'literal' | 'document' | 'synthesis';
}

export type DeepResearchQualityIssueCode =
  | 'thin'
  | 'uncited_paragraphs'
  | 'citation_stuffing'
  | 'low_source_diversity'
  | 'source_concentration'
  | 'missing_direct_evidence'
  | 'missing_cross_source_synthesis'
  | 'incomplete_objective_coverage'
  | 'weak_claim_coverage'
  | 'weak_analysis'
  | 'repetition'
  | 'high_support_repair_rate'
  | 'unverified_support'
  | 'internal_contradiction';

export interface DeepResearchSectionQuality {
  score: number;
  dimensions: {
    grounding: number;
    depth: number;
    diversity: number;
    synthesis: number;
    coherence: number;
  };
  metrics: {
    words: number;
    paragraphs: number;
    substantiveParagraphs: number;
    uncitedSubstantiveParagraphs: number;
    uncitedParagraphShare: number;
    citationMentions: number;
    uniqueCitations: number;
    citationsPerThousandWords: number;
    distinctSources: number;
    effectiveSources: number;
    topSourceShare: number;
    directEvidenceCitations: number;
    citedParagraphShare: number;
    citationsPerSubstantiveParagraph: number;
    crossSourceParagraphs: number;
    analyticalParagraphs: number;
    qualifiedParagraphs: number;
    keyClaimCoverage: number;
    repeatedParagraphPairs: number;
  };
  gates: {
    grounded: boolean;
    diverse: boolean;
    directEvidence: boolean;
    synthetic: boolean;
    developed: boolean;
  };
  issues: DeepResearchQualityIssueCode[];
}

export interface DeepResearchQualityAssessment {
  version: 1;
  score: number;
  grade: 'passes_thresholds' | 'strong' | 'needs_review' | 'weak';
  mode: DeepResearchQualityMode;
  sections: number;
  sectionsPassing: number;
  dimensions: DeepResearchSectionQuality['dimensions'];
  metrics: {
    words: number;
    citationMentions: number;
    uniqueCitations: number;
    distinctSources: number;
    effectiveSources: number;
    topSourceShare: number;
    directEvidenceCitations: number;
    crossSourceParagraphs: number;
    uncitedParagraphShare: number;
    /** Share of atomic brief questions whose meaningful terms occur in the report. */
    objectiveCoverage: number;
    objectiveRequirementsSupported: number;
    objectiveRequirementsPartial: number;
    objectiveRequirementsUnsupported: number;
    /** Share of checked sentence/source pairs that had to be narrowed or removed. */
    supportConcernRate: number;
    /** Lexically near-duplicate substantive paragraph pairs per substantive unit. */
    redundancyRate: number;
    supportUnverified: number;
    internalContradictions: number;
  };
  issues: DeepResearchQualityIssueCode[];
  sectionScores: { title: string; score: number; passing: boolean; issues: DeepResearchQualityIssueCode[] }[];
  /** A quality score is a reproducible signal, never a substitute for source review. */
  caveat: string;
}

export interface AssessDeepResearchSectionInput {
  markdown: string;
  mode: DeepResearchQualityMode;
  objective?: string;
  keyClaims?: string[];
  sources?: DeepResearchQualitySource[];
}

const LINK_RE = /\[[^\]\n]*\]\((nodus:\/\/(idea|work|passage|gap|contradiction|study|archive)\/[^)\s]+)\)/giu;
const WORD_RE = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const STOP_WORDS = new Set(
  ('a al algo ante bajo con contra cual cuál cuando cuándo de del desde donde dónde el ella en entre era es esa ese esta este fue ha hasta la las lo los más muy no o para pero por porque porqué que qué quien quién como cómo se si sin sobre son su sus un una y ya '
    + 'the a an and are as at be been but by for from has have how in into is it its no not of on or over that the their this to was were what when where which who why with').split(/\s+/),
);
const ANALYSIS_RE = /\b(?:porque|por tanto|por ello|implica|explica|deriva|conduce|permite|muestra|sugiere|revela|supone|consecuencia|mecanismo|causa|relaci[oó]n|en cambio|sin embargo|frente a|mientras que|therefore|because|implies|explains|suggests|reveals|consequence|mechanism|however|whereas)\b/iu;
const QUALIFIER_RE = /\b(?:parece|sugiere|probablemente|posiblemente|hasta donde|no permite|no basta|limitaci[oó]n|inciert|provisional|hip[oó]tesis|matiz|puede|podr[ií]a|appears|suggests|probably|possibly|cannot establish|limitation|uncertain|provisional|hypothesis|may|might)\b/iu;
const SYNTHESIS_RE = /\b(?:coincid\p{L}*|converg\p{L}*|diverg\p{L}*|contradic\p{L}*|debate\p{L}*|compar\p{L}*|frente a|en cambio|mientras que|por una parte|por otra|tanto .+ como|contradict\p{L}*|whereas|in contrast|both .+ and)\b/iu;

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function words(text: string): string[] {
  // Citation URLs contain UUIDs and path fragments that used to count as dozens of
  // fake words. That made a 690-word section appear to clear a 1,260-word depth
  // target simply because it cited many sources.
  return text.replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1').match(WORD_RE) ?? [];
}

function contentTerms(text: string): Set<string> {
  return new Set(
    words(text.toLocaleLowerCase())
      .filter((word) => word.length >= 4 && !STOP_WORDS.has(word)),
  );
}

function paragraphs(markdown: string): string[] {
  return markdown
    .replace(/^#{1,6}\s+.*$/gmu, '')
    .split(/\n\s*\n+/u)
    .map((paragraph) => paragraph.replace(/^\s*[-*+]\s+/gmu, '').trim())
    .filter(Boolean);
}

function citations(markdown: string): { citation: string; kind: string }[] {
  return [...markdown.matchAll(LINK_RE)].map((match) => ({ citation: match[1], kind: match[2].toLocaleLowerCase() }));
}

function effectiveCount(counts: number[]): number {
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;
  const entropy = counts.reduce((sum, value) => {
    const p = value / total;
    return p > 0 ? sum - p * Math.log(p) : sum;
  }, 0);
  return Math.exp(entropy);
}

function lexicalCoverage(text: string, targets: string[]): number {
  if (!targets.length) return 1;
  const haystack = contentTerms(text);
  const scores = targets.map((target) => {
    const terms = [...contentTerms(target)];
    if (!terms.length) return 1;
    return terms.filter((term) => haystack.has(term)).length / terms.length;
  });
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function repeatedParagraphPairs(items: string[]): number {
  const terms = items.map((item) => contentTerms(item));
  let repeated = 0;
  for (let left = 0; left < terms.length; left += 1) {
    for (let right = left + 1; right < terms.length; right += 1) {
      if (terms[left].size < 8 || terms[right].size < 8) continue;
      const overlap = [...terms[left]].filter((term) => terms[right].has(term)).length;
      const union = new Set([...terms[left], ...terms[right]]).size;
      if (union > 0 && overlap / union >= 0.72) repeated += 1;
    }
  }
  return repeated;
}

function sourceMap(sources: DeepResearchQualitySource[]): Map<string, DeepResearchQualitySource> {
  return new Map(sources.map((source) => [source.citation, source]));
}

export function assessDeepResearchSection(input: AssessDeepResearchSectionInput): DeepResearchSectionQuality {
  const allWords = words(input.markdown).length;
  const paras = paragraphs(input.markdown);
  // A unit is substantive because it carries a claim/evidence function, not because
  // it reaches an arbitrary number of words. The word count remains descriptive.
  const substantive = paras.filter((paragraph) => contentTerms(paragraph).size >= 10 || citations(paragraph).length > 0);
  const sourceByCitation = sourceMap(input.sources ?? []);
  const refs = citations(input.markdown);
  const uniqueCitations = new Set(refs.map((ref) => ref.citation));
  const availableSources = new Set((input.sources ?? []).map((source) => source.sourceId));
  const availableDirect = (input.sources ?? []).filter((source) => source.evidence !== 'synthesis').length;

  const countsBySource = new Map<string, number>();
  let directEvidenceCitations = 0;
  for (const ref of refs) {
    const mapped = sourceByCitation.get(ref.citation);
    const sourceId = mapped?.sourceId ?? ref.citation;
    countsBySource.set(sourceId, (countsBySource.get(sourceId) ?? 0) + 1);
    if (mapped ? mapped.evidence !== 'synthesis' : ref.kind === 'passage' || ref.kind === 'archive' || ref.kind === 'study') {
      directEvidenceCitations += 1;
    }
  }
  const sourceCounts = [...countsBySource.values()];
  const topSourceShare = refs.length ? Math.max(0, ...sourceCounts) / refs.length : 1;
  const distinctSources = countsBySource.size;
  const effectiveSources = effectiveCount(sourceCounts);
  const uncitedSubstantive = substantive.filter((paragraph) => citations(paragraph).length === 0).length;
  const uncitedShare = substantive.length ? uncitedSubstantive / substantive.length : allWords > 120 ? 1 : 0;
  const citedParagraphShare = substantive.length ? 1 - uncitedShare : 0;
  const citationsPerSubstantiveParagraph = refs.length / Math.max(1, substantive.length);
  const crossSourceParagraphs = substantive.filter((paragraph) => {
    const ids = new Set(citations(paragraph).map((ref) => sourceByCitation.get(ref.citation)?.sourceId ?? ref.citation));
    return ids.size >= 2 && SYNTHESIS_RE.test(paragraph);
  }).length;
  const analyticalParagraphs = substantive.filter((paragraph) => ANALYSIS_RE.test(paragraph)).length;
  const qualifiedParagraphs = substantive.filter((paragraph) => QUALIFIER_RE.test(paragraph)).length;
  const repeated = repeatedParagraphPairs(substantive);
  const claimTargets = [...(input.keyClaims ?? [])];
  if (input.objective?.trim()) claimTargets.push(input.objective);
  const keyClaimCoverage = lexicalCoverage(input.markdown, claimTargets);
  const citationsPerThousandWords = refs.length / Math.max(0.25, allWords / 1000);

  const grounding = 30 * (
    0.42 * citedParagraphShare
    + 0.2 * clamp(citationsPerSubstantiveParagraph / 1.25)
    + 0.18 * clamp(uniqueCitations.size / Math.max(1, Math.min(8, availableSources.size || uniqueCitations.size)))
    + 0.2 * (availableDirect > 0 ? clamp(directEvidenceCitations / Math.max(1, Math.min(availableDirect, claimTargets.length || 1))) : 1)
  );
  const depth = 25 * (
    0.38 * clamp(analyticalParagraphs / Math.max(1, substantive.length * 0.55))
    + 0.22 * clamp(qualifiedParagraphs / Math.max(1, substantive.length * 0.25))
    + 0.3 * clamp(keyClaimCoverage / 0.72)
    + 0.1 * (1 - clamp(repeated / Math.max(1, substantive.length - 1)))
  );
  const desiredSources = Math.max(1, Math.min(4, availableSources.size || distinctSources));
  const diversity = 20 * (
    0.5 * clamp(distinctSources / desiredSources)
    + 0.3 * clamp(effectiveSources / Math.max(1, Math.min(3.2, desiredSources)))
    + 0.2 * clamp((0.85 - topSourceShare) / 0.45)
  );
  const synthesis = 15 * (
    0.65 * (desiredSources >= 3 ? clamp(crossSourceParagraphs / Math.max(1, Math.floor(substantive.length / 3))) : 1)
    + 0.35 * clamp(substantive.filter((paragraph) => SYNTHESIS_RE.test(paragraph)).length / Math.max(1, substantive.length * 0.3))
  );
  const coherence = 10 * (
    0.45 * (1 - clamp(repeated / Math.max(1, substantive.length - 1)))
    + 0.35 * clamp(keyClaimCoverage / 0.72)
    + 0.2 * clamp(analyticalParagraphs / Math.max(1, substantive.length * 0.4))
  );
  let score = grounding + depth + diversity + synthesis + coherence;
  if (citationsPerSubstantiveParagraph > 5) score -= Math.min(10, (citationsPerSubstantiveParagraph - 5) * 2);

  const developed = keyClaimCoverage >= 0.5
    && analyticalParagraphs >= Math.max(1, Math.ceil(substantive.length * 0.35));
  const grounded = uncitedShare <= 0.2
    && citationsPerSubstantiveParagraph >= 0.65
    && citationsPerSubstantiveParagraph <= 5.5;
  const diverse = desiredSources < 3 || (distinctSources >= 3 && topSourceShare <= 0.65);
  const directEvidence = availableDirect === 0
    || directEvidenceCitations >= Math.max(1, Math.min(availableDirect, claimTargets.length || 1));
  const synthetic = desiredSources < 3 || crossSourceParagraphs >= 1;
  const issues: DeepResearchQualityIssueCode[] = [];
  if (!developed) issues.push('thin');
  if (uncitedShare > 0.2) issues.push('uncited_paragraphs');
  if (citationsPerSubstantiveParagraph > 5.5) issues.push('citation_stuffing');
  if (desiredSources >= 3 && distinctSources < 3) issues.push('low_source_diversity');
  if (desiredSources >= 3 && topSourceShare > 0.65) issues.push('source_concentration');
  if (!directEvidence) issues.push('missing_direct_evidence');
  if (!synthetic) issues.push('missing_cross_source_synthesis');
  if (keyClaimCoverage < 0.4) issues.push('weak_claim_coverage');
  if (substantive.length >= 3 && analyticalParagraphs / substantive.length < 0.4) issues.push('weak_analysis');
  if (repeated > 0) issues.push('repetition');

  // Hard-to-game penalties keep a citation catalogue from passing the quality
  // thresholds merely because every paragraph ends in several links.
  const penalties: Partial<Record<DeepResearchQualityIssueCode, number>> = {
    thin: 10,
    uncited_paragraphs: 9,
    citation_stuffing: 8,
    low_source_diversity: 8,
    source_concentration: 7,
    missing_direct_evidence: 8,
    missing_cross_source_synthesis: 7,
    weak_claim_coverage: 5,
    weak_analysis: 7,
    repetition: 5,
  };
  score -= issues.reduce((sum, issue) => sum + (penalties[issue] ?? 0), 0);

  return {
    score: round(clamp(score, 0, 100), 1),
    dimensions: {
      grounding: round(grounding, 1),
      depth: round(depth, 1),
      diversity: round(diversity, 1),
      synthesis: round(synthesis, 1),
      coherence: round(coherence, 1),
    },
    metrics: {
      words: allWords,
      paragraphs: paras.length,
      substantiveParagraphs: substantive.length,
      uncitedSubstantiveParagraphs: uncitedSubstantive,
      uncitedParagraphShare: round(uncitedShare),
      citationMentions: refs.length,
      uniqueCitations: uniqueCitations.size,
      citationsPerThousandWords: round(citationsPerThousandWords),
      distinctSources,
      effectiveSources: round(effectiveSources),
      topSourceShare: round(topSourceShare),
      directEvidenceCitations,
      citedParagraphShare: round(citedParagraphShare),
      citationsPerSubstantiveParagraph: round(citationsPerSubstantiveParagraph),
      crossSourceParagraphs,
      analyticalParagraphs,
      qualifiedParagraphs,
      keyClaimCoverage: round(keyClaimCoverage),
      repeatedParagraphPairs: repeated,
    },
    gates: { grounded, diverse, directEvidence, synthetic, developed },
    issues,
  };
}

export function qualityPasses(assessment: DeepResearchSectionQuality): boolean {
  return Object.values(assessment.gates).every(Boolean) && assessment.score >= 72;
}

export function shouldAcceptQualityRevision(
  before: DeepResearchSectionQuality,
  after: DeepResearchSectionQuality,
  allowedCitationUrls: Set<string>,
  revisedMarkdown: string,
): boolean {
  const revisedCitations = citations(revisedMarkdown).map((citation) => citation.citation);
  const actualWords = words(revisedMarkdown).length;
  if (revisedCitations.some((citation) => !allowedCitationUrls.has(citation))) return false;
  if (Math.abs(actualWords - after.metrics.words) > 3) return false;
  if (after.metrics.citationMentions > Math.max(before.metrics.citationMentions + 8, before.metrics.citationMentions * 1.65)) return false;
  if (after.metrics.uncitedParagraphShare > before.metrics.uncitedParagraphShare + 0.08) return false;
  const beforeFailures = Object.values(before.gates).filter((value) => !value).length;
  const afterFailures = Object.values(after.gates).filter((value) => !value).length;
  const removedMeasuredIssue = after.issues.length < before.issues.length && after.score >= before.score - 0.5;
  return afterFailures < beforeFailures
    || removedMeasuredIssue
    || (afterFailures === beforeFailures && after.score >= before.score + 2);
}

/**
 * Safety boundary for a final line edit whose benefit is qualitative (flow,
 * precision, removal of repetition) and therefore may not raise a structural
 * score. A separate blind pairwise judge decides whether the edit is actually
 * better; this function only proves it did not buy polish by weakening evidence.
 */
export function shouldAcceptEditorialRevision(
  before: DeepResearchSectionQuality,
  after: DeepResearchSectionQuality,
  allowedCitationUrls: Set<string>,
  revisedMarkdown: string,
): boolean {
  const revisedCitations = citations(revisedMarkdown).map((citation) => citation.citation);
  if (revisedCitations.some((citation) => !allowedCitationUrls.has(citation))) return false;
  const actualWords = words(revisedMarkdown).length;
  if (Math.abs(actualWords - after.metrics.words) > 3) return false;
  if (!qualityPasses(after) || after.score < before.score - 5) return false;
  if (after.metrics.keyClaimCoverage + 0.08 < before.metrics.keyClaimCoverage) return false;
  if (after.metrics.uncitedParagraphShare > before.metrics.uncitedParagraphShare + 0.05) return false;
  if (after.metrics.citationMentions > Math.max(before.metrics.citationMentions + 6, before.metrics.citationMentions * 1.35)) return false;
  return true;
}

/**
 * A citation judge may leave a structurally strong section with unsupported or
 * only partially supported sentences. A repair is useful even when the numeric
 * score cannot rise further, but it still has to reduce those evidence concerns,
 * preserve depth and remain inside the exact citation menu.
 */
export function shouldAcceptEvidenceRepair(
  before: DeepResearchSectionQuality,
  after: DeepResearchSectionQuality,
  allowedCitationUrls: Set<string>,
  revisedMarkdown: string,
  concernsBefore: number,
  concernsAfter: number,
): boolean {
  if (concernsBefore <= 0) return false;
  const requiredReduction = Math.max(1, Math.ceil(concernsBefore * 0.2));
  if (concernsAfter > concernsBefore - requiredReduction) return false;
  const revisedCitations = citations(revisedMarkdown).map((citation) => citation.citation);
  if (revisedCitations.some((citation) => !allowedCitationUrls.has(citation))) return false;
  const actualWords = words(revisedMarkdown).length;
  if (Math.abs(actualWords - after.metrics.words) > 3) return false;
  if (!qualityPasses(after) || after.score < before.score - 5) return false;
  if (after.metrics.uncitedParagraphShare > before.metrics.uncitedParagraphShare + 0.05) return false;
  if (after.metrics.citationMentions > Math.max(before.metrics.citationMentions + 8, before.metrics.citationMentions * 1.5)) return false;
  return true;
}

export function assessDeepResearchReport(input: {
  mode: DeepResearchQualityMode;
  sections: { title: string; markdown: string; keyClaims?: string[]; sources?: DeepResearchQualitySource[] }[];
  objective?: string;
  coverageQuestions?: string[];
  coverageEvidence?: Array<{
    question: string;
    status: 'supported' | 'partial' | 'unsupported';
    evidenceTokens: string[];
  }>;
  verification?: { checked: number; partial: number; unsupported: number; unverified?: number } | null;
  internalContradictions?: number;
}): DeepResearchQualityAssessment {
  const assessed = input.sections.map((section) => ({
    title: section.title,
    quality: assessDeepResearchSection({
      markdown: section.markdown,
      mode: input.mode,
      objective: input.objective,
      keyClaims: section.keyClaims,
      sources: section.sources,
    }),
  }));
  const totalWords = assessed.reduce((sum, row) => sum + row.quality.metrics.words, 0);
  const weighted = (pick: (quality: DeepResearchSectionQuality) => number): number => {
    if (!assessed.length) return 0;
    return assessed.reduce((sum, row) => sum + pick(row.quality), 0) / assessed.length;
  };
  const sourceCounts = new Map<string, number>();
  for (const section of input.sections) {
    const mapping = sourceMap(section.sources ?? []);
    for (const ref of citations(section.markdown)) {
      const id = mapping.get(ref.citation)?.sourceId ?? ref.citation;
      sourceCounts.set(id, (sourceCounts.get(id) ?? 0) + 1);
    }
  }
  const counts = [...sourceCounts.values()];
  const totalCitations = counts.reduce((sum, value) => sum + value, 0);
  const reportText = input.sections.map((section) => section.markdown).join('\n\n');
  const reportSubstantiveParagraphs = paragraphs(reportText)
    .filter((paragraph) => contentTerms(paragraph).size >= 10 || citations(paragraph).length > 0);
  const redundancyRate = clamp(
    repeatedParagraphPairs(reportSubstantiveParagraphs) / Math.max(1, reportSubstantiveParagraphs.length),
  );
  const coverageQuestions = (input.coverageQuestions ?? []).filter((question) => question.trim().length > 0);
  const coverageByQuestion = new Map((input.coverageEvidence ?? []).map((row) => [row.question, row]));
  const requirementScores = coverageQuestions.map((question) => {
    const row = coverageByQuestion.get(question);
    if (row) {
      const evidenceSurvived = row.evidenceTokens.some((token) => {
        const url = token.match(/\]\((nodus:\/\/[^)]+)\)/u)?.[1];
        return Boolean(url && reportText.includes(`(${url})`));
      });
      if (!evidenceSurvived) return { status: 'unsupported' as const, score: 0 };
      if (row.status === 'supported') return { status: 'supported' as const, score: 1 };
      if (row.status === 'partial') return { status: 'partial' as const, score: 0.5 };
      return { status: 'unsupported' as const, score: 0 };
    }
    // Non-academic/specialized pipelines may not expose an epistemic matrix yet.
    // Their deterministic fallback is stricter than the former whole-report token
    // check: one cited paragraph must itself address the question.
    const addressed = paragraphs(reportText).some((paragraph) =>
      citations(paragraph).length > 0 && lexicalCoverage(paragraph, [question]) >= 0.42
    );
    return { status: addressed ? 'supported' as const : 'unsupported' as const, score: addressed ? 1 : 0 };
  });
  const objectiveCoverage = coverageQuestions.length
    ? requirementScores.reduce((sum, row) => sum + row.score, 0) / coverageQuestions.length
    : 1;
  const objectiveRequirementsSupported = requirementScores.filter((row) => row.status === 'supported').length;
  const objectiveRequirementsPartial = requirementScores.filter((row) => row.status === 'partial').length;
  const objectiveRequirementsUnsupported = requirementScores.filter((row) => row.status === 'unsupported').length;
  let score = round(weighted((quality) => quality.score), 1);
  if (objectiveCoverage < 1) score = round(Math.max(0, score - (1 - objectiveCoverage) * 12), 1);
  const checked = Math.max(0, Number(input.verification?.checked ?? 0));
  const supportConcerns = Math.max(0, Number(input.verification?.partial ?? 0))
    + Math.max(0, Number(input.verification?.unsupported ?? 0));
  const supportConcernRate = checked > 0 ? clamp(supportConcerns / checked) : 0;
  const supportUnverified = Math.max(0, Number(input.verification?.unverified ?? 0));
  const internalContradictions = Math.max(0, Number(input.internalContradictions ?? 0));
  if (supportConcernRate > 0.05) score = round(Math.max(0, score - (supportConcernRate - 0.05) * 25), 1);
  if (supportUnverified > 0) score = round(Math.max(0, score - Math.min(15, 5 + supportUnverified)), 1);
  if (redundancyRate > 0.15) score = round(Math.max(0, score - Math.min(12, (redundancyRate - 0.15) * 30)), 1);
  const sectionsPassing = assessed.filter((row) => qualityPasses(row.quality)).length;
  const issueSet = new Set(assessed.flatMap((row) => row.quality.issues));
  if (objectiveCoverage < 0.95) issueSet.add('incomplete_objective_coverage');
  if (supportConcernRate > 0.1) issueSet.add('high_support_repair_rate');
  if (supportUnverified > 0) issueSet.add('unverified_support');
  if (internalContradictions > 0) issueSet.add('internal_contradiction');
  if (redundancyRate > 0.15) issueSet.add('repetition');
  return {
    version: 1,
    score,
    grade: score >= 85 && sectionsPassing === assessed.length && objectiveCoverage >= 0.95
      && supportConcernRate <= 0.1 && supportUnverified === 0 && internalContradictions === 0 && redundancyRate <= 0.15
      ? 'passes_thresholds'
      : score >= 75
        ? 'strong'
        : score >= 60
          ? 'needs_review'
          : 'weak',
    mode: input.mode,
    sections: assessed.length,
    sectionsPassing,
    dimensions: {
      grounding: round(weighted((quality) => quality.dimensions.grounding), 1),
      depth: round(weighted((quality) => quality.dimensions.depth), 1),
      diversity: round(weighted((quality) => quality.dimensions.diversity), 1),
      synthesis: round(weighted((quality) => quality.dimensions.synthesis), 1),
      coherence: round(weighted((quality) => quality.dimensions.coherence), 1),
    },
    metrics: {
      words: totalWords,
      citationMentions: assessed.reduce((sum, row) => sum + row.quality.metrics.citationMentions, 0),
      uniqueCitations: new Set(input.sections.flatMap((section) => citations(section.markdown).map((ref) => ref.citation))).size,
      distinctSources: sourceCounts.size,
      effectiveSources: round(effectiveCount(counts)),
      topSourceShare: round(totalCitations ? Math.max(0, ...counts) / totalCitations : 1),
      directEvidenceCitations: assessed.reduce((sum, row) => sum + row.quality.metrics.directEvidenceCitations, 0),
      crossSourceParagraphs: assessed.reduce((sum, row) => sum + row.quality.metrics.crossSourceParagraphs, 0),
      uncitedParagraphShare: round(weighted((quality) => quality.metrics.uncitedParagraphShare)),
      objectiveCoverage: round(objectiveCoverage),
      objectiveRequirementsSupported,
      objectiveRequirementsPartial,
      objectiveRequirementsUnsupported,
      supportConcernRate: round(supportConcernRate),
      redundancyRate: round(redundancyRate),
      supportUnverified,
      internalContradictions,
    },
    issues: [...issueSet],
    sectionScores: assessed.map((row) => ({
      title: row.title,
      score: row.quality.score,
      passing: qualityPasses(row.quality),
      issues: row.quality.issues,
    })),
    caveat: 'Indicadores estructurales y de trazabilidad. No certifican por sí solos la verdad ni la calidad historiográfica de las fuentes.',
  };
}

export function citationUrls(markdown: string): Set<string> {
  return new Set(citations(markdown).map((citation) => citation.citation));
}
