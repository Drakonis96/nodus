import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AcademicHomeSnapshot,
  AcademicHomeStats,
  AppSettings,
  CorpusHealth,
  CorpusHealthBucket,
  CorpusHealthBucketId,
  DatabaseSummary,
  SyncLogEntry,
} from '@shared/types';
import { Badge, Icon, Spinner } from '../components/ui';
import { useDataRefresh, useScanComplete } from '../hooks';
import { t, tx } from '../i18n';
import { getVaultQueryCache, setVaultQueryCache } from '../vaultQueryCache';

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
  vaultId: string | null;
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
  onLoadDatabasesDemo: () => Promise<void>;
}

export function HomeView({
  vaultId,
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
  onLoadDatabasesDemo,
}: HomeViewProps) {
  const initialSnapshot = getVaultQueryCache<AcademicHomeSnapshot>(vaultId, 'academic-home');
  const [snapshot, setSnapshot] = useState<AcademicHomeSnapshot | null>(initialSnapshot ?? null);
  const [loading, setLoading] = useState(!initialSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reloadPromise = useRef<Promise<void> | null>(null);

  const reload = useCallback((force = true): Promise<void> => {
    if (!force) {
      const cached = getVaultQueryCache<AcademicHomeSnapshot>(vaultId, 'academic-home');
      if (cached) {
        setSnapshot(cached);
        setLoading(false);
        return Promise.resolve();
      }
    }
    if (reloadPromise.current) return reloadPromise.current;
    const run = (async () => {
      setRefreshing(true);
      setError(null);
      try {
        const next = await window.nodus.getAcademicHomeSnapshot();
        setSnapshot(next);
        setVaultQueryCache(vaultId, 'academic-home', next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        setRefreshing(false);
        reloadPromise.current = null;
      }
    })();
    reloadPromise.current = run;
    return run;
  }, [vaultId]);

  // Defer the (potentially heavy) snapshot load until after the home shell has painted,
  // so switching into this vault / view stays responsive instead of freezing behind the
  // idea-graph + corpus-health queries.
  useEffect(() => {
    let cancelled = false;
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!cancelled) void reload(false);
      })
    );
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [reload]);
  useDataRefresh(reload);

  useEffect(() => {
    return window.nodus.onQueueProgress((queue) => {
      setSnapshot((current) => {
        if (!current) return current;
        const next = { ...current, queue };
        setVaultQueryCache(vaultId, 'academic-home', next);
        return next;
      });
    });
  }, [vaultId]);

  useScanComplete(reload);

  const stats = useMemo(() => buildDashboardStats(snapshot), [snapshot]);
  const latestSync = lastSync ?? snapshot?.latestSync ?? null;
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
      <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <HomeIntroCard
          eyebrow={t('Vault académico')}
          title={t('Tu espacio de investigación')}
          description={t('Organiza tu corpus, conecta ideas y convierte el análisis en próximos pasos desde un espacio local y privado.')}
          icon="book"
        />
      </div>

      {showDemoOffer && (
        <div className="mb-6">
          <DemoOfferCard variant="academic" demoBusy={demoBusy} onLoadDemo={onLoadDemo} onLoadGenealogyDemo={onLoadGenealogyDemo} onLoadDatabasesDemo={onLoadDatabasesDemo} />
        </div>
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
          icon={settings.synthesisModel ? 'check' : 'alert'}
          tone={settings.synthesisModel ? 'green' : 'red'}
          metric={settings.synthesisModel ? t('lista') : t('pendiente')}
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
    </div>
  );
}

const EMPTY_HOME_STATS: AcademicHomeStats = {
  totalWorks: 0,
  readTaggedWorks: 0,
  manualDeepWorks: 0,
  unreadWorks: 0,
  deepTarget: 0,
  lightDone: 0,
  lightPending: 0,
  lightMissing: 0,
  deepDone: 0,
  deepPending: 0,
  deepMissing: 0,
  skippedNoText: 0,
  failedWorks: 0,
  ideaNodes: 0,
  themeNodes: 0,
  semanticEdges: 0,
  totalEmbeddableIdeas: 0,
  embeddedIdeas: 0,
  embeddingIncompleteWorks: 0,
  gaps: 0,
  contradictions: 0,
};

function buildDashboardStats(snapshot: AcademicHomeSnapshot | null) {
  const queue = snapshot?.queue ?? null;
  const queueDone = queue?.done ?? 0;
  const queueFailed = queue?.failed ?? 0;
  const queueTotal = queue?.total ?? 0;

  return {
    ...(snapshot?.stats ?? EMPTY_HOME_STATS),
    queueDone,
    queueFailed,
    queueActive: queueTotal > 0 && queueDone + queueFailed < queueTotal,
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

function getRecommendation(settings: AppSettings, stats: AcademicHomeStats): Recommendation {
  if (!settings.synthesisModel) {
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

export function HomeIntroCard({
  eyebrow,
  title,
  description,
  icon,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: string;
}) {
  return (
    <header className="rounded-2xl border border-indigo-800/60 bg-indigo-950/25 p-6">
      <div className="mb-2 flex items-center gap-2 text-indigo-300">
        <Icon name={icon} size={20} />
        <span className="text-xs font-semibold uppercase tracking-[0.2em]">{eyebrow}</span>
      </div>
      <h1 className="text-2xl font-semibold text-neutral-100">{title}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">{description}</p>
    </header>
  );
}

/**
 * The "load sample data" card for a vault's Home. Each vault only offers ITS OWN demo
 * (academic / genealogy / databases / study) — a genealogy home never offers the academic demo,
 * etc. `variant` picks which one; the matching onLoad… handler seeds it.
 */
export function DemoOfferCard({
  variant = 'academic',
  demoBusy,
  onLoadDemo,
  onLoadGenealogyDemo,
  onLoadDatabasesDemo,
  onLoadStudyDemo,
  onLoadTeachingDemo,
}: {
  variant?: 'academic' | 'genealogy' | 'databases' | 'study' | 'teaching';
  demoBusy: boolean;
  onLoadDemo?: () => Promise<void>;
  onLoadGenealogyDemo?: () => Promise<void>;
  onLoadDatabasesDemo?: () => Promise<void>;
  onLoadStudyDemo?: () => void | Promise<void>;
  onLoadTeachingDemo?: () => void | Promise<void>;
}) {
  const card =
    variant === 'genealogy'
      ? {
          title: t('Explora una historia familiar de ejemplo'),
          desc: t('Una familia del siglo XIX con árbol, cronología, mapa, archivo, biblioteca, notas, relaciones y un informe de investigación guardado. Incluye un tutorial guiado.'),
          icon: 'tree',
          label: t('Cargar demo de genealogía'),
          onClick: onLoadGenealogyDemo ?? (async () => {}),
        }
      : variant === 'databases'
        ? {
            title: t('Explora unas bases de datos de ejemplo'),
            desc: t('Tres tablas de investigación con todos los tipos de columna, relaciones, registros, análisis, una conversación y notas de ejemplo. Incluye un tutorial guiado.'),
            icon: 'table',
            label: t('Cargar demo de bases de datos'),
            onClick: onLoadDatabasesDemo ?? (async () => {}),
          }
        : variant === 'study'
          ? {
              title: t('Explora un espacio de estudio de ejemplo'),
              desc: t('Carga un curso completo con carpetas, apuntes, materiales anotados, grabación transcrita, horario, calendario, preguntas, test, repasos, progreso y chat de ejemplo.'),
              icon: 'graduation',
              label: t('Cargar datos de ejemplo'),
              onClick: onLoadStudyDemo ?? (async () => {}),
            }
          : variant === 'teaching'
            ? {
                title: t('Explora un curso de ejemplo'),
                desc: t('Carga una unidad completa con su horario, materiales, grupo de alumnado, una rúbrica ponderada, un examen imprimible y un cuaderno de calificaciones ya publicado. Incluye un tutorial guiado.'),
                icon: 'graduation',
                label: t('Cargar demo de docencia'),
                onClick: onLoadTeachingDemo ?? (async () => {}),
              }
        : {
            title: t('Explora una investigación de ejemplo'),
            desc: t('Seis obras sobre la ciencia del aprendizaje con grafo, notas, mapa de investigación, inmersión, borradores, informe profundo y proyecto guardado; sin conectar Zotero ni configurar IA.'),
            icon: 'play',
            label: t('Cargar demo académica'),
            onClick: onLoadDemo ?? (async () => {}),
          };
  return (
    <section className="rounded-xl border border-indigo-800/60 bg-indigo-950/20 p-5" data-testid={`${variant}-demo-offer`}>
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-indigo-200">{card.title}</h2>
          <p className="mt-1 text-xs leading-5 text-neutral-400">{card.desc}</p>
        </div>
        <button className="btn btn-primary shrink-0" onClick={() => void card.onClick()} disabled={demoBusy}>
          <Icon name={demoBusy ? 'sync' : card.icon} className={demoBusy ? 'animate-spin' : ''} />
          {demoBusy ? t('Cargando…') : card.label}
        </button>
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
  onLoadDatabasesDemo,
}: {
  settings: AppSettings;
  onNavigate: (target: HomeTarget) => void;
  onOpenAssistant: () => void;
  showDemoOffer: boolean;
  demoBusy: boolean;
  onLoadDemo: () => Promise<void>;
  onLoadGenealogyDemo: () => Promise<void>;
  onLoadDatabasesDemo: () => Promise<void>;
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
      <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <HomeIntroCard
          eyebrow={t('Vault de genealogía')}
          title={t('Tu historia familiar')}
          description={t('Reúne personas, parentescos, documentos y lugares para reconstruir una historia familiar respaldada por evidencias.')}
          icon="tree"
        />
      </div>

      {showDemoOffer && (
        <div className="mb-6">
          <DemoOfferCard variant="genealogy" demoBusy={demoBusy} onLoadDemo={onLoadDemo} onLoadGenealogyDemo={onLoadGenealogyDemo} onLoadDatabasesDemo={onLoadDatabasesDemo} />
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
          icon={settings.synthesisModel ? 'check' : 'alert'}
          tone={settings.synthesisModel ? 'green' : 'red'}
          metric={settings.synthesisModel ? t('lista') : t('pendiente')}
          metricLabel={t('modelo de extracción')}
          action={<button className="btn btn-ghost border border-neutral-700" onClick={() => onNavigate('settings')}>{t('Ajustes')}</button>}
        >
          <p className="text-xs text-neutral-500 mt-1">
            {t('La IA extrae personas y eventos de tus documentos, sugiere parentescos, redacta biografías y genera retratos. Configura los modelos en Ajustes.')}
          </p>
        </StatusCard>
      </div>
      </div>
    </div>
  );
}

/**
 * Home screen for a Databases-mode vault: a launcher for the user's databases plus
 * the Analysis and Chat sections. Mirrors GenealogyHome's role for its vault type.
 */
export function DatabasesHome({
  databases,
  onOpenDatabase,
  onNewDatabase,
  onImportCsv,
  onOpenAnalysis,
  onOpenChat,
  demoBusy = false,
  onLoadDatabasesDemo,
}: {
  databases: DatabaseSummary[];
  onOpenDatabase: (id: string) => void;
  onNewDatabase: () => void;
  onImportCsv?: () => void;
  onOpenAnalysis: () => void;
  onOpenChat: () => void;
  demoBusy?: boolean;
  onLoadDatabasesDemo?: () => Promise<void>;
}) {
  const totalRows = databases.reduce((sum, d) => sum + d.rowCount, 0);
  return (
    <div className="h-full overflow-y-auto">
     <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6">
        <HomeIntroCard
          eyebrow={t('Vault de bases de datos')}
          title={t('Tu espacio de datos')}
          description={t('Organiza información estructurada, analiza patrones y conversa con tus tablas desde un espacio local y privado.')}
          icon="table"
        />
      </div>

      {databases.length === 0 && onLoadDatabasesDemo && (
        <div className="mb-6">
          <DemoOfferCard variant="databases" demoBusy={demoBusy} onLoadDatabasesDemo={onLoadDatabasesDemo} />
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center justify-end gap-2">
        <div className="flex gap-2">
          {onImportCsv && (
            <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={onImportCsv}>
              <Icon name="upload" /> {t('Importar CSV')}
            </button>
          )}
          <button className="btn btn-primary gap-1.5" onClick={onNewDatabase}>
            <Icon name="plus" /> {t('Nueva base de datos')}
          </button>
        </div>
      </div>

      <section className="mb-5">
        <div className="text-xs uppercase text-neutral-500 mb-2">{t('Bases de datos')}</div>
        {databases.length === 0 ? (
          <div className="card p-6 text-center">
            <Icon name="table" size={32} className="text-neutral-600 mx-auto mb-2" />
            <p className="text-sm text-neutral-400">{t('Aún no hay bases de datos.')}</p>
            <div className="flex flex-wrap gap-2 justify-center mt-3">
              <button className="btn btn-primary gap-1.5" onClick={onNewDatabase}>
                <Icon name="plus" /> {t('Crear la primera')}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {databases.map((db) => (
              <button
                key={db.id}
                className="card p-4 text-left hover:border-indigo-600/70 transition-colors"
                onClick={() => onOpenDatabase(db.id)}
              >
                <div className="flex items-center gap-2">
                  <Icon name={db.icon || 'table'} className="text-indigo-400" />
                  <span className="font-medium truncate flex-1">{db.name}</span>
                  <span className="text-[10px] font-mono text-neutral-500">{db.shortId}</span>
                </div>
                <div className="text-xs text-neutral-500 mt-2">
                  {tx('{n} entradas', { n: db.rowCount.toLocaleString() })}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button className="card p-4 text-left hover:border-indigo-600/70 transition-colors" onClick={onOpenAnalysis}>
          <div className="flex items-center gap-2 font-medium">
            <Icon name="chartBar" className="text-indigo-400" /> {t('Análisis')}
          </div>
          <p className="text-xs text-neutral-500 mt-1">
            {t('Estadísticas e informes con IA sobre una base de datos.')}
          </p>
        </button>
        <button className="card p-4 text-left hover:border-indigo-600/70 transition-colors" onClick={onOpenChat}>
          <div className="flex items-center gap-2 font-medium">
            <Icon name="chat" className="text-indigo-400" /> {t('Chat de datos')}
          </div>
          <p className="text-xs text-neutral-500 mt-1">
            {tx('Pregunta a tus datos ({n} entradas en total).', { n: totalRows.toLocaleString() })}
          </p>
        </button>
      </section>
     </div>
    </div>
  );
}
