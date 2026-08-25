import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DocumentIndexJob, DocumentProfile, DocumentUnderstandingState, WorkView } from '@shared/types';
import { Icon } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { t, tx } from '../i18n';

const STATUS_LABEL: Record<DocumentUnderstandingState, string> = {
  missing: 'Sin preparar', queued: 'En cola', waiting_source: 'Resolviendo texto completo', paused: 'En pausa', structuring: 'Reconstruyendo estructura',
  analyzing: 'Analizando secciones', synthesizing: 'Sintetizando la obra', auditing: 'Auditando',
  embedding: 'Creando vectores', aligning: 'Enlazando ideas',
  current: 'Actual', stale: 'Obsoleta', failed: 'Falló', unavailable: 'Sin texto completo',
};

const STATUS_TONE: Record<DocumentUnderstandingState, string> = {
  current: 'border-emerald-700/60 bg-emerald-950/30 text-emerald-300',
  failed: 'border-red-700/60 bg-red-950/30 text-red-300',
  unavailable: 'border-neutral-700 bg-neutral-900 text-neutral-400',
  stale: 'border-amber-700/60 bg-amber-950/30 text-amber-300',
  missing: 'border-neutral-700 text-neutral-400', queued: 'border-indigo-700/60 text-indigo-300',
  structuring: 'border-indigo-700/60 text-indigo-300', analyzing: 'border-indigo-700/60 text-indigo-300',
  synthesizing: 'border-indigo-700/60 text-indigo-300', auditing: 'border-violet-700/60 text-violet-300',
  waiting_source: 'border-indigo-700/60 text-indigo-300', paused: 'border-amber-700/60 text-amber-300', embedding: 'border-cyan-700/60 text-cyan-300',
  aligning: 'border-cyan-700/60 text-cyan-300',
};

function modelLabel(model: DocumentProfile['generatorModel']): string {
  return model ? `${model.provider} · ${model.model}` : t('Modelo predeterminado');
}

export function DocumentProfileModal({ work, vaultId, onClose }: { work: WorkView; vaultId: string | null; onClose: () => void }) {
  const [profile, setProfile] = useState<DocumentProfile | null>(null);
  const [status, setStatus] = useState<DocumentUnderstandingState>('missing');
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<DocumentIndexJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [editing, setEditing] = useState<null | { path: string; value: string; generatedValue: string; overrideId?: string }>(null);

  const refresh = useCallback(async () => {
    const [nextProfile, states, progress] = await Promise.all([
      window.nodus.getDocumentProfile(work.nodus_id),
      window.nodus.getDocumentProfileStatuses([work.nodus_id]),
      window.nodus.getDocumentIndexProgress(),
    ]);
    setProfile(nextProfile);
    setStatus(states[0]?.status ?? 'missing');
    setError(states[0]?.error ?? null);
    setJob(progress.jobs.find((item) => item.vaultId === vaultId && item.nodusId === work.nodus_id && ['queued', 'running', 'paused'].includes(item.status)) ?? null);
  }, [vaultId, work.nodus_id]);

  useEffect(() => {
    void refresh();
    return window.nodus.onDocumentIndexProgress((progress) => {
      setJob(progress.jobs.find((item) => item.vaultId === vaultId && item.nodusId === work.nodus_id && ['queued', 'running', 'paused'].includes(item.status)) ?? null);
      void refresh();
    });
  }, [refresh, vaultId, work.nodus_id]);

  const supportByTarget = useMemo(() => {
    const map = new Map<string, DocumentProfile['supports']>();
    for (const support of profile?.supports ?? []) {
      const list = map.get(support.targetId) ?? [];
      list.push(support); map.set(support.targetId, list);
    }
    return map;
  }, [profile]);

  const start = async () => {
    setBusy(true);
    try { await window.nodus.enqueueDocumentProfile(work.nodus_id); await refresh(); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!job) return;
    setBusy(true);
    try { await window.nodus.cancelDocumentIndexJob(job.jobId); await refresh(); }
    finally { setBusy(false); }
  };

  const saveEdit = async () => {
    if (!editing || !profile) return;
    setBusy(true);
    try {
      await window.nodus.saveDocumentProfileOverride({
        nodusId: work.nodus_id,
        fieldPath: editing.path,
        value: editing.value,
        generatedValue: editing.generatedValue,
        baseVersionId: profile.versionId,
        verified: true,
      });
      setEditing(null);
      await refresh();
    } finally { setBusy(false); }
  };

  const revertEdit = async () => {
    if (!editing?.overrideId) return;
    setBusy(true);
    try {
      await window.nodus.deleteDocumentProfileOverride(editing.overrideId);
      setEditing(null);
      await refresh();
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label={t('Comprensión documental')} onClick={() => !busy && onClose()}>
      <div className="card flex max-h-full w-full max-w-5xl flex-col overflow-hidden border border-neutral-700 bg-neutral-950 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-start gap-3 border-b border-neutral-800 px-5 py-4">
          <Icon name="book" size={19} className="mt-0.5 text-cyan-300" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold">{t('Comprensión documental')}</h2>
            <p className="truncate text-xs text-neutral-500">{work.title}</p>
          </div>
          <span className={`rounded-md border px-2 py-1 text-xs ${STATUS_TONE[status]}`}>{t(STATUS_LABEL[status])}</span>
          <button className="text-neutral-400 hover:text-white" onClick={onClose} aria-label={t('Cerrar')}><Icon name="x" /></button>
        </header>

        {job && <div className="border-b border-neutral-800 bg-indigo-950/20 px-5 py-3">
          <div className="mb-1 flex items-center justify-between gap-3 text-xs">
            <span className="text-indigo-200">{job.error || tx('{phase} · intento {attempt}', { phase: job.phase, attempt: job.attempts })}</span>
            <span className="tabular-nums text-neutral-400">{Math.round(job.progress * 100)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded bg-neutral-800"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
        </div>}

        <main className="min-h-0 flex-1 overflow-y-auto p-5">
          {!profile ? (
            <div className="mx-auto max-w-xl py-16 text-center">
              <Icon name="layers" size={30} className="mx-auto mb-3 text-neutral-600" />
              <h3 className="text-sm font-medium">{status === 'unavailable' ? t('No hay texto completo legible') : t('Esta obra aún no tiene ficha documental')}</h3>
              <p className="mt-2 text-xs leading-5 text-neutral-500">{error ?? t('Nodus leerá la obra completa por secciones, sintetizará su arquitectura y auditará cada campo antes de publicarlo.')}</p>
            </div>
          ) : <div className="space-y-6">
            <section>
              <div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Visión de conjunto')}</h3><div className="flex items-center gap-2"><span className="text-xs text-neutral-500">{tx('Calidad {score}%', { score: Math.round((profile.qualityScore ?? 0) * 100) })}</span><button className="text-xs text-cyan-400 hover:text-cyan-200" onClick={() => setEditing({ path: 'overview', value: profile.overview, generatedValue: profile.generatedOverview ?? profile.overview, overrideId: profile.overviewOverrideId })}>{t('Corregir')}</button></div></div>
              <p className={`rounded-lg border bg-neutral-900/40 p-4 text-sm leading-6 text-neutral-200 ${profile.overviewConflict ? 'border-amber-600' : profile.overviewOverridden ? 'border-cyan-800' : 'border-neutral-800'}`}>{profile.overview}{profile.overviewOverridden && <span className="ml-2 text-[10px] uppercase text-cyan-500">{profile.overviewConflict ? t('Revisar corrección') : t('Corregido por ti')}</span>}</p>
            </section>
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Arquitectura de la obra')}</h3>
              <div className="grid gap-2 md:grid-cols-2">
                {profile.fields.map((field) => <article key={field.fieldId} className="rounded-lg border border-neutral-800 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2"><span className="text-[11px] font-semibold uppercase tracking-wide text-cyan-400">{field.kind.replaceAll('_', ' ')}</span><div className="flex items-center gap-2"><span className="text-[11px] text-neutral-600">{Math.round(field.confidence * 100)}%</span><button className="text-[11px] text-cyan-500 hover:text-cyan-200" onClick={() => setEditing({ path: `fields.${field.kind}.${field.ordinal}`, value: field.text, generatedValue: field.generatedText ?? field.text, overrideId: field.overrideId })}>{t('Corregir')}</button></div></div>
                  <p className="text-sm leading-5 text-neutral-300">{field.text}</p>
                  {field.overridden && <span className={`mt-1 block text-[10px] uppercase ${field.conflict ? 'text-amber-400' : 'text-cyan-600'}`}>{field.conflict ? t('Revisar corrección') : t('Corregido por ti')}</span>}
                  {supportByTarget.get(field.fieldId)?.slice(0, 1).map((support) => <button key={support.supportId} className="mt-2 block text-left text-xs italic leading-5 text-neutral-500 hover:text-cyan-300" onClick={() => void window.nodus.openEvidenceAtPage(work.nodus_id, { location: support.pageStart, sourceRef: support.sourceRef ?? null, pageNumber: support.pageStartNumber ?? null })}>“{support.quote}” {support.pageStart ? `· ${support.pageStart}` : ''}</button>)}
                </article>)}
              </div>
            </section>
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{tx('Estructura por secciones · {n}', { n: profile.sections.length })}</h3>
              <div className="space-y-2">{profile.sections.map((section) => <article key={section.sectionId} className="rounded-lg border border-neutral-800 px-3 py-2" style={{ marginLeft: `${Math.min(3, Math.max(0, section.level - 1)) * 12}px` }}>
                <div className="flex items-center gap-2"><span className="text-sm font-medium text-neutral-200">{section.title}</span>{section.role && <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-500">{section.role}</span>}<button className="ml-auto text-[11px] text-neutral-600 hover:text-cyan-300" onClick={() => void window.nodus.openEvidenceAtPage(work.nodus_id, { location: section.pageStart, sourceRef: section.sourceRef ?? null, pageNumber: section.pageStartNumber ?? null })}>{[section.pageStart, section.pageEnd].filter(Boolean).join('–')}</button></div>
                <p className="mt-1 text-xs leading-5 text-neutral-500">{section.summary}</p>
              </article>)}</div>
            </section>
            <section className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-3 text-xs text-neutral-500">
              <div className="grid gap-2 sm:grid-cols-2"><span>{t('Generador')}: {modelLabel(profile.generatorModel)}</span><span>{t('Auditor')}: {modelLabel(profile.auditorModel)}</span><span>{t('Versión')}: {profile.pipelineVersion}</span><span>{t('Cobertura de soporte')}: {Math.round((profile.audit?.supportCoverage ?? 0) * 100)}%</span></div>
              <p className="mt-2">{t('Esta ficha orienta la recuperación. Las respuestas siguen citando ideas y pasajes del texto original, nunca esta síntesis generada.')}</p>
            </section>
          </div>}
        </main>

        {editing && <div className="border-t border-cyan-900/60 bg-neutral-950 px-5 py-4">
          <label className="mb-2 block text-xs font-medium text-cyan-300">{t('Corrección verificable')}</label>
          <textarea className="input min-h-24 w-full resize-y text-sm" value={editing.value} maxLength={30_000} autoFocus onChange={(event) => setEditing({ ...editing, value: event.target.value })} />
          <div className="mt-3 flex justify-end gap-2">
            {editing.overrideId && <button className="btn btn-ghost text-red-300" disabled={busy} onClick={() => void revertEdit()}>{t('Restaurar versión generada')}</button>}
            <button className="btn btn-ghost" disabled={busy} onClick={() => setEditing(null)}>{t('Cancelar')}</button>
            <button className="btn btn-primary" disabled={busy || !editing.value.trim()} onClick={() => void saveEdit()}>{t('Guardar corrección')}</button>
          </div>
        </div>}

        <footer className="flex items-center justify-between gap-3 border-t border-neutral-800 px-5 py-3">
          <p className="text-xs text-neutral-500">{profile ? new Date(profile.publishedAt ?? profile.createdAt).toLocaleString() : ''}</p>
          <div className="flex gap-2">{job && <button className="btn btn-ghost border border-red-800 text-red-300" disabled={busy} onClick={() => setConfirmCancel(true)}>{t('Cancelar')}</button>}<button className="btn btn-primary" disabled={busy || Boolean(job)} onClick={() => void start()}><Icon name="sync" />{profile ? t('Volver a escanear') : t('Escanear obra completa')}</button></div>
        </footer>
      </div>
      {confirmCancel && <ConfirmModal
        title={t('Detener indexación')}
        message={t('Se detendrá el análisis documental pendiente. Las fichas ya publicadas, las correcciones del usuario y las obras completadas se conservarán.')}
        confirmLabel={t('Detener')}
        danger
        onConfirm={() => { setConfirmCancel(false); void cancel(); }}
        onCancel={() => setConfirmCancel(false)}
      />}
    </div>
  );
}
