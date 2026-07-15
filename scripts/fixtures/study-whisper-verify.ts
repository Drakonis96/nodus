import {
  ensureLocalWhisperModel,
  transcribeLocalWhisperDetailed,
} from '../../src/lib/stt/localWhisper';

type VerifyRequest = { audioUrl: string; model: string; language: string };
type VerifyResult = {
  text: string;
  chunks: Array<{ text: string; timestamp: [number | null, number | null] | null }>;
  downloadProgress: number;
  partialUpdates: number;
  lastPartial: string;
  durationMs: number;
};

declare global {
  interface Window {
    verifyStudyWhisper: (request: VerifyRequest) => Promise<VerifyResult>;
  }
}

window.verifyStudyWhisper = async ({ audioUrl, model, language }) => {
  let downloadProgress = 0;
  let partialUpdates = 0;
  let lastPartial = '';
  const startedAt = performance.now();
  await ensureLocalWhisperModel(model, (fraction) => { downloadProgress = Math.max(downloadProgress, fraction); });
  const response = await fetch(audioUrl);
  if (!response.ok) throw new Error(`Could not load fixture ${audioUrl}: ${response.status}`);
  const result = await transcribeLocalWhisperDetailed(await response.blob(), model, language, undefined, (text) => {
    partialUpdates += 1;
    lastPartial = text;
  });
  return {
    ...result,
    downloadProgress,
    partialUpdates,
    lastPartial,
    durationMs: Math.round(performance.now() - startedAt),
  };
};

document.documentElement.dataset.whisperVerifier = 'ready';
document.getElementById('status')!.textContent = 'Local Whisper verifier ready.';

export {};
