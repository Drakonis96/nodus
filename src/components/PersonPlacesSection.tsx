import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GazetteerPlace, MapPlacePoint, PersonPlace } from '@shared/types';
import { Icon } from './ui';
import { PlacePicker } from './PlacePicker';
import { PlacesMap } from './PlacesMap';
import { confirm } from './feedback';
import { t, tx } from '../i18n';
import { PERSON_DOSSIER_ADD_BUTTON_CLASS, PERSON_DOSSIER_SECTION_CLASS } from './personDossierLayout';

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
    <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="person-dossier-places">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t('Lugares')} <span className="text-neutral-600">({places.length})</span>
        </h3>
        <button
          className={`${PERSON_DOSSIER_ADD_BUTTON_CLASS} ml-auto`}
          onClick={() => setAdding(true)}
        >
          <Icon name="plus" size={11} /> {t('Añadir lugar')}
        </button>
      </div>

      <p className="mb-2 text-[11px] text-neutral-500">
        {t('Registra los lugares de esta persona (municipio, estado, país). Construyen su mapa individual y alimentan el mapa general.')}
      </p>

      {adding && (
        <AddPersonPlace
          personId={personId}
          onSaved={async () => {
            setAdding(false);
            await load();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {places.length === 0 ? (
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

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onCancel(); }}>
      <section className="card-modal w-full max-w-lg p-5" role="dialog" aria-modal="true" aria-labelledby="person-place-modal-title">
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 id="person-place-modal-title" className="text-base font-semibold text-neutral-100">{t('Nuevo lugar')}</h3>
            <p className="mt-1 text-xs text-neutral-500">{t('Busca un lugar y registra su relación con esta persona.')}</p>
          </div>
          <button className="btn btn-ghost h-8 w-8 shrink-0 p-0 text-neutral-400" aria-label={t('Cerrar')} disabled={saving} onClick={onCancel}><Icon name="x" size={15} /></button>
        </div>
        <div className="space-y-3">
          {!picked ? (
            <PlacePicker autoFocus onPick={setPicked} />
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900/50 px-2 py-1.5 text-sm">
              <Icon name="map" size={14} className="shrink-0 text-amber-400" />
              <span className="min-w-0 flex-1">
                <span className="truncate text-neutral-100">{picked.name}</span>
                <span className="text-neutral-500"> · {[picked.admin1, picked.country].filter(Boolean).join(', ')}</span>
              </span>
              <button className="btn btn-ghost h-7 px-2 text-[11px]" onClick={() => setPicked(null)}>{t('Cambiar')}</button>
            </div>
          )}

          {picked && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <select className="input h-9 text-sm" value={label} onChange={(event) => setLabel(event.target.value)}>
                  {PLACE_LABELS.map((placeLabel) => (
                    <option key={placeLabel} value={placeLabel}>{t(PLACE_LABEL_ES[placeLabel])}</option>
                  ))}
                </select>
                <input
                  className="input h-9 text-sm"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  placeholder={t('Fecha (puede ser incierta: «c. 1850»)')}
                />
              </div>
              <input className="input h-9 w-full text-sm" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t('Notas')} />
            </>
          )}
          <div className="flex justify-end gap-2 border-t border-neutral-800 pt-3">
            <button className="btn btn-ghost border border-neutral-700 px-3 text-xs" onClick={onCancel} disabled={saving}>{t('Cancelar')}</button>
            <button className="btn btn-primary min-w-32" disabled={saving || !picked} onClick={() => void save()}>{saving ? t('Guardando…') : t('Guardar lugar')}</button>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}
