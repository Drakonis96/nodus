import { createContext, useContext, useEffect, useMemo, useState, useRef, useCallback, type ReactNode } from 'react';
import type { FocusAction, FocusPhase, FocusPreferences, FocusSnapshot } from '@shared/studyFocus';

/** What `start` should record; leave a field undefined to keep the previous block's. */
export interface FocusStartOptions { subjectId?: string | null; task?: string | null }
/** The phase that has just ended; the notice text is chosen (and translated) when rendered. */
export type FocusNotice = FocusPhase;

interface FocusActions {
  setReduced: (value: boolean) => void;
  act: (action: FocusAction, options?: FocusStartOptions) => Promise<void>;
  configure: (patch: Partial<FocusPreferences>) => Promise<void>;
  dismissNotice: () => void;
}
interface FocusContextValue extends FocusActions {
  snapshot: FocusSnapshot | null; reduced: boolean; error: unknown;
  notice: FocusNotice | null;
}
// The editor and shell consume only appearance and actions, so the one-second clock
// does not rerender the working document or the entire application.
const FocusAppearanceContext = createContext(false);
export const useStudyFocusReduced = () => useContext(FocusAppearanceContext);
const FocusActionsContext = createContext<FocusActions | null>(null);
export const useStudyFocusActions = () => useContext(FocusActionsContext);
const FocusContext = createContext<FocusContextValue | null>(null);
export const useStudyFocus = () => useContext(FocusContext);

/** The palette and the focus rail open the header's timer panel through this event. */
export const OPEN_FOCUS_TIMER_EVENT = 'nodus:open-focus-timer';
export function openFocusTimer(): void {
  window.dispatchEvent(new Event(OPEN_FOCUS_TIMER_EVENT));
}

function chime() {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(0.08, context.currentTime + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.6);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + 0.65);
    oscillator.onended = () => { void context.close(); };
  } catch { /* In-app notice remains available when audio is unavailable. */ }
}
export function StudyFocusProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<FocusSnapshot | null>(null);
  const [reduced, reduce] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<FocusNotice | null>(null);
  const vault = useRef<string | null>(null);
  const latest = useRef<FocusSnapshot | null>(null);
  const fail = useCallback((reason: unknown) => setError(reason ?? null), []);
  const receive = useCallback((next: FocusSnapshot) => {
    if (next.vaultId !== vault.current) return;
    latest.current = next; setSnapshot(next);
  }, []);
  useEffect(() => {
    if (!window.nodus.getStudyFocus) return;
    let alive = true;
    let generation = 0;
    const open = async (active: { id: string; type: string } | null) => {
      const token = ++generation;
      if (!alive) return;
      vault.current = active?.type === 'estudio' ? active.id : null;
      latest.current = null; setSnapshot(null); reduce(false); setNotice(null); setError(null);
      void window.nodus.setStudyFocusDistractions(false).catch(fail);
      if (vault.current) {
        try { const next = await window.nodus.getStudyFocus(); if (alive && token === generation) receive(next); }
        catch (reason) { if (alive && token === generation) fail(reason); }
      }
    };
    const offVault = window.nodus.onVaultChanged(open);
    const offState = window.nodus.onStudyFocusChanged(receive);
    const offComplete = window.nodus.onStudyFocusCompleted(next => {
      if (next.vaultId !== vault.current) return;
      receive(next);
      setNotice(next.state.phase);
      if (next.state.preferences.sound) chime();
    });
    const initial = generation;
    void window.nodus.getActiveVault().then(active => { if (generation === initial) void open(active); }).catch(fail);
    return () => { alive = false; offVault(); offState(); offComplete(); };
  }, [receive, fail]);
  const act = useCallback(async (action: FocusAction, options: FocusStartOptions = {}) => {
    const current = latest.current;
    if (!current) return;
    setError(null);
    try { receive(await window.nodus.actStudyFocus(current.vaultId, action, current.state.revision, options.subjectId, options.task)); setNotice(null); }
    catch (reason) { fail(reason); }
  }, [receive, fail]);
  const configure = useCallback(async (patch: Partial<FocusPreferences>) => {
    const current = latest.current;
    if (!current) return;
    setError(null);
    try { receive(await window.nodus.configureStudyFocus(current.vaultId, patch)); }
    catch (reason) { fail(reason); }
  }, [receive, fail]);
  const setReduced = useCallback((value: boolean) => {
    // Only a Study vault has the mode; elsewhere the request is simply ignored.
    if (!vault.current) return;
    reduce(value);
    void window.nodus.setStudyFocusDistractions(value).catch(reason => { reduce(!value); fail(reason); });
  }, [fail]);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const actions = useMemo<FocusActions>(() => ({ setReduced, act, configure, dismissNotice }), [setReduced, act, configure, dismissNotice]);
  const value = useMemo<FocusContextValue>(() => ({ ...actions, snapshot, reduced, error, notice }), [actions, snapshot, reduced, error, notice]);
  return <FocusAppearanceContext.Provider value={reduced}><FocusActionsContext.Provider value={actions}><FocusContext.Provider value={value}>{children}</FocusContext.Provider></FocusActionsContext.Provider></FocusAppearanceContext.Provider>;
}
