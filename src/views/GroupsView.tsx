import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CharacterAffiliation, CharacterImage, WorldGroup, WorldGroupKind, WorldPlace } from '@shared/types';
import {
  CULTURE_KINDS,
  DYNASTY_KINDS,
  FACTION_KINDS,
  WORLD_GROUP_KIND_LABEL,
  WORLD_GROUP_STATUSES,
  WORLD_GROUP_STATUS_LABEL,
} from '@shared/characterLabels';
import type { WorldSectionDef } from '../components/world/WorldWorkspace';
import { WorldWorkspace } from '../components/world/WorldWorkspace';
import { WorldGallery } from '../components/world/WorldGallery';
import { AutoSavingField } from '../components/AutoSavingField';
import { Icon } from '../components/ui';
import { confirm } from '../components/feedback';
import { PERSON_DOSSIER_SECTION_CLASS } from '../components/personDossierLayout';
import { ContinuityBadge } from '../components/world/ContinuityBadge';
import { t, tx } from '../i18n';
import { worldImageThumbnailUrl } from '../lib/imageUrl';

/**
 * Factions, cultures and dynasties.
 *
 * They are ONE collection with a `kind` (schema v94), so this file builds both sections
 * from the same descriptor: the only differences are which kinds each offers and what it
 * is called. Adding "Religiones" as its own section later would cost a nav row.
 */
function groupSection(
  id: 'factions' | 'cultures' | 'dynasties',
  kinds: string[],
  labels: { title: string; create: string; search: string; empty: string; noMatch: string; icon: string },
  dynasty = false
): WorldSectionDef<WorldGroup> {
  return {
    id,
    icon: labels.icon,
    title: labels.title,
    searchPlaceholder: labels.search,
    createLabel: labels.create,
    emptyLabel: labels.empty,
    noMatchLabel: labels.noMatch,
    presentation: 'grid',
    // Loading everything and filtering here keeps ONE query behind both sections and
    // keeps the facet counts honest.
    load: async () => (await window.nodus.listWorldGroups()).filter((group) => kinds.includes(group.kind)),
    idOf: (group) => group.groupId,
    anchorOf: (group) => ({ kind: 'group', id: group.groupId, title: group.name }),
    facets: [
      {
        id: 'kind',
        label: 'Tipo',
        source: 'vocabulary',
        vocabulary: kinds.map((kind) => ({ id: kind, label: WORLD_GROUP_KIND_LABEL[kind] ?? kind })),
      },
      {
        id: 'status',
        label: 'Estado',
        source: 'vocabulary',
        vocabulary: WORLD_GROUP_STATUSES.map((status) => ({ id: status, label: WORLD_GROUP_STATUS_LABEL[status] })),
      },
    ],
    facetValues: (group) => ({ kind: group.kind, status: group.status }),
    searchText: (group) => [group.name, group.summary ?? ''],
    Card: ({ item, compact, onOpen }) => dynasty ? (
      <DynastyCard item={item} compact={compact} onOpen={onOpen} />
    ) : (
      <button
        data-testid="group-card"
        onClick={onOpen}
        title={item.name}
        className={`w-full rounded-lg border border-neutral-300 bg-white text-left shadow-sm transition-colors hover:border-violet-400 hover:bg-violet-50 dark:border-neutral-800 dark:bg-neutral-950/25 dark:shadow-none dark:hover:border-violet-700/60 dark:hover:bg-violet-950/20 ${
          compact ? 'h-20 p-2.5' : 'h-40 p-4'
        }`}
      >
        <span className="block truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{item.name}</span>
        <span className="block truncate text-[11px] text-neutral-500">
          {t(WORLD_GROUP_KIND_LABEL[item.kind] ?? item.kind)}
          {item.status ? ` · ${t(WORLD_GROUP_STATUS_LABEL[item.status])}` : ''}
        </span>
        {!compact && item.summary && (
          <span className="mt-2 line-clamp-2 block text-[11px] leading-4 text-neutral-600 dark:text-neutral-500">{item.summary}</span>
        )}
      </button>
    ),
    Sheet: ({ item, onChanged, onBack }) => (
      <GroupSheet group={item} kinds={kinds} dynasty={dynasty} onChanged={onChanged} onBack={onBack} />
    ),
  };
}

const FACTIONS = groupSection('factions', FACTION_KINDS, {
  icon: 'network',
  title: 'Facciones',
  create: 'Nueva facción',
  search: 'Buscar facciones…',
  empty: 'Todavía no hay facciones en este mundo.',
  noMatch: 'Ninguna facción coincide con el filtro.',
});

const CULTURES = groupSection('cultures', CULTURE_KINDS, {
  icon: 'languages',
  title: 'Culturas',
  create: 'Nueva cultura',
  search: 'Buscar culturas…',
  empty: 'Todavía no hay culturas en este mundo.',
  noMatch: 'Ninguna cultura coincide con el filtro.',
});

const DYNASTIES = groupSection('dynasties', DYNASTY_KINDS, {
  icon: 'shield',
  title: 'Dinastías',
  create: 'Nueva dinastía',
  search: 'Buscar dinastías…',
  empty: 'Todavía no hay dinastías en este mundo.',
  noMatch: 'Ninguna dinastía coincide con el filtro.',
}, true);

export function FactionsView() {
  const section = useMemo(() => FACTIONS, []);
  return (
    <WorldWorkspace
      section={section}
      createModal={(close, created) => (
        <NewGroupModal kinds={FACTION_KINDS} title="Nueva facción" onClose={close} onCreated={created} />
      )}
    />
  );
}

export function CulturesView() {
  const section = useMemo(() => CULTURES, []);
  return (
    <WorldWorkspace
      section={section}
      createModal={(close, created) => (
        <NewGroupModal kinds={CULTURE_KINDS} title="Nueva cultura" onClose={close} onCreated={created} />
      )}
    />
  );
}

export function DynastiesView() {
  const section = useMemo(() => DYNASTIES, []);
  return (
    <WorldWorkspace
      section={section}
      createModal={(close, created) => (
        <NewGroupModal kinds={DYNASTY_KINDS} title="Nueva dinastía" onClose={close} onCreated={created} />
      )}
    />
  );
}

function DynastyCard({ item, compact, onOpen }: { item: WorldGroup; compact: boolean; onOpen: () => void }) {
  const [emblem, setEmblem] = useState<CharacterImage | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.nodus.listWorldImages('group', item.groupId).then((images) => {
      if (!cancelled) setEmblem(images.find((image) => image.kind === 'emblem') ?? images[0] ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [item.groupId, item.updatedAt]);

  return (
    <button
      data-testid="dynasty-card"
      onClick={onOpen}
      title={item.name}
      className={`group w-full overflow-hidden rounded-xl border border-neutral-300 bg-white text-left shadow-sm transition-colors hover:border-amber-500 dark:border-neutral-800 dark:bg-neutral-950/25 dark:shadow-none dark:hover:border-amber-600 ${
        compact ? 'flex h-20' : 'h-60'
      }`}
    >
      <div className={compact ? 'h-full w-20 shrink-0 bg-neutral-100 dark:bg-neutral-900' : 'h-40 w-full bg-neutral-100 dark:bg-neutral-900'}>
        {emblem ? (
          <img src={worldImageThumbnailUrl(emblem)} alt="" draggable={false} className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
        ) : (
          <div className="grid h-full place-items-center">
            <Icon name="shield" size={compact ? 22 : 34} className="text-neutral-400 dark:text-neutral-600" />
          </div>
        )}
      </div>
      <div className={compact ? 'min-w-0 flex-1 p-3' : 'min-w-0 p-3'}>
        <span className="block truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{item.name}</span>
        <span className="block truncate text-[11px] text-neutral-500">
          {item.status ? t(WORLD_GROUP_STATUS_LABEL[item.status]) : t('Dinastía')}
          {item.foundedYear != null ? ` · ${item.foundedYear}` : ''}
        </span>
        {!compact && item.summary && <span className="mt-1 line-clamp-1 block text-[11px] text-neutral-600 dark:text-neutral-400">{item.summary}</span>}
      </div>
    </button>
  );
}

function GroupSheet({
  group,
  kinds,
  dynasty,
  onChanged,
  onBack,
}: {
  group: WorldGroup;
  kinds: string[];
  dynasty: boolean;
  onChanged: () => Promise<void>;
  onBack: () => void;
}) {
  const [members, setMembers] = useState<CharacterAffiliation[]>([]);
  const [groups, setGroups] = useState<WorldGroup[]>([]);
  const [places, setPlaces] = useState<WorldPlace[]>([]);

  useEffect(() => {
    void Promise.all([
      window.nodus.listAffiliationsForGroup(group.groupId),
      dynasty ? window.nodus.listWorldGroups('house') : Promise.resolve([]),
      dynasty ? window.nodus.listWorldPlaces() : Promise.resolve([]),
    ]).then(([nextMembers, nextGroups, nextPlaces]) => {
      setMembers(nextMembers);
      setGroups(nextGroups);
      setPlaces(nextPlaces);
    });
  }, [dynasty, group.groupId, group.updatedAt]);

  const save = async (patch: Parameters<typeof window.nodus.updateWorldGroup>[1]) => {
    await window.nodus.updateWorldGroup(group.groupId, patch);
    await onChanged();
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('Eliminar grupo'),
      message: t('¿Eliminar esto? Los personajes NO se borran: solo dejan de pertenecer.'),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    await window.nodus.deleteWorldGroup(group.groupId);
    onBack();
    await onChanged();
  };

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <button className="mb-2 flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200" onClick={onBack}>
            <Icon name="chevronLeft" size={13} /> {t('Volver')}
          </button>
          <h2 className="text-xl font-semibold">{group.name}</h2>
          <p className="text-sm text-neutral-400">
            {[
              t(WORLD_GROUP_KIND_LABEL[group.kind] ?? group.kind),
              group.status ? t(WORLD_GROUP_STATUS_LABEL[group.status]) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <button className="btn btn-ghost h-8 w-8 p-0 text-red-300 hover:text-red-200" title={t('Eliminar')} onClick={() => void remove()}>
          <Icon name="trash" size={15} />
        </button>
      </div>

      <WorldGallery
        entityKind="group"
        entityId={group.groupId}
        visualSeed={group.visualSeed}
        appearance={group.description}
        title={dynasty ? 'Blasón y galería' : 'Galería'}
        kinds={['emblem', 'other']}
        defaultKind="emblem"
        generateLabel={dynasty ? 'Generar blasón' : 'Generar imagen'}
      />

      <ContinuityBadge entity={{ kind: 'group', id: group.groupId }} />

      <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="group-sheet-basics">
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Tipo')}</span>
            <select
              className="input h-9 w-full text-sm"
              value={group.kind}
              onChange={(event) => void save({ kind: event.target.value as WorldGroupKind })}
            >
              {kinds.map((kind) => (
                <option key={kind} value={kind}>
                  {t(WORLD_GROUP_KIND_LABEL[kind] ?? kind)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Estado')}</span>
            <select
              className="input h-9 w-full text-sm"
              value={group.status ?? ''}
              onChange={(event) => void save({ status: (event.target.value || null) as WorldGroup['status'] })}
            >
              <option value="">{t('Sin especificar')}</option>
              {WORLD_GROUP_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(WORLD_GROUP_STATUS_LABEL[status])}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {dynasty && (
        <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="dynasty-sheet-lineage">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Linaje y dominio')}</h3>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Casa de origen')}</span>
              <select className="input h-9 w-full text-sm" value={group.parentId ?? ''} onChange={(event) => void save({ parentId: event.target.value || null })}>
                <option value="">{t('Sin casa de origen')}</option>
                {groups.filter((entry) => entry.groupId !== group.groupId).map((entry) => (
                  <option key={entry.groupId} value={entry.groupId}>{entry.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Sede')}</span>
              <select className="input h-9 w-full text-sm" value={group.seatPlaceId ?? ''} onChange={(event) => void save({ seatPlaceId: event.target.value || null })}>
                <option value="">{t('Sin sede')}</option>
                {places.map((place) => <option key={place.placeId} value={place.placeId}>{place.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Fundación')}</span>
              <input
                key={`founded-${group.updatedAt}`}
                type="number"
                className="input h-9 w-full text-sm"
                defaultValue={group.foundedYear ?? ''}
                onBlur={(event) => void save({ foundedYear: event.target.value ? Number(event.target.value) : null })}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Extinción')}</span>
              <input
                key={`ended-${group.updatedAt}`}
                type="number"
                className="input h-9 w-full text-sm"
                defaultValue={group.endedYear ?? ''}
                onBlur={(event) => void save({ endedYear: event.target.value ? Number(event.target.value) : null })}
              />
            </label>
          </div>
          <div className="mt-3">
            <AutoSavingField
              label={t('Notas dinásticas')}
              hint={t('Sucesión, ramas, reclamaciones, lemas y legitimidad.')}
              value={group.notes}
              placeholder={t('Herederos, ramas cadetes, disputas sucesorias…')}
              onSave={(next) => save({ notes: next || null })}
            />
          </div>
        </section>
      )}

      <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="group-sheet-description">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Descripción')}</h3>
        <div className="space-y-3">
          <AutoSavingField
            label={t('En una línea')}
            hint={t('Lo que dirías de esto en una frase.')}
            value={group.summary}
            placeholder={t('p. ej. «los espías de la corte, que ya no responden ante nadie»')}
            rows={2}
            field="summary"
            onSave={(next) => save({ summary: next || null })}
          />
          <AutoSavingField
            label={t('Descripción')}
            hint={t('Lo que se ve: emblemas, colores, vestimenta, arquitectura.')}
            value={group.description}
            placeholder={t('Símbolos, atuendo, cómo se reconoce a los suyos…')}
            field="description"
            onSave={(next) => save({ description: next || null })}
          />
          <AutoSavingField
            label={t('Semilla visual')}
            hint={t('Lo que se añade a todas las imágenes para que se parezcan entre sí.')}
            value={group.visualSeed}
            placeholder={t('p. ej. «heráldica de cuervo negro sobre campo gris, plata bruñida»')}
            rows={2}
            onSave={(next) => save({ visualSeed: next || null })}
          />
        </div>
      </section>

      <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="group-sheet-members">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t('Miembros')} <span className="text-neutral-600">({members.length})</span>
        </h3>
        {members.length === 0 ? (
          <p className="text-sm text-neutral-500">
            {t('Nadie por ahora. Se añaden desde la ficha del personaje, en sus pertenencias.')}
          </p>
        ) : (
          <ul className="space-y-1">
            {members.map((member) => (
              <li key={member.affiliationId} className="flex items-baseline gap-2 text-sm">
                <span className="text-neutral-200">{member.personName}</span>
                <span className="text-neutral-500">·</span>
                <span className="min-w-0 flex-1 truncate text-neutral-400">{member.rank ?? t('Miembro')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function NewGroupModal({
  kinds,
  title,
  onClose,
  onCreated,
}: {
  kinds: string[];
  title: string;
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState(kinds[0]);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const created = await window.nodus.createWorldGroup({
        name: name.trim(),
        kind: kind as WorldGroupKind,
        status: 'active',
      });
      await onCreated(created.groupId);
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
      <section className="card-modal w-full max-w-lg p-5" role="dialog" aria-modal="true" aria-labelledby="new-group-title">
        <div className="mb-4 flex items-start gap-3">
          <h3 id="new-group-title" className="min-w-0 flex-1 text-base font-semibold text-neutral-100">
            {t(title)}
          </h3>
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
            placeholder={t('Nombre')}
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void save()}
          />
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Tipo')}</span>
            <select className="input h-9 w-full text-sm" value={kind} onChange={(event) => setKind(event.target.value)}>
              {kinds.map((entry) => (
                <option key={entry} value={entry}>
                  {t(WORLD_GROUP_KIND_LABEL[entry] ?? entry)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-end gap-2 border-t border-neutral-800 pt-3">
            <button className="btn btn-ghost border border-neutral-700 px-3 text-xs" onClick={onClose} disabled={saving}>
              {t('Cancelar')}
            </button>
            <button className="btn btn-primary min-w-32" disabled={saving || !name.trim()} onClick={() => void save()}>
              {saving ? t('Creando…') : t('Crear')}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

/** The affiliations block on a character's sheet: which groups they belong to, and when. */
export function CharacterAffiliationsSection({ personId }: { personId: string }) {
  const [affiliations, setAffiliations] = useState<CharacterAffiliation[]>([]);
  const [groups, setGroups] = useState<WorldGroup[]>([]);
  const [adding, setAdding] = useState(false);
  const [groupId, setGroupId] = useState('');
  const [rank, setRank] = useState('');

  const load = async () => {
    setAffiliations(await window.nodus.listAffiliationsForCharacter(personId));
    setGroups(await window.nodus.listWorldGroups());
  };

  useEffect(() => {
    void load();
  }, [personId]);

  const add = async () => {
    if (!groupId) return;
    await window.nodus.addAffiliation({ personId, groupId, rank: rank.trim() || null });
    setRank('');
    setGroupId('');
    setAdding(false);
    await load();
  };

  return (
    <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="character-dossier-affiliations">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t('Pertenencias')} <span className="text-neutral-600">({affiliations.length})</span>
        </h3>
        <button
          className="btn btn-ghost ml-auto h-8 w-8 shrink-0 justify-center border border-neutral-700 p-0"
          title={t('Añadir')}
          aria-label={t('Añadir pertenencia')}
          disabled={groups.length === 0}
          onClick={() => setAdding((value) => !value)}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-neutral-500">{t('Crea antes una facción, una cultura o una dinastía.')}</p>
      ) : affiliations.length === 0 && !adding ? (
        <p className="text-sm text-neutral-500">{t('No pertenece a nada por ahora.')}</p>
      ) : null}

      {adding && groups.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          <select className="input h-8 min-w-40 flex-1 text-xs" value={groupId} aria-label={t('Grupo')} onChange={(event) => setGroupId(event.target.value)}>
            <option value="">{t('Elegir…')}</option>
            {groups.map((group) => (
              <option key={group.groupId} value={group.groupId}>
                {group.name} · {t(WORLD_GROUP_KIND_LABEL[group.kind] ?? group.kind)}
              </option>
            ))}
          </select>
          <input
            className="input h-8 w-32 text-xs"
            placeholder={t('Rango')}
            aria-label={t('Rango')}
            value={rank}
            onChange={(event) => setRank(event.target.value)}
          />
          <button className="btn btn-primary h-8 text-xs" disabled={!groupId} onClick={() => void add()}>
            {t('Añadir')}
          </button>
        </div>
      )}

      {affiliations.length > 0 && (
        <ul className="space-y-1.5">
          {affiliations.map((entry) => (
            <li key={entry.affiliationId} className="flex items-center gap-2 rounded-md border border-neutral-800 px-3 py-2 text-sm">
              <span className="font-medium text-neutral-200">{entry.groupName}</span>
              <span className="text-[10px] uppercase tracking-wide text-neutral-600">
                {t(WORLD_GROUP_KIND_LABEL[entry.groupKind] ?? entry.groupKind)}
              </span>
              {entry.rank && <span className="text-neutral-400">· {entry.rank}</span>}
              {(entry.fromWorldDay != null || entry.toWorldDay != null) && (
                <span className="text-[11px] text-neutral-600">
                  {tx('{from} → {to}', {
                    from: entry.fromWorldDay != null ? String(entry.fromWorldDay) : '…',
                    to: entry.toWorldDay != null ? String(entry.toWorldDay) : '…',
                  })}
                </span>
              )}
              <button
                className="btn btn-ghost ml-auto h-7 w-7 shrink-0 p-0 text-red-300 hover:text-red-200"
                title={t('Quitar')}
                onClick={async () => {
                  await window.nodus.deleteAffiliation(entry.affiliationId);
                  await load();
                }}
              >
                <Icon name="trash" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
