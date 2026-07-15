import { useCallback, useEffect, useState } from 'react';
import type { GapAggregate, GapKind, GapSearchSuggestions } from '@shared/types';
import { Badge, Icon } from '../components/ui';
import { VirtualList } from '../components/VirtualList';
import { SaveToNotesModal } from '../components/SaveToNotesModal';
import { buildGapNote } from '../notes';
import { useDataRefresh, useScanComplete } from '../hooks';
import {
  ASSISTANT_CONTEXTS,
  type PendingAssistantNavigationTarget,
  type PendingGraphNavigationTarget,
} from '../navigation';
import { t, tx } from '../i18n';
import { getVaultQueryCache, setVaultQueryCache } from '../vaultQueryCache';

const KIND_LABELS: Record<GapKind, string> = {
  future_work: 'trabajo futuro',
  limitation: 'limitación',
  open_question: 'pregunta abierta',
  unresolved_contradiction: 'contradicción sin resolver',
};

const KIND_COLOR: Record<GapKind, 'amber' | 'red' | 'cyan' | 'indigo'> = {
  future_work: 'cyan',
  limitation: 'amber',
  open_question: 'indigo',
  unresolved_contradiction: 'red',
};

const GAP_ROW_HEIGHT = 188;
const GAPS_PAGE_SIZE = 50;
const GAP_PROMPT_WORK_LIMIT = 8;

export function GapsView({
  vaultId,
  onOpenGraph,
  onOpenAssistant,
  onOpenDebates,
}: {
  vaultId: string | null;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
  onOpenDebates: () => void;
}) {
  const [gaps, setGaps] = useState<GapAggregate[]>([]);
  const [totalGaps, setTotalGaps] = useState(0);
  const [pageOffset, setPageOffset] = useState(0);
  const [contradictionCount, setContradictionCount] = useState(0);
  const [tab, setTab] = useState<'mined' | 'contradictions'>('mined');
  const [savingGap, setSavingGap] = useState<GapAggregate | null>(null);
  const [searchingGap, setSearchingGap] = useState<GapAggregate | null>(null);

  const reload = useCallback((force = true) => {
    const cacheKey = `gaps:${pageOffset}`;
    if (!force) {
      const cached = getVaultQueryCache<{ items: GapAggregate[]; total: number; contradictions: number }>(vaultId, cacheKey);
      if (cached) {
        setGaps(cached.items);
        setTotalGaps(cached.total);
        setContradictionCount(cached.contradictions);
        return;
      }
    }
    void Promise.all([
      window.nodus.getGapsPage(pageOffset, GAPS_PAGE_SIZE),
      window.nodus.getContradictionCount(),
    ]).then(([page, contradictions]) => {
      if (page.total > 0 && page.items.length === 0 && pageOffset > 0) {
        setPageOffset(Math.max(0, Math.floor((page.total - 1) / GAPS_PAGE_SIZE) * GAPS_PAGE_SIZE));
        return;
      }
      setGaps(page.items);
      setTotalGaps(page.total);
      setContradictionCount(contradictions);
      setVaultQueryCache(vaultId, cacheKey, { items: page.items, total: page.total, contradictions });
    });
  }, [pageOffset, vaultId]);

  useEffect(() => {
    reload(false);
  }, [reload]);
  useDataRefresh(reload);
  useScanComplete(reload);

  return (
    <div className="h-full flex flex-col min-h-0 p-6">
      <div className="shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <Icon name="gap" size={22} className="text-indigo-300" />
          <h1 className="text-xl font-semibold">{t('Huecos de investigación')}</h1>
        </div>
        <p className="text-sm text-neutral-400 mb-4">
          {t('Agregados del corpus: trabajo futuro y limitaciones minados de las obras, y contradicciones sin reconciliar.')}
        </p>

        <div className="flex gap-2 mb-4">
          <button
            className={`btn ${tab === 'mined' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab('mined')}
          >
            {tx('Minados ({n})', { n: totalGaps })}
          </button>
          <button
            className={`btn ${tab === 'contradictions' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab('contradictions')}
          >
            {tx('Contradicciones ({n})', { n: contradictionCount })}
          </button>
        </div>
      </div>

      {tab === 'mined' && (
        <div className="flex flex-1 min-h-0 flex-col">
        <VirtualList
          items={gaps}
          itemHeight={GAP_ROW_HEIGHT}
          getKey={(g, i) => `${g.kind}:${g.statement}:${i}`}
          className="flex-1 min-h-0"
          empty={<div className="text-neutral-500 text-sm">{t('Aún no hay huecos. Ejecuta escaneos profundos.')}</div>}
          renderItem={(g) => (
            <div className="card h-[176px] p-3 mr-2">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm flex-1 line-clamp-2">{g.statement}</p>
                <Badge color={KIND_COLOR[g.kind]}>{t(KIND_LABELS[g.kind])}</Badge>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  className="btn btn-ghost border border-neutral-700 text-xs gap-1.5"
                  onClick={() => onOpenGraph({ preset: 'gaps', label: `${t('Hueco:')} ${t(KIND_LABELS[g.kind])}` })}
                >
                  <Icon name="layers" size={13} /> {t('Grafo')}
                </button>
                <button
                  className="btn btn-ghost border border-neutral-700 text-xs gap-1.5"
                  onClick={() =>
                    onOpenAssistant({
                      title: `${t('Hueco:')} ${t(KIND_LABELS[g.kind])}`,
                      selection: ASSISTANT_CONTEXTS.gap,
                      prompt: buildGapAssistantPrompt(g),
                    })
                  }
                >
                  <Icon name="chat" size={13} /> {t('Asistente')}
                </button>
                <button
                  className="btn btn-ghost border border-neutral-700 text-xs gap-1.5"
                  onClick={() => setSearchingGap(g)}
                >
                  <Icon name="search" size={13} /> {t('Buscar fuentes')}
                </button>
                <button
                  className="btn btn-ghost border border-neutral-700 text-xs gap-1.5"
                  onClick={() => setSavingGap(g)}
                >
                  <Icon name="notebook" size={13} /> {t('Guardar en notas')}
                </button>
              </div>
              <div className="text-xs text-neutral-500 mt-2">
                {tx('Mencionado en {n} obra(s):', { n: g.count })}{' '}
                {g.works.slice(0, 6).map((w) => (
                  <button
                    key={w.nodus_id}
                    className="text-indigo-400 hover:underline mr-2"
                    onClick={() => window.nodus.openInZotero(w.zotero_key)}
                  >
                    {w.title.slice(0, 40)}
                  </button>
                ))}
                {g.works.length > 6 && <span>+{g.works.length - 6} {t('más')}</span>}
              </div>
            </div>
          )}
        />
        {totalGaps > GAPS_PAGE_SIZE && (
          <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
            <span>{pageOffset + 1}–{Math.min(pageOffset + gaps.length, totalGaps)} / {totalGaps}</span>
            <div className="flex gap-2">
              <button className="btn btn-ghost border border-neutral-700 px-2 py-1 text-xs" disabled={pageOffset === 0} onClick={() => setPageOffset((offset) => Math.max(0, offset - GAPS_PAGE_SIZE))}>
                <Icon name="arrowLeft" size={13} /> {t('Anterior')}
              </button>
              <button className="btn btn-ghost border border-neutral-700 px-2 py-1 text-xs" disabled={pageOffset + gaps.length >= totalGaps} onClick={() => setPageOffset((offset) => offset + GAPS_PAGE_SIZE)}>
                {t('Siguiente')} <Icon name="arrowRight" size={13} />
              </button>
            </div>
          </div>
        )}
        </div>
      )}

      {tab === 'contradictions' && (
        <div className="flex-1 min-h-0 flex items-start">
          <div className="card p-5 max-w-xl">
            <div className="flex items-center gap-2 mb-2">
              <Icon name="scale" size={20} className="text-rose-300" />
              <h2 className="text-base font-semibold">{t('Las contradicciones ahora viven en Debates')}</h2>
            </div>
            <p className="text-sm text-neutral-400 mb-4">
              {tx(
                'La vista de Debates enfrenta cada contradicción o refutación ({n}) mostrando las dos posiciones, los autores de cada bando, su evidencia y la cronología de la disputa.',
                { n: contradictionCount }
              )}
            </p>
            <button className="btn btn-primary text-sm gap-1.5" onClick={onOpenDebates}>
              <Icon name="scale" size={14} /> {t('Abrir vista de Debates')}
            </button>
          </div>
        </div>
      )}

      {savingGap && (
        <SaveToNotesModal
          content={buildGapNote(savingGap)}
          defaultTitle={`${t('Hueco:')} ${t(KIND_LABELS[savingGap.kind])}`}
          kind="markdown"
          source={{ origin: 'markdown', note: 'gap' }}
          onClose={() => setSavingGap(null)}
        />
      )}

      {searchingGap && <GapSearchModal gap={searchingGap} onClose={() => setSearchingGap(null)} />}
    </div>
  );
}

const SCHOLAR_URL = (q: string) => `https://scholar.google.com/scholar?q=${encodeURIComponent(q)}`;
const SEMANTIC_URL = (q: string) =>
  `https://www.semanticscholar.org/search?q=${encodeURIComponent(q)}&sort=relevance`;

/**
 * Actionable gap: the AI proposes keywords and ready-to-run academic queries, and
 * the user opens any of them directly in Google Scholar / Semantic Scholar to find
 * the literature that would fill the gap.
 */
function GapSearchModal({ gap, onClose }: { gap: GapAggregate; onClose: () => void }) {
  const [suggestions, setSuggestions] = useState<GapSearchSuggestions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let on = true;
    setLoading(true);
    setError(null);
    const titles = gap.works.map((w) => w.title);
    window.nodus
      .suggestGapSearch(gap.statement, titles)
      .then((s) => {
        if (on) setSuggestions(s);
      })
      .catch((e: unknown) => {
        if (on) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (on) setLoading(false);
      });
    return () => {
      on = false;
    };
  }, [gap]);

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(text);
      window.setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500);
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[86vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-neutral-800 px-4 py-3">
          <Icon name="search" className="text-indigo-300" />
          <span className="text-sm font-semibold">{t('Buscar fuentes para el hueco')}</span>
          <div className="flex-1" />
          <button className="btn btn-ghost" onClick={onClose} title={t('Cerrar')}>
            <Icon name="x" />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          <blockquote className="rounded-r-md border-l-2 border-indigo-700 bg-neutral-900/40 py-2 pl-3 pr-2 text-sm text-neutral-300">
            {gap.statement}
          </blockquote>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-neutral-400">
              <Icon name="sync" className="animate-spin" size={15} />
              {t('Generando términos y consultas de búsqueda…')}
            </div>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}

          {suggestions && !loading && (
            <>
              {suggestions.keywords.length > 0 && (
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    {t('Palabras clave')}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions.keywords.map((k) => (
                      <button
                        key={k}
                        className="rounded-full border border-neutral-700 px-2.5 py-0.5 text-xs text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
                        title={t('Copiar')}
                        onClick={() => copy(k)}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {suggestions.queries.length > 0 ? (
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    {t('Consultas sugeridas')}
                  </div>
                  <ul className="space-y-2">
                    {suggestions.queries.map((q) => (
                      <li key={q} className="rounded-md border border-neutral-800 bg-neutral-900/40 p-2.5">
                        <p className="text-sm text-neutral-200">{q}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <button
                            className="btn btn-ghost border border-neutral-700 text-xs gap-1.5 py-1"
                            onClick={() => void window.nodus.openExternal(SCHOLAR_URL(q))}
                          >
                            <Icon name="external" size={12} /> {t('Google Scholar')}
                          </button>
                          <button
                            className="btn btn-ghost border border-neutral-700 text-xs gap-1.5 py-1"
                            onClick={() => void window.nodus.openExternal(SEMANTIC_URL(q))}
                          >
                            <Icon name="external" size={12} /> {t('Semantic Scholar')}
                          </button>
                          <button
                            className="btn btn-ghost text-xs gap-1.5 py-1 text-neutral-400"
                            onClick={() => copy(q)}
                          >
                            <Icon name={copied === q ? 'check' : 'copy'} size={12} />
                            {copied === q ? t('Copiado') : t('Copiar')}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                !loading && <p className="text-sm text-neutral-500">{t('No se generaron consultas.')}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function buildGapAssistantPrompt(gap: GapAggregate): string {
  const works = gap.works.slice(0, GAP_PROMPT_WORK_LIMIT).map((work) => `- ${work.title}`);
  const omitted = gap.works.length - works.length;
  const worksBlock =
    works.length > 0
      ? `\n\n${t('Obras donde aparece:')}\n${works.join('\n')}${omitted > 0 ? `\n- +${tx('{n} obras más', { n: omitted })}` : ''}`
      : '';
  return (
    `${t('Trabaja este hueco de investigación: identifica obras relevantes, ideas conectadas y próximos pasos.')}\n\n` +
    `${gap.statement}${worksBlock}`
  );
}
