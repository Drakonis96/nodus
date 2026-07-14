export type StudySearchKind = 'document' | 'material' | 'transcript' | 'question' | 'exam';
export type StudySearchSort = 'relevance' | 'date' | 'title';

export interface StudySearchScope {
  courseId: string | null;
  subjectId: string | null;
  topicId: string | null;
}

export interface StudySearchLocation {
  documentId?: string | null;
  materialId?: string | null;
  recordingId?: string | null;
  transcriptId?: string | null;
  pageNumber?: number | null;
  slideNumber?: number | null;
  timestampSeconds?: number | null;
  segmentId?: string | null;
  from?: number | null;
  to?: number | null;
}

export interface StudySearchIndexEntry {
  indexId: string;
  kind: StudySearchKind;
  sourceId: string;
  title: string;
  text: string;
  subtitle: string;
  tags: string[];
  scope: StudySearchScope;
  location: StudySearchLocation;
  createdAt: string;
  updatedAt: string;
  contentHash: string;
  embedding: number[] | null;
  excluded: boolean;
}

export interface StudySearchOptions {
  kinds?: StudySearchKind[];
  courseId?: string;
  subjectId?: string;
  topicId?: string;
  tags?: string[];
  dateFrom?: string;
  dateTo?: string;
  sourceId?: string;
  sort?: StudySearchSort;
  limit?: number;
}

export interface StudySearchScore {
  exact: number;
  text: number;
  semantic: number;
  proximity: number;
  fusion: number;
}

export interface StudySearchResult {
  indexId: string;
  kind: StudySearchKind;
  sourceId: string;
  title: string;
  subtitle: string;
  snippet: string;
  highlightedTerms: string[];
  tags: string[];
  scope: StudySearchScope;
  location: StudySearchLocation;
  createdAt: string;
  updatedAt: string;
  score: StudySearchScore;
}

export interface StudySearchResponse {
  results: StudySearchResult[];
  semanticAvailable: boolean;
  correctedQuery: string | null;
  suggestions: string[];
  elapsedMs: number;
}

export interface StudySearchIndexStatus {
  state: 'empty' | 'ready' | 'indexing' | 'paused' | 'error';
  indexedEntries: number;
  embeddedEntries: number;
  excludedSources: number;
  pendingEntries: number;
  modelProvider: string;
  modelName: string;
  updatedAt: string | null;
  error: string | null;
}

export interface StudySearchProgress extends StudySearchIndexStatus {
  processedEntries: number;
  totalEntries: number;
  currentTitle: string | null;
}

export interface StudySavedSearch {
  id: string;
  name: string;
  query: string;
  options: StudySearchOptions;
  createdAt: string;
  updatedAt: string;
}

export interface StudySearchHistoryEntry {
  id: string;
  query: string;
  options: StudySearchOptions;
  resultCount: number;
  createdAt: string;
}

const STOPWORDS = new Set(['a', 'al', 'de', 'del', 'el', 'en', 'es', 'la', 'las', 'lo', 'los', 'para', 'por', 'que', 'qué', 'se', 'un', 'una', 'y', 'where', 'what', 'the', 'of', 'in', 'is']);
const SYNONYMS: Record<string, string[]> = {
  diferencia: ['distinción', 'contraste'], comparar: ['diferencia', 'similitud', 'contraste'],
  causa: ['motivo', 'origen', 'factor'], consecuencia: ['efecto', 'resultado', 'impacto'],
  definir: ['definición', 'significado', 'concepto'], explicar: ['describir', 'aclarar', 'desarrollar'],
  ejemplo: ['caso', 'aplicación'], resumen: ['síntesis', 'recapitulación'],
};

export function normalizeStudySearchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function studySearchTokens(value: string, expandSynonyms = false): string[] {
  const base = normalizeStudySearchText(value).split(/\s+/).filter((token) => token.length > 1 && !STOPWORDS.has(token));
  const expanded = expandSynonyms ? base.flatMap((token) => [token, ...(SYNONYMS[token] ?? [])]) : base;
  return [...new Set(expanded.map(normalizeStudySearchText).filter(Boolean))];
}

export function cosineStudySearch(a: number[] | null | undefined, b: number[] | null | undefined): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0; let left = 0; let right = 0;
  for (let index = 0; index < a.length; index++) { dot += a[index] * b[index]; left += a[index] ** 2; right += b[index] ** 2; }
  return left && right ? Math.max(-1, Math.min(1, dot / Math.sqrt(left * right))) : 0;
}

function proximityScore(text: string, terms: string[]): number {
  if (terms.length < 2) return terms.length ? 1 : 0;
  const words = normalizeStudySearchText(text).split(' ');
  const positions = terms.map((term) => words.reduce<number[]>((all, word, index) => { if (word.includes(term)) all.push(index); return all; }, []));
  if (positions.some((list) => !list.length)) return 0;
  let span = Number.POSITIVE_INFINITY;
  const visit = (termIndex: number, chosen: number[]) => {
    if (termIndex === positions.length) { span = Math.min(span, Math.max(...chosen) - Math.min(...chosen)); return; }
    for (const position of positions[termIndex].slice(0, 12)) visit(termIndex + 1, [...chosen, position]);
  };
  visit(0, []);
  return Number.isFinite(span) ? 1 / (1 + span) : 0;
}

function snippetFor(text: string, terms: string[], max = 260): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const normalized = normalizeStudySearchText(clean);
  const first = terms.map((term) => normalized.indexOf(term)).filter((at) => at >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, first - Math.floor(max / 3));
  return `${start ? '…' : ''}${clean.slice(start, start + max).trim()}${start + max < clean.length ? '…' : ''}`;
}

function matchesOptions(entry: StudySearchIndexEntry, options: StudySearchOptions): boolean {
  if (entry.excluded) return false;
  if (options.kinds?.length && !options.kinds.includes(entry.kind)) return false;
  if (options.courseId && entry.scope.courseId !== options.courseId) return false;
  if (options.subjectId && entry.scope.subjectId !== options.subjectId) return false;
  if (options.topicId && entry.scope.topicId !== options.topicId) return false;
  if (options.sourceId && entry.sourceId !== options.sourceId) return false;
  if (options.tags?.length && !options.tags.every((tag) => entry.tags.some((entryTag) => normalizeStudySearchText(entryTag) === normalizeStudySearchText(tag)))) return false;
  if (options.dateFrom && entry.updatedAt < options.dateFrom) return false;
  if (options.dateTo && entry.updatedAt > `${options.dateTo}T23:59:59.999Z`) return false;
  return true;
}

export function rankStudySearchEntries(
  query: string,
  entries: StudySearchIndexEntry[],
  options: StudySearchOptions = {},
  queryEmbedding: number[] | null = null,
): StudySearchResult[] {
  const normalizedQuery = normalizeStudySearchText(query);
  const terms = studySearchTokens(query, true);
  const scored = entries.filter((entry) => matchesOptions(entry, options)).map((entry) => {
    const title = normalizeStudySearchText(entry.title); const text = normalizeStudySearchText(entry.text);
    const exact = normalizedQuery && (title.includes(normalizedQuery) || text.includes(normalizedQuery)) ? (title.includes(normalizedQuery) ? 1 : 0.82) : 0;
    const matches = terms.filter((term) => title.includes(term) || text.includes(term));
    const textScore = terms.length ? matches.length / terms.length * (matches.some((term) => title.includes(term)) ? 1 : 0.82) : 0;
    const semantic = Math.max(0, cosineStudySearch(queryEmbedding, entry.embedding));
    const proximity = proximityScore(`${entry.title} ${entry.text}`, terms.filter((term) => matches.includes(term)));
    return { entry, exact, text: textScore, semantic, proximity };
  }).filter((item) => item.exact > 0 || item.text > 0 || item.semantic >= 0.18);

  const ranks = (key: 'exact' | 'text' | 'semantic' | 'proximity') => new Map([...scored].sort((a, b) => b[key] - a[key]).map((item, index) => [item.entry.indexId, index + 1]));
  const rankMaps = { exact: ranks('exact'), text: ranks('text'), semantic: ranks('semantic'), proximity: ranks('proximity') };
  const results = scored.map((item) => {
    const rrf = (['exact', 'text', 'semantic', 'proximity'] as const).reduce((sum, key) => sum + (item[key] > 0 ? 1 / (60 + (rankMaps[key].get(item.entry.indexId) ?? scored.length)) : 0), 0);
    const fusion = item.exact * 0.33 + item.text * 0.29 + item.semantic * 0.28 + item.proximity * 0.1 + rrf * 2.5;
    return {
      indexId: item.entry.indexId, kind: item.entry.kind, sourceId: item.entry.sourceId, title: item.entry.title,
      subtitle: item.entry.subtitle, snippet: snippetFor(item.entry.text, terms), highlightedTerms: terms.filter((term) => normalizeStudySearchText(item.entry.text).includes(term)),
      tags: item.entry.tags, scope: item.entry.scope, location: item.entry.location, createdAt: item.entry.createdAt, updatedAt: item.entry.updatedAt,
      score: { exact: item.exact, text: item.text, semantic: item.semantic, proximity: item.proximity, fusion },
    } satisfies StudySearchResult;
  });
  const sort = options.sort ?? 'relevance';
  results.sort((a, b) => sort === 'date' ? b.updatedAt.localeCompare(a.updatedAt) : sort === 'title' ? a.title.localeCompare(b.title) : b.score.fusion - a.score.fusion);
  return results.slice(0, options.limit ?? 50);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const before = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1)); previous = before;
    }
  }
  return row[b.length];
}

export function suggestStudySearchCorrections(query: string, entries: StudySearchIndexEntry[]): string[] {
  const vocabulary = [...new Set(entries.flatMap((entry) => studySearchTokens(`${entry.title} ${entry.text}`)).filter((token) => token.length > 3))];
  return studySearchTokens(query).flatMap((token) => vocabulary
    .map((candidate) => ({ candidate, distance: editDistance(token, candidate) }))
    .filter((item) => item.distance > 0 && item.distance <= Math.max(token.length >= 6 ? 2 : 1, Math.floor(token.length / 4)))
    .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate)).slice(0, 2).map((item) => item.candidate)).slice(0, 5);
}
