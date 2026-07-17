import { motion } from 'framer-motion';
import { useState } from 'react';
import type { NodiStyle } from '@shared/types';
import { t } from '../i18n';
import { Icon } from './ui';
import { NodiStylePicker } from './nodi/NodiStylePicker';

/**
 * Offers the choice between the two Nodi to users who already went through the
 * cinematic tutorial and so were never asked — shown once, right after the startup
 * update check, and never again.
 *
 * "Never again" is carried by the `mascotStyleChosen` setting (app-wide, so it can't
 * come back by switching vaults), which is written the moment a card is picked. The
 * only way out of this modal is to pick one of the two, so the flag can never be left
 * unwritten by a stray backdrop click — and either card is a legitimate answer, since
 * keeping the classic Nodi is one of them.
 */
export function NodiStyleModal({ onChosen }: { onChosen: () => void | Promise<void> }) {
  const [saving, setSaving] = useState(false);

  const pick = async (mascotStyle: NodiStyle) => {
    if (saving) return;
    setSaving(true);
    try {
      await window.nodus.updateSettings({ mascotStyle, mascotStyleChosen: true });
      await onChosen();
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div className="nodi-style-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .22 }}>
      <motion.section
        className="nodi-style-cinema"
        data-testid="nodi-style-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nodi-style-title"
        initial={{ opacity: 0, y: 24, scale: .96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: .42, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <span className="nodi-style-glow" aria-hidden="true"><span className="tutorial-aurora" /></span>
        <div className="nodi-style-kicker"><Icon name="sparkles" size={14} /> NODI</div>
        <h2 id="nodi-style-title">{t('Ahora puedes elegir a tu Nodi')}</h2>
        <p className="nodi-style-lede">
          {t('Nodi tiene un segundo aspecto: un orbe, más sobrio y discreto. Quédate con el de siempre o pruébalo.')}
        </p>
        <NodiStylePicker
          labels={{
            classicTitle: t('Nodi clásico'),
            classicBody: t('El personaje de siempre, con sus gestos y sus trajes según la bóveda.'),
            orbTitle: t('Nodi orbe'),
            orbBody: t('Una esfera de cristal con una constelación dentro, que se tiñe del color de tu bóveda.'),
          }}
          onPick={(style) => void pick(style)}
        />
        <p className="nodi-style-foot">{t('Podrás cambiarlo cuando quieras en Ajustes › Interfaz › Mascota Nodi.')}</p>
      </motion.section>
    </motion.div>
  );
}
