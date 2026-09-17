import fs from 'node:fs';
import { dialogTitle } from '../dialogTitles';
import path from 'node:path';
import { app, dialog } from 'electron';
import type {
  ChapterExportFormat,
  ExportProjectChapterRequest,
  ExportProjectRequest,
  ProjectDetail,
  ProjectInsertionSuggestion,
} from '@shared/types';
import * as projects from '../db/projectsRepo';
import { markdownToPdf, stripMarkdownLinks } from './markdownRender';
import { markdownToDocx } from './markdownDocx';
import { getSettings } from '../db/settingsRepo';

// The Word renderer lives in its own module now; re-exported so the study export and
// anything else that already imported it from here keeps working.
export { markdownToDocx, pngSize, type DocxImage, type DocxOptions } from './markdownDocx';

export async function exportProject(request: ExportProjectRequest): Promise<{ path: string } | null> {
  const detail = projects.getProjectDetail(request.projectId);
  if (!detail) return null;
  const ext = request.format === 'json' ? 'json' : 'md';
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: dialogTitle('exportProject', getSettings().uiLanguage),
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
    title: dialogTitle('exportChapter', getSettings().uiLanguage),
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
      return { name: dialogTitle('plainText', getSettings().uiLanguage), extensions: ['txt'] };
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

export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\((nodus:\/\/[^)]+)\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
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
