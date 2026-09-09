import { ChatLegalResult } from './ChatLegalResult';
import type { ComponentProps } from 'react';
import { splitChatVisuals } from '@shared/chatSkills';
import { Markdown } from './Markdown';
import { ChatVisual } from './ChatVisual';
import { ChatFormula } from './ChatFormula';
import { ChatChemistryDocument } from './ChatChemistryDocument';
import { ChatGenomicsResult } from './ChatGenomicsResult';
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
    if (part.kind === 'legal-result' && part.complete && !streaming) return <ChatLegalResult key={index} source={part.content} />;
    if (part.kind === 'legal-plan' || part.kind === 'legal-result') return <div key={index} role="status" className="chat-visual-pending"><b>Legalize</b><span>{streaming ? t('Consultando legislación…') : t('La generación se interrumpió. Vuelve a intentarlo.')}</span></div>;
    if (part.kind === 'genomics-result' && part.complete && !streaming) return <ChatGenomicsResult key={index} source={part.content} />;
    if (part.kind === 'genomics-plan' || part.kind === 'genomics-result') return <div key={index} role="status" className="chat-visual-pending"><b>AlphaGenome</b><span>{streaming ? t('Consultando AlphaGenome…') : t('La generación se interrumpió. Vuelve a intentarlo.')}</span></div>;
    if (part.kind === 'svg' && part.complete && !streaming) return <ChatVisual key={index} svg={part.content} />;
    if (part.kind === 'chemistry-document' && part.complete && !streaming) return <ChatChemistryDocument key={index} source={part.content} />;
    if ((part.kind === 'smiles' || part.kind === 'chemfig' || part.kind === 'lewis') && part.complete && !streaming) return <ChatFormula key={index} kind={part.kind} source={part.content} />;
    const chemistry = ['smiles', 'chemfig', 'lewis', 'chemistry-plan', 'chemistry-document'].includes(part.kind);
    return <div className="chat-visual-pending" role="status" key={index}><Icon name={part.kind === 'image-request' ? 'image' : 'code'} size={22} /><div><b>{chemistry ? 'Chemistry Studio' : part.kind === 'svg' ? 'SVG Studio' : 'Image Atelier'}</b><span>{streaming ? (chemistry ? t('Dibujando tu estructura…') : part.kind === 'svg' ? t('Dibujando tu visual…') : t('Creando tu imagen…')) : t('La generación se interrumpió. Vuelve a intentarlo.')}</span></div>{streaming && <span className="chat-visual-pulse" />}</div>;
  })}</div>;
}
