import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TestimonyIndexStatus, TestimonySearchHit, TestimonySearchKind, TestimonySemanticHit } from '@shared/types';
import { formatTimecode } from '@shared/testimonies';
import { Icon } from '../components/ui';
import { AccessBadge } from '../components/testimonies/AccessBadge';
import type { DossierTab } from '../components/testimonies/InterviewDossier';
import { t, tx } from '../i18n';

/**
 * Buscar dentro de un proyecto de historia oral.
 *
 * LO QUE UN PASAJE TIENE QUE ENSEÑAR es lo que decide si esta pantalla sirve: el texto,
 * QUIÉN lo dijo, en qué entrevista, en qué minuto y con qué condición de acceso. Sin el
 * hablante y el minuto, un resultado de búsqueda es una frase suelta que hay que volver a
 * localizar a mano; y sin la condición de acceso, es una frase que alguien puede copiar
 * en un artículo sin saber que estaba embargada.
 *
 * ES BÚSQUEDA TEXTUAL LOCAL, sobre SQLite. No hay búsqueda semántica todavía y no es un
 * descuido: indexar embeddings de una entrevista crea un derivado que puede viajar a un
 * proveedor remoto según la configuración, y eso pasa por el acuerdo de cada narradora.
 * Hasta que ese camino esté cerrado de punta a punta, buscar es buscar palabras.
 */
const KIND_LABEL: Record<TestimonySearchKind, string> = {
  interview: 'Entrevistas',
  participant: 'Participantes',
  segment: 'Pasajes de transcripción',
  code: 'Códigos y temas',
  note: 'Notas',
  contrast: 'Contrastes guardados',
};

const KIND_ICON: Record<TestimonySearchKind, string> = {
  interview: 'microphone',
  participant: 'users',
  segment: 'quote',
  code: 'tag',
  note: 'notebook',
  contrast: 'scale',
};

const ALL_KINDS: TestimonySearchKind[] = ['segment', 'interview', 'participant', 'code', 'note', 'contrast'];

export function TestimonySearchView({
  onOpenInterview,
  onNavigate,
}: {
  onOpenInterview: (interviewId: string, tab?: DossierTab) => void;
  onNavigate: (view: 'testimonyParticipants' | 'testimonyContrasts' | 'notes') => void;
}) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'text' | 'semantic'>('text');
  const [semantic, setSemantic] = useState<TestimonySemanticHit[]>([]);
  const [status, setStatus] = useState<TestimonyIndexStatus | null>(null);
  const [indexBusy, setIndexBusy] = useState(false);
  const [indexNote, setIndexNote] = useState('');
  const [semanticError, setSemanticError] = useState('');
  const [kinds, setKinds] = useState<Set<TestimonySearchKind>>(new Set(ALL_KINDS));
  const [hits, setHits] = useState<TestimonySearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async (value: string, selected: Set<TestimonySearchKind>, which: 'text' | 'semantic') => {
    if (value.trim().length < 2) {
      setHits([]);
      setSemantic([]);
      return;
    }
    setSearching(true);
    setSemanticError('');
    try {
      if (which === 'semantic') {
        setSemantic(await window.nodus.searchTestimoniesBySemantics(value, 20));
      } else {
        setHits(await window.nodus.searchTestimonies(value, [...selected]));
      }
    } catch (cause) {
      setSemanticError(cause instanceof Error ? cause.message : String(cause));
      setSemantic([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const reloadStatus = useCallback(async () => {
    setStatus(await window.nodus.testimonyIndexStatus());
  }, []);

  useEffect(() => {
    if (mode === 'semantic') void reloadStatus();
  }, [mode, reloadStatus]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(query, kinds, mode), 220);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query, kinds, mode, run]);

  const grouped = useMemo(() => {
    const map = new Map<TestimonySearchKind, TestimonySearchHit[]>();
    for (const hit of hits) {
      const list = map.get(hit.kind) ?? [];
      list.push(hit);
      map.set(hit.kind, list);
    }
    return ALL_KINDS.filter((kind) => map.has(kind)).map((kind) => [kind, map.get(kind)!] as const);
  }, [hits]);

  const openHit = (hit: TestimonySearchHit): void => {
    switch (hit.kind) {
      case 'segment':
        // Un pasaje abre el dossier en la pestaña donde se ve con su código y su tramo.
        if (hit.interviewId) onOpenInterview(hit.interviewId, 'analysis');
        return;
      case 'interview':
        onOpenInterview(hit.id, 'overview');
        return;
      case 'participant':
        onNavigate('testimonyParticipants');
        return;
      case 'contrast':
        onNavigate('testimonyContrasts');
        return;
      case 'note':
        onNavigate('notes');
        return;
      default:
        return;
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col p-6" data-testid="testimony-search">
      <div className="mx-auto w-full max-w-3xl shrink-0">
        <div className="mb-4 flex items-center gap-3">
          <Icon name="search" size={22} className="text-indigo-300" />
          <h1 className="text-xl font-semibold">{t('Buscar')}</h1>
          {searching && <Icon name="sync" size={14} className="animate-spin text-neutral-500" />}
          <div className="ml-auto inline-flex overflow-hidden rounded-md border border-neutral-300 text-xs dark:border-neutral-700">
            <button
              className={`px-3 py-1.5 ${mode === 'text' ? 'bg-indigo-600 text-white' : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'}`}
              data-testid="testimony-mode-text"
              onClick={() => setMode('text')}
            >
              {t('Texto')}
            </button>
            <button
              className={`px-3 py-1.5 ${mode === 'semantic' ? 'bg-indigo-600 text-white' : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'}`}
              data-testid="testimony-mode-semantic"
              onClick={() => setMode('semantic')}
            >
              {t('Significado')}
            </button>
          </div>
        </div>
        <div className="relative">
          <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            autoFocus
            className="input input-with-leading-icon w-full"
            data-testid="testimony-search-input"
            placeholder={t('Una frase, un nombre, un código…')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {mode === 'semantic' && (
          <div className="mt-3 rounded-lg border border-neutral-200 p-2.5 text-[11px] dark:border-neutral-800" data-testid="testimony-index-panel">
            <p className="leading-5 text-neutral-600 dark:text-neutral-400">
              {t('La búsqueda por significado necesita un índice, y el índice sólo se construye con las entrevistas cuyo acuerdo lo permite. Los embeddings son un derivado de la voz de alguien: si el proveedor es externo, salen del equipo.')}
            </p>
            {status && (
              <p className="mt-1.5 text-neutral-500" data-testid="testimony-index-status">
                {tx('{indexed} de {indexable} entrevistas indexadas · {segments} tramos', {
                  indexed: status.indexed,
                  indexable: status.indexable,
                  segments: status.segments,
                })}
                {status.model ? ` · ${status.model}` : ''}
                {status.stale > 0 ? ` · ${tx('{n} tramos indexados que el acuerdo ya no permite', { n: status.stale })}` : ''}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                className="btn btn-secondary h-7 px-2 text-[11px]"
                data-testid="testimony-index-build"
                disabled={indexBusy}
                onClick={async () => {
                  setIndexBusy(true);
                  setIndexNote('');
                  try {
                    const report = await window.nodus.buildTestimonyIndex();
                    setIndexNote(tx('{segments} tramos de {interviews} entrevistas. {withheld} entrevistas fuera por su acuerdo.', {
                      segments: report.indexedSegments,
                      interviews: report.indexedInterviews,
                      withheld: report.withheld.reduce((total, item) => total + item.interviews, 0),
                    }));
                    await reloadStatus();
                    if (query.trim().length >= 2) await run(query, kinds, 'semantic');
                  } catch (cause) {
                    setIndexNote(cause instanceof Error ? cause.message : String(cause));
                  } finally {
                    setIndexBusy(false);
                  }
                }}
              >
                <Icon name={indexBusy ? 'sync' : 'refresh'} size={12} className={indexBusy ? 'animate-spin' : ''} />
                {t('Construir el índice')}
              </button>
              <button
                className="btn btn-ghost h-7 px-2 text-[11px]"
                disabled={indexBusy}
                onClick={async () => { await window.nodus.clearTestimonyIndex(); await reloadStatus(); setIndexNote(''); }}
              >
                {t('Borrar el índice')}
              </button>
              {indexNote && <span className="text-neutral-500">{indexNote}</span>}
            </div>
          </div>
        )}

        <div className={`mt-3 flex flex-wrap justify-center gap-1.5 ${mode === 'semantic' ? 'hidden' : ''}`}>
          {ALL_KINDS.map((kind) => (
            <button
              key={kind}
              aria-pressed={kinds.has(kind)}
              data-testid={`testimony-search-kind-${kind}`}
              onClick={() => {
                const next = new Set(kinds);
                if (next.has(kind)) next.delete(kind);
                else next.add(kind);
                setKinds(next.size === 0 ? new Set(ALL_KINDS) : next);
              }}
              className={`rounded-full border px-2.5 py-1 text-[11px] ${
                kinds.has(kind)
                  ? 'border-indigo-500 bg-indigo-600 text-white'
                  : 'border-neutral-300 text-neutral-600 hover:text-neutral-800 dark:border-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
              }`}
            >
              {t(KIND_LABEL[kind])}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-5 w-full min-h-0 max-w-3xl flex-1 overflow-y-auto">
        {mode === 'semantic' ? (
          <div className="space-y-2" data-testid="testimony-semantic-results">
            {semanticError && <p className="text-xs text-amber-600 dark:text-amber-400">{semanticError}</p>}
            {query.trim().length < 2 ? (
              <p className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-800">
                {t('Pregunta por una idea y Nodus buscará pasajes que hablen de eso aunque no usen esas palabras.')}
              </p>
            ) : semantic.length === 0 && !searching ? (
              <p className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-800">
                {t('Nada en el índice se parece a eso. Si acabas de añadir entrevistas, reconstruye el índice.')}
              </p>
            ) : semantic.map((hit) => (
              <button
                key={hit.segmentId}
                className="w-full rounded-lg border border-neutral-200 p-2 text-left transition-colors hover:border-indigo-400 dark:border-neutral-800 dark:hover:border-indigo-700"
                data-testid="testimony-semantic-hit"
                onClick={() => onOpenInterview(hit.interviewId, 'analysis')}
              >
                <span className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                  <span className="font-medium text-neutral-700 dark:text-neutral-200">{hit.interviewTitle}</span>
                  <span className="font-mono">{formatTimecode(hit.tStart)}</span>
                  {hit.speakerLabel && <span>{hit.speakerLabel}</span>}
                  <span className="ml-auto">{Math.round(hit.similarity * 100)}%</span>
                </span>
                <span className="mt-1 block text-xs leading-5 text-neutral-600 dark:text-neutral-300">{hit.text}</span>
              </button>
            ))}
          </div>
        ) : query.trim().length < 2 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-800">
            {t('Busca una frase para encontrar el pasaje exacto y volver al minuto en que se dijo.')}
          </p>
        ) : hits.length === 0 && !searching ? (
          <p className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-800">
            {t('Nada coincide con esta búsqueda.')}
          </p>
        ) : (
          <div className="space-y-6">
            {grouped.map(([kind, entries]) => (
              <section key={kind} data-testid={`testimony-search-group-${kind}`}>
                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  <Icon name={KIND_ICON[kind]} size={13} /> {t(KIND_LABEL[kind])}
                  <span className="font-normal">{entries.length}</span>
                </h2>
                <ul className="mt-2 space-y-1.5">
                  {entries.map((hit) => (
                    <li key={`${hit.kind}-${hit.id}`}>
                      <button
                        className="w-full rounded-lg border border-neutral-200 p-2 text-left transition-colors hover:border-indigo-400 dark:border-neutral-800 dark:hover:border-indigo-700"
                        data-testid={`testimony-search-hit-${hit.kind}`}
                        onClick={() => openHit(hit)}
                      >
                        <span className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                          {hit.speakerName && <span className="font-medium text-neutral-700 dark:text-neutral-200">{hit.speakerName}</span>}
                          <span className="min-w-0 truncate">{hit.title}</span>
                          {hit.tStart != null && <span>{formatTimecode(hit.tStart)}</span>}
                          {hit.accessLevel && <AccessBadge level={hit.accessLevel} compact />}
                        </span>
                        {hit.snippet && (
                          <span className="mt-1 block text-xs leading-5 text-neutral-600 dark:text-neutral-300">{hit.snippet}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {hits.length > 0 && (
          <p className="mt-6 text-[11px] leading-5 text-neutral-500">
            {tx('{n} resultados. La búsqueda es textual y local: no se envía nada fuera de este equipo.', { n: hits.length })}
          </p>
        )}
      </div>
    </div>
  );
}
