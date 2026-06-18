import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkView, WorkFilter, DeepStatus, LightStatus, AppSettings, ModelRef, WorkEmbeddingStatus, SemanticBridgeProgress } from '@shared/types';
import { Badge, Icon } from '../components/ui';
import { ModelPicker } from '../components/ModelPicker';
import {
  ASSISTANT_CONTEXTS,
  type PendingAssistantNavigationTarget,
  type PendingGraphNavigationTarget,
} from '../navigation';

function lightBadge(s: LightStatus) {
  if (s === 'done') return <Badge color="green">ligero ✓</Badge>;
  if (s === 'none') return <Badge color="neutral">—</Badge>;
  if (s === 'failed') return <Badge color="red">ligero ✕</Badge>;
  return <Badge color="neutral">ligero…</Badge>;
}

function deepBadge(s: DeepStatus) {
  switch (s) {
    case 'done':
      return <Badge color="indigo">profundo ✓</Badge>;
    case 'pending':
      return <Badge color="amber">profundo…</Badge>;
    case 'failed':
      return <Badge color="red">profundo ✕</Badge>;
    case 'skipped_no_text':
      return <Badge color="amber" title="Sin texto disponible">sin texto</Badge>;
    default:
      return <Badge color="neutral">—</Badge>;
  }
}

function triggerBadge(w: WorkView) {
  if (!w.deep_trigger) return null;
  if (w.deep_trigger === 'tag') return <span title="Por tag">🏷</span>;
  if (w.deep_trigger === 'manual') return <span title="Manual">✦</span>;
  return (
    <span title="Tag + manual">
      🏷✦
    </span>
  );
}

function embeddingBadge(status: WorkEmbeddingStatus | undefined) {
  if (!status || status.totalIdeas === 0) return <Badge color="neutral">—</Badge>;
  if (status.complete) return <Badge color="cyan">✓ {status.embeddedIdeas}</Badge>;
  return (
    <Badge color="amber" title={`${status.embeddedIdeas}/${status.totalIdeas} ideas indexadas`}>
      {status.embeddedIdeas}/{status.totalIdeas}
    </Badge>
  );
}

export function Library({
  settings,
  onOpenCollections,
  onOpenGraph,
  onOpenAssistant,
}: {
  settings: AppSettings;
  onOpenCollections: () => void;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
}) {
  const [works, setWorks] = useState<WorkView[]>([]);
  const [filter, setFilter] = useState<WorkFilter>({ lightStatus: 'all', deepStatus: 'all' });
  const [loading, setLoading] = useState(true);
  const [scanModel, setScanModel] = useState<ModelRef | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [embeddingStatuses, setEmbeddingStatuses] = useState<Map<string, WorkEmbeddingStatus>>(new Map());
  const [bridgeProgress, setBridgeProgress] = useState<SemanticBridgeProgress | null>(null);
  const [bridgeRunning, setBridgeRunning] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const w = await window.nodus.listWorks(filter);
    setWorks(w);
    const statuses = await window.nodus.getWorkEmbeddingStatuses();
    setEmbeddingStatuses(new Map(statuses.map((s) => [s.nodus_id, s])));
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const analyzeThemes = async (w: WorkView) => {
    await window.nodus.rescan(w.nodus_id, 'light', scanModel);
    await load();
  };

  const analyzeIdeas = async (w: WorkView) => {
    if (w.deep_status === 'done') {
      await window.nodus.rescan(w.nodus_id, 'deep', scanModel);
    } else {
      await window.nodus.setManualDeep(w.nodus_id, true, scanModel);
    }
    await load();
  };

  const analyzeBoth = async (w: WorkView) => {
    await window.nodus.analyzeBoth(w.nodus_id, scanModel);
    await load();
  };

  const analyzeSelectedThemes = async () => {
    for (const id of selected) {
      await window.nodus.rescan(id, 'light', scanModel);
    }
    setSelected(new Set());
    await load();
  };

  const analyzeSelectedIdeas = async () => {
    await window.nodus.setManualDeepBulk(Array.from(selected), true, scanModel);
    setSelected(new Set());
    await load();
  };

  const analyzeSelectedBoth = async () => {
    await window.nodus.analyzeBothBulk(Array.from(selected), scanModel);
    setSelected(new Set());
    await load();
  };

  const reassignThemes = async () => {
    const ok = window.confirm(
      'Reasignar temas vuelve a ejecutar el análisis ligero (título + abstract) sobre TODA la biblioteca para reconstruir los temas padre y agrupar las ideas existentes bajo ellos. Consume tokens del modelo seleccionado. ¿Continuar?'
    );
    if (!ok) return;
    const n = await window.nodus.reassignThemes(scanModel);
    await load();
    window.alert(`Reasignación de temas en cola para ${n} obra(s). Verás el progreso en la cola.`);
  };

  const embedWork = async (nodusId: string) => {
    await window.nodus.startEmbedding([nodusId]);
  };

  const embedSelected = async () => {
    await window.nodus.startEmbedding(Array.from(selected));
    setSelected(new Set());
  };

  const embedAll = async () => {
    const ok = window.confirm(
      'Se generarán embeddings para todas las ideas de las obras con análisis profundo. Esto consume tokens del proveedor de embeddings configurado. ¿Continuar?'
    );
    if (!ok) return;
    await window.nodus.startEmbedding();
  };

  const needsEmbedding = (w: WorkView) => {
    const s = embeddingStatuses.get(w.nodus_id);
    return w.deep_status === 'done' && s && !s.complete && s.totalIdeas > 0;
  };

  const discoverBridges = async () => {
    setBridgeRunning(true);
    setBridgeProgress(null);
    try {
      const result = await window.nodus.discoverSemanticBridges(scanModel);
      window.alert(
        `${result.candidatesScanned} candidatos escaneados (${result.crossThemeCandidates} cross-tema)\n` +
        `${result.validated} validados por IA → ${result.added} nuevas relaciones`
      );
    } catch (e) {
      window.alert(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBridgeRunning(false);
      setBridgeProgress(null);
      await load();
    }
  };

  useEffect(() => {
    return window.nodus.onSemanticBridgeProgress(setBridgeProgress);
  }, []);

  const toggleSelected = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const allVisibleSelected = works.length > 0 && works.every((w) => selected.has(w.nodus_id));
  const summary = useMemo(() => {
    const pendingEmbeddings = works.filter((w) => {
      const s = embeddingStatuses.get(w.nodus_id);
      return w.deep_status === 'done' && s && !s.complete && s.totalIdeas > 0;
    }).length;
    return {
      withoutThemes: works.filter((w) => w.light_status === 'none').length,
      themesDone: works.filter((w) => w.light_status === 'done').length,
      ideasDone: works.filter((w) => w.deep_status === 'done').length,
      failed: works.filter((w) => w.light_status === 'failed' || w.deep_status === 'failed').length,
      pendingEmbeddings,
    };
  }, [embeddingStatuses, works]);

  return (
    <div className="h-full flex flex-col p-6 min-h-0">
      <div className="flex flex-wrap items-start gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold">Biblioteca</h1>
          <p className="text-sm text-neutral-500 mt-1">{works.length} obras visibles</p>
        </div>
        <div className="flex-1" />
        <button
          className={`btn border border-neutral-700 gap-1.5 ${advancedOpen ? 'bg-neutral-800 text-neutral-100' : 'btn-ghost'}`}
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
        >
          <Icon name="wand" /> Operaciones
        </button>
        <button className="btn btn-ghost border border-neutral-700" onClick={onOpenCollections}>
          <Icon name="folder" /> Colecciones
        </button>
      </div>

      <div className="card p-3 mb-3">
        <div className="flex flex-wrap gap-2 items-center">
          <input
            className="input"
            placeholder="Buscar título o autor…"
            onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
          />
          <select
            className="input"
            value={filter.lightStatus}
            onChange={(e) => setFilter((f) => ({ ...f, lightStatus: e.target.value as any }))}
          >
            <option value="all">Ligero: todos</option>
            <option value="none">Ligero: ninguno</option>
            <option value="done">Ligero: hecho</option>
            <option value="pending">Ligero: pendiente</option>
            <option value="failed">Ligero: fallido</option>
          </select>
          <select
            className="input"
            value={filter.deepStatus}
            onChange={(e) => setFilter((f) => ({ ...f, deepStatus: e.target.value as any }))}
          >
            <option value="all">Profundo: todos</option>
            <option value="done">Profundo: hecho</option>
            <option value="pending">Profundo: pendiente</option>
            <option value="none">Profundo: ninguno</option>
            <option value="skipped_no_text">Profundo: sin texto</option>
          </select>
          <div className="flex-1" />
          <span className="text-xs text-neutral-500">Modelo para análisis</span>
          <ModelPicker settings={settings} value={scanModel} onChange={setScanModel} compact />
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <SummaryPill label="temas hechos" value={summary.themesDone} />
          <SummaryPill label="sin temas" value={summary.withoutThemes} />
          <SummaryPill label="ideas hechas" value={summary.ideasDone} />
          <SummaryPill label="embeddings pendientes" value={summary.pendingEmbeddings} tone="cyan" />
          {summary.failed > 0 && <SummaryPill label="fallos" value={summary.failed} tone="red" />}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mb-3 rounded-lg border border-indigo-800/70 bg-indigo-950/20 px-3 py-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-indigo-200">{selected.size} seleccionadas</span>
          <span className="hidden sm:block h-5 w-px bg-indigo-800/70" />
          <button className="btn btn-ghost border border-neutral-700" onClick={analyzeSelectedThemes}>
            <Icon name="tag" /> Temas
          </button>
          <button className="btn btn-ghost border border-neutral-700" onClick={analyzeSelectedIdeas}>
            <Icon name="bulb" /> Ideas
          </button>
          <button className="btn btn-primary" onClick={analyzeSelectedBoth}>
            <Icon name="layers" /> Temas + ideas
          </button>
          <button className="btn btn-ghost border border-cyan-800 text-cyan-300" onClick={embedSelected}>
            <Icon name="search" /> Indexar
          </button>
          <div className="flex-1" />
          <button className="btn btn-ghost" onClick={() => setSelected(new Set())}>
            Limpiar selección
          </button>
        </div>
      )}

      {advancedOpen && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mb-4">
          <OperationCard
            icon="wand"
            title="Reasignar temas"
            description="Reconstruye los temas padre de toda la biblioteca con análisis ligero. Útil tras cambiar criterios temáticos."
            buttonLabel="Reasignar"
            onClick={reassignThemes}
          />
          <OperationCard
            icon="search"
            title="Indexar embeddings"
            description="Genera embeddings para las ideas ya extraídas. Mejora similitud, fusión y búsqueda de relaciones."
            buttonLabel="Indexar todo"
            tone="cyan"
            onClick={embedAll}
          />
          <OperationCard
            icon="compass"
            title="Descubrir relaciones"
            description="Usa embeddings e IA para validar puentes semánticos entre ideas que aún no están conectadas."
            buttonLabel={bridgeRunning ? bridgeProgress?.label ?? 'Descubriendo…' : 'Descubrir'}
            tone="violet"
            disabled={bridgeRunning}
            onClick={discoverBridges}
          />
        </div>
      )}

      <div className="card flex-1 overflow-auto min-h-0">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-neutral-900 text-neutral-400 text-left">
            <tr>
              <th className="p-2 font-medium w-8">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(e) => {
                    if (e.target.checked) setSelected(new Set(works.map((w) => w.nodus_id)));
                    else setSelected(new Set());
                  }}
                />
              </th>
              <th className="p-2 font-medium">Título</th>
              <th className="p-2 font-medium">Autores</th>
              <th className="p-2 font-medium">Año</th>
              <th className="p-2 font-medium">Tema(s)</th>
              <th className="p-2 font-medium">Ligero</th>
              <th className="p-2 font-medium">Profundo</th>
              <th className="p-2 font-medium">Embeddings</th>
              <th className="p-2 font-medium" data-tour="library-actions">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td className="p-4 text-neutral-500" colSpan={9}>
                  Cargando…
                </td>
              </tr>
            )}
            {!loading &&
              works.map((w) => (
                <tr key={w.nodus_id} className="border-t border-neutral-800 hover:bg-neutral-900/50">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={selected.has(w.nodus_id)}
                      onChange={(e) => toggleSelected(w.nodus_id, e.target.checked)}
                    />
                  </td>
                  <td className="p-2 max-w-md">
                    <div className="truncate" title={w.title}>
                      {w.title}
                    </div>
                    <div className="text-[10px] text-neutral-600 font-mono">{w.nodus_id.slice(0, 8)}</div>
                  </td>
                  <td className="p-2 text-neutral-400">
                    {w.authors[0] ?? '—'}
                    {w.authors.length > 1 ? ' et al.' : ''}
                  </td>
                  <td className="p-2 text-neutral-400">{w.year ?? '—'}</td>
                  <td className="p-2 text-neutral-400 max-w-[140px] truncate">{w.themes.join(', ')}</td>
                  <td className="p-2">{lightBadge(w.light_status)}</td>
                  <td className="p-2 whitespace-nowrap">
                    {deepBadge(w.deep_status)} {triggerBadge(w)}
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    {embeddingBadge(embeddingStatuses.get(w.nodus_id))}
                    {needsEmbedding(w) && (
                      <button
                        className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-cyan-400 hover:text-cyan-300"
                        title="Indexar embeddings de esta obra"
                        onClick={() => embedWork(w.nodus_id)}
                      >
                        <Icon name="search" size={11} />
                      </button>
                    )}
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <RowIconButton title="Analizar temas" icon="tag" onClick={() => analyzeThemes(w)} />
                      <RowIconButton title={w.deep_status === 'done' ? 'Reanalizar ideas' : 'Analizar ideas'} icon="bulb" onClick={() => analyzeIdeas(w)} />
                      <RowIconButton title="Analizar temas e ideas" icon="layers" onClick={() => analyzeBoth(w)} />
                      <RowIconButton
                        title="Ver esta obra en el grafo"
                        icon="map"
                        tone="cyan"
                        onClick={() =>
                          onOpenGraph({
                            preset: 'reading',
                            workId: w.nodus_id,
                            workTitle: w.title,
                            zoteroKey: w.zotero_key,
                            label: `Lectura: ${w.title}`,
                          })
                        }
                      />
                      <RowIconButton
                        title="Preguntar al asistente sobre esta obra"
                        icon="wand"
                        tone="violet"
                        onClick={() =>
                          onOpenAssistant({
                            title: `Lectura: ${w.title}`,
                            selection: ASSISTANT_CONTEXTS.reading,
                            prompt:
                              `Analiza esta lectura dentro del corpus: ideas extraídas, temas, huecos, contradicciones y próximas lecturas relacionadas.\n\n` +
                              `${w.title}\n${w.authors.join(', ')}${w.year ? ` (${w.year})` : ''}`,
                          })
                        }
                      />
                      <RowIconButton title="Abrir en Zotero" icon="external" tone="indigo" onClick={() => window.nodus.openInZotero(w.zotero_key)} />
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryPill({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'cyan' | 'red';
}) {
  const toneClass =
    tone === 'cyan'
      ? 'border-cyan-900/70 text-cyan-300'
      : tone === 'red'
        ? 'border-red-900/70 text-red-300'
        : 'border-neutral-800 text-neutral-400';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${toneClass}`}>
      <span className="font-semibold tabular-nums text-neutral-100">{value}</span>
      {label}
    </span>
  );
}

function OperationCard({
  icon,
  title,
  description,
  buttonLabel,
  tone = 'neutral',
  disabled,
  onClick,
}: {
  icon: string;
  title: string;
  description: string;
  buttonLabel: string;
  tone?: 'neutral' | 'cyan' | 'violet';
  disabled?: boolean;
  onClick: () => void;
}) {
  const toneClass =
    tone === 'cyan'
      ? 'border-cyan-900/70 text-cyan-300'
      : tone === 'violet'
        ? 'border-violet-900/70 text-violet-300'
        : 'border-neutral-800 text-neutral-300';
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md border ${toneClass}`}>
          <Icon name={icon} />
        </span>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-neutral-500 mt-1 leading-relaxed">{description}</p>
        </div>
      </div>
      <button className="btn btn-ghost border border-neutral-700 mt-auto" disabled={disabled} onClick={onClick}>
        {buttonLabel}
      </button>
    </section>
  );
}

function RowIconButton({
  title,
  icon,
  tone = 'neutral',
  onClick,
}: {
  title: string;
  icon: string;
  tone?: 'neutral' | 'indigo' | 'cyan' | 'violet';
  onClick: () => void;
}) {
  const toneClass =
    tone === 'indigo'
      ? 'text-indigo-400 hover:text-indigo-300'
      : tone === 'cyan'
        ? 'text-cyan-400 hover:text-cyan-300'
        : tone === 'violet'
          ? 'text-violet-400 hover:text-violet-300'
          : 'text-neutral-400 hover:text-neutral-100';
  return (
    <button
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-neutral-800 ${toneClass}`}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <Icon name={icon} size={13} />
    </button>
  );
}
