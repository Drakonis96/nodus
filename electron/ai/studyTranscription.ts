import OpenAI, { toFile } from 'openai';
import type { StudySttRequest, StudySttResult } from '@shared/sttModels';
import { getSettings } from '../db/settingsRepo';
import { getApiKey } from '../secrets/secretStore';

export const DEFAULT_OPENAI_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';

export function resolveStudyTranscriptionModel(requested?: string | null): string {
  if (requested?.trim()) return requested.trim();
  const configured = getSettings().transcriptionModel;
  return configured?.provider === 'openai' && configured.model.trim()
    ? configured.model.trim()
    : DEFAULT_OPENAI_TRANSCRIPTION_MODEL;
}

export function studyAudioFileExtension(mimeType: string): string {
  if (/wav/i.test(mimeType)) return 'wav';
  if (/mpeg|mp3/i.test(mimeType)) return 'mp3';
  if (/ogg/i.test(mimeType)) return 'ogg';
  if (/mp4|m4a/i.test(mimeType)) return 'm4a';
  return 'webm';
}

export async function transcribeStudyAudio(request: StudySttRequest): Promise<StudySttResult> {
  const key = getApiKey('openai');
  if (!key) throw new Error('Falta la clave de OpenAI para usar el dictado externo. Configúrala en Ajustes.');
  const bytes = request.audioBytes instanceof Uint8Array ? request.audioBytes : new Uint8Array(request.audioBytes);
  if (bytes.byteLength === 0) throw new Error('La grabación está vacía.');
  const model = resolveStudyTranscriptionModel(request.model);
  const client = new OpenAI({ apiKey: key, timeout: 180_000, maxRetries: 1 });
  const file = await toFile(bytes, `dictation.${studyAudioFileExtension(request.mimeType)}`, { type: request.mimeType || 'audio/webm' });
  const result = await client.audio.transcriptions.create({
    file,
    model,
    response_format: 'json',
    language: request.language?.split('-')[0] || undefined,
    prompt: request.prompt?.trim() || undefined,
  } as Parameters<typeof client.audio.transcriptions.create>[0]);
  const responseText = (result as { text?: unknown }).text;
  const text = typeof responseText === 'string' ? responseText.trim() : '';
  if (!text) throw new Error('El proveedor no devolvió una transcripción.');
  return { text, provider: 'openai', model };
}
