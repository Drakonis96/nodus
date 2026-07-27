/**
 * Build the image prompt for a character portrait.
 *
 * The one thing that matters here is ORDER. The visual seed goes first, immediately
 * after the style, because it is the stable description the author reuses for every
 * image of this character — putting it late lets the model drift and the character
 * stops resembling itself between generations, which is the single biggest complaint
 * about AI character art.
 *
 * Nothing about this apologises for being generated: in a genealogy vault an invented
 * likeness is a last resort, but in a made-up world it is the point.
 *
 * Pure and dependency-light so it can be unit-tested without a provider.
 */

import { imageStyleTemplate } from './imageStyles';
import type { CharacterImageKind, DecorativeImageStyle } from './types';

export interface CharacterImageSources {
  /** The canonical appearance prompt; the anchor of consistency. */
  visualSeed: string | null;
  /** The sheet's appearance field. */
  appearance: string | null;
  /** Free extra direction for THIS image only (pose, mood, outfit). */
  extra?: string | null;
}

function clean(value: string | null | undefined, limit: number): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

/** True when there is anything at all to draw from. */
export function hasCharacterImageMaterial(sources: CharacterImageSources): boolean {
  return Boolean(clean(sources.visualSeed, 1) || clean(sources.appearance, 1) || clean(sources.extra, 1));
}

/**
 * The framing clause per gallery image kind. This is the only part of the prompt that
 * changes between the images of one character — everything identifying them stays byte
 * for byte the same, which is what keeps a full-body shot recognisably the same person
 * as the portrait.
 */
const FRAMING: Record<CharacterImageKind, string> = {
  portrait: 'a single character, portrait framing from the chest up, plain uncluttered backdrop',
  full_body: 'a single character, full body from head to feet, standing, plain uncluttered backdrop',
  expression: 'a single character, tight head-and-shoulders close-up centred on the face, plain backdrop',
  age: 'a single character shown at a different age, portrait framing from the chest up, plain backdrop',
  outfit: 'a single character, three-quarter view showing the full outfit in detail, plain backdrop',
  other: 'a single character, plain uncluttered backdrop',
};

export function buildCharacterPortraitPrompt(
  style: DecorativeImageStyle,
  sources: CharacterImageSources,
  kind: CharacterImageKind = 'portrait'
): string {
  return [
    imageStyleTemplate(style).prompt,
    clean(sources.visualSeed, 300),
    clean(sources.appearance, 320),
    clean(sources.extra, 200),
    FRAMING[kind] ?? FRAMING.other,
    'no text, no words, no letters, no numbers, no caption, no signature, no watermark, no border',
  ]
    .filter(Boolean)
    .join('. ')
    .slice(0, 900);
}
