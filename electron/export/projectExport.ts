import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type {
  ChapterExportFormat,
  CitationRef,
  ExportProjectChapterRequest,
  ExportProjectRequest,
  ProjectDetail,
  ProjectInsertionSuggestion,
} from '@shared/types';
import * as projects from '../db/projectsRepo';

export async function exportProject(request: ExportProjectRequest): Promise<{ path: string } | null> {
  const detail = projects.getProjectDetail(request.projectId);
  if (!detail) return null;
  const ext = request.format === 'json' ? 'json' : 'md';
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Exportar proyecto',
    defaultPath: path.join(app.getPath('documents'), `${slug(detail.project.title)}-proyecto.${ext}`),
    filters: [
      request.format === 'json'
        ? { name: 'JSON', extensions: ['json'] }
        : { name: 'Markdown', extensions: ['md'] },
    ],
  });
  if (canceled || !filePath) return null;

  const payload = buildProjectPayload(detail);
  const content = request.format === 'json'
    ? JSON.stringify(payload, null, 2)
    : renderProjectMarkdown(payload);
  fs.writeFileSync(filePath, content, 'utf8');
  return { path: filePath };
}

export async function exportProjectChapter(
  request: ExportProjectChapterRequest
): Promise<{ path: string } | null> {
  const chapter = projects.getChapter(request.chapterId);
  if (!chapter) return null;
  const ext = request.format === 'markdown' ? 'md' : request.format;
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Exportar capitulo',
    defaultPath: path.join(app.getPath('documents'), `${slug(chapter.title)}.${ext}`),
    filters: [filterForChapter(request.format)],
  });
  if (canceled || !filePath) return null;

  const markdown = chapter.currentMarkdown;
  if (request.format === 'markdown') {
    fs.writeFileSync(filePath, markdown, 'utf8');
  } else if (request.format === 'txt') {
    fs.writeFileSync(filePath, markdownToPlainText(markdown), 'utf8');
  } else if (request.format === 'docx') {
    fs.writeFileSync(filePath, await markdownToDocx(markdown));
  } else {
    fs.writeFileSync(filePath, await markdownToPdf(markdown, chapter.title));
  }
  return { path: filePath };
}

function filterForChapter(format: ChapterExportFormat): Electron.FileFilter {
  switch (format) {
    case 'markdown':
      return { name: 'Markdown', extensions: ['md'] };
    case 'txt':
      return { name: 'Texto plano', extensions: ['txt'] };
    case 'docx':
      return { name: 'Word', extensions: ['docx'] };
    case 'pdf':
      return { name: 'PDF', extensions: ['pdf'] };
  }
}

function buildProjectPayload(detail: ProjectDetail) {
  return {
    exportedAt: new Date().toISOString(),
    project: detail.project,
    stats: detail.stats,
    sections: detail.sections,
    links: detail.links,
    chapters: detail.chapters.map((chapter) => ({
      ...chapter,
      chunks: projects.listChapterChunks(chapter.id),
      suggestions: projects.listSuggestions(chapter.id),
      versions: projects.listChapterVersions(chapter.id),
    })),
  };
}

function renderProjectMarkdown(payload: ReturnType<typeof buildProjectPayload>): string {
  const parts: string[] = [
    `# ${payload.project.title}`,
    '',
    `Estado: ${payload.project.status}`,
    `Tipo: ${payload.project.kind}`,
    payload.project.targetWords ? `Objetivo: ${payload.project.targetWords} palabras` : '',
    '',
    '## Brief',
    payload.project.brief || 'Sin brief.',
    '',
    '## Secciones',
  ].filter(Boolean);

  for (const section of payload.sections) {
    parts.push('', `### ${section.title}`, `Rol: ${section.role} · Estado: ${section.status}`);
    const links = payload.links.filter((link) => link.sectionId === section.id);
    if (links.length) {
      parts.push('', '**Materiales vinculados:**');
      parts.push(...links.map((link) => `- ${link.kind}: ${link.label} (${link.role})`));
    }
  }

  parts.push('', '## Capitulos');
  for (const chapter of payload.chapters) {
    parts.push('', `### ${chapter.title}`, `Palabras: ${chapter.wordCount}`);
    parts.push(`Sugerencias: ${chapter.suggestions.length} · Versiones: ${chapter.versions.length}`);
    parts.push('', chapter.currentMarkdown);
    if (chapter.suggestions.length) parts.push('', renderSuggestions(chapter.suggestions));
  }
  parts.push('');
  return parts.join('\n');
}

function renderSuggestions(suggestions: ProjectInsertionSuggestion[]): string {
  const rows = suggestions.map((suggestion) =>
    `- ${suggestion.status}: ${suggestion.refLabel} (${Math.round(suggestion.confidence * 100)}%) - ${suggestion.rationale}`
  );
  return ['**Sugerencias de insercion:**', ...rows].join('\n');
}

function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\((nodus:\/\/[^)]+)\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}

async function markdownToDocx(markdown: string): Promise<Buffer> {
  const children = markdownToDocxParagraphs(markdown);
  const refs = collectCitations(markdown);
  if (refs.length) {
    children.push(new Paragraph({ text: 'Bibliografia Nodus', heading: HeadingLevel.HEADING_1 }));
    for (const ref of refs) {
      children.push(new Paragraph({ text: `${ref.label} - ${ref.url}`, bullet: { level: 0 } }));
    }
  }
  const document = new Document({ sections: [{ children }] });
  return Packer.toBuffer(document);
}

function markdownToDocxParagraphs(markdown: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const lines = markdown.split(/\r?\n/);
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join(' ').trim();
    if (text) paragraphs.push(new Paragraph({ children: inlineRuns(text) }));
    buffer = [];
  };

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (!line.trim()) {
      flush();
      continue;
    }
    if (heading) {
      flush();
      paragraphs.push(new Paragraph({ text: stripMarkdownLinks(heading[2]), heading: headingLevel(heading[1].length) }));
      continue;
    }
    if (bullet) {
      flush();
      paragraphs.push(new Paragraph({ children: inlineRuns(bullet[1]), bullet: { level: 0 } }));
      continue;
    }
    buffer.push(line.trim());
  }
  flush();
  return paragraphs.length ? paragraphs : [new Paragraph('')];
}

function inlineRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const re = /\[([^\]]+)\]\((nodus:\/\/[^)]+)\)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > cursor) runs.push(new TextRun(stripInlineMarkdown(text.slice(cursor, match.index))));
    runs.push(new TextRun({ text: stripInlineMarkdown(match[1]), italics: false }));
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) runs.push(new TextRun(stripInlineMarkdown(text.slice(cursor))));
  return runs.length ? runs : [new TextRun('')];
}

function headingLevel(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  if (level <= 1) return HeadingLevel.HEADING_1;
  if (level === 2) return HeadingLevel.HEADING_2;
  if (level === 3) return HeadingLevel.HEADING_3;
  if (level === 4) return HeadingLevel.HEADING_4;
  if (level === 5) return HeadingLevel.HEADING_5;
  return HeadingLevel.HEADING_6;
}

async function markdownToPdf(markdown: string, title: string): Promise<Buffer> {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderHtml(markdown, title))}`);
    return await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
  } finally {
    win.destroy();
  }
}

function renderHtml(markdown: string, title: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font: 12pt Georgia, serif; line-height: 1.55; color: #171717; margin: 42px; }
    h1, h2, h3 { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.2; }
    h1 { font-size: 24pt; margin-top: 0; }
    h2 { font-size: 17pt; margin-top: 28px; }
    h3 { font-size: 14pt; margin-top: 22px; }
    a { color: #1f4fbf; text-decoration: none; }
    blockquote { margin-left: 0; padding-left: 14px; border-left: 3px solid #bbb; color: #444; }
  </style>
</head>
<body>${markdownToHtml(markdown)}</body>
</html>`;
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  let paragraph: string[] = [];
  let inList = false;
  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${inlineHtml(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(6, heading[1].length);
      out.push(`<h${level}>${inlineHtml(heading[2])}</h${level}>`);
      continue;
    }
    if (bullet) {
      flushParagraph();
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inlineHtml(bullet[1])}</li>`);
      continue;
    }
    closeList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  closeList();
  const refs = collectCitations(markdown);
  if (refs.length) {
    out.push('<h1>Bibliografia Nodus</h1>', '<ul>');
    for (const ref of refs) out.push(`<li>${escapeHtml(ref.label)} - ${escapeHtml(ref.url)}</li>`);
    out.push('</ul>');
  }
  return out.join('\n');
}

function inlineHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((nodus:\/\/[^)]+)\)/g, (_full, label: string, url: string) =>
      `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`
    );
}

function collectCitations(markdown: string): { label: string; url: string; ref: CitationRef }[] {
  const out: { label: string; url: string; ref: CitationRef }[] = [];
  const seen = new Set<string>();
  const re = /\[([^\]]+)\]\(nodus:\/\/(idea|work|gap|contradiction|passage)\/([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const ref = { kind: match[2] as CitationRef['kind'], id: decodeURIComponent(match[3]) };
    const url = `nodus://${ref.kind}/${encodeURIComponent(ref.id)}`;
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: stripInlineMarkdown(match[1]), url, ref });
  }
  return out;
}

function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\((nodus:\/\/[^)]+)\)/g, '$1');
}

function stripInlineMarkdown(text: string): string {
  return stripMarkdownLinks(text).replace(/[*_`]/g, '');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slug(value: string): string {
  const clean = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return clean || 'proyecto';
}
