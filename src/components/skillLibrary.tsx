import { useEffect, useState, type CSSProperties } from 'react';
import { vaultTypeColor } from '@shared/vaultTypes';
import type { ChatSkill, ChatSkillSurface } from '@shared/chatSkills';
import { Icon } from './ui';
import { skillGlyph } from './skillGlyph';
import { t } from '../i18n';

/** An empty skill, ready for the editor. */
export const blankSkill = (): ChatSkill => ({ id: '', name: '', description: '', instructions: '', enabled: { assistant: false, nodi: false } });

/** Accent- and diacritic-insensitive text for the library search. */
export const skillSearchText = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Human label for one activation surface. */
export const surfaceLabel = (surface: ChatSkillSurface) => surface === 'nodi' ? 'Nodi' : t('Asistente');

/**
 * The installed library, shared by the two places that show it: the per-chat
 * activation popover ({@link ChatSkillsControl}) and the global Skills modal.
 * Both read the same store and the same vault accent, so a skill installed in the
 * modal appears in an open popover without either of them knowing about the other.
 */
export function useSkillLibrary() {
  const [skills, setSkills] = useState<ChatSkill[]>([]);
  const [accent, setAccent] = useState(vaultTypeColor('academic'));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void window.nodus.getActiveVault().then(vault => { if (alive) setAccent(vaultTypeColor(vault?.type)); }).catch(() => {});
    const off = window.nodus.onVaultChanged(vault => setAccent(vaultTypeColor(vault?.type)));
    return () => { alive = false; off(); };
  }, []);
  useEffect(() => {
    const refresh = () => { void window.nodus.listChatSkills().then(setSkills).catch(e => setError(String(e))); };
    refresh();
    return window.nodus.onChatSkillsChanged(refresh);
  }, []);
  /** Run one store mutation, keeping the list, the busy flag and the error in step. */
  const mutate = async (action: () => Promise<ChatSkill[]>) => {
    setBusy(true); setError('');
    try { setSkills(await action()); return true; } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
    finally { setBusy(false); }
  };
  return { skills, setSkills, accent, error, setError, busy, mutate };
}

/** One skill in the library.
 *
 *  Every card is the same height whatever the skill is, because a list whose rows jump
 *  around is a list you have to read rather than scan: the name and the first two lines of
 *  the description, a switch, and a glyph that is this skill's and no other's. Everything
 *  else — the rest of the description, where it came from, and what you can do to it — is
 *  behind the chevron, which is also where the buttons that are easy to press by accident
 *  now live.
 *
 *  `surfaces` is what tells the two callers apart. A chat popover passes the one surface
 *  it speaks for and gets a single unlabelled switch, because there the question is only
 *  "on or off here". The Skills modal belongs to no chat, so it passes both surfaces and
 *  each switch says which one it turns on — the same activation, named. `manage` adds the
 *  library actions (export, edit, uninstall), which belong to the modal and not to a
 *  popover you opened mid-conversation. */
export function SkillCard({ skill, surfaces, busy, expanded, meta, manage = false, onToggleDetails, onEnable, onEdit, onExport, onRemove, confirm }: {
  skill: ChatSkill;
  surfaces: readonly ChatSkillSurface[];
  busy: boolean;
  expanded: boolean;
  meta: string;
  manage?: boolean;
  onToggleDetails: () => void;
  onEnable: (surface: ChatSkillSurface) => void;
  onEdit?: () => void;
  onExport?: () => void;
  onRemove?: () => void;
  confirm?: { onConfirm: () => void; onCancel: () => void };
}) {
  const tools = skill.builtin === 'svg' || skill.builtin === 'image' || !!skill.capabilities?.length || !!skill.tools?.length;
  const glyph = skillGlyph({ packageId: skill.origin?.packageId, id: skill.id, name: skill.name, description: skill.description, category: skill.category, builtin: skill.builtin });
  const enabled = surfaces.some(surface => skill.enabled[surface]);
  return <div className={`chat-skill-item ${enabled ? 'enabled' : ''} ${tools ? 'tool-skill' : ''} ${expanded ? 'open' : ''}`}
    data-skill-kind={tools ? 'tool' : 'prompt'} style={{ '--skill-hue': glyph.hue } as CSSProperties}>
    <div className="chat-skill-main">
      <span className="chat-skill-symbol" aria-hidden="true"><Icon name={glyph.icon} size={18} /></span>
      <div className="chat-skill-text">
        <span className="chat-skill-heading"><b>{skill.name}</b>{tools && <span className="chat-skill-tool-badge">{t('Con herramientas')}</span>}</span>
        <p>{skill.description}</p>
      </div>
      {surfaces.length === 1
        ? <button type="button" role="switch" aria-checked={skill.enabled[surfaces[0]]} aria-label={`${t('Activar')} ${skill.name}`} disabled={busy} className="chat-skill-switch" onClick={() => onEnable(surfaces[0])}><span /></button>
        : <div className="chat-skill-switches">{surfaces.map(surface => <span key={surface}>
            <small>{surfaceLabel(surface)}</small>
            <button type="button" role="switch" aria-checked={skill.enabled[surface]} aria-label={`${t('Activar')} ${skill.name} · ${surfaceLabel(surface)}`} disabled={busy} className="chat-skill-switch" onClick={() => onEnable(surface)}><span /></button>
          </span>)}</div>}
      <button type="button" className="chat-skill-details-toggle" aria-expanded={expanded}
        aria-label={`${t(expanded ? 'Ocultar detalles de' : 'Ver detalles de')} ${skill.name}`}
        title={t(expanded ? 'Ocultar detalles' : 'Ver detalles')} onClick={onToggleDetails}>
        <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={14} />
      </button>
    </div>

    {expanded && <div className="chat-skill-details">
      <p>{skill.description}</p>
      <small>{meta}</small>
      {manage && <div className="chat-skill-item-foot">
        <button type="button" title={t('Exportar el paquete de la skill')} aria-label={`${t('Exportar')} ${skill.name}`} onClick={onExport}><Icon name="download" size={13} />{t('Exportar')}</button>
        <button type="button" title={t('Editar skill')} aria-label={`${t('Editar')} ${skill.name}`} onClick={onEdit}><Icon name="edit" size={13} />{t('Editar')}</button>
        <button type="button" className="chat-skill-remove" title={skill.builtin ? t('Desinstalar skill') : t('Eliminar skill')}
          aria-label={`${skill.builtin ? t('Desinstalar') : t('Eliminar')} ${skill.name}`} onClick={onRemove}>
          <Icon name="trash" size={13} />{skill.builtin ? t('Desinstalar') : t('Eliminar')}
        </button>
      </div>}
    </div>}

    {confirm && <div className="chat-skill-confirm">
      <span>{skill.builtin ? t('¿Desinstalar esta skill? Puedes volver a instalarla desde el Marketplace.') : t('¿Eliminar esta skill?')}</span>
      <button type="button" disabled={busy} onClick={confirm.onConfirm}>{skill.builtin ? t('Desinstalar') : t('Eliminar')}</button>
      <button type="button" onClick={confirm.onCancel}>{t('Cancelar')}</button>
    </div>}
  </div>;
}

/** The one line under a skill's description that says what it is and where it came from. */
export function skillMeta(skill: ChatSkill, imageModel: string): string {
  if (skill.builtin === 'image') return imageModel;
  if (skill.builtin === 'svg') return t('Vectorial · editable · preciso');
  if (skill.builtin === 'socratic') return t('Aprendizaje guiado · paso a paso');
  if (skill.builtin) return t('Skill incluida');
  return skill.origin ? `Marketplace · @${skill.author}` : t('Skill personal');
}
