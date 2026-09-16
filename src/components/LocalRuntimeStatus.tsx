import type { NodusLocalRuntimeStatus } from '@shared/localAiModels';
import { runtimeText } from '../i18n.localAiRuntime';

export function LocalRuntimeStatus({ runtime, busy, onCheck, onCancel }: {
  runtime: NodusLocalRuntimeStatus | undefined;
  busy: boolean;
  onCheck: () => void;
  onCancel: () => void;
}) {
  const diagnostic = runtime?.diagnostics;
  if (!runtime || !diagnostic) return null;
  const backend = diagnostic.backend === 'metal' ? 'Metal' : diagnostic.backend === 'vulkan' ? 'Vulkan' : diagnostic.backend?.toUpperCase();
  const phases = {
    'not-installed': 'Motor no instalado', installed: 'Motor instalado', starting: 'Cargando modelo…',
    running: 'Modelo listo', calibrating: 'Calibración en segundo plano; tu solicitud tiene prioridad.', error: 'Error al iniciar el modelo',
  } as const;
  const warning = Boolean(diagnostic.fallbackReason || diagnostic.phase === 'error' || diagnostic.offloadedLayers === 0);
  return <section className={`mt-3 rounded-lg border px-3 py-2 text-xs leading-5 ${warning
    ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200'
    : 'border-neutral-200 text-neutral-600 dark:border-neutral-800 dark:text-neutral-400'}`} data-testid="nodus-local-runtime-status" aria-live="polite">
    <div className="font-medium">{runtimeText(phases[diagnostic.phase])}{backend ? ` · ${backend}` : ''}</div>
    {diagnostic.devices.length > 0 && <div>{runtimeText('GPU detectada: {devices}').replace('{devices}', diagnostic.devices.map((device) => device.name).join(', '))}</div>}
    {diagnostic.offloadedLayers != null
      ? <div>{diagnostic.offloadedLayers > 0
        ? runtimeText('Capas del modelo en GPU: {count}').replace('{count}', String(diagnostic.offloadedLayers))
        : runtimeText('El modelo se está ejecutando en CPU.')}</div>
      : diagnostic.backend && diagnostic.backend !== 'cpu' && <div>{runtimeText('El uso de GPU se comprueba al cargar el modelo.')}</div>}
    {diagnostic.fallbackReason === 'legacy-cpu' && <p>{runtimeText('El motor antiguo es solo CPU. Comprueba la actualización para habilitar una GPU compatible sin volver a descargar los modelos.')}</p>}
    {diagnostic.fallbackReason === 'gpu-unavailable' && <p>{runtimeText('No se pudo activar una GPU compatible; se utilizará CPU.')}</p>}
    {diagnostic.fallbackReason === 'gpu-start-failed' && <p>{runtimeText('El arranque con GPU falló; se ha reintentado con CPU.')}</p>}
    {diagnostic.detail && <details className="mt-1">
      <summary className="cursor-pointer">{runtimeText('Diagnóstico local')}</summary>
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px]">{diagnostic.detail}</pre>
    </details>}
    {runtime.ready && <div className="mt-2 flex flex-wrap items-center gap-2">
      <button className="btn btn-ghost h-auto px-2 py-1 text-xs" disabled={busy} onClick={onCheck} data-testid="nodus-local-runtime-upgrade">{runtimeText('Comprobar/actualizar motor')}</button>
      <span>{runtimeText('Puede descargar motores; los modelos se conservan.')}</span>
    </div>}
    {runtime.downloading && <button className="btn btn-ghost mt-1 h-auto px-2 py-1 text-xs" onClick={onCancel}>{runtimeText('Cancelar descarga del motor')}</button>}
  </section>;
}
