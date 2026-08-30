import React from 'react';
import ReactDOM from 'react-dom/client';
import type { NodusApi } from '../shared/types';
import { BrowserConnectorPairingRequestHost } from '../src/components/BrowserConnectorPairingRequestHost';
import { setActiveLang } from '../src/i18n';
import '../src/index.css';

setActiveLang('es');

window.nodus = {
  ...(window.nodus ?? {}),
  onBrowserConnectorPairingRequest: (listener) => {
    window.setTimeout(() => listener({
      requestId: 'visual-pairing-request',
      origin: 'chrome-extension://ilcclajjhofhieoljdjmikmfopfbamej',
      official: true,
    }), 0);
    return () => undefined;
  },
  resolveBrowserConnectorPairingRequest: async () => undefined,
} as unknown as NodusApi;

function Harness() {
  return (
    <main className="min-h-screen bg-neutral-100 p-8 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-3xl rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="text-2xl font-semibold">Biblioteca de Nodus</h1>
        <p className="mt-2 text-sm text-neutral-500">Vista de prueba del emparejamiento seguro con Chrome.</p>
      </div>
      <BrowserConnectorPairingRequestHost />
    </main>
  );
}

document.documentElement.classList.add('light');
ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />);
