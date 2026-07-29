import OpenAI, { toFile } from 'openai';
import {
  DEFAULT_OPENAI_TRANSCRIPTION_MODEL,
  isOpenAiDiarizationModel,
  isOpenAiStudySttModel,
  type StudySttRequest,
  type StudySttResult,
} from '@shared/sttModels';
import { getSettings } from '../db/settingsRepo';
import { getApiKey } from '../secrets/secretStore';

export { DEFAULT_OPENAI_TRANSCRIPTION_MODEL };

export function resolveStudyTranscriptionModel(requested?: string | null): string {
  const configured = getSettings().transcriptionModel;
  const candidate = requested?.trim()
    || (configured?.provider === 'openai' ? configured.model.trim() : '')
    || DEFAULT_OPENAI_TRANSCRIPTION_MODEL;
  if (!isOpenAiStudySttModel(candidate)) {
    throw new Error(`Modelo de transcripción OpenAI no compatible: ${candidate}`);
  }
  return candidate;
}

export function studyAudioFileExtension(mimeType: string): string {
  if (/wav/i.test(mimeType)) return 'wav';
  if (/mpeg|mp3/i.test(mimeType)) return 'mp3';
  if (/ogg/i.test(mimeType)) return 'ogg';
  if (/mp4|m4a/i.test(mimeType)) return 'm4a';
  return 'webm';
}

export async function transcribeStudyAudio(request: StudySttRequest): Promise<StudySttResult> {
  if (request.provider && request.provider !== 'openai') {
    throw new Error(`El motor OpenAI no puede procesar una solicitud ${request.provider}.`);
  }
  const key = getApiKey('openai');
  if (!key) throw new Error('Falta la clave de OpenAI para usar el dictado externo. Configúrala en Ajustes.');
  const bytes = request.audioBytes instanceof Uint8Array ? request.audioBytes : new Uint8Array(request.audioBytes);
  if (bytes.byteLength === 0) throw new Error('La grabación está vacía.');
  const model = resolveStudyTranscriptionModel(request.model);
  const client = new OpenAI({ apiKey: key, timeout: 180_000, maxRetries: 1 });
  const file = await toFile(bytes, `dictation.${studyAudioFileExtension(request.mimeType)}`, { type: request.mimeType || 'audio/webm' });
  const language = request.language?.trim().toLocaleLowerCase();
  const diarization = isOpenAiDiarizationModel(model);
  const result = await client.audio.transcriptions.create({
    file,
    model,
    response_format: diarization ? 'diarized_json' : 'json',
    chunking_strategy: diarization ? 'auto' : undefined,
    language: language && language !== 'auto' ? language.split('-')[0] : undefined,
    // The diarization endpoint rejects prompts. Keeping that incompatibility out
    // of the request is essential because dictation normally supplies vocabulary.
    prompt: diarization ? undefined : request.prompt?.trim() || undefined,
  } as Parameters<typeof client.audio.transcriptions.create>[0]);
  const responseText = (result as { text?: unknown }).text;
  const text = typeof responseText === 'string' ? responseText.trim() : '';
  if (!text) throw new Error('El proveedor no devolvió una transcripción.');
  const rawSegments = (result as {
    segments?: Array<{ text?: unknown; start?: unknown; end?: unknown; speaker?: unknown }>;
  }).segments;
  const chunks = diarization
    ? (rawSegments ?? []).flatMap((segment) => {
        const segmentText = typeof segment.text === 'string' ? segment.text.trim() : '';
        const start = Number(segment.start);
        const end = Number(segment.end);
        if (!segmentText || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
        return [{
          text: segmentText,
          timestamp: [start, end] as [number, number],
          speaker: typeof segment.speaker === 'string' ? segment.speaker.trim() : undefined,
        }];
      })
    : undefined;
  if (diarization && !chunks?.length) {
    throw new Error('El proveedor no devolvió segmentos con hablantes para la diarización.');
  }
  return { text, provider: 'openai', model, chunks };
}
