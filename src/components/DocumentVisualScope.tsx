import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DocumentFigure as Figure, DocumentVisualManifest, DocumentVisualTarget } from '@shared/documentSkills';
import { documentBlocks } from '@shared/documentSkills';
import { readyDocumentFigures } from '@shared/documentFigureExport';
import { DocumentSkillsControl, useDocumentSkills } from './DocumentSkillsControl';
import { CapabilityView } from './CapabilityView';
import { t } from '../i18n';
import './documentFigures.css';
import type { ViewNode } from '@shared/capabilities';
import { Icon } from './ui';

const Context = createContext<{ manifest: DocumentVisualManifest | null; target: DocumentVisualTarget; refresh: () => void } | null>(null);
export function DocumentVisualScope({ target, children, enabled = true, initialManifest }: { target: DocumentVisualTarget; children: ReactNode; enabled?: boolean; initialManifest?: DocumentVisualManifest }) {
  const [manifest, setManifest] = useState<DocumentVisualManifest | null>(initialManifest ?? null);
  const serial = useRef(0);
  const refresh = () => { const request = ++serial.current; if (enabled && !initialManifest) void window.nodus.getDocumentVisuals(target).then(value => { if (request === serial.current) setManifest(value); }).catch(() => { if (request === serial.current) setManifest(null); }); };
  useEffect(() => {
    if (initialManifest) { setManifest(initialManifest); return; }
    setManifest(null); refresh();
    if (!enabled) return;
    const off = window.nodus.onDocumentVisualsChanged(changed => { if (changed.kind === target.kind && changed.id === target.id) refresh(); });
    return () => { serial.current++; off(); };
  }, [target.id, target.kind, enabled, initialManifest]);
  return <Context.Provider value={enabled ? { manifest, target, refresh } : null}>{children}</Context.Provider>;
}

export function useDocumentFigures(content: string) {
  const context = useContext(Context);
  const manifest = context?.manifest;
  if (!manifest) return [];
  const canonical = documentBlocks({ text: content }).map(block => block.markdown).join('\n\n');
  const fields = [...new Set(manifest.blocks.map(block => block.field))];
  const field = fields.find(field => manifest.blocks.filter(block => block.field === field).map(block => block.markdown).join('\n\n') === canonical);
  if (!field) return [];
  const ready = readyDocumentFigures(manifest);
  return ready.filter(figure => manifest.blocks.some(block => block.id === figure.blockId && block.field === field)).map(figure => ({ figure, number: ready.indexOf(figure)+1, block: manifest.blocks.find(block => block.id === figure.blockId)! }));
}

export function DocumentVisualFigures({ field }: { field: string }) {
  const context = useContext(Context);
  const ready = readyDocumentFigures(context?.manifest);
  return <>{ready.filter(figure => context?.manifest?.blocks.some(block => block.id === figure.blockId && block.field === field)).map(figure => <DocumentFigure key={figure.id} figure={figure} number={ready.indexOf(figure)+1} />)}</>;
}

export function DocumentFigure({ figure, number, onSource }: { figure: Figure; number: number; onSource?: (source: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const context = useContext(Context);
  const flatten = (nodes: ViewNode[]): ViewNode[] => nodes.flatMap(node => node.kind === 'details' ? flatten(node.children) : [node]);
  const originals = flatten(figure.view?.nodes ?? []).filter(node => node.kind === 'svg' || node.kind === 'model' || node.kind === 'image');
  const download = (node: ViewNode) => {
    if (node.kind === 'svg') {
      const url = URL.createObjectURL(new Blob([node.svg], { type: 'image/svg+xml' }));
      const link = document.createElement('a'); link.href = url; link.download = `figure-${number}.svg`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else if ('attachmentId' in node && figure.owner) void window.nodus.downloadCapabilityFile(`nodus-capability://chat/${figure.owner}/${node.attachmentId}`);
  };
  return <figure className="document-figure" data-layout={figure.layout} data-reader-ignore="true" data-figure-id={figure.id}>
    <button type="button" className="document-figure-preview" onClick={() => setExpanded(!expanded)} aria-label={t('Ampliar imagen')} aria-expanded={expanded}>
      <img src={figure.poster} alt={figure.caption} />
    </button>
    <figcaption><strong>{t('Figura')} {number}.</strong>{figure.caption}{figure.sources.map((source, index) => <a key={source} href={source} onClick={event => { event.preventDefault(); onSource?.(source); }}> [{index + 1}]</a>)}</figcaption>
    {expanded && figure.view && <div className="document-figure-detail"><CapabilityView view={figure.view} owner={figure.owner} presentation="document" /></div>}
    {expanded && <div className="document-figure-actions"><button type="button" onClick={() => { const link = document.createElement('a'); link.href = figure.poster!; link.download = `figure-${number}.png`; link.click(); }}>{t('Descargar')} PNG</button>{originals.map((node,index) => <button key={index} type="button" onClick={() => download(node)}>{t('Descargar')} {node.kind === 'svg' ? 'SVG' : 'name' in node ? node.name : ''}</button>)}{context && <button type="button" onClick={() => void window.nodus.removeDocumentFigure(context.target, figure.id).then(context.refresh)}>{t('Retirar figura')}</button>}</div>}
  </figure>;
}

export function DocumentVisualActions() {
  const context = useContext(Context), config = useDocumentSkills();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!context) return null;
  const { target, manifest, refresh } = context;
  const running = busy || manifest?.state === 'planning' || manifest?.state === 'generating';
  const run = async (retry = false) => {
    if (!config.valid && !retry) return;
    setBusy(true); setOpen(false); setError('');
    try { await window.nodus.enrichDocumentVisuals(target, retry && manifest ? manifest.policy : config.policy, retry); refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="document-visual-actions" data-reader-ignore="true">
    <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700 text-xs" aria-label={t('Añadir recursos visuales')} title={t('Añadir recursos visuales')} disabled={running} onClick={() => { if (manifest) config.setPolicy(manifest.policy); setOpen(true); }}><Icon name="sparkles" size={16} /></button>
    {running && <button className="btn btn-ghost text-xs" onClick={() => void window.nodus.cancelDocumentVisuals(target)}>{t('Cancelar')}</button>}
    {manifest && !running && <button className="btn btn-ghost text-xs" aria-label={t('Deshacer enriquecimiento')} title={t('Deshacer enriquecimiento')} onClick={() => void window.nodus.undoDocumentVisuals(target).then(refresh)}><Icon name="undo" size={16} /></button>}
    {manifest && ['partial', 'failed', 'cancelled'].includes(manifest.state) && !running && <button className="btn btn-ghost text-xs" onClick={() => void run(true)}>{t('Reintentar')}</button>}
    {running && <span className="text-xs text-neutral-500">{t('Preparando recursos visuales…')}</span>}
    {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
    {manifest?.state === 'ready' && !manifest.figures.length && <p className="text-xs text-neutral-500" role="status">{t('No se añadieron figuras: no eran necesarias.')}</p>}
    {manifest && !running && ['partial','failed','cancelled'].includes(manifest.state) && <details className="text-xs text-neutral-500"><summary>{t('Algunos recursos no se pudieron generar.')}</summary>{manifest.error && <p>{manifest.error}</p>}{manifest.figures.filter(figure => figure.error).map(figure => <p key={figure.id}>{figure.caption}: {figure.error}</p>)}</details>}
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={() => setOpen(false)}><section className="w-full max-w-xl rounded-xl bg-white dark:bg-neutral-950 p-5 max-h-[90vh] overflow-auto" role="dialog" aria-modal="true" aria-label={t('Añadir recursos visuales')} onMouseDown={event => event.stopPropagation()}>
      <h2 className="font-semibold mb-3">{t('Añadir recursos visuales')}</h2>
      <DocumentSkillsControl value={config.policy} onChange={config.setPolicy} onValidityChange={config.setValid} />
      <p className="text-xs text-neutral-500 mt-3">{t('El texto está guardado. Los recursos visuales son opcionales.')}</p>
      <footer className="flex justify-end gap-2 mt-4"><button className="btn btn-ghost" onClick={() => setOpen(false)}>{t('Cancelar')}</button><button className="btn btn-primary" disabled={!config.valid} onClick={() => void run()}>{t('Añadir recursos visuales')}</button></footer>
    </section></div>}
  </div>;
}
