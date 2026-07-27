import { useEffect, useState } from 'react';
import type { Character, CharacterEvent } from '@shared/types';
import { checkCharacterCoherence, confusableWith, type ConfusablePair } from '@shared/characterChecks';
import { Icon } from './ui';
import { t, tx } from '../i18n';

/**
 * Problems worth telling the author about: contradictions inside the sheet, and other
 * characters whose names a reader will confuse with this one.
 *
 * Renders NOTHING when there is nothing to say. A section that is permanently present and
 * usually empty teaches the eye to skip it, and then the one time it matters it is skipped
 * too — so this either has content or does not exist.
 */
export function CharacterChecksSection({
  character,
  events,
}: {
  character: Character;
  events: CharacterEvent[];
}) {
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

  const checks = checkCharacterCoherence({
    lifeStatus: character.profile.lifeStatus,
    birthYear: character.profile.birthYearSort,
    deathYear: character.profile.deathYearSort,
    deathDate: character.deathDate,
    events: events.map((event) => ({ type: event.type, label: event.label, worldYear: event.worldYear })),
  });

  if (checks.length === 0 && confusable.length === 0) return null;

  const errors = checks.filter((check) => check.severity === 'error');
  const warnings = checks.filter((check) => check.severity === 'warning');

  return (
    <section
      data-testid="character-dossier-checks"
      className={`rounded-md border p-3 ${
        errors.length > 0 ? 'border-red-900/60 bg-red-950/20' : 'border-amber-900/60 bg-amber-950/15'
      }`}
    >
      <h3
        className={`mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${
          errors.length > 0 ? 'text-red-300' : 'text-amber-300'
        }`}
      >
        <Icon name="alert" size={13} /> {t('Revisar')}
      </h3>
      <ul className="space-y-1.5">
        {[...errors, ...warnings].map((check) => (
          <li key={check.id} className="flex gap-1.5 text-sm">
            <span className={check.severity === 'error' ? 'text-red-400' : 'text-amber-400'}>
              {check.severity === 'error' ? '×' : '!'}
            </span>
            <span className="text-neutral-300">
              {check.values ? tx(check.message, check.values) : t(check.message)}
            </span>
          </li>
        ))}
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
