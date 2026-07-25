import type { NodusApi } from '@shared/types';

declare global {
  interface Window {
    nodus: NodusApi;
  }

  /** App version, injected at build time from package.json (see vite.config.ts). */
  const __APP_VERSION__: string;

  /**
   * Vite's build-time file glob, declared narrowly here rather than by referencing
   * `vite/client`, whose own `*.svg`/`*.webp` module declarations would collide with
   * the ones in src/assets.d.ts. Used to pick up optional tutorial poster frames.
   */
  interface ImportMeta {
    glob<T = unknown>(
      pattern: string,
      options?: { eager?: boolean; query?: string; import?: string },
    ): Record<string, T>;
  }
}

export {};
