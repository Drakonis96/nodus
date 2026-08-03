/**
 * A Deep Research report, described for the styled document.
 *
 * The half of the export that decides *what* goes on the page — the executive summary, the
 * report itself, the recommendations, the traceability matrix, the three metrics on the cover
 * — as opposed to `professionalReport.ts`, which decides how it all looks.
 *
 * Pure, and in `shared/` for the same reason: the desktop prints this with Chromium, and the
 * Nodus Server builds the identical description so a phone can print the same document. The
 * one thing it cannot do for itself is find the cover image, which lives in a vault on the
 * desktop and in the asset store on the server — so the caller passes it in.
 */
import type { PromptLanguage, WritingWorkshopDraft, WritingWorkshopMatrixRow } from './types';
import { stripLeadingAbstract } from './writingDocument';
import {
  PROFESSIONAL_REPORT_THEMES,
  anchoredMarkdown,
  reportLink,
  type ProfessionalReportInput,
  type ProfessionalReportSection,
} from './professionalReport';

// Re-exported so one bundle carries everything a printer needs: the description of the
// report and the design that renders it.
export { renderProfessionalReportHtml } from './professionalReport';
export type { ProfessionalReportInput } from './professionalReport';

/** The cover image, resolved by whoever holds it. */
export interface DeepResearchReportImage {
  dataUrl: string | null;
  credit: string | null;
}

export 
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

export const DEEP_LABELS: Record<PromptLanguage, DeepReportLabels> = {
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

export function deepResearchReportInput(
  draft: WritingWorkshopDraft,
  image: DeepResearchReportImage = { dataUrl: null, credit: null }
): ProfessionalReportInput {
  const language = draft.brief.language ?? 'es';
  const labels = DEEP_LABELS[language];
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
