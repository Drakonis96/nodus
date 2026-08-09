import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { AppSettings, NodiQuoteSelection, NodusApi } from '../shared/types';
import { ReaderSelectionActions } from '../src/components/ReaderSelectionActions';
import '../src/index.css';

const settings = { mascotEnabled: false } as AppSettings;

function Harness() {
  const readerRef = useRef<HTMLElement | null>(null);
  const [status, setStatus] = useState('Sin acción');
  useEffect(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => setStatus(`Copiado: ${text}`) },
    });
  }, []);
  const api = {
    getSettings: async () => settings,
    updateSettings: async (patch: Partial<AppSettings>) => {
      Object.assign(settings, patch);
      setStatus('Nodi activado');
      return settings;
    },
    quoteNodiSelection: async (text: string) => {
      setStatus(`Cita preparada: ${text}`);
      return { id: 'visual-quote', text, createdAt: Date.now() } satisfies NodiQuoteSelection;
    },
  } as unknown as NodusApi;
  window.nodus = api;

  return (
    <main className="min-h-screen bg-neutral-950 px-8 py-10 text-neutral-100">
      <section className="mx-auto max-w-3xl">
        <header className="mb-5 border-b border-neutral-800 pb-4">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-300">Deep Research</div>
          <h1 className="mt-1 text-3xl font-semibold">Memoria, archivo y territorio</h1>
          <p className="mt-2 text-sm text-neutral-400">Selecciona texto o haz clic derecho sobre una palabra.</p>
        </header>
        <article ref={readerRef} className="space-y-5 rounded-2xl border border-neutral-800 bg-neutral-900/70 p-8 text-[16px] leading-8 shadow-2xl">
          <h2 className="text-xl font-semibold">La lectura como investigación</h2>
          <p id="reader-copy">
            Los informes extensos conservan relaciones que desaparecen cuando el contexto se reduce a la parte visible de la pantalla.
            Una lectura rigurosa necesita mantener juntas las fuentes, las tensiones y las conclusiones del documento completo.
          </p>
          <p>
            El marcador devuelve al lector al pasaje decisivo, mientras que la cita permite formular una pregunta precisa sin volver a describir el fragmento.
          </p>
        </article>
        <ReaderSelectionActions targetRef={readerRef} contextId="visual-deep-research" />
        <output data-testid="selection-status" className="mt-5 block rounded-xl border border-indigo-800/60 bg-indigo-950/40 px-4 py-3 text-sm text-indigo-200">{status}</output>
      </section>
    </main>
  );
}

document.documentElement.classList.add('dark');
ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />);
