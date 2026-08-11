import type { UpdateCheckResponse } from '@shared/types';
import { t, tx } from './i18n';

/**
 * Build the user-facing update line in the active language.
 *
 * The main process cannot call `t()` (the active language lives in the
 * renderer), so every `UpdateCheckResponse.message` it emits is Spanish source
 * text. The response is structured, though, so the renderer re-derives the
 * sentence from `status`/`version`/`progress` and only falls back to the raw
 * `message` for `error`, where it carries the underlying failure text.
 */
export function updateStatusMessage(update: UpdateCheckResponse): string {
  const version = update.version || '';
  switch (update.status) {
    case 'checking':
      return t('Buscando actualizaciones…');
    case 'available':
      return tx('Actualización {version} encontrada. La descarga empezará automáticamente.', { version });
    case 'downloading':
      return tx('Descargando actualización… {percent}%', {
        percent: Math.round(Math.max(0, Math.min(100, update.progress ?? 0))),
      });
    case 'downloaded':
      return tx('Actualización {version} descargada. Reiniciando para instalarla…', { version });
    case 'backing-up':
      return t('Creando y verificando una copia de seguridad antes de actualizar…');
    case 'installing':
      return tx('Instalando Nodus {version} y reiniciando…', { version });
    case 'not-available':
      return tx('Nodus {version} ya está actualizado.', { version });
    case 'disabled':
      return t('Las actualizaciones solo están disponibles en la app empaquetada.');
    case 'error':
      if (update.errorCode === 'pre-update-backup-required') {
        return t('Configura Recuperación antes de instalar una beta. La actualización permanece descargada y tus datos no se han modificado.');
      }
      if (update.errorCode === 'pre-update-backup-failed') {
        return t('La beta no se instaló porque no pudo crearse y verificarse la copia de seguridad previa. Tus datos no se han modificado.');
      }
      return update.message || t('No se pudo comprobar si hay actualizaciones.');
    default:
      return update.message;
  }
}
