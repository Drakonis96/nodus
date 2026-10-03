import { useEffect, useState, type KeyboardEvent } from 'react';
import { useStudyFocus } from '../components/focus/StudyFocusContext';
import { FocusControls } from '../components/focus/FocusControls';
import type { FocusDay, FocusSession, FocusStats } from '@shared/studyFocus';
import { Icon } from '../components/ui';
import { errorText, getActiveLang, t, tx } from '../i18n';
import '../components/focus/focus.css';

const minutes = (ms: number) => Math.floor(ms / 60000);
const minuteDetail = (ms: number) => (ms / 60000).toLocaleString(getActiveLang(), { maximumFractionDigits: 1 });
const dateLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(getActiveLang(), { day: 'numeric', month: 'short' });
const blocksLabel = (count: number) => count === 1 ? tx('{n} bloque', { n: count }) : tx('{n} bloques', { n: count });
const dayDetail = (day: FocusDay) => tx('{date}: {minutes} minutos, {blocks}', { date: dateLabel(day.day), minutes: minuteDetail(day.milliseconds), blocks: blocksLabel(day.blocks) });
const sessionStatus = (status: FocusSession['status']) => status === 'completed' ? t('Completado') : status === 'ended' ? t('Finalizado antes de tiempo') : status === 'running' ? t('En curso') : t('En pausa');
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
  const [error, setError] = useState<unknown>(null);
  const state = focus?.snapshot?.state;
  // Refresh from committed main-process time, including the current partial block.
  useEffect(() => {
    let alive = true;
    const load = () => { void window.nodus.getStudyFocusStats().then(next => { if (alive) { setStats(next); setError(null); } }).catch(reason => { if (alive) setError(reason); }); };
    load(); const timer = setInterval(load, 15000);
    return () => { alive = false; clearInterval(timer); };
  }, [focus?.snapshot?.vaultId, state?.revision]);
  const today = stats?.days.at(-1);
  const total = today?.milliseconds ?? 0;
  const goal = state?.preferences.dailyGoalMinutes ?? null;
  const days = stats?.days.slice(-range) ?? [];
  const vaults = (stats?.vaults ?? []).map(vault => ({ ...vault,
    milliseconds: vault.days.slice(-range).reduce((sum, day) => sum + day.milliseconds, 0),
    blocks: vault.days.slice(-range).reduce((sum, day) => sum + day.blocks, 0),
  })).filter(vault => vault.milliseconds > 0 || vault.blocks > 0).sort((a, b) => b.milliseconds - a.milliseconds);
  const peak = Math.max(1, ...days.map(day => day.milliseconds / 60000));
  const activeDays = stats?.days.filter(day => day.milliseconds > 0).length ?? 0;
  const motivation = goal && total >= goal * 60000 ? t('Has alcanzado tu objetivo. El resto del día es tuyo.') : total > 0 ? tx('Has dedicado {minutes} minutos hoy. Un espacio para lo que importa.', { minutes: minuteDetail(total) }) : t('Elige una tarea. El primer bloque empieza cuando tú quieras.');
  return <div className="focus-page h-full overflow-y-auto" data-testid="study-focus-view"><div className="focus-page-inner">
    <div className="focus-page-heading"><div><div className="focus-eyebrow"><Icon name="focus" size={14} /> {t('A tu ritmo')}</div><h1>Nodus Focus</h1><p className="focus-muted">{t('Un momento para tu trabajo. Una perspectiva de tu constancia.')}</p></div><span className="focus-private">{t('Todas las bóvedas')}</span></div>
    <div className="focus-main-grid"><section className="focus-card focus-timer-card" aria-label={t('Temporizador')}><FocusControls /></section>
      <div className="focus-overview"><section className="focus-card focus-today"><div className="focus-section-heading"><h2>{t('Hoy')}</h2><span className="focus-muted">{today ? dateLabel(today.day) : ''}</span></div><div className="focus-today-metrics"><div><strong>{minutes(total)}<small>{t('min')}</small></strong><span className="focus-muted">{t('de concentración')}</span></div><div><strong>{today?.blocks ?? 0}</strong><span className="focus-muted">{t('bloques completados')}</span></div></div>
        {goal ? <><div className="focus-goal-line"><span>{tx('Meta diaria · {n} min', { n: goal })}</span><span>{Math.min(100, Math.floor(total / (goal * 60000) * 100))}%</span></div><progress className="focus-goal-progress" aria-label={t('Progreso hacia la meta diaria')} value={Math.min(total, goal * 60000)} max={goal * 60000} /><div className="focus-goal-edit"><label>{t('Meta (min)')}<input aria-label={t('Meta diaria en minutos')} key={goal} type="number" className="input" min={1} max={1440} defaultValue={goal} onBlur={event => { if (event.target.validity.valid && event.target.value) void focus?.configure({ dailyGoalMinutes: Number(event.target.value) }); else event.target.value = String(goal); }} /></label><button className="btn btn-ghost" onClick={() => void focus?.configure({ dailyGoalMinutes: null })}>{t('Quitar meta')}</button></div></> : <button className="focus-goal-enable" onClick={() => void focus?.configure({ dailyGoalMinutes: 60 })}><Icon name="plus" size={14} />{t('Activar meta diaria · 60 min sugeridos')}</button>}
      </section><section className="focus-motivation"><Icon name="sparkles" size={20} /><p>{motivation}</p></section>
      <section className="focus-card focus-chart-card"><div className="focus-section-heading"><div><h2>{t('Evolución')}</h2><p className="focus-muted">{tx('Minutos por día · escala de 0 a {n} min', { n: Math.ceil(peak) })}</p></div><div className="focus-range" role="group" aria-label={t('Periodo')}>{([7, 30] as const).map(value => <button key={value} aria-pressed={range === value} onClick={() => { setRange(value); setSelected(null); }}>{tx('{n} días', { n: value })}</button>)}</div></div>
        <div className="focus-chart" onKeyDown={event => moveDay(event)} role="group" aria-label={t('Gráfico de minutos por día')}>{days.map(day => <button key={day.day} className="focus-bar-column" aria-label={dayDetail(day)} title={dayDetail(day)} onFocus={() => setSelected(day)} onClick={() => setSelected(day)}><span className="focus-bar-well"><span className="focus-bar" style={{ height: `${Math.max(2, day.milliseconds / 60000 / peak * 100)}%` }} /></span><span className="focus-bar-label">{range === 7 ? new Date(`${day.day}T12:00:00`).toLocaleDateString(getActiveLang(), { weekday: 'short' }) : day.day.slice(-2)}</span></button>)}</div>
        <p className="focus-chart-detail" role="status">{selected ? dayDetail(selected) : t('Selecciona un día para ver minutos y bloques.')}</p>
        <details className="focus-text-data"><summary>{t('Ver datos en tabla')}</summary><table><caption className="sr-only">{t('Minutos y bloques por día')}</caption><thead><tr><th scope="col">{t('Día')}</th><th scope="col">{t('Minutos')}</th><th scope="col">{t('Bloques')}</th></tr></thead><tbody>{days.map(day => <tr key={day.day}><th scope="row">{dateLabel(day.day)}</th><td>{minuteDetail(day.milliseconds)}</td><td>{day.blocks}</td></tr>)}</tbody></table></details>
      </section></div></div>
    <section className="focus-card" data-testid="focus-vault-breakdown">
      <div className="focus-section-heading"><h2>{t('Tiempo por bóveda')}</h2><span className="focus-muted">{tx('{n} días', { n: range })}</span></div>
      {vaults.length ? <div className="focus-session-table"><table><thead><tr><th scope="col">{t('Bóveda')}</th><th scope="col">{t('Minutos')}</th><th scope="col">{t('bloques completados')}</th></tr></thead><tbody>{vaults.map(vault => <tr key={vault.vaultId}><th scope="row">{vault.vaultName}</th><td>{minuteDetail(vault.milliseconds)}</td><td>{vault.blocks}</td></tr>)}</tbody></table></div> : <p className="focus-muted">{t('El tiempo que dediques aparecerá aquí, también si terminas antes.')}</p>}
    </section>
    <section className="focus-card focus-consistency"><div className="focus-section-heading"><div><h2>{t('Constancia')}</h2><p className="focus-muted">{t('Últimas 12 semanas')} · {activeDays === 1 ? tx('{n} día con actividad', { n: activeDays }) : tx('{n} días con actividad', { n: activeDays })}</p></div><span className="focus-muted">{t('Cada día es una nueva oportunidad')}</span></div><div className="focus-heatmap" onKeyDown={event => moveDay(event, 7)} role="group" aria-label={t('Calendario de actividad de las últimas 12 semanas')}>{stats?.days.map(day => <button key={day.day} className="focus-heat-day" data-level={day.milliseconds === 0 ? 0 : day.milliseconds < 25 * 60000 ? 1 : day.milliseconds < 60 * 60000 ? 2 : 3} aria-label={dayDetail(day)} title={dayDetail(day)} onFocus={() => setSelected(day)} onClick={() => setSelected(day)} />)}</div><div className="focus-heat-legend"><span>{stats?.days[0] ? dateLabel(stats.days[0].day) : ''}</span><span>{t('Menos')} <i data-level="0" /><i data-level="1" /><i data-level="2" /><i data-level="3" /> {t('Más')}</span><span>{t('Hoy')}</span></div><p className="focus-muted" role="status">{selected ? dayDetail(selected) : t('Puedes recorrer los días con el teclado para consultar su detalle.')}</p><details className="focus-text-data"><summary>{t('Ver actividad de las 12 semanas')}</summary><ul className="focus-activity-list">{stats?.days.map(day => <li key={day.day}>{dayDetail(day)}</li>)}</ul></details></section>
    <section className="focus-card"><div className="focus-section-heading"><h2>{t('Sesiones recientes')}</h2><span className="focus-muted">{t('Tiempo efectivo de trabajo')}</span></div>{stats?.recent.length ? <div className="focus-session-table"><table><thead><tr><th scope="col">{t('Inicio')}</th><th scope="col">{t('Asignatura')}</th><th scope="col">{t('Bóveda')}</th><th scope="col">{t('Duración')}</th><th scope="col">{t('Estado')}</th></tr></thead><tbody>{stats.recent.map(session => <tr key={session.id}><td>{new Date(session.startedAt).toLocaleString(getActiveLang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td><td>{session.subjectName ?? t('Sin asignatura')}{session.task && <span className="focus-session-task">{session.task}</span>}</td><td>{session.vaults.map(vault => <span key={vault.vaultId} className="focus-session-task">{vault.vaultName} · {tx('{n} min', { n: minuteDetail(vault.milliseconds) })}</span>)}</td><td>{tx('{n} min', { n: minuteDetail(session.milliseconds) })}</td><td><span className={`focus-session-status ${session.status === 'completed' ? 'completed' : ''}`}>{sessionStatus(session.status)}</span></td></tr>)}</tbody></table></div> : <div className="focus-empty"><Icon name="focus" size={28} /><h3>{t('Tu primer bloque te espera')}</h3><p className="focus-muted">{t('El tiempo que dediques aparecerá aquí, también si terminas antes.')}</p><button className="btn btn-primary" onClick={() => void focus?.act(state?.status === 'paused' ? 'resume' : 'start')}>{state?.status === 'paused' ? t('Reanudar bloque') : t('Iniciar mi primer bloque')}</button></div>}</section>
    {error != null && <p role="alert">{tx('No se ha podido cargar el progreso: {error}', { error: errorText(error) })}</p>}
    <p className="focus-footer">{t('Solo tiempo de concentración. Las pausas y los descansos no se suman.')}</p>
  </div></div>;
}
