import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Server-side export deliberately uses the already pinned pdf-lib dependency. It does not
// execute report HTML, load remote URLs, or invoke a browser process: report text is the only
// input, which keeps an authenticated private export safe on small server installations.
function text(value) {
  return String(value ?? '').replace(/\r/g, '').trim();
}

function pdfSafe(value) {
  return text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
}

// The server's dependency-light PDF path cannot import the TypeScript report catalogue.
// Keep its small set of structural headings explicit so a Spanish report is not silently
// labelled in Spanish when the report itself was generated in another supported language.
const PDF_LABELS = {
  es: { outline: 'Esquema de investigación', next: 'Siguientes pasos', limitations: 'Limitaciones', bibliography: 'Bibliografía', empty: 'Informe sin contenido.', cover: 'Informe Deep Research' },
  en: { outline: 'Research outline', next: 'Next steps', limitations: 'Limitations', bibliography: 'Bibliography', empty: 'Report has no content.', cover: 'Deep Research report' },
  fr: { outline: 'Plan de recherche', next: 'Prochaines étapes', limitations: 'Limites', bibliography: 'Bibliographie', empty: 'Le rapport ne contient aucun contenu.', cover: 'Rapport Deep Research' },
  de: { outline: 'Forschungsstruktur', next: 'Nächste Schritte', limitations: 'Einschränkungen', bibliography: 'Bibliografie', empty: 'Der Bericht enthält keinen Inhalt.', cover: 'Deep-Research-Bericht' },
  pt: { outline: 'Esquema de investigação', next: 'Próximos passos', limitations: 'Limitações', bibliography: 'Bibliografia', empty: 'O relatório não contém conteúdo.', cover: 'Relatório Deep Research' },
  'pt-BR': { outline: 'Estrutura da pesquisa', next: 'Próximos passos', limitations: 'Limitações', bibliography: 'Bibliografia', empty: 'O relatório não contém conteúdo.', cover: 'Relatório Deep Research' },
  it: { outline: 'Schema della ricerca', next: 'Passi successivi', limitations: 'Limiti', bibliography: 'Bibliografia', empty: 'Il report non contiene contenuti.', cover: 'Report Deep Research' },
  tr: { outline: 'Araştırma planı', next: 'Sonraki adımlar', limitations: 'Sınırlamalar', bibliography: 'Kaynakça', empty: 'Raporda içerik yok.', cover: 'Deep Research raporu' },
};

function pdfLanguage(value) {
  if (value === 'pt-BR') return value;
  return Object.prototype.hasOwnProperty.call(PDF_LABELS, value) ? value : 'en';
}

function reportText(draft, labels) {
  const sections = [];
  const title = text(draft?.title);
  const abstract = text(draft?.abstract);
  const body = text(draft?.draftMarkdown || draft?.markdown || draft?.content);
  if (title) sections.push(title);
  if (abstract) sections.push(abstract);
  if (body) sections.push(body);
  const list = (label, value) => {
    const values = Array.isArray(value) ? value.map(text).filter(Boolean) : [];
    if (values.length) sections.push(`${label}\n${values.map((entry) => `• ${entry}`).join('\n')}`);
  };
  list(labels.next, draft?.nextSteps);
  list(labels.limitations, draft?.limitations);
  return sections.join('\n\n') || labels.empty;
}

function cleanInline(value) {
  return text(value).replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(```|~~~)/g, '').replace(/[*_~]/g, '').replace(/^>\s?/, '').trim();
}

/** Preserve the document's reading hierarchy without executing or embedding its HTML. */
function reportBlocks(draft, labels) {
  const blocks = [];
  const addMarkdown = (value) => {
    const lines = text(value).split('\n');
    let paragraph = [];
    const flush = () => { if (paragraph.length) { blocks.push({ type: 'paragraph', value: paragraph.join(' ') }); paragraph = []; } };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { flush(); continue; }
      const heading = /^(#{1,4})\s+(.+)$/.exec(line);
      if (heading) { flush(); blocks.push({ type: 'heading', level: heading[1].length, value: cleanInline(heading[2]) }); continue; }
      const bullet = /^[-*+]\s+(.+)$/.exec(line);
      if (bullet) { flush(); blocks.push({ type: 'bullet', value: cleanInline(bullet[1]) }); continue; }
      paragraph.push(cleanInline(line));
    }
    flush();
  };
  if (text(draft?.abstract)) blocks.push({ type: 'abstract', value: cleanInline(draft.abstract) });
  if (Array.isArray(draft?.outline) && draft.outline.length) {
    blocks.push({ type: 'heading', level: 2, value: labels.outline });
    for (const entry of draft.outline) {
      const title = cleanInline(entry?.title || entry?.name);
      const focus = cleanInline(entry?.focus || entry?.purpose);
      if (title) blocks.push({ type: 'bullet', value: focus ? `${title} - ${focus}` : title });
    }
  }
  addMarkdown(draft?.draftMarkdown || draft?.markdown || draft?.content);
  for (const [label, value] of [[labels.next, draft?.nextSteps], [labels.limitations, draft?.limitations], [labels.bibliography, draft?.bibliography]]) {
    if (!Array.isArray(value) || !value.length) continue;
    blocks.push({ type: 'heading', level: 2, value: label });
    value.map(cleanInline).filter(Boolean).forEach((entry) => blocks.push({ type: 'bullet', value: entry }));
  }
  return blocks.length ? blocks : [{ type: 'paragraph', value: labels.empty }];
}

function wrap(value, font, size, maxWidth) {
  const words = pdfSafe(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line); line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/**
 * Produce a valid, text-searchable PDF for a report. This is intentionally a conservative
 * fallback export; the styled HTML document remains available for browser printing.
 */
export async function deepResearchPdfBytes(draft, { author = 'Nodus', subject = 'Deep Research', language } = {}) {
  const locale = pdfLanguage(language || draft?.brief?.language || draft?.language);
  const labels = PDF_LABELS[locale];
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 54;
  const maxWidth = pageWidth - margin * 2;
  const bodySize = 10;
  const lineHeight = 14;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  const ensureSpace = (height = lineHeight) => {
    if (y - height < margin) { page = pdf.addPage([pageWidth, pageHeight]); y = pageHeight - margin; }
  };
  const drawParagraph = (value, font = regular, size = bodySize, gap = 9, indent = 0, color = rgb(0.12, 0.14, 0.18)) => {
    for (const line of String(value ?? '').split('\n')) {
      const lines = wrap(line, font, size, maxWidth - indent);
      for (const wrapped of lines) { ensureSpace(lineHeight); page.drawText(wrapped, { x: margin + indent, y, size, font, color }); y -= lineHeight; }
      y -= gap / 2;
    }
  };
  const rawTitle = pdfSafe(draft?.title) || labels.cover;
  const titleLines = wrap(rawTitle, bold, 22, maxWidth);
  for (const line of titleLines) { page.drawText(line, { x: margin, y, size: 22, font: bold, color: rgb(0.12, 0.24, 0.46) }); y -= 27; }
  y -= 8;
  page.drawText('NODUS · Deep Research', { x: margin, y, size: 9, font: bold, color: rgb(0.25, 0.48, 0.55) });
  y -= 25;
  for (const block of reportBlocks(draft, labels)) {
    if (block.type === 'heading') {
      ensureSpace(28); y -= 8;
      drawParagraph(block.value, bold, block.level === 1 ? 16 : 13, 5, 0, rgb(0.12, 0.24, 0.46));
    } else if (block.type === 'abstract') {
      drawParagraph(block.value, regular, 11, 10, 0, rgb(0.28, 0.32, 0.38));
    } else if (block.type === 'bullet') {
      drawParagraph(`• ${block.value}`, regular, bodySize, 4, 8);
    } else {
      drawParagraph(block.value);
    }
  }
  pdf.setTitle(rawTitle.slice(0, 240));
  pdf.setAuthor(author);
  pdf.setSubject(subject);
  pdf.setCreator('Nodus Server');
  pdf.setProducer('Nodus Server · pdf-lib');
  pdf.setCreationDate(new Date());
  return Buffer.from(await pdf.save());
}
