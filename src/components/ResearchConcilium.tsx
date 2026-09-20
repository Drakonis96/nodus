import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ModelRef } from '@shared/types';
import type { ConciliumConfig, ConciliumResult } from '@shared/researchConcilium';
import { PROVIDER_LABELS, isLocalModelProvider } from '@shared/providers';
import { SearchableModelSelect } from './SearchableModelSelect';
import { Markdown, type MarkdownCitation } from './Markdown';
import { Icon, modelLabel } from './ui';
import { t, tx } from '../i18n';
import './researchConcilium.css';

/** A round table with three seats: collective judgment, distinct from chat or skills. */
export function ConciliumIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><circle cx="12" cy="3" r="1.75" /><circle cx="4.2" cy="16.5" r="1.75" /><circle cx="19.8" cy="16.5" r="1.75" /><path d="M5.6 6A9 9 0 0 0 3 11M18.4 6a9 9 0 0 1 2.6 5M9 20.5a9 9 0 0 0 6 0" /></svg>;
}

function CouncilPopover({ label, trigger, children, className = '', disabled = false }: { label: string; trigger: ReactNode; children: ReactNode; className?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !panel.current || !button.current) return;
    const popup = panel.current;
    popup.setAttribute('popover', 'manual'); popup.showPopover();
    const place = () => {
      const rect = button.current!.getBoundingClientRect();
      const width = Math.min(440, window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 20;
      const above = rect.top - 20;
      const upwards = below < 300 && above > below;
      Object.assign(popup.style, { width: `${width}px`, left: `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`, top: upwards ? 'auto' : `${rect.bottom + 8}px`, bottom: upwards ? `${window.innerHeight - rect.top + 8}px` : 'auto', maxHeight: `${Math.max(100, upwards ? above : below)}px` });
    };
    place();
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); if (popup.matches(':popover-open')) popup.hidePopover(); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <div ref={root} className={`concilium-control ${className}`} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus(); }
  }}>
    <button ref={button} type="button" className="concilium-trigger" disabled={disabled} aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>{trigger}</button>
    {open && <div ref={panel} className="concilium-panel" role="region" aria-label={label}>
      <div className="concilium-heading"><span><ConciliumIcon size={20} />{label}</span><button type="button" aria-label={t('Cerrar')} onClick={() => { setOpen(false); button.current?.focus(); }}><Icon name="x" size={16} /></button></div>
      {children}
    </div>}
  </div>;
}

const key = (model: ModelRef) => `${model.provider}::${model.model}`;
export function ResearchConciliumControl({ value, onChange, models, selectedModel, disabled }: { value: ConciliumConfig | null; onChange: (value: ConciliumConfig | null) => void; models: ModelRef[]; selectedModel: ModelRef | null; disabled?: boolean }) {
  const [draft, setDraft] = useState<ConciliumConfig | null>(null);
  const initial = selectedModel ? [selectedModel, ...models.filter(model => key(model) !== key(selectedModel))].slice(0, 2) : models.slice(0, 2);
  const config = value ?? draft ?? { models: initial, chairman: 0 };
  const choices = models.map(model => ({ ...model, label: model.model, providerLabel: PROVIDER_LABELS[model.provider], local: isLocalModelProvider(model.provider) }));
  const change = (next: ConciliumConfig) => { setDraft(next); if (value) onChange(next); };
  const remaining = models.filter(model => !config.models.some(chosen => key(chosen) === key(model)));
  return <CouncilPopover label="Concilium" disabled={disabled} className={value ? 'is-active' : ''} trigger={<><ConciliumIcon /><span>Concilium</span>{value && <span className="concilium-count">{value.models.length}</span>}</>}>
    <p className="concilium-intro">{t('Varias perspectivas. Una respuesta compartida.')}</p>
    <div className="concilium-toggle"><div><strong>{t('Activar Concilium')}</strong><span>{t('De 2 a 5 modelos, incluido el chairman.')}</span></div><button type="button" role="switch" aria-label={t('Activar Concilium')} aria-checked={!!value} disabled={config.models.length < 2} onClick={() => { setDraft(config); onChange(value ? null : config); }}><span /></button></div>
    <div className="concilium-roster">{config.models.map((model, index) => <div className="concilium-seat" key={index}>
      <div className="concilium-seat-label"><span className="concilium-seat-number">{String(index + 1).padStart(2, '0')}</span><strong>{index === config.chairman ? t('Chairman') : tx('Miembro {n}', { n: index + 1 })}</strong>{index === config.chairman ? <span className="concilium-role">{t('Síntesis + skills')}</span> : <button type="button" className="concilium-link" onClick={() => change({ ...config, chairman: index })}>{t('Hacer chairman')}</button>}{config.models.length > 2 && <button type="button" aria-label={tx('Eliminar miembro {n}', { n: index + 1 })} onClick={() => change({ models: config.models.filter((_, i) => i !== index), chairman: config.chairman === index ? 0 : config.chairman > index ? config.chairman - 1 : config.chairman })}><Icon name="x" size={13} /></button>}</div>
      <SearchableModelSelect testId={`concilium-model-${index}`} label={tx('Modelo del miembro {n}', { n: index + 1 })} value={model} choices={choices.filter(choice => key(choice) === key(model) || !config.models.some(chosen => key(chosen) === key(choice)))} onChange={next => change({ ...config, models: config.models.map((current, i) => i === index ? next : current) })} emptyLabel={t('Sin modelos disponibles')} />
    </div>)}</div>
    <button type="button" className="concilium-add" disabled={config.models.length >= 5 || !remaining.length} onClick={() => change({ ...config, models: [...config.models, remaining[0]] })}><Icon name="plus" size={14} />{t('Añadir miembro')}<span>{config.models.length}/5</span></button>
    <p className="concilium-footnote">{t('Cada modelo responde por separado. El chairman contrasta las respuestas y entrega el consenso. Solo el chairman puede usar skills.')}</p>
    {models.length < 2 && <p role="status" className="concilium-footnote">{t('Añade al menos dos modelos a tus favoritos en Ajustes.')}</p>}
  </CouncilPopover>;
}

const statusLabel = (status: string) => ({ waiting: t('En espera'), thinking: t('Analizando'), complete: t('Listo'), error: t('Error'), cancelled: t('Detenido') }[status] ?? status);
export function ConciliumResponses({ result, onCitation }: { result: ConciliumResult; onCitation: (citation: MarkdownCitation) => void }) {
  const completed = result.members.filter(member => member.status === 'complete').length;
  return <div className="concilium-responses" data-testid="concilium-responses">
    <div className="concilium-progress" role="status"><ConciliumIcon /><strong>Concilium</strong><span>{completed}/{result.members.length}</span><span className="concilium-phase">{result.status === 'deliberating' ? t('El consejo está analizando…') : result.status === 'synthesizing' ? t('El chairman está sintetizando…') : result.status === 'cancelled' ? t('Detenido') : result.status === 'error' ? t('No se pudo completar el consenso.') : t('Consenso del chairman')}</span></div>
    <div className="concilium-members">{result.members.map((member, index) => <CouncilPopover key={index} label={modelLabel(member.model)} className={`concilium-member is-${member.status}`} trigger={<><span className="concilium-status-dot" /><span>{member.model.model}</span>{index === result.chairman && <span className="concilium-member-chair">{t('Chairman')}</span>}</>}>
      <div className="concilium-response-meta"><span>{PROVIDER_LABELS[member.model.provider]}</span><span>{statusLabel(member.status)}</span></div>
      {member.reasoning && <details className="concilium-reasoning"><summary>{t('Razonamiento')}</summary><p>{member.reasoning}</p></details>}
      {member.answer ? <Markdown content={member.answer} onCitation={onCitation} /> : <p className="concilium-intro">{statusLabel(member.status)}</p>}
      {member.error && <p role="alert" className="concilium-member-error">{member.error}</p>}
    </CouncilPopover>)}</div>
  </div>;
}
