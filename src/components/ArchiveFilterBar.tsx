import { useState } from 'react';
import type { ArchiveItemKind, ArchiveMatchMode, ArchiveSortKey, Person } from '@shared/types';
import { ARCHIVE_DOC_TYPES, DOC_FACET_DIMENSIONS, type FacetValue } from '@shared/archiveDocTypes';
import { ARCHIVE_SORT_OPTIONS } from '@shared/archiveFilters';
import { Icon } from './ui';
import { useDismissableLayer } from '../hooks';
import { t, pick } from '../i18n';

const facetLabel = (v: FacetValue): string => pick(v);

const KIND_OPTIONS: { id: ArchiveItemKind; label: string }[] = [
  { id: 'image', label: 'Imagen' },
  { id: 'csv', label: 'CSV' },
  { id: 'xlsx', label: 'XLSX' },
  { id: 'pdf', label: 'PDF' },
  { id: 'text', label: 'Texto' },
  { id: 'other', label: 'Otro' },
];

export interface ArchiveFilterBarProps {
  compact?: boolean;
  genealogyOnly?: boolean;
  docTypes?: string[];
  onDocTypesChange?: (v: string[]) => void;
  facets: Record<string, string[]>;
  onFacetsChange: (v: Record<string, string[]>) => void;
  kinds: ArchiveItemKind[];
  onKindsChange: (v: ArchiveItemKind[]) => void;
  tags: string[];
  tagsMode: ArchiveMatchMode;
  onTagsChange: (v: string[]) => void;
  onTagsModeChange: (m: ArchiveMatchMode) => void;
  availableTags: { tag: string; count: number }[];
  personIds: string[];
  personsMode: ArchiveMatchMode;
  onPersonIdsChange: (v: string[]) => void;
  onPersonsModeChange: (m: ArchiveMatchMode) => void;
  persons: Person[];
  yearFrom: string;
  yearTo: string;
  onYearFromChange: (v: string) => void;
  onYearToChange: (v: string) => void;
  sort: ArchiveSortKey;
  onSortChange: (v: ArchiveSortKey) => void;
  activeCount: number;
  onClear: () => void;
  folderIds?: string[];
  onFolderIdsChange?: (v: string[]) => void;
  folders?: { value: string; label: string }[];
}

/** Notion-style filter bar for the archive: multi-select filters (with an any/all
 *  toggle for the two multi-valued properties), a year range, and a sort picker. */
export function ArchiveFilterBar(props: ArchiveFilterBarProps) {
  const setFacet = (dim: string, values: string[]) => {
    const next = { ...props.facets };
    if (values.length) next[dim] = values;
    else delete next[dim];
    props.onFacetsChange(next);
  };
  if (props.compact) return <CompactArchiveFilters {...props} setFacet={setFacet} />;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Heritage-dimension facets — several may be active at once. */}
      {DOC_FACET_DIMENSIONS.map((dim) => (
        <SimpleFilterDropdown
          key={dim.id}
          label={t(dim.label)}
          icon={dim.id === 'genealogia' ? 'tree' : 'folder'}
          options={dim.values.map((v) => ({ value: v.id, label: facetLabel(v) }))}
          selected={props.facets[dim.id] ?? []}
          onChange={(v) => setFacet(dim.id, v)}
          searchable={dim.values.length > 8}
        />
      ))}
      <SimpleFilterDropdown
        label={t('Formato')}
        icon="grid"
        options={KIND_OPTIONS.map((k) => ({ value: k.id, label: t(k.label) }))}
        selected={props.kinds}
        onChange={(v) => props.onKindsChange(v as ArchiveItemKind[])}
      />
      <SimpleFilterDropdown
        label={t('Etiquetas')}
        icon="tag"
        options={props.availableTags.map((x) => ({ value: x.tag, label: x.tag, meta: String(x.count) }))}
        selected={props.tags}
        onChange={props.onTagsChange}
        mode={{ value: props.tagsMode, onChange: props.onTagsModeChange }}
        emptyLabel={t('No hay etiquetas todavía.')}
      />
      <SimpleFilterDropdown
        label={t('Personas')}
        icon="users"
        options={props.persons.map((p) => ({ value: p.personId, label: p.displayName }))}
        selected={props.personIds}
        onChange={props.onPersonIdsChange}
        mode={{ value: props.personsMode, onChange: props.onPersonsModeChange }}
        searchable
        emptyLabel={t('No hay personas todavía.')}
      />

      <YearRangeFilter
        from={props.yearFrom}
        to={props.yearTo}
        onFromChange={props.onYearFromChange}
        onToChange={props.onYearToChange}
      />

      {props.activeCount > 0 && (
        <button
          className="flex items-center gap-1 rounded-md border border-neutral-700 px-2 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800/60"
          onClick={props.onClear}
        >
          <Icon name="x" size={12} /> {t('Limpiar filtros')} ({props.activeCount})
        </button>
      )}

      <select
        className="input ml-auto h-9 w-52 text-xs"
        value={props.sort}
        onChange={(e) => props.onSortChange(e.target.value as ArchiveSortKey)}
        title={t('Ordenar por')}
      >
        {ARCHIVE_SORT_OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {t(o.label)}
          </option>
        ))}
      </select>
    </div>
  );
}

type CompactFilterId = 'docType' | 'folder' | 'person' | 'year' | 'kind' | 'tags' | string;

function CompactArchiveFilters(props: ArchiveFilterBarProps & { setFacet: (dim: string, values: string[]) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [enabled, setEnabled] = useState<Set<CompactFilterId>>(() => {
    const initial = new Set<CompactFilterId>();
    if (props.docTypes?.length) initial.add('docType');
    if (props.folderIds?.length) initial.add('folder');
    if (props.personIds.length) initial.add('person');
    if (props.yearFrom.trim() || props.yearTo.trim()) initial.add('year');
    if (props.kinds.length) initial.add('kind');
    if (props.tags.length) initial.add('tags');
    for (const dim of DOC_FACET_DIMENSIONS) if (props.facets[dim.id]?.length) initial.add(dim.id);
    return initial;
  });
  const menuRef = useDismissableLayer<HTMLDivElement>({ open: menuOpen, onDismiss: () => setMenuOpen(false) });
  const docTypeOptions = ARCHIVE_DOC_TYPES
    .filter((docType) => !props.genealogyOnly || docType.facets.genealogia)
    .map((docType) => ({ value: docType.id, label: pick(docType.labels) }));
  const filters: { id: CompactFilterId; label: string; icon: string; clear: () => void }[] = [
    { id: 'docType', label: t('Tipo de documento'), icon: 'book', clear: () => props.onDocTypesChange?.([]) },
    { id: 'folder', label: t('Carpeta'), icon: 'folder', clear: () => props.onFolderIdsChange?.([]) },
    { id: 'person', label: t('Personas'), icon: 'users', clear: () => props.onPersonIdsChange([]) },
    { id: 'year', label: t('Año'), icon: 'calendar', clear: () => { props.onYearFromChange(''); props.onYearToChange(''); } },
    { id: 'kind', label: t('Formato'), icon: 'grid', clear: () => props.onKindsChange([]) },
    { id: 'tags', label: t('Etiquetas'), icon: 'tag', clear: () => props.onTagsChange([]) },
    ...DOC_FACET_DIMENSIONS.map((dim) => ({
      id: dim.id,
      label: t(dim.label),
      icon: dim.id === 'genealogia' ? 'tree' : dim.id === 'epoca' ? 'clock' : dim.id === 'ambito' ? 'map' : 'layers',
      clear: () => props.setFacet(dim.id, []),
    })),
  ];
  const toggleFilter = (filter: (typeof filters)[number]) => {
    const activating = !enabled.has(filter.id);
    setEnabled((current) => {
      const next = new Set(current);
      if (next.has(filter.id)) {
        next.delete(filter.id);
        filter.clear();
      } else next.add(filter.id);
      return next;
    });
    if (activating) setMenuOpen(false);
  };
  const clearAll = () => {
    setEnabled(new Set());
    props.onClear();
  };

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2" data-testid="archive-compact-filters">
      <div className="relative" ref={menuRef}>
        <button
          className={`group btn h-9 min-h-9 justify-center gap-0 px-2.5 py-0 ${menuOpen || props.activeCount ? 'btn-secondary' : 'btn-ghost border border-neutral-700'}`}
          aria-label={t('Filtros')}
          title={t('Filtros')}
          data-testid="archive-filter-menu-button"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Icon name="settings" size={15} />
          <span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:max-w-28 group-hover:opacity-100 group-focus-within:ml-1.5 group-focus-within:max-w-28 group-focus-within:opacity-100">{t('Filtros')}</span>
          {props.activeCount > 0 && <span className="ml-1 rounded-full bg-indigo-500/20 px-1.5 text-[10px] text-indigo-300">{props.activeCount}</span>}
        </button>
        {menuOpen && (
          <div className="absolute left-0 top-full z-30 mt-1 w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-neutral-800 bg-neutral-950 p-3 shadow-2xl" data-testid="archive-filter-menu">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-200">{t('Añadir filtro')}</span>
              {props.activeCount > 0 && <button className="text-[11px] text-neutral-500 hover:text-neutral-200" onClick={clearAll}>{t('Limpiar filtros')}</button>}
            </div>
            <div className="grid grid-cols-2 gap-1">
              {filters.map((filter) => {
                const active = enabled.has(filter.id);
                return (
                  <button key={filter.id} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${active ? 'bg-indigo-600/15 text-indigo-200' : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'}`} onClick={() => toggleFilter(filter)}>
                    <Icon name={filter.icon} size={14} className={active ? 'text-indigo-400' : 'text-neutral-500'} />
                    <span className="min-w-0 flex-1 truncate">{filter.label}</span>
                    <span className={`grid h-4 w-4 place-items-center rounded-full border ${active ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-neutral-700'}`}>{active && <Icon name="check" size={10} />}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {enabled.has('docType') && <SimpleFilterDropdown label={t('Tipo de documento')} icon="book" options={docTypeOptions} selected={props.docTypes ?? []} onChange={(values) => props.onDocTypesChange?.(values)} searchable />}
      {enabled.has('folder') && <SimpleFilterDropdown label={t('Carpeta')} icon="folder" options={props.folders ?? []} selected={props.folderIds ?? []} onChange={(values) => props.onFolderIdsChange?.(values)} searchable emptyLabel={t('Sin opciones')} />}
      {enabled.has('person') && <SimpleFilterDropdown label={t('Personas')} icon="users" options={props.persons.map((person) => ({ value: person.personId, label: person.displayName }))} selected={props.personIds} onChange={props.onPersonIdsChange} mode={{ value: props.personsMode, onChange: props.onPersonsModeChange }} searchable emptyLabel={t('No hay personas todavía.')} />}
      {enabled.has('year') && <YearRangeFilter from={props.yearFrom} to={props.yearTo} onFromChange={props.onYearFromChange} onToChange={props.onYearToChange} />}
      {enabled.has('kind') && <SimpleFilterDropdown label={t('Formato')} icon="grid" options={KIND_OPTIONS.map((kind) => ({ value: kind.id, label: t(kind.label) }))} selected={props.kinds} onChange={(values) => props.onKindsChange(values as ArchiveItemKind[])} />}
      {enabled.has('tags') && <SimpleFilterDropdown label={t('Etiquetas')} icon="tag" options={props.availableTags.map((tag) => ({ value: tag.tag, label: tag.tag, meta: String(tag.count) }))} selected={props.tags} onChange={props.onTagsChange} mode={{ value: props.tagsMode, onChange: props.onTagsModeChange }} emptyLabel={t('No hay etiquetas todavía.')} />}
      {DOC_FACET_DIMENSIONS.map((dim) => enabled.has(dim.id) ? <SimpleFilterDropdown key={dim.id} label={t(dim.label)} icon={dim.id === 'genealogia' ? 'tree' : dim.id === 'epoca' ? 'clock' : dim.id === 'ambito' ? 'map' : 'layers'} options={dim.values.map((value) => ({ value: value.id, label: facetLabel(value) }))} selected={props.facets[dim.id] ?? []} onChange={(values) => props.setFacet(dim.id, values)} searchable={dim.values.length > 8} /> : null)}

      <select className="input ml-auto h-9 w-52 text-xs" value={props.sort} onChange={(event) => props.onSortChange(event.target.value as ArchiveSortKey)} title={t('Ordenar por')} aria-label={t('Ordenar por')}>
        {ARCHIVE_SORT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{t(option.label)}</option>)}
      </select>
    </div>
  );
}

function DropdownButton({
  label,
  icon,
  count,
  active,
  onClick,
}: {
  label: string;
  icon: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs ${
        active ? 'border-indigo-600 bg-indigo-600/15 text-indigo-200' : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800/60'
      }`}
    >
      <Icon name={icon} size={13} />
      {label}
      {count > 0 && <span className="rounded-full bg-neutral-800 px-1.5 text-[10px] text-neutral-300">{count}</span>}
      <Icon name="chevronDown" size={11} className="opacity-60" />
    </button>
  );
}

function ModeToggle({ mode, onChange }: { mode: ArchiveMatchMode; onChange: (m: ArchiveMatchMode) => void }) {
  return (
    <div className="mb-2 flex overflow-hidden rounded-md border border-neutral-800 text-[11px]">
      <button
        className={`flex-1 px-2 py-1 ${mode === 'any' ? 'bg-indigo-600/20 text-indigo-200' : 'text-neutral-500 hover:bg-neutral-900'}`}
        onClick={() => onChange('any')}
        title={t('El documento tiene al menos una de las seleccionadas')}
      >
        {t('Cualquiera')}
      </button>
      <button
        className={`flex-1 border-l border-neutral-800 px-2 py-1 ${
          mode === 'all' ? 'bg-indigo-600/20 text-indigo-200' : 'text-neutral-500 hover:bg-neutral-900'
        }`}
        onClick={() => onChange('all')}
        title={t('El documento tiene todas las seleccionadas')}
      >
        {t('Todas (AND)')}
      </button>
    </div>
  );
}

/** Flat, checkbox multi-select dropdown. Optional any/all mode toggle and search box. */
function SimpleFilterDropdown({
  label,
  icon,
  options,
  selected,
  onChange,
  mode,
  searchable,
  emptyLabel,
}: {
  label: string;
  icon: string;
  options: { value: string; label: string; meta?: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
  mode?: { value: ArchiveMatchMode; onChange: (m: ArchiveMatchMode) => void };
  searchable?: boolean;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useDismissableLayer<HTMLDivElement>({ open, onDismiss: () => setOpen(false) });

  const filtered = searchable && q.trim() ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())) : options;

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  return (
    <div className="relative" ref={ref}>
      <DropdownButton label={label} icon={icon} count={selected.length} active={selected.length > 0} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-60 rounded-md border border-neutral-800 bg-neutral-950 p-2 shadow-2xl">
          {mode && selected.length > 1 && <ModeToggle mode={mode.value} onChange={mode.onChange} />}
          {searchable && (
            <input
              className="input mb-1.5 h-7 w-full text-xs"
              placeholder={t('Buscar…')}
              value={q}
              autoFocus
              onChange={(e) => setQ(e.target.value)}
            />
          )}
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {options.length === 0 ? (
              <p className="px-1 py-3 text-center text-xs text-neutral-600">{emptyLabel ?? t('Sin opciones')}</p>
            ) : filtered.length === 0 ? (
              <p className="px-1 py-3 text-center text-xs text-neutral-600">{t('Sin coincidencias')}</p>
            ) : (
              filtered.map((o) => (
                <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-neutral-900">
                  <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                  <span className="min-w-0 flex-1 truncate text-neutral-200">{o.label}</span>
                  {o.meta && <span className="shrink-0 text-neutral-600">{o.meta}</span>}
                </label>
              ))
            )}
          </div>
          {selected.length > 0 && (
            <button className="mt-1.5 text-[11px] text-neutral-500 hover:underline" onClick={() => onChange([])}>
              {t('Limpiar')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function YearRangeFilter({
  from,
  to,
  onFromChange,
  onToChange,
}: {
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismissableLayer<HTMLDivElement>({ open, onDismiss: () => setOpen(false) });
  const active = Boolean(from.trim() || to.trim());
  const label = active ? `${from.trim() || '…'}–${to.trim() || '…'}` : t('Año');

  return (
    <div className="relative" ref={ref}>
      <DropdownButton label={label} icon="calendar" count={0} active={active} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-52 rounded-md border border-neutral-800 bg-neutral-950 p-2 shadow-2xl">
          <div className="flex items-center gap-1.5">
            <input
              className="input h-8 w-full text-xs"
              type="number"
              placeholder={t('Desde')}
              value={from}
              onChange={(e) => onFromChange(e.target.value)}
            />
            <span className="text-neutral-600">–</span>
            <input
              className="input h-8 w-full text-xs"
              type="number"
              placeholder={t('Hasta')}
              value={to}
              onChange={(e) => onToChange(e.target.value)}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-neutral-600">{t('Año del documento (según su fecha registrada), no el de subida.')}</p>
          {active && (
            <button
              className="mt-1 text-[11px] text-neutral-500 hover:underline"
              onClick={() => {
                onFromChange('');
                onToChange('');
              }}
            >
              {t('Limpiar')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
