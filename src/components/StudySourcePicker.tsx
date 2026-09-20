import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StudyAssistantSelection, StudyAssistantSourceOption, StudyMaterialSummary, StudyWorkspace } from '@shared/types';
import type { StudySearchKind } from '@shared/studySearch';
import { buildStudySourceTree, studyOrganizationPaths, toggleStudySourceKeys, type StudySourceGroup } from '@shared/studySourceTree';
import { Icon } from './ui';
import { VirtualList } from './VirtualList';
import { TextInputModal } from './TextInputModal';
import { StudyMaterialMoveDialog } from './StudyMaterialMoveDialog';
import { announceStudyWorkspaceChanged, STUDY_WORKSPACE_CHANGED } from './StudySidebar';
import { t, tx } from '../i18n';

const KIND_LABELS: Record<StudySearchKind, string> = { material: 'Materiales', document: 'Apuntes', transcript: 'Transcripciones', question: 'Preguntas', exam: 'Exámenes' };
type Row = { id: string; depth: number; group: StudySourceGroup } | { id: string; depth: number; source: StudyAssistantSourceOption; path: string };

function SelectionBox({ keys, selected, onToggle, label }: { keys: string[]; selected: ReadonlySet<string>; onToggle: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const count = keys.filter((key) => selected.has(key)).length;
  useEffect(() => { if (ref.current) ref.current.indeterminate = count > 0 && count < keys.length; }, [count, keys.length]);
  return <input ref={ref} type="checkbox" className="shrink-0 accent-teal-600" aria-label={label} checked={keys.length > 0 && count === keys.length} disabled={!keys.length} onChange={onToggle} />;
}

function MaterialActions({ source, disabled, onMove }: { source: StudyAssistantSourceOption; disabled: boolean; onMove: () => void }) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const item = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!position) return;
    item.current?.focus();
    return () => { trigger.current?.focus(); };
  }, [position]);
  return <>
    <button ref={trigger} className="rounded p-1 text-neutral-500 hover:text-teal-600" aria-label={`${t('Mover material…')}: ${source.title}`} title={t('Mover material…')} aria-haspopup="menu" aria-expanded={!!position} disabled={disabled} onClick={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 232)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 64)) });
    }}><Icon name="menu" size={14} /></button>
    {position && createPortal(<div className="fixed inset-0 z-[130]" onClick={() => setPosition(null)} onKeyDown={(event) => {
      if (['Escape', 'Tab'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); setPosition(null); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); item.current?.focus(); }
    }}><div role="menu" aria-label={source.title} className="fixed w-56 rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900" style={position}>
      <button ref={item} role="menuitem" className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800" onClick={() => { setPosition(null); onMove(); }}><Icon name="folder" size={14} />{t('Mover material…')}</button>
    </div></div>, document.body)}
  </>;
}

export function StudySourcePicker({ selection, onChange }: { selection: StudyAssistantSelection; onChange: (selection: StudyAssistantSelection) => void }) {
  const [catalog, setCatalog] = useState<{ sources: StudyAssistantSourceOption[]; workspace: StudyWorkspace } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<StudySearchKind | 'all'>('all');
  const [onlySelected, setOnlySelected] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [folderDialog, setFolderDialog] = useState<{ group: StudySourceGroup; rename: boolean } | null>(null);
  const [moving, setMoving] = useState<StudyMaterialSummary | null>(null);
  const [openingMaterial, setOpeningMaterial] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [anchor, setAnchor] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const selected = useMemo(() => new Set(selection.sourceKeys), [selection.sourceKeys]);
  useEffect(() => {
    let active = true; let sequence = 0;
    const refresh = async () => {
      const request = ++sequence;
      try {
        const [sources, workspace] = await Promise.all([window.nodus.listStudyAssistantSources(), window.nodus.getStudyWorkspace()]);
        if (active && request === sequence) { setCatalog({ sources, workspace }); setError(''); setLoading(false); }
      } catch (reason) { if (active && request === sequence) { setError(reason instanceof Error ? reason.message : t('No se pudo cargar.')); setLoading(false); } }
    };
    void refresh();
    window.addEventListener(STUDY_WORKSPACE_CHANGED, refresh);
    window.addEventListener('focus', refresh);
    const unsubscribe = window.nodus.onStudyMaterialIndexChanged(refresh);
    return () => { active = false; window.removeEventListener(STUDY_WORKSPACE_CHANGED, refresh); window.removeEventListener('focus', refresh); unsubscribe(); };
  }, [revision]);
  const tree = useMemo(() => catalog ? buildStudySourceTree(catalog.sources, catalog.workspace, { query, kind, onlySelected, selected, unplacedLabel: t('Sin ubicación') }) : null, [catalog, query, kind, onlySelected, selected]);
  const rows = useMemo(() => {
    const result: Row[] = []; if (!tree || !catalog) return result;
    const paths = studyOrganizationPaths(catalog.workspace);
    const visit = (group: StudySourceGroup, depth: number) => {
      if (group.kind !== 'root') result.push({ id: group.id, depth, group });
      if (collapsed.has(group.id) && !query.trim()) return;
      for (const source of group.sources) result.push({ id: `${group.id}/${source.sourceKey}`, depth: depth + 1, source, path: paths.label(group.scope) });
      for (const child of group.groups) visit(child, depth + 1);
    };
    visit(tree, -1); return result;
  }, [tree, catalog, collapsed, query]);
  const toggleKeys = (keys: string[]) => onChange({ ...selection, sourceKeys: toggleStudySourceKeys(selection.sourceKeys, keys) });
  const toggleGroup = (id: string) => setCollapsed((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const openMove = async (source: StudyAssistantSourceOption) => {
    setOpeningMaterial(source.sourceId);
    try { setMoving(await window.nodus.getStudyMaterial(source.sourceId)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('No se pudo cargar.')); }
    finally { setOpeningMaterial(null); }
  };
  const unavailableSelected = catalog?.sources.filter((s) => selected.has(s.sourceKey) && s.available === false).length ?? 0;
  const catalogKeys = useMemo(() => new Set(catalog?.sources.map((source) => source.sourceKey)), [catalog]);
  const missingSelected = catalog ? selection.sourceKeys.filter((key) => !catalogKeys.has(key)).length : 0;
  return <div data-testid="study-source-picker" className="mt-3 space-y-3 text-neutral-800 dark:text-neutral-200">
    <label className="block text-[10px] text-neutral-500">{t('Ámbito')}<select data-testid="study-chat-scope" className="input mt-1 w-full" value={selection.scope} onChange={(event) => onChange({ ...selection, scope: event.target.value as StudyAssistantSelection['scope'], sourceKeys: [] })}>
      <option value="library">{t('Toda la biblioteca')}</option><option value="manual">{t('Selección manual')}</option>
      {!['library', 'manual'].includes(selection.scope) && <option value={selection.scope}>{catalog ? studyOrganizationPaths(catalog.workspace).label({ courseId: selection.courseId ?? null, subjectId: selection.subjectId ?? null, topicId: selection.topicId ?? null, folderId: null }) : t('Ámbito')}</option>}
    </select></label>
    {selection.scope === 'manual' && <>
      <label className="relative block"><span className="sr-only">{t('Buscar fuentes…')}</span><Icon name="search" size={14} className="pointer-events-none absolute left-3 top-3 text-neutral-500" /><input data-testid="study-source-search" className="input input-with-leading-icon w-full text-xs" placeholder={t('Buscar fuentes…')} value={query} onChange={(event) => { setQuery(event.target.value); setAnchor(null); }} /></label>
      <div className="flex items-center gap-2"><select aria-label={t('Tipo de fuente')} className="input min-w-0 flex-1 text-xs" value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setAnchor(null); }}><option value="all">{t('Todas las fuentes')}</option>{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select><label className="flex shrink-0 items-center gap-1.5 text-[11px]"><input type="checkbox" checked={onlySelected} onChange={(event) => { setOnlySelected(event.target.checked); setAnchor(null); }} />{t('Solo seleccionadas')}</label></div>
      <div className="flex items-center gap-2 text-xs"><span role="status" data-testid="study-source-count">{tx('{n} fuentes seleccionadas', { n: selected.size })}</span><button className="btn btn-ghost ml-auto h-7 px-2 text-xs" disabled={!selected.size} onClick={() => onChange({ ...selection, sourceKeys: [] })}>{t('Quitar selección')}</button></div>
      {unavailableSelected + missingSelected > 0 && <p className="text-xs text-amber-600 dark:text-amber-400" role="status">{tx('{n} fuentes seleccionadas no están disponibles.', { n: unavailableSelected + missingSelected })}</p>}
      <div className="flex items-center gap-2 border-t border-neutral-200 pt-2 dark:border-neutral-800"><SelectionBox keys={tree?.sourceKeys ?? []} selected={selected} onToggle={() => toggleKeys(tree?.sourceKeys ?? [])} label={t('Seleccionar resultados')} /><span className="text-xs text-neutral-500">{t('Seleccionar resultados')}</span><button className="btn btn-ghost ml-auto h-7 px-2 text-xs" disabled={!tree} onClick={() => { if (tree) setFolderDialog({ group: tree, rename: false }); }}><Icon name="plus" size={12} />{t('Nueva carpeta')}</button></div>
      {loading ? <p className="py-6 text-center text-xs text-neutral-500">{t('Cargando…')}</p> : <VirtualList<Row> items={rows} itemHeight={56} getKey={(row) => row.id} anchorKey={anchor} className="rounded-xl border border-neutral-200 dark:border-neutral-800" style={{ height: 'min(48vh, 480px)', minHeight: 168 }} empty={<p className="p-5 text-center text-xs text-neutral-500">{t('Sin resultados')}</p>} renderItem={(row, index) => {
        const group = 'group' in row ? row.group : null;
        const source = 'source' in row ? row.source : null;
        const checked = source ? selected.has(source.sourceKey) : false;
        return <div tabIndex={0} ref={(element) => { if (element && pendingFocus.current === row.id) { pendingFocus.current = null; element.focus({ preventScroll: true }); } }} data-source-row={row.id} className={`relative flex h-14 items-center gap-2 border-b border-neutral-100 pr-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500 dark:border-neutral-800/60 ${checked ? 'bg-teal-50 dark:bg-teal-950/40' : group ? 'bg-neutral-50 dark:bg-neutral-900/40' : ''}`} style={{ paddingLeft: 8 + Math.min(row.depth, 5) * 12 }} onKeyDown={(event) => {
          if (event.target !== event.currentTarget || event.currentTarget.closest('fieldset[disabled]')) return;
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault(); const next = rows[event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
            if (next) { pendingFocus.current = next.id; setAnchor(next.id); }
          } else if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault(); if (group) toggleKeys(group.sourceKeys); else if (source && (source.available !== false || checked)) toggleKeys([source.sourceKey]);
          } else if (group && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            event.preventDefault(); setCollapsed((current) => { const next = new Set(current); if (event.key === 'ArrowLeft') next.add(group.id); else next.delete(group.id); return next; });
          }
        }}>
          {group ? <>
            <button className="shrink-0 rounded p-0.5" aria-label={`${t(collapsed.has(group.id) ? 'Expandir' : 'Contraer')}: ${group.title}`} aria-expanded={!collapsed.has(group.id) || !!query.trim()} onClick={() => toggleGroup(group.id)}><Icon name={collapsed.has(group.id) && !query.trim() ? 'chevronRight' : 'chevronDown'} size={12} /></button>
            <SelectionBox keys={group.sourceKeys} selected={selected} onToggle={() => toggleKeys(group.sourceKeys)} label={`${t('Seleccionar')}: ${group.title}`} />
            <span className="min-w-0 flex-1 truncate text-xs font-medium" title={group.title}>{group.title}<span className="ml-1 font-normal text-neutral-500">{group.sourceKeys.length}</span></span>
            {group.kind !== 'unplaced' && <button className="rounded p-1 text-neutral-500 hover:text-teal-600" aria-label={`${t('Nueva carpeta')}: ${group.title}`} title={t('Nueva carpeta')} onClick={() => setFolderDialog({ group, rename: false })}><Icon name="plus" size={13} /></button>}
            {group.kind === 'folder' && <button className="rounded p-1 text-neutral-500 hover:text-teal-600" aria-label={`${t('Renombrar carpeta')}: ${group.title}`} title={t('Renombrar carpeta')} onClick={() => setFolderDialog({ group, rename: true })}><Icon name="edit" size={13} /></button>}
          </> : source && <>
            <input type="checkbox" className="shrink-0 accent-teal-600" aria-label={source.title} checked={checked} disabled={source.available === false && !checked} onChange={() => toggleKeys([source.sourceKey])} />
            <span className="min-w-0 flex-1"><span className={`block truncate text-xs ${source.available === false ? 'text-neutral-500' : ''}`} title={source.title}>{source.title}</span><span className="block truncate text-[10px] text-neutral-500" title={'path' in row ? row.path : ''}>{source.available === false ? t(source.unavailableReason === 'excluded' ? 'Excluido de la búsqueda' : 'Sin contenido utilizable') : `${t(KIND_LABELS[source.kind])}${source.fileName ? ` · ${source.fileName}` : ''}`}</span></span>
            {source.kind === 'material' && <MaterialActions source={source} disabled={openingMaterial !== null} onMove={() => void openMove(source)} />}
          </>}
        </div>;
      }} />}
    </>}
    {error && <div role="alert" className="text-xs text-red-500">{error}<button className="btn btn-ghost ml-2 text-xs" onClick={() => setRevision((n) => n + 1)}>{t('Reintentar')}</button></div>}
    {folderDialog && <TextInputModal testId="study-source-folder-dialog" title={`${t(folderDialog.rename ? 'Renombrar carpeta' : 'Nueva carpeta')}${folderDialog.group.title ? ` · ${folderDialog.group.title}` : ''}`} label={t('Nombre')} initialValue={folderDialog.rename ? folderDialog.group.title : ''} onCancel={() => setFolderDialog(null)} onSubmit={async (name) => {
      const { group, rename } = folderDialog;
      if (rename) await window.nodus.updateStudyEntity('folder', group.entityId!, { name });
      else await window.nodus.createStudyFolder({ name, courseId: group.scope.courseId, subjectId: group.scope.subjectId, parentId: group.kind === 'folder' ? group.entityId : null });
      setFolderDialog(null); announceStudyWorkspaceChanged();
    }} />}
    {moving && catalog && <StudyMaterialMoveDialog material={moving} workspace={catalog.workspace} onCancel={() => setMoving(null)} onMoved={() => setMoving(null)} />}
  </div>;
}
