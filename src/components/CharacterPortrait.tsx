import type { Character } from '@shared/types';
import { characterAccentHex } from '@shared/characterLabels';
import { PersonPortrait } from './PersonPortrait';

/**
 * A character's portrait as a 3:4 card image rather than genealogy's square avatar —
 * a world is browsed visually, and a taller crop shows a figure instead of just a face.
 *
 * Two things this wrapper exists for:
 *   - `PersonPortrait` sizes its "no image" placeholder icon from `size`, which keeps
 *     its 48px default even when `fill` makes the box far bigger, so the icon would sit
 *     tiny in the middle of a card. The size hint below is the placeholder's size, not
 *     the box's.
 *   - The neutral placeholder is the RIGHT fallback here and must stay: the man/woman
 *     silhouettes are chosen from `persons.sex`, which a character never sets, because
 *     a human silhouette is wrong for a god, a dragon or a construct.
 */
export function CharacterPortrait({
  character,
  className = '',
  placeholderSize = 96,
  fullResolution = false,
}: {
  character: Character;
  className?: string;
  placeholderSize?: number;
  /** Only detail editors should decode the original; cards use the independent thumbnail. */
  fullResolution?: boolean;
}) {
  const accent = characterAccentHex(character.profile.accent);
  return (
    <div
      className={`relative aspect-[3/4] w-full overflow-hidden bg-neutral-800/40 ${className}`}
      style={accent ? { boxShadow: `inset 0 2px 0 0 ${accent}` } : undefined}
    >
      <PersonPortrait
        person={character}
        size={placeholderSize}
        rounded="none"
        fill
        fullResolution={fullResolution}
      />
    </div>
  );
}
