/**
 * Print HTML for complete study guides: the Deep Research PDF design (cover, contents,
 * numbered sections) with the guide's own needs on top — callout cards, tables and
 * real mathematics. Formulas are rendered by KaTeX to MathML, which Chromium prints
 * natively without JavaScript or font files (the print window runs with JS off).
 *
 * Not imported by shared/deepResearchReport.ts: the Nodus Server bundles that graph
 * and must not carry KaTeX.
 */
import katex from 'katex';
import 'katex/contrib/mhchem';
import { escapeHtml, markdownToHtml } from '../toolkitMarkdown';
import { findMath } from './math';
import { GUIDE_CALLOUT_TYPES } from './calloutTypes';

export interface GuideHtml { html: string; headings: Array<{ id: string; title: string }> }

const TOKEN = (kind: 'M', index: number) => `⟦${kind}${index}⟧`;

function renderMath(tex: string, display: boolean): string {
  const rendered = katex.renderToString(tex, { displayMode: display, output: 'mathml', throwOnError: false, strict: 'ignore', trust: false });
  return display ? `<div class="gm-display">${rendered}</div>` : rendered;
}

function slug(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';
}

/** Markdown of a guide (or one of its sections) → print HTML plus the headings it anchored. */
export function guideMarkdownToHtml(markdown: string, prefix = 'guide', resolveImage?: (url: string) => string | null): GuideHtml {
  const blocks: string[] = [];
  const math: string[] = [];

  // Plain Markdown with its formulas protected from the Markdown converter.
  const renderPlain = (text: string): string => {
    let protectedText = '';
    let cursor = 0;
    for (const span of findMath(text)) {
      protectedText += text.slice(cursor, span.start);
      math.push(renderMath(span.tex, span.display));
      protectedText += span.display ? `\n\n${TOKEN('M', math.length - 1)}\n\n` : TOKEN('M', math.length - 1);
      cursor = span.end;
    }
    protectedText += text.slice(cursor);
    return markdownToHtml(protectedText)
      .replace(/<p>⟦M(\d+)⟧<\/p>/g, (_m, index: string) => math[Number(index)] ?? '')
      .replace(/⟦M(\d+)⟧/g, (_m, index: string) => math[Number(index)] ?? '');
  };

  // Callouts and figures are cut out first (their lines carry `>` and image syntax),
  // then every stretch of ordinary Markdown is rendered on its own.
  const render = (text: string): string => {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const out: string[] = [];
    let plain: string[] = [];
    const flush = () => { if (plain.join('').trim()) out.push(renderPlain(plain.join('\n'))); plain = []; };
    for (let index = 0; index < lines.length; index += 1) {
      const image = lines[index].match(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/);
      const source = image ? (image[2].startsWith('data:image/') ? image[2] : resolveImage?.(image[2]) ?? null) : null;
      if (image && source && /^data:image\/(?:png|jpe?g|webp);base64,/i.test(source)) {
        flush();
        out.push(`<figure class="gf"><img src="${source}" alt="${escapeHtml(image[1].replace(/\\(.)/g, '$1'))}" /></figure>`);
        continue;
      }
      const head = lines[index].match(/^\s*>\s?\[!([a-z][a-z-]*)\][ \t]*(.*)$/);
      if (!head || !GUIDE_CALLOUT_TYPES.has(head[1])) { plain.push(lines[index]); continue; }
      flush();
      const inner: string[] = [];
      while (index + 1 < lines.length && /^\s*>/.test(lines[index + 1])) inner.push(lines[++index].replace(/^\s*>\s?/, ''));
      out.push(`<aside class="gc gc-${head[1]}"><div class="gc-title">${escapeHtml(head[2].trim())}</div>${render(inner.join('\n'))}</aside>`);
    }
    flush();
    return out.join('\n');
  };

  let html = render(markdown);
  void blocks;
  const headings: GuideHtml['headings'] = [];
  const seen = new Map<string, number>();
  html = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_match, level: string, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    const base = `${prefix}-${slug(text)}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const id = count === 1 ? base : `${base}-${count}`;
    if (level === '3') headings.push({ id, title: text });
    return `<h${level} id="${escapeHtml(id)}">${inner}</h${level}>`;
  });
  return { html, headings };
}

/** Styles for the guide inside the professional report (and the standalone review sheet). */
export const GUIDE_PRINT_CSS = `
  math { font-family: "STIX Two Math", "Cambria Math", "Latin Modern Math", "Noto Sans Math", "DejaVu Serif", serif; font-size: 1.05em; }
  .gm-display { margin: 2.5mm 0; text-align: center; break-inside: avoid; }
  .gm-display math { display: inline-block; font-size: 1.12em; }
  .guide-prose .gm-display + p { text-indent: 0; }
  .gc { margin: 3mm 0; padding: 2.4mm 3.6mm 2.6mm; border: .3mm solid #c7d2fe; border-left: 1.2mm solid var(--gc, #4f46e5); border-radius: 1.6mm;
        background: color-mix(in srgb, var(--gc, #4f46e5) 7%, white); break-inside: avoid; print-color-adjust: exact; -webkit-print-color-adjust: exact; text-indent: 0; }
  .gc p { text-indent: 0 !important; margin: 1mm 0; }
  .gc-title { margin-bottom: 1mm; color: var(--gc, #4f46e5); font: 700 7.6pt Arial, sans-serif; letter-spacing: .03em; text-transform: uppercase; }
  .gc-definition { --gc: #4f46e5; } .gc-formula { --gc: #7c3aed; } .gc-rule { --gc: #0284c7; } .gc-procedure { --gc: #0f766e; }
  .gc-example { --gc: #047857; } .gc-mistake { --gc: #e11d48; } .gc-memorize { --gc: #a16207; } .gc-selfcheck { --gc: #0e7490; } .gc-web { --gc: #475569; }
  .gc-ai-example, .gc-ai-analogy, .gc-ai-mistake { --gc: #b45309; border-style: dashed; border-left-style: solid; }
  .guide-prose table { width: 100%; border-collapse: collapse; margin: 2.5mm 0; font-size: 8.4pt; break-inside: auto; }
  .guide-prose th, .guide-prose td { border: .25mm solid #d4d4d8; padding: 1.2mm 1.8mm; vertical-align: top; text-align: left; text-indent: 0; }
  .guide-prose th { background: #f4f4f5; font-weight: 700; }
  .guide-prose tr { break-inside: avoid; }
  .guide-prose h3 { break-after: avoid; }
  .gf { margin: 3mm 0 1mm; text-align: center; break-inside: avoid; }
  .gf img { max-width: 100%; max-height: 110mm; }
  .guide-prose a[href="#"] { color: var(--accent-dark, #312e81); text-decoration: none; font-size: .88em; }
`;

/** A compact, two-column review sheet: no cover, the formulas and key points only. */
export function reviewSheetHtml(input: { title: string; subtitle: string; markdown: string; language: string }): string {
  const body = guideMarkdownToHtml(input.markdown.replace(/^#\s+.*\n+/, ''), 'sheet');
  return `<!doctype html>
<html lang="${escapeHtml(input.language)}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(input.title)}</title>
<style>
  @page { size: A4; margin: 11mm 11mm 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #18181b; font: 9.2pt/1.36 Georgia, "Times New Roman", "Noto Serif", "Noto Serif CJK SC", serif; }
  header { margin-bottom: 4mm; padding-bottom: 2mm; border-bottom: .6mm solid #4f46e5; }
  header h1 { margin: 0; font: 700 14pt Arial, sans-serif; color: #312e81; }
  header p { margin: .8mm 0 0; font: 8pt Arial, sans-serif; color: #52525b; }
  .sheet { column-count: 2; column-gap: 7mm; column-rule: .2mm solid #e4e4e7; }
  .sheet h3 { margin: 3mm 0 1.2mm; font: 700 10pt Arial, sans-serif; color: #312e81; break-after: avoid; column-span: none; }
  .sheet p, .sheet li { margin: .6mm 0; }
  .sheet ul { margin: .5mm 0 1.5mm; padding-left: 4mm; }
  ${GUIDE_PRINT_CSS}
</style>
</head>
<body>
  <header><h1>${escapeHtml(input.title)}</h1><p>${escapeHtml(input.subtitle)}</p></header>
  <main class="sheet guide-prose">${body.html}</main>
</body>
</html>`;
}
