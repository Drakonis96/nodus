import fs from 'node:fs';
import path from 'node:path';
import { app, dialog } from 'electron';
import type { RqCoverageStatus, RqExportRequest, RqSubQuestion } from '@shared/types';
import { getResearchQuestionDetail } from '../db/researchMapRepo';

const STATUS_LABEL: Record<RqCoverageStatus, string> = {
  covered: 'Bien cubierta',
  partial: 'Parcial',
  uncovered: 'Sin cubrir',
  disputed: 'En disputa',
};

export async function exportResearchCoverage(request: RqExportRequest): Promise<{ path: string } | null> {
  const detail = getResearchQuestionDetail(request.rqId);
  if (!detail) return null;

  const filename = `${slug(detail.rq.question || 'mapa-cobertura')}.md`;
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Exportar mapa de cobertura',
    defaultPath: path.join(app.getPath('documents'), filename),
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (canceled || !filePath) return null;

  fs.writeFileSync(filePath, renderMarkdown(detail), 'utf8');
  return { path: filePath };
}

function renderMarkdown(detail: ReturnType<typeof getResearchQuestionDetail>): string {
  if (!detail) return '';
  const { rq, subQuestions, summary, stale } = detail;
  const parts: string[] = [
    `# Mapa de cobertura`,
    '',
    `**Pregunta:** ${rq.question}`,
    rq.notes ? `\n**Notas:** ${rq.notes}` : '',
    '',
    `Estado: ${rq.status}${rq.mappedAt ? ` · Mapeado: ${rq.mappedAt}` : ''}${stale ? ' · ⚠ desactualizado (el corpus creció)' : ''}`,
    '',
    '## Resumen de cobertura',
    `- Bien cubierta: ${summary.covered}`,
    `- Parcial: ${summary.partial}`,
    `- Sin cubrir: ${summary.uncovered}`,
    `- En disputa: ${summary.disputed}`,
    `- Sin mapear: ${summary.unmapped}`,
    '',
    '## Sub-preguntas',
  ];

  subQuestions.forEach((sq, index) => {
    parts.push('', `### ${index + 1}. ${sq.text}`);
    if (sq.coverageStatus) parts.push(`Estado: **${STATUS_LABEL[sq.coverageStatus]}**`);
    if (sq.rationale) parts.push(`_${sq.rationale}_`);
    if (sq.justification) parts.push('', sq.justification);
    parts.push(...renderLinks(sq));
  });

  parts.push('');
  return parts.filter((p) => p !== undefined).join('\n');
}

function renderLinks(sq: RqSubQuestion): string[] {
  const ideas = sq.links.filter((l) => l.kind === 'idea');
  const works = sq.links.filter((l) => l.kind === 'work');
  const debates = sq.links.filter((l) => l.kind === 'debate');
  const out: string[] = [];
  if (ideas.length) {
    out.push('', '**Ideas de apoyo:**');
    out.push(
      ...ideas.map((l) => `- ${l.label}${l.readState === 'unread' ? ' (solo en obras no leídas)' : ''} — [idea](nodus://idea/${l.refId})`)
    );
  }
  if (works.length) {
    out.push('', '**Obras:**');
    out.push(...works.map((l) => `- ${l.label} — [obra](nodus://work/${l.refId})`));
  }
  if (debates.length) {
    out.push('', '**Debates:**');
    out.push(...debates.map((l) => `- ${l.label} — [debate](nodus://contradiction/${l.refId})`));
  }
  return out;
}

function slug(value: string): string {
  const clean = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return clean || 'mapa-cobertura';
}
