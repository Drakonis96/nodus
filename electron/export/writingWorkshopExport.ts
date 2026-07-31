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
import { stripLeadingAbstract } from '@shared/writingDocument';
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
  role: string;
  claim: string;
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
    role: 'Rol',
    claim: 'Afirmación',
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
    role: 'Role',
    claim: 'Claim',
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
    claims: 'Affirmations clés', role: 'Rôle', claim: 'Affirmation', source: 'Source', evidence: 'Preuve', notes: 'Notes',
  },
  tr: {
    kind: 'Profesyonel rapor · Deep Research', contents: 'İçindekiler', generated: 'Oluşturulma', objective: 'Amaç',
    summary: 'Yönetici özeti', summaryEyebrow: 'Sentez', outline: 'Araştırma planı', outlineEyebrow: 'Rapor mimarisi',
    report: 'Rapor', reportEyebrow: 'Analiz', recommendations: 'Sonraki adımlar', recommendationsEyebrow: 'Öneriler',
    traceability: 'İzlenebilirlik matrisi', traceabilityEyebrow: 'Kanıt ve bağlantılar', sections: 'bölüm', sources: 'kaynak', words: 'kelime',
    imageAi: 'Kapak görseli Nodus’ta yapay zekâ ile oluşturuldu.', imageCustom: 'Kapak görseli kullanıcı tarafından sağlandı.',
    claims: 'Temel iddialar', role: 'Rol', claim: 'İddia', source: 'Kaynak', evidence: 'Kanıt', notes: 'Notlar',
  },
  de: {
    kind: 'Professioneller Bericht · Deep Research', contents: 'Inhalt', generated: 'Erstellt', objective: 'Ziel',
    summary: 'Zusammenfassung', summaryEyebrow: 'Synthese', outline: 'Forschungsstruktur', outlineEyebrow: 'Berichtsarchitektur',
    report: 'Bericht', reportEyebrow: 'Analyse', recommendations: 'Nächste Schritte', recommendationsEyebrow: 'Empfehlungen',
    traceability: 'Nachweismatrix', traceabilityEyebrow: 'Evidenz und Links', sections: 'Abschnitte', sources: 'Quellen', words: 'Wörter',
    imageAi: 'Titelbild mit KI in Nodus generiert.', imageCustom: 'Titelbild vom Benutzer bereitgestellt.',
    claims: 'Kernaussagen', role: 'Rolle', claim: 'Aussage', source: 'Quelle', evidence: 'Evidenz', notes: 'Notizen',
  },
  pt: {
    kind: 'Relatório profissional · Deep Research', contents: 'Conteúdo', generated: 'Gerado', objective: 'Objetivo',
    summary: 'Resumo executivo', summaryEyebrow: 'Síntese', outline: 'Esquema de investigação', outlineEyebrow: 'Arquitetura do relatório',
    report: 'Relatório', reportEyebrow: 'Análise', recommendations: 'Próximos passos', recommendationsEyebrow: 'Recomendações',
    traceability: 'Matriz de rastreabilidade', traceabilityEyebrow: 'Evidência e ligações', sections: 'secções', sources: 'fontes', words: 'palavras',
    imageAi: 'Imagem de capa gerada por IA no Nodus.', imageCustom: 'Imagem de capa fornecida pelo utilizador.',
    claims: 'Afirmações-chave', role: 'Papel', claim: 'Afirmação', source: 'Fonte', evidence: 'Evidência', notes: 'Notas',
  },
  'pt-BR': {
    kind: 'Relatório profissional · Deep Research', contents: 'Conteúdo', generated: 'Gerado', objective: 'Objetivo',
    summary: 'Resumo executivo', summaryEyebrow: 'Síntese', outline: 'Estrutura da pesquisa', outlineEyebrow: 'Arquitetura do relatório',
    report: 'Relatório', reportEyebrow: 'Análise', recommendations: 'Próximos passos', recommendationsEyebrow: 'Recomendações',
    traceability: 'Matriz de rastreabilidade', traceabilityEyebrow: 'Evidências e links', sections: 'seções', sources: 'fontes', words: 'palavras',
    imageAi: 'Imagem de capa gerada por IA no Nodus.', imageCustom: 'Imagem de capa fornecida pelo usuário.',
    claims: 'Afirmações-chave', role: 'Papel', claim: 'Afirmação', source: 'Fonte', evidence: 'Evidência', notes: 'Notas',
  },
  it: {
    kind: 'Relazione professionale · Deep Research', contents: 'Indice', generated: 'Generato', objective: 'Obiettivo',
    summary: 'Sintesi esecutiva', summaryEyebrow: 'Sintesi', outline: 'Schema della ricerca', outlineEyebrow: 'Architettura della relazione',
    report: 'Relazione', reportEyebrow: 'Analisi', recommendations: 'Passi successivi', recommendationsEyebrow: 'Raccomandazioni',
    traceability: 'Matrice di tracciabilità', traceabilityEyebrow: 'Evidenze e collegamenti', sections: 'sezioni', sources: 'fonti', words: 'parole',
    imageAi: 'Immagine di copertina generata con l’IA in Nodus.', imageCustom: 'Immagine di copertina fornita dall’utente.',
    claims: 'Affermazioni chiave', role: 'Ruolo', claim: 'Affermazione', source: 'Fonte', evidence: 'Evidenza', notes: 'Note',
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

function matrixHtml(rows: WritingWorkshopMatrixRow[], labels: DeepReportLabels): string {
  if (!rows.length) return '';
  const head = `<colgroup><col style="width:20mm" /><col /><col style="width:26mm" /><col /><col style="width:26mm" /></colgroup>
    <thead><tr>
      <th>${escapeCellHtml(labels.role)}</th>
      <th>${escapeCellHtml(labels.claim)}</th>
      <th>${escapeCellHtml(labels.source)}</th>
      <th>${escapeCellHtml(labels.evidence)}</th>
      <th>${escapeCellHtml(labels.notes)}</th>
    </tr></thead>`;
  const body = rows.map((row) => {
    const source = row.citation
      ? reportLink(row.citation, row.sourceLabel || labels.source)
      : escapeCellHtml(row.sourceLabel || labels.source);
    return `<tr>
      <td><span class="role-tag">${escapeCellHtml(row.role)}</span></td>
      <td class="claim">${escapeCellHtml(row.claim)}</td>
      <td>${source}</td>
      <td>${escapeCellHtml(row.evidence)}</td>
      <td>${row.notes ? escapeCellHtml(row.notes) : '—'}</td>
    </tr>`;
  }).join('');
  return `<table class="evidence-table">${head}<tbody>${body}</tbody></table>`;
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
      className: 'exec-summary',
    },
  ];
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
    // The body already opens with the abstract and closes with its limitations and
    // references, so those are rendered once — here from the body, not twice.
    stripLeadingAbstract(draft.draftMarkdown, draft.abstract),
    '',
    '## Matriz de apoyo',
    matrixTable(draft.matrix),
    '',
    '## Siguientes pasos',
    ...(draft.nextSteps.length ? draft.nextSteps.map((item) => `- ${item}`) : ['- Revisar el borrador.']),
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
