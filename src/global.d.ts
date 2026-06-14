import type { NodusApi } from '@shared/types';

declare global {
  interface Window {
    nodus: NodusApi;
  }
}

export {};
