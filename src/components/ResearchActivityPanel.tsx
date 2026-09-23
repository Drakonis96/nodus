import { useEffect, useRef, useState } from 'react';
import type { ResearchActivity, ResearchActivityLayer, ResearchActivityOperation, ResearchActivityStatus } from '@shared/researchActivity';
import { Icon } from './ui';
import { t, tx } from '../i18n';
import nodusMark from '../assets/nodus-logo-violet.svg';
import zoteroMark from '../assets/brands/zotero.svg';
import './researchActivity.css';

const layers: Record<ResearchActivityLayer, [string, string]> = {
  scope: ['Fuentes autorizadas', 'filter'], ideas: ['Ideas', 'bulb'],
  profiles: ['Perfiles documentales', 'fileText'], nodus: ['Biblioteca Nodus', 'book'],
  zotero: ['Zotero', 'book'], context: ['Contexto documental', 'layers'],
  graph: ['Grafo', 'share'], attachments: ['Archivos adjuntos', 'copyText'],
  response: ['Respuesta', 'edit'], tools: ['Herramientas', 'settings'],
};
const operations: Record<ResearchActivityOperation, string> = {
  resolve: 'Delimitar fuentes', embed: 'Preparar búsqueda', lexical: 'Búsqueda léxica',
  semantic: 'Búsqueda semántica', search: 'Buscar en obras', expand: 'Ampliar pasajes',
  pages: 'Leer páginas', references: 'Consultar referencias', metadata: 'Consultar ficha',
  fulltext: 'Leer texto completo', read: 'Consultar contenido', write: 'Redactar respuesta',
  citations: 'Comprobar citas', execute: 'Ejecutar herramientas',
};
const statuses: Record<ResearchActivityStatus, string> = { active: 'En curso', completed: 'Completado', failed: 'Error', cancelled: 'Cancelado' };

function LayerIcon({ layer }: { layer: ResearchActivityLayer }) {
  if (layer === 'nodus' || layer === 'zotero') return <img src={layer === 'nodus' ? nodusMark : zoteroMark} alt="" className={`research-activity-brand ${layer}`} />;
  return <Icon name={layers[layer][1]} size={17} />;
}

export function ResearchActivityPanel({ activities, outcome, onDismiss }: { activities: ResearchActivity[]; outcome: ResearchActivityStatus; onDismiss?: () => void }) {
  const [minimized, setMinimized] = useState(() => localStorage.getItem('nodus.researchActivityMinimized') === '1');
  const [dismissed, setDismissed] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const followRef = useRef(true);
  const active = activities.filter(item => item.status === 'active');
  const current = active.at(-1) ?? activities.at(-1);
  const toggle = () => {
    setMinimized(value => { localStorage.setItem('nodus.researchActivityMinimized', value ? '0' : '1'); return !value; });
    requestAnimationFrame(() => toggleRef.current?.focus());
  };
  useEffect(() => {
    if (minimized || !listRef.current) return;
    const list = listRef.current;
    const follow = () => { if (followRef.current) list.scrollTop = list.scrollHeight; };
    follow();
    const resize = new ResizeObserver(follow);
    resize.observe(list);
    return () => resize.disconnect();
  }, [activities, minimized]);
  if (dismissed || !activities.length) return null;
  const status = outcome === 'active' ? tx('{n} operaciones activas', { n: active.length }) : t(statuses[outcome]);
  const announcement = `${status}${current ? ` · ${t(layers[current.layer][0])} · ${t(operations[current.operation])}` : ''}`;
  return <section className={`research-activity ${minimized ? 'is-minimized' : ''}`} aria-label={t('Actividad del Research chat')} data-testid="research-activity" onKeyDown={event => {
    if (event.key === 'Escape' && !minimized) { event.stopPropagation(); toggle(); }
  }}>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    {minimized ? <button ref={toggleRef} className="research-activity-orb" onClick={toggle} aria-label={t('Ampliar actividad')} aria-expanded={false} title={announcement}>
      <span aria-hidden="true">{current ? <LayerIcon layer={current.layer} /> : <Icon name="layers" />}</span>
      <span className={`research-activity-indicator ${outcome}`} aria-hidden="true" />
    </button> : <>
      <header><div><h2>{t('Actividad del Research chat')}</h2><p>{status}</p></div>
        <button ref={toggleRef} onClick={toggle} aria-label={t('Minimizar actividad')} aria-expanded={true} title={t('Minimizar actividad')}><Icon name="minus" size={16} /></button>
        {outcome !== 'active' && <button onClick={() => { setDismissed(true); onDismiss?.(); }} aria-label={t('Cerrar actividad')} title={t('Cerrar actividad')}><Icon name="x" size={16} /></button>}
      </header>
      <ol ref={listRef} onScroll={() => { const list = listRef.current; if (list) followRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 28; }}>
        {activities.map(item => <li key={item.id} data-status={item.status} data-layer={item.layer}>
          <span className="research-activity-icon" aria-hidden="true"><LayerIcon layer={item.layer} /></span>
          <div className="research-activity-copy"><div><strong>{t(layers[item.layer][0])}</strong><span className="research-activity-state">{t(statuses[item.status])}</span></div>
            <p>{t(operations[item.operation])}{item.count !== undefined && <span> · {item.count}</span>}</p>
            {item.subject && <small title={item.subject}>{item.subject}</small>}
          </div>
          <span className={`research-activity-indicator ${item.status}`} aria-hidden="true" />
        </li>)}
      </ol>
    </>}
  </section>;
}
