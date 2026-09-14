import { useEffect, useId, useState } from 'react';
import { defaultDocumentSkillPolicy, validateDocumentSkillPolicy, type DocumentSkillOption, type DocumentSkillPolicy } from '@shared/documentSkills';
import { Icon } from './ui';
import { skillGlyph } from './skillGlyph';
import { t } from '../i18n';
import './documentSkills.css';

export function useDocumentSkills() {
  const [policy, setPolicy] = useState<DocumentSkillPolicy>({ enabled: true, skills: [] });
  const [valid, setValid] = useState(true);
  return { policy, setPolicy, valid, setValid };
}

/** Controlled per-document configuration, shared by both creation dialogs and enrichment. */
export function DocumentSkillsControl({ value, onChange, onValidityChange, options: supplied }: {
  value: DocumentSkillPolicy; onChange: (value: DocumentSkillPolicy) => void;
  onValidityChange?: (valid: boolean) => void; options?: DocumentSkillOption[];
}) {
  const [options, setOptions] = useState<DocumentSkillOption[]>(supplied ?? []);
  const [loaded, setLoaded] = useState(Boolean(supplied));
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const id = useId();
  useEffect(() => {
    if (supplied) { setOptions(supplied); setLoaded(true); return; }
    let active = true;
    const refresh = () => void window.nodus.listDocumentSkills().then(next => { if (active) { setOptions(next); setLoaded(true); setError(''); } }).catch(() => { if (active) setError(t('No se pudieron cargar las skills.')); });
    refresh();
    const off = window.nodus.onChatSkillsChanged(refresh);
    return () => { active = false; off(); };
  }, [supplied]);
  useEffect(() => {
    if (loaded && !value.skills.length && options.length) onChange({ ...defaultDocumentSkillPolicy(options), enabled: value.enabled });
  }, [loaded, options, value.skills.length, value.enabled, onChange]);
  let valid = !error && loaded;
  try { validateDocumentSkillPolicy(value, options); } catch { valid = false; }
  if (!value.enabled) valid = true;
  useEffect(() => { onValidityChange?.(valid); }, [valid, onValidityChange]);
  const update = (skillId: string, patch: Partial<DocumentSkillPolicy['skills'][number]>) => {
    const existing = value.skills.find(item => item.skillId === skillId);
    onChange({ ...value, skills: [...value.skills.filter(item => item.skillId !== skillId), { skillId, enabled: false, maxCalls: options.find(item => item.skill.id === skillId)?.billing === 'none' ? 'auto' : null, ...existing, ...patch }] });
  };
  return <section className="document-skills" data-testid="document-skills">
    <div className="document-skills-header">
      <div><h3><Icon name="sparkles" size={16} />{t('Recursos visuales')}</h3><p id={`${id}-help`}>{t('Permitir una skill no obliga a utilizarla.')}</p></div>
      <button type="button" role="switch" aria-checked={value.enabled} aria-label={t('Recursos visuales')} className="document-skill-switch" onClick={() => onChange({ ...value, enabled: !value.enabled })}><span /></button>
    </div>
    {value.enabled && <>
      <label className="document-skills-search"><Icon name="search" size={14} /><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Buscar skills')} aria-label={t('Buscar skills')} /></label>
      <div className="document-skills-list">{options.filter(option => `${option.skill.name} ${option.skill.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(option => {
        const { skill, billing, available } = option;
        const rule = value.skills.find(item => item.skillId === skill.id);
        const enabled = rule?.enabled ?? false;
        const invalid = enabled && (rule?.maxCalls !== 'auto' || billing !== 'none') && (!Number.isSafeInteger(rule?.maxCalls) || Number(rule?.maxCalls) < 1);
        const glyph = skillGlyph({ id: skill.id, name: skill.name, builtin: skill.builtin, category: skill.category, description: skill.description });
        return <div className="document-skill-row" data-enabled={enabled} key={skill.id}>
          <div className="document-skill-title"><Icon name={glyph.icon} size={17} /><div><b>{skill.name}</b><p>{skill.description}</p></div><button type="button" role="switch" aria-checked={enabled} aria-label={`${t('Activar')} ${skill.name}`} disabled={!available} className="document-skill-switch" onClick={() => update(skill.id, { enabled: !enabled })}><span /></button></div>
          {!available && <p className="document-skill-warning">{t('Esta skill no está disponible.')}</p>}
          {enabled && <div className="document-skill-settings">
            <label><span>{t('Máximo de llamadas')}</span><div className="document-skill-limit">
              {billing === 'none' && <select aria-label={`${skill.name}: ${t('Modo del límite')}`} value={rule?.maxCalls === 'auto' ? 'auto' : 'number'} onChange={e => update(skill.id, { maxCalls: e.target.value === 'auto' ? 'auto' : null })}><option value="auto">Auto</option><option value="number">{t('Máximo')}</option></select>}
              {(billing !== 'none' || rule?.maxCalls !== 'auto') && <input type="number" min="1" step="1" inputMode="numeric" value={typeof rule?.maxCalls === 'number' ? rule.maxCalls : ''} aria-label={`${skill.name}: ${t('Máximo de llamadas')}`} aria-invalid={invalid} aria-describedby={invalid ? `${id}-${skill.id}-error` : undefined} onChange={e => update(skill.id, { maxCalls: e.target.value === '' ? null : Number(e.target.value) })} placeholder={t('Obligatorio')} />}
            </div></label>
            {billing !== 'none' && <p className="document-skill-warning"><Icon name="info" size={13} />{t(billing === 'per-call' ? 'Esta skill tiene coste por llamada. El importe depende del proveedor y del modelo.' : 'Esta skill puede generar costes adicionales por llamada.')}</p>}
            {invalid && <p id={`${id}-${skill.id}-error`} className="document-skill-error" role="alert">{t('Introduce un máximo entero mayor que cero.')}</p>}
          </div>}
        </div>;
      })}</div>
      <p className="document-skills-help">{t('El máximo es un límite. La IA puede utilizar menos llamadas o ninguna.')}</p>
      {error && <p role="alert" className="document-skill-error">{error}</p>}
      {loaded && !options.length && <p>{t('No hay skills con recursos insertables instaladas.')}</p>}
    </>}
  </section>;
}
