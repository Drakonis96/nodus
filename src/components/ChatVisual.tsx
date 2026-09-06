import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui';
import { sanitizeChatSvg, svgImageUrl } from '../lib/chatSvg';
import { t } from '../i18n';
import './chatVisuals.css';

export function ChatVisual({ svg, source, alt = '' }: { svg?: string; source?: string; alt?: string }) {
  const sanitized = useMemo(() => svg ? sanitizeChatSvg(svg) : null, [svg]);
  const src = useMemo(() => sanitized ? svgImageUrl(sanitized.svg) : source, [sanitized, source]);
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState(false);
  const [meta, setMeta] = useState<Record<string, string> | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const dialogRef = useRef<HTMLDivElement>(null);
  const title = meta?.title || sanitized?.title || alt || 'Image Atelier';
  useEffect(() => {
    setMeta(null); setError(''); setStatus(''); setDetails(false); setExpanded(false);
    if (!source) return;
    let active = true;
    void window.nodus.getChatImageMetadata(source).then(value => { if (active) setMeta(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [source, svg]);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopImmediatePropagation(); setExpanded(false); }
      if (event.key === 'Tab') {
        const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        if (!buttons?.length) return;
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => { window.removeEventListener('keydown', handler, true); previous?.focus(); };
  }, [expanded]);
  const act = async (fn: () => Promise<unknown>, success = '') => {
    setError(''); setStatus('');
    try { await fn(); setStatus(success); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const copy = () => act(async () => {
    if (source) return window.nodus.copyChatImage(source);
    if (!src) return;
    const image = new Image(); image.src = src;
    await image.decode();
    const canvas = document.createElement('canvas');
    const ratio = Math.min(2, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, image.naturalWidth * ratio); canvas.height = Math.max(1, image.naturalHeight * ratio);
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error(t('No se pudo copiar la imagen.'))), 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }, t('Copiado'));
  const download = () => act(async () => {
    if (source) return window.nodus.downloadOriginalImage(source, title);
    if (!sanitized || !src) return;
    const link = document.createElement('a'); link.href = src;
    link.download = `${title.replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 80) || 'diagram'}.svg`;
    link.click();
  });
  if (!src || (svg && !sanitized)) return <div className="chat-visual-error" role="status">{t('No se pudo mostrar el SVG.')}<details><summary>{t('Ver código')}</summary><pre>{svg}</pre></details></div>;
  const toolbar = <div className="chat-visual-actions">
    <button type="button" onClick={() => void copy()} title={t('Copiar imagen')} aria-label={t('Copiar imagen')}><Icon name="copy" size={15} /></button>
    <button type="button" onClick={() => void download()} title={t('Descargar')} aria-label={t('Descargar')}><Icon name="download" size={15} /></button>
    <button type="button" onClick={() => setDetails(value => !value)} title={sanitized ? t('Ver código') : t('Ver prompt')} aria-label={sanitized ? t('Ver código') : t('Ver prompt')}><Icon name={sanitized ? 'code' : 'fileText'} size={15} /></button>
  </div>;
  const feedback = <>{status && <span className="chat-visual-feedback" role="status">{status}</span>}{error && <span className="chat-visual-error" role="alert">{error}</span>}</>;
  const detail = details && <div className="chat-visual-details"><div><b>{sanitized ? 'SVG' : `${meta?.provider ?? ''} · ${meta?.model ?? ''}`}</b><button type="button" onClick={() => void act(() => navigator.clipboard.writeText(sanitized?.svg ?? meta?.prompt ?? ''), t('Copiado'))}>{t('Copiar texto')}</button></div><pre>{sanitized?.svg ?? meta?.prompt ?? t('Cargando…')}</pre></div>;
  return <div className="chat-visual" data-testid={svg ? 'chat-svg' : 'chat-image'}>
    <span className="chat-visual-head"><span className="chat-visual-kind"><Icon name={svg ? 'code' : 'image'} size={13} />{svg ? 'SVG Studio' : 'Image Atelier'}</span><span className="chat-visual-original">{t('Creación original')}</span></span>
    <button type="button" className="chat-visual-preview" onClick={() => { setExpanded(true); setZoom(1); }} aria-label={t('Ampliar imagen')}><img src={src} alt={alt || title} onError={() => setError(t('La imagen ya no está disponible.'))} /><span className="chat-visual-expand"><Icon name="fit" size={15} /></span></button>
    <span className="chat-visual-foot"><span className="chat-visual-title">{title}</span>{toolbar}</span>
    {!expanded && <>{feedback}{detail}</>}
    {expanded && createPortal(<div className="chat-visual-modal" data-nodi-interactive role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={dialogRef}>
      <header><div><small>{svg ? 'SVG Studio' : 'Image Atelier'}</small><strong>{title}</strong></div>{toolbar}<button type="button" onClick={() => setExpanded(false)} aria-label={t('Cerrar')}><Icon name="x" size={20} /></button></header>
      <div className="chat-visual-canvas"><img src={src} alt={alt || title} style={{ width: `${zoom * 100}%`, maxWidth: 'none', height: zoom === 1 ? '100%' : 'auto' }} /></div>
      <footer><button type="button" onClick={() => setZoom(value => Math.max(1, value - .5))} disabled={zoom === 1} aria-label={t('Reducir')}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom(value => Math.min(4, value + .5))} disabled={zoom === 4} aria-label={t('Ampliar')}>+</button>{feedback}</footer>{detail}
    </div>, document.body)}
  </div>;
}
