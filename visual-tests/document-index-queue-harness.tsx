import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { DocumentIndexJob, DocumentIndexProgress, DocumentUnderstandingState, NodusApi } from '../shared/types';
import { DocumentIndexProgressBar } from '../src/components/DocumentIndexProgressBar';
import { DocumentIndexManager } from '../src/views/DocumentIndexManager';
import '../src/index.css';

const stamp = '2026-08-25T20:30:00.000Z';
const running = (jobId: string, title: string, currentUnit: number, totalUnits: number, progress: number, createdAt: string): DocumentIndexJob => ({
  jobId, campaignId: 'campaign', vaultId: 'vault', nodusId: jobId, title,
  priority: 0, reason: 'manual', status: 'running', phase: 'analyzing_sections', progress,
  progressMessage: `Analizando sección ${currentUnit} de ${totalUnits}…`, currentUnit, totalUnits,
  sourceFingerprint: null, generatorModel: null, auditorModel: null, attempts: 1, maxAttempts: 5,
  error: null, createdAt, updatedAt: stamp,
});
const queued = (index: number): DocumentIndexJob => ({
  ...running(`queued-${index}`, `Obra documental pendiente ${index}`, 0, 0, 0, `2026-08-25T20:${31 + index}:00.000Z`),
  status: 'queued', phase: 'queued', progressMessage: null, currentUnit: null, totalUnits: null,
});

let snapshot: DocumentIndexProgress = {
  campaigns: [{
    campaignId: 'campaign', vaultId: 'vault', mode: 'manual', status: 'running', includeArchived: false,
    totalJobs: 1194, completedJobs: 0, failedJobs: 0, runningJobs: 2, queuedJobs: 1192, pausedJobs: 0,
    estimatedUnits: 1194, completedUnits: 0.24, inputTokens: 0, outputTokens: 0,
    estimatedCostUsd: null, error: null, createdAt: stamp, updatedAt: stamp,
  }],
  jobs: [
    running('first', 'Imaginarios y representaciones de España durante el franquismo', 2, 14, 0.14, '2026-08-25T20:30:00.000Z'),
    running('second', 'El evangelio fascista: la formación de la cultura política', 1, 10, 0.10, '2026-08-25T20:30:01.000Z'),
    ...Array.from({ length: 8 }, (_, index) => queued(index + 1)),
  ],
  active: 2, queued: 1192, failed: 0,
};
const listeners = new Set<(progress: DocumentIndexProgress) => void>();
const emit = () => listeners.forEach((listener) => listener(structuredClone(snapshot)));
const statuses = Array.from({ length: 14 }, (_, index) => ({ nodusId: `prepared-${index}`, status: 'current' as DocumentUnderstandingState }));

window.nodus = {
  getDocumentIndexProgress: async () => structuredClone(snapshot),
  onDocumentIndexProgress: (listener: (progress: DocumentIndexProgress) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  getDocumentProfileStatuses: async () => statuses,
  setDocumentIndexCampaignStatus: async () => undefined,
  startDocumentIndexCampaign: async () => snapshot.campaigns[0],
} as unknown as NodusApi;

function Harness() {
  const [managerOpen, setManagerOpen] = useState(false);
  const nextChunk = () => {
    const first = snapshot.jobs.find((job) => job.jobId === 'first')!;
    const second = snapshot.jobs.find((job) => job.jobId === 'second')!;
    first.currentUnit = Math.min((first.currentUnit ?? 0) + 1, first.totalUnits ?? 1);
    first.progress += 0.04;
    first.updatedAt = '2026-08-25T20:40:02.000Z';
    second.updatedAt = '2026-08-25T20:40:03.000Z';
    snapshot.campaigns[0].completedUnits = first.progress + second.progress;
    emit();
  };

  return <main className="flex min-h-screen flex-col bg-neutral-50 text-neutral-900">
    <div className="mx-auto w-full max-w-6xl flex-1 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Biblioteca</h1>
        <div className="flex gap-2">
          <button className="btn btn-ghost border border-neutral-300" onClick={nextChunk}>Siguiente chunk</button>
          <button className="btn btn-primary" onClick={() => setManagerOpen(true)}>Índice documental</button>
        </div>
      </div>
      <div className="mt-8 rounded-xl border border-neutral-200 bg-white p-5">
        <span className="library-status-pill library-status-warning inline-flex items-center rounded-md border px-2 py-1 text-xs">Solo texto</span>
      </div>
    </div>
    <DocumentIndexProgressBar />
    {managerOpen && <DocumentIndexManager vaultId="vault" onClose={() => setManagerOpen(false)} />}
  </main>;
}

document.documentElement.classList.add('light');
ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />);
