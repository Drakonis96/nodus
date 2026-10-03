import { Icon } from '../ui';
import { t } from '../../i18n';

export interface EditorialAction {
  id: string;
  label: string;
  icon: string;
  group: string;
  essential?: boolean;
  pinnable?: boolean;
  disabled?: boolean;
  pressed?: boolean;
  shortcut?: string;
  keyShortcuts?: string;
  testId?: string;
  onSelect(): void;
}

function ActionButton({ action, onSelect, pin }: { action: Omit<EditorialAction, 'onSelect'>; onSelect(): void; pin?: boolean }) {
  const label = action.label + (action.shortcut ? ` (${action.shortcut})` : '');
  // The global Nodus layer owns both pointer and keyboard tooltips.
  return <span className="editorial-action-tip">
    <button type="button" className={pin ? 'editorial-action-pin' : 'editorial-action-button'} data-testid={action.testId} data-editorial-action={action.id} title={label} aria-label={action.label} aria-keyshortcuts={action.keyShortcuts} aria-pressed={action.pressed} disabled={action.disabled} onPointerDown={event => { if (event.button === 0) event.preventDefault(); }} onClick={onSelect}>{action.icon === 'formula' ? <span className="editorial-action-formula">ƒx</span> : <Icon name={action.icon} size={15} />}</button>
  </span>;
}

export function EditorialActionBar({ actions, pins, beforeAction, onPreserveSelection, status }: { actions: EditorialAction[]; pins: string[]; beforeAction(): void; onPreserveSelection(): void; status?: string }) {
  const visible = actions.filter(action => action.essential || (action.pinnable !== false && pins.includes(action.id)));
  return <div className="editorial-action-bar" role="toolbar" aria-label={t('Acciones del documento')} onPointerDownCapture={onPreserveSelection} onFocusCapture={onPreserveSelection} onKeyDown={event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (current < 0 || !buttons.length) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    }}>
    <div className="editorial-action-groups">{visible.map((action, index) => <span key={action.id} className={`editorial-action-slot${index && visible[index - 1].group !== action.group ? ' editorial-action-divider' : ''}`}><ActionButton action={action} onSelect={() => { beforeAction(); action.onSelect(); }} /></span>)}</div>
    {status && <span className="editorial-action-status">{status}</span>}
  </div>;
}

export function EditorialActionMenu({ actions, pins, onPinsChange, beforeAction }: { actions: EditorialAction[]; pins: string[]; onPinsChange(pins: string[]): void; beforeAction(): void }) {
  const optional = actions.filter(action => !action.essential);
  return <div className="editorial-action-menu">{optional.map((action, index) => {
    const pinned = pins.includes(action.id) && action.pinnable !== false;
    const groupStart = !index || optional[index - 1].group !== action.group;
    return <div key={action.id} className={groupStart ? 'editorial-action-menu-section' : undefined}>
      {groupStart && <div className="editorial-action-menu-heading">{action.group}</div>}
      <div className="editorial-action-menu-row"><button type="button" data-testid={action.testId ? action.testId + (pinned ? '-menu' : '') : undefined} data-editorial-action={action.id + (pinned ? '-menu' : '')} aria-label={action.label + (pinned ? ` · ${t('Menú')}` : '')} title={action.label + (action.shortcut ? ` (${action.shortcut})` : '')} disabled={action.disabled} aria-pressed={action.pressed} onPointerDown={event => { if (event.button === 0) event.preventDefault(); }} onClick={() => { beforeAction(); action.onSelect(); }}>{action.icon === 'formula' ? <span className="editorial-action-formula">ƒx</span> : <Icon name={action.icon} size={14} />}<span>{action.label}</span></button>
        {action.pinnable !== false && <ActionButton pin action={{ id: `pin-${action.id}`, label: `${t(pinned ? 'Retirar de la barra' : 'Fijar en la barra')}: ${action.label}`, icon: 'pin', group: '', pressed: pinned }} onSelect={() => onPinsChange(pinned ? pins.filter(id => id !== action.id) : [...pins, action.id])} />}
      </div>
    </div>;
  })}</div>;
}
