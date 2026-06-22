import { useCallback, useEffect, useState } from 'react';
import type { GapAggregate, EdgeDetail, GapKind } from '@shared/types';
import { Badge, EDGE_LABELS, Icon } from '../components/ui';
import { VirtualList } from '../components/VirtualList';
import { useDataRefresh, useScanComplete } from '../hooks';
import {
  ASSISTANT_CONTEXTS,
  type PendingAssistantNavigationTarget,
  type PendingGraphNavigationTarget,
} from '../navigation';

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

const GAP_ROW_HEIGHT = 172;
const CONTRADICTION_ROW_HEIGHT = 218;
const GAP_PROMPT_WORK_LIMIT = 8;

export function GapsView({
  onOpenGraph,
  onOpenAssistant,
}: {
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
}) {
  const [gaps, setGaps] = useState<GapAggregate[]>([]);
  const [contradictions, setContradictions] = useState<EdgeDetail[]>([]);
  const [tab, setTab] = useState<'mined' | 'contradictions'>('mined');

  const reload = useCallback(() => {
    void window.nodus.getGaps().then(setGaps);
    void window.nodus.getContradictions().then(setContradictions);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);
  useDataRefresh(reload);
  useScanComplete(reload);

  const openEvidenceInZotero = async (nodusId: string) => {
    const work = await window.nodus.getWork(nodusId);
    if (work) await window.nodus.openInZotero(work.zotero_key);
  };

  return (
    <div className="h-full flex flex-col min-h-0 p-6">
      <div className="shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <Icon name="gap" size={22} className="text-indigo-300" />
          <h1 className="text-xl font-semibold">Huecos de investigación</h1>
        </div>
        <p className="text-sm text-neutral-400 mb-4">
          Agregados del corpus: trabajo futuro y limitaciones minados de las obras, y contradicciones sin reconciliar.
        </p>

        <div className="flex gap-2 mb-4">
          <button
            className={`btn ${tab === 'mined' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab('mined')}
          >
            Minados ({gaps.length})
          </button>
          <button
            className={`btn ${tab === 'contradictions' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab('contradictions')}
          >
            Contradicciones ({contradictions.length})
          </button>
        </div>
      </div>

      {tab === 'mined' && (
        <VirtualList
          items={gaps}
          itemHeight={GAP_ROW_HEIGHT}
          getKey={(g, i) => `${g.kind}:${g.statement}:${i}`}
          className="flex-1 min-h-0"
          empty={<div className="text-neutral-500 text-sm">Aún no hay huecos. Ejecuta escaneos profundos.</div>}
          renderItem={(g) => (
            <div className="card h-[160px] p-3 mr-2">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm flex-1 line-clamp-2">{g.statement}</p>
                <Badge color={KIND_COLOR[g.kind]}>{KIND_LABELS[g.kind]}</Badge>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  className="btn btn-ghost border border-neutral-700 text-xs gap-1.5"
                  onClick={() => onOpenGraph({ preset: 'gaps', label: `Hueco: ${KIND_LABELS[g.kind]}` })}
                >
                  <Icon name="layers" size={13} /> Grafo
                </button>
                <button
                  className="btn btn-ghost border border-neutral-700 text-xs gap-1.5"
                  onClick={() =>
                    onOpenAssistant({
                      title: `Hueco: ${KIND_LABELS[g.kind]}`,
                      selection: ASSISTANT_CONTEXTS.gap,
                      prompt: buildGapAssistantPrompt(g),
                    })
                  }
                >
                  <Icon name="wand" size={13} /> Asistente
                </button>
              </div>
              <div className="text-xs text-neutral-500 mt-2">
                Mencionado en {g.count} obra(s):{' '}
                {g.works.slice(0, 6).map((w) => (
                  <button
                    key={w.nodus_id}
                    className="text-indigo-400 hover:underline mr-2"
                    onClick={() => window.nodus.openInZotero(w.zotero_key)}
                  >
                    {w.title.slice(0, 40)}
                  </button>
                ))}
                {g.works.length > 6 && <span>+{g.works.length - 6} más</span>}
              </div>
            </div>
          )}
        />
      )}

      {tab === 'contradictions' && (
        <VirtualList
          items={contradictions}
          itemHeight={CONTRADICTION_ROW_HEIGHT}
          getKey={(c) => c.edge.id}
          className="flex-1 min-h-0"
          empty={<div className="text-neutral-500 text-sm">No se detectaron contradicciones sin resolver.</div>}
          renderItem={(c) => (
            <div className="card h-[206px] p-3 mr-2">
              <div className="flex items-center gap-2 mb-1">
                <Badge color="red">{EDGE_LABELS[c.edge.type as keyof typeof EDGE_LABELS] ?? c.edge.type}</Badge>
                <Badge color={c.edge.basis === 'explicit' ? 'green' : 'amber'}>{c.edge.basis}</Badge>
                <Badge>conf {c.edge.confidence.toFixed(2)}</Badge>
              </div>
              {c.explanation && <p className="text-sm text-neutral-300 mb-2 line-clamp-2">{c.explanation}</p>}
              <div className="text-sm">
                <span className="text-neutral-200">{c.fromLabel}</span> ✕{' '}
                <span className="text-neutral-200">{c.toLabel}</span>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  className="btn btn-ghost border border-neutral-700 text-xs gap-1.5"
                  onClick={() => onOpenGraph({ preset: 'contradictions', edgeId: c.edge.id, label: 'Contradicción seleccionada' })}
                >
                  <Icon name="layers" size={13} /> Grafo
                </button>
                <button
                  className="btn btn-ghost border border-neutral-700 text-xs gap-1.5"
                  onClick={() =>
                    onOpenAssistant({
                      title: 'Contradicción',
                      selection: ASSISTANT_CONTEXTS.contradiction,
                      prompt:
                        `Analiza esta contradicción del corpus. Resume las posiciones, evidencia y lecturas necesarias para decidir si es tensión real o diferencia de marco.\n\n` +
                        `${c.fromLabel} vs. ${c.toLabel}\n${c.explanation ?? ''}`,
                    })
                  }
                >
                  <Icon name="wand" size={13} /> Asistente
                </button>
              </div>
              {c.evidence.slice(0, 2).map((ev) => (
                <blockquote key={ev.id} className="border-l-2 border-red-700 pl-2 mt-2 text-xs italic text-neutral-400">
                  <span className="block line-clamp-1">“{ev.quote}” {ev.location ?? ''}</span>
                  <button
                    className="ml-2 inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 not-italic"
                    onClick={() => void openEvidenceInZotero(ev.nodus_id)}
                  >
                    <Icon name="external" size={12} /> Zotero
                  </button>
                </blockquote>
              ))}
              {c.evidence.length > 2 && <div className="mt-1 text-[11px] text-neutral-500">+{c.evidence.length - 2} evidencias más</div>}
            </div>
          )}
        />
      )}
    </div>
  );
}

function buildGapAssistantPrompt(gap: GapAggregate): string {
  const works = gap.works.slice(0, GAP_PROMPT_WORK_LIMIT).map((work) => `- ${work.title}`);
  const omitted = gap.works.length - works.length;
  const worksBlock =
    works.length > 0
      ? `\n\nObras donde aparece:\n${works.join('\n')}${omitted > 0 ? `\n- +${omitted} obras más` : ''}`
      : '';
  return (
    `Trabaja este hueco de investigación: identifica obras relevantes, ideas conectadas y próximos pasos.\n\n` +
    `${gap.statement}${worksBlock}`
  );
}
