import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SceneAppearance, WorldPlace, WorldScene, WorldSceneStatus, WorldSecret } from '@shared/types';
import type { WorldSectionDef } from '../components/world/WorldWorkspace';
import { WorldWorkspace } from '../components/world/WorldWorkspace';
import { AutoSavingField } from '../components/AutoSavingField';
import { Icon } from '../components/ui';
import { confirm } from '../components/feedback';
import { PERSON_DOSSIER_SECTION_CLASS } from '../components/personDossierLayout';
import { SceneDayChain } from '../components/world/SceneDayChain';
import { SceneThreadsPanel } from '../components/world/SceneThreadsPanel';
import { RulesInPlay } from '../components/world/RulesInPlay';
import { ContinuityBadge } from '../components/world/ContinuityBadge';
import { t, tx } from '../i18n';

const SCENE_STATUS_LABEL: Record<WorldSceneStatus, string> = {
  outline: 'Esbozo',
  draft: 'Borrador',
  written: 'Escrita',
};

const SCENE_STATUSES: WorldSceneStatus[] = ['outline', 'draft', 'written'];

/**
 * Scenes: the unit a writer actually works in.
 *
 * Listed in NARRATIVE order by default — the manuscript's order, the one you read in. The
 * chronological order is a separate toggle rather than a sort option, because for a story
 * with flashbacks the two are genuinely different lists and switching between them is the
 * point, not a preference.
 */
const SCENES_SECTION: WorldSectionDef<WorldScene> = {
  id: 'scenes',
  icon: 'image',
  title: 'Escenas',
  searchPlaceholder: 'Buscar escenas…',
  createLabel: 'Nueva escena',
  emptyLabel: 'Todavía no hay escenas en este mundo.',
  noMatchLabel: 'Ninguna escena coincide con el filtro.',
  presentation: 'list',
  load: () => window.nodus.listScenes('narrative'),
  idOf: (scene) => scene.sceneId,
  facets: [
    {
      id: 'status',
      label: 'Estado',
      source: 'vocabulary',
      vocabulary: SCENE_STATUSES.map((status) => ({ id: status, label: SCENE_STATUS_LABEL[status] })),
    },
    { id: 'place', label: 'Lugar', source: 'distinct' },
  ],
  facetValues: (scene) => ({ status: scene.status, place: scene.placeName }),
  searchText: (scene) => [scene.title, scene.summary ?? ''],
  Card: ({ item, onOpen }) => (
    <button
      data-testid="scene-card"
      onClick={onOpen}
      className="w-full rounded-md border border-neutral-800 px-3 py-2 text-left transition-colors hover:border-indigo-700/60 hover:bg-indigo-950/20"
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-neutral-100">{item.title}</span>
        <span className="shrink-0 rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] uppercase text-neutral-400">
          {t(SCENE_STATUS_LABEL[item.status])}
        </span>
      </span>
      {(item.placeName || item.worldYear != null) && (
        <span className="mt-0.5 block truncate text-[11px] text-neutral-500">
          {[item.worldYear != null ? String(item.worldYear) : null, item.placeName].filter(Boolean).join(' · ')}
        </span>
      )}
    </button>
  ),
  Sheet: ({ item, onChanged, onBack }) => <SceneSheet scene={item} onChanged={onChanged} onBack={onBack} />,
};

export function ScenesView() {
  const section = useMemo(() => SCENES_SECTION, []);
  return (
    <WorldWorkspace
      section={section}
      createModal={(close, created) => <NewSceneModal onClose={close} onCreated={created} />}
    />
  );
}

function SceneSheet({
  scene,
  onChanged,
  onBack,
}: {
  scene: WorldScene;
  onChanged: () => Promise<void>;
  onBack: () => void;
}) {
  const [cast, setCast] = useState<SceneAppearance[]>([]);
  const [places, setPlaces] = useState<WorldPlace[]>([]);
  const [people, setPeople] = useState<{ personId: string; displayName: string }[]>([]);
  const [adding, setAdding] = useState('');

  const load = useCallback(async () => {
    setCast(await window.nodus.listSceneCharacters(scene.sceneId));
    setPlaces(await window.nodus.listWorldPlaces());
    setPeople((await window.nodus.listCharacters()).map((c) => ({ personId: c.personId, displayName: c.displayName })));
  }, [scene.sceneId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: Parameters<typeof window.nodus.updateScene>[1]) => {
    await window.nodus.updateScene(scene.sceneId, patch);
    await onChanged();
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('Eliminar escena'),
      message: t('¿Eliminar esta escena? Los personajes que aparecen en ella NO se borran.'),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    await window.nodus.deleteScene(scene.sceneId);
    onBack();
    await onChanged();
  };

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <button className="mb-2 flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200" onClick={onBack}>
            <Icon name="chevronLeft" size={13} /> {t('Volver a las escenas')}
          </button>
          <h2 className="text-xl font-semibold">{scene.title}</h2>
        </div>
        <button className="btn btn-ghost h-8 w-8 p-0 text-red-300 hover:text-red-200" title={t('Eliminar escena')} onClick={() => void remove()}>
          <Icon name="trash" size={15} />
        </button>
      </div>

      <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="scene-sheet-basics">
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Estado')}</span>
            <select
              className="input h-9 w-full text-sm"
              value={scene.status}
              onChange={(event) => void save({ status: event.target.value as WorldSceneStatus })}
            >
              {SCENE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(SCENE_STATUS_LABEL[status])}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Lugar')}</span>
            <select
              className="input h-9 w-full text-sm"
              value={scene.placeId ?? ''}
              onChange={(event) => void save({ placeId: event.target.value || null })}
            >
              <option value="">{t('Sin lugar')}</option>
              {places.map((place) => (
                <option key={place.placeId} value={place.placeId}>
                  {place.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Año del mundo')}</span>
            <input
              className="input h-9 w-full text-sm"
              type="number"
              value={scene.worldYear ?? ''}
              onChange={(event) => void save({ worldYear: event.target.value === '' ? null : Number(event.target.value) })}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Orden en el relato')}</span>
            <input
              className="input h-9 w-full text-sm"
              type="number"
              value={scene.narrativeOrder}
              onChange={(event) => void save({ narrativeOrder: Number(event.target.value) || 0 })}
            />
          </label>
        </div>
        <div className="mt-3">
          <SceneDayChain scene={scene} onChanged={onChanged} />
        </div>
        {/* The two orders are independent on purpose; saying so here is cheaper than
            letting an author discover it by filing a prologue wrong. */}
        <p className="mt-2 text-[10px] leading-4 text-neutral-600">
          {t('El año es cuándo ocurre en el mundo; el orden es dónde va en el relato. Un prólogo ambientado siglos antes va primero en el relato y último en la cronología.')}
        </p>
      </section>

      <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="scene-sheet-summary">
        <AutoSavingField
          label={t('Qué pasa')}
          hint={t('Lo que ocurre en la escena, en tus palabras.')}
          value={scene.summary}
          placeholder={t('Quién quiere qué, quién se lo impide y cómo acaba…')}
          onSave={(next) => save({ summary: next || null })}
        />
      </section>

      <ContinuityBadge entity={{ kind: 'scene', id: scene.sceneId }} />

      {/* Placed right after the cast, and before it on purpose in the reading order of
          the work: you decide who is in the room, and then what it costs them. */}
      <section className={PERSON_DOSSIER_SECTION_CLASS}>
        <SceneThreadsPanel scene={scene} cast={cast} onChanged={onChanged} />
      </section>

      <section className={PERSON_DOSSIER_SECTION_CLASS}>
        <RulesInPlay scene={scene} onChanged={onChanged} />
      </section>

      <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="scene-sheet-cast">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t('Quién aparece')} <span className="text-neutral-600">({cast.length})</span>
        </h3>
        {people.length === 0 ? (
          <p className="text-sm text-neutral-500">{t('Crea antes algún personaje.')}</p>
        ) : (
          <div className="mb-2 flex gap-2">
            <select
              className="input h-8 min-w-40 flex-1 text-xs"
              value={adding}
              aria-label={t('Añadir personaje a la escena')}
              onChange={(event) => setAdding(event.target.value)}
            >
              <option value="">{t('Elegir…')}</option>
              {people
                .filter((person) => !cast.some((entry) => entry.personId === person.personId))
                .map((person) => (
                  <option key={person.personId} value={person.personId}>
                    {person.displayName}
                  </option>
                ))}
            </select>
            <button
              className="btn btn-primary h-8 text-xs"
              disabled={!adding}
              onClick={async () => {
                await window.nodus.addSceneCharacter(scene.sceneId, adding);
                setAdding('');
                await load();
              }}
            >
              {t('Añadir')}
            </button>
          </div>
        )}
        {cast.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {cast.map((entry) => (
              <li key={entry.id} className="group flex items-center gap-1.5 rounded-full bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300">
                {entry.personName}
                <button
                  className="opacity-0 transition-opacity hover:text-red-300 group-hover:opacity-100"
                  title={t('Quitar')}
                  aria-label={tx('Quitar {name}', { name: entry.personName })}
                  onClick={async () => {
                    await window.nodus.removeSceneCharacter(entry.id);
                    await load();
                  }}
                >
                  <Icon name="x" size={10} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function NewSceneModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const created = await window.nodus.createScene({ title: title.trim() });
      await onCreated(created.sceneId);
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
      <section className="card-modal w-full max-w-lg p-5" role="dialog" aria-modal="true" aria-labelledby="new-scene-title">
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 id="new-scene-title" className="text-base font-semibold text-neutral-100">
              {t('Nueva escena')}
            </h3>
            <p className="mt-1 text-xs text-neutral-500">{t('Se añade al final del relato; puedes moverla después.')}</p>
          </div>
          <button className="btn btn-ghost h-8 w-8 shrink-0 p-0 text-neutral-400" aria-label={t('Cerrar')} disabled={saving} onClick={onClose}>
            <Icon name="x" size={15} />
          </button>
        </div>
        <input
          className="input h-9 w-full text-sm"
          placeholder={t('Título de la escena')}
          value={title}
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void save()}
        />
        <div className="mt-4 flex justify-end gap-2 border-t border-neutral-800 pt-3">
          <button className="btn btn-ghost border border-neutral-700 px-3 text-xs" onClick={onClose} disabled={saving}>
            {t('Cancelar')}
          </button>
          <button className="btn btn-primary min-w-32" disabled={saving || !title.trim()} onClick={() => void save()}>
            {saving ? t('Creando…') : t('Crear escena')}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}

/** The scenes a character shows up in, in narrative order. */
export function CharacterAppearancesSection({ personId }: { personId: string }) {
  const [appearances, setAppearances] = useState<SceneAppearance[]>([]);

  useEffect(() => {
    void window.nodus.appearancesOfCharacter(personId).then(setAppearances);
  }, [personId]);

  if (appearances.length === 0) return null;

  return (
    <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="character-dossier-appearances">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {t('Apariciones')} <span className="text-neutral-600">({appearances.length})</span>
      </h3>
      <ol className="space-y-1">
        {appearances.map((entry) => (
          <li key={entry.id} className="flex items-baseline gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate text-neutral-200">{entry.sceneTitle}</span>
            {entry.role && <span className="shrink-0 text-[11px] text-neutral-500">{entry.role}</span>}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[10px] text-neutral-600">{t('En orden del relato, no de la cronología.')}</p>
    </section>
  );
}

/** What a character hides, and what they merely know. */
export function CharacterSecretsSection({ personId }: { personId: string }) {
  const [owned, setOwned] = useState<WorldSecret[]>([]);
  const [known, setKnown] = useState<WorldSecret[]>([]);
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const result = await window.nodus.secretsForCharacter(personId);
    setOwned(result.owned);
    setKnown(result.known);
  }, [personId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!title.trim()) return;
    const created = await window.nodus.createSecret({ title: title.trim(), ownerPersonId: personId });
    // The owner is a knower by definition; not adding them here would make "who knew this
    // at day X" answer wrong from the very first day. Uses the id the create call returned
    // rather than re-listing: listSecrets() is ordered oldest-first, so [0] is the wrong
    // secret entirely.
    await window.nodus.addKnower({ secretId: created.secretId, personId });
    setTitle('');
    setAdding(false);
    await load();
  };

  return (
    <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="character-dossier-secrets">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t('Secretos')} <span className="text-neutral-600">({owned.length + known.length})</span>
        </h3>
        <button
          className="btn btn-ghost ml-auto h-8 w-8 shrink-0 justify-center border border-neutral-700 p-0"
          title={t('Añadir')}
          aria-label={t('Añadir secreto')}
          onClick={() => setAdding((value) => !value)}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>

      {adding && (
        <div className="mb-2 flex gap-2">
          <input
            className="input h-8 flex-1 text-xs"
            placeholder={t('Qué esconde…')}
            aria-label={t('Qué esconde…')}
            value={title}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void add()}
          />
          <button className="btn btn-primary h-8 text-xs" disabled={!title.trim()} onClick={() => void add()}>
            {t('Añadir')}
          </button>
        </div>
      )}

      {owned.length === 0 && known.length === 0 && !adding && (
        <p className="text-sm text-neutral-500">{t('No esconde nada por ahora.')}</p>
      )}

      {owned.length > 0 && (
        <ul className="space-y-1.5">
          {owned.map((secret) => (
            <li key={secret.secretId} className="flex items-center gap-2 rounded-md border border-neutral-800 px-3 py-2 text-sm">
              <Icon name="lock" size={12} className="shrink-0 text-neutral-500" />
              <span className="min-w-0 flex-1 truncate text-neutral-200">{secret.title}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-neutral-600">
                {secret.status === 'revealed' ? t('Revelado') : t('Guardado')}
              </span>
              <button
                className="btn btn-ghost h-7 w-7 shrink-0 p-0 text-red-300 hover:text-red-200"
                title={t('Eliminar')}
                onClick={async () => {
                  await window.nodus.deleteSecret(secret.secretId);
                  await load();
                }}
              >
                <Icon name="trash" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {known.length > 0 && (
        <div className="mt-2">
          <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">
            {t('Además sabe')}
          </h4>
          <ul className="flex flex-wrap gap-1.5">
            {known.map((secret) => (
              <li key={secret.secretId} className="rounded-full bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300">
                {secret.title}
                {secret.ownerName ? <span className="text-neutral-500"> · {secret.ownerName}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
