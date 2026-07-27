import { useMemo } from 'react';
import type { Character, CharacterLifeStatus } from '@shared/types';
import {
  CHARACTER_LIFE_STATUSES,
  CHARACTER_LIFE_STATUS_LABEL,
  CHARACTER_ROLES,
  CHARACTER_ROLE_LABEL,
  characterEpithet,
} from '@shared/characterLabels';
import type { WorldSectionDef } from '../components/world/WorldWorkspace';
import { WorldWorkspace } from '../components/world/WorldWorkspace';
import { CharacterPortrait } from '../components/CharacterPortrait';
import { CharacterDossier } from '../components/CharacterDossier';
import { NewCharacterModal } from '../components/NewCharacterModal';
import { t, tx } from '../i18n';

/** Statuses that read as "no longer walking around", dimmed in the grid. */
const FADED_STATUSES = new Set<CharacterLifeStatus>(['dead', 'missing']);

/**
 * The cast of a world.
 *
 * Nothing but a section descriptor now: the browsing shell, the search, the facet bar and
 * the selection handling all live in {@link WorldWorkspace}, which Lugares, Facciones and
 * Culturas reuse. What stays here is the part that is genuinely about characters — how a
 * card looks, what you can filter them by, and which sheet opens.
 */
const CHARACTERS_SECTION: WorldSectionDef<Character> = {
  id: 'characters',
  icon: 'users',
  title: 'Personajes',
  searchPlaceholder: 'Buscar por nombre, apodo o epíteto…',
  createLabel: 'Nuevo personaje',
  emptyLabel: 'Todavía no hay personajes en este mundo.',
  noMatchLabel: 'Ningún personaje coincide con el filtro.',
  presentation: 'grid',
  load: () => window.nodus.listCharacters(),
  idOf: (character) => character.personId,
  facets: [
    {
      id: 'role',
      label: 'Rol narrativo',
      source: 'vocabulary',
      vocabulary: CHARACTER_ROLES.map((role) => ({ id: role, label: CHARACTER_ROLE_LABEL[role] })),
    },
    {
      id: 'status',
      label: 'Estado',
      source: 'vocabulary',
      vocabulary: CHARACTER_LIFE_STATUSES.map((status) => ({
        id: status,
        label: CHARACTER_LIFE_STATUS_LABEL[status],
      })),
    },
    // Free-text dimensions come from the vault itself: a world with three species must
    // not be offered a list of thirty.
    { id: 'species', label: 'Especie', source: 'distinct' },
    // A character can belong to several factions at once, so these are multi-valued: the
    // filter matches if ANY of their memberships is selected.
    { id: 'faction', label: 'Facción', source: 'distinct', multiValue: true },
    { id: 'culture', label: 'Cultura', source: 'distinct', multiValue: true },
  ],
  facetValues: (character) => ({
    role: character.profile.narrativeRole,
    status: character.profile.lifeStatus,
    species: character.profile.species,
    faction: character.factions ?? [],
    culture: character.cultures ?? [],
  }),
  // Aliases are searched too, which is how "cuervo" finds a character named Kaelen.
  searchText: (character) => [character.displayName, ...character.names.map((entry) => entry.name)],
  Card: CharacterCard,
  Sheet: ({ item, onChanged, onBack }) => (
    <CharacterDossier character={item} onChanged={onChanged} onBack={onBack} />
  ),
};

export function CharactersView() {
  const section = useMemo(() => CHARACTERS_SECTION, []);
  return (
    <WorldWorkspace
      section={section}
      createModal={(close, created) => <NewCharacterModal onClose={close} onCreated={created} />}
    />
  );
}

function CharacterCard({ item, compact, onOpen }: { item: Character; compact: boolean; onOpen: () => void }) {
  const { profile } = item;
  const epithet = characterEpithet(item.names);
  const faded = FADED_STATUSES.has(profile.lifeStatus);
  return (
    <button
      data-testid="character-card"
      onClick={onOpen}
      title={item.displayName}
      className="group w-full overflow-hidden rounded-lg border border-neutral-800 text-left transition-colors hover:border-indigo-700/60 hover:bg-indigo-950/20"
    >
      <div className="relative">
        <CharacterPortrait
          character={item}
          placeholderSize={compact ? 60 : 110}
          className={faded ? 'opacity-60' : ''}
        />
        {profile.narrativeRole && !compact && (
          <span className="absolute right-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-200">
            {t(CHARACTER_ROLE_LABEL[profile.narrativeRole])}
          </span>
        )}
      </div>
      <div className={compact ? 'p-1.5' : 'p-2'}>
        <span className="block truncate text-sm font-medium text-neutral-100">{item.displayName}</span>
        <span className="block truncate text-[11px] text-neutral-500">
          {epithet ?? t(CHARACTER_LIFE_STATUS_LABEL[profile.lifeStatus])}
        </span>
        {!compact && (profile.species || item.birthDate) && (
          <span className="mt-0.5 block truncate text-[10px] text-neutral-600">
            {[profile.species, item.birthDate].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
    </button>
  );
}

export { CharacterCard };

/** Reused by the dossier header to describe a character in one line. */
export function characterSubtitle(character: Character): string {
  const { profile } = character;
  const parts = [
    profile.species,
    profile.pronouns,
    profile.lifeStatus !== 'unknown' ? t(CHARACTER_LIFE_STATUS_LABEL[profile.lifeStatus]) : null,
  ].filter(Boolean) as string[];
  const span =
    character.birthDate && character.deathDate
      ? `${character.birthDate} – ${character.deathDate}`
      : character.birthDate
        ? tx('n. {date}', { date: character.birthDate })
        : character.deathDate
          ? tx('†︎ {date}', { date: character.deathDate })
          : null;
  if (span) parts.push(span);
  return parts.join(' · ');
}
