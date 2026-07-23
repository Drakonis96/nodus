import fs from 'node:fs';
import path from 'node:path';
import { app, dialog } from 'electron';
import type {
  DecorativeImageSource,
  PromptLanguage,
  WritingWorkshopDraft,
  WritingWorkshopExportFormat,
  WritingWorkshopExportRequest,
  WritingWorkshopMatrixRow,
} from '@shared/types';
import { markdownToPdf } from './markdownRender';
import { getDecorativeImage, getDecorativeImageData } from '../db/decorativeImagesRepo';
import {
  PROFESSIONAL_REPORT_THEMES,
  anchoredMarkdown,
  professionalReportPdf,
  reportLink,
  type ProfessionalReportInput,
  type ProfessionalReportSection,
} from './professionalReportPdf';

interface DeepReportLabels {
  kind: string;
  contents: string;
  generated: string;
  objective: string;
  summary: string;
  summaryEyebrow: string;
  outline: string;
  outlineEyebrow: string;
  report: string;
  reportEyebrow: string;
  recommendations: string;
  recommendationsEyebrow: string;
  traceability: string;
  traceabilityEyebrow: string;
  sections: string;
  sources: string;
  words: string;
  imageAi: string;
  imageCustom: string;
  claims: string;
  source: string;
  evidence: string;
  notes: string;
}

const DEEP_LABELS: Record<PromptLanguage, DeepReportLabels> = {
  es: {
    kind: 'Informe profesional · Deep Research',
    contents: 'Contenido',
    generated: 'Generado',
    objective: 'Objetivo',
    summary: 'Resumen ejecutivo',
    summaryEyebrow: 'Síntesis',
    outline: 'Esquema de investigación',
    outlineEyebrow: 'Arquitectura del informe',
    report: 'Informe',
    reportEyebrow: 'Desarrollo',
    recommendations: 'Siguientes pasos',
    recommendationsEyebrow: 'Recomendaciones',
    traceability: 'Matriz de trazabilidad',
    traceabilityEyebrow: 'Evidencia y enlaces',
    sections: 'secciones',
    sources: 'fuentes',
    words: 'palabras',
    imageAi: 'Imagen de portada generada por IA en Nodus.',
    imageCustom: 'Imagen de portada aportada por el usuario.',
    claims: 'Afirmaciones clave',
    source: 'Fuente',
    evidence: 'Evidencia',
    notes: 'Notas',
  },
  en: {
    kind: 'Professional report · Deep Research',
    contents: 'Contents',
    generated: 'Generated',
    objective: 'Objective',
    summary: 'Executive summary',
    summaryEyebrow: 'Synthesis',
    outline: 'Research outline',
    outlineEyebrow: 'Report architecture',
    report: 'Report',
    reportEyebrow: 'Analysis',
    recommendations: 'Next steps',
    recommendationsEyebrow: 'Recommendations',
    traceability: 'Evidence matrix',
    traceabilityEyebrow: 'Evidence and links',
    sections: 'sections',
    sources: 'sources',
    words: 'words',
    imageAi: 'Cover image generated with AI in Nodus.',
    imageCustom: 'Cover image provided by the user.',
    claims: 'Key claims',
    source: 'Source',
    evidence: 'Evidence',
    notes: 'Notes',
  },
  fr: {
    kind: 'Rapport professionnel · Deep Research', contents: 'Sommaire', generated: 'Généré', objective: 'Objectif',
    summary: 'Résumé exécutif', summaryEyebrow: 'Synthèse', outline: 'Plan de recherche', outlineEyebrow: 'Architecture du rapport',
    report: 'Rapport', reportEyebrow: 'Analyse', recommendations: 'Prochaines étapes', recommendationsEyebrow: 'Recommandations',
    traceability: 'Matrice de traçabilité', traceabilityEyebrow: 'Preuves et liens', sections: 'sections', sources: 'sources', words: 'mots',
    imageAi: 'Image de couverture générée par IA dans Nodus.', imageCustom: 'Image de couverture fournie par l’utilisateur.',
    claims: 'Affirmations clés', source: 'Source', evidence: 'Preuve', notes: 'Notes',
  },
  tr: {
    kind: 'Profesyonel rapor · Deep Research', contents: 'İçindekiler', generated: 'Oluşturulma', objective: 'Amaç',
    summary: 'Yönetici özeti', summaryEyebrow: 'Sentez', outline: 'Araştırma planı', outlineEyebrow: 'Rapor mimarisi',
    report: 'Rapor', reportEyebrow: 'Analiz', recommendations: 'Sonraki adımlar', recommendationsEyebrow: 'Öneriler',
    traceability: 'İzlenebilirlik matrisi', traceabilityEyebrow: 'Kanıt ve bağlantılar', sections: 'bölüm', sources: 'kaynak', words: 'kelime',
    imageAi: 'Kapak görseli Nodus’ta yapay zekâ ile oluşturuldu.', imageCustom: 'Kapak görseli kullanıcı tarafından sağlandı.',
    claims: 'Temel iddialar', source: 'Kaynak', evidence: 'Kanıt', notes: 'Notlar',
  },
  de: {
    kind: 'Professioneller Bericht · Deep Research', contents: 'Inhalt', generated: 'Erstellt', objective: 'Ziel',
    summary: 'Zusammenfassung', summaryEyebrow: 'Synthese', outline: 'Forschungsstruktur', outlineEyebrow: 'Berichtsarchitektur',
    report: 'Bericht', reportEyebrow: 'Analyse', recommendations: 'Nächste Schritte', recommendationsEyebrow: 'Empfehlungen',
    traceability: 'Nachweismatrix', traceabilityEyebrow: 'Evidenz und Links', sections: 'Abschnitte', sources: 'Quellen', words: 'Wörter',
    imageAi: 'Titelbild mit KI in Nodus generiert.', imageCustom: 'Titelbild vom Benutzer bereitgestellt.',
    claims: 'Kernaussagen', source: 'Quelle', evidence: 'Evidenz', notes: 'Notizen',
  },
  pt: {
    kind: 'Relatório profissional · Deep Research', contents: 'Conteúdo', generated: 'Gerado', objective: 'Objetivo',
    summary: 'Resumo executivo', summaryEyebrow: 'Síntese', outline: 'Esquema de investigação', outlineEyebrow: 'Arquitetura do relatório',
    report: 'Relatório', reportEyebrow: 'Análise', recommendations: 'Próximos passos', recommendationsEyebrow: 'Recomendações',
    traceability: 'Matriz de rastreabilidade', traceabilityEyebrow: 'Evidência e ligações', sections: 'secções', sources: 'fontes', words: 'palavras',
    imageAi: 'Imagem de capa gerada por IA no Nodus.', imageCustom: 'Imagem de capa fornecida pelo utilizador.',
    claims: 'Afirmações-chave', source: 'Fonte', evidence: 'Evidência', notes: 'Notas',
  },
  'pt-BR': {
    kind: 'Relatório profissional · Deep Research', contents: 'Conteúdo', generated: 'Gerado', objective: 'Objetivo',
    summary: 'Resumo executivo', summaryEyebrow: 'Síntese', outline: 'Estrutura da pesquisa', outlineEyebrow: 'Arquitetura do relatório',
    report: 'Relatório', reportEyebrow: 'Análise', recommendations: 'Próximos passos', recommendationsEyebrow: 'Recomendações',
    traceability: 'Matriz de rastreabilidade', traceabilityEyebrow: 'Evidências e links', sections: 'seções', sources: 'fontes', words: 'palavras',
    imageAi: 'Imagem de capa gerada por IA no Nodus.', imageCustom: 'Imagem de capa fornecida pelo usuário.',
    claims: 'Afirmações-chave', source: 'Fonte', evidence: 'Evidência', notes: 'Notas',
  },
};

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
    const bytes = draft.brief.kind === 'deep_research'
      ? await professionalReportPdf(buildDeepResearchPdfInput(draft, request.entityId))
      : await markdownToPdf(markdown, draft.title || 'Informe');
    fs.writeFileSync(filePath, bytes);
  } else {
    fs.writeFileSync(filePath, markdown, 'utf8');
  }
  return { path: filePath };
}

function reportImage(entityId: string | undefined, labels: DeepReportLabels): { dataUrl: string | null; credit: string | null } {
  if (!entityId) return { dataUrl: null, credit: null };
  const meta = getDecorativeImage('deep_research', entityId);
  const data = getDecorativeImageData('deep_research', entityId);
  if (!meta || meta.status !== 'ready' || !data) return { dataUrl: null, credit: null };
  return {
    dataUrl: `data:${data.mimeType};base64,${data.bytes.toString('base64')}`,
    credit: imageCredit(meta.source, labels),
  };
}

function imageCredit(source: DecorativeImageSource | null, labels: DeepReportLabels): string | null {
  if (source === 'ai') return labels.imageAi;
  if (source === 'custom') return labels.imageCustom;
  return null;
}

function localizedDate(iso: string, language: PromptLanguage): string {
  try {
    return new Intl.DateTimeFormat(language, { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function stripLeadingAbstract(markdown: string, abstract: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex((line) => line.trim().length > 0);
  if (first < 0 || !/^#{1,3}\s+/.test(lines[first])) return markdown;
  let next = first + 1;
  while (next < lines.length && !/^#{1,3}\s+/.test(lines[next])) next++;
  const block = lines.slice(first + 1, next).join(' ').replace(/\s+/g, ' ').trim();
  const expected = abstract.replace(/\s+/g, ' ').trim();
  if (!expected || !block || !block.includes(expected.slice(0, Math.min(80, expected.length)))) return markdown;
  return lines.slice(next).join('\n').trim();
}

function outlineHtml(draft: WritingWorkshopDraft, labels: DeepReportLabels): string {
  return `<ol class="outline-list">${draft.outline.map((section) => {
    const claims = section.keyClaims.length
      ? `<div class="muted" style="margin-top:2mm;font:700 6.8pt Arial,sans-serif;text-transform:uppercase;letter-spacing:.07em">${labels.claims}</div><ul class="claim-list">${section.keyClaims.map((claim) => `<li>${escapeCellHtml(claim)}</li>`).join('')}</ul>`
      : '';
    const sources = section.sources.length
      ? `<div class="source-pills">${section.sources.map((source) => `<span>${escapeCellHtml(source)}</span>`).join('')}</div>`
      : '';
    return `<li><h3>${escapeCellHtml(section.title)}</h3>${section.purpose ? `<p>${escapeCellHtml(section.purpose)}</p>` : ''}${claims}${sources}</li>`;
  }).join('')}</ol>`;
}

function matrixHtml(rows: WritingWorkshopMatrixRow[], labels: DeepReportLabels): string {
  if (!rows.length) return '';
  return `<div class="evidence-grid">${rows.map((row) => {
    const source = row.citation
      ? reportLink(row.citation, row.sourceLabel || labels.source)
      : escapeCellHtml(row.sourceLabel || labels.source);
    return `<article class="evidence-card">
      <span>${escapeCellHtml(row.role)}</span>
      <h3>${escapeCellHtml(row.claim)}</h3>
      <dl>
        <dt>${escapeCellHtml(labels.source)}</dt><dd>${source}</dd>
        <dt>${escapeCellHtml(labels.evidence)}</dt><dd>${escapeCellHtml(row.evidence)}</dd>
        ${row.notes ? `<dt>${escapeCellHtml(labels.notes)}</dt><dd>${escapeCellHtml(row.notes)}</dd>` : ''}
      </dl>
    </article>`;
  }).join('')}</div>`;
}

function escapeCellHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Pure document model used by the Electron exporter and its visual regression fixture. */
export function buildDeepResearchPdfInput(
  draft: WritingWorkshopDraft,
  entityId?: string,
  imageOverride?: { dataUrl: string | null; credit: string | null }
): ProfessionalReportInput {
  const language = draft.brief.language ?? 'es';
  const labels = DEEP_LABELS[language];
  const image = imageOverride ?? reportImage(entityId, labels);
  const body = stripLeadingAbstract(draft.draftMarkdown, draft.abstract);
  const report = anchoredMarkdown(body, 'report');
  const abstract = anchoredMarkdown(draft.abstract || draft.brief.objective, 'summary');
  const sections: ProfessionalReportSection[] = [
    {
      id: 'executive-summary',
      number: '01',
      title: labels.summary,
      eyebrow: labels.summaryEyebrow,
      html: `<div class="abstract-box prose">${abstract.html}</div>`,
    },
  ];
  if (draft.outline.length) {
    sections.push({
      id: 'research-outline',
      number: String(sections.length + 1).padStart(2, '0'),
      title: labels.outline,
      eyebrow: labels.outlineEyebrow,
      html: outlineHtml(draft, labels),
    });
  }
  sections.push({
    id: 'research-report',
    number: String(sections.length + 1).padStart(2, '0'),
    title: labels.report,
    eyebrow: labels.reportEyebrow,
    html: `<div class="prose">${report.html}</div>`,
    tocChildren: report.headings,
    pageBreakBefore: true,
  });
  if (draft.nextSteps.length) {
    sections.push({
      id: 'next-steps',
      number: String(sections.length + 1).padStart(2, '0'),
      title: labels.recommendations,
      eyebrow: labels.recommendationsEyebrow,
      html: `<div class="prose no-indent"><ol>${draft.nextSteps.map((item) => `<li>${escapeCellHtml(item)}</li>`).join('')}</ol></div>`,
    });
  }
  if (draft.matrix.length) {
    sections.push({
      id: 'traceability',
      number: String(sections.length + 1).padStart(2, '0'),
      title: labels.traceability,
      eyebrow: labels.traceabilityEyebrow,
      html: matrixHtml(draft.matrix, labels),
      pageBreakBefore: true,
    });
  }
  const words = draft.draftMarkdown.split(/\s+/).filter(Boolean).length;
  return {
    title: draft.title || labels.report,
    subtitle: draft.brief.objective,
    kindLabel: labels.kind,
    language,
    generatedLabel: labels.generated,
    generatedAt: localizedDate(draft.generatedAt, language),
    objectiveLabel: labels.objective,
    objective: draft.brief.objective,
    imageDataUrl: image.dataUrl,
    imageCredit: image.credit,
    contentsLabel: labels.contents,
    metrics: [
      { value: String(draft.outline.length), label: labels.sections },
      { value: String(draft.stats.selectedWorks || draft.bibliography.length), label: labels.sources },
      { value: words.toLocaleString(language), label: labels.words },
    ],
    sections,
    theme: PROFESSIONAL_REPORT_THEMES.deepResearch,
  };
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
