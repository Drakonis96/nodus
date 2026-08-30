import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { DocumentUnderstandingState, NodusApi, PassageEmbeddingProgress, WorkPassageStatus, WorkView } from '../shared/types';
import { deriveWorkStatus } from '../src/libraryStatus';
import { WorkStatusModal } from '../src/views/WorkStatusModal';
import '../src/index.css';

const baseWork = {
  nodus_id: 'work-1', zotero_key: 'Z1', title: 'Bienvenido, Mr. Turismo: Cultura visual del “boom” en España',
  authors: [], themes: ['fotografía', 'iconografía', 'cultura visual', 'franquismo', 'sociedad', 'turismo'],
  zoteroTags: [], ideaCount: 124, year: 2024, source_type: 'pdf', resolved_source_type: 'pdf',
  light_status: 'done', deep_status: 'done', deep_error: null, summary_status: 'done',
  light_hash: 'light', deep_hash: 'current-text', resolved_text_hash: 'current-text', text_block_reason: null,
} as unknown as WorkView;

const completeProgress: PassageEmbeddingProgress = {
  running: false, paused: false, currentWorkIndex: 0, totalWorks: 1, currentWorkTitle: baseWork.title,
  passagesEmbedded: 812, totalPassages: 812, currentPassageIndex: 811, currentWorkPassages: 812, error: null,
};
let liveProgress = completeProgress;
const listeners = new Set<(progress: PassageEmbeddingProgress) => void>();

function Harness() {
  const [passage, setPassage] = useState<WorkPassageStatus>({
    nodus_id: baseWork.nodus_id, totalPassages: 812, status: 'complete', outdatedReason: null,
  });
  const [documentStatus, setDocumentStatus] = useState<DocumentUnderstandingState>('missing');
  const [open, setOpen] = useState(true);

  window.nodus = {
    ...(window.nodus ?? {}),
    startPassageEmbedding: async () => {
      liveProgress = { ...completeProgress, running: true, passagesEmbedded: 600, currentPassageIndex: 599 };
      listeners.forEach((listener) => listener(liveProgress));
      window.setTimeout(() => {
        setPassage({ nodus_id: baseWork.nodus_id, totalPassages: 812, status: 'complete', outdatedReason: null });
        liveProgress = completeProgress;
        listeners.forEach((listener) => listener(liveProgress));
      }, 2_500);
    },
    getPassageStatus: async () => liveProgress,
    onPassageProgress: (listener: (progress: PassageEmbeddingProgress) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    enqueueDocumentProfile: async () => {
      setDocumentStatus('queued');
      window.setTimeout(() => setDocumentStatus('current'), 10_000);
    },
  } as unknown as NodusApi;

  const status = deriveWorkStatus(
    baseWork,
    { nodus_id: baseWork.nodus_id, totalIdeas: 124, embeddedIdeas: 124, complete: true },
    passage,
  );

  return <main className="min-h-screen bg-neutral-100 p-8 text-neutral-900">
    <button className="btn btn-primary" onClick={() => setOpen(true)}>Abrir estado</button>
    {open && <WorkStatusModal
      work={baseWork}
      status={status}
      documentStatus={documentStatus}
      onClose={() => setOpen(false)}
      onChanged={() => undefined}
      onOpenDocument={() => undefined}
    />}
  </main>;
}

document.documentElement.classList.add('light');
ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />);
