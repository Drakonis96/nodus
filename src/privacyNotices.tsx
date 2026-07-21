import { useEffect, useState } from 'react';
import type { StudyMaterialAiProcessingPrompt } from '@shared/types';
import { confirm } from './components/feedback';
import { PROVIDER_LABELS } from './components/ui';
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
    zIndex: 220,
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
    zIndex: 220,
  });
}

/** Bridges native-picker requests to the same themed modal used by the renderer. */
export function PrivacyRequestHost() {
  useEffect(() => {
    const stopFileImport = window.nodus.onFileImportPrivacyRequest(({ requestId }) => {
      void confirmFileImportPrivacy()
        .then((allowed) => window.nodus.resolveFileImportPrivacyRequest(requestId, allowed))
        .catch(() => window.nodus.resolveFileImportPrivacyRequest(requestId, false));
    });
    const stopAiProcessing = window.nodus.onStudyMaterialAiProcessingRequest((request) => {
      let remember = false;
      void confirm({
        title: t('¿Procesar este material con IA?'),
        message: <StudyMaterialAiProcessingNotice request={request} onRemember={(value) => { remember = value; }} />,
        confirmLabel: t('Sí, procesar'),
        cancelLabel: t('No, ahora no'),
        zIndex: 220,
      }).then((process) => window.nodus.resolveStudyMaterialAiProcessingRequest(request.requestId, { process, remember }))
        .catch(() => window.nodus.resolveStudyMaterialAiProcessingRequest(request.requestId, { process: false, remember: false }));
    });
    return () => { stopFileImport(); stopAiProcessing(); };
  }, []);
  return null;
}

function StudyMaterialAiProcessingNotice({ request, onRemember }: {
  request: StudyMaterialAiProcessingPrompt;
  onRemember: (value: boolean) => void;
}) {
  const [remember, setRemember] = useState(false);
  const titles = request.titles.slice(0, 3);
  return (
    <div className="space-y-3 text-left text-sm leading-5" data-testid="study-material-ai-processing-prompt">
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/60">
        {titles.map((title, index) => <p key={`${title}:${index}`} className="truncate font-medium text-neutral-800 dark:text-neutral-200">{title}</p>)}
        {request.titles.length > titles.length && <p className="text-xs text-neutral-500">+{request.titles.length - titles.length}</p>}
      </div>
      <p>{t('Nodus puede extraer conceptos, relaciones y citas textuales para crear el mapa de Ideas y el grafo de estudio.')}</p>
      <p className="text-xs text-neutral-500">
        {request.local
          ? t('El análisis se realizará en este dispositivo con el modelo seleccionado; el archivo no saldrá del equipo.')
          : t('Se enviarán al proveedor indicado el título y el texto extraído necesario. El archivo original permanecerá en tu dispositivo.')}
      </p>
      <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
        {PROVIDER_LABELS[request.provider]} · {request.model}{request.inputChars > 0 ? ` · ${request.inputChars.toLocaleString()} ${t('caracteres extraídos')}` : ''}
      </p>
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-300">
        <input
          data-testid="study-material-ai-remember"
          type="checkbox"
          checked={remember}
          onChange={(event) => { setRemember(event.target.checked); onRemember(event.target.checked); }}
        />
        {t('No volver a preguntar')}
      </label>
    </div>
  );
}
