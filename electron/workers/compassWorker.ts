// SPDX-License-Identifier: AGPL-3.0-only
import { parentPort } from 'node:worker_threads';
import type { CompassFilters, CompassQueryPlan, CompassRecommendationReason, CompassResult } from '@shared/compass';
import { compassAuthorNameScore, normalizeCompassAuthorName } from '../compass/authorNames';

export type CompassWorkerOperation = 'rank' | 'persist-results' | 'read-results';
interface Request { operation: CompassWorkerOperation; storeFile?: string; args: unknown[]; }
function lexical(query: string, result: CompassResult): number {
  const terms = [...new Set(normalizeCompassAuthorName(query).split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1))];
  const haystack = normalizeCompassAuthorName(`${result.title} ${result.abstract ?? ''} ${result.authors.map((author) => author.name).join(' ')} ${result.topics.join(' ')}`);
  if (!terms.length) return 0;
  const title = normalizeCompassAuthorName(result.title);
  const words = haystack.split(/[^\p{L}\p{N}]+/u).filter(Boolean); const averageLength = 220; const lengthNorm = 1 - 0.75 + 0.75 * words.length / averageLength;
  const bm25 = terms.reduce((score, term) => { const frequency = words.reduce((count, word) => count + (word === term ? 1 : 0), 0); if (!frequency && !title.includes(term)) return score; const weighted = frequency + (title.includes(term) ? 2 : 0); return score + weighted * 2.2 / (weighted + 1.2 * lengthNorm); }, 0);
  return Math.min(1, bm25 / Math.max(1, terms.length));
}
function cosine(left: number[] | null | undefined, right: number[] | null | undefined): number | undefined {
  if (!left?.length || !right?.length || left.length !== right.length) return undefined;
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) { dot += left[index] * right[index]; leftNorm += left[index] ** 2; rightNorm += right[index] ** 2; }
  if (!leftNorm || !rightNorm) return undefined;
  return Math.max(0, Math.min(1, (dot / Math.sqrt(leftNorm * rightNorm) + 1) / 2));
}
function accepted(result: CompassResult, filters: CompassFilters): boolean {
  if ((filters.fromYear || filters.toYear) && !result.issuedYear) return false;
  if (filters.fromYear && result.issuedYear! < filters.fromYear) return false;
  if (filters.toYear && result.issuedYear! > filters.toYear) return false;
  if (filters.languages?.length && (!result.language || !filters.languages.some((language) => result.language!.toLowerCase().startsWith(language.toLowerCase())))) return false;
  if (filters.types?.length && !filters.types.includes(result.type)) return false;
  if (filters.disciplines?.length) { const values = [...result.disciplines, ...result.topics].map((value) => value.toLowerCase()); if (!filters.disciplines.some((discipline) => values.some((value) => value.includes(discipline.toLowerCase())))) return false; }
  if (filters.openAccessOnly && (!result.openAccess || ['closed', 'unknown'].includes(result.openAccess.status))) return false;
  return true;
}
function addReason(reasons: CompassRecommendationReason[], reason: CompassRecommendationReason): CompassRecommendationReason[] { return reasons.some((entry) => entry.code === reason.code && entry.value === reason.value) ? reasons : [...reasons, reason]; }
export function rankCompassResults(planOrQuery: CompassQueryPlan | string, records: CompassResult[], filters: CompassFilters, vectors: Array<number[] | null> = []): CompassResult[] {
  const query = typeof planOrQuery === 'string' ? planOrQuery : planOrQuery.text; const exactPhrases = typeof planOrQuery === 'string' ? [...planOrQuery.matchAll(/"([^"]+)"/g)].map((match) => match[1]) : planOrQuery.exactPhrases;
  const requestedAuthors = typeof planOrQuery === 'string' ? [] : planOrQuery.authors;
  const requestedOrcid = typeof planOrQuery === 'string' ? undefined : planOrQuery.identifiers.find((entry) => entry.scheme === 'orcid')?.value;
  const queryVector = vectors[0];
  const ranked = records.filter((record) => accepted(record, filters)).map((record, index) => {
    const nameScore = requestedAuthors.length ? Math.max(0, ...requestedAuthors.flatMap((requested) => record.authors.map((candidate) => compassAuthorNameScore(requested, candidate.name)))) : 0;
    const orcidScore = requestedOrcid && record.authors.some((author) => normalizeCompassAuthorName(author.orcid ?? '') === normalizeCompassAuthorName(requestedOrcid)) ? 1 : 0;
    const authorScore = Math.max(nameScore, orcidScore);
    const lexicalScore = lexical(query, record); const semanticScore = cosine(queryVector, vectors[index + 1]); const providerRanks = Object.values(record.providerRanks).filter((value): value is number => Number.isFinite(value)); const rrfScore = providerRanks.length ? Math.min(1, providerRanks.reduce((score, rank) => score + 1 / (60 + rank), 0) / (providerRanks.length / 61)) : record.nativeRank ? 61 / (60 + record.nativeRank) : 0; const haystack = normalizeCompassAuthorName(`${record.title} ${record.abstract ?? ''} ${record.authors.map((author) => author.name).join(' ')}`); const exactScore = exactPhrases.length ? exactPhrases.filter((phrase) => haystack.includes(normalizeCompassAuthorName(phrase))).length / exactPhrases.length : 0; let reasons = record.reasons;
    if (lexicalScore > 0) reasons = addReason(reasons, { code: 'matched-concept' });
    if (authorScore >= 0.84) reasons = addReason(reasons, { code: 'author-match', value: record.authors.find((author) => requestedAuthors.some((requested) => compassAuthorNameScore(requested, author.name) >= 0.84) || (requestedOrcid && normalizeCompassAuthorName(author.orcid ?? '') === normalizeCompassAuthorName(requestedOrcid)))?.name });
    if (semanticScore != null) reasons = addReason(reasons, { code: 'semantic-similarity', value: semanticScore.toFixed(3) });
    if (exactScore > 0) reasons = addReason(reasons, { code: 'phrase-match' });
    if (filters.languages?.length && record.language) reasons = addReason(reasons, { code: 'language-match', value: record.language });
    if (filters.types?.length) reasons = addReason(reasons, { code: 'type-match', value: record.type });
    if (filters.openAccessOnly && record.openAccess) reasons = addReason(reasons, { code: 'open-access', value: record.openAccess.status });
    const authorSearch = requestedAuthors.length > 0 || Boolean(requestedOrcid);
    const finalScore = authorSearch
      ? semanticScore == null
        ? 0.60 * authorScore + 0.20 * lexicalScore + 0.15 * rrfScore + 0.05 * exactScore
        : 0.55 * authorScore + 0.10 * semanticScore + 0.15 * lexicalScore + 0.15 * rrfScore + 0.05 * exactScore
      : semanticScore == null ? 0.55 * lexicalScore + 0.35 * rrfScore + 0.10 * exactScore : 0.45 * semanticScore + 0.30 * lexicalScore + 0.20 * rrfScore + 0.05 * exactScore;
    return { ...record, lexicalScore, semanticScore, rrfScore, exactScore, finalScore, reasons, authorScore };
  }).filter((record) => !(requestedAuthors.length || requestedOrcid) || Number(record.authorScore) >= 0.84).map(({ authorScore: _authorScore, ...record }) => record);
  const sort = filters.sort ?? 'relevance';
  return ranked.sort((left, right) => { const primary = sort === 'date' ? (right.issuedYear ?? -Infinity) - (left.issuedYear ?? -Infinity) : sort === 'citations' ? (right.citationCount ?? -Infinity) - (left.citationCount ?? -Infinity) : right.finalScore - left.finalScore; return primary || right.finalScore - left.finalScore || left.title.localeCompare(right.title) || left.canonicalKey.localeCompare(right.canonicalKey); });
}
async function execute(request: Request): Promise<unknown> {
  const args = request.args as any[];
  if (request.operation === 'rank') return rankCompassResults((args[0] && typeof args[0] === 'object' ? args[0] : String(args[0] ?? '')) as CompassQueryPlan | string, Array.isArray(args[1]) ? args[1] as CompassResult[] : [], (args[2] ?? {}) as CompassFilters, Array.isArray(args[3]) ? args[3] : []);
  // Ranking is deliberately dependency-free. Load persistence lazily so the
  // worker never imports Electron's main-process API for CPU-only work.
  const { CompassStore } = await import('../compass/compassStore');
  const store = new CompassStore(request.storeFile);
  try { if (request.operation === 'persist-results') { store.upsertResults(String(args[0]), Array.isArray(args[1]) ? args[1] : [], Number(args[2] ?? 0)); return true; } if (request.operation === 'read-results') return store.listResults(String(args[0]), Number(args[1] ?? 0), Number(args[2] ?? 25)); return null; } finally { store.close(); }
}
parentPort?.once('message', (request: Request) => { void execute(request).then((result) => parentPort!.postMessage({ ok: true, result })).catch((error) => parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })); });
