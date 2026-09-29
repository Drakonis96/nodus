/** The library catalogue as Research Chat's agent reads it: who wrote what, and when.
 * A search index finds what a source says; only the catalogue finds a source by its
 * author. A user who names «Albuquerque García» means the works signed «Alburquerque
 * García, L.» too, so names match with accents folded and one slip of the pen allowed. */

export interface ResearchCatalogDocument {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
}

export interface ResearchCatalogQuery {
  author?: string;
  title?: string;
  keywords?: string;
  year?: number;
}

export interface ResearchCatalogHit {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  score: number;
}

const STOPWORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'lo', 'le', 'les', 'y', 'e', 'o', 'u', 'en', 'a', 'al', 'un', 'una', 'unos', 'unas',
  'por', 'para', 'con', 'sin', 'sobre', 'entre', 'the', 'of', 'and', 'in', 'on', 'for', 'to', 'an', 'des', 'du', 'et', 'aux', 'von', 'van', 'der', 'die',
  'das', 'und', 'da', 'do', 'dos', 'di', 'il', 'que', 'su', 'sus']);
/** Editors, translators and compilers are credited on a work without having written it. */
const SECONDARY_ROLE = /\((?:eds?|coords?|comps?|trads?|dirs?|ed\. lit|hrsg|trans|tr)\.?\)|\b(?:eds?|coords?|comps?|trads?|dirs?)\.\s*$/iu;

/** Lower case, accents off, punctuation to spaces. */
export function foldCatalogText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function words(text: string, keepShort = false): string[] {
  return [...new Set(foldCatalogText(text).split(' ').filter(word => word && (keepShort || (word.length >= 3 && !STOPWORDS.has(word)))))];
}

/** At most one insertion, deletion, substitution or swap of neighbouring letters. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diff: number[] = [];
    for (let i = 0; i < a.length && diff.length <= 2; i++) if (a[i] !== b[i]) diff.push(i);
    if (diff.length === 1) return true;
    return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  return short.slice(i) === long.slice(i + 1);
}

/** A typed word against a catalogued one: equal, one slip apart when both are long
 * enough to carry it, or an initial against the name it abbreviates. */
function sameWord(typed: string, catalogued: string): boolean {
  if (typed === catalogued) return true;
  if (typed.length >= 5 && catalogued.length >= 5) return withinOneEdit(typed, catalogued);
  if (catalogued.length === 1) return typed.startsWith(catalogued);
  if (typed.length === 1) return catalogued.startsWith(typed);
  return false;
}

/** How well a named person matches a work's credits: 1 for an author, ½ for an editor,
 * 0 when any typed name is missing. Every typed word must be found, so «Albuquerque
 * García» is not satisfied by «García Barrientos». */
function authorScore(typed: string[], credits: string[]): number {
  let best = 0;
  for (const credit of credits) {
    const names = words(credit.replace(SECONDARY_ROLE, ' '), true);
    if (!typed.every(word => names.some(name => sameWord(word, name)))) continue;
    best = Math.max(best, SECONDARY_ROLE.test(credit) ? 0.5 : 1);
  }
  return best;
}

/** Share of the typed words found in the text, or 0 below the required share. */
function wordShare(typed: string[], text: string, required: number): number {
  if (!typed.length) return 0;
  const found = words(text);
  const matched = typed.filter(word => found.some(candidate => sameWord(word, candidate))).length;
  return matched >= Math.max(1, Math.ceil(typed.length * required)) ? matched / typed.length : 0;
}

/** How much of a title is the topic itself. «Poética del relato de viajes» is about the genre;
 * «Medio siglo del libro de viaje fotográfico» shares as many words with a question on the genre
 * but is about something else. Titles mostly made of the topic's words rank first. */
function topicalShare(typed: string[], title: string): number {
  const found = words(title);
  if (!found.length) return 0;
  return found.filter(word => typed.some(candidate => sameWord(candidate, word))).length / found.length;
}

/** Works in the catalogue that answer every field asked for, best first. */
export function searchResearchCatalog(documents: readonly ResearchCatalogDocument[], query: ResearchCatalogQuery, limit = 12): ResearchCatalogHit[] {
  const author = query.author ? words(query.author, true).filter(word => !STOPWORDS.has(word)) : [];
  const title = query.title ? words(query.title) : [];
  const keywords = query.keywords ? words(query.keywords) : [];
  if (!author.length && !title.length && !keywords.length && query.year == null) return [];
  const hits: ResearchCatalogHit[] = [];
  for (const document of documents) {
    if (query.year != null && document.year !== query.year) continue;
    let score = query.year != null ? 0.5 : 0;
    if (author.length) {
      const value = authorScore(author, document.authors);
      if (!value) continue;
      score += 2 * value;
    }
    if (title.length) {
      const value = wordShare(title, document.title, 0.6);
      if (!value) continue;
      score += 2 * value;
    }
    if (keywords.length) {
      const value = wordShare(keywords, `${document.title} ${document.authors.join(' ')}`, 0.5);
      if (!value) continue;
      score += value * (0.5 + topicalShare(keywords, document.title));
    }
    hits.push({ id: document.id, title: document.title, authors: document.authors, year: document.year, score });
  }
  return hits.sort((a, b) => b.score - a.score || (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title)).slice(0, limit);
}

/** A lookup as the reader should see it in the activity and in the research log. */
export function describeCatalogQuery(query: ResearchCatalogQuery): string {
  return [query.author && `author «${query.author}»`, query.title && `title «${query.title}»`, query.keywords && `keywords «${query.keywords}»`,
    query.year != null && `year ${query.year}`].filter(Boolean).join(', ');
}
