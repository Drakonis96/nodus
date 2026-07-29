import type {
  StudyDiarizationRequest,
  StudyDiarizationResult,
  StudyTranscriptSegmentInput,
} from '@shared/studyRecordings';
import {
  getStudyRecording,
  getStudyRecordingContent,
  updateStudyTranscript,
} from '../db/studyRecordingsRepo';
import { getApiKey } from '../secrets/secretStore';

export const STUDY_DIARIZATION_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_API = 'https://generativelanguage.googleapis.com';
const INLINE_AUDIO_LIMIT = 18 * 1024 * 1024;

export interface GeminiTurn {
  startSeconds: number;
  endSeconds: number;
  speaker: string;
  text: string;
  confidence: number | null;
}

interface GeminiFile {
  name: string;
  uri: string;
  mimeType?: string;
  state?: string;
}

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampConfidence(value: unknown): number | null {
  if (value == null || value === '') return null;
  return Math.max(0, Math.min(1, finite(value)));
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1]?.trim();
  for (const candidate of [trimmed, fenced]) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // Try a balanced JSON object below.
    }
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  }
  throw new Error('Gemini devolvió una diarización que no es JSON válido.');
}

function normalizeSpeaker(raw: unknown, aliases: Map<string, string>): string {
  const key = String(raw ?? '').trim().toLocaleLowerCase() || 'speaker';
  const existing = aliases.get(key);
  if (existing) return existing;
  const label = `Hablante ${aliases.size + 1}`;
  aliases.set(key, label);
  return label;
}

function parseTurns(payload: Record<string, unknown>): { turns: GeminiTurn[]; speakers: string[] } {
  const source = Array.isArray(payload.segments) ? payload.segments : Array.isArray(payload.turns) ? payload.turns : [];
  const aliases = new Map<string, string>();
  const turns = source.flatMap((value): GeminiTurn[] => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    const startSeconds = Math.max(0, finite(item.startSeconds ?? item.start ?? item.tStart));
    const endSeconds = Math.max(startSeconds, finite(item.endSeconds ?? item.end ?? item.tEnd, startSeconds));
    if (endSeconds <= startSeconds) return [];
    return [{
      startSeconds,
      endSeconds,
      speaker: normalizeSpeaker(item.speaker ?? item.speakerId ?? item.label, aliases),
      text: String(item.text ?? '').replace(/\s+/g, ' ').trim(),
      confidence: clampConfidence(item.confidence),
    }];
  }).sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds);
  if (!turns.length) throw new Error('Gemini no identificó ningún turno de habla en el audio.');
  return { turns, speakers: [...new Set(turns.map((turn) => turn.speaker))] };
}

function overlap(startA: number, endA: number, startB: number, endB: number): number {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function wordsWithSpacing(text: string): string[] {
  return text.trim().split(/\s+/u).filter(Boolean);
}

function splitCounts(total: number, weights: number[]): number[] {
  if (weights.length === 1) return [total];
  const safeWeights = weights.map((value) => Math.max(0.001, value));
  const sum = safeWeights.reduce((acc, value) => acc + value, 0);
  const raw = safeWeights.map((value) => value / sum * total);
  const counts = raw.map(Math.floor);
  let remaining = total - counts.reduce((acc, value) => acc + value, 0);
  const order = raw.map((value, index) => ({ index, fraction: value - counts[index] }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let cursor = 0; remaining > 0; cursor += 1, remaining -= 1) counts[order[cursor % order.length].index] += 1;
  return counts;
}

/**
 * Applies acoustic turns without rewriting the literal transcript. Existing
 * text is only split at whitespace when a single STT segment spans speakers.
 */
export function alignDiarizationTurns(
  segments: StudyTranscriptSegmentInput[],
  turns: GeminiTurn[],
): StudyTranscriptSegmentInput[] {
  const aligned: StudyTranscriptSegmentInput[] = [];
  for (const segment of segments) {
    const relevant = turns.filter((turn) => overlap(segment.tStart, segment.tEnd, turn.startSeconds, turn.endSeconds) > 0);
    if (!relevant.length) {
      const midpoint = (segment.tStart + segment.tEnd) / 2;
      const nearest = turns.reduce((best, turn) => {
        const distance = Math.abs((turn.startSeconds + turn.endSeconds) / 2 - midpoint);
        return !best || distance < best.distance ? { turn, distance } : best;
      }, null as { turn: GeminiTurn; distance: number } | null)?.turn;
      aligned.push({ ...segment, speaker: nearest?.speaker ?? segment.speaker, confidence: nearest?.confidence ?? segment.confidence });
      continue;
    }
    if (relevant.length === 1) {
      aligned.push({ ...segment, speaker: relevant[0].speaker, confidence: relevant[0].confidence });
      continue;
    }
    const words = wordsWithSpacing(segment.text);
    if (words.length < relevant.length) {
      const dominant = relevant.reduce((best, turn) =>
        overlap(segment.tStart, segment.tEnd, turn.startSeconds, turn.endSeconds)
          > overlap(segment.tStart, segment.tEnd, best.startSeconds, best.endSeconds) ? turn : best);
      aligned.push({ ...segment, speaker: dominant.speaker, confidence: dominant.confidence });
      continue;
    }
    const weights = relevant.map((turn) => overlap(segment.tStart, segment.tEnd, turn.startSeconds, turn.endSeconds));
    const counts = splitCounts(words.length, weights);
    let wordCursor = 0;
    relevant.forEach((turn, index) => {
      const text = words.slice(wordCursor, wordCursor + counts[index]).join(' ');
      wordCursor += counts[index];
      if (!text) return;
      aligned.push({
        ...segment,
        tStart: Math.max(segment.tStart, turn.startSeconds),
        tEnd: Math.min(segment.tEnd, turn.endSeconds),
        text,
        speaker: turn.speaker,
        confidence: turn.confidence,
      });
    });
  }
  return aligned;
}

async function geminiError(response: Response, context: string): Promise<Error> {
  const body = await response.text().catch(() => '');
  let detail = body.slice(0, 500);
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    detail = parsed.error?.message || detail;
  } catch {
    // Keep the bounded response body.
  }
  return new Error(`${context} (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
}

async function uploadGeminiFile(key: string, bytes: Uint8Array, mimeType: string, fileName: string): Promise<GeminiFile> {
  const start = await fetch(`${GEMINI_API}/upload/v1beta/files?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.byteLength),
      'X-Goog-Upload-Header-Content-Type': mimeType,
    },
    body: JSON.stringify({ file: { display_name: fileName.slice(0, 120) } }),
  });
  if (!start.ok) throw await geminiError(start, 'No se pudo iniciar la carga temporal del audio');
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini no devolvió la URL de carga temporal.');
  const upload = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(bytes.byteLength),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: Buffer.from(bytes),
  });
  if (!upload.ok) throw await geminiError(upload, 'No se pudo cargar el audio para diarización');
  const payload = await upload.json() as { file?: GeminiFile };
  if (!payload.file?.name || !payload.file.uri) throw new Error('Gemini no confirmó el archivo de audio temporal.');
  return payload.file;
}

async function waitForGeminiFile(key: string, initial: GeminiFile): Promise<GeminiFile> {
  let file = initial;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!file.state || file.state === 'ACTIVE') return file;
    if (file.state === 'FAILED') throw new Error('Gemini no pudo procesar el audio temporal.');
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const response = await fetch(`${GEMINI_API}/v1beta/${file.name}?key=${encodeURIComponent(key)}`);
    if (!response.ok) throw await geminiError(response, 'No se pudo comprobar el audio temporal');
    file = await response.json() as GeminiFile;
  }
  throw new Error('Gemini tardó demasiado en preparar el audio para diarización.');
}

async function deleteGeminiFile(key: string, file: GeminiFile | null): Promise<void> {
  if (!file?.name) return;
  await fetch(`${GEMINI_API}/v1beta/${file.name}?key=${encodeURIComponent(key)}`, { method: 'DELETE' }).catch(() => undefined);
}

function transcriptPrompt(content: string, expectedSpeakers?: number | null): string {
  const expected = expectedSpeakers && expectedSpeakers > 0
    ? `Se esperan aproximadamente ${Math.round(expectedSpeakers)} hablantes.`
    : 'Determina el número de hablantes por sus voces; no lo deduzcas por el contenido.';
  return [
    'Analiza acústicamente este audio y realiza diarización de hablantes.',
    expected,
    'Devuelve exclusivamente JSON con esta forma:',
    '{"segments":[{"startSeconds":0.0,"endSeconds":1.2,"speaker":"speaker_1","text":"fragmento oído","confidence":0.95}]}',
    'Crea un segmento por turno de voz. Usa el mismo identificador para la misma voz y otro cuando cambie la voz.',
    'No inventes nombres propios para los hablantes. Los tiempos deben estar en segundos y no solaparse.',
    'La transcripción existente se aporta solo para facilitar la alineación; la aplicación preservará literalmente su texto:',
    content.slice(0, 120_000),
  ].join('\n\n');
}

export async function requestGeminiDiarization(
  key: string,
  content: { bytes: Uint8Array; mimeType: string; fileName: string },
  transcript: string,
  expectedSpeakers?: number | null,
): Promise<{ turns: GeminiTurn[]; speakers: string[] }> {
  let remoteFile: GeminiFile | null = null;
  try {
    const audioPart = content.bytes.byteLength <= INLINE_AUDIO_LIMIT
      ? { inlineData: { mimeType: content.mimeType, data: Buffer.from(content.bytes).toString('base64') } }
      : await (async () => {
        remoteFile = await waitForGeminiFile(key, await uploadGeminiFile(key, content.bytes, content.mimeType, content.fileName));
        return { fileData: { mimeType: remoteFile.mimeType || content.mimeType, fileUri: remoteFile.uri } };
      })();
    const response = await fetch(`${GEMINI_API}/v1beta/models/${STUDY_DIARIZATION_MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: transcriptPrompt(transcript, expectedSpeakers) }, audioPart] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 16_384 },
      }),
    });
    if (!response.ok) throw await geminiError(response, 'La diarización de Gemini falló');
    const result = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = result.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim() ?? '';
    if (!text) throw new Error('Gemini no devolvió una diarización.');
    return parseTurns(parseJsonObject(text));
  } finally {
    await deleteGeminiFile(key, remoteFile);
  }
}

export async function diarizeStudyRecording(request: StudyDiarizationRequest): Promise<StudyDiarizationResult> {
  const key = getApiKey('gemini');
  if (!key) throw new Error('Falta la clave de Gemini para detectar hablantes. Configúrala en Ajustes.');
  const recording = getStudyRecording(request.recordingId);
  const transcript = recording.transcripts.find((entry) => entry.id === request.transcriptId);
  if (!transcript || transcript.kind !== 'literal') throw new Error('Selecciona una transcripción literal válida para detectar hablantes.');
  if (!transcript.segments.length) throw new Error('La transcripción literal no contiene segmentos que puedan alinearse.');
  const content = getStudyRecordingContent(request.recordingId);
  let analysis = await requestGeminiDiarization(key, content, transcript.contentMarkdown, request.expectedSpeakers);
  const expectedSpeakers = Math.max(0, Math.round(request.expectedSpeakers ?? 0));
  // With similar voices a fast model can occasionally collapse an expected pair
  // into one label. One bounded retry is preferable to silently persisting a result
  // the user already told us is incomplete.
  if (expectedSpeakers > 1 && analysis.speakers.length < expectedSpeakers) {
    analysis = await requestGeminiDiarization(key, content, transcript.contentMarkdown, expectedSpeakers);
  }
  if (expectedSpeakers > 1 && analysis.speakers.length < expectedSpeakers) {
    throw new Error(`Solo se distinguieron ${analysis.speakers.length} de los ${expectedSpeakers} hablantes esperados. Prueba con un audio más nítido o revisa el número indicado.`);
  }
  const { turns, speakers } = analysis;
  const segments = alignDiarizationTurns(transcript.segments, turns);
  const updated = updateStudyTranscript(transcript.id, transcript.contentMarkdown, segments);
  return { provider: 'gemini', model: STUDY_DIARIZATION_MODEL, speakers, transcript: updated };
}
