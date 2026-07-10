import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { Debate, DebateSide, DebateSideKey, DebateTimelineEntry } from '@shared/types';
import { Badge, EDGE_LABELS, Icon, Spinner } from '../components/ui';
import { Markdown, type MarkdownCitation } from '../components/Markdown';
import { SourceCitationModal, type CitationTarget } from '../components/SourceCitationModal';
import { SaveToNotesModal } from '../components/SaveToNotesModal';
import { useDataRefresh, useScanComplete } from '../hooks';
import {
  ASSISTANT_CONTEXTS,
  type PendingAssistantNavigationTarget,
  type PendingGraphNavigationTarget,
} from '../navigation';
import { t, tx } from '../i18n';

type BasisFilter = 'all' | 'explicit' | 'inferred';
type StatusFilter = 'all' | 'open' | 'leaning';

// Above this many distinct ideas, a connected component is no longer a meaningful
// single "debate" — render its face-offs as standalone cards instead of one cluster.
const MAX_CLUSTER_POSITIONS = 6;

interface AnalysisState {
  text: string;
  loading: boolean;
  error?: string;
  /** Live reasoning/thinking trace from the model. Transient — never persisted. */
  reasoning?: string;
}

export function DebateView({
  onOpenGraph,
  onOpenAssistant,
}: {
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
}) {
  const [debates, setDebates] = useState<Debate[]>([]);
  const [search, setSearch] = useState('');
  const [basis, setBasis] = useState<BasisFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [analyses, setAnalyses] = useState<Record<string, AnalysisState>>({});
  const [citation, setCitation] = useState<CitationTarget>(null);
  const [noteTarget, setNoteTarget] = useState<{ content: string; title: string } | null>(null);

  const reload = useCallback(() => {
    void window.nodus.getDebates().then(setDebates);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);
  useDataRefresh(reload);
  useScanComplete(reload);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return debates.filter((d) => {
      if (basis !== 'all' && d.basis !== basis) return false;
      if (status !== 'all' && d.status !== status) return false;
      if (!q) return true;
      const hay = `${d.sideA.label} ${d.sideA.statement} ${d.sideB.label} ${d.sideB.statement} ${d.sideA.authors.join(
        ' '
      )} ${d.sideB.authors.join(' ')} ${d.sharedThemes.join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [debates, search, basis, status]);

  // Group by cluster so multi-sided debates render together (already cluster-sorted).
  const clusters = useMemo(() => {
    const map = new Map<string, Debate[]>();
    for (const d of filtered) {
      if (!map.has(d.clusterId)) map.set(d.clusterId, []);
      map.get(d.clusterId)!.push(d);
    }
    return Array.from(map.values());
  }, [filtered]);

  const analyze = useCallback((debate: Debate) => {
    setAnalyses((prev) => ({ ...prev, [debate.id]: { text: '', loading: true } }));
    void window.nodus
      .analyzeDebate(
        { debateId: debate.id, model: null },
        {
          onDelta: (delta) =>
            setAnalyses((prev) => ({
              ...prev,
              [debate.id]: { ...prev[debate.id], text: (prev[debate.id]?.text ?? '') + delta, loading: true },
            })),
          onReasoning: (delta) =>
            setAnalyses((prev) => ({
              ...prev,
              [debate.id]: {
                ...prev[debate.id],
                text: prev[debate.id]?.text ?? '',
                loading: true,
                reasoning: (prev[debate.id]?.reasoning ?? '') + delta,
              },
            })),
        }
      )
      .then((res) =>
        setAnalyses((prev) => ({ ...prev, [debate.id]: { text: res.analysis, loading: false } }))
      )
      .catch((err: unknown) =>
        setAnalyses((prev) => ({
          ...prev,
          [debate.id]: {
            text: prev[debate.id]?.text ?? '',
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          },
        }))
      );
  }, []);

  return (
    <div className="h-full flex flex-col min-h-0 p-6">
      <div className="shrink-0">
        <div className="flex items-center gap-3 mb-2">
          <Icon name="scale" size={22} className="text-rose-300" />
          <h1 className="text-xl font-semibold">{t('Debates')}</h1>
          <Badge>{tx('{n} sin reconciliar', { n: debates.length })}</Badge>
        </div>
        <p className="text-sm text-neutral-400 mb-4">
          {t(
            'Cada contradicción o refutación del corpus, enfrentada: las dos posiciones, los autores de cada bando, su evidencia textual y la cronología de la disputa.'
          )}
        </p>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative">
            <Icon name="search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
            <input
              className="input input-with-leading-icon h-8 text-sm w-64"
              placeholder={t('Buscar por idea, autor o tema…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <FilterPills
            value={basis}
            onChange={(v) => setBasis(v as BasisFilter)}
            options={[
              ['all', t('Todas')],
              ['explicit', t('Explícitas')],
              ['inferred', t('Inferidas')],
            ]}
          />
          <FilterPills
            value={status}
            onChange={(v) => setStatus(v as StatusFilter)}
            options={[
              ['all', t('Cualquier estado')],
              ['open', t('Abiertos')],
              ['leaning', t('Inclinados')],
            ]}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto pr-1 space-y-4">
        {filtered.length === 0 && (
          <div className="text-neutral-500 text-sm">
            {debates.length === 0
              ? t('No se detectaron contradicciones sin resolver. Ejecuta escaneos profundos.')
              : t('Ningún debate coincide con los filtros.')}
          </div>
        )}

        {clusters.map((group) => {
          const positions = new Set(group.flatMap((d) => [d.sideA.ideaId, d.sideB.ideaId])).size;
          // Only wrap genuinely small multi-sided debates; a huge connected component
          // (e.g. most contradictions chaining together) renders as standalone cards.
          const isCluster = group.length > 1 && positions <= MAX_CLUSTER_POSITIONS;
          const clusterThemes = Array.from(new Set(group.flatMap((d) => d.sharedThemes)));
          const cards = group.map((d) => (
            <DebateCard
              key={d.id}
              debate={d}
              analysis={analyses[d.id]}
              onAnalyze={() => analyze(d)}
              onOpenGraph={onOpenGraph}
              onOpenAssistant={onOpenAssistant}
              onCite={setCitation}
              onSaveToNotes={(text) =>
                setNoteTarget({
                  content: `# ${t('Debate')}: ${d.sideA.label} · ${d.sideB.label}\n\n> ${d.tension}\n\n${text}`,
                  title: `${t('Debate')}: ${d.sideA.label} · ${d.sideB.label}`,
                })
              }
            />
          ));
          if (!isCluster) return <Fragment key={group[0].clusterId}>{cards}</Fragment>;
          return (
            <div key={group[0].clusterId} className="rounded-lg border border-neutral-800 p-3 bg-neutral-900/40">
              <div className="flex flex-wrap items-center gap-2 mb-3 px-1">
                <Icon name="network" size={15} className="text-rose-300" />
                <span className="text-sm font-medium">{tx('Debate de {n} posiciones', { n: positions })}</span>
                {clusterThemes.slice(0, 4).map((th) => (
                  <Badge key={th} color="neutral">
                    {th}
                  </Badge>
                ))}
              </div>
              <div className="space-y-4">{cards}</div>
            </div>
          );
        })}
      </div>

      {citation && (
        <SourceCitationModal target={citation} onClose={() => setCitation(null)} onOpenGraph={onOpenGraph} />
      )}

      {noteTarget && (
        <SaveToNotesModal
          content={noteTarget.content}
          defaultTitle={noteTarget.title}
          kind="debate"
          source={{ origin: 'debate' }}
          onClose={() => setNoteTarget(null)}
        />
      )}
    </div>
  );
}

function FilterPills({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div className="flex gap-1">
      {options.map(([id, label]) => (
        <button
          key={id}
          className={`btn text-xs ${value === id ? 'btn-primary' : 'btn-ghost border border-neutral-700'}`}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function DebateCard({
  debate,
  analysis,
  onAnalyze,
  onOpenGraph,
  onOpenAssistant,
  onCite,
  onSaveToNotes,
}: {
  debate: Debate;
  analysis?: AnalysisState;
  onAnalyze: () => void;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
  onCite: (c: CitationTarget) => void;
  onSaveToNotes: (text: string) => void;
}) {
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Badge color="red">{t(EDGE_LABELS[debate.relation]) ?? debate.relation}</Badge>
        <Badge color={debate.basis === 'explicit' ? 'green' : 'amber'}>
          {debate.basis === 'explicit' ? t('relación explícita') : t('relación inferida')}
        </Badge>
        <Badge>
          {t('conf')} {debate.confidence.toFixed(2)}
        </Badge>
        {debate.status === 'leaning' && debate.leaningSide ? (
          <Badge color="green">
            <Icon name="arrowDown" size={11} /> {tx('se inclina al bando {s}', { s: debate.leaningSide })}
          </Badge>
        ) : (
          <Badge color="amber">{t('abierto')}</Badge>
        )}
        {debate.internal && <Badge color="neutral">{t('tensión interna')}</Badge>}
        {debate.sharedThemes.slice(0, 3).map((th) => (
          <Badge key={th} color="indigo">
            {th}
          </Badge>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] gap-0 items-stretch">
        <SideColumn side={debate.sideA} accent="indigo" onCite={onCite} />
        <div className="flex flex-col items-center justify-center px-2 text-neutral-500">
          <Icon name="network" size={16} />
          <span className="text-[11px] mt-1">vs</span>
        </div>
        <SideColumn side={debate.sideB} accent="red" onCite={onCite} />
      </div>

      <Timeline timeline={debate.timeline} />

      <div className="flex flex-wrap gap-2 mt-3">
        <button
          className="btn btn-ghost border border-neutral-700 text-xs gap-1.5"
          onClick={() => onOpenGraph({ preset: 'contradictions', edgeId: debate.id, label: t('Debate seleccionado') })}
        >
          <Icon name="layers" size={13} /> {t('Grafo')}
        </button>
        <button
          className="btn btn-ghost border border-neutral-700 text-xs gap-1.5"
          onClick={() =>
            onOpenAssistant({
              title: t('Debate'),
              selection: ASSISTANT_CONTEXTS.contradiction,
              prompt:
                `${t('Analiza este debate del corpus. Resume las posiciones, su evidencia y las lecturas necesarias para decidir si es tensión real o diferencia de marco.')}\n\n` +
                `${debate.sideA.label} vs. ${debate.sideB.label}\n${debate.tension}`,
            })
          }
        >
          <Icon name="wand" size={13} /> {t('Asistente')}
        </button>
        <button className="btn btn-ghost border border-neutral-700 text-xs gap-1.5" onClick={onAnalyze} disabled={analysis?.loading}>
          <Icon name="wand" size={13} /> {analysis ? t('Reanalizar con IA') : t('Analizar debate (IA)')}
        </button>
      </div>

      {analysis && (
        <div className="mt-3 border-t border-neutral-800 pt-3">
          {analysis.loading && !analysis.text && <Spinner label={t('Analizando…')} />}
          {analysis.error ? (
            <p className="text-xs text-red-400">{analysis.error}</p>
          ) : (
            <>
              {analysis.reasoning?.trim() && (
                <details className="mb-2 rounded border border-neutral-800 bg-neutral-950/60" open={!analysis.text.trim()}>
                  <summary className="cursor-pointer select-none px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-200">
                    {t('Razonamiento')}
                  </summary>
                  <div className="max-h-48 overflow-y-auto whitespace-pre-wrap px-2 pb-2 text-[11px] text-neutral-500">
                    {analysis.reasoning}
                  </div>
                </details>
              )}
              <Markdown content={analysis.text} className="text-sm" onCitation={(c: MarkdownCitation) => onCite(c)} />
              {!analysis.loading && analysis.text.trim() && (
                <div className="mt-3">
                  <button
                    className="btn btn-ghost border border-neutral-700 text-xs gap-1.5"
                    onClick={() => onSaveToNotes(analysis.text)}
                  >
                    <Icon name="notebook" size={13} /> {t('Guardar en notas')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SideColumn({
  side,
  accent,
  onCite,
}: {
  side: DebateSide;
  accent: 'indigo' | 'red';
  onCite: (c: CitationTarget) => void;
}) {
  const bg = accent === 'indigo' ? 'bg-indigo-900/50' : 'bg-red-900/50';
  const border = accent === 'indigo' ? 'border-indigo-700' : 'border-red-800';
  const yearLabel =
    side.earliestYear == null
      ? null
      : side.latestYear && side.latestYear !== side.earliestYear
        ? `${side.earliestYear}–${side.latestYear}`
        : `${side.earliestYear}`;
  return (
    <div className={`rounded-md p-3 ${bg}`}>
      <button
        className="text-sm font-medium text-left text-neutral-100 hover:underline"
        onClick={() => onCite({ kind: 'idea', id: side.ideaId })}
      >
        {side.statement || side.label}
      </button>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {side.authors.slice(0, 5).map((a) => (
          <span key={a} className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300">
            {a}
          </span>
        ))}
        {side.authors.length > 5 && <span className="text-[11px] text-neutral-500">+{side.authors.length - 5}</span>}
      </div>
      {side.works.slice(0, 2).flatMap((w) =>
        w.evidence.slice(0, 1).map((ev) => (
          <blockquote key={ev.id} className={`border-l-2 ${border} pl-2 mt-2 text-xs italic text-neutral-400`}>
            <span className="block line-clamp-2">“{ev.quote}”</span>
            <button
              className="mt-1 inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 not-italic"
              title={t('Abrir el PDF en Zotero por esta página')}
              onClick={() => void window.nodus.openEvidenceAtPage(w.nodus_id, ev.location)}
            >
              <Icon name="external" size={12} /> {ev.location ?? 'Zotero'}
            </button>
          </blockquote>
        ))
      )}
      {yearLabel && <div className="text-[11px] text-neutral-500 mt-2">{yearLabel}</div>}
    </div>
  );
}

function Timeline({ timeline }: { timeline: DebateTimelineEntry[] }) {
  const dated = timeline.filter((e) => e.year != null) as (DebateTimelineEntry & { year: number })[];
  if (dated.length < 2) return null;
  const years = dated.map((e) => e.year);
  const min = Math.min(...years);
  const max = Math.max(...years);
  const span = max - min;
  const pos = (y: number) => (span === 0 ? 50 : ((y - min) / span) * 100);
  const color = (side: DebateSideKey) => (side === 'A' ? '#6366f1' : '#ef4444');
  return (
    <div className="mt-3 pt-3 border-t border-neutral-800">
      <div className="text-xs text-neutral-500 mb-2 flex items-center gap-1.5">
        <Icon name="route" size={13} /> {t('Cronología de la disputa')}
      </div>
      <div className="relative h-10 mx-1">
        <div className="absolute top-3 left-0 right-0 h-px bg-neutral-700" />
        {dated.map((e, i) => (
          <div
            key={`${e.nodus_id}-${i}`}
            className="absolute -translate-x-1/2 text-center"
            style={{ left: `${pos(e.year)}%`, top: 0 }}
            title={`${e.authors[0] ?? ''} · ${e.year}`}
          >
            <span className="block w-2.5 h-2.5 rounded-full mx-auto" style={{ backgroundColor: color(e.side) }} />
            <span className="text-[10px] text-neutral-500">{e.year}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
