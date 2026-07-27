/**
 * The worldbuilding vocabulary for `places.kind`, with a containment SCALE.
 *
 * `places` is SHARED with genealogy, which writes its own kinds ('municipality'). The two
 * vocabularies share the column and NEVER share a picker — the same arrangement the event
 * types already use (EVENT_TYPE_OPTIONS vs CHARACTER_EVENT_TYPES). Nothing here is ever
 * offered in a genealogy vault, and nothing from there is offered here.
 *
 * The scale is the reason this file is more than a list of words. It is a rough
 * containment rank, not a unit: it says a City normally sits inside a Country, not how
 * many metres either is. From that one integer come three things a writer gets for free:
 *
 *   1. a sensible default kind for a child ("new place inside this City" → District);
 *   2. a coherence WARNING when something contains something bigger than itself;
 *   3. consistent grouping and indentation in the places tree.
 *
 * Deliberately a warning and never a rule: a world may well have a city that contains an
 * entire plane, and that is a decision, not a typo.
 *
 * Pure data plus three helpers; no dependencies.
 */

export interface PlaceKindDef {
  id: string;
  label: string;
  /** Rough containment rank: smaller contains larger. 0 = a whole plane of existence. */
  scale: number;
  /** Grouping label in the picker, so a 40-entry dropdown stays navigable. */
  group: string;
}

export const PLACE_KINDS: PlaceKindDef[] = [
  { id: 'plane', label: 'Plano', scale: 0, group: 'Cosmos' },
  { id: 'universe', label: 'Universo', scale: 0, group: 'Cosmos' },
  { id: 'galaxy', label: 'Galaxia', scale: 1, group: 'Cosmos' },
  { id: 'cluster', label: 'Cúmulo', scale: 1, group: 'Cosmos' },
  { id: 'system', label: 'Sistema', scale: 2, group: 'Cosmos' },
  { id: 'star', label: 'Estrella', scale: 2, group: 'Cosmos' },
  { id: 'planet', label: 'Planeta', scale: 3, group: 'Cosmos' },
  { id: 'moon', label: 'Luna', scale: 3, group: 'Cosmos' },

  { id: 'continent', label: 'Continente', scale: 4, group: 'Geografía' },
  { id: 'ocean', label: 'Océano', scale: 4, group: 'Geografía' },
  { id: 'sea', label: 'Mar', scale: 5, group: 'Geografía' },
  { id: 'region', label: 'Región', scale: 5, group: 'Geografía' },
  { id: 'mountains', label: 'Cordillera', scale: 5, group: 'Geografía' },
  { id: 'forest', label: 'Bosque', scale: 5, group: 'Geografía' },
  { id: 'desert', label: 'Desierto', scale: 5, group: 'Geografía' },
  { id: 'river', label: 'Río', scale: 5, group: 'Geografía' },
  { id: 'island', label: 'Isla', scale: 5, group: 'Geografía' },

  { id: 'country', label: 'País', scale: 6, group: 'Política' },
  { id: 'kingdom', label: 'Reino', scale: 6, group: 'Política' },
  { id: 'empire', label: 'Imperio', scale: 6, group: 'Política' },
  { id: 'province', label: 'Provincia', scale: 7, group: 'Política' },
  { id: 'comarca', label: 'Comarca', scale: 7, group: 'Política' },
  { id: 'county', label: 'Condado', scale: 7, group: 'Política' },

  { id: 'city', label: 'Ciudad', scale: 8, group: 'Asentamientos' },
  { id: 'town', label: 'Pueblo', scale: 8, group: 'Asentamientos' },
  { id: 'village', label: 'Aldea', scale: 8, group: 'Asentamientos' },
  { id: 'district', label: 'Barrio', scale: 9, group: 'Asentamientos' },
  { id: 'fortress', label: 'Fortaleza', scale: 9, group: 'Asentamientos' },
  { id: 'temple', label: 'Templo', scale: 9, group: 'Asentamientos' },
  { id: 'ruin', label: 'Ruina', scale: 9, group: 'Asentamientos' },
  { id: 'port', label: 'Puerto', scale: 9, group: 'Asentamientos' },

  { id: 'building', label: 'Edificio', scale: 10, group: 'Interiores' },
  { id: 'inn', label: 'Posada', scale: 10, group: 'Interiores' },
  { id: 'room', label: 'Sala', scale: 11, group: 'Interiores' },
  { id: 'chamber', label: 'Cámara', scale: 11, group: 'Interiores' },

  { id: 'other', label: 'Otro', scale: 12, group: 'Otros' },
];

const BY_ID = new Map(PLACE_KINDS.map((kind) => [kind.id, kind]));

export function placeKind(id: string | null | undefined): PlaceKindDef | null {
  return id ? BY_ID.get(id) ?? null : null;
}

/** Kinds grouped for the picker, in catalogue order. */
export function placeKindGroups(): { group: string; kinds: PlaceKindDef[] }[] {
  const groups: { group: string; kinds: PlaceKindDef[] }[] = [];
  for (const kind of PLACE_KINDS) {
    const existing = groups.find((entry) => entry.group === kind.group);
    if (existing) existing.kinds.push(kind);
    else groups.push({ group: kind.group, kinds: [kind] });
  }
  return groups;
}

/**
 * The kind to preselect when creating a place inside `parentKind`: the first one of the
 * next scale down. Creating inside a City suggests a District, inside a Country a
 * Province. With no parent — or an unknown one — it suggests nothing and lets the author
 * choose, rather than guessing wrong.
 */
export function suggestedChildKind(parentKind: string | null | undefined): string | null {
  const parent = placeKind(parentKind);
  if (!parent) return null;
  const deeper = PLACE_KINDS.filter((kind) => kind.scale > parent.scale);
  if (!deeper.length) return null;
  const nextScale = Math.min(...deeper.map((kind) => kind.scale));
  return deeper.find((kind) => kind.scale === nextScale)?.id ?? null;
}

export interface PlaceScaleWarning {
  childKind: string;
  parentKind: string;
  message: string;
  values: Record<string, string>;
}

/**
 * Warn when a place contains something bigger than itself — a Continent inside a City is
 * nearly always a drag-and-drop slip.
 *
 * Returns null for equal scales: a Region inside a Region, or a District inside a
 * District, is ordinary. Only a strictly LARGER child is reported, and only ever as a
 * warning, because an author is allowed to put a whole plane inside a tavern's cellar.
 */
export function checkPlaceScale(
  childKind: string | null | undefined,
  parentKind: string | null | undefined
): PlaceScaleWarning | null {
  const child = placeKind(childKind);
  const parent = placeKind(parentKind);
  if (!child || !parent) return null;
  if (child.scale >= parent.scale) return null;
  return {
    childKind: child.id,
    parentKind: parent.id,
    message: 'Un lugar de tipo «{child}» está dentro de uno de tipo «{parent}». ¿Es a propósito?',
    values: { child: child.label, parent: parent.label },
  };
}

/**
 * Would setting `parentId` as the parent of `placeId` close a loop?
 *
 * A cycle in the tree hangs the renderer, so this is checked BEFORE the write rather than
 * defended against afterwards. `parentOf` is a lookup into the places already loaded.
 */
export function wouldCycle(
  placeId: string,
  parentId: string | null,
  parentOf: (id: string) => string | null
): boolean {
  if (!parentId) return false;
  if (parentId === placeId) return true;
  const seen = new Set<string>([placeId]);
  let current: string | null = parentId;
  while (current) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = parentOf(current);
  }
  return false;
}
