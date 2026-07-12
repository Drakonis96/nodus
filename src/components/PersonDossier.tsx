import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ArchiveItem, HistoricalEvent, Kin, MatchCandidatePair, Person, PortraitFocus, RecordEvidence } from '@shared/types';
import { detectPersonConflicts } from '@shared/conflictDetection';
import { Icon } from './ui';
import { PersonPortrait } from './PersonPortrait';
import { docTypeLabel } from './DocTypeForm';
import { EVENT_TYPE_LABEL, FACT_LABEL } from './personLabels';
import { t, tx } from '../i18n';

function lifeSpan(p: Person): string {
  const b = p.birthDate?.trim();
  const d = p.deathDate?.trim();
  if (b && d) return `${b} – ${d}`;
  if (b) return `n. ${b}`;
  if (d) return `†︎ ${d}`;
  return '';
}

const SEX_LABEL: Record<string, string> = { male: 'Hombre', female: 'Mujer', unknown: 'Sin determinar' };

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
  const [documents, setDocuments] = useState<ArchiveItem[]>([]);
  const [suggestions, setSuggestions] = useState<MatchCandidatePair[]>([]);
  const [bioBusy, setBioBusy] = useState(false);
  const [bioMsg, setBioMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    void window.nodus.listEvents({ personId: person.personId }).then(setEvents);
    void window.nodus.listRecordEvidence('person', person.personId).then(setEvidence);
    void window.nodus.kinOf(person.personId).then(setKin);
    void window.nodus.listArchiveItemsForPerson(person.personId).then(setDocuments);
    void window.nodus.findMatches().then((all) =>
      setSuggestions(all.filter((m) => m.aId === person.personId || m.bId === person.personId))
    );
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
    if (!window.confirm(t('¿Eliminar esta persona y su evidencia? Los eventos en que participa se conservan.'))) return;
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
        <button className="btn btn-ghost gap-1.5 text-red-300" onClick={() => void remove()}>
          <Icon name="trash" size={14} /> {t('Eliminar')}
        </button>
        {onClose && (
          <button className="btn btn-ghost px-2 py-1" onClick={onClose}>
            <Icon name="x" />
          </button>
        )}
      </div>

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

      {person.names.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Variantes del nombre')}</h3>
          <div className="flex flex-wrap gap-1.5">
            {person.names.map((n) => (
              <span key={n.name} className="rounded-full bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300">
                {n.name}
                {n.kind ? <span className="text-neutral-500"> · {n.kind}</span> : null}
              </span>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t('Eventos de su vida')} <span className="text-neutral-600">({events.length})</span>
        </h3>
        {events.length === 0 ? (
          <p className="text-sm text-neutral-500">{t('Sin eventos registrados.')}</p>
        ) : (
          <ul className="space-y-1.5">
            {events.map((e) => (
              <li key={e.eventId} className="rounded-md border border-neutral-800 px-3 py-2 text-sm">
                <span className="font-medium text-neutral-200">{t(EVENT_TYPE_LABEL[e.type] ?? e.type)}</span>
                {e.date ? <span className="text-neutral-400"> · {e.date}</span> : null}
                {e.placeName ? <span className="text-neutral-500"> · {e.placeName}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t('Documentos')} <span className="text-neutral-600">({documents.length})</span>
        </h3>
        {documents.length === 0 ? (
          <p className="text-sm text-neutral-500">{t('Ningún documento vinculado. Vincúlalos desde el Archivo.')}</p>
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

/** Portrait with upload, drag-to-focus and zoom. Framing is non-destructive. */
function PortraitEditor({ person, onChanged }: { person: Person; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [focus, setFocus] = useState<PortraitFocus>(person.portrait ?? { focusX: 0.5, focusY: 0.5, scale: 1 });
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const SIZE = 56;

  useEffect(() => {
    setFocus(person.portrait ?? { focusX: 0.5, focusY: 0.5, scale: 1 });
  }, [person.personId, person.portrait?.focusX, person.portrait?.focusY, person.portrait?.scale]);

  const upload = async () => {
    const updated = await window.nodus.setPersonPortraitFromFile(person.personId);
    if (updated) {
      await onChanged();
      setEditing(true);
    }
  };
  const remove = async () => {
    await window.nodus.clearPersonPortrait(person.personId);
    setEditing(false);
    await onChanged();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!person.portrait) return;
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

  return (
    <div className="shrink-0">
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title={person.portrait ? t('Arrastra para encuadrar la cara') : t('Sube una foto')}
        style={{ cursor: person.portrait ? 'grab' : 'pointer', touchAction: 'none' }}
        onClick={() => (person.portrait ? setEditing((v) => !v) : void upload())}
      >
        <PersonPortrait person={{ ...person, portrait: person.portrait ? focus : null }} size={SIZE} rounded="md" />
      </div>
      {editing && person.portrait && (
        <div className="mt-2 w-44 space-y-1.5 rounded-md border border-neutral-800 bg-neutral-950 p-2 text-xs">
          <label className="block text-neutral-500">{t('Zoom')}</label>
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
          <div className="flex gap-2 pt-1">
            <button className="btn btn-ghost h-7 flex-1 border border-neutral-700 px-1" onClick={() => void upload()}>
              {t('Cambiar')}
            </button>
            <button className="btn btn-ghost h-7 flex-1 border border-neutral-700 px-1 text-red-300" onClick={() => void remove()}>
              {t('Quitar')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
