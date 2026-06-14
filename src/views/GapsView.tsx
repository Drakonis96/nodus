import { useCallback, useEffect, useState } from 'react';
import type { GapAggregate, EdgeDetail, GapKind } from '@shared/types';
import { Badge, EDGE_LABELS, Icon } from '../components/ui';
import { useScanComplete } from '../hooks';

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

export function GapsView() {
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
  useScanComplete(reload);

  return (
    <div className="h-full overflow-y-auto p-6">
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

      {tab === 'mined' && (
        <div className="space-y-2">
          {gaps.length === 0 && <div className="text-neutral-500 text-sm">Aún no hay huecos. Ejecuta escaneos profundos.</div>}
          {gaps.map((g, i) => (
            <div key={i} className="card p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm flex-1">{g.statement}</p>
                <Badge color={KIND_COLOR[g.kind]}>{KIND_LABELS[g.kind]}</Badge>
              </div>
              <div className="text-xs text-neutral-500 mt-2">
                Mencionado en {g.count} obra(s):{' '}
                {g.works.map((w) => (
                  <button
                    key={w.nodus_id}
                    className="text-indigo-400 hover:underline mr-2"
                    onClick={() => window.nodus.openInZotero(w.zotero_key)}
                  >
                    {w.title.slice(0, 40)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'contradictions' && (
        <div className="space-y-2">
          {contradictions.length === 0 && (
            <div className="text-neutral-500 text-sm">No se detectaron contradicciones sin resolver.</div>
          )}
          {contradictions.map((c) => (
            <div key={c.edge.id} className="card p-3">
              <div className="flex items-center gap-2 mb-1">
                <Badge color="red">{EDGE_LABELS[c.edge.type as keyof typeof EDGE_LABELS] ?? c.edge.type}</Badge>
                <Badge color={c.edge.basis === 'explicit' ? 'green' : 'amber'}>{c.edge.basis}</Badge>
                <Badge>conf {c.edge.confidence.toFixed(2)}</Badge>
              </div>
              <div className="text-sm">
                <span className="text-neutral-200">{c.fromLabel}</span> ✕{' '}
                <span className="text-neutral-200">{c.toLabel}</span>
              </div>
              {c.evidence.map((ev) => (
                <blockquote key={ev.id} className="border-l-2 border-red-700 pl-2 mt-1 text-xs italic text-neutral-400">
                  “{ev.quote}” {ev.location ?? ''}
                </blockquote>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
