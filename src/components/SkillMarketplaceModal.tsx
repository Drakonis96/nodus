import type { CSSProperties } from 'react';
import { marketplaceLogoSvg } from '@shared/marketplaceLogo';
import { SkillsHub, type SkillsHubTab } from './SkillsHub';
import { useSkillLibrary } from './skillLibrary';
import { Icon, ModalBackdrop } from './ui';
import { t } from '../i18n';
import './chatSkills.css';

/**
 * Skills, reachable without a chat: the same four tabs as a chat's Skills balloon — the
 * library, the Marketplace, the repositories and the form to write a skill — in a larger
 * frame. A skill is on or off for every chat at once, so nothing here is per surface.
 */
export function SkillMarketplaceModal({ onClose, initialTab = 'library' }: { onClose: () => void; initialTab?: SkillsHubTab }) {
  const { accent } = useSkillLibrary();
  return <ModalBackdrop onClose={onClose} zIndex={10060}>
    <div style={{ '--vault-accent': accent } as CSSProperties} className="skill-modal-shell" data-testid="skill-marketplace-modal" role="dialog" aria-modal="true" aria-label={t('Skills y Marketplace')}>
      <div className="chat-skills-panel skill-modal" data-nodi-interactive>
        <div className="chat-skills-heading">
          <div className="skill-modal-title">
            {/* Both variants, swapped by the stylesheet: which theme this is, is a CSS fact. */}
            <img className="skill-marketplace-logo-dark skill-modal-mark" src={`data:image/svg+xml,${encodeURIComponent(marketplaceLogoSvg(accent))}`} alt="" aria-hidden="true" />
            <img className="skill-marketplace-logo-light skill-modal-mark" src={`data:image/svg+xml,${encodeURIComponent(marketplaceLogoSvg(accent, { plate: false }))}`} alt="" aria-hidden="true" />
            <div>
              <span className="chat-skills-eyebrow">{t('SKILLS DE NODUS')}</span>
              <h3>{t('Skills y Marketplace')}</h3>
              <p className="skill-modal-subtitle">{t('Instala, crea y configura tus skills. Una skill activa funciona en todos los chats.')}</p>
            </div>
          </div>
          <button type="button" aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <SkillsHub initialTab={initialTab} />
      </div>
    </div>
  </ModalBackdrop>;
}
