/**
 * Building the prompt for a map of an invented world.
 *
 * Same structure as `characterImagePrompt.ts`, and for the same reason: **the ORDER is
 * the whole thing.** The style comes first, then the world's visual seed — the stable
 * description reused for every map of this world — then the framing for this kind of map,
 * then what must actually be on it. Putting the seed late lets the model drift and the
 * second map of your world stops looking like the first, which is the single biggest
 * complaint about generated art.
 *
 * ## Nodus draws the labels, not the model
 *
 * Image models write illegible or misspelled text, and a map is mostly text. So the
 * default prompt carries an explicit negative and Nodus renders the place names itself,
 * from the real names in the vault. That is not only prettier: the names end up CORRECT,
 * searchable, translatable, hideable by layer, and they follow when the author renames a
 * place. The author can opt out per map (`modelLabels`), and the interface warns them.
 *
 * Pure and dependency-light so all of it is unit-tested without a provider.
 */

import type { ImageProvider, WorldMapKind } from './types';

export type MapStyleId =
  | 'parchment'
  | 'inked_atlas'
  | 'painted_fantasy'
  | 'watercolour'
  | 'satellite'
  | 'blueprint'
  | 'isometric'
  | 'hand_drawn'
  | 'dark_grimoire'
  | 'nautical_chart';

export interface MapStyleDef {
  id: MapStyleId;
  /** Spanish source label, translated through t() at the call site. */
  label: string;
  /** The style clause. English: every provider's prompt understanding is best there. */
  clause: string;
}

export const MAP_STYLES: MapStyleDef[] = [
  { id: 'parchment', label: 'Pergamino', clause: 'an antique fantasy map drawn on aged parchment, sepia and umber inks, subtle water stains, hand-drawn coastlines with fine hatching' },
  { id: 'inked_atlas', label: 'Atlas a plumilla', clause: 'a fine copperplate-engraved atlas map, dense black line work, cross-hatched relief, restrained cream paper' },
  { id: 'painted_fantasy', label: 'Fantasía pintada', clause: 'a richly painted fantasy map, saturated gouache colours, sculpted mountain ranges and forests seen from above' },
  { id: 'watercolour', label: 'Acuarela', clause: 'a soft watercolour map, washed pigments bleeding at the edges, pale paper grain, loose brushwork' },
  { id: 'satellite', label: 'Satélite', clause: 'a photorealistic orbital view, natural terrain colours, real cloud shadows, no graphic styling' },
  { id: 'blueprint', label: 'Plano técnico', clause: 'a technical blueprint, white line work on deep blue, precise geometry, drafting conventions' },
  { id: 'isometric', label: 'Isométrico', clause: 'a clean isometric map, three-quarter view, stylised volumes, soft ambient shadows' },
  { id: 'hand_drawn', label: 'Boceto a mano', clause: 'a loose hand-drawn sketch map in pencil and ink, visible construction lines, informal and quick' },
  { id: 'dark_grimoire', label: 'Grimorio oscuro', clause: 'a sinister map from a dark grimoire, charcoal and oxblood on near-black vellum, ominous ornament' },
  { id: 'nautical_chart', label: 'Carta náutica', clause: 'an old nautical chart, rhumb lines, depth soundings, sea monsters at the margins, weathered linen' },
];

export const DEFAULT_MAP_STYLE: MapStyleId = 'parchment';

export function mapStyle(id: string | null | undefined): MapStyleDef {
  return MAP_STYLES.find((style) => style.id === id) ?? MAP_STYLES[0];
}

/**
 * What a map of this kind is a picture OF. The one part of the prompt that changes
 * between two maps of the same world — everything identifying the world stays byte for
 * byte the same, which is what keeps an atlas looking like one atlas.
 */
const KIND_FRAMING: Record<WorldMapKind, string> = {
  world: 'a whole-world map showing every continent and ocean, seen from directly above',
  continent: 'a continental map showing coastlines, mountain ranges, rivers and major regions, seen from directly above',
  region: 'a regional map showing terrain, rivers, forests, roads and settlements, seen from directly above',
  city: 'a walled city map seen from directly above, showing districts, streets, walls, gates and the water it sits on',
  town: 'a small town map seen from directly above, showing its few streets, its square and the fields around it',
  building: 'an architectural floor plan of a single building, walls, doors and rooms drawn flat',
  interior: 'a floor plan of a single interior, furniture and fixtures drawn flat from above',
  dungeon: 'a dungeon map seen from above, chambers, corridors, stairs and doors drawn flat',
  battle: 'a battle plan seen from above, terrain and troop positions marked as blocks and arrows',
  route: 'a route map, the roads and sea lanes emphasised over the terrain they cross',
  schematic: 'a schematic diagram, abstract shapes and connectors rather than terrain',
  other: 'a map seen from directly above',
};

/** Never in the picture, whatever else is asked for. */
const ALWAYS_NEGATIVE = 'no watermark, no signature, no user interface, no photograph of a map lying on a desk, no hands, no border frame';
/** Dropped when the author opts into model-drawn labels. */
const LABEL_NEGATIVE = 'no text, no letters, no words, no place names, no legend, no compass rose, no scale bar';

export interface MapPlaceHint {
  name: string;
  /** The place vocabulary's kind: city, forest, mountain… */
  kind?: string | null;
  /** Where it sits, when it is already pinned on a parent map: "north-west". */
  bearing?: string | null;
}

export type MapPromptMode = 'create' | 'zoom' | 'expand' | 'restyle' | 'variant';

export interface MapPromptInput {
  mode: MapPromptMode;
  kind: WorldMapKind;
  style: MapStyleId;
  /** The world's stable visual description — the anchor of consistency across maps. */
  worldSeed?: string | null;
  /** This map's own seed, so regenerating it does not produce a different place. */
  mapSeed?: string | null;
  /** Places that must appear, with their kind and rough bearing. */
  places?: MapPlaceHint[];
  /** How wide the map is meant to be, in world units — "600 km". */
  extent?: { distance: number; unit: string } | null;
  /** True when the author asked the model to write the names itself. */
  modelLabels?: boolean;
  /** Free extra direction for THIS generation only. */
  extra?: string | null;
  /** `expand` only: which edge is being continued. */
  edge?: 'north' | 'south' | 'east' | 'west' | null;
}

function clean(value: string | null | undefined, limit: number): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

/** The eight-point bearing of a normalized point, for describing an arrangement. */
export function bearingOf(x: number, y: number): string {
  const vertical = y < 0.34 ? 'north' : y > 0.66 ? 'south' : '';
  const horizontal = x < 0.34 ? 'west' : x > 0.66 ? 'east' : '';
  if (vertical && horizontal) return `${vertical}-${horizontal}`;
  return vertical || horizontal || 'centre';
}

/**
 * The content clause: what is actually on this map.
 *
 * The bearings are what make a REGENERATED map still a map of the same world. Without
 * them the model is free to put Aldermoor wherever it likes, and the second attempt is a
 * different country with the same place names.
 */
function contentClause(places: MapPlaceHint[]): string {
  if (places.length === 0) return '';
  const described = places.slice(0, 14).map((place) => {
    const kind = clean(place.kind, 30);
    const bearing = clean(place.bearing, 20);
    const parts = [clean(place.name, 60)];
    if (kind) parts.push(`a ${kind}`);
    if (bearing) parts.push(`to the ${bearing}`);
    return parts.join(', ');
  });
  return `It must include: ${described.join('; ')}.`;
}

/**
 * How detailed the map should be. A model draws very different things for 600 km and for
 * 6 km, and without being told it picks a density at random — which is the commonest
 * failure of a generated map: a continent's worth of mountains inside one valley.
 */
function extentClause(extent: MapPromptInput['extent']): string {
  if (!extent || !(extent.distance > 0)) return '';
  return `The map covers roughly ${Math.round(extent.distance)} ${extent.unit} across, so show the level of detail appropriate to that scale.`;
}

const MODE_CLAUSE: Record<MapPromptMode, string> = {
  create: '',
  zoom: 'This is a more detailed map of the boxed region of the reference image. Preserve its coastlines, rivers, mountains and the position of every feature EXACTLY; add only the finer detail that a closer scale reveals.',
  expand: 'Continue the reference image outwards into the blank area, matching its style, palette, coastline logic and level of detail exactly. The existing part must be reproduced unchanged.',
  restyle: 'Redraw the reference image in the new style. The geography — coastlines, landmasses, rivers, mountains and the position of every feature — must stay EXACTLY as it is; only the rendering changes.',
  variant: 'Another interpretation of the same brief, with a different arrangement of the terrain.',
};

/**
 * The prompt, assembled. Order: mode → style → world seed → map seed → framing →
 * content → extent → labels → negatives.
 */
export function buildMapPrompt(input: MapPromptInput): string {
  const parts: string[] = [];
  const mode = MODE_CLAUSE[input.mode];
  if (mode) parts.push(mode);
  if (input.mode === 'expand' && input.edge) {
    parts.push(`The new area is to the ${input.edge} of the existing map.`);
  }

  parts.push(`${mapStyle(input.style).clause}.`);

  // The two anchors, in this order: the world before the map, because a map belongs to a
  // world and not the other way round.
  const worldSeed = clean(input.worldSeed, 400);
  if (worldSeed) parts.push(`The world: ${worldSeed}.`);
  const mapSeed = clean(input.mapSeed, 400);
  if (mapSeed) parts.push(`This map: ${mapSeed}.`);

  parts.push(`It is ${KIND_FRAMING[input.kind] ?? KIND_FRAMING.other}.`);

  const content = contentClause(input.places ?? []);
  if (content) parts.push(content);
  const extent = extentClause(input.extent);
  if (extent) parts.push(extent);

  const extra = clean(input.extra, 300);
  if (extra) parts.push(extra);

  if (input.modelLabels) {
    parts.push('Write the place names on the map in a legible hand-lettered style.');
    parts.push(`Avoid: ${ALWAYS_NEGATIVE}.`);
  } else {
    // The default. Nodus draws the labels, so the model must draw none.
    parts.push(`Avoid: ${LABEL_NEGATIVE}, ${ALWAYS_NEGATIVE}.`);
  }

  return parts.join(' ');
}

/** True when there is enough to draw anything at all. */
export function hasMapPromptMaterial(input: MapPromptInput): boolean {
  return Boolean(
    clean(input.worldSeed, 1) ||
    clean(input.mapSeed, 1) ||
    clean(input.extra, 1) ||
    (input.places?.length ?? 0) > 0,
  );
}

// ── what a provider can actually do ─────────────────────────────────────────────

/** Alias rather than a second union: a provider added to one and forgotten in the
 *  other used to compile fine and only fail at the call site. */
export type MapImageProvider = ImageProvider;

/**
 * Can this provider take a REFERENCE image?
 *
 * Zoom, expand and restyle are all image-to-image. Where that is unavailable the honest
 * fallback is: a vision model describes the crop in prose, and that prose feeds a
 * text-to-image call. It comes out worse, and the interface has to SAY so rather than
 * quietly producing something that does not match.
 *
 * OpenRouter varies by MODEL, not by provider, so it is answered per model rather than
 * per provider — declaring the whole provider capable would fail on most of its catalogue
 * and declaring it incapable would waste the models that can.
 */
export function supportsReferenceImage(provider: MapImageProvider, model: string): boolean {
  if (provider === 'google') return true;
  if (provider === 'openai') return /gpt-image|dall-e-2/i.test(model);
  if (provider === 'openrouter') return /gemini|flash-image|nano-banana|gpt-image|seedream|qwen-image/i.test(model);
  // The local generator is text-to-image only, and so is the Codex path: its built-in
  // tool takes a prompt and nothing else. Promising otherwise would fail offline, where
  // there is no fallback at all.
  return false;
}

/** Which operations need a reference image to be honest about what they produce. */
export const REFERENCE_MODES: MapPromptMode[] = ['zoom', 'expand', 'restyle'];

export function needsReference(mode: MapPromptMode): boolean {
  return REFERENCE_MODES.includes(mode);
}
