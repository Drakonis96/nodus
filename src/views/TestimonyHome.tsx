import { useCallback, useEffect, useState } from 'react';
import type { TestimonyDashboard } from '@shared/types';
import { formatDuration } from '@shared/testimonies';
import { ALERT_HINT, ALERT_LABEL } from '@shared/testimonyLabels';
import type { View } from '../navigation';
import { Icon } from '../components/ui';
import { useDataRefresh } from '../hooks';
import { DemoOfferCard, HomeIntroCard } from './HomeView';
import { t, tx } from '../i18n';

/**
 * Inicio del vault de Testimonios: un TABLERO DE TRABAJO, no una página de bienvenida.
 *
 * «REQUIEREN ATENCIÓN» ES LA MITAD ÚTIL DE ESTA PANTALLA, y su orden no es estético: va de
 * lo que caduca a lo que espera. Grabaciones sin acuerdo documentado sube casi arriba
 * porque es la única alerta que describe material real en el disco cuyo permiso de uso no
 * consta en ninguna parte — y esa es exactamente la deuda que un proyecto de historia oral
 * arrastra durante años sin darse cuenta.
 *
 * NINGÚN AVISO SE INVENTA. Cada alerta corresponde a filas que existen y se pueden abrir;
 * un tablero que enseña avisos que no llevan a ninguna parte enseña al usuario a no
 * mirarlo, y esa costumbre no se deshace después.
 */
const ALERT_ICON: Record<string, string> = {
  upcoming: 'calendar',
  agreement_missing: 'alert',
  backup_stale: 'save',
  transcription_error: 'x',
  transcription_pending_review: 'eye',
  narrator_review_pending: 'users',
  embargo_expiring: 'clock',
  annotation_needs_review: 'highlighter',
  master_missing: 'microphone',
};

/** Qué alertas son urgentes de verdad. Si todo se pinta en rojo, nada es urgente. */
const URGENT = new Set(['agreement_missing', 'transcription_error', 'backup_stale', 'master_missing']);

function formatBytes(bytes: number): string {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(mb))} MB`;
}

export function TestimonyHome({
  onNavigate,
  onOpenInterview,
  showDemoOffer,
  demoBusy,
  onLoadDemo,
}: {
  onNavigate: (view: View) => void;
  onOpenInterview: (interviewId: string) => void;
  showDemoOffer: boolean;
  demoBusy: boolean;
  onLoadDemo: () => Promise<void>;
}) {
  const [board, setBoard] = useState<TestimonyDashboard | null>(null);

  const reload = useCallback(async () => {
    setBoard(await window.nodus.testimonyDashboard());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);
  useDataRefresh(reload);

  const metrics = board?.metrics;
  const cards: { label: string; value: string; icon: string }[] = [
    { label: 'Entrevistas', value: String(metrics?.interviews ?? 0), icon: 'microphone' },
    { label: 'Programadas', value: String(metrics?.scheduled ?? 0), icon: 'calendar' },
    { label: 'Pendientes de transcripción', value: String(metrics?.pendingTranscription ?? 0), icon: 'file' },
    { label: 'En revisión', value: String(metrics?.reviewing ?? 0), icon: 'eye' },
    { label: 'Completadas', value: String(metrics?.completed ?? 0), icon: 'check' },
    { label: 'Horas de grabación', value: formatDuration(metrics?.recordedSeconds ?? 0), icon: 'clock' },
    { label: 'Espacio ocupado', value: formatBytes(metrics?.storageBytes ?? 0), icon: 'save' },
    { label: 'Participantes', value: String(metrics?.participants ?? 0), icon: 'users' },
  ];

  return (
    <div className="h-full overflow-y-auto p-6" data-testid="testimony-home">
      <div className="mx-auto max-w-5xl space-y-6">
        <HomeIntroCard
          eyebrow={t('Vault de testimonios')}
          title={t('Tu proyecto de historia oral')}
          description={t('Prepara, registra, transcribe, codifica y conserva entrevistas sin que la grabación se separe de su transcripción ni la cita de su minuto. Cada entrevista guarda además con qué acuerdo se hizo y qué puede hacerse con ella.')}
          icon="microphone"
        />

        {showDemoOffer && (
          <DemoOfferCard variant="testimonios" demoBusy={demoBusy} onLoadTestimonyDemo={onLoadDemo} />
        )}

        <section className="flex flex-wrap gap-2">
          <button className="btn btn-primary" data-testid="testimony-home-new" onClick={() => onNavigate('testimonyInterviews')}>
            <Icon name="plus" /> {t('Nueva entrevista')}
          </button>
          <button className="btn btn-ghost" onClick={() => onNavigate('testimonyParticipants')}>
            <Icon name="users" /> {t('Participantes')}
          </button>
          <button className="btn btn-ghost" onClick={() => onNavigate('testimonyContrasts')}>
            <Icon name="scale" /> {t('Contrastes')}
          </button>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="testimony-metrics">
          {cards.map((card) => (
            <div key={card.label} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <span className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-neutral-500">
                <Icon name={card.icon} size={13} /> {t(card.label)}
              </span>
              <span className="mt-1 block text-xl font-semibold text-neutral-800 dark:text-neutral-100">{card.value}</span>
            </div>
          ))}
        </section>

        <section data-testid="testimony-alerts">
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{t('Requieren atención')}</h2>
          {(board?.alerts.length ?? 0) === 0 ? (
            <p className="mt-2 rounded-xl border border-neutral-200 p-4 text-sm text-neutral-500 dark:border-neutral-800">
              {t('Nada pendiente. Cuando haya acuerdos sin documentar, transcripciones sin revisar o embargos por vencer, aparecerán aquí.')}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {board!.alerts.map((alert) => (
                <li
                  key={alert.kind}
                  data-testid={`testimony-alert-${alert.kind}`}
                  className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${
                    URGENT.has(alert.kind)
                      ? 'border-amber-400 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/25'
                      : 'border-neutral-200 dark:border-neutral-800'
                  }`}
                >
                  <Icon
                    name={ALERT_ICON[alert.kind] ?? 'alert'}
                    size={16}
                    className={URGENT.has(alert.kind) ? 'text-amber-500' : 'text-neutral-500'}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-neutral-800 dark:text-neutral-100">
                      {t(ALERT_LABEL[alert.kind])}
                      <span className="ml-2 text-xs font-normal text-neutral-500">{alert.count}</span>
                    </span>
                    <span className="block text-[11px] leading-5 text-neutral-500">{t(ALERT_HINT[alert.kind])}</span>
                  </span>
                  {alert.interviewIds.length > 0 && (
                    <button className="btn btn-ghost shrink-0 text-xs" onClick={() => onOpenInterview(alert.interviewIds[0])}>
                      {t('Abrir')}
                    </button>
                  )}
                  {alert.kind === 'backup_stale' && (
                    <button className="btn btn-ghost shrink-0 text-xs" onClick={() => onNavigate('settings')}>
                      {t('Revisar copias')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{t('Actividad reciente')}</h2>
            <ul className="mt-3 space-y-1.5 text-xs">
              {(board?.recent.interviews ?? []).map((entry) => (
                <li key={entry.id}>
                  <button className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-900" onClick={() => onOpenInterview(entry.id)}>
                    <Icon name="microphone" size={12} className="shrink-0 text-neutral-500" />
                    <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-300">{entry.title}</span>
                    <span className="shrink-0 text-neutral-500">{entry.updatedAt.slice(0, 10)}</span>
                  </button>
                </li>
              ))}
              {(board?.recent.contrasts ?? []).map((entry) => (
                <li key={entry.id} className="flex items-center gap-2 px-1 py-0.5">
                  <Icon name="scale" size={12} className="shrink-0 text-neutral-500" />
                  <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-300">{entry.title}</span>
                  <span className="shrink-0 text-neutral-500">{entry.updatedAt.slice(0, 10)}</span>
                </li>
              ))}
              {(board?.recent.interviews.length ?? 0) === 0 && (board?.recent.contrasts.length ?? 0) === 0 && (
                <li className="text-neutral-500">{t('Sin actividad todavía.')}</li>
              )}
            </ul>
          </div>

          <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800" data-testid="testimony-preservation">
            <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{t('Estado de preservación')}</h2>
            <dl className="mt-3 space-y-1.5 text-xs">
              <Row label={t('Última copia completa')} value={board?.preservation.lastBackupAt?.slice(0, 10) ?? t('Nunca')} />
              <Row label={t('Entrevistas sin original')} value={String(board?.preservation.interviewsWithoutMaster ?? 0)} />
              <Row label={t('Archivos sin huella')} value={String(board?.preservation.mediaWithoutHash ?? 0)} />
              <Row label={t('Espacio utilizado')} value={formatBytes(board?.preservation.storageBytes ?? 0)} />
            </dl>
            <p className="mt-3 text-[11px] leading-5 text-neutral-500">
              {t('Guardar el audio dentro de la bóveda no es, por sí solo, preservación a largo plazo: hace falta al menos una copia fuera de este equipo.')}
            </p>
          </div>
        </section>

        {metrics && metrics.interviews > 0 && (
          <p className="text-[11px] text-neutral-500">
            {tx('{codes} códigos · {annotations} fragmentos codificados', { codes: metrics.codes, annotations: metrics.annotations })}
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-medium text-neutral-700 dark:text-neutral-200">{value}</dd>
    </div>
  );
}
