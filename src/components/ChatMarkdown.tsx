import type { ComponentProps } from 'react';
import { splitChatVisuals } from '@shared/chatSkills';
import { Markdown } from './Markdown';
import { ChatVisual } from './ChatVisual';
import { Icon } from './ui';
import { localizeRuntimeError } from '@shared/uiLanguage';
import { t, getActiveLang } from '../i18n';

export function ChatMarkdown({ content, streaming = false, ...props }: ComponentProps<typeof Markdown> & { streaming?: boolean }) {
  return <div className="chat-rich-answer">{splitChatVisuals(content).map((part, index) => {
    if (part.kind === 'image-error') {
      let message = 'Image generation failed. Please retry.';
      try { message = JSON.parse(part.content).message || message; } catch { /* incomplete failure record */ }
      return <div key={index} className="chat-visual-error" role="alert">{localizeRuntimeError(message, getActiveLang())}</div>;
    }
    if (part.kind === 'markdown') return <Markdown key={index} {...props} content={part.content} chatVisuals />;
    if (part.kind === 'svg' && part.complete && !streaming) return <ChatVisual key={index} svg={part.content} />;
    return <div className="chat-visual-pending" role="status" key={index}><Icon name={part.kind === 'svg' ? 'code' : 'image'} size={22} /><div><b>{part.kind === 'svg' ? 'SVG Studio' : 'Image Atelier'}</b><span>{streaming ? (part.kind === 'svg' ? t('Dibujando tu visual…') : t('Creando tu imagen…')) : t('La generación se interrumpió. Vuelve a intentarlo.')}</span></div>{streaming && <span className="chat-visual-pulse" />}</div>;
  })}</div>;
}
