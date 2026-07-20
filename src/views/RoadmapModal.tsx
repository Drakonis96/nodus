import { motion } from 'framer-motion';
import { useEffect } from 'react';
import { Icon } from '../components/ui';
import { t } from '../i18n';
import { NODUS_ROADMAP, type RoadmapItem, type RoadmapStatus } from '@shared/nodiDocumentation';

const STATUS_META: Record<RoadmapStatus, { label: string }> = {
  planned: { label: 'Planificado' },
  inProgress: { label: 'En desarrollo' },
  implemented: { label: 'Implementado' },
};

function StatusMarker({ status, compact = false }: { status: RoadmapStatus; compact?: boolean }) {
  return (
    <span
      className={`roadmap-status-marker${compact ? ' roadmap-status-marker-compact' : ''}`}
      data-status={status}
      aria-hidden="true"
    >
      {status === 'implemented' && <Icon name="check" size={compact ? 9 : 11} />}
    </span>
  );
}

function StatusLabel({ status }: { status: RoadmapStatus }) {
  return <span className="roadmap-status-label" data-status={status}>{t(STATUS_META[status].label)}</span>;
}

function RoadmapChildren({ items }: { items: readonly RoadmapItem[] }) {
  return (
    <ul className="roadmap-subitems" data-testid="roadmap-user-suggested-vaults">
      {items.map((item) => (
        <li key={item.title}>
          <StatusMarker status={item.status} compact />
          <div>
            <div className="roadmap-subitem-heading">
              <h4>{t(item.title)}</h4>
              <StatusLabel status={item.status} />
            </div>
            <p>{t(item.detail)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function RoadmapModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <motion.div
      className="roadmap-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.24 }}
      onMouseDown={onClose}
    >
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label={t('Roadmap de Nodus')}
        className="roadmap-cinema"
        data-testid="roadmap-cinematic-modal"
        initial={{ opacity: 0, y: 28, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.46, ease: [0.2, 0.8, 0.2, 1] }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="roadmap-hero">
          <div className="roadmap-aurora" aria-hidden="true" />
          <div className="roadmap-stars" aria-hidden="true" />
          <button className="roadmap-close" onClick={onClose} aria-label={t('Cerrar')}><Icon name="x" size={16} /></button>
          <div className="roadmap-hero-copy">
            <div className="roadmap-kicker"><Icon name="route" size={14} /> {t('Roadmap')}</div>
            <h2>{t('Roadmap de Nodus')}</h2>
            <p>{t('Próximos pasos previstos, sin fechas cerradas y sujetos a feedback y pulido.')}</p>
          </div>
          <div className="roadmap-hero-route" aria-hidden="true">
            <span><Icon name="route" size={44} /></span>
            <i /><i /><i />
          </div>
        </header>

        <div className="roadmap-scroll" data-testid="roadmap-timeline">
          <aside className="roadmap-legend" aria-label={t('Estado de cada iniciativa')} data-testid="roadmap-status-legend">
            <span className="roadmap-legend-title">{t('Estado de cada iniciativa')}</span>
            {(Object.keys(STATUS_META) as RoadmapStatus[]).map((status) => (
              <span className="roadmap-legend-item" key={status}>
                <StatusMarker status={status} compact />
                {t(STATUS_META[status].label)}
              </span>
            ))}
          </aside>

          <ol className="roadmap-timeline">
            {NODUS_ROADMAP.map((item) => (
              <li key={item.title} className="roadmap-item" data-status={item.status}>
                <StatusMarker status={item.status} />
                <article className="roadmap-card">
                  <div className="roadmap-card-heading">
                    <h3>{t(item.title)}</h3>
                    <StatusLabel status={item.status} />
                  </div>
                  <p>{t(item.detail)}</p>
                  {item.children && <RoadmapChildren items={item.children} />}
                </article>
              </li>
            ))}
          </ol>
        </div>

        <footer className="roadmap-footer">
          <span><Icon name="network" size={13} /> NODUS</span>
          <span>{t('Sin fechas cerradas')}</span>
          <button onClick={onClose}>{t('Cerrar')} <Icon name="check" size={14} /></button>
        </footer>
      </motion.section>
    </motion.div>
  );
}
