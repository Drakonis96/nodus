import { useCallback, useEffect, useState } from 'react';
import type { Character, CharacterCounts } from '@shared/types';
import { CHARACTER_LIFE_STATUS_LABEL, CHARACTER_ROLE_LABEL, characterEpithet } from '@shared/characterLabels';
import type { View } from '../navigation';
import { Icon } from '../components/ui';
import { CharacterPortrait } from '../components/CharacterPortrait';
import { useDataRefresh } from '../hooks';
import { HomeIntroCard } from './HomeView';
import { t, tx } from '../i18n';

/**
 * Landing page for the worldbuilding vault: the size of the world, a way into it, and the
 * last people the author touched. It says plainly which sections are still being built
 * instead of showing them as buttons that do nothing.
 *
 * The cast leads because that is what a writer opens the app to work on. The encyclopedia
 * sits beside it as the count of everything else, since it is the one place where a world
 * can be seen whole.
 */
export function WorldbuildingHome({ onNavigate }: { onNavigate: (view: View) => void }) {
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

        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40">
          <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-neutral-300">{t('Personajes recientes')}</h2>
            <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={() => onNavigate('characters')}>
              {t('Ver todos')}
            </button>
          </div>
          {recent.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-neutral-500">{t('Todavía no hay personajes en este mundo.')}</p>
              <button className="btn btn-primary mt-3 gap-1.5" onClick={() => onNavigate('characters')}>
                <Icon name="plus" size={14} /> {t('Crear el primero')}
              </button>
            </div>
          ) : (
            <ul className="grid gap-3 p-4 [grid-template-columns:repeat(auto-fill,minmax(9rem,1fr))]">
              {recent.map((character) => (
                <li key={character.personId}>
                  <button
                    className="w-full rounded-lg border border-neutral-800 p-2 text-left transition-colors hover:border-indigo-700/60 hover:bg-indigo-950/20"
                    onClick={() => onNavigate('characters')}
                  >
                    <CharacterPortrait character={character} className="mb-2 rounded-md" />
                    <span className="block truncate text-sm text-neutral-200">{character.displayName}</span>
                    <span className="block truncate text-[11px] text-neutral-500">
                      {characterEpithet(character.names) ??
                        (character.profile.narrativeRole
                          ? t(CHARACTER_ROLE_LABEL[character.profile.narrativeRole])
                          : t(CHARACTER_LIFE_STATUS_LABEL[character.profile.lifeStatus]))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/20 p-4">
          <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-neutral-300">
            <Icon name="tools" size={14} /> {t('En construcción')}
          </h2>
          <p className="text-xs leading-5 text-neutral-500">
            {tx(
              'Las demás secciones del menú ({sections}) aparecen atenuadas porque todavía no están construidas. Se irán activando una a una.',
              { sections: t('preguntas abiertas, chat del mundo y manuscritos') }
            )}
          </p>
        </section>
      </div>
    </div>
  );
}
