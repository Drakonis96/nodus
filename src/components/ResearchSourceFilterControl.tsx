import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { matchingResearchWorkIds, normalizeResearchSourceFilter, type ResearchContextSources, type ResearchSourceFilter } from '@shared/researchContextFilters';
import { Icon } from './ui';
import { t, tx } from '../i18n';

export function ResearchSourceFilterControl({ value, disabled, onChange }: {
  value?: ResearchSourceFilter; disabled: boolean; onChange: (value: ResearchSourceFilter) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const filter = normalizeResearchSourceFilter(value);
  const count = filter.authorIds.length + filter.workIds.length;
  const close = () => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); };
  return <>
    <button ref={trigger} type="button" disabled={disabled} data-testid="research-source-filter-trigger"
      className={`btn btn-ghost border gap-1.5 text-xs py-1 research-source-filter-trigger ${filter.enabled ? 'is-active' : 'border-neutral-700'}`}
      title={t('Filtrar contexto')} aria-label={t('Filtrar contexto')} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(true)}>
      <Icon name="filter" size={15} /><span>{t('Fuentes')}</span>
      {filter.enabled && <span className="research-source-filter-count">{count}</span>}
    </button>
    {open && <SourceFilterDialog value={filter} accent={trigger.current ? getComputedStyle(trigger.current).getPropertyValue('--vault-accent') : ''}
      onClose={close} onApply={async next => { await onChange(next); close(); }} />}
  </>;
}

function SourceFilterDialog({ value, accent, onClose, onApply }: {
  value: ResearchSourceFilter; accent: string; onClose: () => void; onApply: (value: ResearchSourceFilter) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(value);
  const [sources, setSources] = useState<ResearchContextSources | null>(null);
  const [authorQuery, setAuthorQuery] = useState('');
  const [workQuery, setWorkQuery] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    void window.nodus.listResearchContextSources().then(data => { if (active) setSources(data); })
      .catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, []);
  const matches = sources ? matchingResearchWorkIds(sources, draft) : [];
  const toggle = (key: 'authorIds' | 'workIds', id: string) => setDraft(current => ({ ...current,
    [key]: current[key].includes(id) ? current[key].filter(item => item !== id) : [...current[key], id],
  }));
  const normalized = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  const lists = sources && [
    { key: 'authorIds' as const, title: t('Autores'), query: authorQuery, setQuery: setAuthorQuery, placeholder: t('Buscar autores'),
      items: sources.authors.map(author => ({ id: author.id, title: author.name, detail: author.workIds.length === 1 ? t('1 obra') : tx('{n} obras', { n: author.workIds.length }) })) },
    { key: 'workIds' as const, title: t('Obras'), query: workQuery, setQuery: setWorkQuery, placeholder: t('Buscar obras'),
      items: sources.works.map(work => ({ id: work.id, title: work.title, detail: [...work.authors, work.year].filter(Boolean).join(' · ') })) },
  ];
  return createPortal(<dialog ref={dialog} className="research-source-filter-dialog" aria-labelledby="research-source-filter-title"
    style={{ '--vault-accent': accent } as CSSProperties}
    onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}
    onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); if (!saving && event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) onClose(); }}>
    <header><h2 id="research-source-filter-title">{t('Filtrar contexto')}</h2>
      <button className="btn btn-ghost" title={t('Cerrar')} disabled={saving} onClick={onClose}><Icon name="x" /></button></header>
    <div className="research-source-filter-body">
      <label className="research-source-filter-switch"><input type="checkbox" checked={draft.enabled} disabled={saving}
        onChange={event => setDraft(current => ({ ...current, enabled: event.target.checked }))} />{t('Limitar el contexto a las fuentes seleccionadas')}</label>
      <p>{t('Los autores incluyen sus obras, no los textos que solo los mencionan. Si eliges autores y obras, se usará la intersección.')}</p>
      <p>{t('Al cambiar las fuentes, las respuestas anteriores con otro contexto no se enviarán al modelo.')}</p>
      {!sources && !error && <p role="status">{t('Cargando...')}</p>}
      <div className="research-source-filter-columns">{lists?.map(list => {
        const hits = list.items.filter(item => normalized(`${item.title} ${item.detail}`).includes(normalized(list.query)));
        const selected = draft[list.key];
        return <section key={list.key} aria-label={list.title}>
          <h3>{list.title}<span>{selected.length}</span></h3>
          {selected.length > 0 && <div className="research-source-filter-chips">{selected.map(id => <button key={id} disabled={saving}
            title={t('Quitar')} onClick={() => toggle(list.key, id)}>{list.items.find(item => item.id === id)?.title ?? t('Fuente no disponible')}<Icon name="x" size={12} /></button>)}</div>}
          <input className="input w-full" aria-label={list.placeholder} placeholder={list.placeholder} value={list.query} onChange={event => list.setQuery(event.target.value)} />
          <div className="research-source-filter-results">{hits.slice(0, 100).map(item => <label key={item.id}>
            <input type="checkbox" checked={selected.includes(item.id)} disabled={saving} onChange={() => toggle(list.key, item.id)} />
            <span><strong>{item.title}</strong><small>{item.detail}</small></span>
          </label>)}{!hits.length && <p>{t('Sin resultados')}</p>}
          {hits.length > 100 && <p>{t('Afina la búsqueda para ver más resultados.')}</p>}</div>
        </section>;
      })}</div>
      <p role="status" className="research-source-filter-status">{draft.enabled
        ? sources && matches.length ? matches.length === 1 ? t('El asistente solo consultará esta obra.') : tx('El asistente solo consultará {n} obras.', { n: matches.length }) : t('Ninguna obra coincide. No se recuperará contexto de otras fuentes.')
        : t('Filtro desactivado: se consultará todo el corpus.')}</p>
      {error && <p role="alert" className="text-red-500">{error}</p>}
    </div>
    <footer><button className="btn btn-ghost" disabled={saving} onClick={() => setDraft({ enabled: false, authorIds: [], workIds: [] })}>{t('Restablecer')}</button>
      <span className="flex-1" /><button className="btn btn-ghost" disabled={saving} onClick={onClose}>{t('Cancelar')}</button>
      <button className="btn btn-primary" disabled={saving || (draft.enabled && !sources)} onClick={async () => {
        setSaving(true); setError('');
        try { await onApply(normalizeResearchSourceFilter(draft)); } catch (reason) { setError(String(reason)); setSaving(false); }
      }}>{t('Aplicar')}</button></footer>
  </dialog>, document.body);
}
