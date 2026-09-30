/**
 * Word export of a complete study guide. Unlike the generic Markdown → Word path it
 * keeps what a guide is made of: native tables, callout boxes, editable equations
 * (OMML, see mathToDocx.ts), numbered and bulleted lists, figures and an updatable
 * table of contents. Text stays text; a formula Word cannot receive is printed as
 * its LaTeX source.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx';
import { GUIDE_CALLOUT_TYPES } from '@shared/completeGuide/calloutTypes';
import { latexToDocxMath } from './mathToDocx';
import type { DocxImage } from './markdownDocx';

const CALLOUT_COLORS: Record<string, string> = {
  definition: '4F46E5', formula: '7C3AED', rule: '0284C7', procedure: '0F766E', example: '047857', mistake: 'E11D48',
  memorize: 'A16207', selfcheck: '0E7490', web: '475569', 'ai-example': 'B45309', 'ai-analogy': 'B45309', 'ai-mistake': 'B45309',
};
const TINTS: Record<string, string> = {
  '4F46E5': 'EEF2FF', '7C3AED': 'F5F3FF', '0284C7': 'F0F9FF', '0F766E': 'F0FDFA', '047857': 'ECFDF5', 'E11D48': 'FFF1F2',
  A16207: 'FEFCE8', '0E7490': 'ECFEFF', '475569': 'F8FAFC', B45309: 'FFFBEB',
};

type Block = Paragraph | Table;

export interface CompleteGuideDocxOptions {
  title: string;
  contentsLabel: string;
  resolveImage?: (url: string) => DocxImage | null;
}

/** Inline Markdown → runs: `$math$`, **bold**, *italic*, `code`, [label](url). */
export function inlineChildren(text: string, style: { bold?: boolean; color?: string } = {}): ParagraphChild[] {
  const children: ParagraphChild[] = [];
  const pattern = /(\$[^$\n]+?\$)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))/g;
  let cursor = 0;
  const plain = (value: string, extra: Record<string, unknown> = {}) => {
    if (value) children.push(new TextRun({ text: value.replace(/\\\|/g, '|'), ...style, ...extra }));
  };
  for (const match of text.matchAll(pattern)) {
    plain(text.slice(cursor, match.index));
    const token = match[0];
    if (match[1]) {
      const math = latexToDocxMath(token.slice(1, -1));
      if (math) children.push(math); else plain(token.slice(1, -1), { font: 'Consolas' });
    } else if (match[2]) plain(token.slice(2, -2), { bold: true });
    else if (match[3]) plain(token.slice(1, -1), { italics: true });
    else if (match[4]) plain(token.slice(1, -1), { font: 'Consolas' });
    else {
      const link = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)!;
      if (/^https?:\/\//.test(link[2])) children.push(new ExternalHyperlink({ link: link[2], children: [new TextRun({ text: link[1], style: 'Hyperlink' })] }));
      else plain(link[1], { color: '312E81' });
    }
    cursor = (match.index ?? 0) + token.length;
  }
  plain(text.slice(cursor));
  return children.length ? children : [new TextRun('')];
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim());
}

function table(header: string[], rows: string[][]): Table {
  const cell = (text: string, head: boolean) => new TableCell({
    children: [new Paragraph({ children: inlineChildren(text, head ? { bold: true } : {}) })],
    ...(head ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F4F4F5' } } : {}),
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: header.map((value) => cell(value, true)) }),
      ...rows.map((row) => new TableRow({ children: header.map((_, index) => cell(row[index] ?? '', false)) })),
    ],
  });
}

function callout(type: string, title: string, inner: Block[]): Table {
  const color = CALLOUT_COLORS[type] ?? '4F46E5';
  const border = { style: BorderStyle.SINGLE, size: 4, color };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: TINTS[color] ?? 'F8FAFC' },
        borders: { top: border, bottom: border, right: border, left: { style: BorderStyle.SINGLE, size: 24, color } },
        margins: { top: 80, bottom: 80, left: 140, right: 140 },
        children: [new Paragraph({ children: [new TextRun({ text: title.toUpperCase(), bold: true, size: 17, color })] }), ...inner],
      })],
    })],
  });
}

function imageParagraph(image: DocxImage, maxWidth = 600): Paragraph {
  const scale = image.width > maxWidth ? maxWidth / image.width : 1;
  return new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: image.data, transformation: { width: Math.round(image.width * scale), height: Math.round(image.height * scale) } })] });
}

/** Markdown blocks of a guide → Word blocks. Recurses into callouts. */
export function guideBlocks(markdown: string, options: Pick<CompleteGuideDocxOptions, 'resolveImage'> = {}): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    const text = paragraph.join(' ').trim();
    if (text) blocks.push(new Paragraph({ children: inlineChildren(text), spacing: { after: 120 } }));
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const calloutHead = line.match(/^\s*>\s?\[!([a-z][a-z-]*)\][ \t]*(.*)$/);
    if (calloutHead && GUIDE_CALLOUT_TYPES.has(calloutHead[1])) {
      flush();
      const inner: string[] = [];
      while (index + 1 < lines.length && /^\s*>/.test(lines[index + 1])) inner.push(lines[++index].replace(/^\s*>\s?/, ''));
      blocks.push(callout(calloutHead[1], calloutHead[2].trim(), guideBlocks(inner.join('\n'), options)));
      blocks.push(new Paragraph({ children: [], spacing: { after: 60 } }));
      continue;
    }
    if (/^\s*\$\$\s*$/.test(line)) {
      flush();
      const tex: string[] = [];
      while (index + 1 < lines.length && !/^\s*\$\$\s*$/.test(lines[index + 1])) tex.push(lines[++index]);
      index += 1;
      const math = latexToDocxMath(tex.join('\n'), true);
      blocks.push(new Paragraph({ alignment: AlignmentType.CENTER, children: math ? [math] : [new TextRun({ text: tex.join(' '), font: 'Consolas' })] }));
      continue;
    }
    const single = line.match(/^\s*\$\$(.+)\$\$\s*$/);
    if (single) {
      flush();
      const math = latexToDocxMath(single[1], true);
      blocks.push(new Paragraph({ alignment: AlignmentType.CENTER, children: math ? [math] : [new TextRun({ text: single[1], font: 'Consolas' })] }));
      continue;
    }
    if (/^\s*```/.test(line)) {
      flush();
      while (index + 1 < lines.length && !/^\s*```/.test(lines[index + 1])) blocks.push(new Paragraph({ children: [new TextRun({ text: lines[++index], font: 'Consolas', size: 18 })] }));
      index += 1;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      blocks.push(new Paragraph({ children: inlineChildren(heading[2]), heading: level <= 1 ? HeadingLevel.TITLE : level === 2 ? HeadingLevel.HEADING_1 : level === 3 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3 }));
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{1,}/.test(lines[index + 1] ?? '')) {
      flush();
      const header = splitRow(line);
      index += 1;
      const rows: string[][] = [];
      while (index + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[index + 1])) rows.push(splitRow(lines[++index]));
      blocks.push(table(header, rows));
      blocks.push(new Paragraph({ children: [], spacing: { after: 60 } }));
      continue;
    }
    const image = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (image) {
      flush();
      const resolved = options.resolveImage?.(image[2]);
      if (resolved) blocks.push(imageParagraph(resolved));
      else if (image[1].trim()) blocks.push(new Paragraph({ children: inlineChildren(image[1]) }));
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bullet) { flush(); blocks.push(new Paragraph({ children: inlineChildren(bullet[1]), bullet: { level: 0 } })); continue; }
    const numbered = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (numbered) { flush(); blocks.push(new Paragraph({ children: [new TextRun(`${numbered[1]}. `), ...inlineChildren(numbered[2])], indent: { left: 360, hanging: 260 } })); continue; }
    if (!line.trim()) { flush(); continue; }
    paragraph.push(line.trim().replace(/^>\s?/, ''));
  }
  flush();
  return blocks;
}

export async function completeGuideDocx(markdown: string, options: CompleteGuideDocxOptions): Promise<Buffer> {
  const body = markdown.replace(/^#\s+.*\n+/, '');
  const document = new Document({
    features: { updateFields: true },
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{
      children: [
        new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(options.title)] }),
        new TableOfContents(options.contentsLabel, { hyperlink: true, headingStyleRange: '1-2' }),
        ...guideBlocks(body, options),
      ],
    }],
  });
  return Packer.toBuffer(document);
}
