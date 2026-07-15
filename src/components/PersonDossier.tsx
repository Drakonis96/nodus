import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ArchiveItem,
  DocumentLinkSuggestion,
  HistoricalEvent,
  HistoricalEventType,
  Kin,
  KinSuggestion,
  MatchCandidatePair,
  Person,
  PersonSex,
  PortraitFocus,
  RecordEvidence,
} from '@shared/types';
import { detectPersonConflicts } from '@shared/conflictDetection';
import { Icon } from './ui';
import { PersonPortrait } from './PersonPortrait';
import { docTypeLabel } from './DocTypeForm';
import { EVENT_TYPE_LABEL, FACT_LABEL } from './personLabels';
import { MarkdownNotesEditor } from './MarkdownNotesEditor';
import { RelationsSection } from './RelationsSection';
import { PersonPlacesSection } from './PersonPlacesSection';
import { KinshipEditor } from './KinshipEditor';
import { confirm } from './feedback';
import { useDismissableLayer } from '../hooks';
import { t, tx } from '../i18n';

const STRENGTH_STYLE: Record<string, string> = {
  alta: 'bg-emerald-900/40 text-emerald-300',
  media: 'bg-amber-900/40 text-amber-300',
  baja: 'bg-neutral-800 text-neutral-400',
};

function lifeSpan(p: Person): string {
  const b = p.birthDate?.trim();
  const d = p.deathDate?.trim();
  if (b && d) return `${b} – ${d}`;
  if (b) return `n. ${b}`;
  if (d) return `†︎ ${d}`;
  return '';
}

const SEX_LABEL: Record<string, string> = { male: 'Hombre', female: 'Mujer', unknown: 'Sin determinar' };

const EVENT_TYPE_OPTIONS: HistoricalEventType[] = [
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

/**
 * The full, ordered picture of a person: an on-demand AI biography, AI identity
 * suggestions, kinship, life events, linked documents, cited evidence and any
 * conflicting facts. Used both in the Personas view and from a tree node.
 */
export function PersonDossier({
  person,
  onChanged,
  onClose,
  onNavigate,
  extraActions,
}: {
  person: Person;
  onChanged: () => Promise<void>;
  onClose?: () => void;
  onNavigate?: (personId: string) => void;
  extraActions?: React.ReactNode;
}) {
  const [events, setEvents] = useState<HistoricalEvent[]>([]);
  const [evidence, setEvidence] = useState<RecordEvidence[]>([]);
  const [kin, setKin] = useState<Kin | null>(null);
  const [persons, setPersons] = useState<Person[]>([]);
  const [documents, setDocuments] = useState<ArchiveItem[]>([]);
  const [suggestions, setSuggestions] = useState<MatchCandidatePair[]>([]);
  const [kinSuggestions, setKinSuggestions] = useState<KinSuggestion[]>([]);
  const [docSuggestions, setDocSuggestions] = useState<DocumentLinkSuggestion[]>([]);
  const [hiddenDocs, setHiddenDocs] = useState<Set<string>>(new Set());
  const [bioBusy, setBioBusy] = useState(false);
  const [bioMsg, setBioMsg] = useState<string | null>(null);
  const [editingBasics, setEditingBasics] = useState(false);

  const load = useCallback(async () => {
    void window.nodus.listEvents({ personId: person.personId }).then(setEvents);
    void window.nodus.listRecordEvidence('person', person.personId).then(setEvidence);
    void window.nodus.kinOf(person.personId).then(setKin);
    void window.nodus.listPersons().then(setPersons);
    void window.nodus.listArchiveItemsForPerson(person.personId).then(setDocuments);
    void window.nodus.findMatches().then((all) =>
      setSuggestions(all.filter((m) => m.aId === person.personId || m.bId === person.personId))
    );
    void window.nodus.kinSuggestionsForPerson(person.personId).then(setKinSuggestions);
    void window.nodus.suggestDocumentsForPerson(person.personId).then(setDocSuggestions);
  }, [person.personId]);

  useEffect(() => {
    void load();
  }, [load]);

  const conflicts = useMemo(
    () =>
      detectPersonConflicts({
        birthDate: person.birthDate,
        deathDate: person.deathDate,
        events: events.map((e) => ({ type: e.type, date: e.date })),
      }),
    [person.birthDate, person.deathDate, events]
  );

  const generateBio = async () => {
    setBioBusy(true);
    setBioMsg(null);
    try {
      const r = await window.nodus.generatePersonBiography(person.personId);
      if (r.noEvidence) setBioMsg(t('Aún no hay evidencia suficiente para redactar una biografía.'));
      await onChanged();
    } catch (err) {
      setBioMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBioBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('Eliminar persona'),
      message: t('¿Eliminar esta persona y su evidencia? Los eventos en que participa se conservan.'),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    await window.nodus.deletePerson(person.personId);
    onClose?.();
    await onChanged();
  };

  const other = (m: MatchCandidatePair) => (m.aId === person.personId ? m.b : m.a);

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-start gap-3">
        <PortraitEditor person={person} onChanged={onChanged} />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold">{person.displayName}</h2>
          <p className="text-sm text-neutral-400">
            {t(SEX_LABEL[person.sex] ?? 'Sin determinar')}
            {lifeSpan(person) ? ` · ${lifeSpan(person)}` : ''}
          </p>
        </div>
        {extraActions}
        <button
          className={`btn h-8 w-8 p-0 ${editingBasics ? 'border border-indigo-600 bg-indigo-900/30 text-indigo-200' : 'btn-ghost text-neutral-300'}`}
          title={t('Editar datos')}
          onClick={() => setEditingBasics((v) => !v)}
        >
          <Icon name="edit" size={15} />
        </button>
        <button className="btn btn-ghost h-8 w-8 p-0 text-red-300 hover:text-red-200" title={t('Eliminar persona')} onClick={() => void remove()}>
          <Icon name="trash" size={15} />
        </button>
        {onClose && (
          <button className="btn btn-ghost px-2 py-1" onClick={onClose}>
            <Icon name="x" />
          </button>
        )}
      </div>

      {editingBasics && (
        <PersonBasicsEditor
          person={person}
          onClose={() => setEditingBasics(false)}
          onSaved={async () => {
            setEditingBasics(false);
            await onChanged();
          }}
        />
      )}

      {/* Biography — generated only on demand. */}
      <section className="rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Biografía')}</h3>
          <button
            className="btn btn-ghost ml-auto h-7 gap-1.5 border border-neutral-700 px-2 text-xs"
            disabled={bioBusy}
            onClick={() => void generateBio()}
          >
            <Icon name="wand" size={13} /> {bioBusy ? t('Generando…') : person.biography ? t('Regenerar') : t('Generar biografía')}
          </button>
        </div>
        {person.biography ? (
          <p className="whitespace-pre-wrap text-sm leading-6 text-neutral-200">{person.biography}</p>
        ) : (
          <p className="text-sm text-neutral-500">{t('Genera un resumen biográfico a partir de la evidencia disponible.')}</p>
        )}
        {bioMsg && <p className="mt-2 text-xs text-amber-300">{bioMsg}</p>}
      </section>

      {/* AI identity suggestions. */}
      {suggestions.length > 0 && (
        <section className="rounded-md border border-amber-900/50 bg-amber-950/10 p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-300">
            <Icon name="bulb" size={13} /> {t('Sugerencias de la IA')}
          </h3>
          <ul className="space-y-2">
            {suggestions.map((m) => {
              const o = other(m);
              return (
                <li key={`${m.aId}-${m.bId}`} className="rounded-md border border-neutral-800 p-2">
                  <p className="text-sm text-neutral-200">
                    {tx('¿Es la misma persona que {name}?', { name: o.displayName })}
                    <span className="text-neutral-500"> · {m.reasons.map((r) => t(r)).join(', ')}</span>
                  </p>
                  <div className="mt-1.5 flex gap-2">
                    <button
                      className="btn btn-primary h-7 text-xs"
                      onClick={async () => {
                        await window.nodus.mergePersons(person.personId, o.personId);
                        await onChanged();
                        await load();
                      }}
                    >
                      {t('Fusionar aquí')}
                    </button>
                    <button
                      className="btn btn-ghost h-7 border border-neutral-700 text-xs"
                      onClick={async () => {
                        await window.nodus.dismissMatch(person.personId, o.personId);
                        await load();
                      }}
                    >
                      {t('No es la misma')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Evidence-driven kinship suggestions: the AI proposes, the user confirms. */}
      {kinSuggestions.length > 0 && (
        <section className="rounded-md border border-indigo-900/50 bg-indigo-950/10 p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-300">
            <Icon name="tree" size={13} /> {t('Parentescos sugeridos')}
          </h3>
          <p className="mb-2 text-[11px] text-neutral-500">
            {t('Propuestas a partir de la evidencia. Nada se añade al árbol sin tu confirmación.')}
          </p>
          <ul className="space-y-2">
            {kinSuggestions.map((s) => (
              <li key={s.suggestionId} className="rounded-md border border-neutral-800 p-2">
                <div className="flex items-start gap-2">
                  <p className="flex-1 text-sm text-neutral-200">
                    {s.type === 'spouse'
                      ? tx('¿{a} y {b} eran cónyuges?', { a: s.fromName, b: s.toName })
                      : tx('¿{parent} era progenitor(a) de {child}?', { parent: s.fromName, child: s.toName })}
                  </p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase ${STRENGTH_STYLE[s.strength] ?? STRENGTH_STYLE.baja}`}>
                    {t(s.strength)}
                  </span>
                </div>
                {s.evidence.some((ev) => ev.quote) && (
                  <ul className="mt-1.5 space-y-1 border-l-2 border-neutral-800 pl-2">
                    {s.evidence
                      .filter((ev) => ev.quote)
                      .slice(0, 3)
                      .map((ev) => (
                        <li key={ev.id} className="text-xs italic text-neutral-400">
                          “{ev.quote}”
                          <span className="not-italic text-neutral-600">
                            {' '}
                            · {ev.signal === 'explicit_claim' ? t('mención explícita') : t('registro')}
                            {ev.location ? ` · ${ev.location}` : ''}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
                <div className="mt-1.5 flex gap-2">
                  <button
                    className="btn btn-primary h-7 text-xs"
                    onClick={async () => {
                      await window.nodus.confirmKinSuggestion(s.suggestionId);
                      await onChanged();
                      await load();
                    }}
                  >
                    {t('Confirmar parentesco')}
                  </button>
                  <button
                    className="btn btn-ghost h-7 border border-neutral-700 text-xs text-neutral-400"
                    onClick={async () => {
                      await window.nodus.dismissKinSuggestion(s.suggestionId);
                      await load();
                    }}
                  >
                    {t('Descartar')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {conflicts.length > 0 && (
        <section className="rounded-md border border-amber-900/60 bg-amber-950/20 p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-300">
            <Icon name="alert" size={14} /> {t('Hechos en conflicto')}
          </h3>
          <ul className="space-y-2">
            {conflicts.map((c) => (
              <li key={c.fact} className="text-sm">
                <span className="text-neutral-300">
                  {tx('Fechas de {fact} discrepantes ({span} años):', { fact: t(FACT_LABEL[c.fact] ?? c.fact), span: String(c.spanYears) })}
                </span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {c.values.map((v, i) => (
                    <span key={i} className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">
                      {v.date} <span className="text-neutral-500">· {t(v.label)}</span>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {kin && (kin.parents.length || kin.spouses.length || kin.children.length || kin.siblings.length) > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Parentesco')}</h3>
          <div className="space-y-1.5 text-sm">
            <KinRow label={t('Padres')} people={kin.parents} onNavigate={onNavigate} />
            <KinRow label={t('Cónyuges')} people={kin.spouses} onNavigate={onNavigate} />
            <KinRow label={t('Hijos')} people={kin.children} onNavigate={onNavigate} />
            <KinRow label={t('Hermanos')} people={kin.siblings} onNavigate={onNavigate} />
          </div>
        </section>
      )}

      <KinshipEditor
        person={person}
        persons={persons}
        onChanged={async () => {
          await load();
          await onChanged();
        }}
      />

      <RelationsSection personId={person.personId} onNavigate={onNavigate} />

      <NameVariantsEditor person={person} onChanged={onChanged} />

      <EventsEditor personId={person.personId} events={events} onChanged={load} />

      <PersonPlacesSection personId={person.personId} />

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t('Documentos')} <span className="text-neutral-600">({documents.length})</span>
        </h3>
        {documents.length === 0 ? (
          <p className="text-sm text-neutral-500">{t('Ningún documento vinculado. Vincúlalos desde el Archivo o acepta una sugerencia.')}</p>
        ) : (
          <ul className="space-y-1.5">
            {documents.map((d) => (
              <li key={d.itemId} className="flex items-center gap-2 rounded-md border border-neutral-800 px-3 py-2 text-sm">
                <Icon name="archive" size={14} className="shrink-0 text-neutral-500" />
                <span className="truncate text-neutral-200">{d.title}</span>
                {d.docType ? <span className="ml-auto shrink-0 text-xs text-neutral-500">{docTypeLabel(d.docType)}</span> : null}
              </li>
            ))}
          </ul>
        )}
        {docSuggestions.filter((d) => !hiddenDocs.has(d.itemId)).length > 0 && (
          <div className="mt-3">
            <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-300">
              <Icon name="bulb" size={12} /> {t('Documentos que podrían tratar sobre esta persona')}
            </h4>
            <ul className="space-y-1.5">
              {docSuggestions
                .filter((d) => !hiddenDocs.has(d.itemId))
                .map((d) => (
                  <li key={d.itemId} className="flex items-center gap-2 rounded-md border border-indigo-900/40 bg-indigo-950/10 px-3 py-2 text-sm">
                    <Icon name="archive" size={14} className="shrink-0 text-neutral-500" />
                    <span className="truncate text-neutral-200">{d.title}</span>
                    <span className="shrink-0 text-[11px] text-neutral-500">
                      {d.reason === 'semantic' ? tx('similitud {n}', { n: d.score.toFixed(2) }) : t('nombre citado')}
                    </span>
                    <button
                      className="btn btn-primary ml-auto h-7 shrink-0 px-2 text-xs"
                      onClick={async () => {
                        await window.nodus.linkArchivePerson(d.itemId, person.personId);
                        await load();
                      }}
                    >
                      {t('Vincular')}
                    </button>
                    <button
                      className="btn btn-ghost h-7 shrink-0 border border-neutral-700 px-2 text-xs text-neutral-400"
                      onClick={() => setHiddenDocs((prev) => new Set(prev).add(d.itemId))}
                    >
                      {t('Ocultar')}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t('Evidencia')} <span className="text-neutral-600">({evidence.length})</span>
        </h3>
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

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Notas')}</h3>
        <MarkdownNotesEditor
          value={person.notes}
          placeholder={t('Notas libres sobre esta persona, en Markdown…')}
          onSave={async (next) => {
            await window.nodus.updatePerson(person.personId, { notes: next || null });
            await onChanged();
          }}
        />
      </section>
    </div>
  );
}

/** Inline editor for a person's core fields (name, sex, dates), written directly. */
function PersonBasicsEditor({
  person,
  onSaved,
  onClose,
}: {
  person: Person;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [displayName, setDisplayName] = useState(person.displayName);
  const [sex, setSex] = useState<PersonSex>(person.sex);
  const [birthDate, setBirthDate] = useState(person.birthDate ?? '');
  const [deathDate, setDeathDate] = useState(person.deathDate ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!displayName.trim()) return;
    setSaving(true);
    try {
      await window.nodus.updatePerson(person.personId, {
        displayName: displayName.trim(),
        sex,
        birthDate: birthDate.trim() || null,
        deathDate: deathDate.trim() || null,
      });
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
      <input
        className="input h-8 w-full text-sm"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder={t('Nombre completo')}
      />
      <div className="grid grid-cols-3 gap-2">
        <select className="input h-8 text-sm" value={sex} onChange={(e) => setSex(e.target.value as PersonSex)}>
          <option value="unknown">{t('Sin determinar')}</option>
          <option value="male">{t('Hombre')}</option>
          <option value="female">{t('Mujer')}</option>
        </select>
        <input
          className="input h-8 text-sm"
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
          placeholder={t('Nacimiento')}
        />
        <input
          className="input h-8 text-sm"
          value={deathDate}
          onChange={(e) => setDeathDate(e.target.value)}
          placeholder={t('Defunción')}
        />
      </div>
      <p className="text-[11px] text-neutral-500">{t('Las fechas pueden ser inciertas: "c. 1850", "antes de 1880".')}</p>
      <div className="flex gap-2">
        <button className="btn btn-primary h-8 flex-1 text-xs" disabled={saving || !displayName.trim()} onClick={() => void save()}>
          {saving ? t('Guardando…') : t('Guardar')}
        </button>
        <button className="btn btn-ghost h-8 border border-neutral-700 px-3 text-xs" onClick={onClose} disabled={saving}>
          {t('Cancelar')}
        </button>
      </div>
    </div>
  );
}

/** Add or remove name variants/spellings for a person. */
function NameVariantsEditor({ person, onChanged }: { person: Person; onChanged: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');

  const add = async () => {
    const name = value.trim();
    if (!name) return;
    await window.nodus.addPersonName(person.personId, name, 'variante');
    setValue('');
    setAdding(false);
    await onChanged();
  };

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Variantes del nombre')}</h3>
        <button className="btn btn-ghost ml-auto h-6 gap-1 border border-neutral-700 px-2 text-[11px]" onClick={() => setAdding((v) => !v)}>
          <Icon name="plus" size={11} /> {t('Añadir variante')}
        </button>
      </div>
      {person.names.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {person.names.map((n) => (
            <span key={n.name} className="rounded-full bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300">
              {n.name}
              {n.kind ? <span className="text-neutral-500"> · {n.kind}</span> : null}
            </span>
          ))}
        </div>
      )}
      {adding && (
        <div className="flex gap-2">
          <input
            className="input h-8 flex-1 text-sm"
            value={value}
            autoFocus
            placeholder={t('Nueva variante del nombre…')}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
          />
          <button className="btn btn-primary h-8 px-3 text-xs" disabled={!value.trim()} onClick={() => void add()}>
            {t('Guardar')}
          </button>
        </div>
      )}
    </section>
  );
}

/** Add, edit and delete a person's life events (type, date, place, notes). The
 *  person is added as the event's principal participant on creation. */
function EventsEditor({
  personId,
  events,
  onChanged,
}: {
  personId: string;
  events: HistoricalEvent[];
  onChanged: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const removeEvent = async (eventId: string) => {
    const ok = await confirm({ title: t('Eliminar evento'), message: t('¿Eliminar este evento?'), confirmLabel: t('Eliminar'), danger: true });
    if (!ok) return;
    await window.nodus.deleteEvent(eventId);
    await onChanged();
  };

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t('Eventos de su vida')} <span className="text-neutral-600">({events.length})</span>
        </h3>
        <button className="btn btn-ghost ml-auto h-6 gap-1 border border-neutral-700 px-2 text-[11px]" onClick={() => setAdding((v) => !v)}>
          <Icon name="plus" size={11} /> {t('Añadir evento')}
        </button>
      </div>

      {adding && (
        <div className="mb-2">
          <EventForm
            personId={personId}
            onSaved={async () => {
              setAdding(false);
              await onChanged();
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {events.length === 0 && !adding ? (
        <p className="text-sm text-neutral-500">{t('Sin eventos registrados.')}</p>
      ) : (
        <ul className="space-y-1.5">
          {events.map((e) =>
            editingId === e.eventId ? (
              <li key={e.eventId}>
                <EventForm
                  personId={personId}
                  event={e}
                  onSaved={async () => {
                    setEditingId(null);
                    await onChanged();
                  }}
                  onCancel={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li key={e.eventId} className="flex items-center gap-2 rounded-md border border-neutral-800 px-3 py-2 text-sm">
                <span className="font-medium text-neutral-200">{t(EVENT_TYPE_LABEL[e.type] ?? e.type)}</span>
                {e.date ? <span className="text-neutral-400">· {e.date}</span> : null}
                {e.placeName ? <span className="text-neutral-500">· {e.placeName}</span> : null}
                <div className="ml-auto flex shrink-0 gap-0.5">
                  <button className="btn btn-ghost h-7 w-7 p-0 text-neutral-400 hover:text-neutral-200" title={t('Editar')} onClick={() => setEditingId(e.eventId)}>
                    <Icon name="edit" size={14} />
                  </button>
                  <button className="btn btn-ghost h-7 w-7 p-0 text-red-300 hover:text-red-200" title={t('Eliminar')} onClick={() => void removeEvent(e.eventId)}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </li>
            )
          )}
        </ul>
      )}
    </section>
  );
}

/** Create or edit a single event. Places are resolved/created by name. */
function EventForm({
  personId,
  event,
  onSaved,
  onCancel,
}: {
  personId: string;
  event?: HistoricalEvent;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [type, setType] = useState<HistoricalEventType>(event?.type ?? 'birth');
  const [date, setDate] = useState(event?.date ?? '');
  const [place, setPlace] = useState(event?.placeName ?? '');
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      let placeId: string | null = event?.placeId ?? null;
      const placeName = place.trim();
      if (placeName) {
        const p = await window.nodus.findOrCreatePlace(placeName);
        placeId = p.placeId;
      } else {
        placeId = null;
      }
      if (event) {
        await window.nodus.updateEvent(event.eventId, { type, date: date.trim() || null, placeId, notes: notes.trim() || null });
      } else {
        await window.nodus.createEvent({
          type,
          date: date.trim() || null,
          placeId,
          notes: notes.trim() || null,
          participants: [{ personId, role: 'principal' }],
        });
      }
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-neutral-800 bg-neutral-950 p-2.5">
      <div className="grid grid-cols-2 gap-2">
        <select className="input h-8 text-sm" value={type} onChange={(e) => setType(e.target.value as HistoricalEventType)}>
          {EVENT_TYPE_OPTIONS.map((tp) => (
            <option key={tp} value={tp}>
              {t(EVENT_TYPE_LABEL[tp] ?? tp)}
            </option>
          ))}
        </select>
        <input className="input h-8 text-sm" value={date} onChange={(e) => setDate(e.target.value)} placeholder={t('Fecha (puede ser incierta: «c. 1850»)')} />
      </div>
      <input className="input h-8 w-full text-sm" value={place} onChange={(e) => setPlace(e.target.value)} placeholder={t('Lugar')} />
      <textarea className="input min-h-14 w-full resize-y text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('Notas')} />
      <div className="flex gap-2">
        <button className="btn btn-primary h-8 flex-1 text-xs" disabled={saving} onClick={() => void save()}>
          {saving ? t('Guardando…') : t('Guardar evento')}
        </button>
        <button className="btn btn-ghost h-8 border border-neutral-700 px-3 text-xs" onClick={onCancel} disabled={saving}>
          {t('Cancelar')}
        </button>
      </div>
    </div>
  );
}

function KinRow({ label, people, onNavigate }: { label: string; people: Person[]; onNavigate?: (id: string) => void }) {
  if (people.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <span className="text-xs text-neutral-500">{label}:</span>
      {people.map((p) => (
        <button
          key={p.personId}
          onClick={() => onNavigate?.(p.personId)}
          className={`rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-200 ${onNavigate ? 'hover:bg-neutral-700' : 'cursor-default'}`}
        >
          {p.displayName}
        </button>
      ))}
    </div>
  );
}

/**
 * Portrait control with explicit, always-visible actions: upload a real photo (and
 * frame it non-destructively by dragging + zoom), or — exceptionally — generate an
 * illustrative AI reference portrait from a text description. Framing never alters
 * the stored bytes.
 */
function PortraitEditor({ person, onChanged }: { person: Person; onChanged: () => Promise<void> }) {
  const [focus, setFocus] = useState<PortraitFocus>(person.portrait ?? { focusX: 0.5, focusY: 0.5, scale: 1 });
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [description, setDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const SIZE = 96;

  useEffect(() => {
    setFocus(person.portrait ?? { focusX: 0.5, focusY: 0.5, scale: 1 });
  }, [person.personId, person.portrait?.focusX, person.portrait?.focusY, person.portrait?.scale]);

  const upload = async () => {
    const updated = await window.nodus.setPersonPortraitFromFile(person.personId);
    if (updated) {
      setShowGenerate(false);
      setAdjusting(true);
      await onChanged();
    }
  };
  const remove = async () => {
    await window.nodus.clearPersonPortrait(person.personId);
    setAdjusting(false);
    await onChanged();
  };
  const generateReference = async () => {
    setGenerating(true);
    setGenError(null);
    try {
      await window.nodus.generatePersonPortraitReference(person.personId, description);
      setShowGenerate(false);
      setDescription('');
      setAdjusting(true);
      await onChanged();
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!person.portrait || !adjusting) return;
    dragging.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = (e.clientX - dragging.current.x) / SIZE;
    const dy = (e.clientY - dragging.current.y) / SIZE;
    dragging.current = { x: e.clientX, y: e.clientY };
    setFocus((f) => ({ ...f, focusX: Math.min(1, Math.max(0, f.focusX - dx)), focusY: Math.min(1, Math.max(0, f.focusY - dy)) }));
  };
  const onPointerUp = () => {
    if (dragging.current) {
      dragging.current = null;
      void window.nodus.updatePortraitFocus(person.personId, focus);
    }
  };

  const hasPortrait = !!person.portrait;

  // Dismiss the zoom / AI-generate popovers on an outside click or Escape, and
  // when another dismissable layer opens — otherwise the little panel lingered.
  const editorRef = useDismissableLayer<HTMLDivElement>({
    open: adjusting || showGenerate,
    onDismiss: () => {
      setAdjusting(false);
      setShowGenerate(false);
    },
    group: 'portrait-editor',
  });

  return (
    <div className="relative w-36 shrink-0" ref={editorRef}>
      <div
        className="flex justify-center"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title={hasPortrait && adjusting ? t('Arrastra para encuadrar la cara') : undefined}
        style={{ cursor: hasPortrait && adjusting ? 'grab' : 'default', touchAction: 'none' }}
      >
        <PersonPortrait person={{ ...person, portrait: hasPortrait ? focus : null }} size={SIZE} rounded="md" />
      </div>

      <div className="mt-2 space-y-1">
        {!hasPortrait ? (
          <>
            <button className="btn btn-ghost h-7 w-full justify-center gap-1.5 whitespace-nowrap border border-neutral-700 px-2 text-xs" onClick={() => void upload()}>
              <Icon name="upload" size={12} /> {t('Subir foto')}
            </button>
            <button
              className="btn btn-ghost h-7 w-full justify-center gap-1.5 whitespace-nowrap border border-neutral-700 px-2 text-xs"
              onClick={() => setShowGenerate((v) => !v)}
            >
              <Icon name="wand" size={12} /> {t('Generar con IA')}
            </button>
          </>
        ) : (
          <>
            <button
              className={`btn min-h-7 w-full justify-center gap-1.5 border px-2 py-1 text-center text-xs leading-tight ${adjusting ? 'border-indigo-600 bg-indigo-900/30 text-indigo-200' : 'btn-ghost border-neutral-700'}`}
              onClick={() => setAdjusting((v) => !v)}
            >
              <Icon name="fit" size={12} /> {t('Ajustar encuadre')}
            </button>
            <button
              className="btn btn-ghost h-7 w-full justify-center gap-1.5 whitespace-nowrap border border-neutral-700 px-2 text-xs"
              onClick={() => setShowGenerate((v) => !v)}
            >
              <Icon name="wand" size={12} /> {t('Regenerar con IA')}
            </button>
            <div className="flex gap-1">
              <button className="btn btn-ghost h-7 flex-1 justify-center border border-neutral-700 px-1 text-xs" onClick={() => void upload()}>
                {t('Cambiar')}
              </button>
              <button className="btn btn-ghost h-7 flex-1 justify-center border border-neutral-700 px-1 text-xs text-red-300" onClick={() => void remove()}>
                {t('Quitar')}
              </button>
            </div>
          </>
        )}
      </div>

      {hasPortrait && adjusting && (
        <div className="absolute left-0 top-full z-20 mt-1 w-52 rounded-md border border-neutral-800 bg-neutral-950 p-2 text-xs shadow-xl">
          <label className="mb-1 block text-neutral-500">{t('Zoom')}</label>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={focus.scale}
            onChange={(e) => {
              const next = { ...focus, scale: Number(e.target.value) };
              setFocus(next);
              void window.nodus.updatePortraitFocus(person.personId, next);
            }}
            className="w-full"
          />
          <p className="mt-1 text-[10px] leading-3 text-neutral-600">{t('Arrastra el retrato para encuadrar la cara y usa el zoom.')}</p>
        </div>
      )}

      {showGenerate && (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 space-y-1.5 rounded-md border border-amber-900/50 bg-neutral-950 p-2 text-xs shadow-xl">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-300">{t('Retrato de referencia con IA')}</p>
          <p className="text-[10px] leading-4 text-amber-300/90">
            {t('No recomendado: un retrato generado por IA es una impresión artística, no una fotografía real. Úsalo solo como marcador visual excepcional cuando no conserves ninguna imagen.')}
          </p>
          <textarea
            className="input min-h-16 w-full resize-y text-xs"
            placeholder={t('Describe sus rasgos (p. ej. «hombre mayor, bigote canoso, mirada seria»)')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={generating}
          />
          {genError && <p className="text-[10px] text-red-300">{genError}</p>}
          <div className="flex gap-2">
            <button
              className="btn h-7 flex-1 justify-center gap-1 border border-amber-800 px-1 text-amber-200 disabled:opacity-50"
              onClick={() => void generateReference()}
              disabled={generating || !description.trim()}
            >
              <Icon name="wand" size={11} /> {generating ? t('Generando…') : t('Generar')}
            </button>
            <button className="btn btn-ghost h-7 justify-center border border-neutral-700 px-2" onClick={() => setShowGenerate(false)} disabled={generating}>
              {t('Cancelar')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
