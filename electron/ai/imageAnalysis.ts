// Analyse an archive image with the configured vision model: a consistent visual
// description + a verbatim OCR transcription, both indexable. Uses the shared prompt
// and the multimodal message support in aiClient. Best-effort — callers keep the
// tesseract OCR / no-description fallback if this fails or no vision model is set.

import { completeJson } from './aiClient';
import {
  IMAGE_ANALYSIS_SYSTEM,
  IMAGE_ANALYSIS_USER,
  isImageAnalysisShape,
  isVisionMime,
  normalizeAnalysis,
  type ImageAnalysis,
} from '@shared/imageAnalysis';
import type { ModelRef } from '@shared/types';

export async function analyzeImageBytes(
  bytes: Buffer,
  mime: string,
  model?: ModelRef | null
): Promise<ImageAnalysis | null> {
  if (!isVisionMime(mime)) return null;
  const raw = await completeJson(
    {
      system: IMAGE_ANALYSIS_SYSTEM,
      user: IMAGE_ANALYSIS_USER,
      images: [{ base64: bytes.toString('base64'), mediaType: mime.toLowerCase() }],
      plainContext: true,
      temperature: 0.2,
      // Generous so a full page's OCR isn't truncated ("sin cortar la respuesta").
      maxTokens: 2000,
    },
    isImageAnalysisShape,
    model
  );
  return normalizeAnalysis(raw);
}
