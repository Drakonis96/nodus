import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings, ModelRef } from '@shared/types';
import { researchEffortFor, withResearchEffort, type ResearchEffort } from '@shared/researchReasoning';
import { useResearchModelInfo } from './useResearchModelInfo';

/**
 * The thinking level for the selected model, remembered per provider+model so reopening a
 * model starts where the user left it. A model the user never set starts on the middle of
 * the levels it publishes (medium, or the level nearest to it). A level belongs to the
 * model, not to the vault or the surface that was open when it was picked, so the memory
 * lives in the app-wide preference store and the Research chat, Deep Research and
 * Immersion share it.
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
  // The map as this session knows it, and the picks that produced it.
  const [memory, setMemory] = useState<Record<string, ResearchEffort>>(() => settings.researchEffortByModel ?? {});
  const memoryRef = useRef(memory);
  const session = useRef<Array<{ model: ModelRef | null; effort: ResearchEffort }>>([]);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef(model);
  latest.current = model;
  // The live ladder of a catalogue-driven model: until it arrives, its middle is unknown.
  const info = useResearchModelInfo(model);

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
        memoryRef.current = session.current.reduce(
          (map, pick) => withResearchEffort(map, pick.model, pick.effort),
          fresh.researchEffortByModel ?? {}
        );
        setMemory(memoryRef.current);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const choose = useCallback((effort: ResearchEffort) => {
    session.current = [...session.current, { model: latest.current, effort }];
    memoryRef.current = withResearchEffort(memoryRef.current, latest.current, effort);
    setMemory(memoryRef.current);
    const next = memoryRef.current;
    writes.current = writes.current
      .catch(() => undefined)
      .then(() => window.nodus.updateSettings({ researchEffortByModel: next }));
  }, []);

  // Derived rather than stored: switching model shows the level remembered for the new one,
  // or its middle level, while the current pick keeps applying to the model it was picked for.
  return [researchEffortFor(memory, model, info), choose];
}
