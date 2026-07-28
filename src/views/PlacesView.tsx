import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CharacterImage, WorldPlace } from '@shared/types';
import { checkPlaceScale, placeKind, placeKindGroups, suggestedChildKind, wouldCycle } from '@shared/placeKinds';
import { CHARACTER_IMAGE_KIND_LABEL } from '@shared/characterLabels';
import type { WorldSectionDef } from '../components/world/WorldWorkspace';
import { WorldWorkspace } from '../components/world/WorldWorkspace';
import { WorldGallery } from '../components/world/WorldGallery';
import { ImageLightbox, type ImageLightboxItem } from '../components/ImageLightbox';
import { AutoSavingField } from '../components/AutoSavingField';
import { Icon } from '../components/ui';
import { confirm } from '../components/feedback';
import { PERSON_DOSSIER_SECTION_CLASS } from '../components/personDossierLayout';
import { ContinuityBadge } from '../components/world/ContinuityBadge';
import { t, tx } from '../i18n';
import { worldImageUrl } from '../lib/imageUrl';

/**
 * The places of a world.
 *
 * A TREE rather than a grid, because a place is defined by what contains it: a flat list
 * of two hundred places is unusable, while "Vael → Alcázar → Cocinas" is how the author
 * already thinks about them.
 */
const PLACES_SECTION: WorldSectionDef<WorldPlace> = {
  id: 'places',
  icon: 'map',
  title: 'Lugares',
  searchPlaceholder: 'Buscar lugares…',
  createLabel: 'Nuevo lugar',
  emptyLabel: 'Todavía no hay lugares en este mundo.',
  noMatchLabel: 'Ningún lugar coincide con el filtro.',
  presentation: 'tree',
  load: () => window.nodus.listWorldPlaces(),
  idOf: (place) => place.placeId,
  anchorOf: (place) => ({ kind: 'place', id: place.placeId, title: place.name }),
  parentOf: (place) => place.parentId,
  labelOf: (place) => place.name,
  facets: [
    {
      id: 'kind',
      label: 'Tipo de lugar',
      source: 'vocabulary',
      vocabulary: placeKindGroups().flatMap((group) => group.kinds.map((kind) => ({ id: kind.id, label: kind.label }))),
    },
  ],
  facetValues: (place) => ({ kind: place.kind }),
  searchText: (place) => [place.name, place.notes ?? ''],
  Card: ({ item, onOpen }) => (
    <button className="w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-neutral-800/60" onClick={onOpen}>
      {item.name}
    </button>
  ),
  Sheet: ({ item, onChanged, onBack }) => <PlaceSheet place={item} onChanged={onChanged} onBack={onBack} />,
};

export function PlacesView() {
  const section = useMemo(() => PLACES_SECTION, []);
  return (
    <WorldWorkspace
      section={section}
      createModal={(close, created) => <NewPlaceModal onClose={close} onCreated={created} />}
    />
  );
}

function PlaceSheet({
  place,
  onChanged,
  onBack,
}: {
  place: WorldPlace;
  onChanged: () => Promise<void>;
  onBack: () => void;
}) {
  const [places, setPlaces] = useState<WorldPlace[]>([]);
  const [inhabitants, setInhabitants] = useState<{ personId: string; displayName: string; role: string | null }[]>([]);
  const [images, setImages] = useState<CharacterImage[]>([]);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    void window.nodus.listWorldPlaces().then(setPlaces);
    void window.nodus.placeInhabitants(place.placeId).then(setInhabitants);
  }, [place.placeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const parent = places.find((entry) => entry.placeId === place.parentId) ?? null;
  const scaleWarning = checkPlaceScale(place.kind, parent?.kind);
  const parentOf = (id: string) => places.find((entry) => entry.placeId === id)?.parentId ?? null;
  const cover = images[0] ?? null;
  const lightboxItems = useMemo<ImageLightboxItem[]>(
    () => images.map((image) => ({
      id: image.imageId,
      src: worldImageUrl(image),
      alt: image.label ? `${place.name} · ${image.label}` : place.name,
      label: image.label ?? t(CHARACTER_IMAGE_KIND_LABEL[image.kind]),
      meta: image.generated ? 'IA' : null,
    })),
    [images, place.name]
  );

  const save = async (patch: Parameters<typeof window.nodus.updateWorldPlace>[1]) => {
    await window.nodus.updateWorldPlace(place.placeId, patch);
    await onChanged();
    await load();
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('Eliminar lugar'),
      message: t('¿Eliminar este lugar? Los lugares que contiene NO se borran: pasan a estar sueltos.'),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    await window.nodus.deleteWorldPlace(place.placeId);
    onBack();
    await onChanged();
  };

  return (
    <div className="space-y-5 p-6">
      {cover && (
        <button
          type="button"
          data-testid="place-cover"
          className="group relative block aspect-[21/8] max-h-72 min-h-40 w-full overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 text-left shadow-lg"
          title={t('Ver detalles')}
          aria-label={t('Ver detalles')}
          onClick={() => setViewingId(cover.imageId)}
        >
          <img
            src={worldImageUrl(cover)}
            alt={place.name}
            draggable={false}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.015]"
          />
          <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
          <span className="pointer-events-none absolute bottom-3 right-3 grid h-9 w-9 place-items-center rounded-full bg-black/65 text-white shadow ring-1 ring-white/15">
            <Icon name="fit" size={16} />
          </span>
        </button>
      )}

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <button className="mb-2 flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200" onClick={onBack}>
            <Icon name="chevronLeft" size={13} /> {t('Volver a los lugares')}
          </button>
          <h2 className="text-xl font-semibold">{place.name}</h2>
          <p className="text-sm text-neutral-400">
            {[placeKind(place.kind)?.label ? t(placeKind(place.kind)!.label) : null, parent?.name]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <button
          className="btn btn-ghost h-8 w-8 p-0 text-red-300 hover:text-red-200"
          title={t('Eliminar lugar')}
          onClick={() => void remove()}
        >
          <Icon name="trash" size={15} />
        </button>
      </div>

      {/* A warning, never a rule: a world may well have a tavern whose cellar holds a
          whole plane, and that is a decision rather than a slip. */}
      {scaleWarning && (
        <p
          data-testid="place-scale-warning"
          className="rounded-md border border-amber-900/60 bg-amber-950/15 p-2.5 text-sm text-amber-300"
        >
          {tx(scaleWarning.message, {
            child: t(scaleWarning.values.child),
            parent: t(scaleWarning.values.parent),
          })}
        </p>
      )}

      <WorldGallery
        entityKind="place"
        entityId={place.placeId}
        visualSeed={place.profile.visualSeed}
        appearance={place.profile.appearance}
        onImagesChange={setImages}
      />

      <ContinuityBadge entity={{ kind: 'place', id: place.placeId }} />

      <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="place-sheet-basics">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Clasificación')}</h3>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Tipo de lugar')}</span>
            <select
              className="input h-9 w-full text-sm"
              value={place.kind ?? ''}
              onChange={(event) => void save({ kind: event.target.value || null })}
            >
              <option value="">{t('Sin tipo')}</option>
              {placeKindGroups().map((group) => (
                <optgroup key={group.group} label={t(group.group)}>
                  {group.kinds.map((kind) => (
                    <option key={kind.id} value={kind.id}>
                      {t(kind.label)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Dentro de')}</span>
            <select
              className="input h-9 w-full text-sm"
              value={place.parentId ?? ''}
              onChange={(event) => void save({ parentId: event.target.value || null })}
            >
              <option value="">{t('Suelto')}</option>
              {places
                // A place cannot contain itself or any of its own descendants; offering
                // those at all would let the author pick something the write then refuses.
                .filter((entry) => entry.placeId !== place.placeId && !wouldCycle(entry.placeId, place.placeId, parentOf))
                .map((entry) => (
                  <option key={entry.placeId} value={entry.placeId}>
                    {entry.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </section>

      <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="place-sheet-description">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Descripción')}</h3>
        <div className="space-y-3">
          <AutoSavingField
            label={t('Apariencia')}
            hint={t('Lo que se ve. Es lo único que alimenta la generación de imágenes.')}
            value={place.profile.appearance}
            placeholder={t('Arquitectura, materiales, colores, cómo se llega…')}
            field="appearance"
            onSave={(next) => save({ appearance: next || null })}
          />
          <AutoSavingField
            label={t('Atmósfera')}
            hint={t('Cómo se siente estar ahí.')}
            value={place.profile.atmosphere}
            placeholder={t('Ruidos, olores, quién anda por la calle, qué se teme…')}
            field="atmosphere"
            onSave={(next) => save({ atmosphere: next || null })}
          />
          <AutoSavingField
            label={t('Historia')}
            hint={t('Qué ha pasado aquí antes del relato.')}
            value={place.profile.history}
            placeholder={t('Fundación, guerras, quién lo gobernó…')}
            field="history"
            onSave={(next) => save({ history: next || null })}
          />
          <AutoSavingField
            label={t('Semilla visual')}
            hint={t('Lo que se añade a todas las imágenes para que el lugar se parezca a sí mismo.')}
            value={place.profile.visualSeed}
            placeholder={t('p. ej. «ciudad portuaria de piedra gris, tejados de pizarra, niebla»')}
            rows={2}
            onSave={(next) => save({ visualSeed: next || null })}
          />
        </div>
      </section>

      <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="place-sheet-inhabitants">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t('Quién está aquí')} <span className="text-neutral-600">({inhabitants.length})</span>
        </h3>
        {inhabitants.length === 0 ? (
          <p className="text-sm text-neutral-500">
            {t('Nadie por ahora. Se añaden desde la ficha del personaje, en sus lugares.')}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {inhabitants.map((entry) => (
              <li key={entry.personId} className="rounded-full bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300">
                {entry.displayName}
                {entry.role ? <span className="text-neutral-500"> · {t(entry.role)}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {viewingId && (
        <ImageLightbox
          items={lightboxItems}
          activeId={viewingId}
          onClose={() => setViewingId(null)}
        />
      )}
    </div>
  );
}

function NewPlaceModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [kind, setKind] = useState('');
  const [places, setPlaces] = useState<WorldPlace[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void window.nodus.listWorldPlaces().then(setPlaces);
  }, []);

  // Creating inside a City suggests a District: one step down the containment scale.
  const parentKind = places.find((entry) => entry.placeId === parentId)?.kind ?? null;
  useEffect(() => {
    const suggestion = suggestedChildKind(parentKind);
    if (suggestion) setKind(suggestion);
  }, [parentKind]);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const created = await window.nodus.createWorldPlace({
        name: name.trim(),
        kind: kind || null,
        parentId: parentId || null,
      });
      await onCreated(created.placeId);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section className="card-modal w-full max-w-lg p-5" role="dialog" aria-modal="true" aria-labelledby="new-place-title">
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 id="new-place-title" className="text-base font-semibold text-neutral-100">
              {t('Nuevo lugar')}
            </h3>
            <p className="mt-1 text-xs text-neutral-500">
              {t('Con el nombre basta. El tipo se sugiere a partir de dónde lo pongas.')}
            </p>
          </div>
          <button
            className="btn btn-ghost h-8 w-8 shrink-0 p-0 text-neutral-400"
            aria-label={t('Cerrar')}
            disabled={saving}
            onClick={onClose}
          >
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="space-y-3">
          <input
            className="input h-9 w-full text-sm"
            placeholder={t('Nombre del lugar')}
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void save()}
          />
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Dentro de')}</span>
            <select className="input h-9 w-full text-sm" value={parentId} onChange={(event) => setParentId(event.target.value)}>
              <option value="">{t('Suelto')}</option>
              {places.map((entry) => (
                <option key={entry.placeId} value={entry.placeId}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Tipo de lugar')}</span>
            <select className="input h-9 w-full text-sm" value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="">{t('Sin tipo')}</option>
              {placeKindGroups().map((group) => (
                <optgroup key={group.group} label={t(group.group)}>
                  {group.kinds.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {t(entry.label)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="flex justify-end gap-2 border-t border-neutral-800 pt-3">
            <button className="btn btn-ghost border border-neutral-700 px-3 text-xs" onClick={onClose} disabled={saving}>
              {t('Cancelar')}
            </button>
            <button className="btn btn-primary min-w-32" disabled={saving || !name.trim()} onClick={() => void save()}>
              {saving ? t('Creando…') : t('Crear lugar')}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}
