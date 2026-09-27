import type { ResearchTraversal } from '@shared/researchCorpus';
import { t } from '../i18n';

const reasons: Record<string, string> = {
  no_matches: 'Sin coincidencias', text_pending: 'Preparación pendiente', abstract_only: 'Solo abstract',
  ocr_pending: 'OCR pendiente', ocr_required: 'OCR pendiente', embeddings_pending: 'Embeddings pendientes',
  no_model: 'Modelo de embeddings no disponible', embedding_provider_unavailable: 'Modelo de embeddings no disponible',
  provider_failed: 'Modelo de embeddings no disponible', previous_indexed_revision: 'Disponible: revisión anterior',
  budget_exhausted: 'Presupuesto agotado', original_unavailable: 'Original no disponible',
  local_original_unavailable: 'Copia local no disponible', original_revision_changed: 'Disponible: revisión anterior',
  research_decision_unavailable: 'Consulta adicional no disponible', research_read_unavailable: 'Consulta adicional no disponible',
  repeated_action: 'Consulta adicional no disponible', research_decision_outside_scope: 'Consulta adicional no disponible',
  no_attachment: 'Sin adjuntos', not_downloaded: 'Archivos inaccesibles', inaccessible: 'Archivos inaccesibles', extraction_failed: 'Preparación pendiente',
};
export function ResearchCoverage({ value }: { value: ResearchTraversal }) {
  return <details className="my-2 rounded border border-neutral-300 p-3 text-sm dark:border-neutral-700">
    <summary>{t('Cobertura documental')}: {value.sourceCount} {t('Fuentes')}{value.partial ? ` · ${t('Cobertura parcial')}` : ''}</summary>
    <dl className="my-2 grid grid-cols-2 gap-2">
      {[[t('Obras con coincidencias'), value.matchedDocumentIds?.length ?? 0], [t('Obras con lectura contextual'), value.readDocumentIds?.length ?? 0],
        [t('Tokens de evidencia'), value.evidenceTokens], [t('Presupuesto de decisiones'), value.decisionTokens ?? 0]].map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}
    </dl>
    {!!value.limitations?.length && <ul className="list-disc pl-5">{[...new Set(value.limitations.map(code => reasons[code] ?? 'Consulta adicional no disponible'))].map(reason => <li key={reason}>{t(reason)}</li>)}</ul>}
    <ol className="my-2 list-decimal pl-5">{value.queries.map((query, index) => <li key={index}>{query.query} · {query.candidates} {t('Candidatos por búsqueda')}</li>)}</ol>
    {!!value.sourceCoverage?.length && <details><summary>{t('Fuentes')}</summary><ul className="max-h-64 overflow-y-auto">{value.sourceCoverage.map(source => <li key={source.documentId} className="my-1">
      {source.title}{source.reasons.length ? ` · ${[...new Set(source.reasons.map(code => t(reasons[code] ?? 'Consulta adicional no disponible')))].join(' · ')}` : ''}
    </li>)}</ul></details>}
  </details>;
}
