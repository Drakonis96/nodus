// Nodus Translate — structure-preserving adapters for text, HTML, EPUB and DOCX.
// The original archive is retained and only human-readable text payloads are changed;
// relationships, images, styles, headers, footers, notes and embedded assets stay in
// their original package parts.
import AdmZip from 'adm-zip';
import type { TranslateSegment, TranslateSegmentResult } from '@shared/toolkitTranslateTypes';

export interface StructuredTranslateOptions {
  translate: (segments: TranslateSegment[]) => Promise<TranslateSegmentResult[]>;
  onWarning?: (message: string) => void;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function encodeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stripMarkup(value: string): string {
  return decodeXml(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
}

interface SpanMatch {
  start: number;
  end: number;
  source: string;
  segment: TranslateSegment;
}

function replaceSpans(source: string, spans: SpanMatch[], values: Map<string, string>): string {
  let cursor = 0;
  const out: string[] = [];
  for (const span of spans) {
    out.push(source.slice(cursor, span.start));
    out.push(values.get(span.segment.id) ?? span.source);
    cursor = span.end;
  }
  out.push(source.slice(cursor));
  return out.join('');
}

/** Models occasionally renumber an isolated Markdown list item because each block is
 * translated independently. Restore syntax that describes structure rather than prose. */
export function restoreMarkdownPrefix(source: string, translated: string): string {
  const sourcePrefix = source.match(/^(\s*)(#{1,6}|>|\d+[.)]|[-+*])([ \t]+)/);
  if (!sourcePrefix) return translated;
  const translatedPrefix = translated.match(/^(\s*)(#{1,6}|>|\d+[.)]|[-+*])([ \t]+)/);
  const prefix = `${sourcePrefix[1]}${sourcePrefix[2]}${sourcePrefix[3]}`;
  if (translatedPrefix) return `${prefix}${translated.slice(translatedPrefix[0].length)}`;
  return `${prefix}${translated.trimStart()}`;
}

/** Translate Markdown as paragraph-sized blocks so headings/tables never share a
 * model response boundary in the middle of their own block. */
export async function translateMarkdownDocument(markdown: string, options: StructuredTranslateOptions): Promise<string> {
  const blocks = markdown.split(/(\n{2,})/);
  const segments: TranslateSegment[] = [];
  const indexToId = new Map<number, string>();
  for (let i = 0; i < blocks.length; i += 2) {
    if (!blocks[i]?.trim()) continue;
    const id = `md-${String(i / 2 + 1).padStart(6, '0')}`;
    segments.push({ id, text: blocks[i], kind: 'markdown' });
    indexToId.set(i, id);
  }
  const sourceById = new Map(segments.map((segment) => [segment.id, segment.text]));
  const translated = new Map((await options.translate(segments)).map((segment) => [
    segment.id,
    restoreMarkdownPrefix(sourceById.get(segment.id) ?? '', segment.translated),
  ]));
  return blocks.map((block, index) => translated.get(indexToId.get(index) ?? '') ?? block).join('');
}

export async function translatePlainDocument(text: string, options: StructuredTranslateOptions): Promise<string> {
  const blocks = text.split(/(\n{2,})/);
  const segments: TranslateSegment[] = [];
  const indexToId = new Map<number, string>();
  for (let i = 0; i < blocks.length; i += 2) {
    if (!blocks[i]?.trim()) continue;
    const id = `txt-${String(i / 2 + 1).padStart(6, '0')}`;
    segments.push({ id, text: blocks[i], kind: 'plain' });
    indexToId.set(i, id);
  }
  const translated = new Map((await options.translate(segments)).map((segment) => [segment.id, segment.translated]));
  return blocks.map((block, index) => translated.get(indexToId.get(index) ?? '') ?? block).join('');
}

/** Extract leaf block elements. Inline markup remains inside a segment, so emphasis,
 * links, ruby, superscript and other publishing markup can be moved by the translator
 * without rebuilding the DOM. */
function htmlSpans(html: string, prefix: string): SpanMatch[] {
  const spans: SpanMatch[] = [];
  const pattern = /<(title|h[1-6]|p|li|td|th|caption|figcaption|blockquote)\b[^>]*>[\s\S]*?<\/\1>/gi;
  let match: RegExpExecArray | null;
  let n = 0;
  while ((match = pattern.exec(html))) {
    if (!stripMarkup(match[0])) continue;
    const id = `${prefix}-${String(++n).padStart(6, '0')}`;
    spans.push({ start: match.index, end: match.index + match[0].length, source: match[0], segment: { id, text: match[0], kind: 'html' } });
  }
  if (!spans.length && stripMarkup(html)) {
    spans.push({ start: 0, end: html.length, source: html, segment: { id: `${prefix}-000001`, text: html, kind: 'html' } });
  }
  return spans;
}

export async function translateHtmlDocument(html: string, options: StructuredTranslateOptions, prefix = 'html'): Promise<string> {
  // Scripts/styles are replaced with stable tokens before model calls and restored after;
  // this makes it impossible for a translation model to mutate executable content or CSS.
  const protectedParts: string[] = [];
  const protectedHtml = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, (value) => {
    const token = `<!--NODUS_PROTECTED_${protectedParts.length}-->`;
    protectedParts.push(value);
    return token;
  });
  const spans = htmlSpans(protectedHtml, prefix);
  const translated = new Map((await options.translate(spans.map((span) => span.segment))).map((segment) => [segment.id, segment.translated]));
  return replaceSpans(protectedHtml, spans, translated).replace(/<!--NODUS_PROTECTED_(\d+)-->/g, (_m, index) => protectedParts[Number(index)] ?? '');
}

export async function translateEpubBytes(bytes: Uint8Array, options: StructuredTranslateOptions): Promise<Uint8Array> {
  const zip = new AdmZip(Buffer.from(bytes));
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory && /\.(xhtml|html?|xml)$/i.test(entry.entryName));
  let index = 0;
  for (const entry of entries) {
    const original = entry.getData().toString('utf8');
    // container.xml and package manifests contain no reader prose except metadata;
    // translating structural attributes there could invalidate the EPUB.
    if (/META-INF\/container\.xml$/i.test(entry.entryName) || /\.opf$/i.test(entry.entryName)) continue;
    const translated = await translateHtmlDocument(original, options, `epub-${String(++index).padStart(4, '0')}`);
    zip.updateFile(entry.entryName, Buffer.from(translated, 'utf8'));
  }
  return new Uint8Array(zip.toBuffer());
}

interface WordTextNode {
  start: number;
  end: number;
  open: string;
  value: string;
}

function wordTextNodes(paragraph: string): WordTextNode[] {
  const nodes: WordTextNode[] = [];
  const pattern = /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(paragraph))) {
    nodes.push({
      start: match.index,
      end: match.index + match[0].length,
      open: match[1],
      value: decodeXml(match[2]),
    });
  }
  return nodes;
}

function paragraphPseudoXml(nodes: WordTextNode[]): string {
  return nodes.map((node, index) => `<n id="${index}">${encodeXml(node.value)}</n>`).join('');
}

function translatedWordValues(translated: string, count: number): string[] | null {
  const values = new Array<string | undefined>(count);
  const pattern = /<n\s+id=["'](\d+)["']\s*>([\s\S]*?)<\/n>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(translated))) {
    const index = Number(match[1]);
    if (index >= 0 && index < count && values[index] == null) values[index] = decodeXml(match[2]);
  }
  return values.every((value) => value != null) ? values as string[] : null;
}

function rebuildWordParagraph(paragraph: string, nodes: WordTextNode[], translated: string, onWarning?: (message: string) => void): string {
  const values = translatedWordValues(translated, nodes.length);
  let replacements: string[];
  if (values) {
    replacements = values;
  } else {
    // Preserve the complete translated prose even when a weak model drops inline-run
    // tags. Styling falls back to the first run, but no words disappear silently.
    const flattened = stripMarkup(translated);
    replacements = nodes.map((_node, index) => index === 0 ? flattened : '');
    onWarning?.('Un párrafo de Word no conservó todas las marcas de formato en la respuesta del modelo; se mantuvo el texto completo con el estilo del primer fragmento.');
  }
  let cursor = 0;
  const out: string[] = [];
  nodes.forEach((node, index) => {
    out.push(paragraph.slice(cursor, node.start));
    const value = replacements[index] ?? '';
    const open = /\bxml:space=/.test(node.open) || /^\s|\s$/.test(value)
      ? node.open.replace(/>$/, /\bxml:space=/.test(node.open) ? '>' : ' xml:space="preserve">')
      : node.open;
    out.push(`${open}${encodeXml(value)}</w:t>`);
    cursor = node.end;
  });
  out.push(paragraph.slice(cursor));
  return out.join('');
}

interface WordParagraphSpan extends SpanMatch {
  nodes: WordTextNode[];
}

function wordParagraphSpans(xml: string, prefix: string): WordParagraphSpan[] {
  const spans: WordParagraphSpan[] = [];
  const pattern = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(xml))) {
    const nodes = wordTextNodes(match[0]);
    if (!nodes.some((node) => node.value.trim())) continue;
    const id = `${prefix}-${String(++index).padStart(6, '0')}`;
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      source: match[0],
      nodes,
      segment: { id, text: paragraphPseudoXml(nodes), kind: 'xml' },
    });
  }
  return spans;
}

const WORD_TRANSLATABLE_PART = /^word\/(document|footnotes|endnotes|comments|header\d+|footer\d+)\.xml$/i;

export async function translateDocxBytes(bytes: Uint8Array, options: StructuredTranslateOptions): Promise<Uint8Array> {
  const zip = new AdmZip(Buffer.from(bytes));
  const parts = zip.getEntries()
    .filter((entry) => !entry.isDirectory && WORD_TRANSLATABLE_PART.test(entry.entryName))
    .map((entry, partIndex) => {
      const xml = entry.getData().toString('utf8');
      return { entry, xml, spans: wordParagraphSpans(xml, `docx-${String(partIndex + 1).padStart(3, '0')}`) };
    });
  const all = parts.flatMap((part) => part.spans.map((span) => span.segment));
  const values = new Map((await options.translate(all)).map((segment) => [segment.id, segment.translated]));
  for (const part of parts) {
    const replacements = new Map<string, string>();
    for (const span of part.spans) {
      const translated = values.get(span.segment.id) ?? span.segment.text;
      replacements.set(span.segment.id, rebuildWordParagraph(span.source, span.nodes, translated, options.onWarning));
    }
    zip.updateFile(part.entry.entryName, Buffer.from(replaceSpans(part.xml, part.spans, replacements), 'utf8'));
  }
  return new Uint8Array(zip.toBuffer());
}
