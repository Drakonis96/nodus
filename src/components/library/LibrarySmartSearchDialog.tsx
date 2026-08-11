import { useEffect, useState } from 'react';
import type {
  LibraryColumnId,
  LibrarySavedSearchRecord,
  LibrarySmartSearchCondition,
  LibrarySmartSearchField,
  LibrarySmartSearchGroup,
  LibrarySmartSearchOperator,
  LibrarySortField,
  LibraryViewPreferences,
} from '@shared/libraryTypes';
import { Icon, Spinner } from '../ui';
import { t, tx } from '../../i18n';
import { toast } from '../feedback';

const FIELDS: Array<[LibrarySmartSearchField, string]> = [
  ['title', 'Título'], ['abstract', 'Resumen'], ['creator', 'Autoría'], ['tag', 'Etiqueta'], ['date', 'Fecha'], ['year', 'Año'],
  ['source', 'Origen'], ['itemType', 'Tipo'], ['collection', 'Colección'], ['attachment', 'Adjunto'],
  ['extraction', 'Extracción'], ['trash', 'Papelera'], ['vault', 'Vault'], ['analysis', 'Análisis'],
];
const OPERATORS: Array<[LibrarySmartSearchOperator, string]> = [
  ['contains', 'contiene'], ['equals', 'es'], ['not-equals', 'no es'], ['before', 'antes de'], ['after', 'después de'],
  ['is-true', 'sí'], ['is-false', 'no'],
];
const COLUMNS: Array<[LibraryColumnId, string]> = [
  ['title', 'Documento'], ['creator', 'Autoría'], ['year', 'Año'], ['source', 'Origen'], ['status', 'Estado'],
  ['attachments', 'Adjuntos'], ['updatedAt', 'Modificado'],
];
const SORT_FIELDS: Array<[LibrarySortField, string]> = [
  ['title', 'Documento'], ['creator', 'Autoría'], ['year', 'Año'], ['source', 'Origen'],
  ['updatedAt', 'Modificado'], ['extraction', 'Estado'], ['attachments', 'Adjuntos'],
];

function newCondition(): LibrarySmartSearchCondition {
  return { id: crypto.randomUUID(), field: 'title', operator: 'contains', value: '' };
}

function newGroup(mode: LibrarySmartSearchGroup['mode'] = 'all'): LibrarySmartSearchGroup {
  return { id: crypto.randomUUID(), mode, rules: [newCondition()] };
}

function GroupEditor({ group, depth, onChange, onRemove }: {
  group: LibrarySmartSearchGroup;
  depth: number;
  onChange: (group: LibrarySmartSearchGroup) => void;
  onRemove?: () => void;
}) {
  const updateRule = (index: number, rule: LibrarySmartSearchCondition | LibrarySmartSearchGroup) => {
    const rules = [...group.rules]; rules[index] = rule; onChange({ ...group, rules });
  };
  return <div className={`rounded-xl border p-3 ${depth ? 'border-neutral-800 bg-neutral-950/60' : 'border-neutral-700 bg-neutral-900/40'}`}>
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-neutral-500">{t(depth ? 'Este grupo cumple' : 'Coincidir con')}</span>
      <select className="input h-8 text-xs" value={group.mode} onChange={(event) => onChange({ ...group, mode: event.target.value as LibrarySmartSearchGroup['mode'] })}>
        <option value="all">{t('todas las reglas')}</option><option value="any">{t('cualquier regla')}</option><option value="not">{t('ninguna regla')}</option>
      </select>
      {onRemove && <button className="ml-auto text-red-400" onClick={onRemove} aria-label={t('Eliminar grupo')}><Icon name="trash" size={13} /></button>}
    </div>
    <div className="mt-3 space-y-2">{group.rules.map((rule, index) => 'rules' in rule ? <GroupEditor
      key={rule.id} group={rule} depth={depth + 1} onChange={(value) => updateRule(index, value)}
      onRemove={() => onChange({ ...group, rules: group.rules.filter((_, ruleIndex) => ruleIndex !== index) })}
    /> : <div key={rule.id} className="grid gap-2 sm:grid-cols-[8rem_8rem_1fr_auto]">
      <select aria-label={t('Campo')} className="input h-9 text-xs" value={rule.field} onChange={(event) => updateRule(index, { ...rule, field: event.target.value as LibrarySmartSearchField })}>{FIELDS.map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}</select>
      <select aria-label={t('Operador')} className="input h-9 text-xs" value={rule.operator} onChange={(event) => updateRule(index, { ...rule, operator: event.target.value as LibrarySmartSearchOperator })}>{OPERATORS.map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}</select>
      {['is-true', 'is-false'].includes(rule.operator) ? <span className="h-9" /> : <input aria-label={t('Valor')} className="input h-9 text-xs" value={String(rule.value ?? '')} onChange={(event) => updateRule(index, { ...rule, value: event.target.value })} placeholder={rule.field === 'analysis' ? 'deep:stale' : t('Valor')} />}
      <button className="grid h-9 w-9 place-items-center rounded text-red-400 hover:bg-red-500/10" onClick={() => onChange({ ...group, rules: group.rules.filter((_, ruleIndex) => ruleIndex !== index) })} aria-label={t('Eliminar regla')}><Icon name="x" size={13} /></button>
    </div>)}</div>
    <div className="mt-3 flex flex-wrap gap-2"><button className="btn btn-ghost h-8 text-xs" onClick={() => onChange({ ...group, rules: [...group.rules, newCondition()] })}><Icon name="plus" size={12} /> {t('Añadir regla')}</button>{depth < 3 && <button className="btn btn-ghost h-8 text-xs" onClick={() => onChange({ ...group, rules: [...group.rules, newGroup('any')] })}><Icon name="folderPlus" size={12} /> {t('Añadir grupo')}</button>}</div>
  </div>;
}

export function LibrarySmartSearchDialog({ initial, onClose, onSaved }: {
  initial?: LibrarySavedSearchRecord | null;
  onClose: () => void;
  onSaved: (record: LibrarySavedSearchRecord) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [query, setQuery] = useState<LibrarySmartSearchGroup>(initial?.query ?? newGroup());
  const [preview, setPreview] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => void window.nodus.listGlobalLibraryItems({ smartSearch: query, limit: 1, includeFacets: false })
      .then((page) => alive && setPreview(page.total)).catch(() => alive && setPreview(null)), 180);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [query]);
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { const record = await window.nodus.saveGlobalLibrarySavedSearch({ id: initial?.id, name, query }); onSaved(record); onClose(); }
    catch (error) { toast(error instanceof Error ? error.message : String(error), { tone: 'error' }); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[80] grid place-items-center bg-black/65 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section data-testid="library-smart-search-dialog" className="card flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden shadow-2xl">
      <header className="flex items-start gap-3 border-b border-neutral-800 p-5"><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300"><Icon name="search" /></span><div className="min-w-0 flex-1"><h2 className="font-semibold">{t(initial ? 'Editar búsqueda inteligente' : 'Nueva búsqueda inteligente')}</h2><p className="mt-1 text-xs text-neutral-500">{t('Los resultados se calculan en vivo y nunca duplican documentos.')}</p></div><button className="btn btn-ghost" onClick={onClose} aria-label={t('Cerrar')}><Icon name="x" /></button></header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5"><label className="text-[10px] uppercase tracking-wider text-neutral-500">{t('Nombre')}<input autoFocus className="input mt-1 w-full" value={name} onChange={(event) => setName(event.target.value)} /></label><div className="mt-4"><GroupEditor group={query} depth={0} onChange={setQuery} /></div></div>
      <footer className="flex items-center gap-3 border-t border-neutral-800 p-4"><span data-testid="smart-search-preview" className="text-xs text-neutral-500">{preview == null ? t('Calculando…') : tx('{n} resultado(s)', { n: preview })}</span><div className="flex-1" /><button className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button><button className="btn btn-primary" disabled={!name.trim() || busy} onClick={() => void save()}>{busy ? <Spinner /> : <Icon name="save" />} {t('Guardar')}</button></footer>
    </section>
  </div>;
}

export function LibraryTablePreferencesDialog({ preferences, onClose, onSaved }: {
  preferences: LibraryViewPreferences;
  onClose: () => void;
  onSaved: (preferences: LibraryViewPreferences) => void;
}) {
  const [value, setValue] = useState(preferences);
  const save = async () => { const stored = await window.nodus.setGlobalLibraryViewPreferences(value); onSaved(stored); onClose(); };
  return <div className="fixed inset-0 z-[80] grid place-items-center bg-black/65 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section data-testid="library-table-preferences" className="card w-full max-w-lg overflow-hidden shadow-2xl"><header className="flex items-center gap-3 border-b border-neutral-800 p-5"><Icon name="columns" className="text-indigo-300" /><div className="flex-1"><h2 className="font-semibold">{t('Columnas y orden')}</h2><p className="mt-1 text-xs text-neutral-500">{t('La vista se conserva entre sesiones.')}</p></div><button className="btn btn-ghost" onClick={onClose} aria-label={t('Cerrar')}><Icon name="x" /></button></header>
      <div className="p-5"><h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{t('Columnas visibles')}</h3><div className="mt-3 grid grid-cols-2 gap-2">{COLUMNS.map(([id, label]) => <label key={id} className="flex items-center gap-2 rounded-lg border border-neutral-800 p-2 text-xs"><input type="checkbox" checked={value.visibleColumns.includes(id)} onChange={(event) => setValue((current) => ({ ...current, visibleColumns: event.target.checked ? [...current.visibleColumns, id] : current.visibleColumns.filter((entry) => entry !== id) }))} />{t(label)}</label>)}</div>
        <h3 className="mt-5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{t('Orden multicolumna')}</h3><div className="mt-3 space-y-2">{value.sort.map((rule, index) => <div key={index} className="flex gap-2"><select className="input flex-1 text-xs" value={rule.field} onChange={(event) => setValue((current) => ({ ...current, sort: current.sort.map((entry, ruleIndex) => ruleIndex === index ? { ...entry, field: event.target.value as LibrarySortField } : entry) }))}>{SORT_FIELDS.map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}</select><select className="input w-32 text-xs" value={rule.direction} onChange={(event) => setValue((current) => ({ ...current, sort: current.sort.map((entry, ruleIndex) => ruleIndex === index ? { ...entry, direction: event.target.value as 'asc' | 'desc' } : entry) }))}><option value="asc">{t('Ascendente')}</option><option value="desc">{t('Descendente')}</option></select><button className="btn btn-ghost text-red-400" onClick={() => setValue((current) => ({ ...current, sort: current.sort.filter((_, ruleIndex) => ruleIndex !== index) }))}><Icon name="x" size={12} /></button></div>)}</div>{value.sort.length < 3 && <button className="btn btn-ghost mt-2 h-8 text-xs" onClick={() => setValue((current) => ({ ...current, sort: [...current.sort, { field: 'title', direction: 'asc' }] }))}><Icon name="plus" size={12} /> {t('Añadir criterio')}</button>}
      </div><footer className="flex justify-end gap-2 border-t border-neutral-800 p-4"><button className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button><button className="btn btn-primary" disabled={!value.visibleColumns.length || !value.sort.length} onClick={() => void save()}><Icon name="save" /> {t('Guardar')}</button></footer></section>
  </div>;
}
