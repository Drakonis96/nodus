import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib';
import { escapeHtml, markdownToHtml } from '@shared/toolkitMarkdown';
import { htmlToPdfBytes } from './htmlToPdf';

export interface ProfessionalReportTheme {
  accent: string;
  accentDark: string;
  accentSoft: string;
  accentRgb: [number, number, number];
}

export interface ProfessionalReportMetric {
  value: string;
  label: string;
}

export interface ProfessionalReportTocItem {
  id: string;
  title: string;
  children?: ProfessionalReportTocItem[];
}

export interface ProfessionalReportSection {
  id: string;
  number: string;
  title: string;
  eyebrow?: string;
  lead?: string;
  html: string;
  tocChildren?: ProfessionalReportTocItem[];
  pageBreakBefore?: boolean;
  className?: string;
}

export interface ProfessionalReportInput {
  title: string;
  subtitle?: string;
  kindLabel: string;
  language: string;
  generatedLabel: string;
  generatedAt: string;
  objectiveLabel?: string;
  objective?: string;
  imageDataUrl?: string | null;
  imageCredit?: string | null;
  metrics?: ProfessionalReportMetric[];
  contentsLabel: string;
  sections: ProfessionalReportSection[];
  theme: ProfessionalReportTheme;
}

export interface AnchoredMarkdown {
  html: string;
  headings: ProfessionalReportTocItem[];
}

const DEEP_THEME: ProfessionalReportTheme = {
  accent: '#4f46e5',
  accentDark: '#312e81',
  accentSoft: '#eef2ff',
  accentRgb: [79 / 255, 70 / 255, 229 / 255],
};

const IMMERSION_THEME: ProfessionalReportTheme = {
  accent: '#0f766e',
  accentDark: '#134e4a',
  accentSoft: '#ecfdf5',
  accentRgb: [15 / 255, 118 / 255, 110 / 255],
};

export const PROFESSIONAL_REPORT_THEMES = {
  deepResearch: DEEP_THEME,
  immersion: IMMERSION_THEME,
} as const;

function slug(value: string, fallback: string): string {
  const clean = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return clean || fallback;
}

function plainInline(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Render the app's Markdown subset and attach stable destinations to its headings. */
export function anchoredMarkdown(markdown: string, prefix: string): AnchoredMarkdown {
  const headings: ProfessionalReportTocItem[] = [];
  const ids: string[] = [];
  const seen = new Map<string, number>();
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (!match) continue;
    const base = `${prefix}-${slug(plainInline(match[2]), 'section')}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const id = count === 1 ? base : `${base}-${count}`;
    ids.push(id);
    if (match[1].length <= 3) headings.push({ id, title: plainInline(match[2]) });
  }
  let index = 0;
  const html = markdownToHtml(markdown).replace(/<h([1-6])>/g, (_match, level: string) => {
    const id = ids[index++] ?? `${prefix}-section-${index}`;
    return `<h${level} id="${escapeHtml(id)}">`;
  });
  return { html, headings };
}

export function reportLink(href: string, label: string, className = ''): string {
  const safeHref = /^(?:https?:\/\/|nodus:\/\/|zotero:\/\/|#)/.test(href) ? href : '#';
  return `<a${className ? ` class="${escapeHtml(className)}"` : ''} href="${escapeHtml(safeHref)}">${escapeHtml(label)}</a>`;
}

export function reportList(items: string[], ordered = false, className = ''): string {
  if (!items.length) return '';
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}${className ? ` class="${escapeHtml(className)}"` : ''}>${items
    .map((item) => `<li>${item}</li>`)
    .join('')}</${tag}>`;
}

function imageIsSafe(dataUrl: string | null | undefined): dataUrl is string {
  return !!dataUrl && /^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(dataUrl);
}

function tocHtml(items: ProfessionalReportTocItem[]): string {
  return `<ol class="toc-list">${items.map((item, index) => {
    const children = item.children?.length
      ? `<ol class="toc-children">${item.children.map((child) =>
          `<li><a href="#${escapeHtml(child.id)}"><span>${escapeHtml(child.title)}</span><i></i></a></li>`
        ).join('')}</ol>`
      : '';
    return `<li>
      <a href="#${escapeHtml(item.id)}"><b>${String(index + 1).padStart(2, '0')}</b><span>${escapeHtml(item.title)}</span><i></i></a>
      ${children}
    </li>`;
  }).join('')}</ol>`;
}

function sectionHtml(section: ProfessionalReportSection): string {
  return `<section id="${escapeHtml(section.id)}" class="report-section ${section.pageBreakBefore ? 'page-break' : ''} ${escapeHtml(section.className ?? '')}">
    <header class="section-heading">
      <span>${escapeHtml(section.number)}</span>
      <div>
        ${section.eyebrow ? `<p>${escapeHtml(section.eyebrow)}</p>` : ''}
        <h2>${escapeHtml(section.title)}</h2>
        ${section.lead ? `<div class="section-lead">${escapeHtml(section.lead)}</div>` : ''}
      </div>
    </header>
    <div class="section-body">${section.html}</div>
  </section>`;
}

export function renderProfessionalReportHtml(input: ProfessionalReportInput): string {
  const image = imageIsSafe(input.imageDataUrl)
    ? `<figure class="cover-image"><img src="${input.imageDataUrl}" alt="" />${input.imageCredit ? `<figcaption>${escapeHtml(input.imageCredit)}</figcaption>` : ''}</figure>`
    : `<div class="cover-motif" aria-hidden="true"><span></span><span></span><span></span><span></span></div>`;
  const metrics = input.metrics?.length
    ? `<div class="cover-metrics">${input.metrics.map((metric) =>
        `<div><strong>${escapeHtml(metric.value)}</strong><span>${escapeHtml(metric.label)}</span></div>`
      ).join('')}</div>`
    : '';
  const tocItems = input.sections.map((section) => ({
    id: section.id,
    title: section.title,
    children: section.tocChildren,
  }));

  return `<!doctype html>
<html lang="${escapeHtml(input.language)}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(input.title)}</title>
  <style>
    @page { size: A4; margin: 20mm 20mm 20mm; }
    * { box-sizing: border-box; }
    :root {
      --accent: ${input.theme.accent};
      --accent-dark: ${input.theme.accentDark};
      --accent-soft: ${input.theme.accentSoft};
      --ink: #182033;
      --muted: #667085;
      --line: #d9deea;
      --paper-soft: #f7f8fb;
    }
    html { color: var(--ink); background: #fff; font-family: Georgia, "Times New Roman", serif; }
    body { margin: 0; font-size: 10.7pt; line-height: 1.62; }
    a { color: var(--accent-dark); text-decoration-color: color-mix(in srgb, var(--accent) 45%, transparent); text-underline-offset: 2px; overflow-wrap: anywhere; }
    p { margin: 0 0 3.8mm; }
    strong { color: #111827; }
    .cover {
      min-height: 245mm;
      display: flex;
      flex-direction: column;
      break-after: page;
      position: relative;
      overflow: hidden;
    }
    .cover-kicker {
      margin-top: 7mm;
      color: var(--accent);
      font: 700 8.3pt/1.2 Arial, sans-serif;
      letter-spacing: .19em;
      text-transform: uppercase;
    }
    .cover-rule { width: 19mm; height: 1.4mm; margin: 5mm 0 8mm; border-radius: 99px; background: var(--accent); }
    .cover h1 {
      max-width: 165mm;
      margin: 0;
      color: var(--ink);
      font: 700 30pt/1.07 Arial, sans-serif;
      letter-spacing: -.035em;
    }
    .cover-subtitle { max-width: 150mm; margin: 5mm 0 0; color: var(--muted); font-size: 13pt; line-height: 1.48; }
    .cover-image { margin: 10mm 0 0; }
    .cover-image img {
      display: block;
      width: 100%;
      height: 91mm;
      object-fit: cover;
      border: .25mm solid #d9deea;
      border-radius: 4mm;
      box-shadow: 0 4mm 12mm rgba(22, 31, 55, .13);
    }
    .cover-image figcaption { margin-top: 2mm; color: var(--muted); font: italic 7.7pt/1.35 Georgia, serif; text-align: right; }
    .cover-motif {
      position: relative;
      height: 74mm;
      margin-top: 11mm;
      overflow: hidden;
      border: .25mm solid color-mix(in srgb, var(--accent) 25%, white);
      border-radius: 4mm;
      background:
        radial-gradient(circle at 22% 24%, color-mix(in srgb, var(--accent) 16%, white) 0 1.5mm, transparent 1.6mm),
        radial-gradient(circle at 72% 68%, color-mix(in srgb, var(--accent) 14%, white) 0 1.2mm, transparent 1.3mm),
        linear-gradient(145deg, var(--accent-soft), #fff 56%, color-mix(in srgb, var(--accent) 8%, white));
    }
    .cover-motif span { position: absolute; height: .35mm; transform-origin: left; background: color-mix(in srgb, var(--accent) 35%, white); }
    .cover-motif span:nth-child(1) { width: 76mm; left: 20mm; top: 19mm; transform: rotate(12deg); }
    .cover-motif span:nth-child(2) { width: 97mm; left: 62mm; top: 36mm; transform: rotate(-17deg); }
    .cover-motif span:nth-child(3) { width: 68mm; left: 27mm; top: 51mm; transform: rotate(-9deg); }
    .cover-motif span:nth-child(4) { width: 58mm; left: 94mm; top: 17mm; transform: rotate(27deg); }
    .cover-meta {
      margin-top: auto;
      padding-top: 8mm;
      border-top: .25mm solid var(--line);
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8mm;
      align-items: end;
    }
    .cover-meta dl { margin: 0; display: grid; grid-template-columns: auto 1fr; column-gap: 3mm; row-gap: 1.2mm; }
    .cover-meta dt { color: var(--muted); font: 700 7.4pt/1.35 Arial, sans-serif; letter-spacing: .08em; text-transform: uppercase; }
    .cover-meta dd { margin: 0; max-width: 110mm; font-size: 9pt; }
    .cover-metrics { display: flex; gap: 2mm; }
    .cover-metrics div { min-width: 22mm; padding: 2.5mm 3mm; border-radius: 2.3mm; background: var(--accent-soft); text-align: center; }
    .cover-metrics strong { display: block; color: var(--accent-dark); font: 700 14pt/1 Arial, sans-serif; }
    .cover-metrics span { display: block; margin-top: 1.2mm; color: var(--muted); font: 700 6.4pt/1.2 Arial, sans-serif; letter-spacing: .06em; text-transform: uppercase; }
    .contents { break-after: page; padding-top: 5mm; }
    .contents-kicker { color: var(--accent); font: 700 8pt/1.2 Arial, sans-serif; letter-spacing: .16em; text-transform: uppercase; }
    .contents h2 { margin: 2mm 0 10mm; font: 700 25pt/1.1 Arial, sans-serif; color: var(--ink); letter-spacing: -.025em; }
    .toc-list, .toc-children { margin: 0; padding: 0; list-style: none; }
    .toc-list > li { padding: 3.1mm 0; border-bottom: .25mm solid var(--line); }
    .toc-list a { display: flex; align-items: baseline; gap: 3mm; color: var(--ink); font: 600 10.3pt/1.35 Arial, sans-serif; text-decoration: none; }
    .toc-list a b { color: var(--accent); font-size: 8pt; letter-spacing: .08em; }
    .toc-list a i { flex: 1; border-bottom: .25mm dotted #c5cad5; }
    .toc-children { margin: 2mm 0 0 12mm; }
    .toc-children li { margin: 1.2mm 0; }
    .toc-children a { color: var(--muted); font-size: 8.6pt; font-weight: 500; }
    .report-section { padding-top: 5mm; }
    .report-section + .report-section { margin-top: 10mm; }
    .report-section.page-break { break-before: page; }
    .section-heading {
      display: grid;
      grid-template-columns: 13mm 1fr;
      gap: 4mm;
      align-items: start;
      margin: 0 0 7mm;
      break-after: avoid;
    }
    .section-heading > span {
      display: grid;
      width: 11mm;
      height: 11mm;
      place-items: center;
      border-radius: 50%;
      background: var(--accent-soft);
      color: var(--accent-dark);
      font: 700 8pt/1 Arial, sans-serif;
    }
    .section-heading p { margin: 0 0 1.3mm; color: var(--accent); font: 700 7pt/1.2 Arial, sans-serif; letter-spacing: .13em; text-transform: uppercase; }
    .section-heading h2 { margin: 0; color: var(--accent-dark); font: 700 20pt/1.15 Arial, sans-serif; letter-spacing: -.02em; }
    .section-lead { max-width: 145mm; margin-top: 2mm; color: var(--muted); font-size: 9.5pt; line-height: 1.48; }
    .section-body { margin-left: 17mm; }
    .prose { color: #262d3d; }
    .prose p { text-align: justify; text-indent: 1.35em; hyphens: auto; orphans: 3; widows: 3; }
    .prose h1, .prose h2, .prose h3, .prose h4 {
      margin: 8mm 0 3mm;
      color: var(--accent-dark);
      font-family: Arial, sans-serif;
      line-height: 1.22;
      break-after: avoid;
    }
    .prose h1 { padding-bottom: 2mm; border-bottom: .35mm solid color-mix(in srgb, var(--accent) 27%, white); font-size: 18pt; }
    .prose h2 { font-size: 15pt; }
    .prose h3 { font-size: 12pt; color: var(--accent); }
    .prose h4 { font-size: 10.5pt; }
    .prose h1:first-child, .prose h2:first-child, .prose h3:first-child { margin-top: 0; }
    .prose h1 + p, .prose h2 + p, .prose h3 + p, .prose li p { text-indent: 0; }
    .prose ul, .prose ol { margin: 0 0 4mm 5mm; padding-left: 5mm; }
    .prose li { margin: 1.2mm 0; padding-left: 1.5mm; text-align: justify; }
    .prose li::marker { color: var(--accent); font-weight: 700; }
    blockquote {
      margin: 5mm 0;
      padding: 4mm 5mm;
      border-left: 1.2mm solid var(--accent);
      border-radius: 0 2.5mm 2.5mm 0;
      background: var(--accent-soft);
      color: #344054;
      font-size: 9.8pt;
      line-height: 1.58;
      break-inside: avoid;
    }
    table { width: 100%; margin: 5mm 0; border-collapse: collapse; table-layout: fixed; font: 7.8pt/1.38 Arial, sans-serif; }
    th { padding: 2.6mm; border: .25mm solid color-mix(in srgb, var(--accent) 23%, #d9deea); background: var(--accent-soft); color: var(--accent-dark); text-align: left; }
    td { padding: 2.6mm; border: .25mm solid var(--line); vertical-align: top; overflow-wrap: anywhere; }
    tr { break-inside: avoid; }
    code { padding: .25mm 1mm; border-radius: 1mm; background: #f1f3f7; font: 8.7pt Consolas, monospace; }
    pre { max-width: 100%; padding: 4mm; overflow-wrap: anywhere; white-space: pre-wrap; border-radius: 2mm; background: #161b2b; color: #f8fafc; }
    .abstract-box, .question-box {
      padding: 6mm;
      border: .25mm solid color-mix(in srgb, var(--accent) 24%, #d9deea);
      border-radius: 3mm;
      background: linear-gradient(145deg, var(--accent-soft), #fff);
    }
    .abstract-box p, .question-box p { text-indent: 0; margin: 0; font-size: 11pt; line-height: 1.7; }
    .question-box { margin-bottom: 5mm; }
    .question-box small { display: block; margin-bottom: 1.5mm; color: var(--accent); font: 700 7pt/1.2 Arial, sans-serif; letter-spacing: .11em; text-transform: uppercase; }
    .outline-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: start;
      gap: 3.5mm;
      margin: 0;
      padding: 0;
      list-style: none;
      counter-reset: outline;
    }
    .outline-list > li { position: relative; padding: 4mm 4mm 4mm 14mm; border: .25mm solid var(--line); border-radius: 2.5mm; break-inside: avoid; counter-increment: outline; }
    .outline-list > li::before { content: counter(outline, decimal-leading-zero); position: absolute; left: 4mm; top: 4.2mm; color: var(--accent); font: 700 8pt Arial, sans-serif; }
    .outline-list h3 { margin: 0; color: var(--ink); font: 700 10.5pt/1.3 Arial, sans-serif; }
    .outline-list p { margin: 1.2mm 0 0; color: var(--muted); font-size: 8.8pt; text-indent: 0; text-align: left; }
    .claim-list { margin: 2mm 0 0; padding-left: 4mm; font-size: 8.3pt; }
    .claim-list li { margin: .7mm 0; }
    .source-pills { display: flex; flex-wrap: wrap; gap: 1.2mm; margin-top: 2mm; }
    .source-pills span { padding: .8mm 1.8mm; border-radius: 99px; background: var(--paper-soft); color: var(--muted); font: 6.8pt/1.2 Arial, sans-serif; }
    .evidence-grid { display: grid; gap: 3mm; }
    .evidence-card { padding: 4mm; border: .25mm solid var(--line); border-left: 1mm solid var(--accent); border-radius: 2mm; break-inside: avoid; }
    .evidence-card > span { color: var(--accent); font: 700 6.8pt/1.2 Arial, sans-serif; letter-spacing: .1em; text-transform: uppercase; }
    .evidence-card h3 { margin: 1.3mm 0 2.5mm; color: var(--ink); font: 700 10pt/1.35 Arial, sans-serif; }
    .evidence-card dl { display: grid; grid-template-columns: 21mm 1fr; gap: 1mm 3mm; margin: 0; font-size: 8.3pt; }
    .evidence-card dt { color: var(--muted); font: 700 6.8pt/1.35 Arial, sans-serif; letter-spacing: .06em; text-transform: uppercase; }
    .evidence-card dd { margin: 0; }
    .term-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; }
    .term-card { padding: 3.5mm; border: .25mm solid var(--line); border-radius: 2mm; break-inside: avoid; }
    .term-card h3 { margin: 0 0 1mm; color: var(--accent-dark); font: 700 9.5pt/1.3 Arial, sans-serif; }
    .term-card p { margin: 0; color: #475467; font-size: 8.5pt; line-height: 1.45; text-indent: 0; text-align: left; }
    .section-body > h3 {
      margin: 6mm 0 2.5mm;
      color: var(--accent-dark);
      font: 700 11pt/1.3 Arial, sans-serif;
      break-after: avoid;
    }
    .source-card { margin: 4mm 0; padding: 4mm; border: .25mm solid var(--line); border-radius: 2.5mm; break-inside: avoid; }
    .source-card blockquote { margin: 0 0 2.5mm; padding: 0 0 0 4mm; border-radius: 0; background: transparent; font-style: italic; }
    .source-card footer { color: var(--muted); font: 7.8pt/1.4 Arial, sans-serif; }
    .source-card .commentary { margin: 2.5mm 0 0; padding-top: 2.5mm; border-top: .25mm solid var(--line); font-size: 8.8pt; text-indent: 0; }
    .takeaway-list { margin-top: 3mm; padding: 4mm 5mm; border-radius: 2.5mm; background: var(--accent-soft); }
    .takeaway-list h3 { margin: 0 0 2mm; color: var(--accent-dark); font: 700 9pt Arial, sans-serif; }
    .takeaway-list ul { margin-bottom: 0; }
    .reference-list { padding-left: 5mm; }
    .reference-list li { margin: 2mm 0; padding-left: 1mm; font-size: 8.7pt; }
    .muted { color: var(--muted); }
    .no-indent, .no-indent p { text-indent: 0 !important; }
    @media print {
      a { color: var(--accent-dark); }
      .report-section, .source-card, .evidence-card, .term-card { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <main>
    <section class="cover">
      <div class="cover-kicker">${escapeHtml(input.kindLabel)}</div>
      <div class="cover-rule"></div>
      <h1>${escapeHtml(input.title)}</h1>
      ${input.subtitle ? `<p class="cover-subtitle">${escapeHtml(input.subtitle)}</p>` : ''}
      ${image}
      <div class="cover-meta">
        <dl>
          <dt>${escapeHtml(input.generatedLabel)}</dt><dd>${escapeHtml(input.generatedAt)}</dd>
          ${input.objectiveLabel && input.objective ? `<dt>${escapeHtml(input.objectiveLabel)}</dt><dd>${escapeHtml(input.objective)}</dd>` : ''}
        </dl>
        ${metrics}
      </div>
    </section>
    <nav class="contents" aria-label="${escapeHtml(input.contentsLabel)}">
      <div class="contents-kicker">NODUS</div>
      <h2>${escapeHtml(input.contentsLabel)}</h2>
      ${tocHtml(tocItems)}
    </nav>
    ${input.sections.map(sectionHtml).join('\n')}
  </main>
</body>
</html>`;
}

function pdfSafe(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fitText(value: string, font: Awaited<ReturnType<PDFDocument['embedFont']>>, size: number, maxWidth: number): string {
  const text = pdfSafe(value);
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && font.widthOfTextAtSize(`${clipped}...`, size) > maxWidth) clipped = clipped.slice(0, -1);
  return `${clipped.trim()}...`;
}

function drawNodusMark(page: PDFPage, centerX: number, y: number, accent: ReturnType<typeof rgb>): void {
  const left = centerX - 6.7;
  const right = centerX + 6.7;
  const bottom = y - 4.8;
  const top = y + 4.8;
  const line = { thickness: 1.55, color: accent, opacity: 0.95 };
  page.drawLine({ start: { x: left, y: bottom }, end: { x: left, y: top }, ...line });
  page.drawLine({ start: { x: left, y: top }, end: { x: right, y: bottom }, ...line });
  page.drawLine({ start: { x: right, y: bottom }, end: { x: right, y: top }, ...line });
  for (const [x, cy] of [[left, bottom], [left, top], [right, bottom], [right, top]] as const) {
    page.drawCircle({ x, y: cy, size: 1.7, color: accent });
  }
}

async function stampProfessionalPdf(bytes: Buffer, input: ProfessionalReportInput): Promise<Buffer> {
  const doc = await PDFDocument.load(bytes);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const accent = rgb(...input.theme.accentRgb);
  const gray = rgb(0.46, 0.49, 0.56);
  const line = rgb(0.84, 0.86, 0.9);
  const pages = doc.getPages();

  doc.setTitle(input.title);
  doc.setAuthor('Nodus');
  doc.setCreator('Nodus');
  doc.setProducer('Nodus Professional PDF');
  doc.setSubject(input.kindLabel);
  doc.setCreationDate(new Date());

  pages.forEach((page, index) => {
    const { width, height } = page.getSize();
    const margin = 56.7;
    const centerX = width / 2;
    const headerY = height - 25;
    page.drawLine({ start: { x: margin, y: height - 39 }, end: { x: centerX - 16, y: height - 39 }, thickness: 0.45, color: line });
    page.drawLine({ start: { x: centerX + 16, y: height - 39 }, end: { x: width - margin, y: height - 39 }, thickness: 0.45, color: line });
    drawNodusMark(page, centerX, headerY, accent);

    page.drawLine({ start: { x: margin, y: 39 }, end: { x: width - margin, y: 39 }, thickness: 0.45, color: line });
    const kind = fitText(input.kindLabel.toUpperCase(), bold, 6.5, 145);
    page.drawText(kind, { x: margin, y: 22, size: 6.5, font: bold, color: gray });
    const brand = 'NODUS';
    const brandWidth = bold.widthOfTextAtSize(brand, 6.5);
    page.drawText(brand, { x: width - margin - brandWidth, y: 22, size: 6.5, font: bold, color: accent });
    const pageLabel = `${index + 1} / ${pages.length}`;
    const pageWidth = regular.widthOfTextAtSize(pageLabel, 7.5);
    page.drawText(pageLabel, { x: centerX - pageWidth / 2, y: 21.5, size: 7.5, font: regular, color: gray });
  });

  return Buffer.from(await doc.save());
}

export async function professionalReportPdf(input: ProfessionalReportInput): Promise<Buffer> {
  const printed = await htmlToPdfBytes(renderProfessionalReportHtml(input));
  return stampProfessionalPdf(printed, input);
}
