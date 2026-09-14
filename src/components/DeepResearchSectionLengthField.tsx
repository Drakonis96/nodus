import { useEffect, useId, useRef, useState } from 'react';
import {
  DEEP_RESEARCH_SECTION_LENGTH_MAX,
  DEEP_RESEARCH_SECTION_LENGTH_MIN,
  DEEP_RESEARCH_SECTION_LENGTH_OPTIONS,
  deepResearchSectionLengthChoice,
  normalizeDeepResearchSectionLength,
  validateDeepResearchSectionLength,
  type DeepResearchSectionLength,
} from '@shared/deepResearchSectionLength';
import { t, tx } from '../i18n';

/**
 * "Extensión orientativa de cada sección", shared by every Deep Research composer
 * (Academic/Study/Teaching/Genealogy in DeepResearchView, Database Deep Research,
 * and the Server Web database composer) so the option list, the validation and the
 * accessible error wiring cannot drift between them.
 *
 * `onChange` only ever emits a value the pipelines accept: `'auto'` or a validated
 * word count. While a custom entry is invalid the parent keeps the last good value
 * and `onValidityChange` lets the composer refuse to submit.
 */
export function DeepResearchSectionLengthField({
  value,
  onChange,
  onValidityChange,
  testIdPrefix = 'deep-research-section-length',
  labelClassName = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-500',
  selectClassName = 'input w-full min-w-0 text-sm',
  className = 'block min-w-0',
}: {
  value: DeepResearchSectionLength;
  onChange: (value: DeepResearchSectionLength) => void;
  onValidityChange?: (valid: boolean) => void;
  testIdPrefix?: string;
  labelClassName?: string;
  selectClassName?: string;
  className?: string;
}) {
  const normalized = normalizeDeepResearchSectionLength(value);
  const propChoice = deepResearchSectionLengthChoice(normalized);
  /**
   * Which row is shown. It cannot be derived from `value` alone: 10.000 typed into
   * Custom and 10.000 picked from the preset row are the same request, so following
   * the prop would slam the number field shut the moment a typed value happened to
   * match a preset.
   */
  const [customMode, setCustomMode] = useState(propChoice === 'custom');
  const [custom, setCustom] = useState(() => (propChoice === 'custom' ? String(normalized) : ''));
  const [error, setError] = useState<string | null>(null);
  const helpId = useId();
  const errorId = useId();
  /** The last value this control emitted, so an EXTERNAL change is recognisable. */
  const emitted = useRef<DeepResearchSectionLength>(normalized);

  const emit = (next: DeepResearchSectionLength) => {
    emitted.current = next;
    onChange(next);
  };

  // Reusing a saved prompt (or a composer reset after queueing) replaces `value`
  // from outside. Only then does the row follow the prop, or the field would keep
  // showing a length the report is no longer going to be written to.
  useEffect(() => {
    if (emitted.current === normalized) return;
    emitted.current = normalized;
    setCustomMode(propChoice === 'custom');
    setCustom(propChoice === 'custom' ? String(normalized) : '');
    setError(null);
  }, [normalized, propChoice]);

  useEffect(() => {
    onValidityChange?.(error === null);
  }, [error, onValidityChange]);

  const choice: typeof propChoice = customMode ? 'custom' : propChoice;

  const message = (raw: string) =>
    tx(raw, { min: DEEP_RESEARCH_SECTION_LENGTH_MIN.toLocaleString(), max: DEEP_RESEARCH_SECTION_LENGTH_MAX.toLocaleString() });

  return (
    <label className={className}>
      <span className={labelClassName}>{t('Extensión orientativa de cada sección')}</span>
      <select
        data-testid={testIdPrefix}
        className={selectClassName}
        value={String(choice)}
        aria-describedby={error ? errorId : helpId}
        onChange={(event) => {
          const next = event.target.value;
          if (next === 'custom') {
            setCustomMode(true);
            // Opening Custom does not change the report yet: the last valid value
            // stays in effect until a valid number is typed.
            const seeded = custom || (typeof normalized === 'number' ? String(normalized) : '');
            setCustom(seeded);
            const check = validateDeepResearchSectionLength(seeded);
            setError(check.ok ? null : message(check.message));
            if (check.ok) emit(check.value);
            return;
          }
          setCustomMode(false);
          setError(null);
          emit(next === 'auto' ? 'auto' : Number(next));
        }}
      >
        {DEEP_RESEARCH_SECTION_LENGTH_OPTIONS.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>{t(option.label)}</option>
        ))}
      </select>
      {customMode && (
        <span className="mt-1.5 block">
          <input
            data-testid={`${testIdPrefix}-custom`}
            className={`${selectClassName} ${error ? 'border-rose-500' : ''}`}
            type="number"
            inputMode="numeric"
            min={DEEP_RESEARCH_SECTION_LENGTH_MIN}
            max={DEEP_RESEARCH_SECTION_LENGTH_MAX}
            step={50}
            value={custom}
            aria-label={t('Palabras por sección')}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : helpId}
            placeholder={t('Palabras por sección')}
            onChange={(event) => {
              const raw = event.target.value;
              setCustom(raw);
              const check = validateDeepResearchSectionLength(raw);
              if (check.ok) {
                setError(null);
                emit(check.value);
              } else {
                setError(message(check.message));
              }
            }}
          />
          {error && (
            <span
              id={errorId}
              role="alert"
              data-testid={`${testIdPrefix}-error`}
              className="mt-1 block text-[11px] leading-4 text-rose-500"
            >
              {error}
            </span>
          )}
        </span>
      )}
      <span id={helpId} data-testid={`${testIdPrefix}-help`} className="mt-1 block text-[11px] leading-4 text-neutral-500">
        {t('Palabras por sección, no del informe entero. Es una orientación: si la evidencia se agota antes, la sección termina antes en lugar de repetirse o rellenar.')}
      </span>
    </label>
  );
}
