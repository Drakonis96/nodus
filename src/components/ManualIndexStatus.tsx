import { useEffect, useState } from 'react';
import { t } from '../i18n';
export function ManualIndexStatus() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof window.nodus.getManualIndexStatus>> | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => void window.nodus.getManualIndexStatus().then(value => { if (live) setStatus(value); }).catch(() => undefined);
    read(); const timer = setInterval(read, 1500);
    return () => { live = false; clearInterval(timer); };
  }, []);
  return <div role="status" data-testid="manual-index-status" className="flex items-center gap-2 px-3 py-2 text-xs text-neutral-500">
    <span>{status?.state === 'preparing' ? t('Preparando el índice local…') : status?.state === 'queued' || status?.state === 'indexing' ? t('Indexando ideas…') : status?.state === 'error' ? t('Indexación pendiente. Puedes seguir escribiendo.') : t('Índice local')}</span>
    {status?.state === 'error' && <button className="btn btn-ghost text-xs" title={status.error ?? ''} onClick={() => void window.nodus.retryManualIndex()}>{t('Reintentar')}</button>}
  </div>;
}
