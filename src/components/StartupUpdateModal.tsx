import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import type { UpdateCheckResponse, UpdateCheckStatus } from '@shared/types';
import { t } from '../i18n';
import { Icon } from './ui';
import { type NodiState } from './nodi/Nodi';
import { NodiAvatar } from './nodi/NodiAvatar';

const SESSION_KEY = 'nodus.startupUpdateChecked';

type UpdatePresentation = {
  title: string;
  description: string;
  icon: string;
  nodiState: NodiState;
  tone: string;
};

function presentationFor(status: UpdateCheckStatus, version?: string): UpdatePresentation {
  const resolvedVersion = version || __APP_VERSION__;
  switch (status) {
    case 'not-available':
      return {
        title: t('Ya tienes la última versión'),
        description: t('Nodus está actualizado y no necesitas hacer nada.'),
        icon: 'check',
        nodiState: 'celebrating',
        tone: 'success',
      };
    case 'available':
      return {
        title: t('Nueva actualización disponible'),
        description: t('La versión {version} está disponible y se descargará automáticamente.').replace('{version}', resolvedVersion),
        icon: 'sparkles',
        nodiState: 'discovering',
        tone: 'available',
      };
    case 'downloading':
      return {
        title: t('Descargando la actualización'),
        description: t('La versión {version} se está preparando en segundo plano.').replace('{version}', resolvedVersion),
        icon: 'download',
        nodiState: 'loading',
        tone: 'available',
      };
    case 'downloaded':
      return {
        title: t('Actualización lista'),
        description: t('Nodus se reiniciará para completar la instalación.'),
        icon: 'refresh',
        nodiState: 'celebrating',
        tone: 'success',
      };
    case 'installing':
      return {
        title: t('Instalando actualización'),
        description: t('Nodus se reiniciará para completar la instalación.'),
        icon: 'refresh',
        nodiState: 'loading',
        tone: 'available',
      };
    case 'error':
      return {
        title: t('No se pudo comprobar'),
        description: t('Comprueba tu conexión e inténtalo de nuevo.'),
        icon: 'alert',
        nodiState: 'idle',
        tone: 'error',
      };
    case 'disabled':
      return {
        title: t('Comprobación no disponible'),
        description: t('Las actualizaciones se comprueban automáticamente en la aplicación instalada.'),
        icon: 'info',
        nodiState: 'idle',
        tone: 'neutral',
      };
    case 'checking':
    default:
      return {
        title: t('Comprobando actualizaciones'),
        description: t('Buscando una nueva versión de Nodus…'),
        icon: 'sync',
        nodiState: 'loading',
        tone: 'checking',
      };
  }
}

function shouldShowThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) !== '1';
  } catch {
    return true;
  }
}

function markShownThisSession(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    /* unavailable storage only means the modal may return after a renderer reload */
  }
}

export function StartupUpdateModal({ onSettled }: { onSettled?: () => void } = {}) {
  const [shouldShow] = useState(shouldShowThisSession);
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [update, setUpdate] = useState<UpdateCheckResponse>({
    status: 'checking',
    message: '',
    version: __APP_VERSION__,
    progress: null,
  });

  useEffect(() => {
    if (!shouldShow) return;
    markShownThisSession();
    setOpen(true);
  }, [shouldShow]);

  // Nothing will be shown this session, so anything queued behind this modal must not
  // wait for a close that will never come.
  useEffect(() => {
    if (!shouldShow) onSettled?.();
  }, [shouldShow, onSettled]);

  useEffect(() => {
    if (!shouldShow) return;
    let active = true;
    const unsubscribe = window.nodus.onUpdateProgress((event) => {
      if (active) setUpdate(event);
    });
    setUpdate({ status: 'checking', message: '', version: __APP_VERSION__, progress: null });
    void window.nodus.checkForUpdates()
      .then((result) => { if (active) setUpdate(result); })
      .catch(() => {
        if (active) setUpdate({ status: 'error', message: '', version: __APP_VERSION__, progress: null });
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [attempt, shouldShow]);

  const presentation = useMemo(() => presentationFor(update.status, update.version), [update.status, update.version]);
  const progress = update.status === 'downloading'
    ? Math.max(0, Math.min(100, update.progress ?? 0))
    : update.status === 'downloaded' || update.status === 'installing' ? 100 : null;
  const canRetry = update.status === 'error';
  const canInstall = update.status === 'downloaded';

  if (!open || !shouldShow) return null;

  const close = () => {
    setOpen(false);
    onSettled?.();
  };

  const retry = () => {
    setUpdate({ status: 'checking', message: '', version: __APP_VERSION__, progress: null });
    setAttempt((current) => current + 1);
  };

  const install = async () => {
    const result = await window.nodus.installUpdate();
    setUpdate(result);
  };

  return (
    <motion.div
      className="startup-update-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: .22 }}
      onMouseDown={close}
    >
      <motion.section
        className="startup-update-cinema"
        data-testid="startup-update-modal"
        data-update-status={update.status}
        role="dialog"
        aria-modal="true"
        aria-labelledby="startup-update-title"
        initial={{ opacity: 0, y: 24, scale: .96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: .42, ease: [0.2, 0.8, 0.2, 1] }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="startup-update-hero">
          <div className="startup-update-aurora" aria-hidden="true" />
          <button className="startup-update-close" onClick={close} aria-label={t('Cerrar')}>
            <Icon name="x" size={16} />
          </button>
          <div className="startup-update-hero-copy">
            <div className="startup-update-kicker"><Icon name="refresh" size={14} /> NODUS UPDATE</div>
            <h2>{t('Actualizaciones')}</h2>
            <p>{t('Comprobamos automáticamente que tengas la versión más reciente y segura de Nodus.')}</p>
          </div>
          <div className="startup-update-nodi">
            <NodiAvatar state={presentation.nodiState} height={162} />
          </div>
        </header>

        <div className="startup-update-content">
          <div className={`startup-update-status startup-update-status-${presentation.tone}`}>
            <span className="startup-update-status-icon">
              <Icon name={presentation.icon} size={22} className={update.status === 'checking' || update.status === 'installing' ? 'animate-spin' : ''} />
            </span>
            <div className="min-w-0 flex-1">
              <h3 id="startup-update-title">{presentation.title}</h3>
              <p>{presentation.description}</p>
            </div>
          </div>

          {progress != null && (
            <div className="startup-update-progress" data-testid="startup-update-progress">
              <div><span>{t('Progreso')}</span><b>{Math.round(progress)}%</b></div>
              <div className="startup-update-progress-track"><i style={{ width: `${progress}%` }} /></div>
            </div>
          )}

          <div className="startup-update-versions">
            <span><small>{t('Versión instalada')}</small><b>v{__APP_VERSION__}</b></span>
            {(update.status === 'available' || update.status === 'downloading' || update.status === 'downloaded' || update.status === 'installing') && update.version && (
              <span><small>{t('Nueva versión')}</small><b>v{update.version}</b></span>
            )}
          </div>
        </div>

        <footer className="startup-update-footer">
          {canRetry && <button className="startup-update-secondary" onClick={retry}><Icon name="refresh" size={14} /> {t('Comprobar de nuevo')}</button>}
          {canInstall && <button className="startup-update-primary" onClick={() => void install()}><Icon name="refresh" size={14} /> {t('Reiniciar')}</button>}
          {!canInstall && <button className="startup-update-primary" onClick={close}>{update.status === 'downloading' || update.status === 'available' ? t('Continuar en segundo plano') : t('¡Entendido!')} <Icon name="chevronRight" size={14} /></button>}
        </footer>
      </motion.section>
    </motion.div>
  );
}
