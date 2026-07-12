// Generate period portraits for the genealogy demo people using the CHEAPEST Gemini
// image model (Nano Banana 2 Lite). Every portrait is a black-and-white daguerreotype
// with the sitter's face centered in the frame, so they drop straight into the tree's
// oval frames. Best-effort and background: no key or a failed call simply leaves the
// default silhouette. The provider call is injectable so the flow is testable offline.

import { nativeImage } from 'electron';
import { GoogleGenAI } from '@google/genai';
import { getApiKey } from '../secrets/secretStore';
import { getDb } from '../db/database';
import { setPersonPortrait } from '../db/entitiesRepo';
import { demoPortraitTargets } from '../db/genealogyDemoData';

/** The cheap Gemini image model requested for demo portraits ($0.0336/image). */
export const DEMO_PORTRAIT_MODEL = 'gemini-3.1-flash-lite-image';
const PORTRAIT_TIMEOUT_MS = 90_000;

export interface PortraitTarget {
  personId: string;
  name: string;
  sex: 'male' | 'female';
  birthYear: number | null;
  portrait: string;
}

/** Build the daguerreotype prompt: B&W, centered face, period-appropriate, no text. */
export function buildDaguerreotypePrompt(target: PortraitTarget): string {
  const who = target.sex === 'female' ? 'a woman' : 'a man';
  const era = target.birthYear ? ` (born around ${target.birthYear})` : '';
  return [
    `A vintage 19th-century daguerreotype-style black-and-white studio portrait of ${who}${era}: ${target.portrait}.`,
    'Head-and-shoulders composition, the face centered in the frame and looking straight at the camera, calm neutral expression.',
    'Plain dark studio backdrop, soft directional light, silvery monochrome with a faint warm sepia tint, gentle vignette, the slightly worn look of an antique photographic plate.',
    'A single person only. No text, no words, no letters, no caption, no signature, no border and no decorative frame.',
  ].join(' ');
}

export type PortraitGenerator = (prompt: string) => Promise<Buffer | null>;

/** Real generator: the cheapest Gemini image model. Returns null without a key. */
async function googlePortraitGenerator(prompt: string): Promise<Buffer | null> {
  const key = getApiKey('gemini');
  if (!key) return null;
  const client = new GoogleGenAI({ apiKey: key });
  const response = await client.interactions.create(
    {
      model: DEMO_PORTRAIT_MODEL,
      input: prompt,
      store: false,
      response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '1:1', image_size: '1K' },
    },
    { timeout: PORTRAIT_TIMEOUT_MS, maxRetries: 0 }
  );
  const data = response.output_image?.data;
  return data ? Buffer.from(data, 'base64') : null;
}

/** Down-size to a light square-ish JPEG; the portrait frame crops via the focal point. */
function toStoredJpeg(bytes: Buffer): Buffer {
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) return bytes;
  const width = Math.min(512, image.getSize().width || 512);
  return image.resize({ width, quality: 'best' }).toJPEG(85);
}

export function hasDemoPortraitKey(): boolean {
  return Boolean(getApiKey('gemini'));
}

/** True when at least one seeded demo person still lacks a portrait. */
export function demoPortraitsPending(): boolean {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM persons p
       WHERE p.person_id LIKE 'demo-%'
         AND NOT EXISTS (SELECT 1 FROM person_portraits pp WHERE pp.person_id = p.person_id)`
    )
    .get() as { n: number };
  return row.n > 0;
}

/**
 * Generate and store a portrait for every demo person. Sequential (a demo, not a
 * batch job) and best-effort: any failure is skipped so the rest still render.
 */
export async function generateDemoPortraits(opts: {
  generator?: PortraitGenerator;
  onProgress?: (done: number, total: number) => void;
} = {}): Promise<{ generated: number; skipped: number }> {
  const generate = opts.generator ?? googlePortraitGenerator;
  const targets = demoPortraitTargets();
  let generated = 0;
  let skipped = 0;
  for (let i = 0; i < targets.length; i++) {
    try {
      const bytes = await generate(buildDaguerreotypePrompt(targets[i]));
      if (bytes && bytes.length) {
        setPersonPortrait(targets[i].personId, toStoredJpeg(bytes), 'image/jpeg', { focusX: 0.5, focusY: 0.42, scale: 1 });
        generated++;
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
    opts.onProgress?.(i + 1, targets.length);
  }
  return { generated, skipped };
}
