import { useEffect, useState } from 'react';
import { ChatVisual } from './ChatVisual';
import { Icon } from './ui';
import { t } from '../i18n';

const UI_TIMEOUT_MS = 30_000;

/** Compile explicit SMILES or Chemfig output through the local deterministic
 * chemistry renderer, then reuse the normal sanitized SVG viewer. */
export function ChatFormula({ source, kind }: { source: string; kind: 'smiles' | 'chemfig' | 'lewis' }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setSvg(null); setError('');
    const compile = kind === 'smiles' ? window.nodus?.compileSmiles
      : kind === 'lewis' ? window.nodus?.compileLewis : window.nodus?.compileChemfig;
    if (typeof compile !== 'function') {
      setError('Chemistry Studio is unavailable. Restart Nodus after rebuilding the main process.');
      return () => { active = false; };
    }
    const timer = setTimeout(() => {
      if (active) setError('The chemistry renderer timed out.');
    }, UI_TIMEOUT_MS);
    Promise.resolve().then(() => compile(source))
      .then(result => { if (active) setSvg(result); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); };
  }, [kind, source]);

  if (error) return <div className="chat-visual-error" role="alert">
    {t('No se pudo representar la estructura química.')}
    <details><summary>{t('Ver código')}</summary><pre>{source}{'\n\n'}{error}</pre></details>
  </div>;
  if (!svg) return <div className="chat-visual-pending" role="status">
    <Icon name="code" size={22} />
    <div><b>Chemistry Studio</b><span>{t('Dibujando tu estructura…')}</span></div>
    <span className="chat-visual-pulse" />
  </div>;
  return <ChatVisual svg={svg} alt="Chemical structure" kindLabel="Chemistry Studio" />;
}
