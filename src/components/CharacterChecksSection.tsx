import { useEffect, useState } from 'react';
import type { Character } from '@shared/types';
import { confusableWith, type ConfusablePair } from '@shared/characterChecks';
import { Icon } from './ui';
import { t, tx } from '../i18n';

/**
 * Names a reader will confuse with this one.
 *
 * It used to also paint `checkCharacterCoherence` — the contradictions inside the sheet.
 * Those now arrive through the continuity badge, which renders the SAME finding for every
 * kind of entity: two renderings of one problem, in two wordings, teaches a writer that
 * the app does not know what it thinks. Confusable names stay here because they are not a
 * contradiction at all; they are a note about the reader, and they belong to Personajes.
 *
 * Renders NOTHING when there is nothing to say. A section that is permanently present and
 * usually empty teaches the eye to skip it, and then the one time it matters it is skipped
 * too — so this either has content or does not exist.
 */
export function CharacterChecksSection({ character }: { character: Character }) {
  const [confusable, setConfusable] = useState<ConfusablePair[]>([]);

  useEffect(() => {
    let active = true;
    void window.nodus.listCharacters().then((all) => {
      if (active) setConfusable(confusableWith(character.personId, all));
    });
    return () => {
      active = false;
    };
  }, [character.personId, character.displayName]);

  if (confusable.length === 0) return null;

  return (
    <section
      data-testid="character-dossier-checks"
      className="rounded-md border border-amber-900/60 bg-amber-950/15 p-3"
    >
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-300">
        <Icon name="alert" size={13} /> {t('Revisar')}
      </h3>
      <ul className="space-y-1.5">
        {confusable.map((pair) => {
          const other = pair.aId === character.personId ? pair.bName : pair.aName;
          return (
            <li key={`${pair.aId}-${pair.bId}`} className="flex gap-1.5 text-sm">
              <span className="text-amber-400">!</span>
              <span className="text-neutral-300">
                {tx('El nombre se parece mucho a «{other}»: quien lea puede confundirlos.', { other })}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
