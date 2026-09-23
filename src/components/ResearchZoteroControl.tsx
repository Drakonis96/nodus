import { useEffect, useState } from 'react';
import type { ZoteroMcpStatus } from '@shared/researchCorpus';
import { t } from '../i18n';

export function ResearchZoteroControl({ notebookId }: { notebookId: string }) {
  const [status, setStatus] = useState<ZoteroMcpStatus | null>(null);
  const [mode, setMode] = useState<'managed' | 'external'>('managed');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; void window.nodus.getZoteroMcpStatus().then(value => { if (active) setStatus(value); }); return () => { active = false; }; }, []);
  const connected = status?.state === 'connected' && status.notebookId === notebookId;
  const connect = async () => {
    setBusy(true); setError('');
    try { setStatus(await window.nodus.connectResearchZotero({ notebookId, mode, ...(mode === 'external' ? { externalUrl: url } : {}) })); }
    catch (reason) { setError(String(reason)); setStatus(await window.nodus.getZoteroMcpStatus()); }
    finally { setBusy(false); }
  };
  return <fieldset className="rounded border border-neutral-300 dark:border-neutral-700 p-3 text-sm mb-3">
    <legend>Zotero MCP</legend>
    <p className="mb-2">{t('Conexión de solo lectura limitada a las fuentes de este cuaderno.')}</p>
    <label>{t('Modalidad')} <select className="input" value={mode} disabled={busy} onChange={event => setMode(event.target.value as typeof mode)}>
      <option value="managed">{t('Zotero MCP gestionado')}</option><option value="external">{t('Conexión externa avanzada')}</option>
    </select></label>
    {mode === 'external' && <label className="block mt-2">{t('Endpoint MCP')}<input type="url" className="input w-full" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://localhost/mcp" /></label>}
    <div className="flex flex-wrap items-center gap-2 mt-2">
      <button type="button" className="btn btn-ghost" disabled={busy || (mode === 'external' && !url)} onClick={() => void connect()}>{t('Conectar')}</button>
      <button type="button" className="btn btn-ghost" disabled={busy || !connected} onClick={() => {
        setBusy(true); void window.nodus.disconnectResearchZotero().then(() => window.nodus.getZoteroMcpStatus()).then(setStatus).catch(reason => setError(String(reason))).finally(() => setBusy(false));
      }}>{t('Desconectar')}</button>
      <span role="status">{busy ? t('Conectando…') : connected ? `${t('Conectado')} · ${status?.transport} · ${status?.version}` : t('Desconectado')}</span>
    </div>
    {error && <p role="alert" className="text-red-500 mt-2">{error}</p>}
  </fieldset>;
}
