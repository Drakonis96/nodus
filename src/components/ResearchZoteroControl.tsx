import { useEffect, useState } from 'react';
import type { ZoteroMcpStatus } from '@shared/researchCorpus';
import { t } from '../i18n';

export function ResearchZoteroControl({ notebookId }: { notebookId: string }) {
  const [status, setStatus] = useState<ZoteroMcpStatus | null>(null);
  const [mode, setMode] = useState<'managed' | 'external'>('managed');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = (initial = false) => void window.nodus.getZoteroMcpStatus(notebookId).then(value => {
      if (!active) return;
      setStatus(value);
      if (initial) { setMode(value.externalUrl ? 'external' : 'managed'); setUrl(value.externalUrl ?? ''); }
    }).catch(reason => { if (active) setError(String(reason)); });
    refresh(true);
    const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [notebookId]);
  const connected = status?.state === 'connected' && status.notebookId === notebookId;
  const connect = async () => {
    setBusy(true); setError('');
    try { setStatus(await window.nodus.connectResearchZotero({ notebookId, mode, ...(mode === 'external' ? { externalUrl: url } : {}) })); }
    catch (reason) { setError(String(reason)); setStatus(await window.nodus.getZoteroMcpStatus(notebookId)); }
    finally { setBusy(false); }
  };
  return <fieldset className="rounded border border-neutral-300 dark:border-neutral-700 p-3 text-sm mb-3">
    <legend>Zotero MCP</legend>
    <p className="mb-2">{t('Conexión de solo lectura limitada a las fuentes de este cuaderno.')}</p>
    <label>{t('Modalidad')} <select className="input" value={mode} disabled={busy} onChange={event => {
      const next = event.target.value as typeof mode; setMode(next);
      if (next === 'managed') {
        setBusy(true); void window.nodus.disconnectResearchZotero(notebookId).then(() => window.nodus.getZoteroMcpStatus(notebookId)).then(setStatus).catch(reason => setError(String(reason))).finally(() => setBusy(false));
      }
    }}>
      <option value="managed">{t('Zotero MCP gestionado')}</option><option value="external">{t('Conexión externa avanzada')}</option>
    </select></label>
    {mode === 'managed' && <label className="flex items-center gap-2 mt-2"><input type="checkbox" disabled={busy} checked={status?.automatic !== false} onChange={event => {
      setBusy(true); void window.nodus.setResearchZoteroAutomatic(event.target.checked).then(setStatus).catch(reason => setError(String(reason))).finally(() => setBusy(false));
    }} />{t('Conectar automáticamente cuando sea necesario')}</label>}
    {mode === 'external' && <label className="block mt-2">{t('Endpoint MCP')}<input type="url" className="input w-full" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://localhost/mcp" /></label>}
    <div className="flex flex-wrap items-center gap-2 mt-2">
      {mode === 'external' && <button type="button" className="btn btn-ghost" disabled={busy || (mode === 'external' && !url)} onClick={() => void connect()}>{t('Conectar')}</button>}
      {mode === 'external' && <button type="button" className="btn btn-ghost" disabled={busy || (!connected && !status?.externalUrl)} onClick={() => {
        setBusy(true); void window.nodus.disconnectResearchZotero(notebookId).then(() => window.nodus.getZoteroMcpStatus(notebookId)).then(setStatus).catch(reason => setError(String(reason))).finally(() => setBusy(false));
      }}>{t('Desconectar')}</button>}
      <span role="status">{busy ? t('Conectando…') : connected ? `${t('Conectado')} · ${status?.transport} · ${status?.version}` : mode === 'managed' && status?.automatic !== false ? t('Disponible cuando sea necesario') : t('Desconectado')}</span>
    </div>
    {(error || status?.error) && <p role="alert" className="text-red-500 mt-2">{error || status?.error}</p>}
  </fieldset>;
}
