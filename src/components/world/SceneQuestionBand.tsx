import { useEffect, useState } from 'react';
import type { SceneQuestionLoad } from '@shared/types';
import { Icon } from '../ui';
import { useDataRefresh } from '../../hooks';
import { t, tx } from '../../i18n';

/**
 * «Esta escena depende de N decisiones abiertas.»
 *
 * The band exists because of the thesis the whole "Analizar" group is built on: the author
 * never visits five sections to feed them, they open the scene they are about to write. So
 * the decisions that scene leans on — through its cast, its place and whatever its text
 * links to — have to be in front of them there, at the moment it matters, and not waiting
 * behind a menu item they would only click on a good day.
 *
 * It renders NOTHING when there is nothing pending. A permanently visible «0 decisiones» is
 * a line of furniture that teaches the eye to skip that part of the sheet, and the part of
 * the sheet it teaches you to skip is this one.
 */
export function SceneQuestionBand({ sceneId, onOpenQuestions }: { sceneId: string; onOpenQuestions?: () => void }) {
  const [load, setLoad] = useState<SceneQuestionLoad | null>(null);

  const refresh = () => {
    let active = true;
    void window.nodus.questionsForScene(sceneId).then((next) => {
      if (active) setLoad(next);
    });
    return () => {
      active = false;
    };
  };

  useEffect(refresh, [sceneId]);
  // Answering one from the section, or capturing a new one from another sheet, has to be
  // visible here without reopening the scene.
  useDataRefresh(async () => {
    setLoad(await window.nodus.questionsForScene(sceneId));
  });

  if (!load || load.count === 0) return null;

  return (
    <section
      data-testid="scene-question-band"
      data-blocking={load.blocking > 0 ? 'true' : undefined}
      className={`rounded-xl border p-3 ${
        load.blocking > 0 ? 'border-red-800/60 bg-red-950/10' : 'border-amber-800/50 bg-amber-950/10'
      }`}
    >
      <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-400">
        <Icon name="help" size={13} />
        {tx('Esta escena depende de {count} decisiones abiertas', { count: String(load.count) })}
      </h3>
      <ul className="space-y-0.5">
        {load.items.slice(0, 4).map((item) => (
          <li key={item.originKey ?? item.questionId} className="truncate text-[11px] text-neutral-300">
            · {item.question}
            {item.anchor && <span className="text-neutral-600"> · {item.anchor.title}</span>}
          </li>
        ))}
      </ul>
      {load.items.length > 4 && (
        <p className="mt-0.5 text-[10px] text-neutral-600">
          {tx('y {count} más', { count: String(load.items.length - 4) })}
        </p>
      )}
      {onOpenQuestions && (
        <button
          className="btn btn-ghost mt-2 w-full border border-neutral-700 text-[11px]"
          onClick={onOpenQuestions}
        >
          {t('Ir a decidirlas')}
        </button>
      )}
    </section>
  );
}
