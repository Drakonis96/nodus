import { useEffect, useState } from 'react';
import { ALPHAGENOME_NOTICE, ALPHAGENOME_OUTPUT_TERMS, genomicsTrackSvg, validateGenomicsResult, type GenomicsResult } from '@shared/genomics';
import { ChatVisual } from './ChatVisual';
import { t } from '../i18n';

export function ChatGenomicsResult({ source }: { source: string }) {
  const [result, setResult] = useState<GenomicsResult | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let current = true; setResult(null); setError(false);
    void window.nodus.getGenomicsResult(source).then(r => { if (!r) throw new Error(); const validated = validateGenomicsResult(r); if (current) setResult(validated); }).catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [source]);
  if (error) return <p role="alert">{t('El resultado de AlphaGenome no está disponible en este dispositivo.')}</p>;
  if (!result) return <p role="status">{t('Cargando resultado local…')}</p>;
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'alphagenome-result-with-terms.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section aria-label="AlphaGenome" className="space-y-3">
    <p><b>Google DeepMind AlphaGenome</b> · {t('Predicción de investigación; no apta para uso clínico.')}</p>
    <p>{t('Contexto de 16 kb. El alelo REF aportado no se contrasta de forma independiente con GRCh38.')}</p>
    <p>{result.tracks.length} / {result.totalTracks} {t('señales mostradas')}</p>
    {result.tracks.map((track, i) => <ChatVisual key={i} svg={genomicsTrackSvg(result, i)} alt={track.name} kindLabel="AlphaGenome" provenanceLabel={t('Predicción de AlphaGenome')} />)}
    <p>{t('Modificaciones: selección de hasta ocho señales, promedio de intervalos y visualización local. Los valores no son probabilidades clínicas.')}</p>
    <p>{ALPHAGENOME_NOTICE}. <a href={ALPHAGENOME_OUTPUT_TERMS} target="_blank" rel="noreferrer">{t('Términos de los resultados')}</a></p>
    <p><a href="https://doi.org/10.1038/s41586-025-10014-0" target="_blank" rel="noreferrer">Avsec et al. (2026), Nature 649, 1206–1218</a></p>
    <button type="button" className="btn btn-secondary text-xs" onClick={download}>{t('Descargar predicción y avisos (JSON)')}</button>
  </section>;
}
