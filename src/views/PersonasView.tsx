import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HistoricalEvent, MatchCandidatePair, Person, PersonSex, PortraitFocus, RecordEvidence } from '@shared/types';
import { Icon } from '../components/ui';
import { PersonPortrait } from '../components/PersonPortrait';
import { t, tx } from '../i18n';

const SEX_LABEL: Record<PersonSex, string> = {
  male: 'Hombre',
  female: 'Mujer',
  unknown: 'Sin determinar',
};

function lifeSpan(p: Person): string {
  const b = p.birthDate?.trim();
  const d = p.deathDate?.trim();
  if (b && d) return `${b} – ${d}`;
  if (b) return `n. ${b}`;
  if (d) return `†︎ ${d}`;
  return '';
}

export function PersonasView() {
  const [persons, setPersons] = useState<Person[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const reload = useCallback(async () => {
    const list = await window.nodus.listPersons(search.trim() || undefined);
    setPersons(list);
  }, [search]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selected = useMemo(() => persons.find((p) => p.personId === selectedId) ?? null, [persons, selectedId]);

  return (
    <div className="h-full flex min-h-0">
      <div className="flex w-[22rem] shrink-0 flex-col border-r border-neutral-800 min-h-0">
        <div className="shrink-0 space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Icon name="users" size={20} className="text-indigo-300" />
            <h1 className="text-lg font-semibold">{t('Personas')}</h1>
            <span className="ml-auto text-xs text-neutral-500">{persons.length}</span>
          </div>
          <input
            className="input h-9 w-full text-sm"
            placeholder={t('Buscar por nombre o variante…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn btn-primary h-9 w-full gap-1.5" onClick={() => setAdding(true)}>
            <Icon name="plus" /> {t('Añadir persona')}
          </button>
          <div className="flex gap-2">
            <button
              className="btn btn-ghost h-8 flex-1 gap-1.5 border border-neutral-700 text-xs"
              title={t('Importar un árbol GEDCOM (Gramps, Ancestry…)')}
              onClick={() =>
                void window.nodus.importGedcom().then((r) => {
                  if (r) void reload();
                })
              }
            >
              <Icon name="upload" size={13} /> {t('Importar GEDCOM')}
            </button>
            <button
              className="btn btn-ghost h-8 flex-1 gap-1.5 border border-neutral-700 text-xs"
              title={t('Exportar a GEDCOM para Gramps / Ancestry')}
              onClick={() => void window.nodus.exportGedcom()}
            >
              <Icon name="download" size={13} /> {t('Exportar')}
            </button>
          </div>
          <button
            className="btn btn-ghost h-8 w-full gap-1.5 border border-neutral-700 text-xs"
            title={t('Buscar registros que podrían ser la misma persona')}
            onClick={() => setReviewing(true)}
          >
            <Icon name="users" size={13} /> {t('Revisar coincidencias')}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {persons.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-neutral-500">
              {t('Aún no hay personas. Se crean al analizar fuentes primarias o añadiéndolas a mano.')}
            </p>
          )}
          {persons.map((p) => (
            <button
              key={p.personId}
              onClick={() => setSelectedId(p.personId)}
              className={`mb-1 flex w-full flex-col items-start rounded-md px-3 py-2 text-left transition ${
                p.personId === selectedId ? 'bg-indigo-600/20 ring-1 ring-indigo-500/40' : 'hover:bg-neutral-800/60'
              }`}
            >
              <span className="truncate text-sm text-neutral-100">{p.displayName}</span>
              <span className="truncate text-xs text-neutral-500">{lifeSpan(p) || t('sin fechas')}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {selected ? (
          <PersonDetail key={selected.personId} person={selected} onChanged={reload} onClose={() => setSelectedId(null)} />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-neutral-500">
            {t('Selecciona una persona para ver su ficha, sus eventos y la evidencia que la respalda.')}
          </div>
        )}
      </div>

      {adding && <AddPersonModal onClose={() => setAdding(false)} onSaved={reload} />}
      {reviewing && (
        <MatchReviewModal
          onClose={() => setReviewing(false)}
          onChanged={async () => {
            setSelectedId(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}

/** Review proposed identity matches: merge (keep one record) or dismiss (not the same). */
function MatchReviewModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<void> }) {
  const [pairs, setPairs] = useState<MatchCandidatePair[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setPairs(await window.nodus.findMatches());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="card flex max-h-[85vh] w-full max-w-2xl flex-col p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">{t('Posibles coincidencias')}</h2>
            <p className="text-xs text-neutral-500">
              {t('Registros que podrían ser la misma persona. Tú decides; nada se fusiona automáticamente.')}
            </p>
          </div>
          <button className="btn btn-ghost px-2 py-1" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {pairs === null ? (
            <p className="py-8 text-center text-sm text-neutral-500">{t('Buscando coincidencias…')}</p>
          ) : pairs.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">{t('No hay coincidencias por revisar.')}</p>
          ) : (
            <ul className="space-y-3">
              {pairs.map((pair) => (
                <li key={`${pair.aId}-${pair.bId}`} className="rounded-lg border border-neutral-800 p-3">
                  <div className="mb-2 grid grid-cols-2 gap-3">
                    <PairPerson person={pair.a} />
                    <PairPerson person={pair.b} />
                  </div>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {pair.reasons.map((r) => (
                      <span key={r} className="rounded-full bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-400">
                        {t(r)}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="btn btn-primary h-8 gap-1.5 text-xs"
                      disabled={busy}
                      onClick={() => void act(() => window.nodus.mergePersons(pair.aId, pair.bId))}
                    >
                      {tx('Fusionar en {name}', { name: pair.a.displayName })}
                    </button>
                    <button
                      className="btn btn-ghost h-8 gap-1.5 border border-neutral-700 text-xs"
                      disabled={busy}
                      onClick={() => void act(() => window.nodus.mergePersons(pair.bId, pair.aId))}
                    >
                      {tx('Fusionar en {name}', { name: pair.b.displayName })}
                    </button>
                    <button
                      className="btn btn-ghost h-8 gap-1.5 border border-neutral-700 text-xs text-neutral-400"
                      disabled={busy}
                      onClick={() => void act(() => window.nodus.dismissMatch(pair.aId, pair.bId))}
                    >
                      {t('No son la misma')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function PairPerson({ person }: { person: Person }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-neutral-900/50 p-2">
      <PersonPortrait person={person} size={40} />
      <div className="min-w-0">
        <div className="truncate text-sm text-neutral-100">{person.displayName}</div>
        <div className="truncate text-xs text-neutral-500">{lifeSpan(person) || t('sin fechas')}</div>
      </div>
    </div>
  );
}

function PersonDetail({ person, onChanged, onClose }: { person: Person; onChanged: () => Promise<void>; onClose: () => void }) {
  const [events, setEvents] = useState<HistoricalEvent[]>([]);
  const [evidence, setEvidence] = useState<RecordEvidence[]>([]);

  useEffect(() => {
    void window.nodus.listEvents({ personId: person.personId }).then(setEvents);
    void window.nodus.listRecordEvidence('person', person.personId).then(setEvidence);
  }, [person.personId]);

  const remove = async () => {
    if (!window.confirm(t('¿Eliminar esta persona y su evidencia? Los eventos en que participa se conservan.'))) return;
    await window.nodus.deletePerson(person.personId);
    onClose();
    await onChanged();
  };

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-start gap-3">
        <PortraitEditor person={person} onChanged={onChanged} />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold">{person.displayName}</h2>
          <p className="text-sm text-neutral-400">
            {SEX_LABEL[person.sex]}
            {lifeSpan(person) ? ` · ${lifeSpan(person)}` : ''}
          </p>
        </div>
        <button className="btn btn-ghost gap-1.5 text-red-300" onClick={() => void remove()}>
          <Icon name="trash" size={14} /> {t('Eliminar')}
        </button>
      </div>

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

export const EVENT_TYPE_LABEL: Record<string, string> = {
  birth: 'Nacimiento',
  baptism: 'Bautismo',
  marriage: 'Matrimonio',
  death: 'Defunción',
  burial: 'Entierro',
  census: 'Censo',
  residence: 'Residencia',
  migration: 'Migración',
  occupation: 'Ocupación',
  other: 'Otro',
};

/** Portrait with upload, drag-to-focus and zoom. Framing is non-destructive. */
function PortraitEditor({ person, onChanged }: { person: Person; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [focus, setFocus] = useState<PortraitFocus>(person.portrait ?? { focusX: 0.5, focusY: 0.5, scale: 1 });
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const SIZE = 48;

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

  const persistFocus = async (next: PortraitFocus) => {
    setFocus(next);
    await window.nodus.updatePortraitFocus(person.personId, next);
  };

  // Drag the photo: moving right reveals the left side (focusX decreases).
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
    setFocus((f) => ({
      ...f,
      focusX: Math.min(1, Math.max(0, f.focusX - dx)),
      focusY: Math.min(1, Math.max(0, f.focusY - dy)),
    }));
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
        {/* Live preview reflects the in-progress focus while dragging. */}
        <PersonPortrait person={{ ...person, portrait: person.portrait ? focus : null }} size={SIZE} />
      </div>
      {editing && person.portrait && (
        <div className="mt-2 w-40 space-y-1.5 rounded-md border border-neutral-800 bg-neutral-950 p-2 text-xs">
          <label className="block text-neutral-500">{t('Zoom')}</label>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={focus.scale}
            onChange={(e) => void persistFocus({ ...focus, scale: Number(e.target.value) })}
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

function AddPersonModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [sex, setSex] = useState<PersonSex>('unknown');
  const [birth, setBirth] = useState('');
  const [death, setDeath] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await window.nodus.createPerson({
        displayName: name.trim(),
        sex,
        birthDate: birth.trim() || null,
        deathDate: death.trim() || null,
        names: [{ name: name.trim(), kind: null }],
      });
      await onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="card w-full max-w-md space-y-3 p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold">{t('Añadir persona')}</h2>
        <input
          className="input h-9 w-full text-sm"
          placeholder={t('Nombre completo')}
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
        <div className="grid grid-cols-3 gap-2">
          <select className="input h-9 text-sm" value={sex} onChange={(e) => setSex(e.target.value as PersonSex)}>
            <option value="unknown">{t('Sin determinar')}</option>
            <option value="male">{t('Hombre')}</option>
            <option value="female">{t('Mujer')}</option>
          </select>
          <input
            className="input h-9 text-sm"
            placeholder={t('Nacimiento')}
            value={birth}
            onChange={(e) => setBirth(e.target.value)}
          />
          <input
            className="input h-9 text-sm"
            placeholder={t('Defunción')}
            value={death}
            onChange={(e) => setDeath(e.target.value)}
          />
        </div>
        <p className="text-xs text-neutral-500">{t('Las fechas pueden ser inciertas: "c. 1850", "antes de 1880".')}</p>
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn btn-ghost" onClick={onClose}>
            {t('Cancelar')}
          </button>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void save()}>
            {t('Guardar')}
          </button>
        </div>
      </div>
    </div>
  );
}
