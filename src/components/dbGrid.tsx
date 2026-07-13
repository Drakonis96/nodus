/**
 * Reusable database-grid primitives — the presentation/editing engine shared by the
 * Databases mode ([src/views/DatabasesView.tsx]) and the genealogy Archive
 * ([src/views/ArchiveView.tsx]). Extracted so the Archive can render a fixed,
 * preconfigured column schema with the SAME look and inline editing as a real
 * database, without duplicating the cell editors.
 *
 * Only the type-agnostic, self-contained pieces live here (anchoring, chip styling,
 * width helpers, and the plain text/long-text/checkbox cell editors). The
 * Databases-specific cells (select/attachment/ai/relation/rollup) that talk to the
 * databases IPC stay in DatabasesView.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui';
import { Markdown } from './Markdown';
import { decodeCheckbox, decodeNumber, encodeCheckbox, type DatabaseColumnType } from '@shared/databases';
import { t } from '../i18n';

// ── Layout constants ────────────────────────────────────────────────────────────
export const ROW_HEIGHT = 40;
export const GUTTER_WIDTH = 58;
export const ADD_COLUMN_WIDTH = 44;
export const MIN_COL_WIDTH = 80;
export const MAX_COL_WIDTH = 640;

/** Palette offered when creating/recoloring a select option or a chip. */
export const OPTION_COLORS = ['#ef4444', '#f59e0b', '#eab308', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];

/**
 * Anchor a portaled popover to a trigger element. Body cells are `overflow-hidden`
 * (to truncate their content), so cell editors render in a `document.body` portal
 * with fixed coordinates derived here. The popover REPOSITIONS on scroll/resize
 * (rather than closing) so it stays glued to its cell and never vanishes mid-edit.
 * `fixedWidth` pins a width; otherwise it matches the cell width (>= `minWidth`).
 * `place` puts it just below the cell ('below') or over its top-left ('over').
 */
export function useAnchoredCoords(
  open: boolean,
  ref: React.RefObject<HTMLElement>,
  fixedWidth: number | null,
  minWidth: number,
  place: 'below' | 'over'
): { top: number; left: number; width: number } | null {
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  useEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    const compute = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const width = fixedWidth ?? Math.max(minWidth, r.width);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const top = Math.max(8, place === 'over' ? r.top : r.bottom + 4);
      setCoords({ top, left, width });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open, ref, fixedWidth, minWidth, place]);
  return coords;
}

export function defaultColumnWidth(type: DatabaseColumnType): number {
  switch (type) {
    case 'title':
      return 240;
    case 'checkbox':
      return 90;
    case 'number':
    case 'date':
    case 'time':
      return 150;
    case 'attachment':
    case 'ai_image':
      return 220;
    case 'relation':
      return 220;
    default:
      return 190;
  }
}

/** Chip background/border/text derived from an option color (or a neutral grey). */
export function chipStyle(color: string | null): React.CSSProperties {
  const c = color || '#6b7280';
  return { backgroundColor: `${c}22`, color: c, borderColor: `${c}66` };
}

// ── Cell editors (type-agnostic; value/onChange contract) ───────────────────────

/** Single-line editable cell for text / number / date / time columns. */
export function TextCell({
  value,
  onChange,
  inputType,
  align = 'left',
}: {
  value: string | null;
  onChange: (raw: string | null) => void;
  inputType: 'text' | 'number' | 'date' | 'time';
  align?: 'left' | 'right';
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim() === '' ? null : draft;
    if (next !== value) onChange(next);
  };

  if (editing) {
    return (
      <input
        type={inputType}
        className={`w-full h-full bg-transparent px-2 text-sm outline-none ${align === 'right' ? 'text-right' : ''}`}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(value ?? '');
            setEditing(false);
          }
        }}
      />
    );
  }
  const display = inputType === 'number' && value != null ? String(decodeNumber(value) ?? value) : value ?? '';
  return (
    <button
      className={`w-full h-full px-2 text-sm truncate text-left hover:bg-neutral-800/40 ${align === 'right' ? 'text-right' : ''} ${
        value == null ? 'text-neutral-600' : ''
      }`}
      onClick={() => setEditing(true)}
    >
      {display || ' '}
    </button>
  );
}

/**
 * Title / long-text cell. Shows the value (rendered as Markdown for text columns) on
 * one line; clicking opens a popover with the FULL text in a growing textarea plus a
 * Markdown preview toggle. Commits on close.
 */
export function LongTextCell({ value, onChange, markdown }: { value: string | null; onChange: (raw: string | null) => void; markdown: boolean }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);

  const commit = () => {
    setOpen(false);
    setPreview(false);
    const next = draft.trim() === '' ? null : draft;
    if (next !== value) onChange(next);
  };

  // Portaled editor so the full-text popover escapes the cell clip. Anchored over the
  // cell's top-left and at least 380px wide so long text wraps and is fully visible.
  const btnRef = useRef<HTMLButtonElement>(null);
  const coords = useAnchoredCoords(open, btnRef, null, 380, 'over');

  return (
    <div className="w-full h-full">
      <button
        ref={btnRef}
        className={`w-full h-full px-2 text-sm truncate text-left hover:bg-neutral-800/40 ${value == null ? 'text-neutral-600' : ''}`}
        onClick={() => setOpen(true)}
        title={value ?? ''}
      >
        {value ? value.replace(/\s+/g, ' ') : ' '}
      </button>
      {open && coords &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={commit} />
            <div
              className="fixed z-50 card-modal p-2 text-sm shadow-xl"
              style={{ top: coords.top, left: coords.left, width: coords.width }}
            >
              {markdown && (
                <div className="flex items-center justify-end gap-1 mb-1">
                  <button
                    className={`text-[11px] px-1.5 py-0.5 rounded ${!preview ? 'bg-neutral-800 text-neutral-200' : 'text-neutral-500 hover:text-neutral-300'}`}
                    onClick={() => setPreview(false)}
                  >
                    {t('Editar')}
                  </button>
                  <button
                    className={`text-[11px] px-1.5 py-0.5 rounded ${preview ? 'bg-neutral-800 text-neutral-200' : 'text-neutral-500 hover:text-neutral-300'}`}
                    onClick={() => setPreview(true)}
                  >
                    {t('Vista previa')}
                  </button>
                </div>
              )}
              {markdown && preview ? (
                <div className="min-h-[6rem] max-h-72 overflow-y-auto px-1">
                  {draft.trim() ? <Markdown content={draft} className="text-sm" /> : <span className="text-neutral-600 text-xs">{t('Sin contenido')}</span>}
                </div>
              ) : (
                <textarea
                  className="input w-full min-h-[6rem] max-h-72 resize-y text-sm"
                  autoFocus
                  value={draft}
                  placeholder={markdown ? t('Escribe… (admite Markdown)') : undefined}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setDraft(value ?? '');
                      setOpen(false);
                      setPreview(false);
                    }
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
                  }}
                />
              )}
              <div className="flex justify-end mt-1.5">
                <button className="btn btn-primary py-1 px-2 text-xs" onClick={commit}>
                  {t('Guardar')}
                </button>
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}

export interface ChipOption {
  id: string;
  label: string;
  color?: string | null;
}

/**
 * Chip-based single/multi selection cell over an arbitrary option list. Used by the
 * genealogy Archive for its fixed "Tipo de documento" (single), "Etiquetas" and
 * "Carpeta" (multi) columns. Unlike the Databases SelectCell it is decoupled from the
 * databases option store: options and mutations are injected, so the Archive can back
 * them with doc types / tags / folders. The dropdown is portaled to `document.body`
 * (cells are `overflow-hidden`).
 */
export function ChipSelectCell({
  values,
  options,
  multi,
  onChange,
  allowCreate = false,
  onCreate,
  placeholder,
}: {
  values: string[];
  options: ChipOption[];
  multi: boolean;
  onChange: (nextIds: string[]) => void;
  allowCreate?: boolean;
  onCreate?: (label: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const coords = useAnchoredCoords(open, btnRef, null, 220, 'below');

  const byId = new Map(options.map((o) => [o.id, o]));
  const query = q.trim().toLowerCase();
  const filtered = options.filter((o) => !query || o.label.toLowerCase().includes(query));
  const exact = options.some((o) => o.label.toLowerCase() === query);

  const toggle = (id: string) => {
    if (values.includes(id)) onChange(values.filter((v) => v !== id));
    else onChange(multi ? [...values, id] : [id]);
    if (!multi) {
      setOpen(false);
      setQ('');
    }
  };
  const removeChip = (id: string) => onChange(values.filter((v) => v !== id));

  return (
    <div className="w-full h-full">
      <button
        ref={btnRef}
        className="flex w-full h-full items-center gap-1 overflow-hidden px-2 text-left hover:bg-neutral-800/40"
        onClick={() => setOpen((o) => !o)}
      >
        {values.length === 0 ? (
          <span className="truncate text-sm text-neutral-600">{placeholder ?? ' '}</span>
        ) : (
          <span className="flex flex-nowrap items-center gap-1 overflow-hidden">
            {values.map((id) => {
              const opt = byId.get(id);
              return (
                <span
                  key={id}
                  className="whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px]"
                  style={chipStyle(opt?.color ?? null)}
                >
                  {opt?.label ?? id}
                </span>
              );
            })}
          </span>
        )}
      </button>
      {open && coords &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div
              className="fixed z-50 card-modal p-1.5 text-sm shadow-xl"
              style={{ top: coords.top, left: coords.left, width: coords.width }}
            >
              <input
                className="input h-7 w-full text-xs"
                placeholder={allowCreate ? t('Buscar o crear…') : t('Buscar…')}
                value={q}
                autoFocus
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && allowCreate && q.trim() && !exact) {
                    onCreate?.(q.trim());
                    setQ('');
                  }
                  if (e.key === 'Escape') setOpen(false);
                }}
              />
              <div className="mt-1 max-h-56 overflow-y-auto">
                {/* Selected chips get a remove affordance at the top when multi. */}
                {multi && values.length > 0 && (
                  <div className="mb-1 flex flex-wrap gap-1 border-b border-neutral-800 px-1 pb-1.5">
                    {values.map((id) => {
                      const opt = byId.get(id);
                      return (
                        <span
                          key={id}
                          className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
                          style={chipStyle(opt?.color ?? null)}
                        >
                          {opt?.label ?? id}
                          <button className="opacity-70 hover:opacity-100" onClick={() => removeChip(id)}>
                            <Icon name="x" size={10} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                {filtered.length === 0 && !(allowCreate && query && !exact) ? (
                  <p className="px-2 py-2 text-center text-xs text-neutral-600">{t('Sin opciones')}</p>
                ) : (
                  filtered.map((o) => (
                    <button
                      key={o.id}
                      onClick={() => toggle(o.id)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-neutral-800"
                    >
                      <span className="w-3 h-3 rounded-full border" style={chipStyle(o.color ?? null)} />
                      <span className="flex-1 truncate">{o.label}</span>
                      {values.includes(o.id) && <Icon name="check" size={12} className="text-indigo-400" />}
                    </button>
                  ))
                )}
                {allowCreate && query && !exact && (
                  <button
                    onClick={() => {
                      onCreate?.(q.trim());
                      setQ('');
                    }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-indigo-300 hover:bg-neutral-800"
                  >
                    <Icon name="plus" size={12} /> {t('Crear')} “{q.trim()}”
                  </button>
                )}
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}

export function CheckboxCell({
  value,
  onChange,
  align = 'center',
}: {
  value: string | null;
  onChange: (raw: string | null) => void;
  align?: 'center' | 'start';
}) {
  const checked = decodeCheckbox(value);
  return (
    <button
      className={`w-full h-full flex items-center hover:bg-neutral-800/40 ${align === 'start' ? 'justify-start px-3 py-2' : 'justify-center'}`}
      onClick={() => onChange(encodeCheckbox(!checked))}
    >
      <span
        className={`w-4 h-4 rounded border flex items-center justify-center ${
          checked ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-neutral-600'
        }`}
      >
        {checked && <Icon name="check" size={11} />}
      </span>
    </button>
  );
}
