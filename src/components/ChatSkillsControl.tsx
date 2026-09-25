import { useRef, useState, type CSSProperties } from 'react';
import type { ChatSkillSurface } from '@shared/chatSkills';
import { skillActive } from '@shared/chatSkills';
import { marketplaceLogoSvg } from '@shared/marketplaceLogo';
import { HeaderBalloon } from './HeaderBalloon';
import { SkillsHub } from './SkillsHub';
import { useSkillLibrary } from './skillLibrary';
import { Icon } from './ui';
import { t, tx } from '../i18n';
import './chatSkills.css';

/**
 * The Skills button of a chat and the balloon it opens: the library, the Marketplace, the
 * repositories and the form to write a skill, in four tabs. A skill is on or off for every
 * chat at once, so the balloon is the same whichever chat opens it; `surface` only names
 * who asked, for the test ids.
 */
export function ChatSkillsControl({ surface, disabled = false, compact = false }: { surface: ChatSkillSurface; disabled?: boolean; compact?: boolean }) {
  const { skills, accent } = useSkillLibrary();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const active = skills.filter(skillActive).length;
  return <div className={`chat-skills-control ${compact ? 'compact' : ''}`} style={{ '--vault-accent': accent } as CSSProperties}>
    <button ref={trigger} type="button" className="chat-skills-trigger" data-testid={`chat-skills-${surface}`} aria-label={t('Skills')} aria-haspopup="dialog" aria-expanded={open} title={t('Skills')} disabled={disabled}
      onClick={() => setOpen(current => !current)}>
      <Icon name="sparkles" size={compact ? 14 : 15} />{!compact && <span>{t('Skills')}</span>}<span className="chat-skills-count">{active}</span>
    </button>
    <HeaderBalloon open={open && !disabled} anchor={trigger} onClose={() => setOpen(false)} width={560}
      icon={<img className="skills-balloon-mark" src={`data:image/svg+xml,${encodeURIComponent(marketplaceLogoSvg(accent, { plate: false }))}`} alt="" />}
      title={t('Skills')} meta={tx('{n} activas', { n: active })} testId={`chat-skills-panel-${surface}`}
      className="chat-skills-panel skills-balloon" bodyClassName="skills-balloon-body">
      <SkillsHub />
    </HeaderBalloon>
  </div>;
}
