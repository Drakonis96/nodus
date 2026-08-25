import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { DeepResearchQueueStrip, type QueueStripItem } from '../src/components/DeepResearchQueueStrip';
import '../src/index.css';

const initialItems: QueueStripItem[] = [
  {
    id: 'current',
    title: 'Omisiones en la literatura y fotografía de viajes',
    status: 'running',
    progress: { phase: 'planning', message: 'Planificando secciones' },
    error: null,
    origin: 'app',
    enqueuedAt: '2026-08-25T20:21:00.000Z',
  },
  {
    id: 'second',
    title: 'La construcción visual del turismo durante el franquismo',
    status: 'queued',
    progress: null,
    error: null,
    origin: 'app',
    enqueuedAt: '2026-08-25T20:22:00.000Z',
  },
  {
    id: 'third',
    title: 'Memoria, archivo y cultura material en la posguerra',
    status: 'queued',
    progress: null,
    error: null,
    origin: 'mcp',
    enqueuedAt: '2026-08-25T20:23:00.000Z',
  },
];

function Harness() {
  const [active, setActive] = useState(initialItems);

  const advance = () => setActive((items) => items.slice(1).map((item, index) => ({
    ...item,
    status: index === 0 ? 'running' : 'queued',
    progress: index === 0 ? { phase: 'document_preparation', message: 'Preparando evidencia documental' } : null,
  })));

  return (
    <main className="min-h-screen bg-neutral-950 px-8 py-12 text-neutral-100">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl">
        <DeepResearchQueueStrip
          active={active}
          failed={[]}
          running={active.length > 0}
          onRemove={(item) => setActive((items) => items.filter((candidate) => candidate.id !== item.id))}
          onClearFinished={() => undefined}
        />
        <div className="flex justify-end px-4 py-3">
          <button
            type="button"
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            onClick={advance}
            disabled={active.length < 2}
          >
            Avanzar cola
          </button>
        </div>
      </div>
    </main>
  );
}

document.documentElement.classList.add('dark');
ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />);
