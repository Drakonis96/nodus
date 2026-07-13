import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  archiveDocTypesByCategory,
  getArchiveDocType,
  ARCHIVE_DOC_TYPES,
  type ArchiveDocTypeDef,
} from '@shared/archiveDocTypes';
import { searchDocTypes } from '@shared/docTypeSearch';
import { Icon } from './ui';
import { useAnchoredCoords } from './dbGrid';
import { t, getActiveLang } from '../i18n';

/** Bilingual label for a document type (labels live in-data, not in the i18n table). */
export function docTypeLabel(id: string | null | undefined): string {
  const def = getArchiveDocType(id);
  if (!def) return '';
  return getActiveLang() === 'en' ? def.labelEn : def.label;
}

function defLabel(def: ArchiveDocTypeDef): string {
  return getActiveLang() === 'en' ? def.labelEn : def.label;
}

/**
 * Searchable, grouped document-type picker over the ~190-type taxonomy. Typing filters
 * with literal + fuzzy/synonym matching (see shared/docTypeSearch); with no query the
 * types are grouped by category. The popover is portaled to `document.body` so it
 * escapes clipped/overflow-hidden containers (grid cells). `pool` restricts the set
 * (e.g. only genealogy-relevant types).
 */
export function DocTypePicker({
  value,
  onChange,
  pool,
  placeholder,
  allowClear = true,
  className,
  fill = false,
  genealogyFilter = false,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  pool?: ArchiveDocTypeDef[];
  placeholder?: string;
  allowClear?: boolean;
  className?: string;
  fill?: boolean;
  /** Show a "genealogy only" toggle in the popover, ON by default: the ~190 types
   *  narrow to the ones flagged useful for genealogy. The user can turn it off. */
  genealogyFilter?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [genOnly, setGenOnly] = useState(genealogyFilter);
  const btnRef = useRef<HTMLButtonElement>(null);
  const coords = useAnchoredCoords(open, btnRef, null, 300, 'below');

  const basePool = pool ?? ARCHIVE_DOC_TYPES;
  const poolTypes = useMemo(
    () => (genOnly ? basePool.filter((d) => d.facets.genealogia) : basePool),
    [basePool, genOnly]
  );
  const poolIds = useMemo(() => new Set(poolTypes.map((d) => d.id)), [poolTypes]);
  const groups = useMemo(
    () => archiveDocTypesByCategory().map((g) => ({ ...g, types: g.types.filter((d) => poolIds.has(d.id)) })).filter((g) => g.types.length),
    [poolIds]
  );
  const results = useMemo(() => (q.trim() ? searchDocTypes(q, { pool: poolTypes }) : null), [q, poolTypes]);

  const label = value ? docTypeLabel(value) : '';
  const close = () => {
    setOpen(false);
    setQ('');
  };
  const choose = (id: string | null) => {
    onChange(id);
    close();
  };

  const trigger = fill
    ? `flex h-full w-full items-center gap-1 px-2 text-left text-sm hover:bg-neutral-800/40 ${value ? '' : 'text-neutral-600'}`
    : className ?? `input flex h-9 w-full items-center gap-1 text-sm ${value ? '' : 'text-neutral-500'}`;

  return (
    <>
      <button ref={btnRef} type="button" className={trigger} onClick={() => setOpen((o) => !o)}>
        <span className="min-w-0 flex-1 truncate">{label || placeholder || t('Sin clasificar')}</span>
        <Icon name="chevronDown" size={13} className="shrink-0 opacity-60" />
      </button>
      {open && coords &&
        createPortal(
          <>
            {/* Dismiss backdrop + popover sit above the containing modal (z-50/z-70)
                so an outside click closes the picker even when it's opened from
                inside a modal — a plain z-40 backdrop was trapped behind it. */}
            <div className="fixed inset-0 z-[80]" onClick={close} />
            <div
              className="fixed z-[81] card-modal p-2 text-sm shadow-2xl"
              style={{ top: coords.top, left: coords.left, width: Math.max(coords.width, 300) }}
            >
              <div className="relative mb-1.5">
                <Icon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                <input
                  className="input input-with-leading-icon h-8 w-full text-sm"
                  placeholder={t('Buscar tipo de documento…')}
                  value={q}
                  autoFocus
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') close();
                    if (e.key === 'Enter' && results && results.length) choose(results[0].id);
                  }}
                />
              </div>
              {genealogyFilter && (
                <button
                  type="button"
                  className={`mb-1.5 flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] ${
                    genOnly ? 'text-indigo-300' : 'text-neutral-500 hover:bg-neutral-800'
                  }`}
                  onClick={() => setGenOnly((v) => !v)}
                >
                  <Icon name={genOnly ? 'check' : 'tree'} size={12} className="shrink-0" />
                  {t('Solo tipos útiles para genealogía')}
                </button>
              )}
              <div className="max-h-72 overflow-y-auto">
                {allowClear && !q.trim() && (
                  <button
                    className="block w-full truncate rounded px-2 py-1 text-left text-xs text-neutral-500 hover:bg-neutral-800"
                    onClick={() => choose(null)}
                  >
                    {t('Sin clasificar')}
                  </button>
                )}
                {results ? (
                  results.length === 0 ? (
                    <p className="px-2 py-3 text-center text-xs text-neutral-600">{t('Sin resultados')}</p>
                  ) : (
                    results.map((def) => (
                      <button
                        key={def.id}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-neutral-800 ${def.id === value ? 'bg-neutral-800/60' : ''}`}
                        onClick={() => choose(def.id)}
                      >
                        <span className="min-w-0 flex-1 truncate text-neutral-200">{defLabel(def)}</span>
                        {def.id === value && <Icon name="check" size={12} className="text-indigo-400" />}
                      </button>
                    ))
                  )
                ) : (
                  groups.map((g) => (
                    <div key={g.category} className="mb-1">
                      <div className="px-1 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600">{t(g.label)}</div>
                      {g.types.map((def) => (
                        <button
                          key={def.id}
                          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-neutral-800 ${def.id === value ? 'bg-neutral-800/60' : ''}`}
                          onClick={() => choose(def.id)}
                        >
                          <span className="min-w-0 flex-1 truncate text-neutral-200">{defLabel(def)}</span>
                          {def.id === value && <Icon name="check" size={12} className="text-indigo-400" />}
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </div>
          </>,
          document.body
        )}
    </>
  );
}

/** Back-compat wrapper: the old grouped <select>, now the searchable picker. */
export function DocTypeSelect({
  value,
  onChange,
  emptyLabel,
  className,
  pool,
  genealogyFilter = false,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  emptyLabel?: string;
  className?: string;
  pool?: ArchiveDocTypeDef[];
  genealogyFilter?: boolean;
}) {
  return (
    <DocTypePicker
      value={value}
      onChange={onChange}
      pool={pool}
      placeholder={emptyLabel ? t(emptyLabel) : undefined}
      className={className}
      genealogyFilter={genealogyFilter}
    />
  );
}

/** The optional metadata form for a document type. Empty when no type is chosen. */
export function DocTypeForm({
  docType,
  values,
  onChange,
}: {
  docType: string | null;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const def = getArchiveDocType(docType);
  if (!def) return null;
  return (
    <div className="space-y-2">
      {def.fields.map((field) =>
        field.type === 'textarea' ? (
          <label key={field.key} className="block space-y-1">
            <span className="text-xs text-neutral-500">{t(field.label)}</span>
            <textarea
              className="input min-h-[3.5rem] w-full text-sm"
              value={values[field.key] ?? ''}
              placeholder={field.placeholder}
              onChange={(e) => onChange(field.key, e.target.value)}
            />
          </label>
        ) : (
          <label key={field.key} className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-2">
            <span className="text-xs text-neutral-500">{t(field.label)}</span>
            <input
              className="input h-8 w-full text-sm"
              type={field.type === 'number' ? 'number' : 'text'}
              value={values[field.key] ?? ''}
              placeholder={field.placeholder}
              onChange={(e) => onChange(field.key, e.target.value)}
            />
          </label>
        )
      )}
    </div>
  );
}
