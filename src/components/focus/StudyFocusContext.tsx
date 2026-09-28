import { createContext, useContext, useEffect, useMemo, useState, useRef, useCallback, type ReactNode } from 'react';
import type { FocusAction, FocusPhase, FocusPreferences, FocusSnapshot } from '@shared/studyFocus';

/** What `start` should record; leave a field undefined to keep the previous block's. */
export interface FocusStartOptions { subjectId?: string | null; task?: string | null }
/** The phase that has just ended; the notice text is chosen (and translated) when rendered. */
export type FocusNotice = FocusPhase;

interface FocusActions {
  setReduced: (value: boolean) => void;
  /**
   * Leaving the mode on purpose: back to the Concentración page, the block paused,
   * and — when a session is open — the question of whether to finish it.
   */
  exitFocusMode: () => Promise<void>;
  /** Answers that question: finish the session, or leave it paused for later. */
  resolveExitPrompt: (finish: boolean) => Promise<void>;
  act: (action: FocusAction, options?: FocusStartOptions) => Promise<void>;
  configure: (patch: Partial<FocusPreferences>) => Promise<void>;
  dismissNotice: () => void;
}
interface FocusContextValue extends FocusActions {
  snapshot: FocusSnapshot | null; reduced: boolean; error: unknown;
  notice: FocusNotice | null; exitPrompt: boolean;
}
/** What the focus mode shows. Changes only when the student edits it, never per tick. */
export interface FocusLayout { layout: Record<string, boolean>; enterOnStart: boolean; ready: boolean }
const EMPTY_LAYOUT: FocusLayout = { layout: {}, enterOnStart: true, ready: false };
const FocusLayoutContext = createContext<FocusLayout>(EMPTY_LAYOUT);
export const useStudyFocusLayout = () => useContext(FocusLayoutContext);
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
/** The header's focus button: opens the timer panel, or closes it when already open. */
export function toggleFocusTimer(): void {
  window.dispatchEvent(new CustomEvent(OPEN_FOCUS_TIMER_EVENT, { detail: 'toggle' }));
}
/** Marks a control that toggles the timer panel itself, so a press on it is not "outside". */
export const FOCUS_TIMER_TRIGGER_ATTRIBUTE = 'data-focus-timer-trigger';
/** Opens the "what does the focus mode show" dialog, from the rail or the header. */
export const OPEN_FOCUS_LAYOUT_EVENT = 'nodus:open-focus-layout';
export function openFocusLayout(): void {
  window.dispatchEvent(new Event(OPEN_FOCUS_LAYOUT_EVENT));
}
/** Asks the shell to show the Concentración page (the provider lives above it). */
export const SHOW_FOCUS_PAGE_EVENT = 'nodus:show-focus-page';

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
  const [exitPrompt, setExitPrompt] = useState(false);
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
      latest.current = null; setSnapshot(null); reduce(false); setNotice(null); setError(null); setExitPrompt(false);
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
  const setReduced = useCallback((value: boolean) => {
    // Only a Study vault has the mode; elsewhere the request is simply ignored.
    if (!vault.current) return;
    reduce(value);
    void window.nodus.setStudyFocusDistractions(value).catch(reason => { reduce(!value); fail(reason); });
  }, [fail]);
  const act = useCallback(async (action: FocusAction, options: FocusStartOptions = {}) => {
    const current = latest.current;
    if (!current) return;
    setError(null);
    try {
      const next = await window.nodus.actStudyFocus(current.vaultId, action, current.state.revision, options.subjectId, options.task);
      receive(next); setNotice(null);
      // A work block is what the mode is for, so starting or resuming one turns it on
      // unless the student has unticked "Modo concentración".
      if ((action === 'start' || action === 'resume') && next.state.status === 'running' && next.state.phase === 'work' && next.state.preferences.enterOnStart) setReduced(true);
    }
    catch (reason) { fail(reason); }
  }, [receive, fail, setReduced]);
  const exitFocusMode = useCallback(async () => {
    setReduced(false);
    window.dispatchEvent(new Event(SHOW_FOCUS_PAGE_EVENT));
    const status = latest.current?.state.status;
    if (status === 'running') await act('pause');
    if (status && status !== 'ready') setExitPrompt(true);
  }, [setReduced, act]);
  const resolveExitPrompt = useCallback(async (finish: boolean) => {
    setExitPrompt(false);
    if (finish) await act('finish');
  }, [act]);
  const configure = useCallback(async (patch: Partial<FocusPreferences>) => {
    const current = latest.current;
    if (!current) return;
    setError(null);
    try { receive(await window.nodus.configureStudyFocus(current.vaultId, patch)); }
    catch (reason) { fail(reason); }
  }, [receive, fail]);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const actions = useMemo<FocusActions>(() => ({ setReduced, exitFocusMode, resolveExitPrompt, act, configure, dismissNotice }), [setReduced, exitFocusMode, resolveExitPrompt, act, configure, dismissNotice]);
  const value = useMemo<FocusContextValue>(() => ({ ...actions, snapshot, reduced, error, notice, exitPrompt }), [actions, snapshot, reduced, error, notice, exitPrompt]);
  const preferences = snapshot?.state.preferences;
  const layoutKey = preferences ? JSON.stringify([preferences.layout, preferences.enterOnStart]) : '';
  const layout = useMemo<FocusLayout>(() => preferences ? { layout: preferences.layout ?? {}, enterOnStart: preferences.enterOnStart !== false, ready: true } : EMPTY_LAYOUT,
    // Keyed on the serialized layout so the one-second snapshot does not rebuild it.
    [layoutKey]);
  return <FocusAppearanceContext.Provider value={reduced}><FocusActionsContext.Provider value={actions}><FocusLayoutContext.Provider value={layout}><FocusContext.Provider value={value}>{children}</FocusContext.Provider></FocusLayoutContext.Provider></FocusActionsContext.Provider></FocusAppearanceContext.Provider>;
}
