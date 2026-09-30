import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../ui';
import { t, tx } from '../../i18n';
import { useDrift } from './DriftProvider';
import type { DriftSort } from './driftState';

const OPTIONS: Array<{ value: DriftSort; icon: string; label: string }> = [
  { value: 'recommended', icon: 'star', label: 'Recomendado' },
  { value: 'alphabetical', icon: 'sortAlphabetical', label: 'Alfabético' },
  { value: 'type', icon: 'layers', label: 'Por tipo' },
  { value: 'usage', icon: 'flame', label: 'Más utilizados' },
];

export function DriftSortMenu() {
  const drift = useDrift();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const selected = OPTIONS.find((option) => option.value === drift.sort)!;
  const close = () => { setOpen(false); triggerRef.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      setOpen(false); triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const buttons = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[index]?.focus();
  };

  return <div ref={rootRef} className="drift-sort" onBlur={(event) => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }}>
    <button ref={triggerRef} type="button" className="drift-sort-trigger" data-testid="drift-sort-toggle"
      aria-label={tx('Ordenar: {order}', { order: t(selected.label) })} title={tx('Ordenar: {order}', { order: t(selected.label) })}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen((value) => !value)} onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
      }}><Icon name="sort" size={18} /></button>
    {open && <div id={menuId} role="menu" aria-label={t('Ordenar por')} className="drift-sort-menu" data-testid="drift-sort-menu" onKeyDown={keyboard}>
      <p>{t('Ordenar por')}</p>
      {OPTIONS.map((option) => <button key={option.value} type="button" role="menuitemradio" tabIndex={-1} aria-checked={drift.sort === option.value}
        data-testid={`drift-sort-${option.value}`} onClick={() => { drift.setSort(option.value); close(); }}>
        <Icon name={option.icon} size={16} /><span>{t(option.label)}</span>{drift.sort === option.value && <Icon name="check" size={14} />}
      </button>)}
    </div>}
  </div>;
}
