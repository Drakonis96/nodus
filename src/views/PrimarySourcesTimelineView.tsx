import { useEffect, useMemo, useState } from 'react';
import type {
  PrimarySourceTimelineEvent,
  PrimarySourceTimelineWorkspace,
} from '@shared/primarySourcesTypes';
import { Icon } from '../components/ui';
import { EvidenceTraceList } from '../components/primarySources/EvidenceTraceList';
import { t, tx } from '../i18n';
import { consumePrimarySourceAttention } from '../primarySourcesAttention';

type TimelineMode = 'timeline' | 'table' | 'periods' | 'undated';

function humanInterval(event: PrimarySourceTimelineEvent): string {
  if (!event.dateDisplay) return t('Sin fecha');
  if (event.dateEndSort && event.dateEndSort !== event.dateStartSort) {
    return `${event.dateDisplay} · ${event.dateStartSort ?? '…'} — ${event.dateEndSort}`;
  }
  return event.dateDisplay;
}

function certaintyLabel(value: string): string {
  const labels: Record<string, string> = {
    exact: 'Exacta',
    circa: 'Aproximada',
    before: 'Anterior a',
    after: 'Posterior a',
    between: 'Intervalo',
    unknown: 'Desconocida',
  };
  return t(labels[value] ?? value);
}

function reviewStatusLabel(value: PrimarySourceTimelineEvent['reviewStatus']): string {
  if (value === 'reviewed') return t('Revisado');
  if (value === 'in_review') return t('En revisión');
  if (value === 'rejected') return t('Rechazado');
  return t('Sin revisar');
}

function evidenceRoleLabel(value: string): string {
  if (value === 'contradicts') return t('Contradice');
  if (value === 'contextualizes') return t('Contextualiza');
  if (value === 'mentions') return t('Menciona');
  return t('Apoya');
}

function eventTypeLabel(value: string): string {
  const labels: Record<string, string> = {
    birth: 'Nacimiento',
    baptism: 'Bautismo',
    marriage: 'Matrimonio',
    death: 'Fallecimiento',
    burial: 'Entierro',
    census: 'Censo',
    residence: 'Residencia',
    migration: 'Migración',
    occupation: 'Ocupación',
    other: 'Otro',
  };
  return t(labels[value] ?? value);
}

function participantRoleLabel(value: string): string {
  const labels: Record<string, string> = {
    principal: 'Principal',
    spouse: 'Cónyuge',
    father: 'Padre',
    mother: 'Madre',
    child: 'Hijo o hija',
    witness: 'Testigo',
    officiant: 'Oficiante',
    other: 'Otro',
  };
  return t(labels[value] ?? value);
}

function periodLabel(event: PrimarySourceTimelineEvent): string {
  const year = event.dateStartSort ? Number(event.dateStartSort.slice(0, 4)) : NaN;
  if (!Number.isFinite(year)) return t('Sin fecha');
  const start = Math.floor(year / 10) * 10;
  return tx('Década de {year}', { year: start });
}

function EventCard({
  event,
  selected,
  onSelect,
}: {
  event: PrimarySourceTimelineEvent;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`primary-timeline-event-${event.eventId}`}
      className={[
        'w-full rounded-xl border p-4 text-left transition',
        selected
          ? 'border-indigo-300 bg-indigo-50 shadow-sm dark:border-indigo-700 dark:bg-indigo-950/40'
          : 'border-neutral-200 bg-white hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700',
        event.hypothesis ? 'border-dashed' : '',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{event.label}</span>
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              {eventTypeLabel(event.type)}
            </span>
          </div>
          <div className="mt-1 text-xs font-medium text-indigo-700 dark:text-indigo-300">
            {humanInterval(event)}
          </div>
        </div>
        {event.hypothesis ? (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[9px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            {t('Hipótesis sin evidencia')}
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-[9px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            {tx('{n} evidencias', { n: event.evidence.length })}
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-neutral-500 dark:text-neutral-400">
        <span>{certaintyLabel(event.dateCertainty)}</span>
        {event.placeName && <span>⌖ {event.placeName}</span>}
        {event.participants.length > 0 && (
          <span>{event.participants.map((person) => person.displayName).join(', ')}</span>
        )}
        {event.hasContradiction && (
          <span className="font-semibold text-rose-600 dark:text-rose-300">
            {t('Discrepancia conservada')}
          </span>
        )}
      </div>
    </button>
  );
}

export function PrimarySourcesTimelineView() {
  const [attention, setAttention] = useState(() => consumePrimarySourceAttention(['event_evidence']));
  const [workspace, setWorkspace] = useState<PrimarySourceTimelineWorkspace | null>(null);
  const [mode, setMode] = useState<TimelineMode>('timeline');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [repository, setRepository] = useState('');
  const [type, setType] = useState('');
  const [personId, setPersonId] = useState('');
  const [placeId, setPlaceId] = useState('');
  const [certainty, setCertainty] = useState('');
  const [reviewStatus, setReviewStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showHypotheses, setShowHypotheses] = useState(Boolean(attention));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.nodus.getPrimarySourceTimelineWorkspace()
      .then((data) => {
        if (cancelled) return;
        setWorkspace(data);
        setSelectedId(data.events.find((event) => !event.hypothesis)?.eventId ?? null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (workspace?.events ?? []).filter((event) => {
      if (attention?.targetIds.length && !attention.targetIds.includes(event.eventId)) return false;
      if (!showHypotheses && event.hypothesis) return false;
      if (mode === 'undated' && event.dateStartSort) return false;
      if (sourceId && !event.sourceIds.includes(sourceId)) return false;
      if (repository && !event.repositoryNames.includes(repository)) return false;
      if (type && event.type !== type) return false;
      if (personId && !event.participants.some((person) => person.personId === personId)) return false;
      if (placeId && event.placeId !== placeId) return false;
      if (certainty && event.dateCertainty !== certainty) return false;
      if (reviewStatus && event.reviewStatus !== reviewStatus) return false;
      if (from && event.dateEndSort && event.dateEndSort < from) return false;
      if (to && event.dateStartSort && event.dateStartSort > to) return false;
      if (!query) return true;
      return [
        event.label,
        event.type,
        event.dateDisplay,
        event.placeName,
        ...event.participants.map((person) => person.displayName),
        ...event.evidence.map((trace) => `${trace.sourceTitle} ${trace.quote}`),
      ].filter(Boolean).some((value) => String(value).toLocaleLowerCase().includes(query));
    });
  }, [
    workspace, showHypotheses, mode, sourceId, repository, type, personId, placeId,
    certainty, reviewStatus, from, to, search, attention,
  ]);

  const selected = (workspace?.events ?? []).find((event) => event.eventId === selectedId) ?? null;
  const periods = useMemo(() => {
    const groups = new Map<string, PrimarySourceTimelineEvent[]>();
    for (const event of filtered) {
      const label = periodLabel(event);
      (groups.get(label) ?? groups.set(label, []).get(label)!).push(event);
    }
    return [...groups.entries()];
  }, [filtered]);

  const modes: Array<{ id: TimelineMode; label: string; icon: string }> = [
    { id: 'timeline', label: 'Cronología', icon: 'clock' },
    { id: 'table', label: 'Tabla', icon: 'table' },
    { id: 'periods', label: 'Periodos', icon: 'calendar' },
    { id: 'undated', label: 'Sin fecha', icon: 'help-circle' },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="shrink-0 border-b border-neutral-200 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        {attention && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-[10px] text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200">
            <Icon name="filter" size={11} />{t(attention.label)}
            <button className="ml-auto font-medium hover:underline" onClick={() => { setAttention(null); setShowHypotheses(false); }}>{t('Mostrar todo')}</button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-lg font-semibold">{t('Cronología documental')}</h1>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {t('Fechas humanas, intervalos y contradicciones con acceso al fragmento exacto.')}
            </p>
          </div>
          <div
            className="ml-auto flex rounded-lg border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-700 dark:bg-neutral-900"
            role="group"
            aria-label={t('Modo de vista')}
          >
            {modes.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setMode(entry.id)}
                aria-pressed={mode === entry.id}
                className={[
                  'flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium',
                  mode === entry.id
                    ? 'bg-white text-indigo-700 shadow-sm dark:bg-neutral-800 dark:text-indigo-300'
                    : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200',
                ].join(' ')}
              >
                <Icon name={entry.icon as never} size={12} /> {t(entry.label)}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-5 xl:grid-cols-11">
          <input className="input h-8 text-xs lg:col-span-2" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Buscar eventos y evidencia…')} />
          <select className="input h-8 text-xs" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
            <option value="">{t('Todas las fuentes')}</option>
            {workspace?.sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
          </select>
          <select className="input h-8 text-xs" value={repository} onChange={(event) => setRepository(event.target.value)}>
            <option value="">{t('Todos los repositorios')}</option>
            {workspace?.repositories.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
          <select className="input h-8 text-xs" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">{t('Todos los tipos')}</option>
            {workspace?.eventTypes.map((entry) => <option key={entry} value={entry}>{eventTypeLabel(entry)}</option>)}
          </select>
          <select className="input h-8 text-xs" value={personId} onChange={(event) => setPersonId(event.target.value)}>
            <option value="">{t('Todas las personas')}</option>
            {workspace?.persons.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}
          </select>
          <select className="input h-8 text-xs" value={placeId} onChange={(event) => setPlaceId(event.target.value)}>
            <option value="">{t('Todos los lugares')}</option>
            {workspace?.places.map((place) => <option key={place.id} value={place.id}>{place.label}</option>)}
          </select>
          <select className="input h-8 text-xs" value={certainty} onChange={(event) => setCertainty(event.target.value)}>
            <option value="">{t('Toda certeza')}</option>
            {['exact', 'circa', 'before', 'after', 'between', 'unknown'].map((entry) => <option key={entry} value={entry}>{certaintyLabel(entry)}</option>)}
          </select>
          <select className="input h-8 text-xs" value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value)}>
            <option value="">{t('Toda revisión')}</option>
            <option value="reviewed">{t('Revisado')}</option>
            <option value="in_review">{t('En revisión')}</option>
            <option value="unreviewed">{t('Sin revisar')}</option>
          </select>
          <input className="input h-8 text-xs" type="date" aria-label={t('Desde')} value={from} onChange={(event) => setFrom(event.target.value)} />
          <input className="input h-8 text-xs" type="date" aria-label={t('Hasta')} value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
        <label className="mt-3 inline-flex items-center gap-2 text-[11px] text-neutral-600 dark:text-neutral-300">
          <input type="checkbox" checked={showHypotheses} onChange={(event) => setShowHypotheses(event.target.checked)} />
          {t('Mostrar hipótesis sin evidencia')}
        </label>
      </header>

      {error && <div role="alert" className="m-4 rounded-lg bg-rose-100 p-3 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-200">{error}</div>}

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px]">
        <main className="min-h-0 overflow-auto p-5">
          {!workspace && !error && <div role="status" aria-live="polite" className="text-sm text-neutral-500">{t('Cargando cronología…')}</div>}
          {workspace && filtered.length === 0 && (
            <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
              {t('No hay eventos que cumplan los filtros.')}
            </div>
          )}
          {(mode === 'timeline' || mode === 'undated') && (
            <div className="relative space-y-3 before:absolute before:bottom-3 before:left-[7px] before:top-3 before:w-px before:bg-indigo-200 dark:before:bg-indigo-900">
              {filtered.map((event) => (
                <div key={event.eventId} className="relative pl-6">
                  <span className="absolute left-0 top-5 h-3.5 w-3.5 rounded-full border-2 border-white bg-indigo-500 shadow dark:border-neutral-950" />
                  <EventCard event={event} selected={selectedId === event.eventId} onSelect={() => setSelectedId(event.eventId)} />
                </div>
              ))}
            </div>
          )}
          {mode === 'periods' && (
            <div className="grid gap-4 md:grid-cols-2">
              {periods.map(([label, events]) => (
                <section key={label} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">{label}</h2>
                  <div className="space-y-2">
                    {events.map((event) => <EventCard key={event.eventId} event={event} selected={selectedId === event.eventId} onSelect={() => setSelectedId(event.eventId)} />)}
                  </div>
                </section>
              ))}
            </div>
          )}
          {mode === 'table' && (
            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              <table className="w-full text-left text-xs">
                <thead className="bg-neutral-100 text-[10px] uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                  <tr>
                    <th scope="col" className="px-3 py-2">{t('Evento')}</th>
                    <th scope="col" className="px-3 py-2">{t('Fecha e intervalo')}</th>
                    <th scope="col" className="px-3 py-2">{t('Lugar')}</th>
                    <th scope="col" className="px-3 py-2">{t('Participantes')}</th>
                    <th scope="col" className="px-3 py-2">{t('Evidencia')}</th>
                    <th scope="col" className="px-3 py-2">{t('Estado')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((event) => (
                    <tr
                      key={event.eventId}
                      tabIndex={0}
                      onClick={() => setSelectedId(event.eventId)}
                      onKeyDown={(keyEvent) => {
                        if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                          keyEvent.preventDefault();
                          setSelectedId(event.eventId);
                        }
                      }}
                      className="cursor-pointer border-t border-neutral-100 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-neutral-800 dark:hover:bg-indigo-950/30"
                    >
                      <td className="px-3 py-2 font-medium">{event.label}</td>
                      <td className="px-3 py-2">{humanInterval(event)}</td>
                      <td className="px-3 py-2">{event.placeName ?? '—'}</td>
                      <td className="px-3 py-2">{event.participants.map((person) => person.displayName).join(', ') || '—'}</td>
                      <td className="px-3 py-2">{event.evidence.length}</td>
                      <td className="px-3 py-2">{event.hypothesis ? t('Hipótesis') : event.hasContradiction ? t('Contradicción') : t('Confirmado')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>

        <aside className="min-h-0 overflow-auto border-l border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
          {selected ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">{t('Dossier del evento')}</div>
                  <h2 className="mt-1 text-lg font-semibold">{selected.label}</h2>
                  <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{humanInterval(selected)}</p>
                </div>
                {selected.hasContradiction && <Icon name="alert-triangle" className="text-rose-500" size={18} />}
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-3 text-xs">
                <div><dt className="text-neutral-500">{t('Certeza')}</dt><dd className="mt-1 font-medium">{certaintyLabel(selected.dateCertainty)}</dd></div>
                <div><dt className="text-neutral-500">{t('Revisión')}</dt><dd className="mt-1 font-medium">{reviewStatusLabel(selected.reviewStatus)}</dd></div>
                <div><dt className="text-neutral-500">{t('Lugar')}</dt><dd className="mt-1 font-medium">{selected.placeName ?? '—'}</dd></div>
                <div><dt className="text-neutral-500">{t('Tipo')}</dt><dd className="mt-1 font-medium">{eventTypeLabel(selected.type)}</dd></div>
              </dl>
              {selected.participants.length > 0 && (
                <section className="mt-5">
                  <h3 className="text-xs font-semibold">{t('Participantes y roles')}</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selected.participants.map((person) => (
                      <span key={`${person.personId}:${person.role}`} className="rounded-lg bg-neutral-100 px-2 py-1 text-[11px] dark:bg-neutral-800">
                        {person.displayName} · {participantRoleLabel(person.role)}
                      </span>
                    ))}
                  </div>
                </section>
              )}
              {selected.dateAlternatives.length > 0 && (
                <section className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-950/30">
                  <h3 className="text-xs font-semibold text-rose-700 dark:text-rose-200">{t('Propuestas de fecha conservadas')}</h3>
                  <ul className="mt-2 space-y-1 text-[11px] text-rose-700 dark:text-rose-300">
                    {selected.dateAlternatives.map((entry, index) => <li key={`${entry.evidenceId}:${index}`}>{entry.dateDisplay} · {evidenceRoleLabel(entry.role)}</li>)}
                  </ul>
                </section>
              )}
              {selected.notes && <p className="mt-5 whitespace-pre-wrap text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">{selected.notes}</p>}
              <section className="mt-6">
                <h3 className="mb-2 text-xs font-semibold">{t('Evidencia ordenada')}</h3>
                <EvidenceTraceList evidence={selected.evidence} />
              </section>
            </>
          ) : (
            <div className="py-12 text-center text-sm text-neutral-500">{t('Selecciona un evento para abrir su dossier.')}</div>
          )}
        </aside>
      </div>
    </div>
  );
}
