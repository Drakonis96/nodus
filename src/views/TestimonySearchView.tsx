import { useCallback, useEffect, useRef, useState } from 'react';
import type { TestimonyIndexStatus, TestimonySearchHit, TestimonySearchKind } from '@shared/types';
import { mergeHybridResults } from '@shared/hybridSearch';
import { SearchKindFilters } from '../components/search/SearchKindFilters';
import { formatTimecode } from '@shared/testimonies';
import { Icon } from '../components/ui';
import { AccessBadge } from '../components/testimonies/AccessBadge';
import type { DossierTab } from '../components/testimonies/InterviewDossier';
import { t, tx } from '../i18n';

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
  const [showIndex, setShowIndex] = useState(false);
  const [status, setStatus] = useState<TestimonyIndexStatus | null>(null);
  const [indexBusy, setIndexBusy] = useState(false);
  const [indexNote, setIndexNote] = useState('');
  const [semanticError, setSemanticError] = useState('');
  const [kinds, setKinds] = useState<Set<TestimonySearchKind>>(new Set(ALL_KINDS));
  const [hits, setHits] = useState<TestimonySearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestId = useRef(0);
  const run = useCallback(async (value: string, selected: Set<TestimonySearchKind>) => {
    const id = ++requestId.current;
    setHits([]); setSemanticError('');
    if (value.trim().length < 2 || !selected.size) { setSearching(false); return; }
    setSearching(true);
    const [literal, semantic] = await Promise.allSettled([
      window.nodus.searchTestimonies(value, [...selected]),
      selected.has('segment') ? window.nodus.searchTestimoniesBySemantics(value, 80) : Promise.resolve([]),
    ]);
    if (id !== requestId.current) return;
    const semanticHits: TestimonySearchHit[] = semantic.status === 'fulfilled' ? semantic.value.map((hit) => ({
      kind: 'segment', id: hit.segmentId, title: hit.interviewTitle, snippet: hit.text,
      interviewId: hit.interviewId, tStart: hit.tStart, speakerName: hit.speakerLabel ?? undefined,
      similarity: hit.similarity,
    })) : [];
    setHits(mergeHybridResults(value, literal.status === 'fulfilled' ? literal.value : [], semanticHits, selected));
    if (literal.status === 'rejected' || semantic.status === 'rejected') {
      const cause = literal.status === 'rejected' ? literal.reason : semantic.status === 'rejected' ? semantic.reason : '';
      setSemanticError(cause instanceof Error ? cause.message : String(cause));
    }
    setSearching(false);
  }, []);

  const reloadStatus = useCallback(async () => {
    setStatus(await window.nodus.testimonyIndexStatus());
  }, []);

  useEffect(() => { void reloadStatus(); }, [reloadStatus]);
  useEffect(() => {
    ++requestId.current;
    setHits([]); setSearching(false); setSemanticError('');
    timer.current = setTimeout(() => void run(query, kinds), 220);
    return () => { ++requestId.current; if (timer.current) clearTimeout(timer.current); };
  }, [query, kinds, run]);

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
          <button className="btn btn-ghost ml-auto text-xs" onClick={() => setShowIndex((value) => !value)} aria-expanded={showIndex}>{t('Índice')}</button>
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
        {showIndex && (
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
                    if (query.trim().length >= 2) await run(query, kinds);
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

        <SearchKindFilters options={ALL_KINDS.map((kind) => ({ kind, label: KIND_LABEL[kind], icon: KIND_ICON[kind] }))} selected={kinds} onChange={setKinds} />
      </div>

      <div className="mx-auto mt-5 w-full min-h-0 max-w-3xl flex-1 overflow-y-auto">
        {semanticError && <p role="status" className="mb-3 text-xs text-amber-600 dark:text-amber-400">{semanticError}</p>}
        {query.trim().length < 2 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-800">
            {t('Busca una frase para encontrar el pasaje exacto y volver al minuto en que se dijo.')}
          </p>
        ) : hits.length === 0 && !searching ? (
          <p className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-800">
            {t('Nada coincide con esta búsqueda.')}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {hits.map((hit) => (
              <li key={`${hit.kind}-${hit.id}`}>
                      <button
                        className="w-full rounded-lg border border-neutral-200 p-2 text-left transition-colors hover:border-indigo-400 dark:border-neutral-800 dark:hover:border-indigo-700"
                        data-testid={`testimony-search-hit-${hit.kind}`}
                        onClick={() => openHit(hit)}
                      >
                        <span className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500"><Icon name={KIND_ICON[hit.kind]} size={13} />{t(KIND_LABEL[hit.kind])}
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
        )}

        {hits.length > 0 && (
          <p className="mt-6 text-[11px] leading-5 text-neutral-500">
            {tx('{count} resultados', { count: hits.length })}
          </p>
        )}
      </div>
    </div>
  );
}
