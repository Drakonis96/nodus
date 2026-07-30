// Exposes a named subset of the bridge to one window class.
//
// Why a subset needs help at all: src/global.d.ts declares `window.nodus: NodusApi`
// for every renderer, so the compiler cannot tell a Nodi component that
// `listWorks` is not there. A gap therefore reaches the user as `undefined is not
// a function` in a window with no devtools open.
import { contextBridge } from 'electron';
import type { NodusApi } from '@shared/types';

/** The listed properties of `source`, and nothing else. */
export function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = source[key];
  return out;
}

/** Development builds only: `production` is what vite defines for a packaged app. */
function isDevelopment(): boolean {
  try {
    return process.env.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

/**
 * Expose `subset` as window.nodus for one window class.
 *
 * In development every method of `full` that the subset omits is exposed too, as a
 * function that throws and names the window. That is deliberately not a Proxy over
 * the exposed object: contextBridge copies the object into the main world at expose
 * time, so a `get` trap only ever fires for keys that are already there and the
 * renderer still sees a plain `undefined`. A stub survives the copy because it is a
 * real function.
 *
 * Packaged builds expose the subset alone — a missing method is `undefined`, which
 * is the point: the surface an always-on-top overlay carries is the surface an
 * exploit in it inherits.
 */
export function exposeWindowBridge(subset: Partial<NodusApi>, full: NodusApi, windowName: string): void {
  const api: Record<string, unknown> = { ...subset };
  if (isDevelopment()) {
    for (const key of Object.keys(full)) {
      if (key in api) continue;
      api[key] = () => {
        throw new Error(
          `nodus.${key} is not available in the ${windowName} window. Add it to shared/api/windows.ts if this window genuinely needs it.`,
        );
      };
    }
  }
  contextBridge.exposeInMainWorld('nodus', api);
}
