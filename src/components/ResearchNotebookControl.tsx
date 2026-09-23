import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RETRIEVAL_PRESETS, type ResearchCorpusCollection, type ResearchCorpusDocument, type ResearchNotebook, type ResearchNotebookInput, type ResearchPreparationInventory, type ResearchSourceReference } from '@shared/researchCorpus';
import { t } from '../i18n';

export function ResearchNotebookControl({ value, onChange }: { value?: string | null; onChange: (id: string | null) => void }) {
  const [academic, setAcademic] = useState(false);
  const [notebooks, setNotebooks] = useState<ResearchNotebook[]>([]);
  const [editing, setEditing] = useState<ResearchNotebook | 'new' | null>(null);
  const [error, setError] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const refresh = () => window.nodus.listResearchNotebooks().then(setNotebooks).catch(reason => setError(String(reason)));
  useEffect(() => { let active = true; void window.nodus.getActiveVault().then(vault => { if (active) { setAcademic(vault.type === 'academic'); if (vault.type === 'academic') void refresh(); } }); return () => { active = false; }; }, []);
  if (!academic) return null;
  const selected = notebooks.find(notebook => notebook.id === value);
  const close = () => { setEditing(null); trigger.current?.focus(); };
  return <div className="flex items-center gap-1" data-testid="research-notebooks">
    <select aria-label={t('Cuaderno de investigación')} className="input min-w-0 max-w-48 text-xs" value={value ?? ''} onChange={event => onChange(event.target.value || null)}>
      <option value="">{t('Chat general')}</option>
      {notebooks.map(notebook => <option key={notebook.id} value={notebook.id}>{notebook.name}</option>)}
    </select>
    <button ref={trigger} type="button" className="btn btn-ghost text-xs" onClick={() => setEditing(selected ?? 'new')}>{selected ? t('Editar') : t('Nuevo cuaderno')}</button>
    {selected && <button type="button" className="btn btn-ghost text-xs" aria-label={t('Nuevo cuaderno')} onClick={() => setEditing('new')}>+</button>}
    {error && <span role="alert" className="text-xs text-red-400">{error}</span>}
    {editing && <NotebookDialog notebook={editing === 'new' ? null : editing} onClose={close} onSaved={async id => { await refresh(); onChange(id); close(); }} />}
  </div>;
}

const referenceKey = (source: ResearchSourceReference) => JSON.stringify([source.kind, source.id, source.libraryType, source.libraryId]);
function NotebookDialog({ notebook, onClose, onSaved }: { notebook: ResearchNotebook | null; onClose: () => void; onSaved: (id: string | null) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<ResearchNotebookInput>(notebook ?? { name: '', description: '', sources: [], exclusions: [], mode: 'fixed', settings: { ...RETRIEVAL_PRESETS.balanced } });
  const [documents, setDocuments] = useState<ResearchCorpusDocument[]>([]);
  const [collections, setCollections] = useState<ResearchCorpusCollection[]>([]);
  const [inventory, setInventory] = useState<ResearchPreparationInventory | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    void Promise.all([window.nodus.getResearchCorpusSources(), window.nodus.getResearchPreparationInventory()]).then(([sources, preparation]) => {
      if (active) { setDocuments(sources.documents); setCollections(sources.collections); setInventory(preparation); }
    }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, []);
  const selected = new Set<string>();
  for (const source of draft.sources) {
    if (source.kind === 'work' || source.kind === 'library-item') {
      documents.filter(document => (source.kind === 'work' ? document.workId : document.libraryItemId) === source.id).forEach(document => selected.add(document.id));
    } else {
      const stack = collections.filter(collection => referenceKey(collection.reference) === referenceKey(source));
      const visited = new Set<string>();
      while (stack.length) {
        const collection = stack.pop()!;
        const key = referenceKey(collection.reference);
        if (visited.has(key)) continue;
        visited.add(key);
        collection.documentIds.forEach(id => selected.add(id));
        if (source.includeDescendants) stack.push(...collections.filter(child => child.parentId === collection.reference.id
          && child.reference.kind === source.kind && child.reference.libraryType === source.libraryType && child.reference.libraryId === source.libraryId));
      }
    }
  }
  if (notebook?.mode === 'fixed' && draft.mode === 'fixed'
    && JSON.stringify([draft.sources, draft.exclusions]) === JSON.stringify([notebook.sources, notebook.exclusions])) {
    selected.clear();
    notebook.resolvedDocumentIds.filter(id => documents.some(document => document.id === id)).forEach(id => selected.add(id));
  }
  draft.exclusions.forEach(id => selected.delete(id));
  const act = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); } catch (reason) { setError(String(reason)); } finally { setBusy(false); } };
  const settings = draft.settings ?? RETRIEVAL_PRESETS.balanced;
  return createPortal(<dialog ref={dialog} onCancel={onClose} aria-labelledby="research-notebook-title" className="rounded-xl border border-neutral-700 bg-neutral-900 text-neutral-100 p-5 w-[min(760px,94vw)] max-h-[88vh] overflow-auto backdrop:bg-black/60">
    <form onSubmit={event => { event.preventDefault(); void act(async () => { const saved = await window.nodus.saveResearchNotebook(draft); await onSaved(saved.id); }); }}>
      <h2 id="research-notebook-title" className="text-lg font-semibold mb-4">{t('Cuaderno de investigación')}</h2>
      <label className="block mb-3">{t('Nombre')}<input autoFocus required maxLength={160} className="input block w-full" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label className="block mb-3">{t('Descripción')}<textarea className="input block w-full" maxLength={10000} value={draft.description ?? ''} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
      <label className="block mb-3">{t('Selección de fuentes')}
        <select className="input ml-2" value={draft.mode} onChange={event => setDraft({ ...draft, mode: event.target.value as 'fixed' | 'linked' })}>
          <option value="fixed">{t('Selección fija')}</option><option value="linked">{t('Colecciones vinculadas')}</option>
        </select>
      </label>
      <fieldset className="border border-neutral-700 rounded p-3 mb-3"><legend>{t('Colecciones')}</legend>
        {collections.map(collection => { const source = draft.sources.find(item => referenceKey(item) === referenceKey(collection.reference)); return <div key={referenceKey(collection.reference)} className="flex flex-wrap gap-3 mb-1">
          <label><input type="checkbox" checked={!!source} onChange={event => setDraft({ ...draft, sources: event.target.checked ? [...draft.sources, collection.reference] : draft.sources.filter(item => referenceKey(item) !== referenceKey(collection.reference)) })} /> {collection.name}</label>
          {source && <label className="text-xs"><input type="checkbox" checked={source.includeDescendants === true} onChange={event => setDraft({ ...draft, sources: draft.sources.map(item => referenceKey(item) === referenceKey(source) ? { ...item, includeDescendants: event.target.checked } : item) })} /> {t('Incluir subcolecciones')}</label>}
        </div>; })}
      </fieldset>
      <label className="block">{t('Buscar')}<input type="search" className="input w-full" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <fieldset className="my-3 max-h-56 overflow-auto"><legend>{t('Fuentes')} · {selected.size}</legend>
        {documents.filter(document => document.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(document => {
          const reference: ResearchSourceReference = document.libraryItemId ? { kind: 'library-item', id: document.libraryItemId } : { kind: 'work', id: document.workId! };
          const state = inventory?.documents.find(item => item.id === document.id)?.preparation;
          return <label key={document.id} className="flex items-start gap-2 py-1 text-sm"><input type="checkbox" checked={selected.has(document.id)} onChange={event => setDraft({ ...draft,
            sources: event.target.checked && !draft.sources.some(item => referenceKey(item) === referenceKey(reference)) ? [...draft.sources, reference] : draft.sources,
            exclusions: event.target.checked ? draft.exclusions.filter(id => id !== document.id) : [...new Set([...draft.exclusions, document.id])],
          })} /><span>{document.title}<small className="block text-neutral-400">{state?.lexical === 'ready' ? t('Disponible para consultar') : t('Preparación pendiente')}</small></span></label>;
        })}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <label>{t('Profundidad')} <select className="input" value={settings.preset} onChange={event => setDraft({ ...draft, settings: RETRIEVAL_PRESETS[event.target.value as keyof typeof RETRIEVAL_PRESETS] })}>
          <option value="fast">{t('Rápido')}</option><option value="balanced">{t('Equilibrado')}</option><option value="deep">{t('Profundo')}</option>
        </select></label>
        <label><input type="checkbox" checked={settings.autoExpand} onChange={event => setDraft({ ...draft, settings: { ...settings, autoExpand: event.target.checked } })} /> {t('Ampliar contexto automáticamente')}</label>
      </div>
      <div className="rounded border border-neutral-700 p-3 text-sm mb-3">
        <p>{t('Preparar las fuentes permite consultarlas sin generar Ideas ni perfiles.')}</p>
        <label className="block my-2"><input type="checkbox" checked={inventory?.enabled ?? false} disabled={busy} onChange={event => { const enabled = event.target.checked; void act(async () => { await window.nodus.setResearchPreparationEnabled(enabled); setInventory(await window.nodus.getResearchPreparationInventory()); }); }} /> {t('Preparar nuevas incorporaciones')}</label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost" disabled={busy || !selected.size} onClick={() => void act(async () => { await window.nodus.prepareResearchDocuments([...selected]); setInventory(await window.nodus.getResearchPreparationInventory()); })}>{t('Preparar fuentes')}</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void act(() => window.nodus.setResearchPreparationPaused(true))}>{t('Pausar')}</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void act(() => window.nodus.setResearchPreparationPaused(false))}>{t('Reanudar')}</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void act(async () => setInventory(await window.nodus.getResearchPreparationInventory()))}>{t('Actualizar')}</button>
        </div>
      </div>
      {error && <p role="alert" className="text-red-400 mb-3">{error}</p>}
      <div className="flex gap-2 justify-end">
        {notebook && <button type="button" className="btn btn-ghost mr-auto" disabled={busy} title={t('Las conversaciones y las fuentes se conservarán.')} onClick={() => void act(async () => { await window.nodus.deleteResearchNotebook(notebook.id); await onSaved(null); })}>{t('Eliminar')}</button>}
        <button type="button" className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button><button type="submit" className="btn btn-primary" disabled={busy}>{t('Guardar')}</button>
      </div>
    </form>
  </dialog>, document.body);
}
