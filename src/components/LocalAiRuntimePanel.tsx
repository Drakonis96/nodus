import type { NodusLocalRuntimeStatus } from '@shared/localAiModels';
import { pick, t } from '../i18n';
import { LOCAL_AI_RUNTIME_TEXT } from '../i18n.localAiRuntime';
import { Icon } from './ui';

export function LocalAiRuntimePanel({ status, busy, install }: {
  status?: NodusLocalRuntimeStatus;
  busy: boolean;
  install: () => Promise<void>;
}) {
  const text = pick(LOCAL_AI_RUNTIME_TEXT);
  const diagnostics = status?.diagnostics;
  const state = diagnostics?.state ?? 'installed';
  const warning = diagnostics?.fallbackReason === 'legacy-runtime' ? text.legacy
    : diagnostics?.fallbackReason === 'gpu-unavailable' ? text.unavailable
    : diagnostics?.fallbackReason === 'gpu-startup-failed' ? text.fallback : '';
  const backend = diagnostics?.backend === 'cpu' ? 'CPU' : diagnostics?.backend === 'metal' ? 'Metal' : diagnostics?.backend === 'vulkan' ? 'Vulkan' : '';
  return <div className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800" data-testid="nodus-local-runtime">
    {status?.ready && <div aria-live="polite" data-testid="nodus-local-runtime-state">
      <span className={state === 'failed' ? 'text-red-600 dark:text-red-400' : ''}>{text[state]}</span>
      {' · '}llama.cpp {status.version}{backend && ` · ${backend}`}
      {diagnostics?.offloadedLayers != null && state === 'ready' && <p className="mt-1">
        {diagnostics.offloadedLayers === 0 ? text.cpu : text.layers.replace('{n}', String(diagnostics.offloadedLayers))}
      </p>}
    </div>}
    {diagnostics && diagnostics.devices.length > 0 && <p className="mt-1 break-words text-neutral-500">
      {text.devices}: {diagnostics.devices.join('; ')}
    </p>}
    {warning && <p className="mt-2 text-amber-700 dark:text-amber-400" data-testid="nodus-local-runtime-warning">{warning}</p>}
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button className="btn btn-ghost h-7 px-2 text-[10px]" disabled={busy} onClick={() => void install()}
        title={text.network} data-testid="nodus-local-runtime-install">
        <Icon name={status?.downloading ? 'sync' : 'download'} className={status?.downloading ? 'animate-spin' : ''} size={12} />
        {status?.downloading ? text.installing : !status?.ready ? text.install : diagnostics?.upgradeRequired ? text.update : text.recheck}
      </button>
      <button className="text-[10px] underline decoration-dotted underline-offset-2 opacity-80 hover:opacity-100"
        title={t('Abrir licencia de llama.cpp')} onClick={() => void window.nodus.openExternal('https://github.com/ggml-org/llama.cpp/blob/b10002/LICENSE')}>llama.cpp · MIT</button>
    </div>
    {diagnostics?.startupLog && <details className="mt-2" data-testid="nodus-local-runtime-log">
      <summary className="cursor-pointer text-neutral-500">{text.log}</summary>
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[10px]">{diagnostics.startupLog}</pre>
    </details>}
  </div>;
}
