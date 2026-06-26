// Shared Markdown builders for "save to notes". Each keeps clickable `nodus://`
// citations so the saved note opens with its provenance intact in the Notes view.
import type { EdgeDetail, GapAggregate, IdeaDetail } from '@shared/types';
import { EDGE_LABELS } from './components/ui';
import { t } from './i18n';

/** Compose a Markdown note for an idea, keeping a clickable `nodus://idea/...` citation. */
export function buildIdeaNote(detail: IdeaDetail): string {
  const { idea, occurrences, evidence } = detail;
  const lines: string[] = [];
  lines.push(`# ${idea.label}`);
  lines.push('');
  lines.push(`[${t('Abrir idea en Nodus')}](nodus://idea/${idea.global_id})`);
  lines.push('');
  if (idea.statement) {
    lines.push(idea.statement);
    lines.push('');
  }
  if (occurrences.length > 0) {
    lines.push(`## ${t('Obras que la desarrollan')}`);
    for (const o of occurrences) {
      const authors = o.work.authors.length ? o.work.authors.join('; ') : t('Autoría no disponible');
      const year = o.work.year ? ` (${o.work.year})` : '';
      lines.push(`- [${o.work.title}](nodus://work/${o.nodus_id}) — ${authors}${year}`);
    }
    lines.push('');
  }
  if (evidence.length > 0) {
    lines.push(`## ${t('Evidencia anclada')}`);
    for (const ev of evidence) {
      const loc = ev.location ? ` — ${ev.location}` : '';
      lines.push(`> "${ev.quote}"${loc}`);
      lines.push('');
    }
  }
  return lines.join('\n').trim();
}

/** Compose a Markdown note for a connection (edge) between two ideas. */
export function buildEdgeNote(detail: EdgeDetail): string {
  const { edge } = detail;
  const label = t(EDGE_LABELS[edge.type as keyof typeof EDGE_LABELS]) ?? edge.type;
  const lines: string[] = [];
  lines.push(`# ${detail.fromLabel} → ${detail.toLabel}`);
  lines.push('');
  lines.push(`**${label}** · conf ${edge.confidence.toFixed(2)}`);
  lines.push('');
  if (detail.explanation) {
    lines.push(detail.explanation);
    lines.push('');
  }
  if (detail.trace?.rationale) {
    lines.push(`> ${detail.trace.rationale}`);
    lines.push('');
  }
  if (detail.evidence.length > 0) {
    lines.push(`## ${t('Evidencia anclada')}`);
    for (const ev of detail.evidence) {
      const loc = ev.location ? ` — ${ev.location}` : '';
      lines.push(`> "${ev.quote}"${loc}`);
      lines.push('');
    }
  }
  return lines.join('\n').trim();
}

const GAP_KIND_LABELS: Record<GapAggregate['kind'], string> = {
  future_work: 'trabajo futuro',
  limitation: 'limitación',
  open_question: 'pregunta abierta',
  unresolved_contradiction: 'contradicción sin resolver',
};

/** Compose a Markdown note for a research gap, linking the works that raise it. */
export function buildGapNote(gap: GapAggregate): string {
  const lines: string[] = [];
  lines.push(`# ${t('Hueco:')} ${t(GAP_KIND_LABELS[gap.kind])}`);
  lines.push('');
  lines.push(gap.statement);
  lines.push('');
  if (gap.works.length > 0) {
    lines.push(`## ${t('Obras que lo mencionan')}`);
    for (const w of gap.works) {
      lines.push(`- [${w.title}](nodus://work/${w.nodus_id})`);
    }
  }
  return lines.join('\n').trim();
}
