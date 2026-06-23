import { useCallback, useEffect, useState } from 'react';
import type { GapAggregate, EdgeDetail, GapKind } from '@shared/types';
import { Badge, Icon } from '../components/ui';
import { VirtualList } from '../components/VirtualList';
import { useDataRefresh, useScanComplete } from '../hooks';
import {
  ASSISTANT_CONTEXTS,
  type PendingAssistantNavigationTarget,
  type PendingGraphNavigationTarget,
} from '../navigation';
import { t, tx } from '../i18n';

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
const GAP_PROMPT_WORK_LIMIT = 8;

export function GapsView({
  onOpenGraph,
  onOpenAssistant,
  onOpenDebates,
}: {
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
  onOpenDebates: () => void;
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
            {tx('Minados ({n})', { n: gaps.length })}
          </button>
          <button
            className={`btn ${tab === 'contradictions' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab('contradictions')}
          >
            {tx('Contradicciones ({n})', { n: contradictions.length })}
          </button>
        </div>
      </div>

      {tab === 'mined' && (
        <VirtualList
          items={gaps}
          itemHeight={GAP_ROW_HEIGHT}
          getKey={(g, i) => `${g.kind}:${g.statement}:${i}`}
          className="flex-1 min-h-0"
          empty={<div className="text-neutral-500 text-sm">{t('Aún no hay huecos. Ejecuta escaneos profundos.')}</div>}
          renderItem={(g) => (
            <div className="card h-[160px] p-3 mr-2">
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
                  <Icon name="wand" size={13} /> {t('Asistente')}
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
                { n: contradictions.length }
              )}
            </p>
            <button className="btn btn-primary text-sm gap-1.5" onClick={onOpenDebates}>
              <Icon name="scale" size={14} /> {t('Abrir vista de Debates')}
            </button>
          </div>
        </div>
      )}
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
