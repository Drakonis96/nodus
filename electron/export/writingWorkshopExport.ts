import fs from 'node:fs';
import path from 'node:path';
import { app, dialog } from 'electron';
import type {
  WritingWorkshopDraft,
  WritingWorkshopExportFormat,
  WritingWorkshopExportRequest,
  WritingWorkshopMatrixRow,
} from '@shared/types';
import { markdownToPdf } from './markdownRender';

export async function exportWritingWorkshopDraft(
  request: WritingWorkshopExportRequest
): Promise<{ path: string } | null> {
  const draft = request.draft;
  const requested = request.format ?? 'markdown';
  const base = slug(draft.title || 'taller-escritura');
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Exportar informe',
    defaultPath: path.join(app.getPath('documents'), `${base}.${requested === 'pdf' ? 'pdf' : 'md'}`),
    // Offer both filters so the user can switch format in the native dialog; the
    // final format is decided by the chosen extension (falling back to `requested`).
    filters:
      requested === 'pdf'
        ? [
            { name: 'PDF', extensions: ['pdf'] },
            { name: 'Markdown', extensions: ['md'] },
          ]
        : [
            { name: 'Markdown', extensions: ['md'] },
            { name: 'PDF', extensions: ['pdf'] },
          ],
  });
  if (canceled || !filePath) return null;

  const format: WritingWorkshopExportFormat = path.extname(filePath).toLowerCase() === '.pdf' ? 'pdf' : 'markdown';
  const markdown = renderDraftMarkdown(draft);
  if (format === 'pdf') {
    fs.writeFileSync(filePath, await markdownToPdf(markdown, draft.title || 'Informe'));
  } else {
    fs.writeFileSync(filePath, markdown, 'utf8');
  }
  return { path: filePath };
}

function renderDraftMarkdown(draft: WritingWorkshopDraft): string {
  const parts = [
    `# ${draft.title}`,
    '',
    `Generado: ${draft.generatedAt}`,
    `Tipo: ${draft.brief.kind}`,
    `Objetivo: ${draft.brief.objective}`,
    '',
    '## Resumen',
    draft.abstract,
    '',
    '## Esquema',
    ...draft.outline.flatMap((section, index) => [
      `### ${index + 1}. ${section.title}`,
      section.purpose,
      '',
      ...section.keyClaims.map((claim) => `- ${claim}`),
      ...(section.sources.length ? ['', `Fuentes: ${section.sources.join('; ')}`] : []),
      '',
    ]),
    '## Borrador',
    draft.draftMarkdown,
    '',
    '## Matriz de apoyo',
    matrixTable(draft.matrix),
    '',
    '## Bibliografia sugerida',
    ...(draft.bibliography.length ? draft.bibliography.map((item) => `- ${item}`) : ['- Sin bibliografia generada.']),
    '',
    '## Siguientes pasos',
    ...(draft.nextSteps.length ? draft.nextSteps.map((item) => `- ${item}`) : ['- Revisar el borrador.']),
    '',
    '## Limitaciones',
    ...(draft.limitations.length ? draft.limitations.map((item) => `- ${item}`) : ['- Sin limitaciones declaradas.']),
    '',
  ];
  return parts.join('\n');
}

function matrixTable(rows: WritingWorkshopMatrixRow[]): string {
  if (rows.length === 0) return 'Sin matriz generada.';
  const header = '| Papel | Afirmacion | Fuente | Evidencia | Notas |\n| --- | --- | --- | --- | --- |';
  const body = rows
    .map((row) =>
      [
        row.role,
        row.claim,
        row.citation ? `[${row.sourceLabel || 'fuente'}](${row.citation})` : row.sourceLabel,
        row.evidence,
        row.notes,
      ]
        .map(escapeCell)
        .join(' | ')
    )
    .map((line) => `| ${line} |`)
    .join('\n');
  return `${header}\n${body}`;
}

function escapeCell(value: string): string {
  return (value || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function slug(value: string): string {
  const clean = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return clean || 'taller-escritura';
}
