import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DocumentVisualManifest, DocumentVisualTarget } from '@shared/documentSkills';
import { DocumentSkillsControl, useDocumentSkills } from './DocumentSkillsControl';
import { t } from '../i18n';
import './documentFigures.css';
import { Icon } from './ui';
import { DocumentFigureContext as Context } from './DocumentFigures';
export { DocumentFigure, DocumentVisualFigures, useDocumentFigures } from './DocumentFigures';

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
  return <Context.Provider value={enabled ? { manifest, target, refresh, removeFigure: id => void window.nodus.removeDocumentFigure(target, id).then(refresh) } : null}>{children}</Context.Provider>;
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
