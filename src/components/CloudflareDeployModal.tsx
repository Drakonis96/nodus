import { Fragment, useEffect, useState, type ReactNode } from 'react';
import type { CloudflareDeployState } from '@shared/cloudflare';
import { errorText, t, tr, tx } from '../i18n';
import { Icon } from './ui';

/**
 * Render a translated sentence keeping one literal token in <code>. The token
 * (`workers.dev`, `NODUS_BOOTSTRAP_SECRET_HASH`) is the same in every language, so
 * the whole sentence stays a single translation key instead of being stitched
 * together from fragments that no translator can reorder.
 */
function withCode(text: string, token: string): ReactNode {
  const parts = text.split(token);
  if (parts.length === 1) return text;
  return parts.map((part, index) => (
    <Fragment key={index}>{index > 0 && <code>{token}</code>}{part}</Fragment>
  ));
}

/** Cost figures are read as numbers, so they follow the reader's locale, not the vault's. */
const amount = (value: number): string => value.toLocaleString();

/** Which Cloudflare product a pricing link documents. Brand names, never translated. */
function priceSourceName(url: string): string {
  const { pathname } = new URL(url);
  if (pathname.includes('/d1/')) return 'D1';
  if (pathname.includes('/r2/')) return 'R2';
  if (pathname.includes('vectorize')) return 'Vectorize';
  return 'Workers';
}

export function CloudflareDeployModal({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [state, setState] = useState<CloudflareDeployState | null>(null);
  const [workerUrl, setWorkerUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.nodus.previewCloudflareDeployment().then(setState).catch((value) => setError(errorText(value)));
  }, []);

  const prepare = async () => {
    setBusy(true); setError(null);
    try {
      await window.nodus.prepareCloudflareDirectDeployment();
      setState(await window.nodus.getCloudflareDeployState());
    } catch (value) { setError(errorText(value)); }
    finally { setBusy(false); }
  };

  const copyAndOpen = async () => {
    if (!state?.setupCode || !state.deployUrl) return;
    try {
      await navigator.clipboard.writeText(state.setupCode);
      setCopied(true);
      await window.nodus.openCloudflareDeployment(state.deployUrl);
    } catch (value) { setError(errorText(value)); }
  };

  const connect = async () => {
    setBusy(true); setError(null);
    const timer = window.setInterval(() => void window.nodus.getCloudflareDeployState().then(setState), 700);
    try {
      const next = await window.nodus.completeCloudflareDirectDeployment({ workerUrl, administratorEmail: email, administratorPassword: password });
      setState(next);
      if (next.phase === 'complete') onComplete(); else setError(next.error);
    } catch (value) { setError(errorText(value)); }
    finally { window.clearInterval(timer); setBusy(false); }
  };

  const expected = state?.estimate?.scenarios.find((entry) => entry.id === 'expected');
  const prepared = Boolean(state?.setupCode && state?.deployUrl);
  const existing = state?.deployment;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-4" onClick={onClose}>
      <div className="card max-h-[92vh] w-full max-w-3xl overflow-y-auto p-5 sm:p-6" role="dialog" aria-modal="true" aria-label="Deploy to Cloudflare" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div><h2 className="text-xl font-semibold">Deploy to Cloudflare</h2><p className="mt-1 text-sm text-neutral-500">{t('Tu vault disponible sin servidor y sin intermediación de Nodus.')}</p></div>
          <button className="btn btn-ghost" onClick={onClose} aria-label={t('Cerrar')}><Icon name="x" /></button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-950 dark:border-sky-900 dark:bg-sky-950/25 dark:text-sky-100">
            <strong>{t('¿Qué hace Cloudflare?')}</strong>
            <p className="mt-1">{t('Ejecuta Nodus Cloud y guarda la copia sincronizada de tu vault. No necesitas un dominio, hosting tradicional ni dejar ningún ordenador encendido.')}</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-100">
            <strong>{t('La cuenta y los datos son tuyos')}</strong>
            <p className="mt-1">{t('Cloudflare crea Worker, D1 y R2 directamente en tu cuenta. Nodus no recibe permisos, tokens de Cloudflare, facturas ni acceso de administración.')}</p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="font-medium">{t('Coste estimado para este vault')}</h3><p className="text-xs text-neutral-500">{t('Archivos, datos, operaciones, búsqueda y tráfico incluidos.')}</p></div>
            {!state?.estimate ? <Icon name="sync" className="animate-spin" /> : expected?.withinFreeTier
              ? <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{t('Uso esperado dentro del nivel gratuito')}</span>
              : <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">{tx('≈ US${amount} / mes', { amount: expected?.estimatedUsdPerMonth.toFixed(2) ?? '' })}</span>}
          </div>
          {state?.estimate && <div className="mt-3 grid gap-2 sm:grid-cols-3">{state.estimate.scenarios.map((scenario) => <div key={scenario.id} className="rounded-lg bg-neutral-50 p-3 text-xs dark:bg-neutral-950/60"><strong>{t(scenario.id === 'reduced' ? 'Uso reducido' : scenario.id === 'expected' ? 'Uso esperado' : 'Uso intensivo')}</strong><p className="mt-1 text-neutral-500">{scenario.withinFreeTier ? t('Dentro del nivel gratuito') : tx('US${amount} / mes', { amount: scenario.estimatedUsdPerMonth.toFixed(2) })}</p></div>)}</div>}
          {expected && <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium">{t('Ver cálculo por servicio')}</summary><div className="mt-2 overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b border-neutral-200 dark:border-neutral-800"><th className="py-2 pr-3">{t('Servicio')}</th><th className="py-2 pr-3">{t('Uso esperado')}</th><th className="py-2 pr-3">{t('Nivel gratuito')}</th><th className="py-2">{t('Resultado')}</th></tr></thead><tbody>{expected.lines.map((line) => <tr key={`${line.service}:${line.metric}`} className="border-b border-neutral-100 dark:border-neutral-900"><td className="py-2 pr-3"><strong>{line.service}</strong><br /><span className="text-neutral-500">{t(line.metric)}</span></td><td className="py-2 pr-3 tabular-nums">{amount(line.amount)} {t(line.unit)}</td><td className="py-2 pr-3 tabular-nums">{line.freeAllowance === Number.MAX_SAFE_INTEGER ? t('Sin coste de salida') : `${amount(line.freeAllowance)} ${t(line.unit)}`}</td><td className={line.withinFreeAllowance ? 'py-2 text-emerald-700 dark:text-emerald-400' : 'py-2 text-amber-700 dark:text-amber-400'}>{line.withinFreeAllowance ? t('Sin coste') : tx('≈ US${amount}', { amount: line.estimatedUsd.toFixed(2) })}</td></tr>)}</tbody></table></div></details>}
          {state?.estimate?.catalogStale && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{t('El catálogo incluido puede estar desactualizado. Comprueba los enlaces oficiales antes de activar un plan.')}</p>}
          <div className="mt-2 flex flex-wrap gap-3 text-xs">{state?.estimate && [...new Set(state.estimate.scenarios[1].lines.map((line) => line.sourceUrl))].map((url) => <button key={url} className="text-indigo-600 underline dark:text-indigo-300" onClick={() => void window.nodus.openExternal(url)}>{tx('Precio oficial de {service}', { service: priceSourceName(url) })}</button>)}</div>
        </div>

        {existing ? (
          <div className="mt-5 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950/25">
            <div className="flex items-center gap-2 font-medium text-emerald-800 dark:text-emerald-300"><Icon name="check" />{t('Este vault ya utiliza su propio Nodus Cloud')}</div>
            <p className="mt-2 break-all text-xs text-neutral-600 dark:text-neutral-300">{existing.url}</p>
            <p className="mt-2 text-xs leading-5 text-neutral-500">{t('La infraestructura permanece en tu cuenta de Cloudflare. Nodus conserva únicamente la URL y la credencial privada de este vault.')}</p>
          </div>
        ) : !prepared ? (
          <div className="mt-5">
            <ol className="grid gap-2 text-sm sm:grid-cols-3">
              <li className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"><strong>1. Cloudflare</strong><br /><span className="text-neutral-500">{t('Inicia sesión o crea una cuenta gratuita.')}</span></li>
              <li className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"><strong>{t('2. GitHub o GitLab')}</strong><br /><span className="text-neutral-500">{t('Cloudflare guardará allí tu copia actualizable de Nodus Cloud.')}</span></li>
              <li className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"><strong>{t('3. Conectar')}</strong><br /><span className="text-neutral-500">{withCode(t('Pega aquí la URL workers.dev que recibas.'), 'workers.dev')}</span></li>
            </ol>
            <button className="btn btn-primary mt-4 w-full justify-center" disabled={busy || !state?.estimate} onClick={() => void prepare()}><Icon name={busy ? 'sync' : 'external'} className={busy ? 'animate-spin' : ''} />{t('Preparar mi despliegue')}</button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950/25">
              <h3 className="font-medium">{t('Paso 1 · Copia el código y abre Cloudflare')}</h3>
              <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-300">{withCode(t('En la pantalla de Cloudflare, conserva los nombres propuestos y pega este valor cuando te pida NODUS_BOOTSTRAP_SECRET_HASH. Después pulsa Deploy.'), 'NODUS_BOOTSTRAP_SECRET_HASH')}</p>
              <div className="mt-3 break-all rounded-lg bg-white p-3 font-mono text-xs dark:bg-neutral-950">{state?.setupCode}</div>
              <button className="btn btn-primary mt-3 w-full justify-center" onClick={() => void copyAndOpen()}><Icon name={copied ? 'check' : 'copy'} />{t(copied ? 'Código copiado · abrir Cloudflare otra vez' : 'Copiar código y abrir Cloudflare')}</button>
            </div>

            <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <h3 className="font-medium">{t('Paso 2 · Vuelve con la dirección de tu Worker')}</h3>
              <p className="mt-1 text-xs leading-5 text-neutral-500">{withCode(t('Cuando Cloudflare indique que terminó, copia la dirección que acaba en workers.dev. No pegues claves de API ni contraseñas de Cloudflare.'), 'workers.dev')}</p>
              <label className="mt-3 block text-sm"><span className="mb-1 block font-medium">{t('Dirección de Nodus Cloud')}</span><input className="input w-full" type="url" placeholder={t('https://nodus-cloud.tu-subdominio.workers.dev')} value={workerUrl} onChange={(event) => setWorkerUrl(event.target.value)} /></label>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-sm"><span className="mb-1 block font-medium">{t('Correo para administrar tu vault')}</span><input className="input w-full" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
                <label className="block text-sm"><span className="mb-1 block font-medium">{t('Contraseña nueva de Nodus Cloud')}</span><input className="input w-full" type="password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /><span className="mt-1 block text-xs text-neutral-500">{t('Mínimo 12 caracteres. No es tu contraseña de Cloudflare.')}</span></label>
              </div>
              <button className="btn btn-primary mt-4 w-full justify-center" disabled={busy || !/^https:\/\//i.test(workerUrl.trim()) || !/^\S+@\S+\.\S+$/.test(email) || password.length < 12} onClick={() => void connect()}><Icon name={busy ? 'sync' : 'upload'} className={busy ? 'animate-spin' : ''} />{t(busy ? 'Comprobando y publicando…' : 'Conectar y publicar el vault')}</button>
            </div>
          </div>
        )}

        {state?.steps.some((step) => step.state !== 'pending') && <div className="mt-5 space-y-1 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">{state.steps.map((step) => <div key={step.id} className="flex items-center gap-2 text-xs"><span className={step.state === 'complete' ? 'text-emerald-600' : step.state === 'error' || step.state === 'action-required' ? 'text-red-600' : step.state === 'running' ? 'text-indigo-600' : 'text-neutral-400'}>●</span><span>{t(step.label)}</span>{step.detail && <span className="truncate text-neutral-500">· {tr(step.detail)}</span>}</div>)}</div>}
        {(error || state?.error) && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error || tr(state?.error ?? '')}</p>}
        {state?.phase === 'complete' && <button className="btn btn-primary mt-4 w-full justify-center" onClick={onClose}><Icon name="check" />{t('Listo')}</button>}
        {state?.recoveryKey && <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30"><strong className="text-sm">{t('Guarda tu clave de recuperación')}</strong><p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">{t('Permite exportar el vault aunque olvides la contraseña. Nodus la conserva cifrada en este dispositivo, pero debes guardar otra copia fuera de él.')}</p><div className="mt-2 break-all rounded-lg bg-white p-3 font-mono text-xs dark:bg-neutral-950">{state.recoveryKey}</div><button className="btn btn-ghost mt-2 border border-neutral-300 dark:border-neutral-700" onClick={() => void navigator.clipboard.writeText(state.recoveryKey!)}><Icon name="copy" />{t('Copiar clave')}</button></div>}

        <p className="mt-4 text-xs leading-5 text-neutral-500">{t('Cloudflare y GitHub/GitLab gestionan directamente el despliegue. Los recursos usan la ubicación automática de Cloudflare. Nodus muestra una estimación, no una garantía de precio, y no interviene en la facturación.')}</p>
      </div>
    </div>
  );
}
