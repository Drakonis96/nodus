import type { ComponentProps } from 'react';
import { splitChatVisuals } from '@shared/chatSkills';
import { Markdown } from './Markdown';
import { ChatVisual } from './ChatVisual';
import { ChatFormula } from './ChatFormula';
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
    if ((part.kind === 'smiles' || part.kind === 'chemfig' || part.kind === 'lewis') && part.complete && !streaming) return <ChatFormula key={index} kind={part.kind} source={part.content} />;
    const chemistry = part.kind === 'smiles' || part.kind === 'chemfig' || part.kind === 'lewis';
    return <div className="chat-visual-pending" role="status" key={index}><Icon name={part.kind === 'image-request' ? 'image' : 'code'} size={22} /><div><b>{chemistry ? 'Chemistry Studio' : part.kind === 'svg' ? 'SVG Studio' : 'Image Atelier'}</b><span>{streaming ? (chemistry ? t('Dibujando tu estructura…') : part.kind === 'svg' ? t('Dibujando tu visual…') : t('Creando tu imagen…')) : t('La generación se interrumpió. Vuelve a intentarlo.')}</span></div>{streaming && <span className="chat-visual-pulse" />}</div>;
  })}</div>;
}
