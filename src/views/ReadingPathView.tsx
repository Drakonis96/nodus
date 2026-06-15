import { useCallback, useEffect, useState } from 'react';
import type { ReadingPathEntry, ReadingPathPlan, ReadingPathStrategy } from '@shared/types';
import { Badge, Icon, Spinner } from '../components/ui';
import { useScanComplete } from '../hooks';

const STRATEGY_LABELS: Record<ReadingPathStrategy, string> = {
  research_relevance: 'Más relevante',
  gaps: 'Cubrir huecos',
  foundational: 'Textos de base',
  recent: 'Más recientes',
  connected_authors: 'Autores conectados',
  bridges: 'Conectar temas',
};

const STRATEGY_HELP: Record<ReadingPathStrategy, string> = {
  research_relevance: 'Equilibra objetivos, temas principales, huecos y prioridad académica.',
  gaps: 'Prioriza documentos vinculados con huecos, contradicciones y preguntas abiertas.',
  foundational: 'Sube obras antiguas, citadas internamente o usadas como dependencia conceptual.',
  recent: 'Ordena por actualidad sin ignorar relevancia temática.',
  connected_authors: 'Da peso a autores relacionados por el grafo de ideas.',
  bridges: 'Busca textos que conectan varias líneas temáticas o zonas del grafo.',
};

export function ReadingPathView() {
  const [plan, setPlan] = useState<ReadingPathPlan | null>(null);
  const [strategy, setStrategy] = useState<ReadingPathStrategy>('research_relevance');
  const [researchBrief, setResearchBrief] = useState('');
  const [limit, setLimit] = useState(72);
  const [includeRead, setIncludeRead] = useState(true);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setPlan(await window.nodus.getReadingPath({ strategy, researchBrief, limit, includeRead }));
    } finally {
      setLoading(false);
    }
  }, [strategy, researchBrief, limit, includeRead]);

  useEffect(() => {
    void reload();
  }, []);
  useScanComplete(reload);

  const phases = plan?.phases ?? [];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold mb-1">Ruta de lectura</h1>
          <p className="text-sm text-neutral-400">
            Plan por fases según estado de lectura, análisis, huecos, temas, autores e ideas conectadas.
          </p>
        </div>
        <div className="flex-1" />
        <button className="btn btn-primary gap-1.5" onClick={() => void reload()} disabled={loading}>
          <Icon name="wand" /> Analizar ruta
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_18rem] gap-4 mb-5">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <select className="input" value={strategy} onChange={(e) => setStrategy(e.target.value as ReadingPathStrategy)}>
              {Object.entries(STRATEGY_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <select className="input" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {[36, 72, 108, 144].map((n) => (
                <option key={n} value={n}>
                  {n} lecturas
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                className="h-4 w-4 accent-indigo-500"
                checked={includeRead}
                onChange={(e) => setIncludeRead(e.target.checked)}
              />
              Incluir leídas
            </label>
          </div>
          <textarea
            className="input w-full min-h-24 resize-y"
            value={researchBrief}
            onChange={(e) => setResearchBrief(e.target.value)}
            placeholder="Describe tu investigación, preguntas principales, objetivos o prioridades actuales..."
          />
          <div className="text-xs text-neutral-500">{STRATEGY_HELP[strategy]}</div>
        </div>

        <div className="border border-neutral-800 rounded-lg p-3 bg-neutral-900/40">
          {plan ? (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Metric label="Corpus" value={plan.totalWorks} />
              <Metric label="Mostradas" value={plan.shownWorks} />
              <Metric label="Leídas" value={plan.readCount} />
              <Metric label="Por leer" value={plan.unreadCount} />
              <Metric label="Analizadas" value={plan.analyzedCount} />
              <Metric label="Pendientes" value={plan.pendingAnalysisCount} />
            </div>
          ) : (
            <div className="text-sm text-neutral-500">Sin plan calculado.</div>
          )}
        </div>
      </div>

      {loading && (
        <div className="mb-4">
          <Spinner label="Recalculando ruta..." />
        </div>
      )}

      {plan && <p className="text-sm text-neutral-400 mb-4">{plan.summary}</p>}

      <div className="space-y-7">
        {phases.map((phase) => (
          <section key={phase.id}>
            <div className="flex flex-wrap items-end gap-2 mb-2">
              <div>
                <h2 className="text-base font-semibold">{phase.title}</h2>
                <p className="text-xs text-neutral-500">{phase.objective}</p>
              </div>
              <div className="flex-1" />
              <Badge>{phase.entries.length}/{phase.totalCandidates}</Badge>
              {phase.omitted > 0 && <Badge color="amber">{phase.omitted} fuera del bloque</Badge>}
            </div>
            <ol className="space-y-2">
              {phase.entries.map((entry, i) => (
                <ReadingEntryCard key={entry.nodus_id} entry={entry} index={i + 1} />
              ))}
            </ol>
          </section>
        ))}
      </div>

      {plan && phases.length === 0 && <div className="text-neutral-500 text-sm">No hay obras que cumplan los filtros actuales.</div>}
    </div>
  );
}

function ReadingEntryCard({ entry, index }: { entry: ReadingPathEntry; index: number }) {
  return (
    <li className={`card p-3 flex gap-3 items-start ${entry.read ? 'opacity-75' : ''}`}>
      <div className="text-lg font-mono text-neutral-600 w-8 text-right">{index}</div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-sm">{entry.title}</span>
          {entry.read ? <Badge color="indigo">leída</Badge> : <Badge color="amber">por leer</Badge>}
          <Badge color={entry.analysis.deepStatus === 'done' ? 'green' : 'neutral'}>{entry.analysis.deepStatus === 'done' ? 'ideas analizadas' : 'ideas pendientes'}</Badge>
          <Badge color={entry.analysis.lightStatus === 'done' ? 'cyan' : 'neutral'}>{entry.analysis.lightStatus === 'done' ? 'temas analizados' : 'temas pendientes'}</Badge>
          <Badge>prioridad {entry.priority}</Badge>
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          {entry.authors[0] ?? '—'}
          {entry.authors.length > 1 ? ' et al.' : ''} · {entry.year ?? 's.f.'}
          {entry.themes.length > 0 ? ` · ${entry.themes.slice(0, 4).join(', ')}` : ''}
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {entry.analysis.ideaCount > 0 && <Badge color="green">{entry.analysis.ideaCount} ideas</Badge>}
          {entry.analysis.themeCount > 0 && <Badge color="cyan">{entry.analysis.themeCount} temas</Badge>}
          {entry.analysis.contradictionCount > 0 && <Badge color="red">{entry.analysis.contradictionCount} contrad.</Badge>}
          {entry.analysis.gapCount > 0 && <Badge color="amber">{entry.analysis.gapCount} huecos</Badge>}
          {entry.bridgeScore >= 0.45 && <Badge color="indigo">puente</Badge>}
        </div>
        <p className="text-xs text-neutral-400 mt-2">{entry.reason}</p>
        {entry.relatedGaps.length > 0 && (
          <div className="mt-2 text-xs text-neutral-500">
            Huecos relacionados: {entry.relatedGaps.map((g) => g.slice(0, 120)).join(' · ')}
          </div>
        )}
      </div>
    </li>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-neutral-800 px-2 py-1.5">
      <div className="text-neutral-500">{label}</div>
      <div className="text-neutral-100 font-semibold text-sm">{value}</div>
    </div>
  );
}
