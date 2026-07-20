import { confirm } from './components/feedback';
import { t } from './i18n';

/** Just-in-time first privacy layer. It is shown for every new microphone session. */
export function confirmMicrophonePrivacy(): Promise<boolean> {
  return confirm({
    title: t('Antes de activar el micrófono'),
    message: (
      <div className="space-y-2 text-left text-sm leading-5">
        <p>{t('La grabación se guardará localmente en este dispositivo. Nodus no la sube a un servidor propio.')}</p>
        <p>{t('Informa previamente a todas las personas que puedan quedar grabadas y continúa solo si tienes una base jurídica y autorización suficientes para esta finalidad.')}</p>
        <p className="text-xs text-neutral-500">{t('Continuar confirma que has leído este aviso; no sustituye el consentimiento ni las obligaciones del responsable del tratamiento.')}</p>
        <button
          type="button"
          className="text-xs font-medium text-indigo-400 underline underline-offset-2 hover:text-indigo-300"
          onClick={() => void window.nodus.openPrivacyPolicy()}
        >
          {t('Leer política de privacidad')}
        </button>
      </div>
    ),
    confirmLabel: t('He informado; comenzar'),
    cancelLabel: t('Cancelar'),
  });
}

/** Just-in-time first privacy layer for renderer-owned file inputs. */
export function confirmFileImportPrivacy(): Promise<boolean> {
  return confirm({
    title: t('Antes de incorporar un archivo'),
    message: (
      <div className="space-y-2 text-left text-sm leading-5">
        <p>{t('El archivo se incorporará localmente a Nodus y no se subirá a un servidor de Nodus.')}</p>
        <p>{t('Continúa solo si estás autorizado para tratar su contenido y evita datos personales o confidenciales que no sean necesarios.')}</p>
        <p className="text-xs text-neutral-500">{t('Si después activas una función remota, esa acción puede enviar al proveedor elegido el contenido necesario bajo sus condiciones.')}</p>
        <button
          type="button"
          className="text-xs font-medium text-indigo-400 underline underline-offset-2 hover:text-indigo-300"
          onClick={() => void window.nodus.openPrivacyPolicy()}
        >
          {t('Leer política de privacidad')}
        </button>
      </div>
    ),
    confirmLabel: t('Estoy autorizado; seleccionar'),
    cancelLabel: t('Cancelar'),
  });
}
