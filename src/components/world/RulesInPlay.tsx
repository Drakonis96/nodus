import { useCallback, useEffect, useState } from 'react';
import type { BeatMark, WorldBeat, WorldRule, WorldScene } from '@shared/types';
import { BEAT_MARK_LABEL, marksFor } from '@shared/worldThreads';
import { RULE_HARDNESS_LABEL } from '@shared/worldRules';
import { Icon } from '../ui';
import { t } from '../../i18n';

/**
 * The laws this scene puts in play.
 *
 * PREPOPULATED, and that is the whole point: the rows come from what the scene's text
 * already mentions, from the laws of where it happens, and from the factions its cast
 * belongs to. The author ANSWERS — obeys, bends, breaks, establishes — rather than going
 * to look a law up, which is the difference between a panel that gets used and one that
 * gets skipped.
 *
 * And when a law is broken, one more question: **is the price on the page?** Three states,
 * not two. "I have not looked" is not "the price is missing", and collapsing them would
 * turn every fresh mark into an accusation.
 */
export function RulesInPlay({ scene, onChanged }: { scene: WorldScene; onChanged: () => Promise<void> }) {
  const [rules, setRules] = useState<WorldRule[]>([]);
  const [beats, setBeats] = useState<WorldBeat[]>([]);

  const load = useCallback(async () => {
    const [inPlay, sceneBeats] = await Promise.all([
      window.nodus.rulesInPlay(scene.sceneId),
      window.nodus.beatsForScene(scene.sceneId),
    ]);
    setRules(inPlay);
    setBeats(sceneBeats.filter((beat) => beat.threadKind === 'rule'));
  }, [scene.sceneId]);

  useEffect(() => {
    void load();
  }, [load, scene.updatedAt]);

  // A law already judged here stays visible even if it would no longer be suggested —
  // hiding a recorded judgement because the cast changed would silently lose it.
  const judged = new Set(beats.map((beat) => beat.threadId));
  const rows = [
    ...rules,
    ...beats
      .filter((beat) => !rules.some((rule) => rule.ruleId === beat.threadId))
      .map((beat) => ({ ruleId: beat.threadId, title: beat.threadTitle, hardness: 'costly' } as WorldRule)),
  ];

  const beatOf = (ruleId: string) => beats.find((beat) => beat.threadId === ruleId) ?? null;

  const mark = async (rule: WorldRule, next: BeatMark | null) => {
    if (next === null) {
      await window.nodus.deleteWorldBeat('rule', rule.ruleId, scene.sceneId);
    } else {
      const current = beatOf(rule.ruleId);
      await window.nodus.setWorldBeat({
        threadKind: 'rule',
        threadId: rule.ruleId,
        sceneId: scene.sceneId,
        mark: next,
        // Changing the mark away from `breaks` drops the payment judgement, because it no
        // longer means anything — keeping it would leave "unpaid" hanging off a scene
        // where nothing was broken.
        paid: next === 'breaks' ? current?.paid ?? null : null,
      });
    }
    await load();
    await onChanged();
  };

  const setPaid = async (rule: WorldRule, paid: boolean | null) => {
    const current = beatOf(rule.ruleId);
    if (!current) return;
    await window.nodus.setWorldBeat({
      threadKind: 'rule',
      threadId: rule.ruleId,
      sceneId: scene.sceneId,
      mark: current.mark,
      paid,
    });
    await load();
    await onChanged();
  };

  if (rows.length === 0) return null;

  return (
    <section data-testid="rules-in-play">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('Reglas en juego')}</h3>
        <span className="text-[10px] text-neutral-600">
          {judged.size === 0 ? t('Ninguna juzgada') : `${judged.size}/${rows.length}`}
        </span>
      </div>
      <ul className="space-y-1">
        {rows.map((rule) => {
          const beat = beatOf(rule.ruleId);
          return (
            <li key={rule.ruleId} className="rounded border border-neutral-800 p-2" data-testid="rule-in-play-row">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-neutral-200">{rule.title}</span>
                <span className="shrink-0 text-[10px] text-neutral-600">
                  {t(RULE_HARDNESS_LABEL[rule.hardness] ?? rule.hardness)}
                </span>
                <span className="flex shrink-0 gap-0.5">
                  {marksFor('rule').map((entry) => (
                    <button
                      key={entry}
                      onClick={() => void mark(rule, beat?.mark === entry ? null : entry)}
                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                        beat?.mark === entry
                          ? 'bg-indigo-600 text-white'
                          : 'border border-neutral-700 text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      {t(BEAT_MARK_LABEL[entry])}
                    </button>
                  ))}
                </span>
              </div>
              {beat?.mark === 'breaks' && (
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[10px] text-neutral-600">{t('¿Está el precio en la página?')}</span>
                  {([true, false] as const).map((value) => (
                    <button
                      key={String(value)}
                      data-testid={value ? 'rule-paid-yes' : 'rule-paid-no'}
                      onClick={() => void setPaid(rule, beat.paid === value ? null : value)}
                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                        beat.paid === value
                          ? value
                            ? 'bg-neutral-700 text-neutral-100'
                            : 'bg-amber-800 text-amber-100'
                          : 'border border-neutral-700 text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      {value ? t('Sí') : t('No')}
                    </button>
                  ))}
                  {beat.paid == null && (
                    <span className="flex items-center gap-1 text-[10px] text-neutral-700">
                      <Icon name="info" size={10} /> {t('sin mirar')}
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
