import { parseHTML as parseLinkedom } from 'linkedom';
import { Readability } from '@mozilla/readability';
import type { WebPageText } from '@shared/webResearchRanking';
import type { ScholarlyRecord } from './scholarlySources';

/** What a fetched page contributes. Everything is untrusted remote content. */
export interface ExtractedWebPage {
  kind: 'html' | 'pdf';
  title: string;
  siteName: string | null;
  byline: string | null;
  publishedAt: string | null;
  doi: string | null;
  /** A scholarly landing page's full-text PDF, declared by the page itself. */
  pdfUrl: string | null;
  language: string | null;
  blocks: WebPageText[];
  /** Bot check, CAPTCHA or access wall instead of the document. */
  challenge: boolean;
}

/** linkedom's typings describe a window; only its document is used here. */
const parseHTML = (html: string) => parseLinkedom(html) as unknown as { document: any };

const BLOCK = new Set(['P', 'LI', 'BLOCKQUOTE', 'PRE', 'DD', 'DT', 'FIGCAPTION', 'TD', 'TH', 'CAPTION', 'SUMMARY']);
const HEADING = /^H[1-6]$/;
const NOISE = 'script,style,noscript,template,svg,canvas,iframe,form,button,select,input,nav,header,footer,aside,[role=navigation],[role=banner],[role=contentinfo],[aria-hidden=true],.cookie,.cookies,#cookie,.advert,.ads,.share,.social,.related,.newsletter';
const CHALLENGE_TITLE = /just a moment|attention required|access denied|are you (a )?(robot|human)|verify you are human|captcha|robot check|security check|bot protection|acceso denegado|comprobaci[oó]n de seguridad|please enable (javascript|cookies)|enable javascript and cookies/i;
const CHALLENGE_MARKUP = /cf-challenge|cf_chl_|challenge-platform|g-recaptcha|h-captcha|hcaptcha\.com|recaptcha\/api|px-captcha|datadome|perimeterx|ddos-guard|sgcaptcha/i;

function clean(text: string | null | undefined, limit = 400): string { return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, limit); }

function meta(document: any, ...names: string[]): string | null {
  for (const name of names) {
    const value = document.querySelector(`meta[name="${name}" i],meta[property="${name}" i]`)?.getAttribute('content');
    if (value && value.trim()) return clean(value, 2000);
  }
  return null;
}

function jsonLdDate(document: any): string | null {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    const match = /"datePublished"\s*:\s*"([^"]{8,40})"/.exec(script.textContent ?? '');
    if (match) return match[1];
  }
  return null;
}

function blocksFrom(root: any): WebPageText[] {
  const blocks: WebPageText[] = [];
  let heading: string | null = null;
  const walk = (node: any) => {
    for (const child of node.children ?? []) {
      const tag = String(child.tagName ?? '').toUpperCase();
      if (HEADING.test(tag)) { heading = clean(child.textContent, 200) || heading; continue; }
      if (BLOCK.has(tag)) {
        // A list item or cell that wraps paragraphs is walked, not flattened twice.
        if ((tag === 'LI' || tag === 'TD') && child.querySelector?.('p,li,blockquote')) { walk(child); continue; }
        const text = clean(child.textContent, 20000);
        if (text.length >= 25) blocks.push({ heading, text });
        continue;
      }
      walk(child);
    }
  };
  walk(root);
  // Pages that put prose directly in <div>s have no block elements at all.
  if (!blocks.length) {
    const text = String(root.textContent ?? '').split(/\n\s*\n/).map(part => clean(part, 20000)).filter(part => part.length >= 40);
    for (const part of text) blocks.push({ heading: null, text: part });
  }
  return blocks;
}

function sameText(a: string, b: string): boolean {
  const key = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 160);
  return key(a).length > 40 && key(b).includes(key(a));
}

/** Main text of an HTML page as heading-tagged blocks, plus the bibliographic
 * metadata publishers and repositories expose (Highwire citation_*, Open Graph,
 * Dublin Core, JSON-LD). Readability finds the article; a structural fallback
 * keeps pages it rejects (short abstracts, listings of facts). */
export function extractHtmlPage(html: string, url: string): ExtractedWebPage {
  const { document } = parseHTML(html);
  const title = meta(document, 'citation_title', 'dc.title', 'og:title', 'twitter:title') ?? clean(document.querySelector('title')?.textContent, 300);
  const visible = clean(document.body?.textContent, 4000);
  const challenge = CHALLENGE_TITLE.test(clean(document.querySelector('title')?.textContent, 300))
    || (CHALLENGE_MARKUP.test(html.slice(0, 200_000)) && visible.length < 1500);
  const pdfUrl = meta(document, 'citation_pdf_url');
  const page: ExtractedWebPage = {
    kind: 'html', title, siteName: meta(document, 'og:site_name', 'citation_journal_title', 'citation_publisher', 'dc.publisher', 'application-name'),
    byline: meta(document, 'citation_author', 'author', 'dc.creator', 'article:author'),
    publishedAt: meta(document, 'citation_publication_date', 'citation_date', 'citation_online_date', 'article:published_time', 'dc.date', 'date', 'pubdate') ?? jsonLdDate(document),
    doi: meta(document, 'citation_doi', 'dc.identifier', 'prism.doi')?.replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:)/i, '').match(/^10\.\d{4,9}\/\S+$/)?.[0] ?? null,
    pdfUrl: pdfUrl ? (() => { try { return new URL(pdfUrl, url).toString(); } catch { return null; } })() : null,
    language: clean(document.documentElement?.getAttribute?.('lang'), 20) || null,
    blocks: [], challenge,
  };
  if (challenge) return page;
  const abstract = meta(document, 'citation_abstract', 'dc.description', 'description', 'og:description');
  for (const node of document.querySelectorAll('base')) node.remove();
  let blocks: WebPageText[] = [];
  try {
    const article = new Readability(document.cloneNode(true) as any, { charThreshold: 400, keepClasses: false }).parse();
    if (article?.content) {
      blocks = blocksFrom(parseHTML(`<!doctype html><html><body>${article.content}</body></html>`).document.body);
      page.siteName ??= clean(article.siteName, 200) || null;
      page.byline ??= clean(article.byline, 300) || null;
      page.publishedAt ??= clean(article.publishedTime, 40) || null;
    }
  } catch { /* Fall through to the structural extraction below. */ }
  if (blocks.reduce((sum, block) => sum + block.text.length, 0) < 600) {
    for (const node of document.querySelectorAll(NOISE)) node.remove();
    const root = document.querySelector('main,article,[role=main],#content,.content') ?? document.body;
    const structural = root ? blocksFrom(root) : [];
    if (structural.reduce((sum, block) => sum + block.text.length, 0) > blocks.reduce((sum, block) => sum + block.text.length, 0)) blocks = structural;
  }
  // A landing page often shows only part of its abstract; the declared one is whole.
  if (abstract && abstract.length >= 120 && !blocks.some(block => sameText(abstract, block.text))) blocks.unshift({ heading: 'Abstract', text: abstract });
  page.blocks = blocks.slice(0, 1500);
  return page;
}

/** Plain text bodies (text/plain, some repositories' full text). */
export function extractTextPage(text: string, url: string): ExtractedWebPage {
  const blocks = text.split(/\n\s*\n/).map(part => clean(part, 20000)).filter(part => part.length >= 25).slice(0, 1500).map(part => ({ heading: null, text: part }));
  return { kind: 'html', title: clean(new URL(url).pathname.split('/').pop(), 200) || new URL(url).hostname, siteName: null, byline: null,
    publishedAt: null, doi: null, pdfUrl: null, language: null, blocks, challenge: false };
}

/** A record from a scholarly API: title, venue and the abstract as its text. */
export function extractScholarlyRecord(record: ScholarlyRecord): ExtractedWebPage {
  const blocks = record.abstract.split(/\n\s*\n/).map(part => clean(part, 20000)).filter(part => part.length >= 25).map(text => ({ heading: 'Abstract', text }));
  return { kind: 'html', title: clean(record.title, 400), siteName: record.journal, byline: record.authors.join('; ') || null, publishedAt: record.published,
    doi: record.doi, pdfUrl: null, language: null, blocks, challenge: false };
}
