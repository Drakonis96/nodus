import { useEffect, useState } from 'react';
import type { LegacyResultRenderResult } from '@shared/capabilities';
import { CapabilityView } from './CapabilityView';
import { Icon } from './ui';
import { t, getActiveLang } from '../i18n';

/** A result an earlier release wrote into the conversation.
 *
 *  The block is never rewritten and the file beside it is never converted: the package
 *  that now owns the discipline is asked to render what is there. With no package
 *  installed the message says what it was and why it cannot be drawn, which is honest —
 *  and is not the "still working" placeholder a finished answer must never show. */
export function ChatLegacyResult({ fence, source }: { fence: string; source: string }) {
  const [result, setResult] = useState<LegacyResultRenderResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setResult(null);
    setError(null);
    void window.nodus.renderLegacyCapabilityResult(fence, source, getActiveLang())
      .then(value => { if (current) setResult(value); })
      .catch(problem => { if (current) setError(problem instanceof Error ? problem.message : String(problem)); });
    return () => { current = false; };
  }, [fence, source]);

  if (error) return <p role="alert" className="chat-visual-error">{t('Este resultado guardado no se pudo abrir.')}</p>;
  if (!result) return <p role="status" className="chat-visual-pending"><Icon name="sparkles" size={22} />{t('Cargando resultado local…')}</p>;
  if (!result.available) {
    return <div role="note" className="chat-visual-error">
      <b>{fence}</b>
      <span>{t('Este resultado lo creó una función que ahora vive en un paquete. Instálalo para volver a verlo.')}</span>
    </div>;
  }
  return <section className="chat-visual chat-capability-result">
    <span className="chat-visual-head">
      <span className="chat-visual-kind"><Icon name="sparkles" size={13} />{result.capabilityId}</span>
      {result.pluginId && <span className="chat-visual-original">{result.pluginId}</span>}
    </span>
    <CapabilityView view={result.view} />
  </section>;
}
