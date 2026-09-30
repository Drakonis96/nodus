/**
 * Reader side of a complete study guide: the per-source coverage panel (what was
 * read, used and could not be read) and the exact-quote dialog shown before a
 * citation opens its material.
 */
import { useEffect, useState } from 'react';
import type { CompleteGuideDraftMeta, CompleteGuideEvidenceView } from '@shared/completeGuide/types';
import type { PromptLanguage } from '@shared/types';
import { Icon } from './ui';
import { t, tx } from '../i18n';

export function CompleteGuideCoveragePanel({ meta }: { meta: CompleteGuideDraftMeta }) {
  const { counts, usage } = meta;
  return (
    <div className="space-y-3 text-xs" data-testid="complete-guide-coverage">
      <h3 className="text-sm font-semibold">{t('Cobertura de la guía')}</h3>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-neutral-500">
        <dt>{t('Elementos extraídos')}</dt><dd className="text-right text-neutral-300">{counts.items}</dd>
        <dt>{t('Elementos usados')}</dt><dd className="text-right text-neutral-300">{counts.itemsUsed}</dd>
        <dt>{t('Bloques elaborados por IA')}</dt><dd className="text-right text-neutral-300">{counts.aiBlocks}</dd>
        <dt>{t('Bloques auditados')}</dt><dd className="text-right text-neutral-300">{counts.auditedBlocks}</dd>
        <dt>{t('Frases retiradas sin respaldo')}</dt><dd className="text-right text-neutral-300">{counts.removedSentences}</dd>
        <dt>{t('Fórmulas corregidas')}</dt><dd className="text-right text-neutral-300">{counts.invalidLatex}</dd>
        <dt>{t('Discrepancias entre fuentes')}</dt><dd className="text-right text-neutral-300">{counts.conflicts}</dd>
        <dt>{t('Partes sin procesar')}</dt><dd className="text-right text-neutral-300">{counts.failedWindows}</dd>
      </dl>
      <p className="text-[11px] text-neutral-500">
        {tx('{calls} llamadas · {tokens} tokens', { calls: usage.calls, tokens: usage.inputTokens + usage.outputTokens })}
        {usage.usd !== null ? ` · ${usage.usd.toFixed(2)} USD` : ''}
      </p>
      <ul className="space-y-2">
        {meta.sources.map((source) => (
          <li key={source.sourceKey} className="rounded-lg border border-neutral-800 p-2">
            <div className="flex items-center gap-1.5">
              <span className="rounded bg-neutral-800 px-1 font-mono text-[10px] text-neutral-300">{source.alias}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-neutral-200" title={source.title}>{source.title}</span>
            </div>
            {source.path && <div className="mt-0.5 truncate text-[11px] text-neutral-500" title={source.path}>{source.path}</div>}
            <div className="mt-1 text-[11px] text-neutral-400">
              {tx('Leído {read}/{total} · {used}/{extracted} elementos usados', { read: source.passagesRead, total: source.passagesTotal, used: source.itemsUsed, extracted: source.itemsExtracted })}
            </div>
            {source.pages && source.pages.empty.length > 0 && (
              <div className="mt-0.5 text-[11px] text-amber-400">{tx('{n} páginas sin texto', { n: source.pages.empty.length })}</div>
            )}
            {source.unreadRanges.length > 0 && (
              <div className="mt-0.5 text-[11px] text-amber-400">{t('Partes sin procesar')}: {source.unreadRanges.join(', ')}</div>
            )}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-neutral-500">{t('«Leído» se refiere al texto disponible en Nodus, no garantiza que el archivo original no contenga más.')}</p>
    </div>
  );
}

export function CompleteGuideEvidenceDialog({ draftId, itemId, language, onOpen, onClose }: {
  draftId: string;
  itemId: string;
  language?: PromptLanguage;
  onOpen: () => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<CompleteGuideEvidenceView | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void window.nodus.getCompleteGuideEvidence(draftId, itemId, language)
      .then((next) => alive && setView(next))
      .catch(() => alive && setView(null));
    return () => { alive = false; };
  }, [draftId, itemId, language]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Without the local sidecar (another device, an old guide) the citation still opens.
  useEffect(() => { if (view === null) { onOpen(); onClose(); } }, [view]);
  if (!view) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-label={t('Cita en el material')} className="w-full max-w-lg rounded-xl border border-neutral-700 bg-white p-4 shadow-2xl dark:bg-neutral-950" onMouseDown={(event) => event.stopPropagation()}>
        <header className="mb-2 flex items-start gap-2">
          <Icon name="quote" className="mt-0.5 text-teal-500" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{view.title}</h2>
            <p className="text-xs text-neutral-500">{view.statement}</p>
          </div>
          <button className="btn btn-ghost px-2" onClick={onClose} aria-label={t('Cerrar')}><Icon name="x" /></button>
        </header>
        <ul className="space-y-2">
          {view.evidence.map((evidence, index) => (
            <li key={index} className="rounded-lg border border-neutral-200 p-2 text-xs dark:border-neutral-800">
              <div className="mb-1 text-[11px] text-neutral-500">{evidence.alias} · {evidence.sourceTitle}{evidence.location ? ` · ${evidence.location}` : ''}</div>
              <blockquote className="border-l-2 border-teal-600 pl-2 italic text-neutral-700 dark:text-neutral-300">{evidence.quote || '—'}</blockquote>
              {evidence.anchor !== 'exact' && (
                <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                  {evidence.anchor === 'fuzzy' ? t('Coincidencia aproximada con el texto extraído.') : t('Fórmula reconstruida: compruébala en el original.')}
                </div>
              )}
            </li>
          ))}
        </ul>
        <footer className="mt-3 flex justify-end gap-2">
          <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={onClose}>{t('Cerrar')}</button>
          <button className="btn btn-primary gap-1.5" onClick={() => { onOpen(); onClose(); }}><Icon name="external" size={14} /> {t('Abrir en el material')}</button>
        </footer>
      </section>
    </div>
  );
}
