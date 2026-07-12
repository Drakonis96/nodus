import { useCallback, useEffect, useState } from 'react';
import type { HistoricalEvent, HistoricalEventType, Person, RecordEvidence } from '@shared/types';
import { Icon } from '../components/ui';
import { t } from '../i18n';
import { EVENT_TYPE_LABEL } from './PersonasView';

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
  const [personId, setPersonId] = useState('');
  const [type, setType] = useState<HistoricalEventType | ''>('');
  const [selected, setSelected] = useState<HistoricalEvent | null>(null);

  const reload = useCallback(async () => {
    const list = await window.nodus.listEvents({
      personId: personId || undefined,
      type: type || undefined,
    });
    setEvents(list);
  }, [personId, type]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    void window.nodus.listPersons().then(setPersons);
  }, []);

  return (
    <div className="h-full flex min-h-0 flex-col p-6">
      <div className="shrink-0">
        <div className="mb-4 flex items-center gap-3">
          <Icon name="clock" size={22} className="text-indigo-300" />
          <h1 className="text-xl font-semibold">{t('Línea temporal')}</h1>
          <span className="ml-auto text-xs text-neutral-500">{t('{n} eventos').replace('{n}', String(events.length))}</span>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          <select className="input h-9 text-sm" value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">{t('Todas las personas')}</option>
            {persons.map((p) => (
              <option key={p.personId} value={p.personId}>
                {p.displayName}
              </option>
            ))}
          </select>
          <select className="input h-9 text-sm" value={type} onChange={(e) => setType(e.target.value as HistoricalEventType | '')}>
            <option value="">{t('Todos los tipos')}</option>
            {EVENT_TYPES.map((tp) => (
              <option key={tp} value={tp}>
                {t(EVENT_TYPE_LABEL[tp])}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <p className="py-10 text-center text-sm text-neutral-500">
            {t('No hay eventos. Se crean al analizar fuentes primarias con la lente de registros.')}
          </p>
        ) : (
          <ol className="relative ml-3 border-l border-neutral-800">
            {events.map((e) => (
              <li key={e.eventId} className="mb-4 ml-6">
                <span className="absolute -left-[7px] mt-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-indigo-500 ring-4 ring-neutral-950" />
                <button
                  onClick={() => setSelected(e)}
                  className="w-full rounded-md border border-neutral-800 px-3 py-2 text-left transition hover:bg-neutral-800/50"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-[6rem] text-sm font-semibold text-indigo-200">
                      {e.date || t('sin fecha')}
                    </span>
                    <span className="text-sm text-neutral-200">{t(EVENT_TYPE_LABEL[e.type] ?? e.type)}</span>
                    {e.placeName ? <span className="text-xs text-neutral-500">· {e.placeName}</span> : null}
                  </div>
                  {e.participants.length > 0 && (
                    <p className="mt-1 truncate text-xs text-neutral-500">
                      {e.participants.map((p) => p.displayName ?? '—').join(', ')}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      {selected && <EventDetail event={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function EventDetail({ event, onClose }: { event: HistoricalEvent; onClose: () => void }) {
  const [evidence, setEvidence] = useState<RecordEvidence[]>([]);
  useEffect(() => {
    void window.nodus.listRecordEvidence('event', event.eventId).then(setEvidence);
  }, [event.eventId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="card w-full max-w-lg space-y-4 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">{t(EVENT_TYPE_LABEL[event.type] ?? event.type)}</h2>
            <p className="text-sm text-neutral-400">
              {event.date || t('sin fecha')}
              {event.placeName ? ` · ${event.placeName}` : ''}
            </p>
          </div>
          <button className="btn btn-ghost px-2 py-1" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Participantes')}</h3>
          {event.participants.length === 0 ? (
            <p className="text-sm text-neutral-500">{t('Sin participantes.')}</p>
          ) : (
            <ul className="space-y-1">
              {event.participants.map((p) => (
                <li key={`${p.personId}-${p.role}`} className="flex items-center gap-2 text-sm">
                  <Icon name="user" size={14} className="text-neutral-500" />
                  <span className="text-neutral-200">{p.displayName ?? '—'}</span>
                  <span className="text-xs text-neutral-500">· {t(ROLE_LABEL[p.role] ?? p.role)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Evidencia')}</h3>
          {evidence.length === 0 ? (
            <p className="text-sm text-neutral-500">{t('Sin evidencia adjunta.')}</p>
          ) : (
            <ul className="space-y-2">
              {evidence.map((ev) => (
                <li key={ev.id} className="rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2">
                  {ev.quote ? <p className="text-sm italic text-neutral-300">“{ev.quote}”</p> : null}
                  <p className="mt-1 text-xs text-neutral-500">
                    {ev.sourceKind === 'archive' ? t('Archivo') : t('Fuente')}
                    {ev.location ? ` · ${ev.location}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
