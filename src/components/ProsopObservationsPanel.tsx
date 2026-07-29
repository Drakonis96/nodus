import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProsopFactoidInput, ProsopSourcesWorkspace, ProsopStatementInput } from '@shared/prosopography';
import { certaintyValues } from '@shared/prosopography';
import { errorText, t, tx } from '../i18n';
import { Icon } from './ui';

const field = 'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-950';
const emptyStatement = (): ProsopStatementInput => ({
  statementType: 'attribute', literalValue: '', value: { kind: 'text', text: '' },
  readingCertainty: 'unknown', sourceAssertionCertainty: 'unknown', interpretationCertainty: 'unknown',
});

export function ProsopObservationsPanel({ sources }: { sources: ProsopSourcesWorkspace['sources'] }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof window.nodus.getProsopObservationsWorkspace>> | null>(null);
  const firstSource = sources.find((item) => item.segments.length > 0);
  const [draft, setDraft] = useState<ProsopFactoidInput>({
    sourceId: firstSource?.sourceId ?? '', sourceSegmentId: firstSource?.segments[0]?.segmentId ?? '',
    factoidKind: 'passage', summary: '', status: 'draft', extractionCertainty: 'unknown',
    statements: [emptyStatement()],
  });
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setData(await window.nodus.getProsopObservationsWorkspace()); } catch (cause) { setError(errorText(cause)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const selectedSource = useMemo(() => sources.find((item) => item.sourceId === draft.sourceId), [draft.sourceId, sources]);
  const patchStatement = (index: number, patch: Partial<ProsopStatementInput>) => setDraft((current) => ({
    ...current, statements: current.statements.map((item, position) => position === index ? { ...item, ...patch } : item),
  }));
  const save = async (reviewed: boolean) => {
    setBusy(true); setError('');
    try {
      await window.nodus.saveProsopFactoid({ ...draft, status: reviewed ? 'reviewed' : 'draft', reviewedBy: reviewed ? 'human' : null });
      setDraft((current) => ({ ...current, summary: '', status: 'draft', statements: [emptyStatement()] }));
      await load();
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  };
  return <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]" data-testid="prosop-observations-panel">
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/50">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{t('Editor de observaciones')}</h2><p className="mt-1 text-xs text-neutral-500">{t('Un pasaje puede producir varias afirmaciones atómicas sin convertirse en un hecho definitivo.')}</p></div><div className="flex gap-2"><button disabled={busy} className="btn btn-ghost" onClick={() => void save(false)}>{t('Guardar borrador')}</button><button disabled={busy} className="btn bg-blue-600 text-white" onClick={() => void save(true)}><Icon name="check" size={14}/>{t('Revisar y guardar')}</button></div></div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-neutral-500">{t('Fuente')}<select className={`${field} mt-1`} value={draft.sourceId} onChange={(event) => { const source = sources.find((item) => item.sourceId === event.target.value); setDraft((item) => ({ ...item, sourceId: event.target.value, sourceSegmentId: source?.segments[0]?.segmentId ?? '' })); }}><option value="">{t('Selecciona una fuente')}</option>{sources.map((item) => <option key={item.sourceId} value={item.sourceId}>{item.title}</option>)}</select></label>
        <label className="text-xs text-neutral-500">{t('Segmento citable')}<select className={`${field} mt-1`} value={draft.sourceSegmentId} onChange={(event) => setDraft((item) => ({ ...item, sourceSegmentId: event.target.value }))}><option value="">{t('Selecciona un segmento')}</option>{selectedSource?.segments.map((item) => <option key={item.segmentId} value={item.segmentId}>{item.locatorDisplay}</option>)}</select></label>
        <label className="text-xs text-neutral-500 sm:col-span-2">{t('Resumen del pasaje')}<input className={`${field} mt-1`} value={draft.summary ?? ''} onChange={(event) => setDraft((item) => ({ ...item, summary: event.target.value }))}/></label>
      </div>
      <div className="mt-5 space-y-3">{draft.statements.map((item, index) => <article key={index} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <div className="flex items-center justify-between"><h3 className="text-xs font-semibold">{tx('Afirmación {number}', { number: index + 1 })}</h3>{draft.statements.length > 1 && <button aria-label={t('Eliminar afirmación')} className="rounded p-1 text-red-500 hover:bg-red-50" onClick={() => setDraft((current) => ({ ...current, statements: current.statements.filter((_, position) => position !== index) }))}><Icon name="trash" size={13}/></button>}</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs text-neutral-500">{t('Tipo')}<input className={`${field} mt-1`} value={item.statementType} onChange={(event) => patchStatement(index, { statementType: event.target.value })}/></label><label className="text-xs text-neutral-500">{t('Valor normalizado')}<input className={`${field} mt-1`} value={item.value.kind === 'text' ? item.value.text : ''} onChange={(event) => patchStatement(index, { value: { kind: 'text', text: event.target.value } })}/></label><label className="text-xs text-neutral-500 sm:col-span-2">{t('Literal de la fuente')}<input className={`${field} mt-1`} value={item.literalValue} onChange={(event) => patchStatement(index, { literalValue: event.target.value })}/></label>
          <label className="text-xs text-neutral-500">{t('Certeza de lectura')}<select className={`${field} mt-1`} value={item.readingCertainty} onChange={(event) => patchStatement(index, { readingCertainty: event.target.value as ProsopStatementInput['readingCertainty'] })}>{certaintyValues.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-xs text-neutral-500">{t('Modalidad')}<select className={`${field} mt-1`} value={item.sourceModality ?? 'asserted'} onChange={(event) => patchStatement(index, { sourceModality: event.target.value as ProsopStatementInput['sourceModality'] })}><option value="asserted">{t('Afirmada')}</option><option value="reported">{t('Referida')}</option><option value="inferred_by_source">{t('Inferida por la fuente')}</option><option value="questioned">{t('Cuestionada')}</option></select></label>
          <label className="flex items-center gap-2 text-xs text-neutral-600"><input type="checkbox" checked={item.negated ?? false} onChange={(event) => patchStatement(index, { negated: event.target.checked })}/>{t('La fuente niega esta afirmación')}</label>
        </div>
      </article>)}</div>
      <button className="mt-3 btn btn-ghost" onClick={() => setDraft((current) => ({ ...current, statements: [...current.statements, emptyStatement()] }))}><Icon name="plus" size={14}/>{t('Añadir afirmación')}</button>
    </div>
    <aside className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/50"><h2 className="font-semibold">{t('Evidencia revisada')}</h2><p className="mt-1 text-xs text-neutral-500">{t('Las contradicciones permanecen visibles; una resolución nunca borra sus alternativas.')}</p><div className="mt-4 space-y-3">{data?.factoids.length === 0 && <p className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-xs text-neutral-500 dark:border-neutral-700">{t('Todavía no hay observaciones.')}</p>}{data?.factoids.map((item) => <article key={item.factoidId} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-medium">{item.summary || item.factoidKind}</h3><p className="mt-1 text-[10px] text-blue-600 dark:text-blue-300">{item.sourceTitle} · {item.locatorDisplay}</p></div><span className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] dark:bg-neutral-800">{t(item.status)}</span></div><blockquote className="mt-3 border-l-2 border-blue-300 pl-3 text-xs italic text-neutral-500">{item.quotedText}</blockquote><ul className="mt-3 space-y-2">{item.statements.map((statement) => <li key={statement.statementId} className="rounded-lg bg-neutral-50 p-2 text-xs dark:bg-neutral-950"><span className="font-medium">{statement.literalValue}</span><span className="text-neutral-400"> → {statement.value.kind === 'text' ? statement.value.text : statement.value.kind}</span>{statement.negated && <span className="ml-2 text-red-500">{t('negada')}</span>}</li>)}</ul></article>)}</div></aside>
  </section>;
}
