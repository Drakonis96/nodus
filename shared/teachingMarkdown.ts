import katex from 'katex';
import { normalizeLatexDelimiters } from './latexDelimiters';

/**
 * Renders the Markdown subset teachers use in question prompts, options and answer
 * keys to the self-contained HTML of the printable exam.
 *
 * The desktop and Server Web render this content through react-markdown, which
 * cannot be reached from the Electron main process where the PDF is printed. This
 * small renderer keeps the printed paper and the live preview working from the same
 * string: bold, italic, strikethrough, inline code, fenced code, headings, lists,
 * blockquotes, links and GFM tables — plus `$…$`/`$$…$$` (and `\(…\)`/`\[…\]`)
 * mathematics typeset by KaTeX.
 *
 * Safety: the source is HTML-escaped before any structure is added, link targets
 * must pass a scheme allowlist, and the only markup that ever reaches the document
 * is produced here. Math uses KaTeX's native MathML output, which Chromium renders
 * without loading a stylesheet or web fonts, so the printed PDF needs no assets.
 */
export interface TeachingMarkdownOptions {
  /** Inline mode returns a fragment with no block wrappers (options, cells, tags). */
  inline?: boolean;
}

const SAFE_LINK = /^(?:https?:|mailto:|tel:|#|\/|nodus:)/i;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode, output: 'mathml', throwOnError: false, strict: false });
  } catch {
    return `<code>${escapeHtml(tex)}</code>`;
  }
}

function inlineHtml(text: string): string {
  const links: string[] = [];
  // Links are extracted before escaping so their label can be rendered recursively;
  // the href is escaped (and scheme-checked) before it reaches the attribute.
  let value = text.replace(/\[([^\]]*)\]\((?:<([^>]*)>|([^)\s]+))\)/g, (match, label: string, angle?: string, plain?: string) => {
    const href = String(angle ?? plain ?? '').trim();
    if (!SAFE_LINK.test(href)) return match;
    return `\uE001${links.push(`<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${inlineHtml(label)}</a>`) - 1}\uE001`;
  });
  value = escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return value.replace(/\uE001(\d+)\uE001/g, (_match, index: string) => links[Number(index)] ?? '');
}

function splitTableRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim());
}

function isTableStart(lines: string[], index: number): boolean {
  return lines[index].includes('|')
    && Boolean(lines[index + 1])
    && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[index + 1]);
}

function isListLine(line: string): boolean {
  return /^\s*(?:[-*+]|\d+[.)])\s+/.test(line);
}

function listItemMatch(line: string): RegExpMatchArray | null {
  return line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index];
  if (!line || !line.trim()) return true;
  if (/^\uE000\d+\uE000$/.test(line.trim())) return true;
  if (/^#{1,6}\s+/.test(line)) return true;
  if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return true;
  if (/^\s*>\s?/.test(line)) return true;
  if (isListLine(line)) return true;
  if (isTableStart(lines, index)) return true;
  return false;
}

function parseList(lines: string[], start: number): { html: string; next: number } {
  const first = listItemMatch(lines[start]);
  const indent = first?.[1].length ?? 0;
  const ordered = /\d/.test(first?.[2] ?? '');
  const items: string[] = [];
  let index = start;
  while (index < lines.length) {
    const match = listItemMatch(lines[index]);
    if (!match || match[1].length < indent) break;
    if (match[1].length > indent) {
      const nested = parseList(lines, index);
      if (items.length) items[items.length - 1] += nested.html;
      else items.push(nested.html);
      index = nested.next;
      continue;
    }
    if (/\d/.test(match[2]) !== ordered) break;
    items.push(inlineHtml(match[3]));
    index += 1;
  }
  const tag = ordered ? 'ol' : 'ul';
  return { html: `<${tag}>${items.map((item) => `<li>${item}</li>`).join('')}</${tag}>`, next: index };
}

function renderTable(lines: string[], start: number): { html: string; next: number } {
  const header = splitTableRow(lines[start]);
  const rows: string[][] = [];
  let index = start + 2;
  while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
    rows.push(splitTableRow(lines[index]));
    index += 1;
  }
  const head = header.map((cell) => `<th>${inlineHtml(cell)}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineHtml(cell)}</td>`).join('')}</tr>`).join('');
  return { html: `<table><thead><tr>${head}</tr></thead>${body ? `<tbody>${body}</tbody>` : ''}</table>`, next: index };
}

function blocksToHtml(lines: string[]): string {
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (/^\uE000\d+\uE000$/.test(line.trim())) {
      out.push(line.trim());
      index += 1;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      out.push(`<h${heading[1].length}>${inlineHtml(heading[2])}</h${heading[1].length}>`);
      index += 1;
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr />');
      index += 1;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      out.push(`<blockquote>${blocksToHtml(quote)}</blockquote>`);
      continue;
    }
    if (isTableStart(lines, index)) {
      const table = renderTable(lines, index);
      out.push(table.html);
      index = table.next;
      continue;
    }
    if (isListLine(line)) {
      const list = parseList(lines, index);
      out.push(list.html);
      index = list.next;
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    out.push(`<p>${paragraph.map(inlineHtml).join('<br />')}</p>`);
  }
  return out.join('\n');
}

export function renderTeachingMarkdown(source: string | null | undefined, options: TeachingMarkdownOptions = {}): string {
  if (source == null || source === '') return '';
  const fragments: string[] = [];
  let text = normalizeLatexDelimiters(String(source));

  // Fenced code first (it may contain backticks), then inline code.
  text = text.replace(
    /(^ {0,3})(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\s*\2[ \t]*$/gm,
    (_match, _indent, _fence, body: string) => `\uE000${fragments.push(`<pre><code>${escapeHtml(body.replace(/\n$/, ''))}</code></pre>`) - 1}\uE000`
  );
  text = text.replace(/(`+)([^`]*?)\1/g, (_match, _tick, body: string) => `\uE000${fragments.push(`<code>${escapeHtml(body)}</code>`) - 1}\uE000`);

  // Display math before inline so `$$…$$` never reads as two empty inline spans.
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_match, body: string) => `\uE000${fragments.push(renderMath(body, true)) - 1}\uE000`);
  text = text.replace(/(?<!\\)\$(?!\s)((?:[^$\\\n]|\\.)+?)(?<![\s\\])\$/g, (_match, body: string) => `\uE000${fragments.push(renderMath(body, false)) - 1}\uE000`);

  const html = options.inline ? inlineHtml(text) : blocksToHtml(text.split('\n'));
  return html.replace(/\uE000(\d+)\uE000/g, (_match, index: string) => fragments[Number(index)] ?? '');
}
