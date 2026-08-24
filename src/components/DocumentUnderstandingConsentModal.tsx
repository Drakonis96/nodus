import { useState } from 'react';
import type { AppSettings } from '@shared/types';
import { Icon } from './ui';
import { t } from '../i18n';

export const DOCUMENT_UNDERSTANDING_CONSENT_KEY = 'nodus.documentUnderstandingConsent.2026-08';

export function hasSeenDocumentUnderstandingConsent(): boolean {
  try { return localStorage.getItem(DOCUMENT_UNDERSTANDING_CONSENT_KEY) === '1'; }
  catch { return false; }
}

function markSeen(): void {
  try { localStorage.setItem(DOCUMENT_UNDERSTANDING_CONSENT_KEY, '1'); }
  catch { /* private/locked storage must not make the app unusable */ }
}

export function DocumentUnderstandingConsentModal({
  settings,
  onSettled,
}: {
  settings: AppSettings;
  onSettled: () => void | Promise<void>;
}) {
  const [automatic, setAutomatic] = useState(settings.documentIndexingEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const finish = async (accept: boolean) => {
    setBusy(true);
    setError(false);
    try {
      if (accept) await window.nodus.startDocumentIndexCampaign({ includeArchived: false });
      // Start the one-off campaign first. Enabling continuous discovery before it
      // would enqueue the same works into a second campaign and leave a misleading
      // empty 0/0 campaign behind.
      await window.nodus.updateSettings({ documentIndexingEnabled: accept && automatic });
      markSeen();
      await onSettled();
    } catch {
      setError(true);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 sm:p-8" role="dialog" aria-modal="true" aria-labelledby="document-understanding-consent-title" aria-describedby="document-understanding-consent-description" data-testid="document-understanding-consent">
      <div className="card w-full max-w-2xl overflow-hidden border border-cyan-900/70 bg-neutral-950 shadow-2xl">
        <header className="border-b border-neutral-800 bg-gradient-to-br from-cyan-950/55 via-neutral-950 to-indigo-950/35 px-6 py-5">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-700/60 bg-cyan-950/70 text-cyan-300"><Icon name="layers" size={23} /></div>
          <h2 id="document-understanding-consent-title" className="text-xl font-semibold text-neutral-100">{t('Comprender tus obras completas')}</h2>
          <p id="document-understanding-consent-description" className="mt-2 text-sm leading-6 text-neutral-400">{t('Nodus puede analizar cada obra completa por secciones y construir una ficha jerárquica auditada de su tesis, método, estructura y conceptos principales.')}</p>
        </header>

        <main className="space-y-5 px-6 py-5">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-400">{t('Qué mejora')}</h3>
            <div className="space-y-2">
              {[
                'Selecciona mejor qué obras consultar antes de buscar ideas y pasajes.',
                'Añade contexto global a Chat, Nodi, Deep Research e Immersion sin sustituir las ideas ni sus relaciones.',
                'Mantiene la trazabilidad: las respuestas siguen citando el texto original, nunca la ficha generada.',
              ].map((item) => <div key={item} className="flex gap-2.5 text-sm leading-5 text-neutral-300"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-emerald-400" /><span>{t(item)}</span></div>)}
            </div>
          </section>

          <section className="rounded-xl border border-amber-900/50 bg-amber-950/15 p-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-300">{t('Antes de empezar')}</h3>
            <p className="text-xs leading-5 text-neutral-400">{t('El primer análisis de un vault grande puede tardar y utilizará los proveedores de IA y embeddings que tengas configurados. Se ejecuta en segundo plano, puede pausarse y omite las obras que ya estén actualizadas.')}</p>
          </section>

          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm text-neutral-300">
            <input type="checkbox" checked={automatic} onChange={(event) => setAutomatic(event.target.checked)} disabled={busy} />
            <span>{t('Analizar automáticamente las obras nuevas')}</span>
          </label>
          {error && <p className="text-xs leading-5 text-red-300" role="alert">{t('No se pudo iniciar el análisis documental. Revisa los modelos configurados e inténtalo desde la Biblioteca.')}</p>}
          <p className="text-[11px] leading-5 text-neutral-600">{t('Podrás activarlo más adelante desde Biblioteca → Índice documental o desde Ajustes → Biblioteca.')}</p>
        </main>

        <footer className="flex flex-col-reverse gap-2 border-t border-neutral-800 px-6 py-4 sm:flex-row sm:justify-end">
          <button className="btn btn-ghost" disabled={busy} onClick={() => void finish(false)}>{t('Ahora no')}</button>
          <button className="btn btn-primary" disabled={busy} autoFocus onClick={() => void finish(true)}><Icon name={busy ? 'sync' : 'play'} className={busy ? 'animate-spin' : ''} />{t('Analizar mi vault ahora')}</button>
        </footer>
      </div>
    </div>
  );
}
