import { GoogleGenAI, type GenerateContentConfig, type Part } from '@google/genai';
import type { VisionImagePart } from '@shared/imageAnalysis';
import { withTransportDeadline } from './transportDeadline';

export interface GeminiDeterministicCompletionOptions {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
  seed: number;
  timeoutMs: number;
  signal?: AbortSignal;
  images?: VisionImagePart[];
}

export interface GeminiDeterministicCompletionResult {
  text: string;
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  headers: Headers | null;
}

/** Build the native request separately so its reproducibility contract is unit-testable. */
export function buildGeminiDeterministicRequest(
  options: Omit<GeminiDeterministicCompletionOptions, 'apiKey' | 'signal' | 'timeoutMs'>,
  signal?: AbortSignal,
): { contents: Part[]; config: GenerateContentConfig } {
  const contents: Part[] = [
    { text: options.user },
    ...(options.images ?? []).map((image) => ({
      inlineData: { mimeType: image.mediaType, data: image.base64 },
    })),
  ];
  const isGemini3 = /^gemini-3(?:[.-]|$)/i.test(options.model);
  return {
    contents,
    config: {
      systemInstruction: options.system,
      responseMimeType: 'application/json',
      maxOutputTokens: options.maxTokens,
      seed: options.seed,
      ...(!isGemini3 ? { temperature: options.temperature } : {}),
      // Gemini 2.5 accepts a zero thinking budget. This is the native equivalent of
      // the `reasoning_effort: none` field used by the previous compatibility path.
      ...(/^gemini-2\.5(?:[.-]|$)/i.test(options.model)
        ? { thinkingConfig: { thinkingBudget: 0 } }
        : {}),
      ...(signal ? { abortSignal: signal } : {}),
    },
  };
}

export async function completeGeminiDeterministicJson(
  options: GeminiDeterministicCompletionOptions,
): Promise<GeminiDeterministicCompletionResult> {
  const client = new GoogleGenAI({ apiKey: options.apiKey });
  const response = await withTransportDeadline(options.timeoutMs, options.signal, async (signal) => {
    const request = buildGeminiDeterministicRequest(options, signal);
    return client.models.generateContent({
      model: options.model,
      contents: request.contents,
      config: {
        ...request.config,
        httpOptions: { timeout: options.timeoutMs },
      },
    });
  });
  return {
    text: response.text ?? '',
    finishReason: response.candidates?.[0]?.finishReason ?? null,
    inputTokens: response.usageMetadata?.promptTokenCount ?? null,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
    headers: response.sdkHttpResponse?.headers
      ? new Headers(response.sdkHttpResponse.headers)
      : null,
  };
}
