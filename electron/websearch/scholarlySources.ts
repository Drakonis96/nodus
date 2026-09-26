/** Scholarly records through the services' own open APIs.
 *
 * PubMed, Europe PMC and many publishers answer an automated page request with a
 * browser check. Nodus never works around such a check; for these records it asks
 * the documented programmatic interface each service provides instead (NCBI
 * E-utilities, the Europe PMC REST API, OpenAlex by DOI). The citation still points
 * at the article page, which the user opens in the Browser like any other page. */
export type ScholarlyRoute = { kind: 'pubmed'; id: string } | { kind: 'europepmc'; source: string; id: string } | { kind: 'doi'; doi: string };
export interface ScholarlyRecord { title: string; journal: string | null; published: string | null; doi: string | null; authors: string[]; abstract: string; via: string }

export function scholarlyRoute(raw: string): ScholarlyRoute | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  const host = url.hostname.replace(/^www\./, '');
  const pubmed = /^\/(\d{5,9})\/?$/.exec(url.pathname);
  if (host === 'pubmed.ncbi.nlm.nih.gov' && pubmed) return { kind: 'pubmed', id: pubmed[1] };
  const epmc = /^\/(?:article|abstract)\/(MED|PMC|PPR|AGR|CBA|CTX|ETH|HIR|PAT)\/([A-Z0-9]+)\/?/i.exec(url.pathname);
  if (host === 'europepmc.org' && epmc) return { kind: 'europepmc', source: epmc[1].toUpperCase(), id: epmc[2] };
  const doi = /(10\.\d{4,9}\/[^\s?#&]+)/.exec(decodeURIComponent(url.pathname));
  if (doi) return { kind: 'doi', doi: doi[1].replace(/\/(abstract|full|pdf|epdf|html)$/i, '').replace(/[.,;]+$/, '') };
  return null;
}

type Getter = (url: string, accept: string) => Promise<string>;
const decodeXml = (text: string) => text.replace(/<[^>]+>/g, ' ').replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

export async function fetchScholarlyRecord(route: ScholarlyRoute, get: Getter): Promise<ScholarlyRecord | null> {
  if (route.kind === 'pubmed') {
    const xml = await get(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${route.id}&retmode=xml&tool=nodus`, 'application/xml');
    const abstract = [...xml.matchAll(/<AbstractText(?:\s+Label="([^"]*)")?[^>]*>([\s\S]*?)<\/AbstractText>/g)].map(match => `${match[1] ? `${decodeXml(match[1])}: ` : ''}${decodeXml(match[2])}`).join('\n\n');
    const title = decodeXml(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/.exec(xml)?.[1] ?? '');
    if (!abstract || !title) return null;
    const authors = [...xml.matchAll(/<LastName>([^<]+)<\/LastName>/g)].slice(0, 6).map(match => decodeXml(match[1]));
    return { title, journal: decodeXml(/<Journal>[\s\S]*?<Title>([\s\S]*?)<\/Title>/.exec(xml)?.[1] ?? '') || null,
      published: /<PubDate>\s*<Year>(\d{4})<\/Year>/.exec(xml)?.[1] ?? null, doi: /<ELocationID EIdType="doi"[^>]*>([^<]+)</.exec(xml)?.[1] ?? null, authors, abstract, via: 'NCBI E-utilities' };
  }
  if (route.kind === 'europepmc') {
    const query = route.source === 'PMC' ? `PMCID:${route.id.startsWith('PMC') ? route.id : `PMC${route.id}`}` : `EXT_ID:${route.id} AND SRC:${route.source}`;
    const body = JSON.parse(await get(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&resultType=core&format=json&pageSize=1`, 'application/json'));
    const result = body?.resultList?.result?.[0];
    if (!result?.abstractText || !result.title) return null;
    return { title: decodeXml(result.title), journal: result.journalInfo?.journal?.title ?? null, published: result.firstPublicationDate ?? (result.pubYear ? String(result.pubYear) : null),
      doi: result.doi ?? null, authors: (result.authorList?.author ?? []).slice(0, 6).map((author: { lastName?: string; fullName?: string }) => author.lastName ?? author.fullName ?? '').filter(Boolean),
      abstract: decodeXml(String(result.abstractText).replace(/<\/?(h4|p)[^>]*>/g, '\n\n')), via: 'Europe PMC REST API' };
  }
  const body = JSON.parse(await get(`https://api.openalex.org/works/doi:${encodeURIComponent(route.doi)}`, 'application/json'));
  const index = body?.abstract_inverted_index as Record<string, number[]> | undefined;
  if (!index || !body.title) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) for (const position of positions) if (position < 5000) words[position] = word;
  const abstract = words.filter(Boolean).join(' ');
  if (abstract.length < 120) return null;
  return { title: String(body.title), journal: body.primary_location?.source?.display_name ?? null, published: body.publication_date ?? null, doi: route.doi,
    authors: (body.authorships ?? []).slice(0, 6).map((entry: { author?: { display_name?: string } }) => entry.author?.display_name ?? '').filter(Boolean), abstract, via: 'OpenAlex' };
}
