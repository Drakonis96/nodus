// Export the encyclopedia as a "world bible": one document, handed to a co-author, an
// editor or a reader.
//
// One file, not a folder. A bible is something you send, paste into a document or print;
// an Obsidian-shaped vault of one file per entry is a different product and a different
// request. Markdown is the AI- and diff-friendly form; the PDF is the one you show.

import fs from 'node:fs';
import path from 'node:path';
import { app, dialog } from 'electron';
import type { WorldBibleOptions } from '@shared/types';
import {
  renderWorldBibleMarkdown,
  renderWorldBibleSections,
  selectBibleEntries,
  type WorldBibleDoc,
  type WorldBibleEntry,
} from '@shared/worldBibleDoc';
import { markdownToHtml } from './markdownRender';
import { professionalReportPdf, type ProfessionalReportSection } from './professionalReportPdf';
import { getWorldEntry, getWorldArticle, listWorldEntries } from '../db/worldEncyclopediaRepo';

/** The vault's own violet, so the artifact looks like the app it came from. */
const WORLDBUILDING_THEME = {
  accent: '#7c3aed',
  accentDark: '#4c1d95',
  accentSoft: '#f5f3ff',
  accentRgb: [124, 58, 237] as [number, number, number],
};

export function buildWorldBibleDoc(options: WorldBibleOptions): WorldBibleDoc {
  const selected = selectBibleEntries(listWorldEntries(), options);
  const entries: WorldBibleEntry[] = [];
  for (const entry of selected) {
    const detail = getWorldEntry({ kind: entry.kind, id: entry.id });
    if (!detail) continue;
    const article = entry.kind === 'article' ? getWorldArticle(entry.id) : null;
    entries.push({
      entry,
      body: detail.body,
      facts: detail.facts,
      backlinks: detail.backlinks
        .filter((link) => link.source)
        .map((link) => ({ key: `${link.source.kind}:${link.source.id}`, title: link.sourceTitle })),
      notes: article?.notes ?? null,
      proposedBody: detail.proposedBody,
    });
  }
  return {
    title: options.title || 'La biblia del mundo',
    generatedAt: new Date().toISOString().slice(0, 10),
    entries,
  };
}

export async function exportWorldBible(options: WorldBibleOptions): Promise<{ path: string } | null> {
  const doc = buildWorldBibleDoc(options);
  const extension = options.format === 'pdf' ? 'pdf' : 'md';
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Exportar la biblia del mundo',
    defaultPath: path.join(app.getPath('documents'), `${slug(doc.title)}.${extension}`),
    filters: [
      options.format === 'pdf'
        ? { name: 'PDF', extensions: ['pdf'] }
        : { name: 'Markdown', extensions: ['md'] },
    ],
  });
  if (canceled || !filePath) return null;

  if (options.format === 'pdf') {
    const sections: ProfessionalReportSection[] = renderWorldBibleSections(doc, options, markdownToHtml).map(
      (section) => ({
        id: section.id,
        number: section.number,
        title: section.title,
        html: section.html,
        tocChildren: section.tocChildren,
        pageBreakBefore: section.number !== '1',
      })
    );
    const bytes = await professionalReportPdf({
      title: doc.title,
      kindLabel: 'Biblia del mundo',
      language: 'es',
      generatedLabel: 'Generado el',
      generatedAt: doc.generatedAt,
      contentsLabel: 'Índice',
      metrics: [{ value: String(doc.entries.length), label: 'entradas' }],
      sections,
      theme: WORLDBUILDING_THEME,
    });
    fs.writeFileSync(filePath, bytes);
  } else {
    fs.writeFileSync(filePath, renderWorldBibleMarkdown(doc, options), 'utf8');
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
      .slice(0, 60) || 'biblia-del-mundo'
  );
}
