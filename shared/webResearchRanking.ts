/** Pure ranking for Research Chat's web step. Every function here is deterministic:
 * the same results in the same order always produce the same selection, so similar
 * questions do not land on different sources because of iteration order or ties. */

export interface WebSearchHit {
  url: string;
  title: string;
  content: string;
  engines: string[];
  positions: number[];
  score: number;
  category: string;
  publishedDate: string | null;
}
export interface WebQueryRun { query: string; category: 'general' | 'science'; round: number; results: WebSearchHit[] }
export interface RankedWebResult {
  key: string;
  url: string;
  title: string;
  snippet: string;
  domain: string;
  engines: string[];
  queries: string[];
  category: 'general' | 'science';
  publishedDate: string | null;
  score: number;
  parts: { consensus: number; lexical: number; prior: number; agreement: number };
}

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|yclid|igshid|_hs[a-z]+|ref|ref_src|referrer|source|spm|srsltid|si|feature)$/i;

/** The same document behind cosmetically different URLs gets one key. */
export function canonicalWebUrl(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
  url.protocol = 'https:';
  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/^(www\d?|m|mobile|amp)\./, '').replace(/\.m\.wikipedia\.org$/, '.wikipedia.org');
  if (url.port === '443' || url.port === '80') url.port = '';
  for (const name of [...url.searchParams.keys()]) if (TRACKING.test(name)) url.searchParams.delete(name);
  url.searchParams.sort();
  let pathname = url.pathname.replace(/\/{2,}/g, '/');
  if (url.hostname === 'arxiv.org') {
    const id = /^\/(?:abs|pdf|html)\/([^/]+?)(?:v\d+)?(?:\.pdf)?\/?$/.exec(pathname)?.[1];
    if (id) pathname = `/abs/${id}`;
  }
  if (url.hostname === 'doi.org' || url.hostname === 'dx.doi.org') { url.hostname = 'doi.org'; pathname = pathname.toLowerCase(); }
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '').replace(/\/(index|default)\.(html?|php|aspx?)$/i, '');
  url.pathname = pathname || '/';
  const text = url.toString();
  return text.endsWith('/') && url.pathname === '/' && !url.search ? text.slice(0, -1) : text;
}

const SECOND_LEVEL = new Set(['co', 'ac', 'gov', 'gob', 'gouv', 'edu', 'org', 'com', 'net', 'nic', 'or', 'ne', 'go', 'mil', 'nhs', 'police', 'sch']);
/** A registrable-domain approximation, good enough to cap sources per site. */
export function webDomain(raw: string): string {
  let host: string;
  try { host = new URL(raw).hostname.toLowerCase(); } catch { return ''; }
  host = host.replace(/^(www\d?|m|mobile|amp)\./, '');
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const take = SECOND_LEVEL.has(labels.at(-2)!) && labels.at(-1)!.length === 2 ? 3 : 2;
  return labels.slice(-take).join('.');
}

const STRONG = ['doi.org', 'arxiv.org', 'nih.gov', 'europepmc.org', 'semanticscholar.org', 'openalex.org', 'nature.com', 'science.org', 'plos.org', 'frontiersin.org', 'hal.science',
  'archives-ouvertes.fr', 'persee.fr', 'redalyc.org', 'doaj.org', 'stanford.edu', 'britannica.com', 'europa.eu', 'un.org', 'who.int', 'oecd.org', 'worldbank.org', 'imf.org',
  'unesco.org', 'rah.es', 'cervantesvirtual.com', 'bne.es', 'csic.es', 'ine.es', 'boe.es', 'acm.org', 'ieee.org', 'biorxiv.org', 'medrxiv.org', 'pnas.org', 'bmj.com',
  'thelancet.com', 'nejm.org', 'cell.com', 'iep.utm.edu', 'ucm.es', 'mdpi.com', 'core.ac.uk', 'unirioja.es',
  'springer.com', 'wiley.com', 'oup.com', 'tandfonline.com', 'sagepub.com', 'cambridge.org', 'cairn.info'];
/** Open-access networks that publish under a country domain each (scielo.org.mx,
 * scielo.cl, redalyc.org…): the Spanish and Portuguese American literature lives
 * here, so they count as scholarly whatever their TLD. Bibliographic indexes
 * (Dialnet, Latindex) are deliberately absent: their pages are records, not text,
 * and promoting them filled the evidence with entries nobody can quote. */
const OPEN_NETWORK = /(^|\.)(scielo|redalyc)\.[a-z]{2,3}(\.[a-z]{2})?$/;
/** Bibliographic indexes: their pages are records, not text, so they are listed as
 * found and never read. Dialnet lives under a university's domain, so the match is
 * on the host, not on the registrable domain. */
const RECORD_INDEX = /^(dialnet|latindex|rebiun|worldcat)\./;
/** Hosts that answer a reader with a login, a paywall or a bot check: they rank
 * below everything else and are never read, because the text is not there. */
const WALLED = ['jstor.org', 'sciencedirect.com', 'ssrn.com', 'researchgate.net', 'academia.edu'];
const GOOD = ['wikipedia.org', 'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'elpais.com', 'theguardian.com', 'nytimes.com', 'lemonde.fr', 'economist.com',
  'nationalgeographic.com', 'smithsonianmag.com', 'theconversation.com', 'historia.nationalgeographic.com.es', 'rtve.es', 'eldiario.es', 'nasa.gov', 'noaa.gov'];
const WEAK = ['pinterest.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'x.com', 'twitter.com', 'youtube.com', 'youtu.be', 'quora.com', 'amazon.com', 'amazon.es',
  'ebay.com', 'linkedin.com', 'coursehero.com', 'studocu.com', 'brainly.com', 'answers.com', 'scribd.com', 'slideshare.net', 'wikihow.com', 'buscalibre.es',
  'casadellibro.com', 'goodreads.com', 'fandom.com', 'prezi.com', 'monografias.com', 'rincondelvago.com', 'lifeder.com', 'significados.com'];

/** Source prior in [-1, 1]: scholarly and institutional sources first, social media,
 * shops and essay mills last. It only breaks ties between comparably relevant hits. */
export function webDomainPrior(raw: string): number {
  const domain = webDomain(raw);
  let host = '';
  try { host = new URL(raw).hostname.toLowerCase(); } catch { return -1; }
  const matches = (list: string[]) => list.some(entry => domain === entry || host === entry || host.endsWith(`.${entry}`));
  if (matches(WEAK)) return -0.7;
  if (matches(WALLED) || RECORD_INDEX.test(host)) return -0.2;
  if (OPEN_NETWORK.test(host)) return 0.8;
  if (matches(STRONG) || /\.(edu|gov|mil|int)$/.test(host) || /\.(ac|edu|gov|gob|gouv)\.[a-z]{2}$/.test(host) || /(^|\.)(gob|gouv|gov)\.[a-z]{2,3}$/.test(host)) return 0.8;
  if (matches(GOOD) || /\.(org)$/.test(host)) return 0.35;
  if (/(^|\.)(blogspot|wordpress|medium|substack|tumblr)\.com$/.test(host)) return -0.15;
  return 0;
}

/** Homepages and search/listing pages rarely hold the passage a question needs. */
export function isListingUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/+$/, '');
    if (!path) return true;
    return /\/(search|buscar|tag|tags|category|categoria|categories|author|autor)(\/|$)/i.test(path) || url.searchParams.has('q') || url.searchParams.has('s');
  } catch { return true; }
}

const STOP = new Set(('a al algo algunas algunos ante antes como con contra cual cuales cuando de del desde donde dos el ella ellas ellos en entre era es esa ese eso esta este esto estos fue ha hay la las le les lo los mas me mi muy no nos o otra otro para pero por porque que qué quien se ser si sin sobre su sus también tan te tiene todo tu un una uno unos y ya ' +
  'about above after again all also an and any are as at be because been before being between both but by can could did do does doing for from had has have having he her here his how i if in into is it its just me more most my no nor not of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your ' +
  'au aux avec ce ces dans des du elle en est et il je la le les leur lui mais même ne nous on ou par pas pour qui sa se ses son sur une vous der die das den dem des ein eine einer und ist im mit von zu auf für nicht sich dass wie auch als oder um ' +
  'di da dei della delle il gli che per non una sono come più o em os as um uma não com dos das pelo pela ao aos ser').split(' ')
  .map(word => word.normalize('NFD').replace(/\p{M}/gu, '')));

export function webTerms(text: string): string[] {
  return (text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter(word => (word.length > 2 || /\d/.test(word)) && !STOP.has(word));
}

/** Okapi BM25 over a small candidate set; scores are comparable only within the set. */
export function bm25Scores(documents: string[], query: string[], k1 = 1.2, b = 0.75): number[] {
  const docs = documents.map(webTerms);
  const avg = docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(1, docs.length) || 1;
  const terms = [...new Set(query)];
  const df = new Map(terms.map(term => [term, docs.filter(doc => doc.includes(term)).length]));
  return docs.map(doc => {
    const tf = new Map<string, number>();
    for (const word of doc) if (df.has(word)) tf.set(word, (tf.get(word) ?? 0) + 1);
    let score = 0;
    for (const term of terms) {
      const f = tf.get(term) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + (docs.length - df.get(term)! + 0.5) / (df.get(term)! + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * doc.length / avg));
    }
    return score;
  });
}

/** Share of the question's content terms a text mentions (accent- and case-folded). */
export function termCoverage(text: string, question: string): number {
  const wanted = [...new Set(webTerms(question))];
  if (!wanted.length) return 0;
  const present = new Set(webTerms(text));
  return wanted.filter(term => present.has(term) || [...present].some(word => word.length > 5 && term.length > 5 && word.slice(0, 5) === term.slice(0, 5))).length / wanted.length;
}

export const WEB_RANKING_WEIGHTS = { consensus: 0.4, lexical: 0.35, prior: 0.15, agreement: 0.1, listingPenalty: 0.25 };

/** Merge every query's results, one entry per canonical document, and rank them by
 * cross-query consensus, relevance of title and snippet to the question, source
 * prior and engine agreement. Ties break on the canonical URL. */
export function rankWebResults(runs: WebQueryRun[], question: string, weights = WEB_RANKING_WEIGHTS): RankedWebResult[] {
  const merged = new Map<string, RankedWebResult & { rrf: number }>();
  for (const run of runs) run.results.forEach((hit, index) => {
    const key = canonicalWebUrl(hit.url);
    if (!key) return;
    const current = merged.get(key);
    const rrf = 1 / (12 + index) * (run.category === 'science' ? 0.9 : 1);
    if (current) {
      current.rrf += rrf;
      current.engines = [...new Set([...current.engines, ...hit.engines])].sort();
      if (!current.queries.includes(run.query)) current.queries.push(run.query);
      if (hit.content.length > current.snippet.length) current.snippet = hit.content;
      if (!current.title && hit.title) current.title = hit.title;
      current.publishedDate ??= hit.publishedDate;
      return;
    }
    merged.set(key, { key, url: hit.url, title: hit.title, snippet: hit.content, domain: webDomain(key), engines: [...hit.engines].sort(), queries: [run.query],
      category: run.category, publishedDate: hit.publishedDate, score: 0, parts: { consensus: 0, lexical: 0, prior: 0, agreement: 0 }, rrf });
  });
  const entries = [...merged.values()];
  if (!entries.length) return [];
  const queryTerms = [...webTerms(question), ...runs.flatMap(run => webTerms(run.query))];
  const lexical = bm25Scores(entries.map(entry => `${entry.title} ${entry.title} ${entry.snippet}`), queryTerms);
  const maxLexical = Math.max(...lexical, 1e-9);
  const maxRrf = Math.max(...entries.map(entry => entry.rrf));
  entries.forEach((entry, index) => {
    const coverage = termCoverage(`${entry.title} ${entry.snippet}`, question);
    entry.parts = {
      consensus: entry.rrf / maxRrf,
      lexical: 0.6 * lexical[index] / maxLexical + 0.4 * coverage,
      prior: webDomainPrior(entry.url),
      agreement: Math.min(1, (entry.engines.length - 1) / 2 + (entry.queries.length - 1) / 3),
    };
    entry.score = weights.consensus * entry.parts.consensus + weights.lexical * entry.parts.lexical + weights.prior * entry.parts.prior
      + weights.agreement * entry.parts.agreement - (isListingUrl(entry.url) ? weights.listingPenalty : 0);
  });
  return entries.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1)).map(({ rrf: _rrf, ...entry }) => entry);
}

/** True for a host that answers readers with a login, a paywall or a bot check.
 * Such a page is worth listing as found, but never worth a read: it cannot yield a
 * passage, and every slot it takes is a source the answer never sees. */
export function isWalledSource(raw: string): boolean {
  let host = '';
  try { host = new URL(raw).hostname.toLowerCase(); } catch { return true; }
  if (RECORD_INDEX.test(host)) return true;
  const domain = webDomain(raw);
  return WALLED.some(entry => domain === entry || host === entry || host.endsWith(`.${entry}`));
}

/** The next pages to read: best first, at most `perDomain` per site across the whole
 * step (already-read pages count), never a page already visited, and never a site
 * that already refused or failed to answer in this step. */
export function selectPagesToRead(ranked: RankedWebResult[], visited: Set<string>, readDomains: Map<string, number>, count: number, perDomain = 2, minimumScore = 0.12, minimumLexical = 0.1, refusedDomains: Set<string> = new Set()): RankedWebResult[] {
  const picked: RankedWebResult[] = [];
  const domains = new Map(readDomains);
  for (const result of ranked) {
    if (picked.length >= count) break;
    // A result whose title and snippet share (almost) nothing with the question is
    // about something else, however many engines returned it.
    if (visited.has(result.key) || refusedDomains.has(result.domain) || isWalledSource(result.url)) continue;
    if (result.score < minimumScore || result.parts.lexical < minimumLexical || webDomainPrior(result.url) <= -0.7) continue;
    if ((domains.get(result.domain) ?? 0) >= perDomain) continue;
    domains.set(result.domain, (domains.get(result.domain) ?? 0) + 1);
    picked.push(result);
  }
  return picked;
}

export interface WebPageText { heading?: string | null; text: string; pageNumber?: number | null }
export interface WebPassageCandidate { index: number; text: string; heading: string | null; pageNumber: number | null }

/** Paragraph-aligned passages of roughly `target` characters; a long paragraph is
 * split on sentence ends, never mid-word. The section heading travels along. */
export function chunkWebText(blocks: WebPageText[], target = 1100, maximum = 1600): WebPassageCandidate[] {
  const passages: WebPassageCandidate[] = [];
  let buffer = '';
  let heading: string | null = null;
  let page: number | null = null;
  const flush = () => { const text = buffer.trim(); if (text.length >= 80) passages.push({ index: passages.length, text, heading, pageNumber: page }); buffer = ''; };
  for (const block of blocks) {
    if ((block.pageNumber ?? null) !== page || (block.heading ?? null) !== heading) { flush(); page = block.pageNumber ?? null; heading = block.heading ?? null; }
    const paragraphs = block.text.split(/\n{2,}|\r\n\r\n/).map(part => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
    for (const paragraph of paragraphs) {
      const pieces = paragraph.length <= maximum ? [paragraph] : paragraph.match(/[^.!?。！？]+[.!?。！？]+["'»”)]*\s*|[^.!?。！？]+$/g) ?? [paragraph];
      for (const piece of pieces) {
        if (buffer && buffer.length + piece.length + 1 > maximum) flush();
        buffer = buffer ? `${buffer}${buffer.endsWith(' ') ? '' : ' '}${piece.trim()}` : piece.trim();
        if (buffer.length >= target) flush();
        while (buffer.length > maximum) {
          const cut = buffer.lastIndexOf(' ', maximum);
          const head = buffer.slice(0, cut > target / 2 ? cut : maximum);
          buffer = buffer.slice(head.length).trim();
          passages.push({ index: passages.length, text: head.trim(), heading, pageNumber: page });
        }
      }
      if (buffer) buffer += '\n\n';
    }
  }
  flush();
  return passages;
}

function shingles(text: string): Set<string> {
  const words = webTerms(text);
  const set = new Set<string>();
  for (let index = 0; index + 3 <= words.length; index++) set.add(words.slice(index, index + 3).join(' '));
  if (!set.size && words.length) set.add(words.join(' '));
  return set;
}
/** Jaccard similarity of word trigrams: 1 for copies, ~0 for unrelated passages. */
export function passageSimilarity(a: string, b: string): number {
  const left = shingles(a), right = shingles(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared++;
  return shared / (left.size + right.size - shared);
}

export interface ScoredWebPassage { key: string; pageKey: string; domain: string; text: string; relevance: number }

/** Maximal marginal relevance over already-scored passages: relevant first, then
 * diverse. Near-copies (syndicated text, mirrors) are dropped, and every further
 * passage taken from the same page or the same site has to beat a fresh source by
 * `pageDecay`/`domainDecay`, so one long page cannot become the whole answer. */
export function selectWebPassages<T extends ScoredWebPassage>(candidates: T[], limit: number, options: { perPage?: number; perDomain?: number; lambda?: number; floor?: number; duplicate?: number; pageDecay?: number; domainDecay?: number } = {}): T[] {
  const { perPage = 3, perDomain = 4, lambda = 0.72, floor = 0, duplicate = 0.55, pageDecay = 0.12, domainDecay = 0.05 } = options;
  const pool = candidates.filter(item => item.relevance > floor).sort((a, b) => b.relevance - a.relevance || (a.key < b.key ? -1 : 1));
  const best = pool[0]?.relevance ?? 0;
  const chosen: T[] = [];
  const pages = new Map<string, number>(), domains = new Map<string, number>();
  while (chosen.length < limit && pool.length) {
    let pick = -1, pickScore = -Infinity;
    for (let index = 0; index < pool.length; index++) {
      const item = pool[index];
      if ((pages.get(item.pageKey) ?? 0) >= perPage || (domains.get(item.domain) ?? 0) >= perDomain) continue;
      const redundancy = chosen.reduce((max, other) => Math.max(max, passageSimilarity(item.text, other.text)), 0);
      if (redundancy >= duplicate) continue;
      const value = lambda * item.relevance / (best || 1) - (1 - lambda) * redundancy
        - pageDecay * (pages.get(item.pageKey) ?? 0) - domainDecay * (domains.get(item.domain) ?? 0);
      if (value > pickScore + 1e-12) { pick = index; pickScore = value; }
    }
    if (pick < 0) break;
    const [item] = pool.splice(pick, 1);
    chosen.push(item);
    pages.set(item.pageKey, (pages.get(item.pageKey) ?? 0) + 1);
    domains.set(item.domain, (domains.get(item.domain) ?? 0) + 1);
  }
  return chosen;
}

/** Reciprocal-rank fusion of independent orderings (lexical, semantic). */
export function fuseRanks(orderings: string[][], k = 20): Map<string, number> {
  const fused = new Map<string, number>();
  for (const ordering of orderings) ordering.forEach((key, index) => fused.set(key, (fused.get(key) ?? 0) + 1 / (k + index + 1)));
  return fused;
}

/** Text fragment link so the Browser lands on the quoted passage (HTML only). */
export function webPassageLink(url: string, text: string, pageNumber?: number | null): string {
  try {
    const target = new URL(url);
    if (pageNumber && /\.pdf$/i.test(target.pathname)) { target.hash = `page=${pageNumber}`; return target.toString(); }
    const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (words.length < 8) return target.toString();
    const encode = (value: string) => encodeURIComponent(value).replace(/-/g, '%2D').replace(/,/g, '%2C').replace(/&/g, '%26');
    target.hash = `:~:text=${encode(words.slice(0, 5).join(' '))},${encode(words.slice(-4).join(' '))}`;
    return target.toString();
  } catch { return url; }
}

const CITATION_MARKS = /\bet al\.|\(\s*(1[89]|20)\d{2}[a-z]?\s*\)|\b(19|20)\d{2}[a-z]?[;,.]\s|\bdoi[:.]|doi\.org\/|\bPubMed\b|\bGoogle Scholar\b|\bCrossRef\b|\bPMC\d+|\bISBN\b|\bpp?\.\s?\d+|\bvol\.\s?\d+|↑|\^ |\[\d+\]|\bRetrieved\b|\bConsultado el\b|\bArchived from\b/gi;
const CHROME_MARKS = /\bcookies?\b|\bprivacy policy\b|\bpol[ií]tica de privacidad\b|\bsubscribe\b|\bsuscr[ií]bete\b|\bsign in\b|\biniciar sesi[oó]n\b|\bnewsletter\b|\ball rights reserved\b|\btodos los derechos reservados\b|\bshare this\b|\bcompartir\b|\bread more\b|\bleer m[aá]s\b|\bskip to\b|\bmenu\b/gi;
/** 0 for prose, towards 1 for a bibliography, a footnote list or page chrome.
 * Such chunks mention the question's words (titles cite the topic) without
 * saying anything about it, so lexical relevance alone would rank them high. */
export function boilerplateScore(text: string): number {
  const size = Math.max(200, text.length);
  const citations = (text.match(CITATION_MARKS) ?? []).length * 1000 / size;
  const chrome = (text.match(CHROME_MARKS) ?? []).length * 1000 / size;
  const sentences = (text.match(/[.!?](\s|$)/g) ?? []).length;
  const words = text.split(/\s+/).length;
  const fragmentary = words > 40 && sentences / words > 0.12 ? 0.3 : 0;
  return Math.min(1, Math.max(0, (citations - 3) / 7) + Math.max(0, (chrome - 2) / 6) + fragmentary);
}
