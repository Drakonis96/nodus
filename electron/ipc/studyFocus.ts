import { app, Notification, powerMonitor } from 'electron';
import { getDb, onBeforeDatabaseClose } from '../db/database';
import { getActiveVault } from '../vaults/vaultRegistry';
import { setMascotFocusSuppressed } from '../mascotWindow';
import { FocusService } from '../study/focusService';
import { getSettings } from '../db/settingsRepo';
import { uiText } from '../../shared/uiLanguage';
import { FOCUS_NOTIFICATION_COPY } from '../../shared/studyFocus';
import type { FocusAction, FocusPreferences, FocusSnapshot } from '../../shared/studyFocus';
import type { IpcContext } from './context';

export function registerStudyFocusIpc({ h, getWindow }: IpcContext) {
  let service: FocusService | null = null;
  let vaultId = '';
  const snapshot = (): FocusSnapshot => ({ vaultId, state: current().snapshot() });
  const emit = () => { if (service) getWindow()?.webContents.send('studyFocus:changed', snapshot()); };
  const current = () => {
    const vault = getActiveVault();
    if (vault.type !== 'estudio') throw new Error('Concentración está disponible en bóvedas de Estudio.');
    if (!service) {
      vaultId = vault.id;
      service = new FocusService(getDb(), undefined, undefined, state => {
        const payload = { vaultId, state };
        const win = getWindow();
        win?.webContents.send('studyFocus:completed', payload);
        if ((!win || !win.isFocused() || win.isMinimized()) && Notification.isSupported()) {
          const language = getSettings().uiLanguage;
          const body = state.phase === 'work' ? FOCUS_NOTIFICATION_COPY.workDone : FOCUS_NOTIFICATION_COPY.breakDone;
          new Notification({ title: uiText(language, FOCUS_NOTIFICATION_COPY.title), body: uiText(language, body), silent: true }).show();
        }
      });
    }
    return service;
  };
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
  const pause = () => { if (service) { service.pause(); emit(); } };
  onBeforeDatabaseClose(() => {
    pause(); service = null; vaultId = '';
    setMascotFocusSuppressed(false, false);
  });
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
    try { if (service) { service.tick(); emit(); } }
    catch (error) { console.error('[study-focus] checkpoint failed', error); }
  }, 1000);
  timer.unref();
  app.once('will-quit', () => clearInterval(timer));
}
