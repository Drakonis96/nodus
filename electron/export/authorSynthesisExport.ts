// Export the cached author syntheses ("Ficha de autor") to Markdown or PDF. Each
// author becomes a section headed by their full name, followed by the central
// thesis, the "what to remember" bullets and the positioning paragraph. The set
// is either an explicit selection or every author that currently has a synthesis.
import { app, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AuthorSynthesisExportRequest } from '@shared/types';
import { getDb } from '../db/database';
import { splitName } from '../ai/authorDossier';
import { markdownToPdf } from './markdownRender';

export interface SynthRow {
  author_id: string;
  name: string;
  affiliation: string | null;
  thesis: string;
  remember_json: string;
  positioning: string;
  generated_at: string;
}

function loadSyntheses(authorIds: string[]): SynthRow[] {
  const db = getDb();
  const base =
    `SELECT s.author_id, a.name, a.affiliation, s.thesis, s.remember_json, s.positioning, s.generated_at
       FROM author_dossier_synthesis s JOIN authors a ON a.author_id = s.author_id`;
  if (authorIds.length > 0) {
    const placeholders = authorIds.map(() => '?').join(',');
    return db.prepare(`${base} WHERE s.author_id IN (${placeholders})`).all(...authorIds) as SynthRow[];
  }
  return db.prepare(base).all() as SynthRow[];
}

export function renderSynthesesMarkdown(rows: SynthRow[]): string {
  // Order by surname for a stable, readable document.
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  const out: string[] = ['# Síntesis de autores', '', `*Nodus · ${new Date().toLocaleDateString()}*`, ''];
  for (const row of sorted) {
    const { fullName } = splitName(row.name);
    let remember: string[] = [];
    try {
      const parsed = JSON.parse(row.remember_json);
      if (Array.isArray(parsed)) remember = parsed.filter((r): r is string => typeof r === 'string');
    } catch {
      remember = [];
    }
    out.push('---', '', `# ${fullName || row.name}`);
    if (row.affiliation) out.push(`*${row.affiliation}*`);
    out.push('');
    if (row.thesis) out.push('## Tesis central', '', row.thesis, '');
    if (remember.length) {
      out.push('## Qué recordar', '');
      for (const r of remember) out.push(`- ${r}`);
      out.push('');
    }
    if (row.positioning) out.push('## Cómo se relaciona', '', row.positioning, '');
  }
  return out.join('\n');
}

export async function exportAuthorSyntheses(
  request: AuthorSynthesisExportRequest
): Promise<{ path: string } | null> {
  const rows = loadSyntheses(request.authorIds ?? []);
  if (rows.length === 0) throw new Error('No hay síntesis generadas para exportar.');

  const markdown = renderSynthesesMarkdown(rows);
  const single = rows.length === 1 ? splitName(rows[0].name).fullName || rows[0].name : null;
  const baseName = single
    ? `sintesis-${single.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}`
    : 'sintesis-autores';
  const ext = request.format === 'pdf' ? 'pdf' : 'md';

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Exportar síntesis de autores',
    defaultPath: path.join(app.getPath('documents'), `${baseName}.${ext}`),
    filters: [
      request.format === 'pdf'
        ? { name: 'PDF', extensions: ['pdf'] }
        : { name: 'Markdown', extensions: ['md'] },
    ],
  });
  if (canceled || !filePath) return null;

  if (request.format === 'pdf') {
    fs.writeFileSync(filePath, await markdownToPdf(markdown, single ?? 'Síntesis de autores'));
  } else {
    fs.writeFileSync(filePath, markdown, 'utf8');
  }
  return { path: filePath };
}
