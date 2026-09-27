import { useEffect, useState } from 'react';
import { useStudyFocus } from './StudyFocusContext';
import type { FocusPhase, FocusPreferences } from '@shared/studyFocus';
import type { StudySubject } from '@shared/studyOrg';
import { Icon } from '../ui';

export const phaseName = (phase: FocusPhase) => phase === 'work' ? 'Concentración' : phase === 'break' ? 'Descanso' : 'Descanso largo';
export function focusClock(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
export function FocusControls({ compact = false }: { compact?: boolean }) {
  const focus = useStudyFocus();
  const state = focus?.snapshot?.state;
  const [subjects, setSubjects] = useState<StudySubject[]>([]);
  const [subject, setSubject] = useState('');
  useEffect(() => {
    let alive = true;
    setSubject('');
    void window.nodus.getStudyWorkspace().then(workspace => { if (alive) setSubjects(workspace.subjects); }).catch(() => {});
    return () => { alive = false; };
  }, [focus?.snapshot?.vaultId]);
  if (!focus || !state) return <p role="status">{focus?.error ?? 'Preparando concentración…'}</p>;
  const ready = state.status === 'ready';
  const done = state.status === 'complete';
  const remaining = ready ? state.preferences.workMinutes * 60000 : state.durationMs - state.elapsedMs;
  const next = done && state.phase === 'work' ? (state.cycleBlocks % 4 === 0 ? 'descanso largo' : 'descanso') : 'bloque';
  const progress = ready ? 0 : Math.min(100, state.elapsedMs / state.durationMs * 100);
  return <div className={`focus-controls ${compact ? 'is-compact' : ''}`}>
    <div className="focus-eyebrow"><span className={`focus-dot ${state.status === 'running' ? 'active' : ''}`} />{phaseName(state.phase)} · {state.status === 'paused' ? 'En pausa' : done ? 'Completado' : ready ? 'A tu ritmo' : 'En curso'}</div>
    <div className="focus-clock" role="timer" aria-label={`${phaseName(state.phase)}, tiempo restante ${focusClock(remaining)}`}>{focusClock(remaining)}</div>
    <div className="focus-track" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
    <p className="focus-muted focus-cycle">{state.cycleBlocks} {state.cycleBlocks === 1 ? 'bloque completado' : 'bloques completados'} · Descanso largo cada 4</p>
    {state.status === 'paused' && <p className="focus-muted" role="status">{state.recovered ? 'Sesión recuperada hasta el último punto guardado. Reanuda cuando quieras.' : 'Tu tiempo está guardado. Reanuda cuando quieras.'}</p>}
    {(ready || (done && state.phase !== 'work')) && <label className="focus-label">Asignatura<select aria-label="Asignatura" className="input w-full" value={subject} onChange={event => setSubject(event.target.value)}><option value="">Sin asignatura</option>{subjects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    <div className="focus-actions">
      {(ready || done) && <button className="btn btn-primary" onClick={() => void focus.act('start', subject || null)}><Icon name="play" size={15} />{ready ? 'Iniciar bloque' : `Comenzar ${next}`}</button>}
      {state.status === 'running' && <button className="btn btn-primary" onClick={() => void focus.act('pause')}><Icon name="pause" size={15} />Pausar</button>}
      {state.status === 'paused' && <button className="btn btn-primary" onClick={() => void focus.act('resume')}><Icon name="play" size={15} />Reanudar</button>}
      {!ready && <button className="btn btn-ghost" onClick={() => void focus.act('finish')}>Finalizar sesión</button>}
    </div>
    <label className="focus-toggle"><input type="checkbox" checked={focus.reduced} onChange={event => focus.setReduced(event.target.checked)} /><span>Reducir distracciones<small className="focus-muted">Despeja la pantalla, con o sin temporizador.</small></span></label>
    {focus.error && <p role="alert" className="text-red-500 text-sm">{focus.error}</p>}
    <details className="focus-settings"><summary>Configurar temporizador</summary><div className="focus-duration-grid">
      <Minutes label="Trabajo" field="workMinutes" preferences={state.preferences} save={focus.configure} />
      <Minutes label="Descanso" field="breakMinutes" preferences={state.preferences} save={focus.configure} />
      <Minutes label="Descanso largo" field="longBreakMinutes" preferences={state.preferences} save={focus.configure} />
    </div><p className="focus-muted">Minutos por tramo. Los cambios se aplican al siguiente tramo. Cada tramo comienza cuando tú lo decides.</p>
      <label className="focus-toggle"><input type="checkbox" checked={state.preferences.sound} onChange={event => void focus.configure({ sound: event.target.checked })} />Sonido suave al terminar</label>
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
