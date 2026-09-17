import { useState } from 'react';
import { t } from '../i18n';

/** A one-click follow-up the app offers when the route check refused a step: clicking it
 *  sends the exact correction request the checker wrote, as if the user had typed it. The
 *  model only proposes; the reply is re-checked and re-drawn by the same deterministic path. */
export function RouteFixPrompt({ content }: { content: string }) {
  const [sent, setSent] = useState(false);
  let label = t('Ask the model to fix the failed steps');
  let prompt = '';
  try {
    const value = JSON.parse(content) as { label?: unknown; prompt?: unknown };
    if (typeof value?.prompt === 'string') prompt = value.prompt;
    if (typeof value?.label === 'string') label = value.label;
  } catch { return null; }
  if (!prompt) return null;
  return <p className="chat-route-fix">
    <button
      type="button"
      className="suggestion-chip"
      disabled={sent}
      onClick={() => { setSent(true); window.dispatchEvent(new CustomEvent('nodus:route-fix', { detail: { prompt } })); }}
    >{sent ? t('Sent') : label}</button>
  </p>;
}
