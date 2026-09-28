import { useEffect, useId, useState } from 'react';
import { FOCUS_LAYOUT_BLOCKS, FOCUS_LAYOUT_DEFAULT_VISIBLE, FOCUS_LAYOUT_HEADER, focusLayoutVisible } from '@shared/studyFocus';
import { OPEN_FOCUS_LAYOUT_EVENT, useStudyFocus, useStudyFocusActions, useStudyFocusLayout } from './StudyFocusContext';
import { Icon, ModalBackdrop } from '../ui';
import { t, tx } from '../../i18n';

/** A study section the focus rail can show, already translated by the shell. */
export interface FocusSectionOption { key: string; label: string; icon: string }

const BLOCK_LABEL: Record<(typeof FOCUS_LAYOUT_BLOCKS)[number], () => string> = {
  'block:timer': () => t('Temporizador'),
  'block:subject': () => t('Asignatura, objetivo y nuevo apunte'),
  'block:shelf': () => t('Apuntes y materiales de la asignatura'),
};
const BLOCK_ICON: Record<(typeof FOCUS_LAYOUT_BLOCKS)[number], string> = { 'block:timer': 'focus', 'block:subject': 'graduation', 'block:shelf': 'notebook' };
const HEADER_LABEL: Record<(typeof FOCUS_LAYOUT_HEADER)[number], () => string> = {
  'header:media': () => t('Controles de medios del navegador'),
  'header:commands': () => t('Paleta de comandos'),
  'header:theme': () => t('Tema claro u oscuro'),
  'header:queue': () => t('Cola y tareas'),
};
const HEADER_ICON: Record<(typeof FOCUS_LAYOUT_HEADER)[number], string> = { 'header:media': 'volume', 'header:commands': 'search', 'header:theme': 'moon', 'header:queue': 'clock' };

/**
 * What the focus mode shows, element by element. It only ever changes the focus mode:
 * the ordinary sidebar and header keep their own configuration.
 */
export function FocusLayoutDialog({ sections }: { sections: FocusSectionOption[] }) {
  const [open, setOpen] = useState(false);
  const stored = useStudyFocusLayout();
  // Optimistic copies: a box must flip on click, not after the round trip to the main process.
  const [draftLayout, setDraftLayout] = useState<Record<string, boolean> | null>(null);
  const [draftEnter, setDraftEnter] = useState<boolean | null>(null);
  useEffect(() => { setDraftLayout(null); setDraftEnter(null); }, [stored]);
  const layout = draftLayout ?? stored.layout;
  const enterOnStart = draftEnter ?? stored.enterOnStart;
  const ready = stored.ready;
  const actions = useStudyFocusActions();
  const titleId = useId();
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_FOCUS_LAYOUT_EVENT, show);
    return () => window.removeEventListener(OPEN_FOCUS_LAYOUT_EVENT, show);
  }, []);
  if (!open || !ready || !actions) return null;
  const ids = [...FOCUS_LAYOUT_BLOCKS, ...sections.map(section => `nav:${section.key}`), ...FOCUS_LAYOUT_HEADER];
  const visibleCount = ids.filter(id => focusLayoutVisible(layout, id)).length;
  // Only departures from the defaults are stored, so a default added later still applies.
  const save = (next: Record<string, boolean>) => {
    const compact: Record<string, boolean> = {};
    for (const [id, visible] of Object.entries(next)) if (visible !== FOCUS_LAYOUT_DEFAULT_VISIBLE.has(id)) compact[id] = visible;
    setDraftLayout(compact);
    void actions.configure({ layout: compact });
  };
  const setVisible = (id: string, visible: boolean) => save({ ...layout, [id]: visible });
  const row = (id: string, label: string, icon: string) => <label key={id} className="focus-layout-option">
    <input type="checkbox" data-testid={`focus-layout-${id}`} checked={focusLayoutVisible(layout, id)} onChange={event => setVisible(id, event.target.checked)} />
    <Icon name={icon} size={15} /><span>{label}</span>
  </label>;
  return <ModalBackdrop onClose={() => setOpen(false)}>
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="focus-layout-dialog" className="focus-layout-dialog">
      <div className="focus-layout-head">
        <div>
          <h2 id={titleId}><Icon name="focus" size={17} />{t('Personalizar el modo concentración')}</h2>
          <p>{t('Elige qué ves mientras estudias. Solo cambia el modo concentración: el menú lateral de siempre no se toca.')}</p>
        </div>
        <button type="button" className="focus-rail-icon-button" aria-label={t('Cerrar')} title={t('Cerrar')} onClick={() => setOpen(false)}><Icon name="x" size={16} /></button>
      </div>
      <div className="focus-layout-body">
        <label className="focus-layout-option focus-layout-start">
          <input type="checkbox" data-testid="focus-layout-enter-on-start" checked={enterOnStart} onChange={event => { setDraftEnter(event.target.checked); void actions.configure({ enterOnStart: event.target.checked }); }} />
          <span>{t('Activar el modo al iniciar un bloque')}<small>{t('Si lo desactivas, puedes entrar cuando quieras desde la cabecera.')}</small></span>
        </label>
        <fieldset><legend>{t('Parte superior del panel')}</legend>
          {FOCUS_LAYOUT_BLOCKS.map(id => row(id, BLOCK_LABEL[id](), BLOCK_ICON[id]))}
        </fieldset>
        <fieldset><legend>{t('Secciones')}</legend>
          <div className="focus-layout-grid">{sections.map(section => row(`nav:${section.key}`, section.label, section.icon))}</div>
        </fieldset>
        <fieldset><legend>{t('Cabecera')}</legend>
          {FOCUS_LAYOUT_HEADER.map(id => row(id, HEADER_LABEL[id](), HEADER_ICON[id]))}
        </fieldset>
      </div>
      <div className="focus-layout-foot">
        <span className="focus-muted">{tx('{n} de {total} elementos visibles', { n: visibleCount, total: ids.length })}</span>
        <span className="focus-layout-actions">
          <button type="button" className="btn btn-ghost" onClick={() => save({})}>{t('Restablecer')}</button>
          <button type="button" className="btn btn-ghost" onClick={() => save(Object.fromEntries(ids.map(id => [id, true])))}>{t('Mostrar todo')}</button>
          <button type="button" className="btn btn-primary" data-testid="focus-layout-done" onClick={() => setOpen(false)}>{t('Hecho')}</button>
        </span>
      </div>
    </div>
  </ModalBackdrop>;
}

/** Asked after leaving the mode with a block open: finish it, or keep it paused. */
export function FocusExitDialog() {
  const focus = useStudyFocus();
  const titleId = useId();
  if (!focus?.exitPrompt) return null;
  const keep = () => void focus.resolveExitPrompt(false);
  const paused = focus.snapshot?.state.status === 'paused';
  return <ModalBackdrop onClose={keep}>
    <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} data-testid="focus-exit-dialog" className="focus-layout-dialog focus-exit-dialog">
      <h2 id={titleId}><Icon name="focus" size={17} />{t('¿Quieres finalizar la sesión?')}</h2>
      <p>{paused ? t('Has salido del modo concentración y el bloque está en pausa. El tiempo dedicado ya está guardado.') : t('Has salido del modo concentración. El tiempo dedicado ya está guardado.')}</p>
      <div className="focus-layout-actions">
        <button type="button" className="btn btn-ghost" data-testid="focus-exit-keep" onClick={keep}>{paused ? t('Dejarla en pausa') : t('Ahora no')}</button>
        <button type="button" className="btn btn-primary" data-testid="focus-exit-finish" autoFocus onClick={() => void focus.resolveExitPrompt(true)}>{t('Finalizar sesión')}</button>
      </div>
    </div>
  </ModalBackdrop>;
}
