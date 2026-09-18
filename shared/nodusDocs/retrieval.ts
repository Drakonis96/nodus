import type { PromptLanguage } from '../types';
import { NODUS_DOC_AREA_LABEL, docLanguage, type NodusDocArea, type NodusDocTopic } from './types';
import { NODUS_DOC_TOPICS } from './topics';

/** Retrieval for the product documentation.
 *
 *  Nodi is asked about one thing at a time, and the corpus documents the whole
 *  application, so the reply carries the sheets that answer the question plus the
 *  index of everything that exists. The scoring is deliberately plain and fully
 *  deterministic — it is asserted question by question in
 *  `scripts/test-nodus-docs.mjs` — because a documentation path nobody can test is
 *  a documentation path that quietly stops covering a section. */

const STOPWORDS = new Set([
  'a', 'al', 'algo', 'algun', 'alguna', 'algunas', 'alguno', 'algunos', 'ante', 'antes', 'aqui', 'asi',
  'como', 'con', 'contra', 'cual', 'cuales', 'cuando', 'cuanto', 'de', 'del', 'desde', 'donde', 'dos',
  'el', 'ella', 'ellas', 'ello', 'ellos', 'en', 'entre', 'era', 'es', 'esa', 'ese', 'eso', 'esos', 'esta',
  'estas', 'este', 'esto', 'estos', 'ha', 'hace', 'hacer', 'hacia', 'hasta', 'hay', 'la', 'las', 'le',
  'les', 'lo', 'los', 'me', 'mi', 'mis', 'mucho', 'muy', 'no', 'nos', 'o', 'otra', 'otro', 'para', 'pero',
  'poco', 'por', 'porque', 'que', 'quien', 'quienes', 'se', 'ser', 'si', 'sin', 'sobre', 'son', 'su', 'sus',
  'tal', 'tan', 'te', 'tengo', 'tiene', 'tienen', 'todo', 'todos', 'tu', 'tus', 'un', 'una', 'uno', 'unos',
  'y', 'ya', 'quiero', 'puedo', 'puede', 'deberia', 'debo', 'sirve', 'sirven', 'sale', 'salen', 'aparece',
  'sale', 'esta', 'estan', 'funciona', 'funcionan', 'hago', 'uso', 'usar', 'utiliza', 'utilizar', 'existe',
  'existen',
  'about', 'after', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before',
  'being', 'but', 'by', 'can', 'cannot', 'could', 'did', 'do', 'does', 'doing', 'done', 'down', 'each',
  'for', 'from', 'get', 'got', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'him', 'his',
  'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'me', 'more', 'most', 'my', 'need', 'no',
  'not', 'now', 'of', 'off', 'on', 'one', 'only', 'or', 'other', 'our', 'out', 'over', 'own', 'same',
  'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'those', 'through', 'to', 'too', 'under', 'up', 'use', 'used', 'using', 'very', 'was',
  'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'why', 'will', 'with', 'would', 'you',
  'your', 'works', 'work', 'make', 'made', 'see', 'show', 'find', 'want', 'please', 'tell', 'explain',
]);

export const foldDocText = (value: string): string =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Spanish and English inflections, longest suffix first. Applied to both sides — the
 *  index and the question — so `busco`, `buscar` and `búsqueda` meet at the same stem. */
const INFLECTIONS = ['aciones', 'acion', 'aciones', 'iendo', 'ando', 'ados', 'adas', 'ido', 'ada', 'ado',
  'amos', 'ais', 'eis', 'ar', 'er', 'ir', 'as', 'es', 'os', 'an', 'en', 'o', 'a', 'e', 's'];

function stem(token: string): string {
  if (token.length <= 3) return token;
  for (const suffix of INFLECTIONS) {
    if (token.length - suffix.length >= 3 && token.endsWith(suffix)) return token.slice(0, -suffix.length);
  }
  return token;
}

/** One token, folded and lightly stemmed. Kept in sync with the index build. */
function tokenize(value: string): string[] {
  const folded = foldDocText(value);
  return folded
    .split(/[^a-z0-9áéíóúüñ]+/i)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token) && !/^\d+$/.test(token))
    .map(stem)
    .filter((token) => token.length >= 3);
}

/** Two stems that start the same and stay close in length are the same word in another
 *  grammatical shape (`grab`/`grabacion`, `config`/`configuracion`). */
function sameFamily(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.length < 4 || right.length < 4) return false;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return longer.startsWith(shorter.slice(0, 5)) || longer.startsWith(shorter);
}

interface PreparedTopic {
  topic: NodusDocTopic;
  title: Set<string>;
  keywords: Set<string>;
  phrases: readonly string[];
  body: Set<string>;
  areaTokens: Set<string>;
}

const prepared: PreparedTopic[] = NODUS_DOC_TOPICS.map((topic) => {
  const keywordList = topic.keywords.map(foldDocText);
  const phrases = keywordList.filter((keyword) => keyword.trim().includes(' '));
  return {
    topic,
    title: new Set(tokenize(`${topic.title.es} ${topic.title.en}`)),
    keywords: new Set([...tokenize(`${topic.title.es} ${topic.title.en}`), ...topic.keywords.flatMap(tokenize)]),
    phrases,
    body: new Set(tokenize(`${topic.body.es} ${topic.body.en}`)),
    areaTokens: new Set(tokenize(`${NODUS_DOC_AREA_LABEL[topic.area].es} ${NODUS_DOC_AREA_LABEL[topic.area].en} ${topic.area}`)),
  };
});

/** How many sheets a token appears in. A word in every sheet (`nodus`, `seccion`)
 *  must not outrank the one word that names the thing being asked about. */
const documentFrequency = new Map<string, number>();
for (const entry of prepared) {
  for (const token of entry.keywords) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
}
const specificity = (token: string) => {
  const frequency = documentFrequency.get(token) ?? 0;
  return frequency ? 1 + Math.log(prepared.length / frequency) : 0;
};

const WEIGHT = { title: 6, keyword: 5, body: 1, area: 4, phrase: 8, related: 3 } as const;

/** 1 for the same stem, 0.6 for another shape of the same word, 0 for nothing. */
function familyScore(source: Set<string>, token: string): number {
  if (source.has(token)) return 1;
  for (const candidate of source) if (sameFamily(token, candidate)) return 0.6;
  return 0;
}

export interface NodusDocsSelection {
  /** Bodies of the selected sheets, budgeted, in reading order. */
  text: string;
  /** Ids whose body is in `text`. */
  ids: string[];
  /** Compact list of every sheet that exists, for the answer protocol. */
  index: string;
  /** Sheets that scored but did not fit; named so the model can ask for them. */
  alsoRelevant: string[];
}

/** Sheets every empty or unrecognised question still gets, so Nodi can always
 *  orient a lost user instead of answering from nothing. */
export const NODUS_DOC_ENTRY_POINTS = ['general-what-is-nodus', 'general-header', 'troubleshooting-index'] as const;

export const nodusDocTopic = (id: string): NodusDocTopic | undefined => NODUS_DOC_TOPICS.find((topic) => topic.id === id);

/** Rank every sheet for one question, best first. Exported for the recall test. */
export function rankNodusDocTopics(question: string, areaHint?: NodusDocArea): string[] {
  const tokens = [...new Set(tokenize(question))];
  const foldedQuestion = ` ${foldDocText(question).replace(/\s+/g, ' ')} `;
  const scores = new Map<string, number>();
  for (const entry of prepared) {
    let score = 0;
    for (const token of tokens) {
      const weight = specificity(token);
      score += WEIGHT.title * weight * familyScore(entry.title, token);
      score += WEIGHT.keyword * weight * familyScore(entry.keywords, token);
      score += WEIGHT.area * weight * familyScore(entry.areaTokens, token);
      score += WEIGHT.body * weight * familyScore(entry.body, token);
    }
    for (const phrase of entry.phrases) {
      if (foldedQuestion.includes(` ${phrase.replace(/\s+/g, ' ')} `)) score += WEIGHT.phrase;
    }
    if (areaHint && entry.topic.area === areaHint) score += 1;
    if (score > 0) scores.set(entry.topic.id, score);
  }
  const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([id]) => id);
  // One hop along `related` from the strongest matches, so a sheet that never
  // repeats the question's own words still arrives when its neighbour matched.
  const hop = ranked.slice(0, 3).flatMap((id) => nodusDocTopic(id)?.related ?? []);
  return [...ranked, ...hop.filter((id) => !ranked.includes(id) && nodusDocTopic(id))];
}

/** The compact list of everything documented. Every sheet appears exactly once. */
export function nodusDocsIndex(language: PromptLanguage = 'es'): string {
  const code = docLanguage(language);
  const byArea = new Map<NodusDocArea, string[]>();
  for (const topic of NODUS_DOC_TOPICS) {
    if (topic.area === 'protocol') continue;
    const short = topic.title[code].split(':')[0].trim();
    const list = byArea.get(topic.area) ?? [];
    list.push(`${topic.id} (${short})`);
    byArea.set(topic.area, list);
  }
  return [...byArea.entries()]
    .map(([area, entries]) => `- ${NODUS_DOC_AREA_LABEL[area][code]}: ${entries.join(' · ')}`)
    .join('\n');
}

/** Bodies for one question, inside `budget` characters. */
export function selectNodusDocs(options: { question: string; language?: PromptLanguage; budget?: number }): NodusDocsSelection {
  const language = options.language ?? 'es';
  const code = docLanguage(language);
  const budget = options.budget ?? 18_000;
  const ranked = rankNodusDocTopics(options.question);
  const ids = ranked.length ? [...ranked] : [...NODUS_DOC_ENTRY_POINTS];
  for (const entry of NODUS_DOC_ENTRY_POINTS) if (!ids.includes(entry)) ids.push(entry);
  const chunks: string[] = [];
  const chosen: string[] = [];
  const alsoRelevant: string[] = [];
  let used = 0;
  for (const id of ids) {
    const topic = nodusDocTopic(id);
    if (!topic) continue;
    const body = topic.body[code];
    const chunk = `### ${topic.title[code]} (id: ${topic.id})\n${body}`;
    if (used + chunk.length > budget && chosen.length) { alsoRelevant.push(id); continue; }
    chunks.push(chunk);
    chosen.push(id);
    used += chunk.length;
  }
  return { text: chunks.join('\n\n'), ids: chosen, index: nodusDocsIndex(language), alsoRelevant };
}
