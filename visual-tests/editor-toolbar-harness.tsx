// Milkdown's selection toolbar, with the pointer anchoring the note editors use.
// Mounting Crepe alone keeps the check on the placement itself, away from the
// vault plumbing the study and teaching editors need.
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Crepe } from '@milkdown/crepe';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/classic.css';
import { anchorToolbarToPointer } from '../src/components/editor/pointerAnchoredToolbar';
import '../src/index.css';

const NOTE = `# Cuaderno de apuntes

Selecciona un párrafo completo arrastrando el puntero de arriba abajo: la cinta
de opciones debe aparecer encima del punto donde sueltas el ratón, no encima del
primer clic.

Una segunda línea permite comprobar el caso contrario, arrastrando de abajo
arriba, y también la selección hecha con el teclado, que conserva la colocación
original de Milkdown porque no hay puntero al que seguir.`;

function Harness() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Sin selección');

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const crepe = new Crepe({ root, defaultValue: NOTE, features: { [Crepe.Feature.AI]: false } });
    let detach: (() => void) | null = null;
    let observer: MutationObserver | null = null;
    let anchored: HTMLElement | null = null;
    void crepe.create().then(() => {
      const attach = () => {
        const toolbar = root.querySelector<HTMLElement>('.milkdown-toolbar')
          ?? root.parentElement?.querySelector<HTMLElement>('.milkdown-toolbar')
          ?? null;
        if (!toolbar || anchored === toolbar) return;
        detach?.();
        anchored = toolbar;
        detach = anchorToolbarToPointer(root.parentElement ?? root, toolbar);
      };
      attach();
      observer = new MutationObserver(attach);
      observer.observe(root.parentElement ?? root, { childList: true, subtree: true });
    });
    const report = () => setStatus(window.getSelection()?.toString().trim() ? 'Selección activa' : 'Sin selección');
    document.addEventListener('selectionchange', report);
    return () => {
      document.removeEventListener('selectionchange', report);
      observer?.disconnect();
      detach?.();
      void crepe.destroy();
    };
  }, []);

  return (
    <main className="min-h-screen bg-neutral-950 px-8 py-10 text-neutral-100">
      <section className="mx-auto max-w-3xl">
        <header className="mb-5 border-b border-neutral-800 pb-4">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Apuntes</div>
          <h1 className="mt-1 text-3xl font-semibold">Cinta de opciones del editor</h1>
        </header>
        <div className="study-milkdown rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4" ref={rootRef} />
        <output data-testid="editor-toolbar-status" className="mt-5 block rounded-xl border border-teal-800/60 bg-teal-950/40 px-4 py-3 text-sm text-teal-200">{status}</output>
      </section>
    </main>
  );
}

document.documentElement.classList.add('dark');
ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />);
