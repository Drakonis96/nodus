import { createContext, useContext, useEffect, useState, useRef, useCallback, type ReactNode } from 'react';
import type { FocusAction, FocusPreferences, FocusSnapshot } from '@shared/studyFocus';

interface FocusContextValue {
  snapshot: FocusSnapshot | null; reduced: boolean; error: string | null;
  notice: string | null; dismissNotice: () => void;
  setReduced: (value: boolean) => void;
  act: (action: FocusAction, subjectId?: string | null) => Promise<void>;
  configure: (patch: Partial<FocusPreferences>) => Promise<void>;
}
// The editor and shell consume only appearance, so the one-second clock does
// not rerender the working document or the entire application.
const FocusAppearanceContext = createContext(false);
export const useStudyFocusReduced = () => useContext(FocusAppearanceContext);
const FocusContext = createContext<FocusContextValue | null>(null);
export const useStudyFocus = () => useContext(FocusContext);
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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const vault = useRef<string | null>(null);
  const latest = useRef<FocusSnapshot | null>(null);
  const fail = (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason));
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
      setNotice(next.state.phase === 'work' ? 'Bloque completado. Tu descanso está listo.' : 'Descanso completado. Puedes comenzar otro bloque.');
      if (next.state.preferences.sound) chime();
    });
    const initial = generation;
    void window.nodus.getActiveVault().then(active => { if (generation === initial) void open(active); }).catch(fail);
    return () => { alive = false; offVault(); offState(); offComplete(); };
  }, [receive]);
  const act = useCallback(async (action: FocusAction, subjectId?: string | null) => {
    const current = latest.current;
    if (!current) return;
    setError(null);
    try { receive(await window.nodus.actStudyFocus(current.vaultId, action, current.state.revision, subjectId)); setNotice(null); }
    catch (reason) { fail(reason); }
  }, [receive]);
  const configure = useCallback(async (patch: Partial<FocusPreferences>) => {
    const current = latest.current;
    if (!current) return;
    setError(null);
    try { receive(await window.nodus.configureStudyFocus(current.vaultId, patch)); }
    catch (reason) { fail(reason); }
  }, [receive]);
  const setReduced = (value: boolean) => {
    reduce(value);
    void window.nodus.setStudyFocusDistractions(value).catch(reason => { reduce(!value); fail(reason); });
  };
  return <FocusAppearanceContext.Provider value={reduced}><FocusContext.Provider value={{ snapshot, reduced, setReduced, act, configure, error, notice, dismissNotice: () => setNotice(null) }}>{children}</FocusContext.Provider></FocusAppearanceContext.Provider>;
}
