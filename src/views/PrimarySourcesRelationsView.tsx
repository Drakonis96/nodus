import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  PrimarySourceRelationEdge,
  PrimarySourceRelationsWorkspace,
} from '@shared/primarySourcesTypes';
import { Icon } from '../components/ui';
import { EvidenceTraceList } from '../components/primarySources/EvidenceTraceList';
import { PrimarySourcesEvidenceGraph } from '../components/primarySources/PrimarySourcesEvidenceGraph';
import { t, tx } from '../i18n';
import { consumePrimarySourceAttention } from '../primarySourcesAttention';

function directionLabel(direction: PrimarySourceRelationEdge['direction']): string {
  if (direction === 'mutual') return t('Mutua');
  if (direction === 'undirected') return t('No dirigida');
  return t('Dirigida');
}

function dateInterval(edge: PrimarySourceRelationEdge): string {
  if (!edge.dateDisplay) return t('Sin fecha');
  if (edge.dateEndSort && edge.dateEndSort !== edge.dateStartSort) {
    return `${edge.dateDisplay} · ${edge.dateStartSort ?? '…'} — ${edge.dateEndSort}`;
  }
  return edge.dateDisplay;
}

export type PrimarySourcesRelationsLoader = { getPrimarySourceRelationsWorkspace: () => Promise<PrimarySourceRelationsWorkspace> };

export function PrimarySourcesRelationsView({ loader }: { loader?: PrimarySourcesRelationsLoader } = {}) {
  const [attention, setAttention] = useState(() => consumePrimarySourceAttention(['relation_evidence']));
  const [workspace, setWorkspace] = useState<PrimarySourceRelationsWorkspace | null>(null);
  const [mode, setMode] = useState<'graph' | 'table'>('graph');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [relationType, setRelationType] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showHypotheses, setShowHypotheses] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (loader?.getPrimarySourceRelationsWorkspace ?? window.nodus.getPrimarySourceRelationsWorkspace)()
      .then((data) => {
        if (cancelled) return;
        setWorkspace(data);
        setSelectedId(data.edges.find((edge) => !edge.hypothesis)?.edgeId ?? null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, [loader]);

  const filteredEdges = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (workspace?.edges ?? []).filter((edge) => {
      if (attention?.targetIds.length && !attention.targetIds.includes(edge.edgeId)) return false;
      if (!showHypotheses && edge.hypothesis) return false;
      if (sourceId && !edge.sourceIds.includes(sourceId)) return false;
      if (relationType && edge.relationType !== relationType) return false;
      if (status && edge.status !== status) return false;
      if (from && edge.dateEndSort && edge.dateEndSort < from) return false;
      if (to && edge.dateStartSort && edge.dateStartSort > to) return false;
      if (!query) return true;
      return [
        edge.fromName,
        edge.toName,
        edge.relationType,
        edge.notes,
        ...edge.evidence.map((trace) => `${trace.sourceTitle} ${trace.quote}`),
      ].filter(Boolean).some((value) => String(value).toLocaleLowerCase().includes(query));
    });
  }, [workspace, showHypotheses, sourceId, relationType, status, from, to, search, attention]);

  const nodeIds = useMemo(
    () => new Set(filteredEdges.flatMap((edge) => [edge.fromId, edge.toId])),
    [filteredEdges]
  );
  const filteredNodes = useMemo(
    () => (workspace?.nodes ?? []).filter((node) => nodeIds.has(node.nodeId)),
    [workspace, nodeIds]
  );
  const selected = (workspace?.edges ?? []).find((edge) => edge.edgeId === selectedId) ?? null;
  const selectEdge = useCallback((edgeId: string) => setSelectedId(edgeId), []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="primary-sources-relations-view">
      <header className="shrink-0 border-b border-neutral-200 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        {attention && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-[10px] text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200">
            <Icon name="filter" size={11} />{t(attention.label)}
            <button className="ml-auto font-medium hover:underline" onClick={() => setAttention(null)}>{t('Mostrar todo')}</button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-lg font-semibold">{t('Red de relaciones documentadas')}</h1>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {t('Cada arista confirmada abre su apoyo, contradicción, fecha y fragmento exacto.')}
            </p>
          </div>
          <div
            className="ml-auto flex rounded-lg border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-700 dark:bg-neutral-900"
            role="group"
            aria-label={t('Modo de vista')}
          >
            {(['graph', 'table'] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => setMode(entry)}
                aria-pressed={mode === entry}
                className={[
                  'flex items-center gap-1 rounded-md px-3 py-1.5 text-[11px] font-medium',
                  mode === entry
                    ? 'bg-white text-indigo-700 shadow-sm dark:bg-neutral-800 dark:text-indigo-300'
                    : 'text-neutral-500 dark:text-neutral-400',
                ].join(' ')}
              >
                <Icon name={(entry === 'graph' ? 'network' : 'table') as never} size={12} />
                {t(entry === 'graph' ? 'Grafo social' : 'Tabla accesible')}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-7">
          <input className="input h-8 text-xs lg:col-span-2" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Buscar persona, relación o evidencia…')} />
          <select className="input h-8 text-xs" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
            <option value="">{t('Todas las fuentes')}</option>
            {workspace?.sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
          </select>
          <select className="input h-8 text-xs" value={relationType} onChange={(event) => setRelationType(event.target.value)}>
            <option value="">{t('Todos los tipos')}</option>
            {workspace?.relationTypes.map((entry) => <option key={entry} value={entry}>{t(entry)}</option>)}
          </select>
          <select className="input h-8 text-xs" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{t('Todo estado')}</option>
            <option value="confirmed">{t('Confirmadas')}</option>
            <option value="proposal">{t('Propuestas')}</option>
          </select>
          <input className="input h-8 text-xs" type="date" aria-label={t('Desde')} value={from} onChange={(event) => setFrom(event.target.value)} />
          <input className="input h-8 text-xs" type="date" aria-label={t('Hasta')} value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-[10px] text-neutral-500 dark:text-neutral-400">
          <label className="inline-flex items-center gap-2 text-[11px] text-neutral-600 dark:text-neutral-300">
            <input type="checkbox" checked={showHypotheses} onChange={(event) => setShowHypotheses(event.target.checked)} />
            {t('Mostrar propuestas sin evidencia')}
          </label>
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-indigo-500" />{t('Persona confirmada')}</span>
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-amber-500" />{t('Persona provisional o propuesta')}</span>
          <span className="inline-flex items-center gap-1"><i className="h-0.5 w-5 bg-neutral-500" />{t('Arista confirmada con evidencia')}</span>
          <span className="inline-flex items-center gap-1"><i className="h-0.5 w-5 bg-rose-600" />{t('Arista con contradicción')}</span>
        </div>
      </header>

      {error && <div role="alert" className="mx-5 mt-3 rounded-lg bg-rose-100 p-3 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-200">{error}</div>}

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px]">
        <main className="min-h-0 overflow-auto p-5">
          {!workspace && !error && <div role="status" aria-live="polite" className="text-sm text-neutral-500">{t('Cargando relaciones…')}</div>}
          {workspace && filteredEdges.length === 0 && (
            <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
              {t('No hay relaciones documentadas que cumplan los filtros.')}
            </div>
          )}
          {workspace && filteredEdges.length > 0 && mode === 'graph' && (
            <PrimarySourcesEvidenceGraph
              nodes={filteredNodes}
              edges={filteredEdges}
              onSelectEdge={selectEdge}
            />
          )}
          {workspace && mode === 'table' && (
            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              <table className="w-full text-left text-xs" data-testid="primary-sources-relations-table">
                <thead className="bg-neutral-100 text-[10px] uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                  <tr>
                    <th scope="col" className="px-3 py-2">{t('Origen')}</th>
                    <th scope="col" className="px-3 py-2">{t('Relación histórica')}</th>
                    <th scope="col" className="px-3 py-2">{t('Destino')}</th>
                    <th scope="col" className="px-3 py-2">{t('Dirección')}</th>
                    <th scope="col" className="px-3 py-2">{t('Fecha e intervalo')}</th>
                    <th scope="col" className="px-3 py-2">{t('Evidencia')}</th>
                    <th scope="col" className="px-3 py-2">{t('Estado')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEdges.map((edge) => (
                    <tr
                      key={edge.edgeId}
                      tabIndex={0}
                      onClick={() => setSelectedId(edge.edgeId)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedId(edge.edgeId);
                        }
                      }}
                      className="cursor-pointer border-t border-neutral-100 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-neutral-800 dark:hover:bg-indigo-950/30"
                    >
                      <td className="px-3 py-2 font-medium">{edge.fromName}</td>
                      <td className="px-3 py-2">{edge.historicalLabel}</td>
                      <td className="px-3 py-2 font-medium">{edge.toName}</td>
                      <td className="px-3 py-2">{directionLabel(edge.direction)}</td>
                      <td className="px-3 py-2">{dateInterval(edge)}</td>
                      <td className="px-3 py-2">{edge.evidence.length}</td>
                      <td className="px-3 py-2">{edge.hypothesis ? t('Propuesta') : edge.hasContradiction ? t('Contradicción') : t('Confirmada')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>

        <aside className="min-h-0 overflow-auto border-l border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
          {selected ? (
            <>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">{t('Dossier de la arista')}</div>
              <div className="mt-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span>{selected.fromName}</span>
                  <span className="text-indigo-500">{selected.direction === 'directed' ? '→' : '↔'}</span>
                  <span>{selected.toName}</span>
                </div>
                <div className="mt-2 text-xs text-neutral-600 dark:text-neutral-300">{selected.historicalLabel}</div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div><dt className="text-neutral-500">{t('Tipo')}</dt><dd className="mt-1 font-medium">{t(selected.edgeKind)}</dd></div>
                <div><dt className="text-neutral-500">{t('Dirección')}</dt><dd className="mt-1 font-medium">{directionLabel(selected.direction)}</dd></div>
                <div><dt className="text-neutral-500">{t('Fecha')}</dt><dd className="mt-1 font-medium">{dateInterval(selected)}</dd></div>
                <div><dt className="text-neutral-500">{t('Certeza')}</dt><dd className="mt-1 font-medium">{selected.certainty === null ? '—' : `${Math.round(selected.certainty * 100)} %`}</dd></div>
              </dl>
              {selected.hasContradiction && (
                <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                  {t('La contradicción se conserva junto al apoyo: no se ha sobrescrito ninguna evidencia.')}
                </div>
              )}
              {selected.notes && <p className="mt-4 whitespace-pre-wrap text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">{selected.notes}</p>}
              <section className="mt-6">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold">{t('Apoyo y contradicción')}</h3>
                  <span className="text-[10px] text-neutral-500">{tx('{n} evidencias', { n: selected.evidence.length })}</span>
                </div>
                <EvidenceTraceList evidence={selected.evidence} />
              </section>
            </>
          ) : (
            <div className="py-12 text-center text-sm text-neutral-500">{t('Selecciona una arista para abrir su evidencia.')}</div>
          )}
        </aside>
      </div>
    </div>
  );
}
