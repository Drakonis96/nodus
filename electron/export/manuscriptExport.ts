// Compile the manuscript into one file you can send.
//
// One file, not a folder: a manuscript is something you email, paste into a document or
// print. Markdown is the diff-friendly form; the PDF is the one you show — and both go
// through `compileManuscript`, which is pure, so the part that ruins a real submission —
// an internal `nodus://` URL left in the middle of a sentence — is tested without opening a
// save dialog.

import fs from 'node:fs';
import path from 'node:path';
import { app, dialog } from 'electron';
import { compileManuscript, type CompileChapter, type ManuscriptCompileOptions } from '@shared/worldManuscript';
import { getDb } from '../db/database';
import { manuscriptSpine } from '../db/worldManuscriptRepo';
import { markdownToHtml } from './markdownRender';
import { professionalReportPdf, type ProfessionalReportSection } from './professionalReportPdf';

/** The vault's own violet, so the artifact looks like the app it came from. */
const WORLDBUILDING_THEME = {
  accent: '#7c3aed',
  accentDark: '#4c1d95',
  accentSoft: '#f5f3ff',
  accentRgb: [124, 58, 237] as [number, number, number],
};

/**
 * The chapters with their prose — the ONE read in this section that loads the whole book,
 * and it happens under an explicit «compilar», never on a screen.
 */
export function buildCompileChapters(): CompileChapter[] {
  const db = getDb();
  const texts = new Map(
    (db.prepare('SELECT scene_id, text FROM world_scene_text').all() as { scene_id: string; text: string | null }[]).map(
      (row) => [row.scene_id, row.text] as const
    )
  );
  const summaries = new Map(
    (db.prepare('SELECT scene_id, summary FROM world_scenes').all() as { scene_id: string; summary: string | null }[]).map(
      (row) => [row.scene_id, row.summary] as const
    )
  );
  return manuscriptSpine().chapters.map((chapter) => ({
    title: chapter.title,
    epigraph: chapter.epigraph,
    scenes: chapter.scenes.map((scene) => ({
      title: scene.title,
      status: scene.status,
      text: texts.get(scene.sceneId) ?? null,
      summary: summaries.get(scene.sceneId) ?? null,
    })),
  }));
}

export function buildManuscriptMarkdown(options: ManuscriptCompileOptions): string {
  return compileManuscript(buildCompileChapters(), options);
}

export async function exportManuscript(
  options: ManuscriptCompileOptions & { format: 'md' | 'pdf' }
): Promise<{ path: string } | null> {
  const markdown = buildManuscriptMarkdown(options);
  const extension = options.format === 'pdf' ? 'pdf' : 'md';
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Exportar el manuscrito',
    defaultPath: path.join(app.getPath('documents'), `${slug(options.title)}.${extension}`),
    filters: [
      options.format === 'pdf' ? { name: 'PDF', extensions: ['pdf'] } : { name: 'Markdown', extensions: ['md'] },
    ],
  });
  if (canceled || !filePath) return null;

  if (options.format === 'pdf') {
    // One section per chapter, each starting on its own page — which is what a chapter is
    // in a printed manuscript.
    const chunks = markdown.split(/\n(?=## )/);
    const sections: ProfessionalReportSection[] = chunks.slice(1).map((chunk, index) => ({
      id: `chapter-${index + 1}`,
      number: String(index + 1),
      title: chunk.match(/^## (.+)$/m)?.[1] ?? `${index + 1}`,
      html: markdownToHtml(chunk.replace(/^## .+$/m, '').trim()),
      pageBreakBefore: index > 0,
    }));
    // A manuscript with no chapter breaks is one section: the book.
    if (sections.length === 0) {
      sections.push({
        id: 'manuscript',
        number: '1',
        title: options.title,
        html: markdownToHtml(chunks[0].replace(/^# .+$/m, '').trim()),
      });
    }
    const bytes = await professionalReportPdf({
      title: options.title,
      kindLabel: 'Manuscrito',
      language: 'es',
      generatedLabel: 'Generado el',
      generatedAt: new Date().toISOString().slice(0, 10),
      contentsLabel: 'Índice',
      metrics: [],
      sections,
      theme: WORLDBUILDING_THEME,
    });
    fs.writeFileSync(filePath, bytes);
  } else {
    fs.writeFileSync(filePath, markdown, 'utf8');
  }
  return { path: filePath };
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'manuscrito'
  );
}
