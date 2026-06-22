import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AppSettings,
  EdgeDetail,
  GapAggregate,
  GraphData,
  QueueProgress,
  SyncLogEntry,
  WorkEmbeddingStatus,
  WorkView,
} from '@shared/types';
import { Badge, Icon, Spinner } from '../components/ui';
import { useDataRefresh, useScanComplete } from '../hooks';

type HomeTarget = 'library' | 'graph' | 'ideas' | 'gaps' | 'reading' | 'writing' | 'settings';

interface HomeViewProps {
  settings: AppSettings;
  lastSync: SyncLogEntry | null;
  syncing: boolean;
  onSync: () => Promise<void>;
  onNavigate: (target: HomeTarget) => void;
  onOpenAssistant: () => void;
}

interface HomeSnapshot {
  works: WorkView[];
  graph: GraphData;
  gaps: GapAggregate[];
  contradictions: EdgeDetail[];
  embeddings: WorkEmbeddingStatus[];
  queue: QueueProgress | null;
  syncLog: SyncLogEntry[];
}

export function HomeView({
  settings,
  lastSync,
  syncing,
  onSync,
  onNavigate,
  onOpenAssistant,
}: HomeViewProps) {
  const [snapshot, setSnapshot] = useState<HomeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [works, graph, gaps, contradictions, embeddings, queue, syncLog] = await Promise.all([
        window.nodus.listWorks(),
        window.nodus.getGraph('ideas'),
        window.nodus.getGaps(),
        window.nodus.getContradictions(),
        window.nodus.getWorkEmbeddingStatuses(),
        window.nodus.getQueue(),
        window.nodus.getSyncLog(),
      ]);
      setSnapshot({ works, graph, gaps, contradictions, embeddings, queue, syncLog });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);
  useDataRefresh(reload);

  useEffect(() => {
    return window.nodus.onQueueProgress((queue) => {
      setSnapshot((current) => (current ? { ...current, queue } : current));
    });
  }, []);

  useScanComplete(reload);

  const stats = useMemo(() => buildStats(snapshot), [snapshot]);
  const latestSync = lastSync ?? snapshot?.syncLog[0] ?? null;
  const recommendation = useMemo(
    () => getRecommendation(settings, stats),
    [settings, stats]
  );

  const runSync = async () => {
    await onSync();
  };

  const indexPending = async () => {
    await window.nodus.startEmbedding();
    await reload();
  };

  if (loading && !snapshot) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner label="Calculando estado del corpus..." />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex flex-wrap items-start gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold">Inicio</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Estado operativo de Zotero, análisis, grafo y próximos pasos.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <section className="card p-4 mb-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-[18rem]">
            <div className="text-xs uppercase text-neutral-500 mb-1">Siguiente paso recomendado</div>
            <h2 className="text-lg font-semibold">{recommendation.title}</h2>
            <p className="text-sm text-neutral-400 mt-1 max-w-2xl">{recommendation.body}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {recommendation.secondary && (
              <button
                className="btn btn-ghost border border-neutral-700 gap-1.5"
                onClick={() => onNavigate(recommendation.secondary!.target)}
              >
                <Icon name={recommendation.secondary.icon} /> {recommendation.secondary.label}
              </button>
            )}
            {renderPrimaryAction(recommendation.action, {
              onNavigate,
              onSync: runSync,
              onIndex: indexPending,
              onOpenAssistant,
              busy: syncing || refreshing,
            })}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <StatusCard
          title="Corpus"
          icon="book"
          tone="indigo"
          metric={stats.totalWorks}
          metricLabel="obras sincronizadas"
          action={<button className="btn btn-ghost border border-neutral-700" onClick={() => onNavigate('library')}>Biblioteca</button>}
        >
          <ProgressLine label="con tag de lectura" value={stats.readTaggedWorks} total={stats.totalWorks} />
          <div className="flex flex-wrap gap-1.5 mt-3">
            <Badge>{settings.monitoredCollections.length} colecciones</Badge>
            <Badge>{settings.syncMode === 'realtime' ? 'tiempo real' : 'manual'}</Badge>
          </div>
          <p className="text-xs text-neutral-500 mt-3">
            {latestSync ? `Última sincronización: ${latestSync.summary}` : 'Sin sincronización registrada todavía.'}
          </p>
        </StatusCard>

        <StatusCard
          title="Análisis"
          icon="layers"
          tone="green"
          metric={`${stats.lightDone}/${stats.totalWorks}`}
          metricLabel="con temas"
          action={<button className="btn btn-ghost border border-neutral-700" onClick={() => onNavigate('library')}>Analizar</button>}
        >
          <ProgressLine label="temas" value={stats.lightDone} total={stats.totalWorks} />
          <ProgressLine label="ideas" value={stats.deepDone} total={stats.deepTarget} />
          <div className="flex flex-wrap gap-1.5 mt-3">
            {stats.lightPending > 0 && <Badge color="amber">{stats.lightPending} temas en cola</Badge>}
            {stats.deepPending > 0 && <Badge color="amber">{stats.deepPending} ideas en cola</Badge>}
            {stats.failedWorks > 0 && <Badge color="red">{stats.failedWorks} fallos</Badge>}
            {stats.skippedNoText > 0 && <Badge color="amber">{stats.skippedNoText} sin texto</Badge>}
          </div>
        </StatusCard>

        <StatusCard
          title="Cola"
          icon={stats.queueActive ? 'sync' : 'check'}
          tone={stats.queueFailed > 0 ? 'red' : stats.queueActive ? 'amber' : 'cyan'}
          metric={snapshot?.queue?.total ?? 0}
          metricLabel={stats.queueActive ? 'trabajos en cola' : 'trabajos registrados'}
          action={<button className="btn btn-ghost border border-neutral-700" onClick={() => onNavigate('library')}>Ver obras</button>}
        >
          <ProgressLine label="progreso" value={stats.queueDone + stats.queueFailed} total={snapshot?.queue?.total ?? 0} />
          <div className="flex flex-wrap gap-1.5 mt-3">
            {snapshot?.queue?.paused && <Badge color="amber">pausada</Badge>}
            {stats.queueActive && <Badge color="indigo">activa</Badge>}
            {stats.queueFailed > 0 && <Badge color="red">{stats.queueFailed} fallidos</Badge>}
            {!stats.queueActive && stats.queueFailed === 0 && <Badge color="green">sin pendientes</Badge>}
          </div>
          {snapshot?.queue?.current && (
            <p className="text-xs text-neutral-500 mt-3 truncate">
              Procesando: {snapshot.queue.current.title}
            </p>
          )}
        </StatusCard>

        <StatusCard
          title="Grafo"
          icon="map"
          tone="cyan"
          metric={stats.ideaNodes}
          metricLabel="ideas navegables"
          action={<button className="btn btn-ghost border border-neutral-700" onClick={() => onNavigate('graph')}>Abrir grafo</button>}
        >
          <ProgressLine label="relaciones" value={stats.semanticEdges} total={Math.max(stats.semanticEdges, stats.ideaNodes)} />
          <div className="flex flex-wrap gap-1.5 mt-3">
            <Badge>{stats.themeNodes} temas</Badge>
            <Badge>{stats.semanticEdges} relaciones</Badge>
            <Badge color={stats.contradictions > 0 ? 'red' : 'neutral'}>{stats.contradictions} contradicciones</Badge>
          </div>
        </StatusCard>

        <StatusCard
          title="Huecos y lectura"
          icon="gap"
          tone="amber"
          metric={stats.gaps}
          metricLabel="huecos minados"
          action={<button className="btn btn-ghost border border-neutral-700" onClick={() => onNavigate('gaps')}>Revisar</button>}
        >
          <div className="grid grid-cols-2 gap-2">
            <MiniMetric label="contradicciones" value={stats.contradictions} />
            <MiniMetric label="por leer" value={stats.unreadWorks} />
          </div>
          <button className="btn btn-ghost border border-neutral-700 mt-3 w-full" onClick={() => onNavigate('reading')}>
            <Icon name="route" /> Ruta de lectura
          </button>
        </StatusCard>

        <StatusCard
          title="Escritura"
          icon="edit"
          tone="indigo"
          metric={stats.ideaNodes > 0 ? 'lista' : 'pendiente'}
          metricLabel="taller académico"
          action={<button className="btn btn-ghost border border-neutral-700" onClick={() => onNavigate('writing')}>Abrir</button>}
        >
          <div className="grid grid-cols-2 gap-2">
            <MiniMetric label="ideas" value={stats.ideaNodes} />
            <MiniMetric label="huecos" value={stats.gaps} />
          </div>
          <p className="text-xs text-neutral-500 mt-3">
            Convierte ideas, contradicciones, huecos y rutas del Tutor en un borrador con citas verificables.
          </p>
        </StatusCard>

        <StatusCard
          title="Configuración IA"
          icon={settings.defaultModel ? 'check' : 'alert'}
          tone={settings.defaultModel ? 'green' : 'red'}
          metric={settings.defaultModel ? 'lista' : 'pendiente'}
          metricLabel="modelo predeterminado"
          action={<button className="btn btn-ghost border border-neutral-700" onClick={() => onNavigate('settings')}>Ajustes</button>}
        >
          <ProgressLine label="embeddings" value={stats.embeddedIdeas} total={stats.totalEmbeddableIdeas} />
          <div className="flex flex-wrap gap-1.5 mt-3">
            {settings.defaultModel && <Badge color="green">{settings.defaultModel.provider}</Badge>}
            {stats.embeddingIncompleteWorks > 0 && <Badge color="amber">{stats.embeddingIncompleteWorks} obras por indexar</Badge>}
            {!settings.zoteroStoragePath && <Badge color="amber">storage no configurado</Badge>}
          </div>
        </StatusCard>
      </div>
    </div>
  );
}

function buildStats(snapshot: HomeSnapshot | null) {
  const works = snapshot?.works ?? [];
  const queue = snapshot?.queue ?? null;
  const embeddings = snapshot?.embeddings ?? [];
  const graph = snapshot?.graph ?? { nodes: [], edges: [] };

  const totalWorks = works.length;
  const readTaggedWorks = works.filter((w) => w.read_tag === 1).length;
  const manualDeepWorks = works.filter((w) => w.manual_deep === 1).length;
  const unreadWorks = works.filter((w) => w.read_tag !== 1).length;
  const deepTarget = works.filter((w) => w.read_tag === 1 || w.manual_deep === 1 || w.deep_status === 'done').length;
  const lightDone = works.filter((w) => w.light_status === 'done').length;
  const lightPending = works.filter((w) => w.light_status === 'pending').length;
  const lightMissing = works.filter((w) => w.light_status === 'none').length;
  const deepDone = works.filter((w) => w.deep_status === 'done').length;
  const deepPending = works.filter((w) => w.deep_status === 'pending').length;
  const deepMissing = works.filter((w) => w.deep_status === 'none').length;
  const skippedNoText = works.filter((w) => w.deep_status === 'skipped_no_text').length;
  const failedWorks = works.filter((w) => w.light_status === 'failed' || w.deep_status === 'failed').length;
  const ideaNodes = graph.nodes.filter((n) => n.type !== 'theme' && n.type !== 'author').length;
  const themeNodes = graph.nodes.filter((n) => n.type === 'theme').length;
  const semanticEdges = graph.edges.filter((e) => e.type !== 'contains').length;
  const totalEmbeddableIdeas = embeddings.reduce((sum, s) => sum + s.totalIdeas, 0);
  const embeddedIdeas = embeddings.reduce((sum, s) => sum + s.embeddedIdeas, 0);
  const embeddingIncompleteWorks = embeddings.filter((s) => s.totalIdeas > 0 && !s.complete).length;
  const queueDone = queue?.done ?? 0;
  const queueFailed = queue?.failed ?? 0;
  const queueTotal = queue?.total ?? 0;
  const queueActive = queueTotal > 0 && queueDone + queueFailed < queueTotal;

  return {
    totalWorks,
    readTaggedWorks,
    manualDeepWorks,
    unreadWorks,
    deepTarget,
    lightDone,
    lightPending,
    lightMissing,
    deepDone,
    deepPending,
    deepMissing,
    skippedNoText,
    failedWorks,
    ideaNodes,
    themeNodes,
    semanticEdges,
    totalEmbeddableIdeas,
    embeddedIdeas,
    embeddingIncompleteWorks,
    queueDone,
    queueFailed,
    queueActive,
    gaps: snapshot?.gaps.length ?? 0,
    contradictions: snapshot?.contradictions.length ?? 0,
  };
}

type Recommendation =
  | {
      title: string;
      body: string;
      action: { kind: 'view'; target: HomeTarget; icon: string; label: string };
      secondary?: { target: HomeTarget; icon: string; label: string };
    }
  | {
      title: string;
      body: string;
      action: { kind: 'sync'; label: string };
      secondary?: { target: HomeTarget; icon: string; label: string };
    }
  | {
      title: string;
      body: string;
      action: { kind: 'embed'; label: string };
      secondary?: { target: HomeTarget; icon: string; label: string };
    }
  | {
      title: string;
      body: string;
      action: { kind: 'assistant'; label: string };
      secondary?: { target: HomeTarget; icon: string; label: string };
    };

function renderPrimaryAction(
  action: Recommendation['action'],
  handlers: {
    onNavigate: (target: HomeTarget) => void;
    onSync: () => Promise<void>;
    onIndex: () => Promise<void>;
    onOpenAssistant: () => void;
    busy: boolean;
  }
) {
  switch (action.kind) {
    case 'sync':
      return (
        <button className="btn btn-primary gap-1.5" onClick={() => void handlers.onSync()} disabled={handlers.busy}>
          <Icon name="sync" className={handlers.busy ? 'animate-spin' : ''} /> {action.label}
        </button>
      );
    case 'embed':
      return (
        <button className="btn btn-primary gap-1.5" onClick={() => void handlers.onIndex()}>
          <Icon name="search" /> {action.label}
        </button>
      );
    case 'assistant':
      return (
        <button className="btn btn-primary gap-1.5" onClick={handlers.onOpenAssistant}>
          <Icon name="wand" /> {action.label}
        </button>
      );
    case 'view':
      return (
        <button className="btn btn-primary gap-1.5" onClick={() => handlers.onNavigate(action.target)}>
          <Icon name={action.icon} /> {action.label}
        </button>
      );
  }
}

function getRecommendation(settings: AppSettings, stats: ReturnType<typeof buildStats>): Recommendation {
  if (!settings.defaultModel) {
    return {
      title: 'Configura un modelo de IA',
      body: 'La sincronización puede funcionar, pero Nodus necesita un modelo predeterminado para extraer temas, ideas y evidencias.',
      action: { kind: 'view', target: 'settings', icon: 'settings', label: 'Configurar IA' },
    };
  }
  if (stats.totalWorks === 0) {
    return {
      title: 'Sincroniza Zotero para crear el corpus',
      body: 'Todavía no hay obras locales. Revisa las colecciones monitorizadas y ejecuta una sincronización para poblar la biblioteca.',
      action: { kind: 'sync', label: 'Sincronizar ahora' },
      secondary: { target: 'library', icon: 'book', label: 'Biblioteca' },
    };
  }
  if (stats.lightMissing > 0 || stats.lightPending > 0 || stats.lightDone === 0) {
    return {
      title: 'Completa el análisis ligero',
      body: 'El primer resultado visible del mapa depende de los temas extraídos a partir de título y resumen. Analiza temas antes de profundizar.',
      action: { kind: 'view', target: 'library', icon: 'tag', label: 'Analizar temas' },
      secondary: { target: 'graph', icon: 'map', label: 'Ver grafo' },
    };
  }
  if (stats.deepDone === 0 || (stats.deepTarget > 0 && stats.deepDone < stats.deepTarget)) {
    return {
      title: 'Extrae ideas de las obras clave',
      body: 'El grafo ya puede orientarte por temas; el siguiente salto de valor llega al analizar a fondo las obras leídas o seleccionadas.',
      action: { kind: 'view', target: 'library', icon: 'bulb', label: 'Analizar ideas' },
      secondary: { target: 'reading', icon: 'route', label: 'Ruta de lectura' },
    };
  }
  if (stats.embeddingIncompleteWorks > 0) {
    return {
      title: 'Indexa embeddings pendientes',
      body: 'Hay ideas extraídas sin índice semántico. Indexarlas mejora la fusión, las relaciones y el descubrimiento de puentes.',
      action: { kind: 'embed', label: 'Indexar pendientes' },
      secondary: { target: 'ideas', icon: 'bulb', label: 'Ver ideas' },
    };
  }
  if (stats.ideaNodes >= 12 && stats.deepDone > 0) {
    return {
      title: 'Convierte el grafo en escritura',
      body: 'Ya hay suficientes ideas y fuentes para montar un estado de la cuestión, un marco teórico o una justificación de hueco con citas verificables.',
      action: { kind: 'view', target: 'writing', icon: 'edit', label: 'Abrir taller' },
      secondary: { target: stats.gaps > 0 || stats.contradictions > 0 ? 'gaps' : 'ideas', icon: stats.gaps > 0 ? 'gap' : 'bulb', label: stats.gaps > 0 ? 'Ver huecos' : 'Ver ideas' },
    };
  }
  if (stats.gaps > 0 || stats.contradictions > 0) {
    return {
      title: 'Revisa huecos y contradicciones',
      body: 'El corpus ya tiene material interpretativo. El siguiente paso útil es convertir huecos y tensiones en una ruta de lectura o pregunta de investigación.',
      action: { kind: 'view', target: 'gaps', icon: 'gap', label: 'Ver huecos' },
      secondary: { target: 'reading', icon: 'route', label: 'Ruta de lectura' },
    };
  }
  return {
    title: 'Explora el grafo con el Tutor',
    body: 'El corpus está en buen estado para una lectura guiada. Abre el grafo o pregunta al asistente con el contexto completo.',
    action: { kind: 'view', target: 'graph', icon: 'map', label: 'Abrir grafo' },
    secondary: { target: 'ideas', icon: 'bulb', label: 'Ver ideas' },
  };
}

function StatusCard({
  title,
  icon,
  tone,
  metric,
  metricLabel,
  action,
  children,
}: {
  title: string;
  icon: string;
  tone: 'indigo' | 'green' | 'amber' | 'red' | 'cyan';
  metric: React.ReactNode;
  metricLabel: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const toneClass = {
    indigo: 'text-indigo-300 bg-indigo-900/50',
    green: 'text-emerald-300 bg-emerald-900/50',
    amber: 'text-amber-300 bg-amber-900/50',
    red: 'text-red-300 bg-red-900/50',
    cyan: 'text-cyan-300 bg-cyan-900/50',
  }[tone];
  return (
    <section className="card p-4 min-h-[14rem] flex flex-col">
      <div className="flex items-start gap-3">
        <span className={`h-9 w-9 rounded-lg inline-flex items-center justify-center ${toneClass}`}>
          <Icon name={icon} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-sm">{title}</h2>
          <div className="mt-2">
            <span className="text-2xl font-semibold tabular-nums">{metric}</span>
            <span className="text-xs text-neutral-500 ml-2">{metricLabel}</span>
          </div>
        </div>
        {action}
      </div>
      <div className="mt-4 flex-1">{children}</div>
    </section>
  );
}

function ProgressLine({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between text-xs text-neutral-500 mb-1">
        <span>{label}</span>
        <span className="tabular-nums">{total > 0 ? `${value}/${total}` : '0/0'}</span>
      </div>
      <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
        <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-neutral-800 px-3 py-2">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
