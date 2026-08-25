import { t } from '../i18n';
import nodusLogo from '../assets/nodus-logo.svg';
import nodusLogoGold from '../assets/nodus-logo-gold.svg';
import nodusLogoCrimson from '../assets/nodus-logo-crimson.svg';
import nodusLogoTeal from '../assets/nodus-logo-teal.svg';
import nodusLogoOrange from '../assets/nodus-logo-orange.svg';
import nodusLogoViolet from '../assets/nodus-logo-violet.svg';
import nodusLogoCyan from '../assets/nodus-logo-cyan.svg';

const VAULT_LOGOS = [
  nodusLogo,
  nodusLogoGold,
  nodusLogoCrimson,
  nodusLogoTeal,
  nodusLogoOrange,
  nodusLogoViolet,
  nodusLogoCyan,
] as const;

export function RecoveryStatusLoading() {
  return (
    <div className="startup-protection-loading" data-testid="recovery-status-loading">
      <div className="startup-protection-brand" aria-hidden="true">
        <div className="startup-protection-logo-stack">
          {VAULT_LOGOS.map((src) => <img key={src} src={src} alt="" />)}
        </div>
        <span>NODUS RESEARCH</span>
      </div>
      <p role="status">{t('Verificando la protección de tus datos…')}</p>
    </div>
  );
}
