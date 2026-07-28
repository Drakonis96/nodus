import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  BeatMark,
  BeatThreadKind,
  SceneAppearance,
  WorldBeat,
  WorldScene,
  WorldThread,
} from '@shared/types';
import {
  BEAT_MARK_LABEL,
  PARTY_SIDE_LABEL,
  THREAD_KIND_LABEL,
  markNeedsText,
  marksFor,
} from '@shared/worldThreads';
import { Icon } from '../ui';
import { t, tx } from '../../i18n';

/**
 * What moves in this scene.
 *
 * THIS IS THE STRIP THAT FILLS THREE SECTIONS. Conflicts, Arcs and Rules are readings of
 * one statement — "in this scene, this moves like so" — and the only moment an author is
 * willing to make that statement is while looking at the scene they are writing. A
 * separate screen per section would be three forms nobody opens; this is one row per
 * thread, answered with a click.
 *
 * The rows are PREPOPULATED from what the vault already knows: the threads whose parties
 * are in this scene's cast. The author answers rather than adds, which is the difference
 * between a tool that gets used and one that gets abandoned in week three.
 */
export function SceneThreadsPanel({
  scene,
  cast,
  onChanged,
}: {
  scene: WorldScene;
  cast: SceneAppearance[];
  onChanged: () => Promise<void>;
}) {
  const [threads, setThreads] = useState<WorldThread[]>([]);
  const [beats, setBeats] = useState<WorldBeat[]>([]);
  const [creating, setCreating] = useState<'conflict' | 'arc' | null>(null);
  const [title, setTitle] = useState('');

  const load = useCallback(async () => {
    const [nextThreads, nextBeats] = await Promise.all([
      window.nodus.listWorldThreads(),
      window.nodus.beatsForScene(scene.sceneId),
    ]);
    setThreads(nextThreads);
    setBeats(nextBeats);
  }, [scene.sceneId]);

  useEffect(() => {
    void load();
  }, [load, scene.updatedAt]);

  const castIds = useMemo(() => new Set(cast.map((appearance) => appearance.personId)), [cast]);
  const beatOf = (thread: WorldThread) => beats.find((beat) => beat.threadId === thread.threadId) ?? null;

  /**
   * Which threads deserve a row. Anything already moved here stays, always — hiding a
   * recorded judgement because the cast changed would silently lose it.
   */
  const rows = useMemo(() => {
    const relevant = threads.filter((thread) => {
      if (thread.status === 'archived') return false;
      if (beats.some((beat) => beat.threadId === thread.threadId)) return true;
      return thread.parties.some((party) => party.partyKind === 'character' && castIds.has(party.partyId));
    });
    return relevant.sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title)
    );
  }, [threads, beats, castIds]);

  const setBeat = async (thread: WorldThread, mark: BeatMark | null, text?: string | null) => {
    const kind = thread.kind as BeatThreadKind;
    if (mark === null) {
      await window.nodus.deleteWorldBeat(kind, thread.threadId, scene.sceneId);
    } else {
      const current = beatOf(thread);
      await window.nodus.setWorldBeat({
        threadKind: kind,
        threadId: thread.threadId,
        sceneId: scene.sceneId,
        mark,
        text: text !== undefined ? text : current?.text ?? null,
      });
    }
    await load();
    await onChanged();
  };

  const create = async () => {
    if (!title.trim() || !creating) return;
    const thread = await window.nodus.createWorldThread({ kind: creating, title: title.trim() });
    // The cast becomes the parties. For an arc that is the subject; for a conflict it is a
    // first guess the author corrects in the section — but a conflict created with nobody
    // in it is a conflict nobody can diagnose.
    if (cast.length) {
      await window.nodus.setThreadParties(
        thread.threadId,
        cast.map((appearance) => ({
          partyKind: 'character' as const,
          partyId: appearance.personId,
          side: creating === 'arc' ? ('subject' as const) : ('wants' as const),
        }))
      );
    }
    await window.nodus.setWorldBeat({
      threadKind: creating,
      threadId: thread.threadId,
      sceneId: scene.sceneId,
      mark: creating === 'arc' ? 'step' : 'raise',
    });
    setTitle('');
    setCreating(null);
    await load();
    await onChanged();
  };

  return (
    <section data-testid="scene-threads">
      <div className="mb-3 space-y-2">
        <div className="flex min-w-0 items-start gap-2">
          <h3 className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-500">
            {t('Qué se mueve aquí')}
          </h3>
          <span className="shrink-0 whitespace-nowrap rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
            {rows.length === 0
              ? t('Nada todavía')
              : tx('{count} de {total}', {
                  count: String(beats.length),
                  total: String(rows.length),
                })}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {(['conflict', 'arc'] as const).map((kind) => (
            <button
              key={kind}
              className="min-h-8 min-w-0 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 hover:border-indigo-300 hover:bg-indigo-100 dark:border-indigo-900/60 dark:bg-indigo-950/25 dark:text-indigo-300 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/45"
              onClick={() => setCreating(creating === kind ? null : kind)}
            >
              + {t(THREAD_KIND_LABEL[kind])}
            </button>
          ))}
        </div>
      </div>

      {creating && (
        <div className="mb-2 flex gap-2">
          <input
            className="input h-8 flex-1 text-sm"
            autoFocus
            placeholder={t(creating === 'arc' ? 'Qué cambia, y en quién' : 'Quién quiere qué contra quién')}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void create()}
          />
          <button className="btn btn-primary h-8 px-3 text-xs" disabled={!title.trim()} onClick={() => void create()}>
            {t('Crear')}
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-[11px] leading-4 text-neutral-600">
          {t('Aquí aparecerán los conflictos y arcos de quienes salen en la escena. Crea uno y esta escena empezará a contar para él.')}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((thread) => {
            const beat = beatOf(thread);
            return (
              <li
                key={thread.threadId}
                className="min-w-0 rounded-lg border border-neutral-200 bg-white p-2.5 dark:border-neutral-800 dark:bg-neutral-950/20"
                data-testid="scene-thread-row"
              >
                <div className="flex min-w-0 items-start gap-2">
                  <p className="min-w-0 flex-1 break-words text-xs font-medium leading-5 text-neutral-900 dark:text-neutral-100">
                    {thread.title}
                  </p>
                  <span className="mt-0.5 shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
                    {t(THREAD_KIND_LABEL[thread.kind])}
                  </span>
                </div>

                <div
                  className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(4rem,1fr))] gap-1"
                  data-testid="scene-thread-marks"
                >
                  {marksFor(thread.kind as BeatThreadKind).map((mark) => (
                    <button
                      key={mark}
                      aria-pressed={beat?.mark === mark}
                      onClick={() => void setBeat(thread, beat?.mark === mark ? null : mark)}
                      className={`min-h-8 min-w-0 whitespace-normal break-words rounded-md px-2 py-1 text-[10px] leading-3 ${
                        beat?.mark === mark
                          ? 'bg-indigo-600 font-medium text-white'
                          : 'border border-neutral-300 bg-white text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-200'
                      }`}
                    >
                      {t(BEAT_MARK_LABEL[mark])}
                    </button>
                  ))}
                </div>
                {/* Only a turn is asked to explain itself: "sube" explains itself, and a
                    text box on every row is a text box nobody fills. */}
                {beat && markNeedsText(beat.mark) && (
                  <textarea
                    key={`${beat.mark}:${beat.text ?? ''}`}
                    className="input mt-2 min-h-14 w-full resize-y py-2 text-xs leading-4"
                    placeholder={t('Qué cambia, en una frase')}
                    defaultValue={beat.text ?? ''}
                    onBlur={(event) => void setBeat(thread, beat.mark, event.target.value || null)}
                  />
                )}
                {thread.parties.length > 0 && (
                  <ul className="mt-2 space-y-0.5 border-t border-neutral-100 pt-2 dark:border-neutral-800/80">
                    {thread.parties.map((party) => (
                      <li key={`${party.partyKind}:${party.partyId}:${party.side}`} className="break-words text-[10px] leading-4 text-neutral-500">
                        <span className="font-medium text-neutral-700 dark:text-neutral-300">{party.partyName}</span>
                        {' · '}
                        {t(PARTY_SIDE_LABEL[party.side])}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {beats.length === 0 && rows.length > 0 && (
        <p className="mt-1 flex items-center gap-1 text-[10px] text-neutral-600">
          <Icon name="info" size={11} />
          {t('Esta escena todavía no mueve nada.')}
        </p>
      )}
    </section>
  );
}
