import { app, Notification, powerMonitor } from 'electron';
import { getActiveVault } from '../vaults/vaultRegistry';
import { setMascotFocusSuppressed } from '../mascotWindow';
import { closeGlobalFocusRuntime, getGlobalFocusService, getGlobalFocusSnapshot, onGlobalFocusCompleted, onGlobalFocusContextChanged, pauseGlobalFocus } from '../study/focusRuntime';
import { getSettings } from '../db/settingsRepo';
import { uiText } from '../../shared/uiLanguage';
import { FOCUS_NOTIFICATION_COPY } from '../../shared/studyFocus';
import type { FocusAction, FocusPreferences } from '../../shared/studyFocus';
import type { IpcContext } from './context';

export function registerStudyFocusIpc({ h, getWindow }: IpcContext) {
  let initialized = false;
  const snapshot = getGlobalFocusSnapshot;
  const emit = () => { if (initialized) getWindow()?.webContents.send('studyFocus:changed', snapshot()); };
  const current = () => { initialized = true; snapshot(); return getGlobalFocusService(); };
  onGlobalFocusContextChanged(emit);
  onGlobalFocusCompleted(payload => {
    const state = payload.state;
    const win = getWindow();
    win?.webContents.send('studyFocus:completed', payload);
    if ((!win || !win.isFocused() || win.isMinimized()) && Notification.isSupported()) {
      const language = getSettings().uiLanguage;
      const body = state.phase === 'work' ? FOCUS_NOTIFICATION_COPY.workDone : FOCUS_NOTIFICATION_COPY.breakDone;
      new Notification({ title: uiText(language, FOCUS_NOTIFICATION_COPY.title), body: uiText(language, body), silent: true }).show();
    }
  });
  const checkVault = (id: string) => { if (id !== getActiveVault().id) throw new Error('La bóveda ha cambiado.'); };
  h('studyFocus:get', () => { current(); return snapshot(); });
  h('studyFocus:configure', (_e, id: string, patch: Partial<FocusPreferences>) => {
    checkVault(id); current().configure(patch); emit(); return snapshot();
  });
  h('studyFocus:act', (_e, id: string, action: FocusAction, revision: number, subjectId?: string | null, task?: string | null) => {
    checkVault(id);
    if (subjectId !== undefined && subjectId !== null && typeof subjectId !== 'string') throw new Error('Valor inválido.');
    if (task !== undefined && task !== null && typeof task !== 'string') throw new Error('Valor inválido.');
    current().act(action, revision, subjectId, task); emit(); return snapshot();
  });
  h('studyFocus:stats', () => current().stats());
  h('studyFocus:distractions', (_e, value: boolean) => {
    if (typeof value !== 'boolean') throw new Error('Valor inválido.');
    if (value) current();
    setMascotFocusSuppressed(value);
  });
  const pause = () => { pauseGlobalFocus(); emit(); };
  powerMonitor.on('suspend', pause);
  app.on('before-quit', pause);
  // Windows created after macOS closes its last main window need the same hook.
  const hookWindow = () => {
    const win = getWindow();
    if (win && !hooked.has(win.id)) {
      hooked.add(win.id);
      win.on('close', () => { pause(); setMascotFocusSuppressed(false, false); });
    }
  };
  const hooked = new Set<number>();
  hookWindow();
  app.on('browser-window-created', (_event, win) => {
    win.on('close', () => { if (win === getWindow() && !hooked.has(win.id)) { pause(); setMascotFocusSuppressed(false, false); } });
  });
  const timer = setInterval(() => {
    hookWindow();
    try { if (initialized) { current().tick(); emit(); } }
    catch (error) { console.error('[study-focus] checkpoint failed', error); }
  }, 1000);
  timer.unref();
  app.once('will-quit', () => { clearInterval(timer); closeGlobalFocusRuntime(); });
}
