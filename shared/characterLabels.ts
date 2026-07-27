/**
 * Spanish labels and vocabularies for worldbuilding characters. Shared rather than
 * renderer-only (unlike src/components/personLabels.ts) because the AI prompts need
 * the same words the user sees — a biography that calls a character "secondary" when
 * the sheet says "secundario" reads as a different system talking.
 *
 * Every label here reaches the UI through `t(LABEL[x])`, i.e. INDIRECTLY, so this
 * file is registered in INDIRECT_KEY_SOURCES of scripts/test-i18n-coverage.mjs. Adding
 * an entry without registering it means its translation is missing in silence, which
 * is exactly how the genealogy vault shipped half-Spanish.
 */

import type {
  CharacterImageKind,
  CharacterLifeStatus,
  CharacterNarrativeRole,
  HistoricalEventType,
  PersonName,
  SocialRelationValence,
} from './types';

export const CHARACTER_LIFE_STATUS_LABEL: Record<CharacterLifeStatus, string> = {
  unknown: 'Sin determinar',
  alive: 'Vivo',
  dead: 'Muerto',
  missing: 'Desaparecido',
  undead: 'No muerto',
  immortal: 'Inmortal',
  unborn: 'Aún no nace',
};

export const CHARACTER_LIFE_STATUSES: CharacterLifeStatus[] = [
  'unknown',
  'alive',
  'dead',
  'missing',
  'undead',
  'immortal',
  'unborn',
];

export const CHARACTER_ROLE_LABEL: Record<CharacterNarrativeRole, string> = {
  protagonist: 'Protagonista',
  antagonist: 'Antagonista',
  secondary: 'Secundario',
  tertiary: 'Terciario',
  cameo: 'Mención',
};

export const CHARACTER_ROLES: CharacterNarrativeRole[] = [
  'protagonist',
  'antagonist',
  'secondary',
  'tertiary',
  'cameo',
];

/**
 * The event vocabulary a character sheet offers. Deliberately disjoint from the
 * genealogy one (baptism, census, burial…): both are stored in `events.type`, but
 * neither picker ever shows the other's words. `birth`, `death` and `other` are the
 * only ones the two vocabularies share.
 */
export const CHARACTER_EVENT_TYPES: HistoricalEventType[] = [
  'birth',
  'first_appearance',
  'oath',
  'bond',
  'journey',
  'battle',
  'betrayal',
  'revelation',
  'transformation',
  'ascension',
  'exile',
  'loss',
  'death',
  'other',
];

export const CHARACTER_EVENT_TYPE_LABEL: Record<string, string> = {
  birth: 'Nacimiento',
  first_appearance: 'Primera aparición',
  oath: 'Juramento',
  bond: 'Vínculo',
  journey: 'Viaje',
  battle: 'Batalla',
  betrayal: 'Traición',
  revelation: 'Revelación',
  transformation: 'Transformación',
  ascension: 'Ascenso',
  exile: 'Exilio',
  loss: 'Pérdida',
  death: 'Muerte',
  other: 'Otro',
};

/** Typed alias kinds, stored in `person_names.kind` (already free text). */
export const CHARACTER_NAME_KINDS: { id: string; label: string }[] = [
  { id: 'true_name', label: 'Nombre verdadero' },
  { id: 'birth_name', label: 'Nombre de nacimiento' },
  { id: 'epithet', label: 'Epíteto o título' },
  { id: 'nickname', label: 'Apodo' },
  { id: 'alias', label: 'Alias' },
  { id: 'foreign_name', label: 'Nombre en otra lengua' },
];

export const CHARACTER_NAME_KIND_LABEL: Record<string, string> = Object.fromEntries(
  CHARACTER_NAME_KINDS.map((kind) => [kind.id, kind.label])
);

/**
 * Tag colours for the card grid. Tokens, not hexes, so the palette can be restyled
 * once for light/dark instead of being baked into every row.
 */
export const CHARACTER_ACCENTS: { id: string; label: string; hex: string }[] = [
  { id: 'violet', label: 'Violeta', hex: '#7c3aed' },
  { id: 'crimson', label: 'Carmesí', hex: '#b30333' },
  { id: 'amber', label: 'Ámbar', hex: '#d97706' },
  { id: 'emerald', label: 'Esmeralda', hex: '#059669' },
  { id: 'sky', label: 'Cielo', hex: '#0284c7' },
  { id: 'rose', label: 'Rosa', hex: '#e11d48' },
  { id: 'slate', label: 'Pizarra', hex: '#64748b' },
  { id: 'gold', label: 'Oro', hex: '#ca8a04' },
];

const ACCENT_BY_ID = new Map(CHARACTER_ACCENTS.map((accent) => [accent.id, accent]));

/** The hex for an accent token; unknown/absent tokens have no colour at all. */
export function characterAccentHex(token: string | null | undefined): string | null {
  return token ? ACCENT_BY_ID.get(token)?.hex ?? null : null;
}

/** What a gallery image shows. Drives the framing hint sent to the image model. */
export const CHARACTER_IMAGE_KINDS: CharacterImageKind[] = [
  'portrait',
  'full_body',
  'expression',
  'age',
  'outfit',
  'other',
];

export const CHARACTER_IMAGE_KIND_LABEL: Record<CharacterImageKind, string> = {
  portrait: 'Retrato',
  full_body: 'Cuerpo entero',
  expression: 'Expresión',
  age: 'A otra edad',
  outfit: 'Atuendo',
  other: 'Otra',
};

/** The five story-structure prompts of a character arc, in the order they are asked. */
export const CHARACTER_ARC_FIELDS: { id: 'want' | 'need' | 'flaw' | 'lie' | 'wound'; label: string; hint: string }[] = [
  { id: 'want', label: 'Qué quiere', hint: 'El objetivo que persigue y que mueve la trama.' },
  { id: 'need', label: 'Qué necesita', hint: 'Lo que le hace falta de verdad, y que rara vez es lo que quiere.' },
  { id: 'flaw', label: 'Su defecto', hint: 'Lo que le impide conseguirlo.' },
  { id: 'lie', label: 'La mentira que se cree', hint: 'Lo que da por cierto sobre sí mismo o sobre el mundo, y no lo es.' },
  { id: 'wound', label: 'Su herida', hint: 'De dónde salió esa mentira.' },
];

export const CHARACTER_VOICE_FIELDS: { id: 'register' | 'tics' | 'sample'; label: string; hint: string }[] = [
  { id: 'register', label: 'Registro', hint: 'Culto, soez, arcaizante, telegráfico…' },
  { id: 'tics', label: 'Tics y muletillas', hint: 'Lo que repite, y lo que no diría nunca.' },
  { id: 'sample', label: 'Muestra de diálogo', hint: 'Dos o tres líneas suyas hablando. Es lo que la IA imita.' },
];

export const SOCIAL_VALENCES: SocialRelationValence[] = [
  'ally',
  'rival',
  'lover',
  'mentor',
  'student',
  'nemesis',
  'kin',
  'neutral',
];

export const SOCIAL_VALENCE_LABEL: Record<SocialRelationValence, string> = {
  ally: 'Aliado',
  rival: 'Rival',
  lover: 'Amante',
  mentor: 'Mentor',
  student: 'Discípulo',
  nemesis: 'Némesis',
  kin: 'Familia',
  neutral: 'Neutral',
};

/**
 * Group kinds. Factions, cultures and the rest are ONE entity with a kind (schema v94),
 * so these labels are what tells the two sidebar sections apart.
 */
export const WORLD_GROUP_KIND_LABEL: Record<string, string> = {
  faction: 'Facción',
  culture: 'Cultura',
  religion: 'Religión',
  house: 'Casa',
  order: 'Orden',
  species: 'Especie',
  language: 'Lengua',
};

/** Which kinds each section offers when creating. Factions and cultures are the two
 *  sections that ship; the rest are available as kinds inside them. */
export const FACTION_KINDS = ['faction', 'house', 'order', 'religion'];
export const CULTURE_KINDS = ['culture', 'species', 'language'];

export const WORLD_GROUP_STATUS_LABEL: Record<string, string> = {
  active: 'Activa',
  extinct: 'Extinta',
  dormant: 'Latente',
};

export const WORLD_GROUP_STATUSES = ['active', 'extinct', 'dormant'];

/**
 * The epithet or title to show under a character's name in the grid, if any.
 *
 * A SECRET epithet is skipped: the grid is the public face of the cast, and putting the
 * name only three people in the story know on the front of the card gives it away at a
 * glance. It is still on the sheet, marked as a secret.
 */
export function characterEpithet(names: PersonName[]): string | null {
  return names.find((entry) => entry.kind === 'epithet' && !entry.secret)?.name ?? null;
}
