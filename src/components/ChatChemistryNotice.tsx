import type { ChemistryNotice, ChemistryNoticeCode } from '@shared/chatSkills';
import { Icon } from './ui';
import { t } from '../i18n';

/**
 * Chemistry Studio notices arrive from the main process as a stable code plus an
 * untranslated technical cause. The code is translated here so the notice follows
 * the interface language instead of being frozen in whatever language the main
 * process happened to author it in.
 */
function message(code: ChemistryNoticeCode): string {
  switch (code) {
    case 'conflicting-intents':
      return t('Se han devuelto varias intenciones químicas en conflicto. Pide una sola estructura o mecanismo.');
    case 'unverified-svg':
      return t('Dibujo sin verificar: lo ha trazado el modelo y no ha pasado por el resolvedor químico. Contrasta estructuras, cargas, productos y flechas con una fuente fiable.');
    case 'legacy-format':
      return t('Los dibujos guardados con el formato anterior siguen visibles, pero no se consideran verificados.');
    case 'partial-validation':
      return t('Verificación parcial: el grafo es válido y está balanceado, pero algo ha quedado fuera de lo que esta versión puede certificar.');
    case 'not-drawn':
      return t('No se ha podido dibujar esta estructura. El resto de la respuesta se conserva intacto.');
    case 'one-plan-per-reply':
      return t('Solo se compila un dibujo químico por respuesta. Envía otro mensaje para el siguiente.');
    case 'assumed-identity':
      return t('Se ha asumido la forma canónica de este compuesto, que no estaba especificada en la petición.');
  }
}

const TONE: Record<ChemistryNoticeCode, 'warn' | 'info'> = {
  'conflicting-intents': 'warn',
  'unverified-svg': 'warn',
  'legacy-format': 'info',
  'partial-validation': 'info',
  'not-drawn': 'warn',
  'one-plan-per-reply': 'info',
  'assumed-identity': 'info',
};

export function ChatChemistryNotice({ source }: { source: string }) {
  let notice: ChemistryNotice;
  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed.code !== 'string' || !(parsed.code in TONE)) return null;
    notice = { code: parsed.code as ChemistryNoticeCode, detail: typeof parsed.detail === 'string' ? parsed.detail : undefined };
  } catch { return null; }
  return (
    <div className={`chat-chem-notice chat-chem-notice-${TONE[notice.code]}`} role="note">
      <Icon name={TONE[notice.code] === 'warn' ? 'alert' : 'info'} size={16} />
      <div>
        <span>{message(notice.code)}</span>
        {notice.detail && <small>{notice.detail}</small>}
      </div>
    </div>
  );
}
