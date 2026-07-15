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
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('Enviar propuesta a GitHub')}
        className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-950"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <Icon name="gitPr" className="text-indigo-500 dark:text-indigo-300" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t('Enviar propuesta a GitHub')}</h2>
            <p className="text-xs text-neutral-500">
              {t('Genera un reporte preformateado y ábrelo en GitHub para publicarlo.')}
            </p>
          </div>
          <button className="btn btn-ghost p-1.5" onClick={onClose} title={t('Cerrar')}>
            <Icon name="x" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {kind === null ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <button
                className="group flex flex-col items-start gap-2 rounded-xl border border-neutral-200 p-4 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-50 dark:border-neutral-800 dark:hover:border-indigo-500/60 dark:hover:bg-indigo-950/30"
                onClick={() => setKind('feature')}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300">
                  <Icon name="bulb" size={18} />
                </span>
                <span className="font-semibold text-neutral-900 dark:text-neutral-100">{t('Nueva función')}</span>
                <span className="text-xs text-neutral-500">{t('Propón una mejora o una función que te gustaría ver en Nodus.')}</span>
              </button>
              <button
                className="group flex flex-col items-start gap-2 rounded-xl border border-neutral-200 p-4 text-left transition-colors hover:border-red-400 hover:bg-red-50 dark:border-neutral-800 dark:hover:border-red-500/60 dark:hover:bg-red-950/30"
                onClick={() => setKind('bug')}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-300">
                  <Icon name="bug" size={18} />
                </span>
                <span className="font-semibold text-neutral-900 dark:text-neutral-100">{t('Reporte de error')}</span>
                <span className="text-xs text-neutral-500">{t('Cuéntanos qué falla, con los pasos para reproducirlo.')}</span>
              </button>
              <button
                className="group flex flex-col items-start gap-2 rounded-xl border border-neutral-200 p-4 text-left transition-colors hover:border-teal-400 hover:bg-teal-50 dark:border-neutral-800 dark:hover:border-teal-500/60 dark:hover:bg-teal-950/30"
                onClick={() => setKind('vault')}
                data-testid="feedback-new-vault-type"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300">
                  <Icon name="archive" size={18} />
                </span>
                <span className="font-semibold text-neutral-900 dark:text-neutral-100">{t('Nuevo tipo de vault')}</span>
                <span className="text-xs text-neutral-500">{t('Propón un espacio especializado y cómo colaborarías para hacerlo viable.')}</span>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <button
                className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                onClick={() => setKind(null)}
              >
                <Icon name="chevronLeft" size={14} /> {t('Cambiar tipo')}
              </button>

              {kind === 'vault' ? (
                <>
                  <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-900 dark:border-teal-800/70 dark:bg-teal-950/30 dark:text-teal-200">
                    <div className="flex items-start gap-2"><Icon name="users" size={14} className="mt-0.5" /><span>{t('Un vault especializado puede requerir arquitectura nueva. Se priorizará cuando haya colaboración activa, conocimiento del área y personas dispuestas a probarlo.')}</span></div>
                  </div>
                  <FieldLabel>{t('Rama de conocimiento o área')}</FieldLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {VAULT_AREA_SUGGESTIONS.map((area) => <button key={area} type="button" className="rounded-full border border-neutral-300 px-2 py-1 text-[10px] text-neutral-600 hover:border-teal-500 hover:text-teal-700 dark:border-neutral-700 dark:text-neutral-400 dark:hover:text-teal-300" onClick={() => setTitle(t(area))}>{t(area)}</button>)}
                  </div>
                  <input autoFocus className="input w-full" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('Ej.: ciencias de la salud, periodismo, ingeniería…')} />

                  <FieldLabel>{t('¿Cuál es tu relación con esta área?')}</FieldLabel>
                  <select className="input w-full" value={expertise} onChange={(event) => setExpertise(event.target.value as Expertise)}>
                    <option value="">{t('Selecciona una opción')}</option>
                    <option value="specialist">{t('Soy especialista o profesional del área')}</option>
                    <option value="experienced">{t('Tengo experiencia práctica o académica')}</option>
                    <option value="interested">{t('No soy especialista, pero conozco la necesidad')}</option>
                  </select>
                  <label className="flex items-start gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
                    <input type="checkbox" className="mt-0.5" checked={activeTester} onChange={(event) => setActiveTester(event.target.checked)} />
                    <span>{t('Puedo probar activamente este vault, enviar feedback y ayudar a pulir errores.')}</span>
                  </label>

                  <FieldLabel>{t('Características que debería incluir')}</FieldLabel>
                  <textarea className="input min-h-[75px] w-full resize-y" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={t('Funciones y flujos imprescindibles para trabajar en esta área.')}/>
                  <FieldLabel>{t('Organización y estructura del vault')}</FieldLabel>
                  <textarea className="input min-h-[70px] w-full resize-y" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder={t('Secciones, jerarquías, tipos de contenido y forma de navegar.')}/>
                  <FieldLabel>{t('Beneficios y casos de uso')}</FieldLabel>
                  <textarea className="input min-h-[65px] w-full resize-y" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={t('¿A quién ayudaría y qué trabajo mejoraría?')}/>

                  <FieldLabel>{t('¿Trataría datos personales o sensibles?')}</FieldLabel>
                  <select className="input w-full" value={personalData} onChange={(event) => setPersonalData(event.target.value as typeof personalData)}>
                    <option value="unknown">{t('No estoy seguro')}</option>
                    <option value="yes">{t('Sí')}</option>
                    <option value="no">{t('No')}</option>
                  </select>
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
                    <Icon name="lock" size={14} className="mt-0.5" />
                    <span>{t('En vaults con datos personales, la IA se limitará inicialmente a modelos locales del usuario. También se valorará sustituir datos identificativos por placeholders que la IA no verá.')}</span>
                  </div>
                </>
              ) : (
                <>
                  <FieldLabel>{t('Título')}</FieldLabel>
                  <input autoFocus className="input w-full" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'feature' ? t('Resumen breve de la función') : t('Resumen breve del error')} />
                  <FieldLabel>{kind === 'feature' ? t('Descripción de la función') : t('Descripción del error')}</FieldLabel>
                  <textarea className="input min-h-[90px] w-full resize-y" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={kind === 'feature' ? t('¿Qué debería hacer Nodus?') : t('¿Qué ocurre exactamente?')} />
                  <FieldLabel>{kind === 'feature' ? t('¿Qué problema resuelve?') : t('Pasos para reproducir')}</FieldLabel>
                  <textarea className="input min-h-[70px] w-full resize-y" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder={kind === 'feature' ? t('Contexto o motivación (opcional)') : t('1. … 2. … 3. …')} />
                  <FieldLabel>{kind === 'feature' ? t('Notas adicionales') : t('Comportamiento esperado')}</FieldLabel>
                  <textarea className="input min-h-[60px] w-full resize-y" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={kind === 'feature' ? t('Cualquier otra cosa (opcional)') : t('¿Qué esperabas que ocurriera?')} />
                </>
              )}

              <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/50">
                <div className="mb-1 flex items-center gap-1.5 font-medium text-neutral-600 dark:text-neutral-400">
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

        {kind !== null && (
          <footer className="flex items-center justify-between gap-3 border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
            <span className="text-xs text-neutral-500">{t('Se abrirá GitHub para que revises y publiques.')}</span>
            <button className="btn btn-primary gap-1.5" onClick={send} disabled={!canSend}>
              <Icon name="external" size={15} /> {t('Enviar a GitHub')}
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">{children}</label>;
}
