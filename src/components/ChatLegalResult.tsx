import { LEGALIZE_COUNTRIES, exportLegalText, legalAttribution, legalRepositoryUrl, validateLegalResult } from '@shared/legalize';
import { t } from '../i18n';

export function ChatLegalResult({ source }: { source: string }) {
  let result;
  try { result = validateLegalResult(source); } catch { return <p role="alert">{t('No se pudo mostrar el resultado legal.')}</p>; }
  const c = LEGALIZE_COUNTRIES.find(c => c.code === result.country)!;
  const d = result.document;
  const download = () => {
    const url = URL.createObjectURL(new Blob([exportLegalText(result)], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `legalize-${c.code}-${(d?.id || 'resultados').replace(/[^a-zA-Z0-9_-]/g, '_')}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section aria-label="Legalize" className="space-y-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
    <h3 className="font-semibold">Legalize · {c.name}</h3>
    {d ? <><h4 className="font-medium">{d.title}</h4><p><a href={d.source} target="_blank" rel="noreferrer">{t('Fuente oficial')}</a> · <a href={legalRepositoryUrl(c.code, result.revision, d.path)} target="_blank" rel="noreferrer">{c.repo} · {result.revision.slice(0, 12)}</a></p><div className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words text-sm leading-7" data-testid="legalize-source-text">{d.text}</div><details><summary>{t('Metadatos originales')}</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{d.metadata}</pre></details></>
      : <><p>{result.totalMatches} {t('coincidencias en el catálogo consultado.')}</p>{result.matches.map(m => <p key={m.path}><a href={legalRepositoryUrl(c.code, result.revision, m.path)} target="_blank" rel="noreferrer">{m.title}</a><br /><code>{m.id}</code></p>)}<p className="text-sm">{t('Para leer una norma, indica su identificador y el país. La ausencia de resultados no demuestra que no exista.')}</p></>}
    <details><summary>{t('Fuentes, licencias y versión')}</summary><p className="whitespace-pre-wrap break-words text-xs leading-6">{legalAttribution(result)}</p></details>
    <p className="text-xs leading-6">{t('Reproducción no oficial. Comprueba la vigencia en la fuente oficial.')}{c.code === 'es' && <> Basado en datos de la <a href="https://www.boe.es" target="_blank" rel="noreferrer">Agencia Estatal Boletín Oficial del Estado</a>. Texto consolidado de carácter meramente informativo.</>} {c.attribution && c.code !== 'es' && c.attribution}</p>
    <p className="text-xs">{c.sourceName} · <a href={c.termsUrl} target="_blank" rel="noreferrer">{t('Licencia de los datos')}</a> · {d?.lastUpdated} · <a href="https://github.com/legalize-dev" target="_blank" rel="noreferrer">legalize-dev</a> / <a href="https://enriquelopez.eu" target="_blank" rel="noreferrer">Enrique López</a></p>
    <button className="btn-secondary text-sm" onClick={download}>{t('Descargar texto con atribuciones')}</button>
  </section>;
}
