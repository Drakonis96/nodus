import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AppSettings,
  CorpusHealth,
  CorpusHealthBucket,
  CorpusHealthBucketId,
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
import { t, tx } from '../i18n';

type HomeTarget =
  | 'library'
  | 'graph'
  | 'ideas'
  | 'gaps'
  | 'reading'
  | 'writing'
  | 'settings'
  | 'persons'
  | 'tree'
  | 'timeline'
  | 'archive'
  | 'map';

interface HomeViewProps {
  settings: AppSettings;
  lastSync: SyncLogEntry | null;
  syncing: boolean;
  onSync: () => Promise<void>;
  onNavigate: (target: HomeTarget) => void;
  /** Open the Library pre-filtered to a corpus-health bucket clicked in the health panel. */
  onOpenLibraryBucket: (bucket: CorpusHealthBucketId) => void;
  onOpenAssistant: () => void;
  /** Show the "load sample data" card (empty database, not already in demo mode). */
  showDemoOffer: boolean;
  demoBusy: boolean;
  onLoadDemo: () => Promise<void>;
  onLoadGenealogyDemo: () => Promise<void>;
}

interface HomeSnapshot {
  works: WorkView[];
  graph: GraphData;
  gaps: GapAggregate[];
  contradictions: EdgeDetail[];
  embeddings: WorkEmbeddingStatus[];
  queue: QueueProgress | null;
  syncLog: SyncLogEntry[];
  health: CorpusHealth | null;
}

export function HomeView({
  settings,
  lastSync,
  syncing,
  onSync,
  onNavigate,
  onOpenLibraryBucket,
  onOpenAssistant,
  showDemoOffer,
  demoBusy,
  onLoadDemo,
  onLoadGenealogyDemo,
}: HomeViewProps) {
  const [snapshot, setSnapshot] = useState<HomeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [works, graph, gaps, contradictions, embeddings, queue, syncLog, health] = await Promise.all([
        window.nodus.listWorks(),
        window.nodus.getGraph('ideas'),
        window.nodus.getGaps(),
        window.nodus.getContradictions(),
        window.nodus.getWorkEmbeddingStatuses(),
        window.nodus.getQueue(),
        window.nodus.getSyncLog(),
        window.nodus.getCorpusHealth(),
      ]);
      setSnapshot({ works, graph, gaps, contradictions, embeddings, queue, syncLog, health });
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

  const indexPassages = async () => {
    await window.nodus.startPassageEmbedding();
    await reload();
  };

  if (loading && !snapshot) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner label={t('Calculando estado del corpus...')} />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex flex-wrap items-start gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold">{t('Inicio')}</h1>
          <p className="text-sm text-neutral-400 mt-1">
            {t('Estado operativo de Zotero, análisis, grafo y próximos pasos.')}
          </p>
        </div>
      </div>

      {showDemoOffer && (
        <DemoOfferCard demoBusy={demoBusy} onLoadDemo={onLoadDemo} onLoadGenealogyDemo={onLoadGenealogyDemo} />
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <section className="card p-4 mb-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-[18rem]">
            <div className="text-xs uppercase text-neutral-500 mb-1">{t('Siguiente paso recomendado')}</div>
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

      {snapshot?.health && snapshot.health.totalWorks > 0 && (
        <CorpusHealthPanel
          health={snapshot.health}
          onOpenBucket={onOpenLibraryBucket}
          onIndexIdeas={indexPending}
          onIndexPassages={indexPassages}
        />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <StatusCard
          title={t('Corpus')}
          icon="book"
          tone="indigo"
          metric={stats.totalWorks}
          metricLabel={t('obras sincronizadas')}
          action={<button className="btn btn-ghost border border-neutral-700" onClick={() => onNavigate('library')}>{t('Biblioteca')}</button>}
        >
          <ProgressLine label={t('con tag de lectura')} value={stats.readTaggedWorks} total={stats.totalWorks} />
          <div className="flex flex-wrap gap-1.5 mt-3">
            <Badge>{tx('{n} colecciones', { n: settings.monitoredCollections.length })}</Badge>
            <Badge>{settings.syncMode === 'realtime' ? t('tiempo real') : t('manual')}</Badge>
          </div>
          <p className="text-xs text-neutral-500 mt-3">
            {latestSync ? `${t('Última sincronización:')} ${latestSync.summary}` : t('Sin sincronización registrada todavía.')}
          </p>
        </StatusCard>

        <StatusCard
          title={t('Análisis')}
          icon="layers"
          tone="green"
          metric={`${stats.lightDone}/${stats.totalWorks}`}
          metricLabel={t('con temas')}
          action={<button className="btn btn-ghost border border-neutral-700" onClick={() => onNavigate('library')}>{t('Analizar')}</button>}
        >
          <ProgressLine label={t('temas')} value={stats.lightDone} total={stats.totalWorks} />
          <ProgressLine label={t('ideas')} value={stats.deepDone} total={stats.deepTarget} />
          <div className="flex flex-wrap gap-1.5 mt-3">
            {stats.lightPending > 0 && <Badge color="amber">{tx('{n} temas en cola', { n: stats.lightPending })}</Badge>}
            {stats.deepPending > 0 && <Badge color="amber">{tx('{n} ideas en cola', { n: stats.deepPending })}</Badge>}
            {stats.failedWorks > 0 && <Badge color="red">{tx('{n} fallos', { n: stats.failedWorks })}</Badge>}
            {stats.skippedNoText > 0 && <Badge color="amber">{tx('{n} sin texto', { n: stats.skippedNoText })}</Badge>}
          </div>
        </StatusCard>

        <StatusCard
          title={t('Cola')}
          icon={stats.queueActive ? 'sync' : 'check'}
          tone={stats.queueFailed > 0 ? 'red' : stats.queueActive ? 'amber' : 'cyan'}
          metric={snapshot?.queue?.total ?? 0}
          metricLabel={stats.queueActive ? t('trabajos en cola') : t('trabajos registrados')}
          action={<button className="btn btn-ghost border border-neutral-700" onClick={() => onNavigate('library')}>{t('Ver obras')}</button>}
        >
          <ProgressLine label={t('progreso')} value={stats.queueDone + stats.queueFailed} total={snapshot?.queue?.total ?? 0} />
          <div className="flex flex-wrap gap-1.5 mt-3">
            {snapshot?.queue?.paused && <Badge color="amber">{t('pausada')}</Badge>}
            {stats.queueActive && <Badge color="indigo">{t('activa')}</Badge>}
            {stats.queueFailed > 0 && <Badge color="red">{tx('{n} fallidos', { n: stats.queueFailed })}</Badge>}
            {!stats.queueActive && stats.queueFailed === 0 && <Badge color="green">{t('sin pendientes')}</Badge>}
          </div>
          {snapshot?.queue?.current && (
            <p className="text-xs text-neutral-500 mt-3 truncate">
              {t('Procesando:')} {snapshot.queue.current.title}
            </p>
          )}
        </StatusCard>

        <StatusCard
          title={t('Grafo')}
          icon="map"
          tone="cyan"
          metric={stats.ideaNodes}
          metricLabel={t('ideas navegables')}
          action={<button className="btn btn-ghost border border-neutral-700" onClick={() => onNavigate('graph')}>{t('Abrir grafo')}</button>}
        >
          <ProgressLine label={t('relaciones')} value={stats.semanticEdges} total={Math.max(stats.semanticEdges, stats.ideaNodes)} />
          <div className="flex flex-wrap gap-1.5 mt-3">
            <Badge>{tx('{n} temas', { n: stats.themeNodes })}</Badge>
            <Badge>{tx('{n} relaciones', { n: stats.semanticEdges })}</Badge>
            <Badge color={stats.contradictions > 0 ? 'red' : 'neutral'}>{tx('{n} contradicciones', { n: stats.contradictions })}</Badge>
          </div>
        </StatusCard>

        <StatusCard
          title={t('Huecos y lectura')}
          icon="gap"
          tone="amber"
          metric={stats.gaps}
          metricLabel={t('huecos minados')}
          action={<button className="btn btn-ghost border border-neutral-700" onClick={() => onNavigate('gaps')}>{t('Revisar')}</button>}
        >
          <div className="grid grid-cols-2 gap-2">
            <MiniMetric label={t('contradicciones')} value={stats.contradictions} />
            <MiniMetric label={t('por leer')} value={stats.unreadWorks} />
          </div>
          <button className="btn btn-ghost border border-neutral-700 mt-3 w-full" onClick={() => onNavigate('reading')}>
            <Icon name="route" /> {t('Ruta de lectura')}
          </button>
        </StatusCard>

        <StatusCard
          title={t('Escritura')}
          icon="edit"
          tone="indigo"
          metric={stats.ideaNodes > 0 ? t('lista') : t('pendiente')}
          metricLabel={t('taller académico')}
          action={<button className="btn btn-ghost border border-neutral-700" onClick={() => onNavigate('writing')}>{t('Abrir')}</button>}
        >
          <div className="grid grid-cols-2 gap-2">
            <MiniMetric label={t('ideas')} value={stats.ideaNodes} />
            <MiniMetric label={t('huecos')} value={stats.gaps} />
          </div>
          <p className="text-xs text-neutral-500 mt-3">
            {t('Convierte ideas, contradicciones, huecos y rutas del Tutor en un borrador con citas verificables.')}
          </p>
        </StatusCard>

        <StatusCard
          title={t('Configuración IA')}
          icon={settings.extractionModel && settings.synthesisModel ? 'check' : 'alert'}
          tone={settings.extractionModel && settings.synthesisModel ? 'green' : 'red'}
          metric={settings.extractionModel && settings.synthesisModel ? t('lista') : t('pendiente')}
          metricLabel={t('modelos por tarea')}
          action={<button className="btn btn-ghost border border-neutral-700" onClick={() => onNavigate('settings')}>{t('Ajustes')}</button>}
        >
          <ProgressLine label={t('embeddings')} value={stats.embeddedIdeas} total={stats.totalEmbeddableIdeas} />
          <div className="flex flex-wrap gap-1.5 mt-3">
            {settings.extractionModel && <Badge color="green">{tx('Extracción: {provider}', { provider: settings.extractionModel.provider })}</Badge>}
            {settings.synthesisModel && <Badge color="indigo">{tx('Síntesis: {provider}', { provider: settings.synthesisModel.provider })}</Badge>}
            {stats.embeddingIncompleteWorks > 0 && <Badge color="amber">{tx('{n} obras por indexar', { n: stats.embeddingIncompleteWorks })}</Badge>}
            {!settings.zoteroStoragePath && <Badge color="amber">{t('storage no configurado')}</Badge>}
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
          <Icon name="chat" /> {action.label}
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
  if (!settings.extractionModel || !settings.synthesisModel) {
    return {
      title: t('Configura los modelos de IA'),
      body: t('La sincronización puede funcionar, pero Nodus necesita modelos separados de extracción y síntesis para analizar el corpus.'),
      action: { kind: 'view', target: 'settings', icon: 'settings', label: t('Configurar IA') },
    };
  }
  if (stats.totalWorks === 0) {
    return {
      title: t('Sincroniza Zotero para crear el corpus'),
      body: t('Todavía no hay obras locales. Revisa las colecciones monitorizadas y ejecuta una sincronización para poblar la biblioteca.'),
      action: { kind: 'sync', label: t('Sincronizar ahora') },
      secondary: { target: 'library', icon: 'book', label: t('Biblioteca') },
    };
  }
  if (stats.lightMissing > 0 || stats.lightPending > 0 || stats.lightDone === 0) {
    return {
      title: t('Completa el análisis ligero'),
      body: t('El primer resultado visible del mapa depende de los temas extraídos a partir de título y resumen. Analiza temas antes de profundizar.'),
      action: { kind: 'view', target: 'library', icon: 'tag', label: t('Analizar temas') },
      secondary: { target: 'graph', icon: 'map', label: t('Ver grafo') },
    };
  }
  if (stats.deepDone === 0 || (stats.deepTarget > 0 && stats.deepDone < stats.deepTarget)) {
    return {
      title: t('Extrae ideas de las obras clave'),
      body: t('El grafo ya puede orientarte por temas; el siguiente salto de valor llega al analizar a fondo las obras leídas o seleccionadas.'),
      action: { kind: 'view', target: 'library', icon: 'bulb', label: t('Analizar ideas') },
      secondary: { target: 'reading', icon: 'route', label: t('Ruta de lectura') },
    };
  }
  if (stats.embeddingIncompleteWorks > 0) {
    return {
      title: t('Indexa embeddings pendientes'),
      body: t('Hay ideas extraídas sin índice semántico. Indexarlas mejora la fusión, las relaciones y el descubrimiento de puentes.'),
      action: { kind: 'embed', label: t('Indexar pendientes') },
      secondary: { target: 'ideas', icon: 'bulb', label: t('Ver ideas') },
    };
  }
  if (stats.ideaNodes >= 12 && stats.deepDone > 0) {
    return {
      title: t('Convierte el grafo en escritura'),
      body: t('Ya hay suficientes ideas y fuentes para montar un estado de la cuestión, un marco teórico o una justificación de hueco con citas verificables.'),
      action: { kind: 'view', target: 'writing', icon: 'edit', label: t('Abrir taller') },
      secondary: { target: stats.gaps > 0 || stats.contradictions > 0 ? 'gaps' : 'ideas', icon: stats.gaps > 0 ? 'gap' : 'bulb', label: stats.gaps > 0 ? t('Ver huecos') : t('Ver ideas') },
    };
  }
  if (stats.gaps > 0 || stats.contradictions > 0) {
    return {
      title: t('Revisa huecos y contradicciones'),
      body: t('El corpus ya tiene material interpretativo. El siguiente paso útil es convertir huecos y tensiones en una ruta de lectura o pregunta de investigación.'),
      action: { kind: 'view', target: 'gaps', icon: 'gap', label: t('Ver huecos') },
      secondary: { target: 'reading', icon: 'route', label: t('Ruta de lectura') },
    };
  }
  return {
    title: t('Explora el grafo con el Tutor'),
    body: t('El corpus está en buen estado para una lectura guiada. Abre el grafo o pregunta al asistente con el contexto completo.'),
    action: { kind: 'view', target: 'graph', icon: 'map', label: t('Abrir grafo') },
    secondary: { target: 'ideas', icon: 'bulb', label: t('Ver ideas') },
  };
}

interface HealthAction {
  label: string;
  detail: string;
  tone: 'amber' | 'red' | 'indigo' | 'cyan';
  run: () => void;
}

function buildHealthActions(
  health: CorpusHealth,
  handlers: { onOpenBucket: (bucket: CorpusHealthBucketId) => void; onIndexIdeas: () => void; onIndexPassages: () => void }
): HealthAction[] {
  const actions: HealthAction[] = [];
  if (health.deepPriority.count > 0) {
    actions.push({
      label: tx('Analiza a fondo {n} obra(s) prioritaria(s)', { n: health.deepPriority.count }),
      detail: t('Marcadas como leídas o seleccionadas, pero todavía sin ideas extraídas.'),
      tone: 'indigo',
      run: () => handlers.onOpenBucket('deepPriority'),
    });
  }
  if (health.lightOnly.count > 0) {
    actions.push({
      label: tx('Profundiza {n} obra(s) con solo análisis ligero', { n: health.lightOnly.count }),
      detail: t('Tienen temas pero aún no ideas; son las candidatas naturales al análisis profundo.'),
      tone: 'cyan',
      run: () => handlers.onOpenBucket('lightOnly'),
    });
  }
  if (health.embeddings.pendingIdeas > 0) {
    actions.push({
      label: tx('Indexa {n} idea(s) sin embedding', { n: health.embeddings.pendingIdeas }),
      detail: t('La búsqueda por significado, la fusión y los puentes dependen del índice semántico.'),
      tone: 'amber',
      run: handlers.onIndexIdeas,
    });
  }
  if (health.embeddings.passagesPendingWorks > 0) {
    actions.push({
      label: tx('Indexa pasajes de {n} obra(s) con texto', { n: health.embeddings.passagesPendingWorks }),
      detail: t('Sin pasajes no hay búsqueda semántica de evidencia ni citas a nivel de fragmento.'),
      tone: 'amber',
      run: handlers.onIndexPassages,
    });
  }
  if (health.pdfsToRecover.count > 0) {
    actions.push({
      label: tx('Recupera el texto de {n} obra(s)', { n: health.pdfsToRecover.count }),
      detail: t('No se pudo extraer texto, pero hay vía de recuperación (re-escanear, OCR o descargar por DOI).'),
      tone: 'red',
      run: () => handlers.onOpenBucket('pdfsToRecover'),
    });
  }
  return actions;
}

function CorpusHealthPanel({
  health,
  onOpenBucket,
  onIndexIdeas,
  onIndexPassages,
}: {
  health: CorpusHealth;
  onOpenBucket: (bucket: CorpusHealthBucketId) => void;
  onIndexIdeas: () => void;
  onIndexPassages: () => void;
}) {
  const actions = buildHealthActions(health, { onOpenBucket, onIndexIdeas, onIndexPassages });
  const embeddedPct =
    health.embeddings.totalIdeas > 0
      ? Math.round((health.embeddings.embeddedIdeas / health.embeddings.totalIdeas) * 100)
      : 100;

  return (
    <section className="card p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="h-8 w-8 rounded-lg inline-flex items-center justify-center text-emerald-300 bg-emerald-900/40">
          <Icon name="layers" />
        </span>
        <div>
          <h2 className="font-semibold text-sm">{t('Salud del corpus')}</h2>
          <p className="text-xs text-neutral-500">{t('Qué falta por analizar, indexar o recuperar.')}</p>
        </div>
        <span className="ml-auto text-xs text-neutral-500 tabular-nums">
          {tx('{n} obras', { n: health.totalWorks })}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
        <HealthBucketTile
          icon="book"
          label={t('Sin texto')}
          bucket={health.withoutText}
          tone={health.withoutText.count > 0 ? 'amber' : 'neutral'}
          onClick={() => onOpenBucket('withoutText')}
        />
        <HealthBucketTile
          icon="tag"
          label={t('Solo análisis ligero')}
          bucket={health.lightOnly}
          tone={health.lightOnly.count > 0 ? 'cyan' : 'neutral'}
          onClick={() => onOpenBucket('lightOnly')}
        />
        <HealthBucketTile
          icon="bulb"
          label={t('Prioritarias por analizar')}
          bucket={health.deepPriority}
          tone={health.deepPriority.count > 0 ? 'indigo' : 'neutral'}
          onClick={() => onOpenBucket('deepPriority')}
        />
        <HealthBucketTile
          icon="download"
          label={t('Recuperar texto')}
          bucket={health.pdfsToRecover}
          tone={health.pdfsToRecover.count > 0 ? 'red' : 'neutral'}
          onClick={() => onOpenBucket('pdfsToRecover')}
        />
        <div className="rounded-lg border border-neutral-800 px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs text-neutral-500">
            <Icon name="search" size={13} /> {t('Embeddings')}
          </div>
          <div className="mt-1 text-lg font-semibold tabular-nums">
            {health.embeddings.pendingIdeas}
            <span className="text-xs text-neutral-500 font-normal"> {t('ideas pend.')}</span>
          </div>
          <div className="mt-1 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500" style={{ width: `${embeddedPct}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-neutral-600">
            {tx('{n} obras con pasajes pendientes', { n: health.embeddings.passagesPendingWorks })}
          </div>
        </div>
      </div>

      {actions.length > 0 && (
        <div className="mt-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500 mb-2">{t('Próximas acciones')}</div>
          <ul className="space-y-1.5">
            {actions.map((a, i) => {
              const dot = {
                amber: 'bg-amber-400',
                red: 'bg-red-400',
                indigo: 'bg-indigo-400',
                cyan: 'bg-cyan-400',
              }[a.tone];
              return (
                <li key={i}>
                  <button
                    className="flex w-full items-start gap-2.5 rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-left transition-colors hover:border-neutral-700 hover:bg-neutral-900"
                    onClick={a.run}
                  >
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-neutral-100">{a.label}</span>
                      <span className="block text-xs text-neutral-500">{a.detail}</span>
                    </span>
                    <Icon name="chevronRight" size={14} className="mt-1 shrink-0 text-neutral-700" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {actions.length === 0 && (
        <p className="mt-3 text-xs text-emerald-400/80">
          {t('Todo en orden: no hay análisis, indexado ni recuperación pendientes.')}
        </p>
      )}
    </section>
  );
}

function HealthBucketTile({
  icon,
  label,
  bucket,
  tone,
  onClick,
}: {
  icon: string;
  label: string;
  bucket: CorpusHealthBucket;
  tone: 'amber' | 'red' | 'indigo' | 'cyan' | 'neutral';
  onClick: () => void;
}) {
  const toneClass = {
    amber: 'text-amber-300',
    red: 'text-red-300',
    indigo: 'text-indigo-300',
    cyan: 'text-cyan-300',
    neutral: 'text-neutral-400',
  }[tone];
  const sampleTitles = bucket.sample.map((w) => w.title).join('\n');
  return (
    <button
      className="rounded-lg border border-neutral-800 px-3 py-2 text-left transition-colors hover:border-neutral-700 hover:bg-neutral-900/60"
      onClick={onClick}
      title={sampleTitles || undefined}
    >
      <div className="flex items-center gap-1.5 text-xs text-neutral-500">
        <Icon name={icon} size={13} /> {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${bucket.count > 0 ? toneClass : 'text-neutral-600'}`}>
        {bucket.count}
      </div>
      {bucket.sample[0] && (
        <div className="mt-0.5 text-[11px] text-neutral-600 truncate">{bucket.sample[0].title}</div>
      )}
    </button>
  );
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
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
            {/* Numeric metrics get the big display size; status words (lista/pendiente)
                would look disproportionate at that size, so render them smaller. */}
            <span className={`font-semibold tabular-nums ${typeof metric === 'string' && !/\d/.test(metric) ? 'text-lg' : 'text-2xl'}`}>{metric}</span>
            <span className="text-xs text-neutral-500">{metricLabel}</span>
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

/** The empty-vault "load sample data" card, shared by the academic and genealogy homes. */
export function DemoOfferCard({
  demoBusy,
  onLoadDemo,
  onLoadGenealogyDemo,
}: {
  demoBusy: boolean;
  onLoadDemo: () => Promise<void>;
  onLoadGenealogyDemo: () => Promise<void>;
}) {
  return (
    <section className="card p-4 mb-4 border border-indigo-800/60 bg-indigo-950/20">
      <div className="text-xs uppercase text-indigo-400 mb-1">{t('Prueba sin configurar nada')}</div>
      <h2 className="text-lg font-semibold">{t('Explora con datos de ejemplo')}</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="flex flex-col rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
          <div className="text-sm font-medium">{t('Demo académica')}</div>
          <p className="text-xs text-neutral-400 mt-1 flex-1">
            {t('Seis obras sobre la ciencia del aprendizaje: grafo de ideas, debates, huecos y notas, sin conectar Zotero ni configurar IA.')}
          </p>
          <button className="btn btn-primary gap-1.5 mt-3 self-start" onClick={() => void onLoadDemo()} disabled={demoBusy}>
            <Icon name="play" /> {demoBusy ? t('Cargando…') : t('Cargar demo académica')}
          </button>
        </div>
        <div className="flex flex-col rounded-lg border border-amber-800/50 bg-amber-950/10 p-3">
          <div className="text-sm font-medium text-amber-200">{t('Demo de genealogía')}</div>
          <p className="text-xs text-neutral-400 mt-1 flex-1">
            {t('Una familia del siglo XIX con árbol, retratos de época, archivo de documentos, evidencia citada y parentescos sugeridos por la IA para revisar. Incluye un tutorial guiado.')}
          </p>
          <button
            className="btn gap-1.5 mt-3 self-start border border-amber-500/50 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
            onClick={() => void onLoadGenealogyDemo()}
            disabled={demoBusy}
          >
            <Icon name="tree" /> {demoBusy ? t('Cargando…') : t('Cargar demo de genealogía')}
          </button>
        </div>
      </div>
    </section>
  );
}

interface GenealogyStats {
  persons: number;
  places: number;
  events: number;
  relationships: number;
  archiveItems: number;
  folders: number;
  suggestions: number;
  indexed: number;
  indexTotal: number;
}

/**
 * The Home dashboard for a genealogy vault. Replaces the Zotero/graph/idea status of
 * the academic home with the family-history workflow: people, the tree, the timeline,
 * the evidence archive and the AI's pending kinship suggestions, each linking to its
 * view, plus a next-step recommendation shaped for genealogists.
 */
export function GenealogyHome({
  settings,
  onNavigate,
  onOpenAssistant,
  showDemoOffer,
  demoBusy,
  onLoadDemo,
  onLoadGenealogyDemo,
}: {
  settings: AppSettings;
  onNavigate: (target: HomeTarget) => void;
  onOpenAssistant: () => void;
  showDemoOffer: boolean;
  demoBusy: boolean;
  onLoadDemo: () => Promise<void>;
  onLoadGenealogyDemo: () => Promise<void>;
}) {
  const [stats, setStats] = useState<GenealogyStats | null>(null);

  const reload = useCallback(async () => {
    const [counts, archive, relationships, suggestions, index] = await Promise.all([
      window.nodus.recordCounts(),
      window.nodus.archiveCounts(),
      window.nodus.allRelationships(),
      window.nodus.kinSuggestionCount(),
      window.nodus.archiveIndexStatus(),
    ]);
    setStats({
      persons: counts.persons,
      places: counts.places,
      events: counts.events,
      relationships: relationships.length,
      archiveItems: archive.items,
      folders: archive.folders,
      suggestions,
      indexed: index.indexed,
      indexTotal: index.total,
    });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);
  useDataRefresh(reload);

  const s = stats;
  const empty = !!s && s.persons === 0 && s.archiveItems === 0;
  const recommendation = ((): { title: string; body: string; target: HomeTarget; icon: string; label: string; secondary?: { target: HomeTarget; icon: string; label: string } } => {
    if (!s || empty) {
      return {
        title: t('Empieza tu árbol genealógico'),
        body: t('Importa un árbol GEDCOM (desde Gramps, Ancestry…) en Personas, o sube tus documentos —partidas, censos, cartas— al Archivo y extrae de ellos personas y eventos.'),
        target: 'persons',
        icon: 'users',
        label: t('Ir a Personas'),
        secondary: { target: 'archive', icon: 'archive', label: t('Abrir Archivo') },
      };
    }
    if (s.suggestions > 0) {
      return {
        title: tx('Revisa {n} parentesco(s) sugerido(s)', { n: s.suggestions }),
        body: t('La IA ha propuesto vínculos de parentesco a partir de la evidencia de tus fuentes. Confírmalos o descártalos: nada entra en el árbol sin tu visto bueno.'),
        target: 'persons',
        icon: 'tree',
        label: t('Revisar parentescos'),
        secondary: { target: 'tree', icon: 'tree', label: t('Ver árbol') },
      };
    }
    if (s.indexTotal > 0 && s.indexed < s.indexTotal) {
      return {
        title: t('Indexa el archivo para descubrir vínculos'),
        body: t('Hay documentos sin indexar. Indexarlos permite descubrir qué fuente trata sobre qué persona, también por significado y no solo por nombre.'),
        target: 'archive',
        icon: 'archive',
        label: t('Abrir Archivo'),
        secondary: { target: 'tree', icon: 'tree', label: t('Ver árbol') },
      };
    }
    return {
      title: t('Explora tu árbol y su línea temporal'),
      body: t('Recorre el árbol, abre la ficha de cada persona con su evidencia citada, sigue la línea temporal de la familia o pregúntale al asistente por un antepasado.'),
      target: 'tree',
      icon: 'tree',
      label: t('Ver árbol'),
      secondary: { target: 'timeline', icon: 'clock', label: t('Línea temporal') },
    };
  })();

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold">{t('Inicio')}</h1>
        <p className="text-sm text-neutral-400 mt-1">
          {t('Tu historia familiar: personas, árbol, línea temporal y archivo de evidencias.')}
        </p>
      </div>

      {showDemoOffer && (
        <DemoOfferCard demoBusy={demoBusy} onLoadDemo={onLoadDemo} onLoadGenealogyDemo={onLoadGenealogyDemo} />
      )}

      <section className="card p-4 mb-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-[18rem]">
            <div className="text-xs uppercase text-neutral-500 mb-1">{t('Siguiente paso recomendado')}</div>
            <h2 className="text-lg font-semibold">{recommendation.title}</h2>
            <p className="text-sm text-neutral-400 mt-1 max-w-2xl">{recommendation.body}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={onOpenAssistant}>
              <Icon name="chat" /> {t('Asistente')}
            </button>
            {recommendation.secondary && (
              <button
                className="btn btn-ghost border border-neutral-700 gap-1.5"
                onClick={() => onNavigate(recommendation.secondary!.target)}
              >
                <Icon name={recommendation.secondary.icon} /> {recommendation.secondary.label}
              </button>
            )}
            <button className="btn btn-primary gap-1.5" onClick={() => onNavigate(recommendation.target)}>
              <Icon name={recommendation.icon} /> {recommendation.label}
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <StatusCard
          title={t('Personas')}
          icon="users"
          tone="indigo"
          metric={s?.persons ?? 0}
          metricLabel={t('personas')}
          action={<button className="btn btn-ghost border border-neutral-700" onClick={() => onNavigate('persons')}>{t('Abrir')}</button>}
        >
          <div className="grid grid-cols-2 gap-2">
            <MiniMetric label={t('vínculos')} value={s?.relationships ?? 0} />
            <MiniMetric label={t('lugares')} value={s?.places ?? 0} />
          </div>
          <p className="text-xs text-neutral-500 mt-3">
            {t('Cada persona reúne su parentesco, eventos, documentos y la evidencia que la respalda.')}
          </p>
        </StatusCard>

        <StatusCard
          title={t('Árbol genealógico')}
          icon="tree"
          tone="amber"
          metric={s?.relationships ?? 0}
          metricLabel={t('vínculos de parentesco')}
          action={<button className="btn btn-ghost border border-neutral-700" onClick={() => onNavigate('tree')}>{t('Ver árbol')}</button>}
        >
          <div className="flex flex-wrap gap-1.5 mt-1">
            <Badge>{tx('{n} personas', { n: s?.persons ?? 0 })}</Badge>
            {s && s.suggestions > 0 ? (
              <Badge color="amber">{tx('{n} parentescos sugeridos', { n: s.suggestions })}</Badge>
            ) : (
              <Badge color="green">{t('sin sugerencias pendientes')}</Badge>
            )}
          </div>
          <p className="text-xs text-neutral-500 mt-3">
            {t('Importa o exporta GEDCOM para ir y venir de Gramps o Ancestry.')}
          </p>
        </StatusCard>

        <StatusCard
          title={t('Parentescos sugeridos')}
          icon="bulb"
          tone={s && s.suggestions > 0 ? 'amber' : 'green'}
          metric={s?.suggestions ?? 0}
          metricLabel={t('por revisar')}
          action={<button className="btn btn-ghost border border-neutral-700" onClick={() => onNavigate('persons')}>{t('Revisar')}</button>}
        >
          <p className="text-xs text-neutral-500 mt-1">
            {s && s.suggestions > 0
              ? t('La IA propone vínculos a partir de la evidencia; tú confirmas o descartas. Nada se añade solo.')
              : t('La IA propondrá vínculos aquí a medida que extraigas personas y eventos de tus fuentes.')}
          </p>
        </StatusCard>

        <StatusCard
          title={t('Línea temporal')}
          icon="clock"
          tone="cyan"
          metric={s?.events ?? 0}
          metricLabel={t('eventos')}
          action={<button className="btn btn-ghost border border-neutral-700" onClick={() => onNavigate('timeline')}>{t('Abrir')}</button>}
        >
          <div className="grid grid-cols-2 gap-2">
            <MiniMetric label={t('lugares')} value={s?.places ?? 0} />
            <MiniMetric label={t('personas')} value={s?.persons ?? 0} />
          </div>
          <button className="btn btn-ghost border border-neutral-700 mt-3 w-full" onClick={() => onNavigate('map')}>
            <Icon name="map" /> {t('Ver mapa')}
          </button>
        </StatusCard>

        <StatusCard
          title={t('Archivo')}
          icon="archive"
          tone="indigo"
          metric={s?.archiveItems ?? 0}
          metricLabel={t('documentos')}
          action={<button className="btn btn-ghost border border-neutral-700" onClick={() => onNavigate('archive')}>{t('Abrir')}</button>}
        >
          <ProgressLine label={t('indexados')} value={s?.indexed ?? 0} total={s?.indexTotal ?? 0} />
          <div className="flex flex-wrap gap-1.5 mt-3">
            <Badge>{tx('{n} carpetas', { n: s?.folders ?? 0 })}</Badge>
          </div>
          <p className="text-xs text-neutral-500 mt-3">
            {t('Tus fuentes primarias (partidas, censos, cartas, fotos) vinculadas a las personas.')}
          </p>
        </StatusCard>

        <StatusCard
          title={t('Configuración IA')}
          icon={settings.extractionModel ? 'check' : 'alert'}
          tone={settings.extractionModel ? 'green' : 'red'}
          metric={settings.extractionModel ? t('lista') : t('pendiente')}
          metricLabel={t('modelo de extracción')}
          action={<button className="btn btn-ghost border border-neutral-700" onClick={() => onNavigate('settings')}>{t('Ajustes')}</button>}
        >
          <p className="text-xs text-neutral-500 mt-1">
            {t('La IA extrae personas y eventos de tus documentos, sugiere parentescos, redacta biografías y genera retratos. Configura los modelos en Ajustes.')}
          </p>
        </StatusCard>
      </div>
    </div>
  );
}
