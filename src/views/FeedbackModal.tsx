import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import type { AppInfo } from '@shared/types';
import { Icon } from '../components/ui';
import { t } from '../i18n';

// GitHub repository that receives the preformatted reports and feedback.
const REPO = 'Drakonis96/nodus';
const PRODUCT_FEEDBACK_THREAD = 272;

type FeedbackKind = 'feature' | 'bug' | 'vault' | 'feedback';
type Expertise = '' | 'specialist' | 'experienced' | 'interested';
type FeedbackRatingKey = 'features' | 'usability' | 'performance' | 'stability' | 'design';
type FeedbackRatings = Record<FeedbackRatingKey, number | null>;

const FEEDBACK_RATING_QUESTIONS: ReadonlyArray<{ key: FeedbackRatingKey; label: string }> = [
  { key: 'features', label: 'Cantidad y variedad de funciones' },
  { key: 'usability', label: 'Usabilidad' },
  { key: 'performance', label: 'Rendimiento' },
  { key: 'stability', label: 'Estabilidad' },
  { key: 'design', label: 'Diseño visual' },
];

const EMPTY_FEEDBACK_RATINGS: FeedbackRatings = {
  features: null,
  usability: null,
  performance: null,
  stability: null,
  design: null,
};

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
 * Two-step modal for preformatted feature requests, bug reports, vault
 * proposals and product feedback. Feature, bug and vault submissions open a
 * new GitHub issue. Product feedback is copied to the clipboard and sent to one
 * permanent public thread, with an on-screen fallback in case clipboard access
 * fails. Every submission includes the exact Nodus version, OS and architecture.
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
  const [ratings, setRatings] = useState<FeedbackRatings>(EMPTY_FEEDBACK_RATINGS);
  const [liked, setLiked] = useState('');
  const [improve, setImprove] = useState('');
  const [composedFeedback, setComposedFeedback] = useState<string | null>(null);
  const [clipboardOk, setClipboardOk] = useState(true);
  const [recopied, setRecopied] = useState(false);

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

  const canSend = kind === 'feedback'
    ? true
    : kind === 'vault'
    ? title.trim().length > 0 && summary.trim().length > 0 && detail.trim().length > 0 && extra.trim().length > 0 && expertise !== ''
    : kind !== null && title.trim().length > 0 && summary.trim().length > 0;
  const feedbackThreadUrl = `https://github.com/${REPO}/issues/${PRODUCT_FEEDBACK_THREAD}`;

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
      kind === 'feedback'
        ? [
            `## ${t('Valoraciones')}`,
            ...FEEDBACK_RATING_QUESTIONS.map(({ key, label: question }) => `- **${t(question)}**: ${ratings[key] ?? t('Sin respuesta')}`),
            '',
            `## ${t('¿Qué te gusta de Nodus?')}`,
            liked.trim() || t('Sin respuesta'),
            '',
            `## ${t('¿Qué crees que debería mejorar?')}`,
            improve.trim() || t('Sin respuesta'),
            envFooter,
          ].join('\n')
        : kind === 'vault'
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

    if (kind === 'feedback') {
      setComposedFeedback(body);
      setRecopied(false);
      navigator.clipboard.writeText(body).then(
        () => setClipboardOk(true),
        () => setClipboardOk(false),
      );
      // Existing GitHub comments cannot be prefilled by URL. Copying the
      // Markdown and anchoring the permanent thread at its comment field leaves
      // the user one paste away from publishing, without creating duplicates.
      window.nodus?.openExternal(`${feedbackThreadUrl}#new_comment_field`);
      return;
    }

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
              <button
                className="feedback-kind-card"
                data-kind="feedback"
                onClick={() => setKind('feedback')}
                data-testid="feedback-product-feedback"
              >
                <span className="feedback-kind-icon">
                  <Icon name="chat" size={18} />
                </span>
                <span className="feedback-kind-title">{t('Dar feedback')} <Icon name="chevronRight" size={14} /></span>
                <span className="feedback-kind-description">{t('Valora tu experiencia y cuéntanos qué funciona bien y qué deberíamos mejorar.')}</span>
              </button>
            </div>
          ) : kind === 'feedback' && composedFeedback !== null ? (
            <div className="feedback-form" data-kind="feedback">
              <div
                className={`feedback-note ${
                  clipboardOk ? 'feedback-note-green' : 'feedback-note-amber'
                }`}
              >
                <Icon name={clipboardOk ? 'check' : 'info'} size={14} className="mt-0.5 shrink-0" />
                <span>
                  {clipboardOk
                    ? t('Tu aportación está copiada y el hilo se ha abierto en el navegador. Pégala en el cuadro de comentario y publícala.')
                    : t('No se pudo copiar automáticamente. Copia el texto de abajo y pégalo en el comentario del hilo.')}
                </span>
              </div>

              <textarea
                readOnly
                className="input feedback-input min-h-[260px] resize-y font-mono text-xs"
                value={composedFeedback}
              />

              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="btn btn-ghost gap-1.5"
                  onClick={() => void navigator.clipboard.writeText(composedFeedback).then(
                    () => setRecopied(true),
                    () => setRecopied(false),
                  )}
                >
                  <Icon name={recopied ? 'check' : 'copy'} size={15} />
                  {recopied ? t('Copiado') : t('Copiar de nuevo')}
                </button>
                <button
                  className="btn btn-ghost gap-1.5"
                  onClick={() => window.nodus?.openExternal(`${feedbackThreadUrl}#new_comment_field`)}
                >
                  <Icon name="external" size={15} /> {t('Volver a abrir el hilo')}
                </button>
              </div>
            </div>
          ) : (
            <div className="feedback-form" data-kind={kind}>
              <button
                className="feedback-back"
                onClick={() => setKind(null)}
              >
                <Icon name="chevronLeft" size={14} /> {t('Cambiar tipo')}
              </button>

              {kind === 'feedback' ? (
                <>
                  <div className="feedback-note feedback-note-green">
                    <Icon name="chat" size={14} className="mt-0.5" />
                    <span>{t('Todas las preguntas son opcionales. Responde solo a las que quieras.')}</span>
                  </div>

                  <div className="feedback-system-info">
                    <div>
                      <Icon name="chat" size={13} /> {t('Se publicará en el hilo abierto de esta sección')}
                    </div>
                    <span>{t('Hilo')} #{PRODUCT_FEEDBACK_THREAD} · GitHub</span>
                  </div>

                  <div className="feedback-rating-legend" aria-label={t('Escala de valoración')}>
                    <span data-band="low">0–4 <small>{t('Necesita mejorar')}</small></span>
                    <span data-band="medium">5–6 <small>{t('Aceptable')}</small></span>
                    <span data-band="good">7–8 <small>{t('Bien')}</small></span>
                    <span data-band="excellent">9–10 <small>{t('Excelente')}</small></span>
                  </div>

                  <div className="feedback-ratings">
                    {FEEDBACK_RATING_QUESTIONS.map(({ key, label: question }) => (
                      <fieldset className="feedback-rating-field" key={key}>
                        <legend>{t(question)}</legend>
                        <div className="feedback-rating-scale" role="radiogroup" aria-label={t(question)}>
                          {Array.from({ length: 11 }, (_, score) => (
                            <button
                              type="button"
                              key={score}
                              className="feedback-rating-button"
                              data-score={score}
                              aria-pressed={ratings[key] === score}
                              aria-label={`${t(question)}: ${score}`}
                              onClick={() => setRatings((current) => ({
                                ...current,
                                [key]: current[key] === score ? null : score,
                              }))}
                            >
                              {score}
                            </button>
                          ))}
                        </div>
                      </fieldset>
                    ))}
                  </div>

                  <FieldLabel>{t('¿Qué te gusta de Nodus?')}</FieldLabel>
                  <textarea
                    className="input feedback-input min-h-[80px] resize-y"
                    value={liked}
                    onChange={(event) => setLiked(event.target.value)}
                    placeholder={t('Funciones, detalles o experiencias que valoras (opcional)')}
                  />
                  <FieldLabel>{t('¿Qué crees que debería mejorar?')}</FieldLabel>
                  <textarea
                    className="input feedback-input min-h-[80px] resize-y"
                    value={improve}
                    onChange={(event) => setImprove(event.target.value)}
                    placeholder={t('Cambios que harían Nodus más útil para ti (opcional)')}
                  />
                </>
              ) : kind === 'vault' ? (
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
          <span>
            {kind === null
              ? <><Icon name="network" size={13} /> NODUS</>
              : kind === 'feedback' && composedFeedback !== null
                ? t('Gracias por echar una mano con el diseño.')
                : t('Se abrirá GitHub para que revises y publiques.')}
          </span>
          <span>
            <Icon name="gitPr" size={13} /> GITHUB · {kind === 'feedback' ? `#${PRODUCT_FEEDBACK_THREAD}` : 'ISSUES'}
          </span>
          {kind === 'feedback' && composedFeedback !== null ? (
            <button onClick={onClose}>{t('Cerrar')} <Icon name="check" size={14} /></button>
          ) : kind !== null ? (
            <button onClick={send} disabled={!canSend}>
              <Icon name="external" size={15} /> {kind === 'feedback' ? t('Llevar al hilo') : t('Enviar a GitHub')}
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
