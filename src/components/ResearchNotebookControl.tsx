import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RETRIEVAL_PRESETS, type ResearchCorpusCollection, type ResearchCorpusDocument, type ResearchNotebook, type ResearchNotebookInput, type ResearchPreparationInventory, type ResearchSourceReference } from '@shared/researchCorpus';
import { ResearchZoteroControl } from './ResearchZoteroControl';
import { ResearchSystemPromptControl } from './ResearchSystemPromptControl';
import type { ResearchSystemPrompt } from '@shared/researchSystemPrompts';
import { Icon } from './ui';
import { t } from '../i18n';

/** The vault's research notebooks (academic vaults only) and a way to refresh them. */
export function useResearchNotebooks(enabled = true) {
  const [academic, setAcademic] = useState(false);
  const [notebooks, setNotebooks] = useState<ResearchNotebook[]>([]);
  const [error, setError] = useState('');
  const refresh = useCallback(() => window.nodus.listResearchNotebooks().then(setNotebooks).catch(reason => setError(String(reason))), []);
  useEffect(() => {
    let active = true;
    if (enabled) void window.nodus.getActiveVault().then(vault => { if (active) { setAcademic(vault.type === 'academic'); if (vault.type === 'academic') void refresh(); } });
    return () => { active = false; };
  }, [enabled, refresh]);
  return { available: enabled && academic, notebooks, refresh, error };
}

/** Notebook picker with edit and create (Deep Research's toolbar). */
export function ResearchNotebookControl({ value, onChange }: { value?: string | null; onChange: (id: string | null) => void }) {
  const { available, notebooks, refresh, error } = useResearchNotebooks();
  const [editing, setEditing] = useState<ResearchNotebook | 'new' | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  if (!available) return null;
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

/** The notebook a conversation reads from, in the header: its name, edit and leave. */
export function ResearchNotebookChip({ notebook, onEdit, onClear, disabled }: { notebook: ResearchNotebook; onEdit: () => void; onClear: () => void; disabled?: boolean }) {
  return <div className="research-notebook-chip" data-testid="research-notebook-chip">
    <button type="button" className="research-notebook-chip-name" onClick={onEdit} disabled={disabled} aria-label={`${t('Editar cuaderno')}: ${notebook.name}`} title={t('Editar cuaderno')}>
      <Icon name="notebook" size={15} /><span className="truncate">{notebook.name}</span>
    </button>
    <button type="button" className="research-notebook-chip-clear" onClick={onClear} disabled={disabled} aria-label={t('Volver al chat general')} title={t('Volver al chat general')}><Icon name="x" size={13} /></button>
  </div>;
}

const referenceKey = (source: ResearchSourceReference) => JSON.stringify([source.kind, source.id, source.libraryType, source.libraryId]);
export function NotebookDialog({ notebook, onClose, onSaved }: { notebook: ResearchNotebook | null; onClose: () => void; onSaved: (id: string | null) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<ResearchNotebookInput>(notebook ?? { name: '', description: '', sources: [], exclusions: [], mode: 'fixed', settings: { ...RETRIEVAL_PRESETS.balanced } });
  const [documents, setDocuments] = useState<ResearchCorpusDocument[]>([]);
  const [collections, setCollections] = useState<ResearchCorpusCollection[]>([]);
  const [inventory, setInventory] = useState<ResearchPreparationInventory | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [membershipChanges, setMembershipChanges] = useState<{ added: string[]; removed: string[] }>({ added: [], removed: [] });
  const [prompts, setPrompts] = useState<ResearchSystemPrompt[]>([]);
  const refreshPrompts = async () => setPrompts((await window.nodus.getResearchSystemPrompts()).prompts);
  useEffect(() => {
    dialog.current?.showModal();
    void refreshPrompts().catch(reason => setError(String(reason)));
    let active = true;
    void Promise.all([window.nodus.getResearchCorpusSources(), window.nodus.getResearchPreparationInventory()]).then(([sources, preparation]) => {
      if (active) { setDocuments(sources.documents); setCollections(sources.collections); setInventory(preparation); }
    }).catch(reason => { if (active) setError(String(reason)); });
    if (notebook?.mode === 'linked') void window.nodus.resolveResearchNotebook(notebook.id).then(scope => {
      if (active) setMembershipChanges(scope.changes);
    }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [notebook?.id, notebook?.mode]);
  const selected = new Set<string>();
  for (const source of draft.sources) {
    if (source.kind === 'work' || source.kind === 'library-item' || source.kind === 'note' || source.kind === 'conversation-attachment') {
      documents.filter(document => (source.kind === 'conversation-attachment' ? document.conversationAttachment && document.id : source.kind === 'work' ? document.workId : source.kind === 'note' ? document.noteId : document.libraryItemId) === source.id).forEach(document => selected.add(document.id));
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
  return createPortal(<dialog ref={dialog} onCancel={onClose} aria-labelledby="research-notebook-title" className="card-modal text-neutral-100 p-5 w-[min(760px,94vw)] max-h-[88vh] overflow-auto backdrop:bg-black/60">
    <form onSubmit={event => { event.preventDefault(); void act(async () => { const saved = await window.nodus.saveResearchNotebook(draft); await onSaved(saved.id); }); }}>
      <h2 id="research-notebook-title" className="text-lg font-semibold mb-4">{t('Cuaderno de investigación')}</h2>
      <label className="block mb-3">{t('Nombre')}<input autoFocus required maxLength={160} className="input block w-full" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label className="block mb-3">{t('Descripción')}<textarea className="input block w-full" maxLength={10000} value={draft.description ?? ''} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
      <label className="block mb-3">{t('Selección de fuentes')}
        <select className="input ml-2" value={draft.mode} onChange={event => setDraft({ ...draft, mode: event.target.value as 'fixed' | 'linked' })}>
          <option value="fixed">{t('Selección fija')}</option><option value="linked">{t('Colecciones vinculadas')}</option>
        </select>
      </label>
      {draft.mode === 'linked' && (membershipChanges.added.length > 0 || membershipChanges.removed.length > 0) && <p role="status" className="text-sm mb-3">
        {t('Cambios en las colecciones')}: +{membershipChanges.added.length} / −{membershipChanges.removed.length}. {t('Se aplicarán en la próxima ejecución.')}
      </p>}
      <fieldset className="border border-neutral-700 rounded p-3 mb-3"><legend>{t('Colecciones')}</legend>
        {collections.map(collection => { const source = draft.sources.find(item => referenceKey(item) === referenceKey(collection.reference)); return <div key={referenceKey(collection.reference)} className="flex flex-wrap gap-3 mb-1">
          <label><input type="checkbox" checked={!!source} onChange={event => setDraft({ ...draft, sources: event.target.checked ? [...draft.sources, collection.reference] : draft.sources.filter(item => referenceKey(item) !== referenceKey(collection.reference)) })} /> {collection.name}</label>
          {source && <label className="text-xs"><input type="checkbox" checked={source.includeDescendants === true} onChange={event => setDraft({ ...draft, sources: draft.sources.map(item => referenceKey(item) === referenceKey(source) ? { ...item, includeDescendants: event.target.checked } : item) })} /> {t('Incluir subcolecciones')}</label>}
        </div>; })}
      </fieldset>
      <label className="block">{t('Buscar')}<input type="search" className="input w-full" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <fieldset className="my-3 max-h-56 overflow-auto"><legend>{t('Fuentes')} · {selected.size}</legend>
        {documents.filter(document => document.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(document => {
          const reference: ResearchSourceReference = document.conversationAttachment ? { kind: 'conversation-attachment', id: document.id } : document.noteId ? { kind: 'note', id: document.noteId } : document.libraryItemId ? { kind: 'library-item', id: document.libraryItemId } : { kind: 'work', id: document.workId! };
          const state = inventory?.documents.find(item => item.id === document.id)?.preparation;
          return <label key={document.id} className="flex items-start gap-2 py-1 text-sm"><input type="checkbox" checked={selected.has(document.id)} onChange={event => setDraft({ ...draft,
            sources: event.target.checked && !draft.sources.some(item => referenceKey(item) === referenceKey(reference)) ? [...draft.sources, reference] : draft.sources,
            exclusions: event.target.checked ? draft.exclusions.filter(id => id !== document.id) : [...new Set([...draft.exclusions, document.id])],
          })} /><span>{document.title}{document.noteId && <small className="ml-2">· {t(document.authoredKind === 'generated-report' ? 'Informe' : 'Nota')}</small>}<small className="block text-neutral-400">{state?.unpreparedAttachmentIds?.length ? `${t('Cobertura parcial')} · ` : ''}{state?.lexical === 'stale' ? t('Disponible: revisión anterior') : state?.lexical === 'ready' ? t('Disponible para consultar') : t('Preparación pendiente')}</small></span></label>;
        })}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <label>{t('Profundidad')} <select className="input" value={settings.preset} onChange={event => setDraft({ ...draft, settings: event.target.value === 'custom' ? { ...settings, preset: 'custom' } : RETRIEVAL_PRESETS[event.target.value as keyof typeof RETRIEVAL_PRESETS] })}>
          <option value="fast">{t('Rápido')}</option><option value="balanced">{t('Equilibrado')}</option><option value="deep">{t('Profundo')}</option>
          <option value="custom">{t('Personalizado')}</option>
        </select></label>
        <label><input type="checkbox" checked={settings.autoExpand} onChange={event => setDraft({ ...draft, settings: { ...settings, autoExpand: event.target.checked } })} /> {t('Ampliar contexto automáticamente')}</label>
      </div>
      {settings.preset === 'custom' && <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3"><legend>{t('Presupuesto de recuperación')}</legend>
        {([
          ['candidates', 'Candidatos por búsqueda', 1, 500], ['passagesPerRound', 'Pasajes por ronda', 1, settings.candidates],
          ['evidenceTokens', 'Tokens de evidencia', 256, 64000], ['rounds', 'Rondas máximas', 1, 16],
        ] as const).map(([key, label, min, max]) => <label key={key}>{t(label)}<input className="input block w-full" type="number" required min={min} max={max} step={1} value={settings[key]}
          onChange={event => setDraft({ ...draft, settings: { ...settings, [key]: Number(event.target.value) } })} /></label>)}
      </fieldset>}
      <details className="mb-3 text-sm"><summary>{t('Ajustes de conversación')}</summary>
        <label className="block my-2"><input type="checkbox" checked={!!draft.conversationSettings} onChange={event => setDraft({ ...draft,
          conversationSettings: event.target.checked ? { systemPromptId: null, thinkingEffort: 'standard' } : undefined })} /> {t('Usar ajustes del cuaderno')}</label>
        {draft.conversationSettings && <div className="flex flex-wrap items-center gap-3">
          <ResearchSystemPromptControl prompts={prompts} selectedId={draft.conversationSettings.systemPromptId ?? null} disabled={busy} refresh={refreshPrompts}
            onSelect={async systemPromptId => setDraft({ ...draft, conversationSettings: { ...draft.conversationSettings, systemPromptId } })} />
          <label>{t('Esfuerzo de thinking')}<select className="input block" value={draft.conversationSettings.thinkingEffort ?? 'standard'} onChange={event => setDraft({ ...draft,
            conversationSettings: { ...draft.conversationSettings, thinkingEffort: event.target.value as NonNullable<ResearchNotebookInput['conversationSettings']>['thinkingEffort'] } })}>
            {([['standard', 'Estándar'], ['low', 'Bajo'], ['medium', 'Medio'], ['high', 'Alto']] as const).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
          </select></label>
        </div>}
      </details>
      <details className="mb-3 text-sm"><summary>{t('Umbral vectorial avanzado')}</summary>
        <label className="block my-2"><input type="checkbox" checked={settings.threshold.mode === 'automatic'} disabled={!inventory?.embeddingSpaces?.length}
          onChange={event => setDraft({ ...draft, settings: { ...settings, threshold: event.target.checked ? { mode: 'automatic' } : { mode: 'manual', value: 0.3, metric: 'cosine', embeddingSpace: inventory!.embeddingSpaces![0].id } } })} /> {t('Umbral automático')}</label>
        {settings.threshold.mode === 'manual' && <div className="flex flex-wrap gap-3">
          <label>{t('Espacio de embeddings')}<select className="input block max-w-full" value={settings.threshold.embeddingSpace} onChange={event => {
            if (settings.threshold.mode === 'manual') setDraft({ ...draft, settings: { ...settings, threshold: { ...settings.threshold, embeddingSpace: event.target.value } } });
          }}>{inventory?.embeddingSpaces?.map(space => <option key={space.id} value={space.id}>{space.provider} · {space.model} · {space.dimensions} · cosine · {space.id.slice(0, 8)}</option>)}</select></label>
          <label>{t('Similitud mínima')}<input type="number" className="input block" min={-1} max={1} step={0.01} required value={settings.threshold.value} onChange={event => {
            if (settings.threshold.mode === 'manual') setDraft({ ...draft, settings: { ...settings, threshold: { ...settings.threshold, value: Number(event.target.value) } } });
          }} /></label>
        </div>}
        <p>{t('El umbral manual solo se aplica al espacio seleccionado.')}</p>
      </details>
      <div className="rounded border border-neutral-700 p-3 text-sm mb-3">
        <p>{t('Preparar las fuentes permite consultarlas sin generar Ideas ni perfiles.')}</p>
        <label className="block my-2"><input type="checkbox" checked={inventory?.enabled ?? false} disabled={busy} onChange={event => { const enabled = event.target.checked; void act(async () => { await window.nodus.setResearchPreparationEnabled(enabled); setInventory(await window.nodus.getResearchPreparationInventory()); }); }} /> {t('Preparar nuevas incorporaciones')}</label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost" disabled={busy || !selected.size} onClick={() => void act(async () => { await window.nodus.prepareResearchDocuments([...selected]); setInventory(await window.nodus.getResearchPreparationInventory()); })}>{t('Preparar fuentes')}</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void act(() => window.nodus.setResearchPreparationPaused(true))}>{t('Pausar')}</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void act(() => window.nodus.setResearchPreparationPaused(false))}>{t('Reanudar')}</button>
          <button type="button" className="btn btn-ghost" disabled={busy || !selected.size} onClick={() => void act(async () => { await window.nodus.cancelResearchDocuments([...selected]); setInventory(await window.nodus.getResearchPreparationInventory()); })}>{t('Cancelar preparación')}</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void act(async () => setInventory(await window.nodus.getResearchPreparationInventory()))}>{t('Actualizar')}</button>
        </div>
      </div>
      {notebook && <ResearchZoteroControl notebookId={notebook.id} />}
      {error && <p role="alert" className="text-red-400 mb-3">{error}</p>}
      <div className="flex gap-2 justify-end">
        {notebook && <button type="button" className="btn btn-ghost mr-auto" disabled={busy} title={t('Las conversaciones y las fuentes se conservarán.')} onClick={() => void act(async () => { await window.nodus.deleteResearchNotebook(notebook.id); await onSaved(null); })}>{t('Eliminar')}</button>}
        <button type="button" className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button><button type="submit" className="btn btn-primary" disabled={busy}>{t('Guardar')}</button>
      </div>
    </form>
  </dialog>, document.body);
}
