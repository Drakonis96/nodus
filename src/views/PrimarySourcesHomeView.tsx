import { useEffect, useState } from 'react';
import type { PrimarySourceOperationalDashboard } from '@shared/primarySourcesTypes';
import type { VaultSummary } from '@shared/types';
import { Icon } from '../components/ui';
import { t, tx } from '../i18n';
import type { View } from '../navigation';
import { DemoOfferCard } from './HomeView';
import type { PrimarySourceOpenTarget } from './PrimarySourcesSearchView';

const EMPTY: PrimarySourceOperationalDashboard = {
  metrics: {
    descriptionUnits: 0,
    preservedMasters: 0,
    citationReadySources: 0,
    identifiedPersons: 0,
    documentedEvents: 0,
    resolvedPlaces: 0,
  },
  tasks: [],
  recentActivity: [],
  preservation: {
    lastBackupAt: null,
    lastInventoryAt: null,
    verifiedFiles: 0,
    pendingFiles: 0,
    missingFiles: 0,
    failedChecks: 0,
    orphanDerivatives: 0,
    unhashedLegacyFiles: 0,
    originalsWithoutCopy: 0,
    vaultSizeBytes: 0,
  },
  latestSource: null,
};

const METRICS = [
  { key: 'descriptionUnits', label: 'Unidades documentales', icon: 'archive' },
  { key: 'preservedMasters', label: 'Másteres preservados', icon: 'shield' },
  { key: 'citationReadySources', label: 'Fuentes listas para citar', icon: 'check' },
  { key: 'identifiedPersons', label: 'Personas identificadas', icon: 'users' },
  { key: 'documentedEvents', label: 'Eventos documentados', icon: 'clock' },
  { key: 'resolvedPlaces', label: 'Lugares resueltos', icon: 'map' },
] as const;

export function PrimarySourcesHomeView({
  vault,
  onNavigate,
  onOpenSource,
  onOpenNote,
  showDemoOffer,
  demoBusy,
  onLoadDemo,
}: {
  vault: VaultSummary | null;
  onNavigate: (view: View) => void;
  onOpenSource: (target: PrimarySourceOpenTarget) => void;
  onOpenNote: (noteId: string) => void;
  showDemoOffer: boolean;
  demoBusy: boolean;
  onLoadDemo: () => void;
}) {
  const [dashboard, setDashboard] = useState(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void window.nodus.getPrimarySourceOperationalDashboard().then((result) => {
      if (active) setDashboard(result);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const openLatest = () => {
    if (!dashboard.latestSource) {
      onNavigate('archive');
      return;
    }
    onOpenSource({
      itemId: dashboard.latestSource.itemId,
      excerptId: dashboard.latestSource.excerptId,
    });
  };

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-6 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="primary-sources-home">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-2xl border border-indigo-200 bg-white p-6 shadow-sm dark:border-indigo-950 dark:bg-neutral-900">
          <p className="text-xs font-semibold tracking-[0.18em] text-indigo-600 dark:text-indigo-300">{t('CORPUS DOCUMENTAL')}</p>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold">{vault?.name ?? t('Fuentes primarias')}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600 dark:text-neutral-400">{t('Investiga documentos originales sin mezclar lo que dice la fuente con tu interpretación.')}</p>
            </div>
            <button className="btn btn-primary gap-2" onClick={() => onNavigate('archive')} data-testid="primary-sources-add">
              <Icon name="plus" /> {t('Añadir fuentes')}
            </button>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button className="btn btn-secondary text-xs" onClick={() => onNavigate('archive')}>{t('Continuar describiendo')}</button>
            <button className="btn btn-ghost text-xs" onClick={openLatest}>{t('Abrir última fuente')}</button>
          </div>
        </header>

        {showDemoOffer && (
          <DemoOfferCard
            variant="primary-sources"
            demoBusy={demoBusy}
            onLoadPrimarySourcesDemo={onLoadDemo}
          />
        )}

        <section aria-label={t('Métricas')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {METRICS.map((metric) => (
            <article key={metric.key} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex items-center justify-between text-neutral-500">
                <span className="text-sm">{t(metric.label)}</span>
                <Icon name={metric.icon} size={16} />
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{loading ? '—' : dashboard.metrics[metric.key].toLocaleString()}</p>
            </article>
          ))}
        </section>

        <div className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
          <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900" data-testid="primary-sources-attention">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{t('Requieren atención')}</h2>
              <span className="text-[10px] text-neutral-500">{tx('{n} tareas', { n: dashboard.tasks.reduce((sum, task) => sum + task.count, 0) })}</span>
            </div>
            {dashboard.tasks.length === 0 ? (
              <p className="mt-3 text-sm leading-6 text-neutral-600 dark:text-neutral-400">{t('No hay trabajo pendiente. Las incidencias de descripción, revisión e integridad aparecerán aquí.')}</p>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {dashboard.tasks.map((task) => (
                  <button key={task.kind} className="flex items-center gap-3 rounded-lg border border-neutral-200 p-3 text-left hover:border-indigo-300 hover:bg-indigo-50 dark:border-neutral-800 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/30" onClick={() => {
                    localStorage.setItem('nodus.primarySourcesAttention', JSON.stringify({
                      kind: task.kind,
                      label: task.label,
                      targetIds: task.targetIds,
                    }));
                    onNavigate(task.view);
                  }}>
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-100 text-sm font-semibold tabular-nums text-amber-900 dark:bg-amber-950/70 dark:text-amber-200">{task.count}</span>
                    <span className="text-xs leading-5">{t(task.label)}</span>
                    <Icon name="arrowRight" size={12} className="ml-auto shrink-0 text-neutral-400" />
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900" data-testid="primary-sources-preservation">
            <h2 className="font-semibold">{t('Estado de preservación')}</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <PreservationMetric label={t('Verificados')} value={dashboard.preservation.verifiedFiles} tone="good" />
              <PreservationMetric label={t('Pendientes')} value={dashboard.preservation.pendingFiles} tone="warn" />
              <PreservationMetric label={t('Ausentes')} value={dashboard.preservation.missingFiles} tone="bad" />
              <PreservationMetric label={t('Hash no coincidente')} value={dashboard.preservation.failedChecks} tone="bad" />
              <PreservationMetric label={t('Derivados huérfanos')} value={dashboard.preservation.orphanDerivatives} tone="warn" />
              <PreservationMetric label={t('Antiguos sin hash')} value={dashboard.preservation.unhashedLegacyFiles} tone="warn" />
            </div>
            <div className="mt-4 border-t border-neutral-200 pt-3 text-[10px] leading-5 text-neutral-500 dark:border-neutral-800">
              <p>{t('Último respaldo')}: {formatDate(dashboard.preservation.lastBackupAt)}</p>
              <p>{t('Último inventario')}: {formatDate(dashboard.preservation.lastInventoryAt)}</p>
              <p>{t('Originales sin copia de acceso')}: {dashboard.preservation.originalsWithoutCopy}</p>
              <p>{t('Tamaño del vault')}: {formatBytes(dashboard.preservation.vaultSizeBytes)}</p>
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900" data-testid="primary-sources-activity">
          <h2 className="font-semibold">{t('Actividad reciente')}</h2>
          {dashboard.recentActivity.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">{t('La actividad documental aparecerá aquí al añadir o revisar fuentes.')}</p>
          ) : (
            <ol className="mt-3 divide-y divide-neutral-100 dark:divide-neutral-800">
              {dashboard.recentActivity.map((activity) => (
                <li key={activity.id} className="flex items-center gap-3 py-2.5">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-neutral-100 text-neutral-500 dark:bg-neutral-800"><Icon name={activity.kind === 'note' ? 'notebook' : activity.kind === 'export' ? 'download' : 'clock'} size={12} /></span>
                  <button className="min-w-0 flex-1 text-left" onClick={() => {
                    if (activity.view === 'notes' && activity.targetId) onOpenNote(activity.targetId);
                    else if (activity.targetId && activity.kind === 'source') onOpenSource({ itemId: activity.targetId });
                    else onNavigate(activity.view);
                  }}>
                    <span className="block truncate text-xs font-medium">{t(activity.label)}</span>
                    <span className="block truncate text-[10px] text-neutral-500">{activity.detail ? `${t(activity.detail)} · ` : ''}{formatDate(activity.occurredAt)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="grid gap-3 md:grid-cols-3" aria-label={t('Capas de investigación')}>
          {[
            ['Contenido de la fuente', 'Archivo, imagen, audio y transcripción literal.', 'archive'],
            ['Observación estructurada', 'Menciones, fechas, lugares y relaciones documentadas.', 'layers'],
            ['Interpretación del investigador', 'Hipótesis y notas separadas de la literalidad documental.', 'notebook'],
          ].map(([title, body, icon]) => (
            <article key={title} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <Icon name={icon} className="text-indigo-500" />
              <h2 className="mt-3 text-sm font-semibold">{t(title)}</h2>
              <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-400">{t(body)}</p>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}

function PreservationMetric({ label, value, tone }: { label: string; value: number; tone: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'good'
    ? 'text-emerald-700 dark:text-emerald-300'
    : tone === 'warn'
      ? 'text-amber-700 dark:text-amber-300'
      : 'text-red-700 dark:text-red-300';
  return (
    <div className="rounded-lg bg-neutral-50 p-3 dark:bg-neutral-950/60">
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="mt-0.5 text-[9px] leading-4 text-neutral-500">{label}</p>
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return t('Todavía no registrado');
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
