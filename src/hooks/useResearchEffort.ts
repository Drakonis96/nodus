import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings, ModelRef } from '@shared/types';
import { researchEffortFor, researchEffortMemoryKey, withResearchEffort, type ResearchEffort } from '@shared/researchReasoning';

/**
 * The Research composer's thinking level for the selected model, remembered per
 * provider+model so reopening a model starts where the user left it instead of at
 * Standard. A level belongs to the model, not to the vault that was open when it was
 * picked, so the memory lives in the app-wide preference store.
 *
 * The level is saved as soon as it is picked: the slider has at most eight stops, so
 * there is nothing to debounce, and a level chosen right before the app closes is
 * already on disk. Each write carries the whole map, so writes are serialised — an
 * out-of-order pair would otherwise restore a level the user already dragged past.
 */
export function useResearchEffort(
  settings: AppSettings,
  model: ModelRef | null
): [ResearchEffort, (effort: ResearchEffort) => void] {
  const key = researchEffortMemoryKey(model);
  const [chosen, setChosen] = useState<{ key: string | null; effort: ResearchEffort }>(
    () => ({ key, effort: researchEffortFor(settings.researchEffortByModel, model) })
  );
  // The map as this session knows it, and the picks that produced it.
  const memory = useRef<Record<string, ResearchEffort>>(settings.researchEffortByModel ?? {});
  const session = useRef<Array<{ model: ModelRef | null; effort: ResearchEffort }>>([]);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef(model);
  latest.current = model;

  // Read fresh on mount and take the remembered levels from the user's own file: the
  // settings prop is App state and can be older than the last session. The disk snapshot is
  // the base and this session's picks are replayed over it, so a level picked while the
  // read was in flight is not reverted by a snapshot that predates it.
  useEffect(() => {
    let active = true;
    void window.nodus
      .getSettings()
      .then((fresh) => {
        if (!active) return;
        memory.current = session.current.reduce(
          (map, pick) => withResearchEffort(map, pick.model, pick.effort),
          fresh.researchEffortByModel ?? {}
        );
        const keyNow = researchEffortMemoryKey(latest.current);
        setChosen((chosen) => chosen.key === keyNow && session.current.length > 0
          // A level the user already picked for this model stands. The fresh map still
          // reaches every other model, through `memory`.
          ? chosen
          : { key: keyNow, effort: researchEffortFor(memory.current, latest.current) });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const choose = useCallback((effort: ResearchEffort) => {
    setChosen({ key: researchEffortMemoryKey(latest.current), effort });
    session.current = [...session.current, { model: latest.current, effort }];
    memory.current = withResearchEffort(memory.current, latest.current, effort);
    writes.current = writes.current
      .catch(() => undefined)
      .then(() => window.nodus.updateSettings({ researchEffortByModel: memory.current }));
  }, []);

  // Derived rather than stored: switching model shows the level remembered for the new one,
  // while the current pick keeps applying to the model it was picked for.
  return [chosen.key === key ? chosen.effort : researchEffortFor(memory.current, model), choose];
}
