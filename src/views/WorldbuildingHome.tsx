import { useCallback, useEffect, useState } from 'react';
import type { Character, CharacterCounts } from '@shared/types';
import { CHARACTER_LIFE_STATUS_LABEL, CHARACTER_ROLE_LABEL, characterEpithet } from '@shared/characterLabels';
import type { View } from '../navigation';
import { Icon } from '../components/ui';
import { CharacterPortrait } from '../components/CharacterPortrait';
import { useDataRefresh } from '../hooks';
import { DemoOfferCard, HomeIntroCard } from './HomeView';
import { t, tx } from '../i18n';

/**
 * Landing page for the worldbuilding vault: the size of the world, a way into it, and the
 * last people the author touched.
 *
 * The cast leads because that is what a writer opens the app to work on. The encyclopedia
 * sits beside it as the count of everything else, since it is the one place where a world
 * can be seen whole.
 */
export function WorldbuildingHome({
  onNavigate,
  showDemoOffer,
  demoBusy,
  onLoadDemo,
}: {
  onNavigate: (view: View) => void;
  showDemoOffer: boolean;
  demoBusy: boolean;
  onLoadDemo: () => Promise<void>;
}) {
  const [counts, setCounts] = useState<CharacterCounts | null>(null);
  const [recent, setRecent] = useState<Character[]>([]);
  const [entries, setEntries] = useState<{ total: number; stubs: number } | null>(null);

  const reload = useCallback(async () => {
    const [nextCounts, characters, worldEntries] = await Promise.all([
      window.nodus.characterCounts(),
      window.nodus.listCharacters(),
      window.nodus.listWorldEntries(),
    ]);
    setCounts(nextCounts);
    setRecent([...characters].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6));
    setEntries({ total: worldEntries.length, stubs: worldEntries.filter((entry) => entry.stub).length });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);
  useDataRefresh(reload);

  const total = counts?.total ?? 0;
  const protagonists = counts?.byRole.protagonist ?? 0;
  const alive = counts?.byStatus.alive ?? 0;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <HomeIntroCard
          eyebrow={t('Vault de worldbuilding')}
          title={t('Tu mundo')}
          description={t('Construye un mundo de ficción pieza a pieza: personajes, lugares, facciones, culturas, escenas y mapas. La enciclopedia los reúne todos en un solo índice y te deja escribir el resto del mundo —la magia, una religión, una lengua— enlazándolo con [[dobles corchetes]].')}
          icon="globe"
        />

        {showDemoOffer && (
          <DemoOfferCard
            variant="worldbuilding"
            demoBusy={demoBusy}
            onLoadWorldbuildingDemo={onLoadDemo}
          />
        )}

        <section className="grid gap-3 sm:grid-cols-4">
          {[
            { label: 'Personajes', value: total, icon: 'users', view: 'characters' as View },
            { label: 'Protagonistas', value: protagonists, icon: 'target', view: 'characters' as View },
            { label: 'Con vida', value: alive, icon: 'sparkles', view: 'characters' as View },
            // Everything the world holds, in one number — and, more usefully, how much of
            // it has been named but never written.
            {
              label: 'En la enciclopedia',
              value: entries?.total ?? 0,
              icon: 'book',
              view: 'encyclopedia' as View,
              hint: entries && entries.stubs > 0 ? tx('{count} sin desarrollar', { count: String(entries.stubs) }) : null,
            },
          ].map((metric) => (
            <button
              key={metric.label}
              onClick={() => onNavigate(metric.view)}
              className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-left hover:border-indigo-700/60"
            >
              <span className="rounded-lg bg-indigo-600/15 p-2 text-indigo-300">
                <Icon name={metric.icon} />
              </span>
              <span className="min-w-0">
                <span className="block text-xl font-semibold text-neutral-100">{metric.value}</span>
                <span className="block truncate text-xs text-neutral-500">{t(metric.label)}</span>
                {'hint' in metric && metric.hint && (
                  <span className="block truncate text-[10px] text-neutral-600">{metric.hint}</span>
                )}
              </span>
            </button>
          ))}
        </section>

        <section
          data-testid="world-recent-characters"
          className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/40"
        >
          <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-300">{t('Personajes recientes')}</h2>
            <button
              className="text-xs text-violet-700 hover:text-violet-900 dark:text-indigo-400 dark:hover:text-indigo-300"
              onClick={() => onNavigate('characters')}
            >
              {t('Ver todos')}
            </button>
          </div>
          {recent.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-neutral-600 dark:text-neutral-500">
                {t('Todavía no hay personajes en este mundo.')}
              </p>
              <button className="btn btn-primary mt-3 gap-1.5" onClick={() => onNavigate('characters')}>
                <Icon name="plus" size={14} /> {t('Crear el primero')}
              </button>
            </div>
          ) : (
            <ul className="grid gap-3 p-4 [grid-template-columns:repeat(auto-fill,minmax(9rem,1fr))]">
              {recent.map((character) => (
                <li key={character.personId}>
                  <button
                    className="w-full rounded-lg border border-neutral-200 bg-white p-2 text-left transition-colors hover:border-violet-400 hover:bg-violet-50 dark:border-neutral-800 dark:bg-transparent dark:hover:border-violet-700/60 dark:hover:bg-violet-950/20"
                    onClick={() => onNavigate('characters')}
                  >
                    <CharacterPortrait character={character} className="mb-2 rounded-md" />
                    <span className="block truncate text-sm text-neutral-900 dark:text-neutral-200">
                      {character.displayName}
                    </span>
                    <span className="world-recent-character-label mt-1 inline-flex max-w-full rounded-full border border-neutral-200 bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                      <span className="truncate">
                        {characterEpithet(character.names) ??
                          (character.profile.narrativeRole
                            ? t(CHARACTER_ROLE_LABEL[character.profile.narrativeRole])
                            : t(CHARACTER_LIFE_STATUS_LABEL[character.profile.lifeStatus]))}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
