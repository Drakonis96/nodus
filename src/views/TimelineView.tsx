import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HistoricalEvent, HistoricalEventType, Person, RecordEvidence } from '@shared/types';
import { Icon } from '../components/ui';
import { PersonDossierModal } from '../components/PersonDossierModal';
import { PersonPortrait } from '../components/PersonPortrait';
import { SearchableMultiSelect } from '../components/PersonMultiSelect';
import { t } from '../i18n';
import { EVENT_TYPE_LABEL } from '../components/personLabels';

const EVENT_TYPES: HistoricalEventType[] = [
  'birth',
  'baptism',
  'marriage',
  'death',
  'burial',
  'census',
  'residence',
  'migration',
  'occupation',
  'other',
];

const ROLE_LABEL: Record<string, string> = {
  principal: 'principal',
  spouse: 'cónyuge',
  father: 'padre',
  mother: 'madre',
  child: 'hijo/a',
  witness: 'testigo',
  officiant: 'oficiante',
  other: 'otro',
};

export function TimelineView() {
  const [events, setEvents] = useState<HistoricalEvent[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [selectedPersonIds, setSelectedPersonIds] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<HistoricalEventType[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<HistoricalEvent | null>(null);
  const [dossierId, setDossierId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [eventList, personList] = await Promise.all([window.nodus.listEvents({}), window.nodus.listPersons()]);
    setEvents(eventList);
    setPersons(personList);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const personById = useMemo(() => new Map(persons.map((person) => [person.personId, person])), [persons]);
  const filteredEvents = useMemo(() => events.filter((event) => {
    const matchesPerson = selectedPersonIds.length === 0 || event.participants.some((participant) => selectedPersonIds.includes(participant.personId));
    const matchesType = selectedTypes.length === 0 || selectedTypes.includes(event.type);
    return matchesPerson && matchesType;
  }), [events, selectedPersonIds, selectedTypes]);

  return (
    <div className="flex h-full min-h-0 flex-col p-6">
      <div className="shrink-0">
        <div className="mb-4 flex items-center gap-3">
          <Icon name="clock" size={22} className="text-amber-400" />
          <h1 className="text-xl font-semibold">{t('Línea temporal')}</h1>
          <span className="ml-auto text-xs text-neutral-500">{t('{n} eventos').replace('{n}', String(filteredEvents.length))}</span>
        </div>
        <div className="mb-5 grid max-w-3xl gap-2 sm:grid-cols-2">
          <SearchableMultiSelect
            options={persons.map((person) => ({ id: person.personId, label: person.displayName }))}
            selectedIds={selectedPersonIds}
            onChange={setSelectedPersonIds}
            placeholder={t('Todas las personas')}
            searchPlaceholder={t('Buscar persona…')}
            testId="timeline-person-filter"
          />
          <SearchableMultiSelect
            options={EVENT_TYPES.map((type) => ({ id: type, label: t(EVENT_TYPE_LABEL[type]) }))}
            selectedIds={selectedTypes}
            onChange={(ids) => setSelectedTypes(ids as HistoricalEventType[])}
            placeholder={t('Todos los tipos')}
            searchPlaceholder={t('Buscar tipo de evento…')}
            testId="timeline-type-filter"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {filteredEvents.length === 0 ? (
          <p className="py-10 text-center text-sm text-neutral-500">
            {t('No hay eventos. Se crean al analizar fuentes primarias con la lente de registros.')}
          </p>
        ) : (
          <ol className="relative ml-3 space-y-4 border-l border-amber-700/40 pb-2">
            {filteredEvents.map((event) => (
              <TimelineEventCard
                key={event.eventId}
                event={event}
                personById={personById}
                onOpenEvent={() => setSelectedEvent(event)}
                onOpenPerson={setDossierId}
              />
            ))}
          </ol>
        )}
      </div>

      {selectedEvent && (
        <EventDetail
          event={selectedEvent}
          personById={personById}
          onClose={() => setSelectedEvent(null)}
          onOpenPerson={setDossierId}
        />
      )}
      {dossierId && <PersonDossierModal personId={dossierId} onClose={() => setDossierId(null)} onChanged={reload} />}
    </div>
  );
}

function TimelineEventCard({
  event,
  personById,
  onOpenEvent,
  onOpenPerson,
}: {
  event: HistoricalEvent;
  personById: Map<string, Person>;
  onOpenEvent: () => void;
  onOpenPerson: (personId: string) => void;
}) {
  return (
    <li className="relative ml-6" data-testid="timeline-event-card">
      <span className="absolute -left-[31px] top-6 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 ring-4 ring-neutral-950" />
      <article className="overflow-hidden rounded-xl border border-neutral-800 bg-gradient-to-br from-neutral-900/80 to-neutral-950 shadow-sm transition hover:border-amber-800/60 hover:shadow-amber-950/20">
        <button className="group flex w-full items-start gap-4 p-4 text-left" onClick={onOpenEvent} aria-label={t('Ver detalles del evento')}>
          <time className="min-w-[6.5rem] rounded-lg border border-amber-800/40 bg-amber-950/20 px-2.5 py-2 text-center text-xs font-semibold text-amber-300">
            {event.date || t('sin fecha')}
          </time>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-neutral-100">{t(EVENT_TYPE_LABEL[event.type] ?? event.type)}</span>
            {event.label && <span className="mt-0.5 block text-sm text-neutral-300">{event.label}</span>}
            {event.placeName && <span className="mt-1 flex items-center gap-1 text-xs text-neutral-500"><Icon name="map" size={12} /> {event.placeName}</span>}
            {event.notes && <span className="mt-2 line-clamp-2 block text-xs leading-5 text-neutral-500">{event.notes}</span>}
          </span>
          <Icon name="chevronRight" size={15} className="mt-2 shrink-0 text-neutral-600 transition group-hover:translate-x-0.5 group-hover:text-amber-400" />
        </button>

        {event.participants.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-neutral-800/80 px-4 py-3">
            {event.participants.map((participant) => {
              const person = personById.get(participant.personId);
              return (
                <button
                  key={`${participant.personId}-${participant.role}`}
                  className="flex max-w-full items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900 px-2 py-1 text-left transition hover:border-amber-700 hover:bg-amber-950/20"
                  onClick={() => onOpenPerson(participant.personId)}
                  data-timeline-person-id={participant.personId}
                  aria-label={t('Abrir ficha de {name}').replace('{name}', participant.displayName ?? person?.displayName ?? '—')}
                >
                  {person ? <PersonPortrait person={person} size={24} rounded="full" /> : <Icon name="user" size={14} className="text-neutral-500" />}
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-neutral-200">{participant.displayName ?? person?.displayName ?? '—'}</span>
                    <span className="block text-[10px] text-neutral-500">{t(ROLE_LABEL[participant.role] ?? participant.role)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </article>
    </li>
  );
}

function EventDetail({
  event,
  personById,
  onClose,
  onOpenPerson,
}: {
  event: HistoricalEvent;
  personById: Map<string, Person>;
  onClose: () => void;
  onOpenPerson: (personId: string) => void;
}) {
  const [evidence, setEvidence] = useState<RecordEvidence[]>([]);
  useEffect(() => {
    void window.nodus.listRecordEvidence('event', event.eventId).then(setEvidence);
  }, [event.eventId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onMouseDown={(mouseEvent) => { if (mouseEvent.target === mouseEvent.currentTarget) onClose(); }}>
      <div className="card-modal flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden" role="dialog" aria-modal="true" onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()}>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{t(EVENT_TYPE_LABEL[event.type] ?? event.type)}</h2>
              <p className="text-sm text-neutral-400">
                {event.date || t('sin fecha')}{event.placeName ? ` · ${event.placeName}` : ''}
              </p>
            </div>
            <button className="btn btn-ghost h-8 w-8 shrink-0 p-0" onClick={onClose} aria-label={t('Cerrar')} title={t('Cerrar')}>
              <Icon name="x" />
            </button>
          </div>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Participantes')}</h3>
            {event.participants.length === 0 ? (
              <p className="text-sm text-neutral-500">{t('Sin participantes.')}</p>
            ) : (
              <ul className="space-y-2">
                {event.participants.map((participant) => {
                  const person = personById.get(participant.personId);
                  return (
                    <li key={`${participant.personId}-${participant.role}`}>
                      <button
                        className="flex w-full items-center gap-3 rounded-lg border border-neutral-800 px-3 py-2 text-left transition hover:border-amber-700 hover:bg-amber-950/20"
                        onClick={() => onOpenPerson(participant.personId)}
                      >
                        {person ? <PersonPortrait person={person} size={34} rounded="full" /> : <Icon name="user" size={18} className="text-neutral-500" />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-neutral-200">{participant.displayName ?? person?.displayName ?? '—'}</span>
                          <span className="block text-xs text-neutral-500">{t(ROLE_LABEL[participant.role] ?? participant.role)}</span>
                        </span>
                        <Icon name="chevronRight" size={13} className="text-neutral-600" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Evidencia')}</h3>
            {evidence.length === 0 ? (
              <p className="text-sm text-neutral-500">{t('Sin evidencia adjunta.')}</p>
            ) : (
              <ul className="space-y-2">
                {evidence.map((item) => (
                  <li key={item.id} className="rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2">
                    {item.quote ? <p className="text-sm italic text-neutral-300">“{item.quote}”</p> : null}
                    <p className="mt-1 text-xs text-neutral-500">
                      {item.sourceKind === 'archive' ? t('Archivo') : t('Fuente')}{item.location ? ` · ${item.location}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
