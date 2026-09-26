import type { KeyboardEvent } from 'react';
import { Icon } from './ui';
import { t } from '../i18n';

/** neg: only items without it. off: no filter. pos: only items with it. */
export type TriState = 'neg' | 'off' | 'pos';
const ORDER: TriState[] = ['neg', 'off', 'pos'];

/** A three-position switch for one filter: left keeps the items without the property,
 * the centre switches the filter off, right keeps the items with it. Each third is a
 * radio, so it can be clicked directly and the arrow keys move between them. */
export function TriStateSwitch({ value, onChange, label, posLabel, negLabel, testId }: {
  value: TriState;
  onChange: (next: TriState) => void;
  label: string;
  posLabel: string;
  negLabel: string;
  testId?: string;
}) {
  const index = ORDER.indexOf(value);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowRight' ? index + 1 : null;
    if (next === null || next < 0 || next > 2) return;
    event.preventDefault();
    onChange(ORDER[next]);
  };
  const stateLabel = (state: TriState) => state === 'pos' ? posLabel : state === 'neg' ? negLabel : t('Indiferente');
  return (
    <div role="radiogroup" aria-label={label} className={`tri-switch is-${value}`} data-testid={testId} data-state={value} onKeyDown={onKeyDown}>
      <span className="tri-switch-thumb" aria-hidden="true">
        {value === 'pos' && <Icon name="check" size={11} />}
        {value === 'neg' && <Icon name="x" size={11} />}
      </span>
      {ORDER.map((state) => (
        <button
          key={state}
          type="button"
          role="radio"
          aria-checked={value === state}
          tabIndex={value === state ? 0 : -1}
          aria-label={stateLabel(state)}
          title={stateLabel(state)}
          className="tri-switch-stop"
          onClick={() => onChange(state)}
        />
      ))}
    </div>
  );
}
