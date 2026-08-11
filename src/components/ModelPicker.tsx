import { useEffect, useRef, useState } from 'react';
import type { AppSettings, CodexReasoningEffort, ModelRef } from '@shared/types';
import { isSubscriptionProvider } from '@shared/providers';
import { modelRefSupportsExtraction } from '@shared/localAiModels';
import {
  codexReasoningCatalog,
  modelRefWithReasoning,
  reasoningChoiceFor,
  type CodexReasoningCatalog,
} from '@shared/codexReasoning';
import { modelLabel, sameModel, sortModelRefs } from './ui';
import { Icon } from './ui';
import { t, tx } from '../i18n';
import './modelPicker.css';

/**
 * Shown next to the pickers that drive high-volume work (scans, extraction, vision,
 * summaries, fusion). Those providers bill a personal plan with weekly and monthly
 * caps instead of pay-per-use credit, so a single full-corpus run can exhaust the
 * quota. This informs rather than blocks: the choice stays the user's.
 */
export function SubscriptionQuotaNotice({ model }: { model: ModelRef | null | undefined }) {
  if (!model || !isSubscriptionProvider(model.provider)) return null;
  return (
    <p
      role="note"
      data-testid="subscription-quota-notice"
      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
    >
      {t('Este modelo consume la cuota de tu suscripción, no crédito de API. Un análisis completo del corpus puede agotar el límite semanal o mensual de tu plan.')}
    </p>
  );
}

/**
 * Shown next to the two pickers that drive idea extraction (the basic-mode generic model and the
 * dedicated extraction model) when the chosen model can't be trusted to extract — today the small
 * built-in vision models (Qwen3.5-0.8B, LFM2.5-VL), which loop inside the JSON and return no ideas.
 * They stay valid for chat/vision, so this warns rather than silently dropping the selection.
 */
export function ExtractionCapabilityNotice({ model }: { model: ModelRef | null | undefined }) {
  if (modelRefSupportsExtraction(model)) return null;
  return (
    <p
      role="note"
      data-testid="extraction-capability-notice"
      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
    >
      {t('Este modelo local es de visión y no extrae ideas de forma fiable (tiende a divagar y no cerrar el JSON). Para extracción, elige Gemma 4 E2B u otro modelo mayor.')}
    </p>
  );
}

export function codexReasoningLabel(effort: CodexReasoningEffort): string {
  switch (effort) {
    case 'none': return t('Ninguno');
    case 'minimal': return t('Mínimo');
    case 'low': return t('Bajo');
    case 'medium': return t('Medio');
    case 'high': return t('Alto');
    case 'xhigh': return t('Muy alto');
    case 'max': return t('Máximo');
    case 'ultra': return t('Ultra');
    default: return effort.replace(/[_-]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
  }
}

/**
 * One catalogue read per app session, shared by every picker on screen. Codex is the
 * only provider that publishes reasoning levels, so nothing is fetched until a Codex
 * model is actually selected somewhere. A failure (no subscription connected) clears
 * the cache so the next picker to mount can try again instead of being stuck empty.
 */
let catalogRequest: Promise<CodexReasoningCatalog> | null = null;
/** What the request resolved to, kept so a picker mounting later can render its level on
 *  the first paint instead of appearing empty and filling in a tick afterwards. */
let catalogSnapshot: CodexReasoningCatalog | null = null;

function loadCodexReasoningCatalog(): Promise<CodexReasoningCatalog> {
  if (!catalogRequest) {
    catalogRequest = window.nodus
      .listModels('codex')
      .then(codexReasoningCatalog)
      .then((catalog) => { catalogSnapshot = catalog; return catalog; })
      .catch(() => { catalogRequest = null; return {}; });
  }
  return catalogRequest;
}

/** Test seam: hand the catalogue in directly instead of going through the provider. */
export function primeCodexReasoningCatalog(catalog: CodexReasoningCatalog | null): void {
  catalogRequest = catalog ? Promise.resolve(catalog) : null;
  catalogSnapshot = catalog;
}

function useCodexReasoningCatalog(model: ModelRef | null | undefined): CodexReasoningCatalog | null {
  const isCodex = model?.provider === 'codex';
  const [catalog, setCatalog] = useState<CodexReasoningCatalog | null>(() => (isCodex ? catalogSnapshot : null));
  useEffect(() => {
    if (!isCodex) return;
    let alive = true;
    void loadCodexReasoningCatalog().then((loaded) => { if (alive) setCatalog(loaded); });
    return () => { alive = false; };
  }, [isCodex]);
  return catalog;
}

/**
 * The reasoning level for one role, rendered beside its picker so the choice lives
 * where the model is chosen. It writes through the role's own `onChange` — the same
 * one the picker writes through — so the level lands on that role's selection and
 * nowhere else: two roles running one model choose their levels independently.
 *
 * «Predeterminado» names what the role would actually fall back to: the model-wide
 * level from the Providers tab when one is set, otherwise the provider's own
 * recommendation. Renders nothing when the selected model publishes no levels, which
 * is every provider except Codex today.
 */
export function ReasoningPicker({
  settings,
  model,
  onChange,
  compact,
}: {
  settings: AppSettings;
  model: ModelRef | null | undefined;
  onChange: (m: ModelRef) => void;
  compact?: boolean;
}) {
  const catalog = useCodexReasoningCatalog(model);
  const choice = reasoningChoiceFor(catalog, model);
  if (!choice || !model) return null;
  const inherited = settings.codexReasoningEfforts?.[model.model] ?? choice.fallback;
  // A level the model no longer publishes (Codex retires them) must read as
  // «Predeterminado» rather than as a blank box — which is also what the completion
  // call does with it, since it validates against the same live catalogue.
  const chosen = choice.supported.some((option) => option.reasoningEffort === model.reasoningEffort)
    ? model.reasoningEffort
    : undefined;
  return (
    <select
      // Wide enough for the longest level plus its "(default)" suffix in every
      // language, and never allowed to shrink: a truncated level reads as a different
      // level. The picker beside it keeps a floor of its own so neither can vanish.
      className={`input w-48 shrink-0 ${compact ? 'py-1 text-xs' : 'text-xs'}`}
      data-testid={`model-reasoning-${model.model}`}
      aria-label={tx('Razonamiento de {model}', { model: modelLabel(model) })}
      title={t('Nivel de razonamiento de esta tarea. Menos razonamiento responde antes y solo afecta a esta tarea, aunque otras usen el mismo modelo.')}
      value={chosen ?? ''}
      onChange={(event) => onChange(modelRefWithReasoning(
        model,
        event.target.value ? (event.target.value as CodexReasoningEffort) : null
      ))}
    >
      <option value="">
        {inherited
          ? tx('{level} (predeterminado)', { level: codexReasoningLabel(inherited) })
          : t('Predeterminado')}
      </option>
      {choice.supported.map((option) => (
        <option key={option.reasoningEffort} value={option.reasoningEffort} title={option.description}>
          {codexReasoningLabel(option.reasoningEffort)}
        </option>
      ))}
    </select>
  );
}

/**
 * A role's model picker with its reasoning level next to it. Both write through the
 * same `onChange`, so a role's level is stored with the role's model and travels with
 * it. The reasoning selector only takes width when the chosen model actually offers
 * levels, so rows for models without them look exactly as they did.
 */
export function ModelWithReasoning({
  settings,
  value,
  onChange,
  compact,
  allowEmpty = true,
  emptyLabel,
  requireExtraction = false,
}: {
  settings: AppSettings;
  value: ModelRef | null;
  onChange: (m: ModelRef | null) => void;
  compact?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  requireExtraction?: boolean;
}) {
  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
      <ModelPicker
        className="min-w-[8rem] flex-1"
        settings={settings}
        value={value}
        onChange={onChange}
        compact={compact}
        allowEmpty={allowEmpty}
        emptyLabel={emptyLabel}
        requireExtraction={requireExtraction}
      />
      <ReasoningPicker settings={settings} model={value} onChange={onChange} compact={compact} />
    </div>
  );
}

/**
 * Shared selector over favorite models plus the currently persisted value.
 * Null means no explicit choice (the owning workload may define its own fallback).
 * With `requireExtraction`, models that can't drive extraction are shown but disabled — used for the
 * extraction role and the basic-mode generic model (which runs the scans).
 */
export function ModelPicker({
  settings,
  value,
  onChange,
  compact,
  disabled,
  emptyLabel,
  allowEmpty = true,
  menu = false,
  requireExtraction = false,
  triggerModelOnly = false,
  ariaLabel,
  className = '',
}: {
  settings: AppSettings;
  value: ModelRef | null;
  onChange: (m: ModelRef | null) => void;
  compact?: boolean;
  disabled?: boolean;
  emptyLabel?: string;
  allowEmpty?: boolean;
  menu?: boolean;
  requireExtraction?: boolean;
  /** Keep compact, in-context pickers readable while the options retain provider names. */
  triggerModelOnly?: boolean;
  /** Accessible control name; the current provider and model are appended as its value. */
  ariaLabel?: string;
  className?: string;
}) {
  const favorites = sortModelRefs(settings.favorites ?? []);
  const blocked = (m: ModelRef) => requireExtraction && !modelRefSupportsExtraction(m);
  const optionText = (m: ModelRef) => (blocked(m) ? `${modelLabel(m)} — ${t('solo visión')}` : modelLabel(m));
  const serialize = (m: ModelRef) => `${m.provider}::${m.model}`;
  const valueIsFavorite = value ? favorites.some((model) => sameModel(model, value)) : false;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (menu) {
    const models = value && !valueIsFavorite ? [value, ...favorites] : favorites;
    const choose = (model: ModelRef | null) => {
      onChange(model);
      setOpen(false);
      window.setTimeout(() => triggerRef.current?.focus());
    };
    const focusOption = (direction: 1 | -1 | 'first' | 'last') => {
      const options = [...(optionsRef.current?.querySelectorAll<HTMLButtonElement>('button[role="option"]:not(:disabled)') ?? [])];
      if (!options.length) return;
      const current = options.indexOf(document.activeElement as HTMLButtonElement);
      const next = direction === 'first' ? 0 : direction === 'last' ? options.length - 1
        : current < 0 ? (direction === 1 ? 0 : options.length - 1) : (current + direction + options.length) % options.length;
      options[next]?.focus();
    };
    const currentLabel = value ? modelLabel(value) : emptyLabel ? t(emptyLabel) : t('Sin modelo seleccionado');
    const closeAndRestoreFocus = () => { setOpen(false); triggerRef.current?.focus(); };
    return <div ref={rootRef} className={`model-picker-menu${compact ? ' compact' : ''} ${className}`} onKeyDown={(event) => {
      if (event.key === 'Escape' && open) { event.preventDefault(); closeAndRestoreFocus(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!open) {
          setOpen(true);
          window.setTimeout(() => focusOption(event.key === 'ArrowDown' ? 'first' : 'last'));
        } else focusOption(event.key === 'ArrowDown' ? 1 : -1);
      }
      if (open && event.key === 'Home') { event.preventDefault(); focusOption('first'); }
      if (open && event.key === 'End') { event.preventDefault(); focusOption('last'); }
    }}>
      <button ref={triggerRef} type="button" className="model-picker-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel ? `${ariaLabel}: ${currentLabel}` : undefined} onClick={() => setOpen((current) => !current)} title={currentLabel}>
        <span>{value ? (triggerModelOnly ? value.model : currentLabel) : currentLabel}</span><Icon name="chevronDown" size={14} />
      </button>
      {open && <div ref={optionsRef} className="model-picker-options" role="listbox" aria-label={ariaLabel}>
        {allowEmpty && <button type="button" role="option" aria-selected={!value} className={!value ? 'selected' : ''} onClick={() => choose(null)}>{emptyLabel ? t(emptyLabel) : t('Sin modelo seleccionado')}</button>}
        {models.map((model) => <button type="button" role="option" aria-selected={sameModel(model, value)} disabled={blocked(model)} title={blocked(model) ? t('Este modelo no puede usarse para extracción de ideas.') : undefined} className={sameModel(model, value) ? 'selected' : ''} key={serialize(model)} onClick={() => { if (!blocked(model)) choose(model); }}><span>{optionText(model)}</span>{sameModel(model, value) && <Icon name="check" size={13} />}</button>)}
        {!models.length && !allowEmpty && <span className="model-picker-empty">{t('No hay modelos favoritos configurados.')}</span>}
      </div>}
    </div>;
  }

  return (
    <select
      className={`input ${compact ? 'text-xs py-1' : ''} ${className}`}
      disabled={disabled}
      aria-label={ariaLabel}
      value={value ? serialize(value) : ''}
      onChange={(e) => {
        if (!e.target.value) return onChange(null);
        const [provider, model] = e.target.value.split('::');
        onChange({ provider: provider as ModelRef['provider'], model });
      }}
      title={t('Seleccionar modelo')}
    >
      <option value="" disabled={!allowEmpty}>{emptyLabel ? t(emptyLabel) : t('Sin modelo seleccionado')}</option>
      {value && !valueIsFavorite && <option value={serialize(value)}>{optionText(value)}</option>}
      {favorites.map((m) => (
        <option key={serialize(m)} value={serialize(m)} disabled={blocked(m)}>
          {optionText(m)}
        </option>
      ))}
    </select>
  );
}
