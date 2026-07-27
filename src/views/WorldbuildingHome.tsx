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
 * Landing page for the worldbuilding vault. Characters are the only section built so
 * far, so this is deliberately a character-first home rather than a grid of doors to
 * places that do not exist yet: the count, a way in, and the last people the author
 * touched. It says plainly which sections are still being built instead of showing
 * them as buttons that do nothing.
 */
export function WorldbuildingHome({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [counts, setCounts] = useState<CharacterCounts | null>(null);
  const [recent, setRecent] = useState<Character[]>([]);

  const reload = useCallback(async () => {
    const [nextCounts, characters] = await Promise.all([
      window.nodus.characterCounts(),
      window.nodus.listCharacters(),
    ]);
    setCounts(nextCounts);
    setRecent([...characters].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6));
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([window.nodus.characterCounts(), window.nodus.listCharacters()]).then(([nextCounts, characters]) => {
      if (!active) return;
      setCounts(nextCounts);
      setRecent([...characters].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6));
    });
    return () => {
      active = false;
    };
  }, []);
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
          description={t('Construye un mundo de ficción pieza a pieza. Empieza por los personajes: sus nombres y alias, los hechos de su vida, sus vínculos y su descripción, con retratos y biografías que puedes generar cuando te sirvan.')}
          icon="globe"
        />

        <section className="grid gap-3 sm:grid-cols-3">
          {[
            { label: 'Personajes', value: total, icon: 'users' },
            { label: 'Protagonistas', value: protagonists, icon: 'target' },
            { label: 'Con vida', value: alive, icon: 'sparkles' },
          ].map((metric) => (
            <button
              key={metric.label}
              onClick={() => onNavigate('characters')}
              className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-left hover:border-indigo-700/60"
            >
              <span className="rounded-lg bg-indigo-600/15 p-2 text-indigo-300">
                <Icon name={metric.icon} />
              </span>
              <span>
                <span className="block text-xl font-semibold text-neutral-100">{metric.value}</span>
                <span className="text-xs text-neutral-500">{t(metric.label)}</span>
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
              { sections: t('enciclopedia, lugares, facciones, culturas, cronología, mapa, relaciones, escenas y manuscritos') }
            )}
          </p>
        </section>
      </div>
    </div>
  );
}
