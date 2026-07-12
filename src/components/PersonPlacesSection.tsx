import { useCallback, useEffect, useState } from 'react';
import type { GazetteerPlace, MapPlacePoint, PersonPlace } from '@shared/types';
import { Icon } from './ui';
import { PlacePicker } from './PlacePicker';
import { PlacesMap } from './PlacesMap';
import { confirm } from './feedback';
import { t, tx } from '../i18n';

// A person's PLACE RECORD: the list of places associated with them (birth, residence,
// death…) with a date, plus their individual map built from those places. Resolving a
// place from the gazetteer gives it real coordinates so it plots on the map.

const PLACE_LABELS = ['birth', 'baptism', 'residence', 'marriage', 'death', 'burial', 'migration', 'other'] as const;
const PLACE_LABEL_ES: Record<string, string> = {
  birth: 'Nacimiento',
  baptism: 'Bautismo',
  residence: 'Residencia',
  marriage: 'Matrimonio',
  death: 'Defunción',
  burial: 'Entierro',
  migration: 'Migración',
  other: 'Otro',
};

export function PersonPlacesSection({ personId }: { personId: string }) {
  const [places, setPlaces] = useState<PersonPlace[]>([]);
  const [points, setPoints] = useState<MapPlacePoint[]>([]);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const [list, pts] = await Promise.all([
      window.nodus.listPersonPlaces(personId),
      window.nodus.mapPoints([personId]),
    ]);
    setPlaces(list);
    setPoints(pts);
  }, [personId]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (pp: PersonPlace) => {
    const ok = await confirm({
      title: t('Eliminar lugar'),
      message: tx('¿Eliminar «{name}» de los lugares de esta persona?', { name: pp.placeName }),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    await window.nodus.deletePersonPlace(pp.id);
    await load();
  };

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t('Lugares')} <span className="text-neutral-600">({places.length})</span>
        </h3>
        <button
          className="btn btn-ghost ml-auto h-6 gap-1 border border-neutral-700 px-2 text-[11px]"
          onClick={() => setAdding((v) => !v)}
        >
          <Icon name="plus" size={11} /> {t('Añadir lugar')}
        </button>
      </div>

      <p className="mb-2 text-[11px] text-neutral-500">
        {t('Registra los lugares de esta persona (municipio, estado, país). Construyen su mapa individual y alimentan el mapa general.')}
      </p>

      {adding && (
        <div className="mb-3">
          <AddPersonPlace
            personId={personId}
            onSaved={async () => {
              setAdding(false);
              await load();
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {places.length === 0 && !adding ? (
        <p className="text-sm text-neutral-500">{t('Sin lugares registrados.')}</p>
      ) : (
        <ul className="mb-3 space-y-1.5">
          {places.map((pp) => (
            <li key={pp.id} className="flex items-center gap-2 rounded-md border border-neutral-800 px-3 py-2 text-sm">
              <Icon name="map" size={14} className="shrink-0 text-amber-400" />
              <span className="min-w-0">
                <span className="truncate text-neutral-100">{pp.placeName}</span>
                {(pp.admin1 || pp.country) && (
                  <span className="text-neutral-500"> · {[pp.admin1, pp.country].filter(Boolean).join(', ')}</span>
                )}
                {pp.latitude == null && <span className="ml-1 text-[10px] text-amber-500/80">({t('sin coordenadas')})</span>}
              </span>
              {pp.label && (
                <span className="ml-auto shrink-0 rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] uppercase text-neutral-400">
                  {t(PLACE_LABEL_ES[pp.label] ?? pp.label)}
                </span>
              )}
              {pp.date && <span className="shrink-0 text-xs text-neutral-500">{pp.date}</span>}
              <button className="btn btn-ghost h-7 w-7 shrink-0 p-0 text-red-300 hover:text-red-200" title={t('Eliminar')} onClick={() => void remove(pp)}>
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {points.length > 0 && <PlacesMap points={points} height={280} showRoutes />}
    </section>
  );
}

function AddPersonPlace({
  personId,
  onSaved,
  onCancel,
}: {
  personId: string;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<GazetteerPlace | null>(null);
  const [label, setLabel] = useState<string>('residence');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!picked) return;
    setSaving(true);
    try {
      const place = await window.nodus.resolveGazetteerPlace(picked);
      await window.nodus.addPersonPlace({
        personId,
        placeId: place.placeId,
        label,
        date: date.trim() || null,
        notes: notes.trim() || null,
      });
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-neutral-800 bg-neutral-950 p-2.5">
      {!picked ? (
        <PlacePicker autoFocus onPick={setPicked} />
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900/50 px-2 py-1.5 text-sm">
          <Icon name="map" size={14} className="shrink-0 text-amber-400" />
          <span className="min-w-0 flex-1">
            <span className="truncate text-neutral-100">{picked.name}</span>
            <span className="text-neutral-500"> · {[picked.admin1, picked.country].filter(Boolean).join(', ')}</span>
          </span>
          <button className="btn btn-ghost h-6 px-2 text-[11px]" onClick={() => setPicked(null)}>
            {t('Cambiar')}
          </button>
        </div>
      )}

      {picked && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <select className="input h-8 text-sm" value={label} onChange={(e) => setLabel(e.target.value)}>
              {PLACE_LABELS.map((l) => (
                <option key={l} value={l}>
                  {t(PLACE_LABEL_ES[l])}
                </option>
              ))}
            </select>
            <input
              className="input h-8 text-sm"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              placeholder={t('Fecha (puede ser incierta: «c. 1850»)')}
            />
          </div>
          <input className="input h-8 w-full text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('Notas')} />
          <div className="flex gap-2">
            <button className="btn btn-primary h-8 flex-1 text-xs" disabled={saving} onClick={() => void save()}>
              {saving ? t('Guardando…') : t('Guardar lugar')}
            </button>
            <button className="btn btn-ghost h-8 border border-neutral-700 px-3 text-xs" onClick={onCancel} disabled={saving}>
              {t('Cancelar')}
            </button>
          </div>
        </>
      )}
      {!picked && (
        <button className="btn btn-ghost h-7 w-full border border-neutral-700 text-xs" onClick={onCancel}>
          {t('Cancelar')}
        </button>
      )}
    </div>
  );
}
