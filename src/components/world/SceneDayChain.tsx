import { useCallback, useEffect, useState } from 'react';
import type { SceneDayLink, SceneDayMode, WorldScene } from '@shared/types';
import { SCENE_DAY_MODE_LABEL, defaultSceneDayLink, describeSceneDay, sceneDayCoverage } from '@shared/worldSceneDays';
import { Icon } from '../ui';
import { t, tx } from '../../i18n';

/**
 * When a scene happens, said the way a writer thinks it.
 *
 * The world day is the number half the vault runs on — two people in two places at once, a
 * journey that cannot be made in the time available, a secret used before it was learned —
 * and asking for it directly gets it skipped, because a novelist writes thirty scenes
 * before deciding whether the wedding is on day 412. So this asks for the RELATION to the
 * previous scene instead: "the same night", "three days later". One anchor at the head of
 * an act dates everything after it.
 *
 * The computed day is shown, never typed. It is derived, and a second editable copy of a
 * derived number is a second answer to the same question.
 */
export function SceneDayChain({ scene, onChanged }: { scene: WorldScene; onChanged: () => Promise<void> }) {
  const [links, setLinks] = useState<SceneDayLink[]>([]);
  const [scenes, setScenes] = useState<WorldScene[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [nextLinks, nextScenes] = await Promise.all([
      window.nodus.listSceneDayLinks(),
      window.nodus.listScenes('narrative'),
    ]);
    setLinks(nextLinks);
    setScenes(nextScenes);
  }, []);

  useEffect(() => {
    void load();
  }, [load, scene.sceneId, scene.updatedAt]);

  const link = links.find((entry) => entry.sceneId === scene.sceneId) ?? defaultSceneDayLink(scene.sceneId);
  const index = scenes.findIndex((entry) => entry.sceneId === scene.sceneId);
  const previous = index > 0 ? scenes[index - 1] : null;
  const coverage = sceneDayCoverage(
    scenes.map((entry) => ({ sceneId: entry.sceneId, narrativeOrder: entry.narrativeOrder })),
    new Map(links.map((entry) => [entry.sceneId, entry]))
  );

  const save = async (next: Omit<SceneDayLink, 'sceneId'>) => {
    setSaving(true);
    try {
      await window.nodus.setSceneDayLink(scene.sceneId, next);
      await load();
      await onChanged();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="scene-day-chain">
      <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Cuándo ocurre')}</span>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input h-9 text-sm"
          value={link.mode}
          disabled={saving}
          onChange={(event) => void save({ ...link, mode: event.target.value as SceneDayMode })}
        >
          {(['offset', 'same', 'anchor'] as SceneDayMode[]).map((mode) => (
            <option key={mode} value={mode}>
              {t(SCENE_DAY_MODE_LABEL[mode])}
            </option>
          ))}
        </select>

        {link.mode === 'offset' && (
          <input
            className="input h-9 w-20 text-sm"
            type="number"
            value={link.offsetDays}
            disabled={saving}
            onChange={(event) => void save({ ...link, offsetDays: Number(event.target.value) || 0 })}
          />
        )}
        {link.mode === 'anchor' && (
          <input
            className="input h-9 w-28 text-sm"
            type="number"
            placeholder={t('Día')}
            value={link.anchorWorldDay ?? ''}
            disabled={saving}
            onChange={(event) =>
              void save({ ...link, anchorWorldDay: event.target.value === '' ? null : Number(event.target.value) })
            }
          />
        )}

        <span className="text-[11px] text-neutral-500">
          {previous
            ? tx('respecto a «{scene}»', { scene: previous.title })
            : t('es la primera escena del relato')}
        </span>

        {scene.worldDay != null && (
          <span className="ml-auto rounded bg-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-300">
            {tx('Día {day}', { day: String(scene.worldDay) })}
          </span>
        )}
      </div>

      <p className="mt-1 text-[10px] leading-4 text-neutral-600">
        {(() => {
          const described = describeSceneDay(link);
          return described.vars ? tx(described.key, described.vars) : t(described.key);
        })()}
      </p>

      {/* A count of scenes, never a percentage: "38 escenas sin día" is a piece of work,
          and "72 %" is a grade. */}
      {coverage.total > 0 && !coverage.anchored && (
        <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-600">
          <Icon name="info" size={11} />
          {t('Ningún día está fijado todavía: las fechas son relativas entre sí, no del calendario del mundo.')}
        </p>
      )}
    </div>
  );
}
