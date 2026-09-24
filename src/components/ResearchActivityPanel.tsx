import { useMemo, useRef, useState } from 'react';
import { summarizeResearchActivity, type ResearchActivity, type ResearchActivityLayer, type ResearchActivityLayerState, type ResearchActivityOperation, type ResearchActivityStatus } from '@shared/researchActivity';
import { Icon } from './ui';
import { t, tx } from '../i18n';
import nodusMark from '../assets/nodus-logo-violet.svg';
import zoteroMark from '../assets/nodus-logo-zotero.svg';
import './researchActivity.css';

const layers: Record<ResearchActivityLayer, [string, string]> = {
  scope: ['Fuentes autorizadas', 'filter'], ideas: ['Ideas', 'bulb'],
  profiles: ['Perfiles documentales', 'fileText'], nodus: ['Biblioteca Nodus', 'book'],
  zotero: ['Biblioteca Zotero', 'book'], context: ['Contexto documental', 'layers'],
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
const layerStates: Record<ResearchActivityLayerState, string> = {
  idle: 'Sin consultar', active: 'Consultando…', completed: 'Consultado', empty: 'Sin resultados', failed: 'Error', cancelled: 'Cancelado',
};

function LayerIcon({ layer }: { layer: ResearchActivityLayer }) {
  if (layer === 'nodus' || layer === 'zotero') return <img src={layer === 'nodus' ? nodusMark : zoteroMark} alt="" className={`research-activity-brand ${layer}`} />;
  return <Icon name={layers[layer][1]} size={17} />;
}

/** A fixed list of every layer a research turn can consult, in flow order. Each row is
 * this request's live state for that layer: a turning arrow while it is being consulted,
 * then green when it contributed, orange when it answered with nothing and the flow had
 * to rely on another layer, red when its attempt failed. A new request starts over. */
export function ResearchActivityPanel({ activities, outcome, onDismiss }: { activities: ResearchActivity[]; outcome: ResearchActivityStatus; onDismiss?: () => void }) {
  const [minimized, setMinimized] = useState(() => localStorage.getItem('nodus.researchActivityMinimized') === '1');
  const [dismissed, setDismissed] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const rows = useMemo(() => summarizeResearchActivity(activities), [activities]);
  const active = activities.filter(item => item.status === 'active');
  const current = active.at(-1) ?? activities.at(-1);
  const toggle = () => {
    setMinimized(value => { localStorage.setItem('nodus.researchActivityMinimized', value ? '0' : '1'); return !value; });
    requestAnimationFrame(() => toggleRef.current?.focus());
  };
  if (dismissed || !activities.length) return null;
  const status = outcome === 'active' ? tx('{n} operaciones activas', { n: active.length }) : t(statuses[outcome]);
  const announcement = `${status}${current ? ` · ${t(layers[current.layer][0])} · ${t(operations[current.operation])}` : ''}`;
  return <section className={`research-activity ${minimized ? 'is-minimized' : ''}`} aria-label={t('Actividad del Research chat')} data-testid="research-activity" onKeyDown={event => {
    if (event.key === 'Escape' && !minimized) { event.stopPropagation(); toggle(); }
  }}>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    {minimized ? <button ref={toggleRef} className="research-activity-orb" onClick={toggle} aria-label={t('Ampliar actividad')} aria-expanded={false} title={announcement}>
      {/* The radar itself carries the request's state: it sweeps while the request runs,
          then turns green when it completed, red when it failed and grey when cancelled. */}
      <span className={`research-activity-radar ${outcome}`} aria-hidden="true"><Icon name="radar" size={20} /></span>
    </button> : <>
      <header><div><h2>{t('Actividad del Research chat')}</h2><p>{status}</p></div>
        <button ref={toggleRef} onClick={toggle} aria-label={t('Minimizar actividad')} aria-expanded={true} title={t('Minimizar actividad')}><Icon name="minus" size={16} /></button>
        {outcome !== 'active' && <button onClick={() => { setDismissed(true); onDismiss?.(); }} aria-label={t('Cerrar actividad')} title={t('Cerrar actividad')}><Icon name="x" size={16} /></button>}
      </header>
      <ol>
        {rows.map(row => <li key={row.layer} data-status={row.state} data-layer={row.layer}>
          <span className="research-activity-icon" aria-hidden="true"><LayerIcon layer={row.layer} /></span>
          <div className="research-activity-copy"><div><strong>{t(layers[row.layer][0])}</strong><span className="research-activity-state">{t(layerStates[row.state])}</span></div>
            {row.operation && <p>{t(operations[row.operation])}{row.count !== undefined && <span> · {row.count}</span>}</p>}
            {row.subject && <small title={row.subject}>{row.subject}</small>}
          </div>
          {row.state === 'active'
            ? <span className="research-activity-spinner" aria-hidden="true"><Icon name="rotateCw" size={13} /></span>
            : <span className={`research-activity-indicator ${row.state}`} aria-hidden="true" />}
        </li>)}
      </ol>
    </>}
  </section>;
}
