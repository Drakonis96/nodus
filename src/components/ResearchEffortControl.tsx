import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { ModelRef } from '@shared/types';
import { researchEffortChoices, researchReasoningProfile, type ResearchEffort } from '@shared/researchReasoning';
import { useResearchModelInfo } from '../hooks/useResearchModelInfo';
import { t } from '../i18n';
import { Icon } from './ui';
import './researchEffort.css';

const labels: Record<ResearchEffort, string> = {
  standard: 'Estándar', minimal: 'Mínimo', low: 'Bajo', medium: 'Medio', high: 'Alto',
  xhigh: 'Muy alto', max: 'Máximo', ultra: 'Ultra', on: 'Thinking activado',
};

/**
 * The thinking level for one model: a trigger showing the current level and a balloon with a
 * slider over the levels the model publishes (loaded from the provider's live catalogue
 * where the ladder comes with it). `field` renders the trigger as a form field, for the
 * Deep Research and Immersion forms; the Research chat composer uses the compact one.
 */
export function ResearchEffortControl({ model, value, onChange, disabled, variant = 'composer', testId, className = '' }: {
  model: ModelRef | null; value: ResearchEffort; onChange: (effort: ResearchEffort) => void; disabled: boolean;
  variant?: 'composer' | 'field'; testId?: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const slider = useRef<HTMLInputElement>(null);
  const id = useId();
  const info = useResearchModelInfo(model);
  const profile = useMemo(
    () => researchReasoningProfile(model, info),
    [model?.provider, model?.model, info]
  );
  const choices = useMemo(() => researchEffortChoices(profile), [profile]);
  const index = Math.max(0, choices.indexOf(value));
  const current = choices[index];
  const description = profile.levels.length === 0 ? t('Este modelo no publica un control de thinking.')
    : current !== 'standard' ? t('Más esfuerzo puede mejorar tareas complejas y tardar más.')
    : ['none', 'off'].includes(profile.levels[0]) ? t('Thinking desactivado por defecto.')
    : t('Este modelo requiere thinking; estándar usa el mínimo disponible.');

  useEffect(() => { setOpen(false); }, [model?.provider, model?.model]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(300, window.innerWidth - 24);
      // Above the trigger, as in the composer; below it when there is no room above (a
      // field near the top of a form).
      const height = panel.current?.offsetHeight ?? 170;
      const below = rect.top - 12 < height + 12;
      setPosition({ '--vault-accent': getComputedStyle(trigger.current!).getPropertyValue('--vault-accent').trim() || 'var(--a-500)', position: 'fixed', zIndex: 10060, width,
        left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
        ...(below ? { top: rect.bottom + 8 } : { bottom: window.innerHeight - rect.top + 12 }),
      } as unknown as CSSProperties);
    };
    place();
    slider.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopImmediatePropagation(); setOpen(false); trigger.current?.focus(); }
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  return <>
    <button ref={trigger} type="button" className={`${variant === 'field' ? 'research-effort-field input' : 'research-effort-trigger'} ${className}`} disabled={disabled || !model} data-testid={testId}
      aria-label={`${t('Esfuerzo de thinking')}: ${t(labels[current])}`} aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>
      {variant === 'field' && <Icon name="bulb" size={14} className="research-effort-field-mark" />}
      <span>{t(labels[current])}</span><Icon name="chevronDown" size={16} />
    </button>
    {open && createPortal(<div id={id} ref={panel} role="dialog" aria-label={t('Esfuerzo de thinking')}
      className="research-effort-panel" style={position} onBlur={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== trigger.current) setOpen(false);
      }}>
      <div className="research-effort-title" aria-live="polite">{t(labels[current])}</div>
      {choices.length > 1 && <div className="research-effort-track" style={{ '--effort-progress': `${index / (choices.length - 1) * 100}%` } as CSSProperties}>
        <div className="research-effort-dots" aria-hidden="true">{choices.map(choice => <span key={choice} />)}</div>
        <input ref={slider} type="range" min={0} max={choices.length - 1} step={1} value={index}
          aria-label={t('Esfuerzo de thinking')} aria-valuetext={t(labels[current])} aria-describedby={`${id}-description`}
          onChange={event => onChange(choices[Number(event.target.value)])} />
      </div>}
      <p id={`${id}-description`} className="research-effort-description">{description}</p>
    </div>, document.body)}
  </>;
}
