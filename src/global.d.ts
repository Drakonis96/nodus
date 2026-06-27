import type { NodusApi } from '@shared/types';

declare global {
  interface Window {
    nodus: NodusApi;
  }

  /** App version, injected at build time from package.json (see vite.config.ts). */
  const __APP_VERSION__: string;
}

export {};
