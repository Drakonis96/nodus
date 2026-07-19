import { useEffect, useState } from 'react';
import { Icon } from '../components/ui';
import { t } from '../i18n';

// Same repository the bug/feature reports go to.
const REPO = 'Drakonis96/nodus';

export type RoadmapTopicKey =
  | 'guiaDocente'
  | 'unidadesDidacticas'
  | 'situacionesAprendizaje'
  | 'adaptaciones'
  | 'notas'
  | 'proyectosInnovacion';

interface RoadmapThread {
  /** Number of the permanent GitHub issue that acts as the forum thread. */
  issue: number;
  /** Sidebar label, reused as the modal title. */
  label: string;
  /** One line describing what the section is meant to become. */
  blurb: string;
  /** Shown as a warning when the section would deal with personal data. */
  sensitive?: boolean;
}

/**
 * The planned teaching sections that have a thread instead of a product surface.
 * Each key maps to a permanent issue in the repo labelled `roadmap-feedback`;
 * users comment there so the feature is discussed before it is built.
 *
 * When a section ships, remove its entry here AND close the issue, otherwise the
 * sidebar keeps sending people to a thread nobody reads any more.
 */
export const ROADMAP_THREADS: Record<RoadmapTopicKey, RoadmapThread> = {
  guiaDocente: {
    issue: 68,
    label: 'Guía docente / Programación',
    blurb: 'Redactar y mantener la programación didáctica del curso, conectada con los materiales, las unidades y los criterios que ya usas para calificar.',
  },
  unidadesDidacticas: {
    issue: 69,
    label: 'Unidades didácticas',
    blurb: 'La pieza intermedia entre la programación anual y el día a día: temporalización, actividades, recursos y criterios que alimentan el cuaderno de notas.',
  },
  situacionesAprendizaje: {
    issue: 70,
    label: 'Situaciones de aprendizaje',
    blurb: 'Diseñar situaciones de aprendizaje completas: contexto, reto, producto final, secuencia de actividades y competencias implicadas.',
  },
  adaptaciones: {
    issue: 71,
    label: 'Adaptaciones',
    blurb: 'Gestionar adaptaciones y medidas de atención a la diversidad por alumno o por grupo, con su seguimiento y su reflejo en la evaluación.',
    sensitive: true,
  },
  notas: {
    issue: 72,
    label: 'Notas',
    blurb: 'Un cuaderno del docente: observaciones de clase, incidencias y seguimiento, con la opción de colgar cada nota de un curso, grupo o alumno.',
  },
  proyectosInnovacion: {
    issue: 73,
    label: 'Proyectos de innovación',
    blurb: 'Planificar y documentar proyectos de innovación educativa, desde la hipótesis inicial hasta la memoria final que pide la administración.',
  },
};

/**
 * Feedback modal for teaching sections that are planned but not built yet.
 *
 * Unlike {@link FeedbackModal}, which files a brand-new issue, this one funnels
 * everybody into a single permanent thread per section so the discussion reads
 * like a forum. GitHub can only prefill *new* issues — there is no way to
 * preload the comment box of an existing one — so on send we copy the composed
 * Markdown to the clipboard and open the thread anchored at its comment field,
 * leaving the user one paste away from posting. The confirmation step keeps the
 * text on screen so a clipboard failure is recoverable instead of silent.
 */
export function RoadmapFeedbackModal({ topic, onClose }: { topic: RoadmapTopicKey; onClose: () => void }) {
  const thread = ROADMAP_THREADS[topic];
  const [today, setToday] = useState('');
  const [wish, setWish] = useState('');
  const [avoid, setAvoid] = useState('');
  const [context, setContext] = useState('');
  const [composed, setComposed] = useState<string | null>(null);
  const [clipboardOk, setClipboardOk] = useState(true);
  const [recopied, setRecopied] = useState(false);

  // Close on Escape, like the app's other modals.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const threadUrl = `https://github.com/${REPO}/issues/${thread.issue}`;
  const canSend = wish.trim().length > 0;

  const send = () => {
    if (!canSend) return;
    const body = [
      ...(context.trim() ? [`**${t('Contexto')}:** ${context.trim()}`, ''] : []),
      `### ${t('Qué esperaría poder hacer aquí')}`,
      wish.trim(),
      ...(today.trim() ? ['', `### ${t('Cómo lo resuelvo hoy')}`, today.trim()] : []),
      ...(avoid.trim() ? ['', `### ${t('Qué no debería hacer')}`, avoid.trim()] : []),
    ].join('\n');
    setComposed(body);
    navigator.clipboard.writeText(body).then(
      () => setClipboardOk(true),
      () => setClipboardOk(false),
    );
    // GitHub's comment box anchor. If GitHub ever renames it the user still
    // lands on the thread — they just lose the automatic scroll.
    window.nodus?.openExternal(`${threadUrl}#new_comment_field`);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t(thread.label)}
        data-testid="roadmap-feedback-modal"
        className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-950"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <Icon name="sparkles" className="text-indigo-500 dark:text-indigo-300" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t(thread.label)}</h2>
            <p className="text-xs text-neutral-500">
              {t('Aún no está implementado. Ayúdame a decidir cómo debería ser.')}
            </p>
          </div>
          <button className="btn btn-ghost p-1.5" onClick={onClose} title={t('Cerrar')}>
            <Icon name="x" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {composed === null ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900 dark:border-indigo-800/70 dark:bg-indigo-950/30 dark:text-indigo-200">
                <div className="flex items-start gap-2">
                  <Icon name="bulb" size={14} className="mt-0.5 shrink-0" />
                  <span>{t(thread.blurb)}</span>
                </div>
              </div>

              {thread.sensitive && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
                  <Icon name="lock" size={14} className="mt-0.5 shrink-0" />
                  <span>{t('El hilo es público: describe los casos en abstracto, sin datos reales de alumnado.')}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <FieldLabel>{t('Qué esperarías poder hacer en esta sección')}</FieldLabel>
                <textarea
                  autoFocus
                  className="input min-h-[90px] w-full resize-y"
                  value={wish}
                  onChange={(e) => setWish(e.target.value)}
                  placeholder={t('Lo que de verdad te haría falta, aunque suene ambicioso.')}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel>{t('Cómo lo resuelves hoy (opcional)')}</FieldLabel>
                <textarea
                  className="input min-h-[70px] w-full resize-y"
                  value={today}
                  onChange={(e) => setToday(e.target.value)}
                  placeholder={t('Word, Excel, la plataforma del centro, papel… y qué te hace perder más tiempo.')}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel>{t('Qué no debería hacer (opcional)')}</FieldLabel>
                <textarea
                  className="input min-h-[60px] w-full resize-y"
                  value={avoid}
                  onChange={(e) => setAvoid(e.target.value)}
                  placeholder={t('Automatismos que te molestarían o decisiones que prefieres tomar tú.')}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel>{t('Tu contexto (opcional)')}</FieldLabel>
                <input
                  className="input w-full"
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  placeholder={t('Ej.: Secundaria, Geografía e Historia, Andalucía')}
                />
              </div>

              <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/50">
                <div className="mb-1 flex items-center gap-1.5 font-medium text-neutral-600 dark:text-neutral-400">
                  <Icon name="chat" size={13} /> {t('Se publicará en el hilo abierto de esta sección')}
                </div>
                <span>
                  {t('Hilo')} #{thread.issue} · {t('Podrás leer y responder a lo que hayan escrito otros docentes.')}
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                  clipboardOk
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-200'
                    : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200'
                }`}
              >
                <Icon name={clipboardOk ? 'check' : 'info'} size={14} className="mt-0.5 shrink-0" />
                <span>
                  {clipboardOk
                    ? t('Tu aportación está copiada y el hilo se ha abierto en el navegador. Pégala en el cuadro de comentario y publícala.')
                    : t('No se pudo copiar automáticamente. Copia el texto de abajo y pégalo en el comentario del hilo.')}
                </span>
              </div>

              <textarea readOnly className="input min-h-[180px] w-full resize-y font-mono text-xs" value={composed} />

              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="btn btn-ghost gap-1.5"
                  onClick={() => void navigator.clipboard.writeText(composed).then(() => setRecopied(true), () => setRecopied(false))}
                >
                  <Icon name={recopied ? 'check' : 'copy'} size={15} /> {recopied ? t('Copiado') : t('Copiar de nuevo')}
                </button>
                <button className="btn btn-ghost gap-1.5" onClick={() => window.nodus?.openExternal(`${threadUrl}#new_comment_field`)}>
                  <Icon name="external" size={15} /> {t('Volver a abrir el hilo')}
                </button>
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
          {composed === null ? (
            <>
              <span className="text-xs text-neutral-500">{t('Se abrirá GitHub para que revises y publiques.')}</span>
              <button className="btn btn-primary gap-1.5" onClick={send} disabled={!canSend}>
                <Icon name="external" size={15} /> {t('Llevar al hilo')}
              </button>
            </>
          ) : (
            <>
              <span className="text-xs text-neutral-500">{t('Gracias por echar una mano con el diseño.')}</span>
              <button className="btn btn-primary" onClick={onClose}>{t('Cerrar')}</button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">{children}</label>;
}
