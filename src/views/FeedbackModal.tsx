import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import type { AppInfo } from '@shared/types';
import { Icon } from '../components/ui';
import { t } from '../i18n';

// GitHub repository that receives the preformatted feature requests / bug reports.
const REPO = 'Drakonis96/nodus';

type FeedbackKind = 'feature' | 'bug' | 'vault';
type Expertise = '' | 'specialist' | 'experienced' | 'interested';

const VAULT_AREA_SUGGESTIONS = [
  'Periodismo',
  'Ciencias de la salud',
  'Ciencias experimentales',
  'Psicología y psiquiatría',
  'Jurídico',
  'Política',
  'Economía y finanzas',
  'Ingeniería',
] as const;

/**
 * Two-step modal that lets a user file a preformatted "new feature" or "bug
 * report" straight to the Nodus GitHub repo. Step 1 picks the kind; step 2 is a
 * kind-specific form. On send we build a Markdown issue body (title + fields +
 * an auto-collected environment footer with the exact Nodus version, OS and
 * architecture) and open GitHub's prefilled "new issue" page in the browser, so
 * the user reviews and submits the report themselves on GitHub.
 */
export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [title, setTitle] = useState('');
  // Shared free-text fields; which ones are shown depends on the kind.
  const [summary, setSummary] = useState('');
  const [detail, setDetail] = useState('');
  const [extra, setExtra] = useState('');
  const [expertise, setExpertise] = useState<Expertise>('');
  const [activeTester, setActiveTester] = useState(false);
  const [personalData, setPersonalData] = useState<'unknown' | 'yes' | 'no'>('unknown');

  useEffect(() => {
    window.nodus?.getAppInfo().then(setAppInfo).catch(() => setAppInfo(null));
  }, []);

  // Close on Escape, like the app's other modals.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const envFooter = useMemo(() => {
    if (!appInfo) return '';
    return [
      '',
      '---',
      `- **Nodus**: v${appInfo.version}`,
      `- **${t('Sistema')}**: ${appInfo.osName} ${appInfo.osVersion} (${appInfo.arch})`,
      `- **Electron**: ${appInfo.electron}`,
    ].join('\n');
  }, [appInfo]);

  const canSend = kind === 'vault'
    ? title.trim().length > 0 && summary.trim().length > 0 && detail.trim().length > 0 && extra.trim().length > 0 && expertise !== ''
    : kind !== null && title.trim().length > 0 && summary.trim().length > 0;

  const send = () => {
    if (!kind || !canSend) return;
    const label = kind === 'bug' ? 'bug' : 'enhancement';
    const prefix = kind === 'feature' ? '[Feature]' : kind === 'bug' ? '[Bug]' : '[Vault type]';
    const expertiseLabel = expertise === 'specialist'
      ? t('Soy especialista o profesional del área')
      : expertise === 'experienced'
        ? t('Tengo experiencia práctica o académica')
        : t('No soy especialista, pero conozco la necesidad');
    const body =
      kind === 'vault'
        ? [
            `## ${t('Rama de conocimiento o área')}`,
            title.trim(),
            '',
            `## ${t('Experiencia y colaboración')}`,
            `- **${t('Relación con el área')}**: ${expertiseLabel}`,
            `- **${t('Pruebas activas')}**: ${activeTester ? t('Sí, puedo testear y enviar feedback') : t('No por ahora')}`,
            '',
            `## ${t('Características deseadas')}`,
            summary.trim(),
            '',
            `## ${t('Organización y estructura del vault')}`,
            detail.trim(),
            '',
            `## ${t('Beneficios y casos de uso')}`,
            extra.trim(),
            '',
            `## ${t('Datos personales')}`,
            personalData === 'yes' ? t('Sí, este vault trataría datos personales o sensibles.') : personalData === 'no' ? t('No trataría datos personales.') : t('No estoy seguro; debe evaluarse.'),
            envFooter,
          ].join('\n')
        : kind === 'feature'
        ? [
            `## ${t('Descripción de la función')}`,
            summary.trim(),
            '',
            `## ${t('¿Qué problema resuelve?')}`,
            detail.trim() || '—',
            ...(extra.trim() ? ['', `## ${t('Notas adicionales')}`, extra.trim()] : []),
            envFooter,
          ].join('\n')
        : [
            `## ${t('Descripción del error')}`,
            summary.trim(),
            '',
            `## ${t('Pasos para reproducir')}`,
            detail.trim() || '—',
            '',
            `## ${t('Comportamiento esperado')}`,
            extra.trim() || '—',
            envFooter,
          ].join('\n');

    const params = new URLSearchParams({
      title: `${prefix} ${title.trim()}`,
      labels: label,
      body,
    });
    const url = `https://github.com/${REPO}/issues/new?${params.toString()}`;
    window.nodus?.openExternal(url);
    onClose();
  };

  return (
    <motion.div
      className="roadmap-backdrop feedback-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.24 }}
      onMouseDown={onClose}
    >
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label={t('Enviar propuesta a GitHub')}
        className="roadmap-cinema feedback-cinema"
        data-testid="feedback-cinematic-modal"
        initial={{ opacity: 0, y: 28, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.46, ease: [0.2, 0.8, 0.2, 1] }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="roadmap-hero feedback-hero">
          <div className="roadmap-aurora" aria-hidden="true" />
          <div className="roadmap-stars" aria-hidden="true" />
          <button className="roadmap-close" onClick={onClose} aria-label={t('Cerrar')}>
            <Icon name="x" size={16} />
          </button>
          <div className="roadmap-hero-copy">
            <div className="roadmap-kicker"><Icon name="gitPr" size={14} /> {t('Sugerir / Reportar')}</div>
            <h2>{t('Enviar propuesta a GitHub')}</h2>
            <p>{t('Genera un reporte preformateado y ábrelo en GitHub para publicarlo.')}</p>
          </div>
          <div className="roadmap-hero-route feedback-hero-route" aria-hidden="true">
            <span><Icon name="gitPr" size={44} /></span>
            <i /><i /><i />
          </div>
        </header>

        <div className="roadmap-scroll feedback-scroll">
          {kind === null ? (
            <div className="feedback-kind-grid">
              <button
                className="feedback-kind-card"
                data-kind="feature"
                onClick={() => setKind('feature')}
              >
                <span className="feedback-kind-icon">
                  <Icon name="bulb" size={18} />
                </span>
                <span className="feedback-kind-title">{t('Nueva función')} <Icon name="chevronRight" size={14} /></span>
                <span className="feedback-kind-description">{t('Propón una mejora o una función que te gustaría ver en Nodus.')}</span>
              </button>
              <button
                className="feedback-kind-card"
                data-kind="bug"
                onClick={() => setKind('bug')}
              >
                <span className="feedback-kind-icon">
                  <Icon name="bug" size={18} />
                </span>
                <span className="feedback-kind-title">{t('Reporte de error')} <Icon name="chevronRight" size={14} /></span>
                <span className="feedback-kind-description">{t('Cuéntanos qué falla, con los pasos para reproducirlo.')}</span>
              </button>
              <button
                className="feedback-kind-card"
                data-kind="vault"
                onClick={() => setKind('vault')}
                data-testid="feedback-new-vault-type"
              >
                <span className="feedback-kind-icon">
                  <Icon name="archive" size={18} />
                </span>
                <span className="feedback-kind-title">{t('Nuevo tipo de vault')} <Icon name="chevronRight" size={14} /></span>
                <span className="feedback-kind-description">{t('Propón un espacio especializado y cómo colaborarías para hacerlo viable.')}</span>
              </button>
            </div>
          ) : (
            <div className="feedback-form" data-kind={kind}>
              <button
                className="feedback-back"
                onClick={() => setKind(null)}
              >
                <Icon name="chevronLeft" size={14} /> {t('Cambiar tipo')}
              </button>

              {kind === 'vault' ? (
                <>
                  <div className="feedback-note feedback-note-teal">
                    <div className="flex items-start gap-2"><Icon name="users" size={14} className="mt-0.5" /><span>{t('Un vault especializado puede requerir arquitectura nueva. Se priorizará cuando haya colaboración activa, conocimiento del área y personas dispuestas a probarlo.')}</span></div>
                  </div>
                  <FieldLabel>{t('Rama de conocimiento o área')}</FieldLabel>
                  <div className="feedback-suggestions">
                    {VAULT_AREA_SUGGESTIONS.map((area) => <button key={area} type="button" onClick={() => setTitle(t(area))}>{t(area)}</button>)}
                  </div>
                  <input autoFocus className="input feedback-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('Ej.: ciencias de la salud, periodismo, ingeniería…')} />

                  <FieldLabel>{t('¿Cuál es tu relación con esta área?')}</FieldLabel>
                  <select className="input feedback-input" value={expertise} onChange={(event) => setExpertise(event.target.value as Expertise)}>
                    <option value="">{t('Selecciona una opción')}</option>
                    <option value="specialist">{t('Soy especialista o profesional del área')}</option>
                    <option value="experienced">{t('Tengo experiencia práctica o académica')}</option>
                    <option value="interested">{t('No soy especialista, pero conozco la necesidad')}</option>
                  </select>
                  <label className="feedback-checkbox">
                    <input type="checkbox" checked={activeTester} onChange={(event) => setActiveTester(event.target.checked)} />
                    <span>{t('Puedo probar activamente este vault, enviar feedback y ayudar a pulir errores.')}</span>
                  </label>

                  <FieldLabel>{t('Características que debería incluir')}</FieldLabel>
                  <textarea className="input feedback-input min-h-[75px] resize-y" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={t('Funciones y flujos imprescindibles para trabajar en esta área.')}/>
                  <FieldLabel>{t('Organización y estructura del vault')}</FieldLabel>
                  <textarea className="input feedback-input min-h-[70px] resize-y" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder={t('Secciones, jerarquías, tipos de contenido y forma de navegar.')}/>
                  <FieldLabel>{t('Beneficios y casos de uso')}</FieldLabel>
                  <textarea className="input feedback-input min-h-[65px] resize-y" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={t('¿A quién ayudaría y qué trabajo mejoraría?')}/>

                  <FieldLabel>{t('¿Trataría datos personales o sensibles?')}</FieldLabel>
                  <select className="input feedback-input" value={personalData} onChange={(event) => setPersonalData(event.target.value as typeof personalData)}>
                    <option value="unknown">{t('No estoy seguro')}</option>
                    <option value="yes">{t('Sí')}</option>
                    <option value="no">{t('No')}</option>
                  </select>
                  <div className="feedback-note feedback-note-amber">
                    <Icon name="lock" size={14} className="mt-0.5" />
                    <span>{t('En vaults con datos personales, la IA se limitará inicialmente a modelos locales del usuario. También se valorará sustituir datos identificativos por placeholders que la IA no verá.')}</span>
                  </div>
                </>
              ) : (
                <>
                  <FieldLabel>{t('Título')}</FieldLabel>
                  <input autoFocus className="input feedback-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'feature' ? t('Resumen breve de la función') : t('Resumen breve del error')} />
                  <FieldLabel>{kind === 'feature' ? t('Descripción de la función') : t('Descripción del error')}</FieldLabel>
                  <textarea className="input feedback-input min-h-[90px] resize-y" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={kind === 'feature' ? t('¿Qué debería hacer Nodus?') : t('¿Qué ocurre exactamente?')} />
                  <FieldLabel>{kind === 'feature' ? t('¿Qué problema resuelve?') : t('Pasos para reproducir')}</FieldLabel>
                  <textarea className="input feedback-input min-h-[70px] resize-y" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder={kind === 'feature' ? t('Contexto o motivación (opcional)') : t('1. … 2. … 3. …')} />
                  <FieldLabel>{kind === 'feature' ? t('Notas adicionales') : t('Comportamiento esperado')}</FieldLabel>
                  <textarea className="input feedback-input min-h-[60px] resize-y" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={kind === 'feature' ? t('Cualquier otra cosa (opcional)') : t('¿Qué esperabas que ocurriera?')} />
                </>
              )}

              <div className="feedback-system-info">
                <div>
                  <Icon name="info" size={13} /> {t('Se adjuntará automáticamente')}
                </div>
                {appInfo ? (
                  <span>
                    Nodus v{appInfo.version} · {appInfo.osName} {appInfo.osVersion} · {appInfo.arch}
                  </span>
                ) : (
                  <span>{t('Cargando información del sistema…')}</span>
                )}
              </div>
            </div>
          )}
        </div>

        <footer className="roadmap-footer feedback-footer">
          <span>{kind === null ? <><Icon name="network" size={13} /> NODUS</> : t('Se abrirá GitHub para que revises y publiques.')}</span>
          <span><Icon name="gitPr" size={13} /> GITHUB · ISSUES</span>
          {kind !== null ? (
            <button onClick={send} disabled={!canSend}>
              <Icon name="external" size={15} /> {t('Enviar a GitHub')}
            </button>
          ) : (
            <button onClick={onClose}>{t('Cerrar')} <Icon name="check" size={14} /></button>
          )}
        </footer>
      </motion.section>
    </motion.div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="feedback-field-label">{children}</label>;
}
