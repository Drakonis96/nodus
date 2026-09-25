import type { ChatSkill } from '@shared/chatSkills';
import { Icon } from './ui';
import { t } from '../i18n';

export interface InvokedSkill { id: string; name: string }

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

/** The "@query" being typed right before the caret, if any. An @ counts only at the start
 * of the text or after whitespace, so an e-mail address never opens the menu. */
export function findSkillMention(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|\s)@([^\s@]{0,40})$/u.exec(text.slice(0, caret));
  return match ? { start: caret - match[2].length - 1, query: match[2] } : null;
}

/** Skills matching what follows the @: names that start with it first, then names or
 * descriptions that contain it, each group alphabetical. */
export function rankSkillMentions(skills: ChatSkill[], query: string, limit = 8): ChatSkill[] {
  const needle = fold(query.trim());
  const byName = (a: ChatSkill, b: ChatSkill) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  if (!needle) return [...skills].sort(byName).slice(0, limit);
  const starts = skills.filter(skill => fold(skill.name).startsWith(needle)).sort(byName);
  const contains = skills.filter(skill => !starts.includes(skill) && fold(`${skill.name} ${skill.description}`).includes(needle)).sort(byName);
  return [...starts, ...contains].slice(0, limit);
}

/** Removes the typed "@query" and returns the text and where the caret goes. */
export function removeMention(text: string, mention: { start: number; query: string }): { text: string; caret: number } {
  const before = text.slice(0, mention.start);
  const after = text.slice(mention.start + 1 + mention.query.length);
  // No double space where the mention was.
  const joined = (before === '' || /\s$/.test(before)) && after.startsWith(' ') ? before + after.slice(1) : before + after;
  return { text: joined, caret: before.length };
}

/** The list that opens above the composer while an @ is being typed. */
export function SkillMentionMenu({ options, activeIndex, onPick, onHover }: {
  options: ChatSkill[]; activeIndex: number; onPick: (skill: ChatSkill) => void; onHover: (index: number) => void;
}) {
  return <div className="research-skill-mention" role="listbox" id="research-skill-mention" aria-label={t('Skills')} data-testid="research-skill-mention">
    {options.length ? options.map((skill, index) => (
      <button key={skill.id} type="button" role="option" id={`research-skill-option-${index}`} aria-selected={index === activeIndex}
        className={`research-skill-mention-option ${index === activeIndex ? 'is-active' : ''}`}
        // Keeps the caret in the composer, so the pick replaces what was typed.
        onMouseDown={event => event.preventDefault()}
        onMouseEnter={() => onHover(index)}
        onClick={() => onPick(skill)}>
        <Icon name="sparkles" size={15} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{skill.name}</span>
          {skill.description && <span className="block truncate text-[11px] opacity-70">{skill.description}</span>}
        </span>
      </button>
    )) : <p className="px-3 py-2 text-xs opacity-70">{t('Ninguna skill coincide.')}</p>}
  </div>;
}

/** The skills invoked for the next message, as removable pills in the composer, or as
 * plain pills on a sent message. */
export function InvokedSkillPills({ skills, onRemove }: { skills: InvokedSkill[]; onRemove?: (id: string) => void }) {
  if (!skills.length) return null;
  return <div className="research-invoked-skills" data-testid={onRemove ? 'research-invoked-skills' : 'research-message-skills'}>
    {skills.map(skill => <span key={skill.id} className="research-invoked-skill">
      <Icon name="sparkles" size={12} />
      <span className="truncate">@{skill.name}</span>
      {onRemove && <button type="button" aria-label={`${t('Quitar')} @${skill.name}`} title={t('Quitar')} onClick={() => onRemove(skill.id)}><Icon name="x" size={11} /></button>}
    </span>)}
  </div>;
}
