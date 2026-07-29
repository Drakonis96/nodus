import type { PrimarySourceEvidenceTrace } from '@shared/primarySourcesTypes';
import { Icon } from '../ui';
import { t } from '../../i18n';

export function openPrimarySourceExcerpt(trace: Pick<PrimarySourceEvidenceTrace, 'itemId' | 'excerptId'>): void {
  window.dispatchEvent(new CustomEvent('nodus:navigate-primary-source', {
    detail: { itemId: trace.itemId, excerptId: trace.excerptId },
  }));
}

function roleLabel(role: PrimarySourceEvidenceTrace['role']): string {
  if (role === 'contradicts') return t('Contradice');
  if (role === 'contextualizes') return t('Contextualiza');
  if (role === 'mentions') return t('Menciona');
  return t('Apoya');
}

export function EvidenceTraceList({
  evidence,
  compact = false,
}: {
  evidence: PrimarySourceEvidenceTrace[];
  compact?: boolean;
}) {
  if (!evidence.length) {
    return (
      <div
        data-testid="hypothesis-without-evidence"
        className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
      >
        {t('Hipótesis sin evidencia')}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {evidence.map((trace) => (
        <button
          key={trace.evidenceId}
          type="button"
          data-testid={`evidence-trace-${trace.evidenceId}`}
          onClick={() => openPrimarySourceExcerpt(trace)}
          className="block w-full rounded-lg border border-neutral-200 bg-white p-3 text-left transition hover:border-indigo-300 hover:bg-indigo-50/50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/30"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[11px] font-semibold text-neutral-800 dark:text-neutral-100">
                {trace.sourceTitle}
              </div>
              <div className="mt-0.5 truncate text-[10px] text-neutral-500 dark:text-neutral-400">
                {[trace.repositoryName, trace.referenceCode, trace.locator].filter(Boolean).join(' · ')}
              </div>
            </div>
            <span className={[
              'shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold',
              trace.role === 'contradicts'
                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
            ].join(' ')}>
              {roleLabel(trace.role)}
            </span>
          </div>
          {!compact && (
            <blockquote className="mt-2 line-clamp-3 border-l-2 border-indigo-300 pl-2 text-[11px] italic leading-relaxed text-neutral-600 dark:border-indigo-700 dark:text-neutral-300">
              “{trace.quote}”
            </blockquote>
          )}
          <div className="mt-2 flex items-center gap-1 text-[10px] font-medium text-indigo-600 dark:text-indigo-300">
            <Icon name="external-link" size={11} /> {t('Abrir fragmento exacto')}
          </div>
        </button>
      ))}
    </div>
  );
}
