import type { ComponentProps } from 'react';
import { splitChatVisuals } from '@shared/chatSkills';
import { Markdown } from './Markdown';
import { ChatVisual } from './ChatVisual';
import { ChatCapabilityResult } from './ChatCapabilityResult';
import { ChatCapabilityArtifact } from './ChatCapabilityArtifact';
import { ChatCapabilityView } from './CapabilityView';
import { Icon } from './ui';
import { localizeRuntimeError } from '@shared/uiLanguage';
import { t, getActiveLang } from '../i18n';
import { useCapabilityFences } from '../lib/capabilityFences';

export function ChatMarkdown({ content, streaming = false, ...props }: ComponentProps<typeof Markdown> & { streaming?: boolean }) {
  const claims = useCapabilityFences();
  return <div className="chat-rich-answer">{splitChatVisuals(content, claims.fences).map((part, index) => {
    if (part.kind === 'capability-pending') {
      // A package that is still producing its answer names itself, in its own words.
      const label = part.fence ? claims.label(part.fence) : undefined;
      return <div key={index} role="status" className="chat-visual-pending"><Icon name="sparkles" size={22} /><div><b>{label?.title ?? 'Capability'}</b><span>{streaming ? (label?.pending ?? t('Cargando…')) : t('La generación se interrumpió. Vuelve a intentarlo.')}</span></div>{streaming && <span className="chat-visual-pulse" />}</div>;
    }
    if (part.kind === 'image-error') {
      let message = 'Image generation failed. Please retry.';
      try { message = JSON.parse(part.content).message || message; } catch { /* incomplete failure record */ }
      return <div key={index} className="chat-visual-error" role="alert">{localizeRuntimeError(message, getActiveLang())}</div>;
    }
    if (part.kind === 'markdown') return <Markdown key={index} {...props} content={part.content} chatVisuals />;
    if (part.kind === 'capability-artifact' && part.complete && !streaming) return <ChatCapabilityArtifact key={index} source={part.content} />;
    if (part.kind === 'capability-view' && part.complete && !streaming) return <ChatCapabilityView key={index} source={part.content} />;
    if (part.kind === 'capability-artifact' || part.kind === 'capability-view') return <div key={index} role="status" className="chat-visual-pending"><Icon name="sparkles" size={22} /><div><b>Capability</b><span>{streaming ? t('Cargando…') : t('La generación se interrumpió. Vuelve a intentarlo.')}</span></div></div>;
    if (part.kind === 'capability-result' && part.complete && !streaming) return <ChatCapabilityResult key={index} source={part.content} />;
    if (part.kind === 'capability-request' || part.kind === 'capability-result') return <div key={index} role="status" className="chat-visual-pending"><Icon name="sparkles" size={22} /><div><b>Capability</b><span>{streaming ? t('Cargando…') : t('La generación se interrumpió. Vuelve a intentarlo.')}</span></div></div>;
    if (part.kind === 'svg' && part.complete && !streaming) return <ChatVisual key={index} svg={part.content} />;
    return <div className="chat-visual-pending" role="status" key={index}><Icon name={part.kind === 'image-request' ? 'image' : 'code'} size={22} /><div><b>{part.kind === 'svg' ? 'SVG Studio' : 'Image Atelier'}</b><span>{streaming ? (part.kind === 'svg' ? t('Dibujando tu visual…') : t('Creando tu imagen…')) : t('La generación se interrumpió. Vuelve a intentarlo.')}</span></div>{streaming && <span className="chat-visual-pulse" />}</div>;
  })}</div>;
}
