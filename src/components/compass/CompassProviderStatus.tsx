import { compassT } from '../../i18n.compass';
import type { CompassProviderStatus as Status } from './types';

export function CompassProviderStatus({ providers }: { providers: Status[] }) {
  if (!providers.length) return null;
  return <div className="flex flex-wrap gap-1.5" role="status" aria-live="polite" aria-label={compassT('Proveedores')}>
    {providers.map((item) => <span key={item.provider} aria-label={`${item.provider} — ${compassT(item.state)}${item.error ? `: ${item.error}` : ''}`} title={item.error ?? compassT(item.state)} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${item.state === 'error' ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' : item.state === 'rate-limited' ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300' : item.state === 'complete' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'}`}>
      <span aria-hidden="true">{item.state === 'error' ? '!' : item.state === 'rate-limited' ? '⏱' : item.state === 'complete' ? '✓' : item.state === 'searching' ? '…' : '·'}</span>
      {item.provider}{item.count != null ? ` · ${item.count}` : ''}
    </span>)}
  </div>;
}
