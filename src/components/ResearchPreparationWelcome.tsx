import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ResearchPreparationPolicy, ResearchPreparationPreview } from '@shared/researchCorpus';
import { errorText, t, tx } from '../i18n';

const OPEN_EVENT = 'nodus:research-preparation';
interface PreparationRequest { workIds?: string[]; automatic?: boolean }
export function openResearchPreparation(workIds?: string[]): void {
  window.dispatchEvent(new CustomEvent<PreparationRequest>(OPEN_EVENT, { detail: { workIds } }));
}
export function openResearchPreparationQueue(): void {
  document.querySelector<HTMLButtonElement>('[data-queue-trigger]')?.click();
}
/** Mounted per academic vault. Automatic presentation only happens on idle entry
 * surfaces; explicit Library/Settings requests remain available afterwards. */
export function ResearchPreparationWelcome({ vaultId, allowAutomatic, onConfigure }: { vaultId: string; allowAutomatic: boolean; onConfigure: () => void }) {
  const [request, setRequest] = useState<PreparationRequest | null>(null);
  useEffect(() => {
    const open = (event: Event) => setRequest((event as CustomEvent<PreparationRequest>).detail ?? {});
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);
  useEffect(() => {
    if (!allowAutomatic || request) return;
    let current = true;
    void window.nodus.getResearchPreparationPolicy().then(policy => {
      if (current && policy.vaultId === vaultId && policy.welcomeVersion < 1 && !document.querySelector('[aria-modal="true"], dialog[open]')) setRequest({ automatic: true });
    }).catch(() => { /* A later entry or explicit action can retry. */ });
    return () => { current = false; };
  }, [vaultId, allowAutomatic, request]);
  return request ? <PreparationDialog key={vaultId} request={request} onClose={() => setRequest(null)} onConfigure={onConfigure} /> : null;
}
function PreparationDialog({ request, onClose, onConfigure }: { request: PreparationRequest; onClose: () => void; onConfigure: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [preview, setPreview] = useState<ResearchPreparationPreview | null>(null);
  const [policy, setPolicy] = useState<ResearchPreparationPolicy | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [choosing, setChoosing] = useState(!!request.workIds);
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    let current = true;
    void (async () => {
      const previous = await window.nodus.getResearchPreparationPolicy();
      let ids: string[] | undefined;
      if (request.workIds) {
        const wanted = new Set(request.workIds);
        const sources = await window.nodus.getResearchCorpusSources();
        ids = sources.documents.filter(document => document.workId && wanted.has(document.workId)).map(document => document.id);
      }
      const inventory = await window.nodus.previewResearchPreparation(ids ? { scope: 'selection', documentIds: ids } : { scope: 'vault' });
      if (!current) return;
      setPolicy(previous); setPreview(inventory); setSelected(new Set(inventory.documents.map(document => document.id)));
      // Seeing the version is separate from authorizing any work.
      await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1 });
    })().catch(reason => { if (current) setError(errorText(reason)); });
    return () => { current = false; trigger?.focus(); };
  }, [request]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  };
  const close = () => void run(async () => {
    if (!policy || policy.decision === 'pending') await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1, decision: 'declined' });
    onClose();
  });
  const enqueue = (mode: 'text' | 'embeddings') => void run(async () => {
    if (!preview) return;
    await window.nodus.startResearchPreparationCampaign({ previewId: preview.id, mode, documentIds: [...selected] });
    await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1, decision: 'accepted' });
    onClose(); openResearchPreparationQueue();
  });
  const documents = preview?.documents ?? [];
  const chosen = documents.filter(document => selected.has(document.id));
  const matches = documents.filter(document => document.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return createPortal(<dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) close(); }}
    className="w-[min(920px,95vw)] max-h-[90vh] overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-950 p-6 text-neutral-100 shadow-xl backdrop:bg-black/60" data-testid="research-preparation-welcome">
    <div className="flex items-start justify-between gap-4">
      <h2 id={titleId} className="text-lg font-semibold">{t('Preparar fuentes')}</h2>
      <button className="btn btn-ghost" aria-label={t('Cerrar')} disabled={busy} onClick={close}>×</button>
    </div>
    <div className="my-4 grid gap-3 md:grid-cols-3">
      {[
        ['1', 'Texto y embeddings', 'Prepara el texto de las obras para buscar pasajes. Solo utiliza el modelo de embeddings seleccionado; no genera Ideas, resúmenes ni perfiles.'],
        ['2', 'Ideas y relaciones', 'Los análisis de Ideas y sus relaciones son procesos independientes. Puedes conservarlos y consultarlos junto con los documentos.'],
        ['3', 'Investigación con evidencias', 'Las consultas utilizan las capas disponibles y conservan la procedencia de las evidencias. Preparar una obra no es lo mismo que analizar sus Ideas.'],
      ].map(([number, title, description]) => <section key={number} className="rounded-lg border border-neutral-700 p-4">
        <span aria-hidden="true" className="text-indigo-400">{number}</span><h3 className="my-2 font-medium">{t(title)}</h3><p className="text-sm text-neutral-400">{t(description)}</p>
      </section>)}
    </div>
    {!preview && !error && <p role="status">{t('Cargando…')}</p>}
    {preview && <>
      <p className="text-sm font-medium">{t('Bóveda actual')} · {tx('{n} obras', { n: documents.length })}</p>
      <p className="my-2 text-sm">{preview.embedding ? `Embeddings: ${preview.embedding.provider} · ${preview.embedding.model}` : t('Configura un modelo de embeddings o prepara solo el texto local.')}</p>
      {preview.embedding?.external && <p className="mb-2 text-sm text-neutral-400">{t('Los fragmentos de texto se enviarán al proveedor de embeddings indicado.')}</p>}
      {!preview.embeddingAvailable && <p className="mb-2 text-sm text-amber-400">{t('Configura un modelo de embeddings o prepara solo el texto local.')}</p>}
      <dl className="my-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
        {[
          [t('Selección'), chosen.length],
          [t('Disponible para consultar'), chosen.filter(document => document.preparation.lexical === 'ready').length],
          [t('Embeddings compatibles'), chosen.filter(document => document.preparation.embeddings === 'ready').length],
          [t('Solo abstract'), chosen.filter(document => document.preparation.text === 'abstract').length],
        ].map(([label, count]) => <div key={label} className="rounded border border-neutral-800 p-2"><dt className="text-neutral-400">{label}</dt><dd>{count}</dd></div>)}
      </dl>
      <p className="text-xs text-neutral-400">{t('Esta campaña incluye la selección mostrada. Las incorporaciones posteriores no se añadirán a ella.')}</p>
      <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy || !policy} checked={policy?.futureAdditions ?? false} onChange={event => {
        const futureAdditions = event.target.checked;
        void run(async () => setPolicy(await window.nodus.setResearchPreparationPolicy({ futureAdditions })));
      }} />{t('Preparar nuevas incorporaciones')}</label>
      <p className="mb-3 ml-5 text-xs text-neutral-400">{t('Este ajuste es independiente. Desactivarlo no cancela los trabajos ya encolados.')}</p>
      <button className="btn btn-ghost" aria-expanded={choosing} onClick={() => setChoosing(value => !value)}>{t('Elegir obras')}</button>
      {choosing && <div className="my-3 rounded border border-neutral-700 p-3">
        <input className="input w-full" aria-label={t('Buscar obras')} placeholder={t('Buscar obras')} value={filter} onChange={event => { setFilter(event.target.value); setLimit(100); }} />
        <div className="my-2 flex gap-2">
          <button className="btn btn-ghost" onClick={() => setSelected(new Set(documents.map(document => document.id)))}>{t('Seleccionar todo')}</button>
          <button className="btn btn-ghost" onClick={() => setSelected(new Set())}>{t('Deseleccionar todo')}</button>
        </div>
        <ul className="max-h-64 overflow-y-auto">{matches.slice(0, limit).map(document => <li key={document.id} className="border-t border-neutral-800 py-2">
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={selected.has(document.id)} onChange={event => setSelected(current => {
            const next = new Set(current); if (event.target.checked) next.add(document.id); else next.delete(document.id); return next;
          })} /><span>{document.title}<small className="block text-neutral-400">{t(document.preparation.text === 'abstract' ? 'Solo abstract' : document.preparation.lexical === 'ready' ? 'Disponible para consultar' : 'Preparación pendiente')}</small></span></label>
        </li>)}</ul>
        {matches.length > limit && <button className="btn btn-ghost" onClick={() => setLimit(value => value + 100)}>{t('Mostrar más')}</button>}
      </div>}
    </>}
    {error && <p role="alert" className="my-3 text-sm text-red-400">{error}</p>}
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <button className="btn btn-ghost" disabled={busy} onClick={close}>{t('Ahora no')}</button>
      {preview && !preview.embeddingAvailable && <button className="btn" disabled={busy} onClick={() => { onClose(); onConfigure(); }}>{t('Configurar embeddings')}</button>}
      <button className="btn" disabled={busy || !preview || !selected.size} onClick={() => enqueue('text')}>{t('Preparar solo texto local')}</button>
      <button className="btn btn-primary" disabled={busy || !preview?.embeddingAvailable || !selected.size} onClick={() => enqueue('embeddings')}>{t(choosing || request.workIds ? 'Encolar selección' : 'Encolar biblioteca actual')}</button>
    </div>
  </dialog>, document.body);
}
