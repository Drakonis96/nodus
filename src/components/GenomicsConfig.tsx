import { useEffect, useState } from 'react';
import { ALPHAGENOME_TERMS, ALPHAGENOME_OUTPUT_TERMS, type GenomicsStatus } from '@shared/genomics';
import { t } from '../i18n';

export function GenomicsConfig({ onConfigured }: { onConfigured: () => void }) {
  const [status, setStatus] = useState<GenomicsStatus | null>(null);
  const [key, setKey] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { void window.nodus.getGenomicsStatus().then(s => { setStatus(s); setAccepted(s.termsAccepted); }).catch(() => setError(t('No se pudo cargar la configuración.'))); }, []);
  const action = async (fn: () => Promise<GenomicsStatus>) => {
    setBusy(true); setError('');
    try { const s = await fn(); setStatus(s); setAccepted(s.termsAccepted); return s; }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); setKey(''); }
  };
  return <section className="genomics-config" aria-label={t('Configuración de AlphaGenome')}>
    <b>{t('Configuración de AlphaGenome')}</b>
    <p>{t('Usa tu clave personal. Se guarda cifrada en este dispositivo y solo se envía a AlphaGenome; no se incluye en el chat, las copias de seguridad ni la sincronización.')}</p>
    <p><a href="https://deepmind.google.com/science/alphagenome/api" target="_blank" rel="noreferrer">{t('Obtener clave personal')}</a></p>
    <label>{t('Clave API de AlphaGenome')}<input type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} placeholder={status?.hasKey ? t('Clave guardada; escribe para sustituirla') : t('Introduce tu clave personal')} disabled={busy} /></label>
    <p><a href={ALPHAGENOME_TERMS} target="_blank" rel="noreferrer">{t('Términos del servicio')}</a> · <a href={ALPHAGENOME_OUTPUT_TERMS} target="_blank" rel="noreferrer">{t('Términos de los resultados')}</a> · <a href="https://developers.google.com/terms" target="_blank" rel="noreferrer">Google APIs Terms</a></p>
    <label className="genomics-accept"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} disabled={busy} /><span>{t('Acepto estos términos y confirmo un uso individual o institucional no comercial autorizado. No usaré datos de pacientes, fines clínicos, trabajo para empresas ni entrenamiento de modelos similares. Conservaré los avisos y restricciones al compartir resultados.')}</span></label>
    <p>{t('Solo se envían a Google la variante, región, tejido y señal solicitados. Las predicciones se conservan localmente y no se reenvían al proveedor del chat.')}</p>
    <div className="genomics-actions"><button type="button" disabled={busy || !accepted || (!key.trim() && !status?.hasKey)} onClick={() => void action(() => window.nodus.configureGenomics({ ...(key.trim() ? { apiKey: key.trim() } : {}), acceptTerms: accepted })).then(s => { if (s?.hasKey && s.termsAccepted) onConfigured(); })}>{t('Guardar configuración')}</button>
      <button type="button" disabled={busy || !status?.hasKey} onClick={() => void action(() => window.nodus.clearGenomicsConfiguration())}>{t('Eliminar clave')}</button></div>
    <p>{status?.runtimeReady ? t('Cliente de AlphaGenome preparado.') : t('Se necesita Python 3.10 o posterior. Instala el cliente oficial y sus dependencias en un entorno aislado para esta skill.')}</p>
    {!status?.runtimeReady && <button type="button" disabled={busy || status?.installing} onClick={() => void action(() => window.nodus.installGenomicsRuntime())}>{busy || status?.installing ? t('Preparando el cliente…') : t('Instalar cliente de AlphaGenome')}</button>}
    <p>{t('Código del cliente: Google LLC, Apache 2.0. El servicio y sus resultados tienen términos independientes. Nodus no está avalado por Google.')}</p>
    {error && <p role="alert" className="chat-skill-error">{error}</p>}
  </section>;
}
