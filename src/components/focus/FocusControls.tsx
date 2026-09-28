import { useEffect, useState } from 'react';
import { openFocusLayout, useStudyFocus } from './StudyFocusContext';
import { FOCUS_TASK_MAX_LENGTH, type FocusPhase, type FocusPreferences, type FocusState } from '@shared/studyFocus';
import type { StudySubject } from '@shared/studyOrg';
import { STUDY_WORKSPACE_CHANGED } from '../StudySidebar';
import { Icon } from '../ui';
import { errorText, t, tx } from '../../i18n';

/** Blocks in a cycle before the long break (the service counts the same way). */
export const FOCUS_CYCLE_LENGTH = 4;
export const phaseName = (phase: FocusPhase) => phase === 'work' ? t('Concentración') : phase === 'break' ? t('Descanso') : t('Descanso largo');
export function focusClock(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
export function focusRemaining(state: FocusState) {
  return state.status === 'ready' ? state.preferences.workMinutes * 60000 : state.durationMs - state.elapsedMs;
}
export function focusStatusLabel(state: FocusState) {
  return state.status === 'paused' ? t('En pausa') : state.status === 'complete' ? t('Completado') : state.status === 'ready' ? t('A tu ritmo') : t('En curso');
}
export const focusBlocksLabel = (count: number) => count === 1 ? tx('{n} bloque completado', { n: count }) : tx('{n} bloques completados', { n: count });

/** Subjects for the pickers, refreshed whenever the Study organization changes. */
export function useFocusSubjects(vaultId: string | undefined) {
  const [subjects, setSubjects] = useState<StudySubject[]>([]);
  useEffect(() => {
    if (!vaultId) { setSubjects([]); return; }
    let alive = true;
    const load = () => { void window.nodus.getStudyWorkspace().then(workspace => { if (alive) setSubjects(workspace.subjects.filter(subject => !subject.archivedAt && !subject.deletedAt)); }).catch(() => {}); };
    load();
    window.addEventListener(STUDY_WORKSPACE_CHANGED, load);
    return () => { alive = false; window.removeEventListener(STUDY_WORKSPACE_CHANGED, load); };
  }, [vaultId]);
  return subjects;
}

export function FocusControls({ compact = false }: { compact?: boolean }) {
  const focus = useStudyFocus();
  const state = focus?.snapshot?.state;
  const subjects = useFocusSubjects(focus?.snapshot?.vaultId);
  const ready = state?.status === 'ready';
  const done = state?.status === 'complete';
  // The subject and intention are asked before a work block only; a break keeps them.
  const asksForBlock = Boolean(state && (ready || (done && state.phase !== 'work')));
  const [subject, setSubject] = useState('');
  const [task, setTask] = useState('');
  useEffect(() => {
    if (!asksForBlock || !state) return;
    setSubject(state.subjectId && subjects.some(item => item.id === state.subjectId) ? state.subjectId : '');
    setTask(state.task ?? '');
    // Re-seed only when the form appears or the stored choice changes, never while typing.
  }, [asksForBlock, state?.subjectId, state?.task, subjects, focus?.snapshot?.vaultId]);
  // Optimistic: the box flips on click; the stored preference catches up a moment later.
  const [enterDraft, setEnterDraft] = useState<boolean | null>(null);
  useEffect(() => { setEnterDraft(null); }, [state?.preferences.enterOnStart]);
  if (!focus || !state) return <p role="status">{focus?.error ? errorText(focus.error) : t('Preparando concentración…')}</p>;
  const remaining = focusRemaining(state);
  const nextBreak = state.cycleBlocks % FOCUS_CYCLE_LENGTH === 0 ? t('Comenzar descanso largo') : t('Comenzar descanso');
  const startLabel = ready ? t('Iniciar bloque') : done && state.phase === 'work' ? nextBreak : t('Comenzar bloque');
  const progress = ready ? 0 : Math.min(100, state.elapsedMs / state.durationMs * 100);
  const subjectName = subjects.find(item => item.id === state.subjectId)?.name;
  const start = () => void focus.act('start', asksForBlock ? { subjectId: subject || null, task } : undefined);
  // While a block runs the box is the mode itself; otherwise it is the choice for the
  // next start or resume (on by default). Either way the choice is remembered.
  const live = state.status === 'running';
  const modeChecked = focus.reduced || (!live && (enterDraft ?? state.preferences.enterOnStart !== false));
  const toggleMode = (value: boolean) => {
    setEnterDraft(value);
    void focus.configure({ enterOnStart: value });
    if (!value) focus.setReduced(false);
    else if (live) focus.setReduced(true);
  };
  return <div className={`focus-controls ${compact ? 'is-compact' : ''}`}>
    <div className="focus-eyebrow"><span className={`focus-dot ${state.status === 'running' ? 'active' : ''}`} />{phaseName(state.phase)} · {focusStatusLabel(state)}</div>
    <div className="focus-clock" role="timer" aria-label={tx('{phase}, tiempo restante {time}', { phase: phaseName(state.phase), time: focusClock(remaining) })}>{focusClock(remaining)}</div>
    <div className="focus-track" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
    {!asksForBlock && (subjectName || state.task) && <p className="focus-current" data-testid="focus-current-block">
      {subjectName && <span className="focus-current-subject">{subjectName}</span>}
      {state.task && <span className="focus-current-task">{state.task}</span>}
    </p>}
    <p className="focus-muted focus-cycle">{focusBlocksLabel(state.cycleBlocks)} · {tx('Descanso largo cada {n}', { n: FOCUS_CYCLE_LENGTH })}</p>
    {state.status === 'paused' && <p className="focus-muted" role="status">{state.recovered ? t('Sesión recuperada hasta el último punto guardado. Reanuda cuando quieras.') : t('Tu tiempo está guardado. Reanuda cuando quieras.')}</p>}
    {asksForBlock && <div className="focus-block-form">
      <label className="focus-label">{t('Asignatura')}<select aria-label={t('Asignatura')} className="input w-full" value={subject} onChange={event => setSubject(event.target.value)}><option value="">{t('Sin asignatura')}</option>{subjects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="focus-label">{t('Objetivo del bloque (opcional)')}<input aria-label={t('Objetivo del bloque')} className="input w-full" value={task} maxLength={FOCUS_TASK_MAX_LENGTH} placeholder={t('Por ejemplo, repasar el tema 3')} onChange={event => setTask(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); start(); } }} /></label>
    </div>}
    <div className="focus-actions">
      {(ready || done) && <button className="btn btn-primary" onClick={start}><Icon name="play" size={15} />{startLabel}</button>}
      {state.status === 'running' && <button className="btn btn-primary" onClick={() => void focus.act('pause')}><Icon name="pause" size={15} />{t('Pausar')}</button>}
      {state.status === 'paused' && <button className="btn btn-primary" onClick={() => void focus.act('resume')}><Icon name="play" size={15} />{t('Reanudar')}</button>}
      {!ready && <button className="btn btn-ghost" onClick={() => void focus.act('finish')}>{t('Finalizar sesión')}</button>}
    </div>
    <label className="focus-toggle"><input type="checkbox" data-testid="focus-mode-toggle" checked={modeChecked} onChange={event => toggleMode(event.target.checked)} /><span>{t('Modo concentración')}<small className="focus-muted">{live || focus.reduced ? t('Despeja la pantalla y deja a mano tus materiales, con o sin temporizador.') : state.status === 'paused' ? t('Se activa al reanudar el bloque: despeja la pantalla y deja a mano tus materiales.') : t('Se activa al iniciar el bloque: despeja la pantalla y deja a mano tus materiales.')}</small></span></label>
    <button type="button" className="focus-customize" onClick={openFocusLayout}><Icon name="eye" size={13} />{t('Personalizar el modo concentración')}</button>
    {focus.error != null && <p role="alert" className="text-red-500 text-sm">{errorText(focus.error)}</p>}
    <details className="focus-settings"><summary>{t('Configurar temporizador')}</summary><div className="focus-duration-grid">
      <Minutes label={t('Trabajo')} field="workMinutes" preferences={state.preferences} save={focus.configure} />
      <Minutes label={t('Descanso')} field="breakMinutes" preferences={state.preferences} save={focus.configure} />
      <Minutes label={t('Descanso largo')} field="longBreakMinutes" preferences={state.preferences} save={focus.configure} />
    </div><p className="focus-muted">{t('Minutos por tramo. Los cambios se aplican al siguiente tramo. Cada tramo comienza cuando tú lo decides.')}</p>
      <label className="focus-toggle"><input type="checkbox" checked={state.preferences.sound} onChange={event => void focus.configure({ sound: event.target.checked })} />{t('Sonido suave al terminar')}</label>
    </details>
  </div>;
}
function Minutes({ label, field, preferences, save }: { label: string; field: 'workMinutes' | 'breakMinutes' | 'longBreakMinutes'; preferences: FocusPreferences; save: (patch: Partial<FocusPreferences>) => Promise<void> }) {
  const [value, setValue] = useState(String(preferences[field]));
  useEffect(() => setValue(String(preferences[field])), [preferences[field]]);
  return <label className="focus-label">{label}<input className="input w-full" type="number" min={1} max={180} value={value} onChange={event => setValue(event.target.value)} onBlur={event => {
    if (event.target.validity.valid && value !== '') void save({ [field]: Number(value) });
    else setValue(String(preferences[field]));
  }} /></label>;
}
