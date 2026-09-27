import { useEffect, useState, type KeyboardEvent } from 'react';
import { useStudyFocus } from '../components/focus/StudyFocusContext';
import { FocusControls } from '../components/focus/FocusControls';
import type { FocusDay, FocusStats } from '@shared/studyFocus';
import { Icon } from '../components/ui';
import '../components/focus/focus.css';

const minutes = (ms: number) => Math.floor(ms / 60000);
const minuteDetail = (ms: number) => (ms / 60000).toLocaleString('es', { maximumFractionDigits: 1 });
const dateLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short' });
const dayDetail = (day: FocusDay) => `${dateLabel(day.day)}: ${minuteDetail(day.milliseconds)} minutos, ${day.blocks} bloques`;
function moveDay(event: KeyboardEvent<HTMLDivElement>, step = 1) {
  const delta = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
  if (!delta) return;
  const buttons = [...event.currentTarget.querySelectorAll('button')];
  const index = buttons.indexOf(event.target as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  buttons[Math.min(buttons.length - 1, Math.max(0, index + delta))]?.focus();
}
export function StudyFocusView() {
  const focus = useStudyFocus();
  const [stats, setStats] = useState<FocusStats | null>(null);
  const [range, setRange] = useState<7 | 30>(7);
  const [selected, setSelected] = useState<FocusDay | null>(null);
  const [error, setError] = useState('');
  const state = focus?.snapshot?.state;
  useEffect(() => { setStats(null); setSelected(null); }, [focus?.snapshot?.vaultId]);
  // Refresh from committed main-process time, including the current partial block.
  useEffect(() => {
    let alive = true;
    const load = () => { void window.nodus.getStudyFocusStats().then(next => { if (alive) { setStats(next); setError(''); } }).catch(reason => { if (alive) setError(String(reason)); }); };
    load(); const timer = setInterval(load, 15000);
    return () => { alive = false; clearInterval(timer); };
  }, [focus?.snapshot?.vaultId, state?.revision]);
  const today = stats?.days.at(-1);
  const total = today?.milliseconds ?? 0;
  const goal = state?.preferences.dailyGoalMinutes ?? null;
  const days = stats?.days.slice(-range) ?? [];
  const peak = Math.max(1, ...days.map(day => day.milliseconds / 60000));
  const activeDays = stats?.days.filter(day => day.milliseconds > 0).length ?? 0;
  const motivation = goal && total >= goal * 60000 ? 'Has alcanzado tu objetivo. El resto del día es tuyo.' : total > 0 ? `Has dedicado ${minuteDetail(total)} minutos hoy. Un espacio para lo que importa.` : 'Elige una tarea. El primer bloque empieza cuando tú quieras.';
  return <div className="focus-page h-full overflow-y-auto" data-testid="study-focus-view"><div className="focus-page-inner">
    <div className="focus-page-heading"><div><div className="focus-eyebrow"><Icon name="focus" size={14} /> STUDY · A TU RITMO</div><h1>Concentración</h1><p className="focus-muted">Un momento para tu trabajo. Una perspectiva de tu constancia.</p></div><span className="focus-private">En esta bóveda</span></div>
    <div className="focus-main-grid"><section className="focus-card focus-timer-card" aria-label="Temporizador"><FocusControls /></section>
      <div className="focus-overview"><section className="focus-card focus-today"><div className="focus-section-heading"><h2>Hoy</h2><span className="focus-muted">{today ? dateLabel(today.day) : ''}</span></div><div className="focus-today-metrics"><div><strong>{minutes(total)}<small>min</small></strong><span className="focus-muted">de concentración</span></div><div><strong>{today?.blocks ?? 0}</strong><span className="focus-muted">bloques completados</span></div></div>
        {goal ? <><div className="focus-goal-line"><span>Meta diaria · {goal} min</span><span>{Math.min(100, Math.floor(total / (goal * 60000) * 100))}%</span></div><progress className="focus-goal-progress" aria-label="Progreso hacia la meta diaria" value={Math.min(total, goal * 60000)} max={goal * 60000} /><div className="focus-goal-edit"><label>Meta (min)<input aria-label="Meta diaria en minutos" key={goal} type="number" className="input" min={1} max={1440} defaultValue={goal} onBlur={event => { if (event.target.validity.valid && event.target.value) void focus?.configure({ dailyGoalMinutes: Number(event.target.value) }); else event.target.value = String(goal); }} /></label><button className="btn btn-ghost" onClick={() => void focus?.configure({ dailyGoalMinutes: null })}>Quitar meta</button></div></> : <button className="focus-goal-enable" onClick={() => void focus?.configure({ dailyGoalMinutes: 60 })}><Icon name="plus" size={14} />Activar meta diaria · 60 min sugeridos</button>}
      </section><section className="focus-motivation"><Icon name="sparkles" size={20} /><p>{motivation}</p></section>
      <section className="focus-card focus-chart-card"><div className="focus-section-heading"><div><h2>Evolución</h2><p className="focus-muted">Minutos por día · escala de 0 a {Math.ceil(peak)} min</p></div><div className="focus-range" aria-label="Periodo">{([7, 30] as const).map(value => <button key={value} aria-pressed={range === value} onClick={() => { setRange(value); setSelected(null); }}>{value} días</button>)}</div></div>
        <div className="focus-chart" onKeyDown={event => moveDay(event)} role="group" aria-label="Gráfico de minutos por día">{days.map(day => <button key={day.day} className="focus-bar-column" aria-label={dayDetail(day)} title={dayDetail(day)} onFocus={() => setSelected(day)} onClick={() => setSelected(day)}><span className="focus-bar-well"><span className="focus-bar" style={{ height: `${Math.max(2, day.milliseconds / 60000 / peak * 100)}%` }} /></span><span className="focus-bar-label">{range === 7 ? new Date(`${day.day}T12:00:00`).toLocaleDateString('es', { weekday: 'short' }) : day.day.slice(-2)}</span></button>)}</div>
        <p className="focus-chart-detail" role="status">{selected ? dayDetail(selected) : 'Selecciona un día para ver minutos y bloques.'}</p>
        <details className="focus-text-data"><summary>Ver datos en tabla</summary><table><caption className="sr-only">Minutos y bloques por día</caption><thead><tr><th scope="col">Día</th><th scope="col">Minutos</th><th scope="col">Bloques</th></tr></thead><tbody>{days.map(day => <tr key={day.day}><th scope="row">{dateLabel(day.day)}</th><td>{minuteDetail(day.milliseconds)}</td><td>{day.blocks}</td></tr>)}</tbody></table></details>
      </section></div></div>
    <section className="focus-card focus-consistency"><div className="focus-section-heading"><div><h2>Constancia</h2><p className="focus-muted">Últimas 12 semanas · {activeDays} {activeDays === 1 ? 'día con actividad' : 'días con actividad'}</p></div><span className="focus-muted">Cada día es una nueva oportunidad</span></div><div className="focus-heatmap" onKeyDown={event => moveDay(event, 7)} role="group" aria-label="Calendario de actividad de las últimas 12 semanas">{stats?.days.map(day => <button key={day.day} className="focus-heat-day" data-level={day.milliseconds === 0 ? 0 : day.milliseconds < 25 * 60000 ? 1 : day.milliseconds < 60 * 60000 ? 2 : 3} aria-label={dayDetail(day)} title={dayDetail(day)} onFocus={() => setSelected(day)} onClick={() => setSelected(day)} />)}</div><div className="focus-heat-legend"><span>{stats?.days[0] ? dateLabel(stats.days[0].day) : ''}</span><span>Menos <i data-level="0" /><i data-level="1" /><i data-level="2" /><i data-level="3" /> Más</span><span>Hoy</span></div><p className="focus-muted" role="status">{selected ? dayDetail(selected) : 'Puedes recorrer los días con el teclado para consultar su detalle.'}</p><details className="focus-text-data"><summary>Ver actividad de las 12 semanas</summary><ul className="focus-activity-list">{stats?.days.map(day => <li key={day.day}>{dayDetail(day)}</li>)}</ul></details></section>
    <section className="focus-card"><div className="focus-section-heading"><h2>Sesiones recientes</h2><span className="focus-muted">Tiempo efectivo de trabajo</span></div>{stats?.recent.length ? <div className="focus-session-table"><table><thead><tr><th scope="col">Inicio</th><th scope="col">Asignatura</th><th scope="col">Duración</th><th scope="col">Estado</th></tr></thead><tbody>{stats.recent.map(session => <tr key={session.id}><td>{new Date(session.startedAt).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td><td>{session.subjectName ?? 'Sin asignatura'}</td><td>{minuteDetail(session.milliseconds)} min</td><td><span className={`focus-session-status ${session.status === 'completed' ? 'completed' : ''}`}>{({ completed: 'Completado', ended: 'Finalizado antes de tiempo', running: 'En curso', paused: 'En pausa' })[session.status]}</span></td></tr>)}</tbody></table></div> : <div className="focus-empty"><Icon name="focus" size={28} /><h3>Tu primer bloque te espera</h3><p className="focus-muted">El tiempo que dediques aparecerá aquí, también si terminas antes.</p><button className="btn btn-primary" onClick={() => void focus?.act(state?.status === 'paused' ? 'resume' : 'start')}>{state?.status === 'paused' ? 'Reanudar bloque' : 'Iniciar mi primer bloque'}</button></div>}</section>
    {error && <p role="alert">No se ha podido cargar el progreso: {error}</p>}
    <p className="focus-footer">Solo tiempo de concentración. Las pausas y los descansos no se suman.</p>
  </div></div>;
}
