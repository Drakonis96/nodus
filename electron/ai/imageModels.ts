import type { ImageModelInfo } from '@shared/types';
import { NODUS_LOCAL_IMAGE_MODEL } from '@shared/localImageModels';

const GOOGLE_SOURCE = 'https://ai.google.dev/gemini-api/docs/pricing';
const OPENAI_SOURCE = 'https://developers.openai.com/api/docs/guides/image-generation';
const OPENROUTER_SOURCE = 'https://openrouter.ai/models?output_modalities=image&order=pricing-low-to-high';

const NODUS_LOCAL_MODELS: ImageModelInfo[] = [{
  provider: 'nodus',
  id: NODUS_LOCAL_IMAGE_MODEL.id,
  name: NODUS_LOCAL_IMAGE_MODEL.label,
  inputPriceUsdPerMillion: null,
  outputPriceUsdPerMillion: null,
  imagePriceUsd: 0,
  imagePriceLabel: 'Local · sin coste por uso',
  sourceUrl: NODUS_LOCAL_IMAGE_MODEL.sourceUrl,
}];

const GOOGLE_MODELS: ImageModelInfo[] = [
  {
    provider: 'google',
    id: 'gemini-3.1-flash-lite-image',
    name: 'Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image)',
    inputPriceUsdPerMillion: 0.25,
    outputPriceUsdPerMillion: 1.5,
    imagePriceUsd: 0.0336,
    imagePriceLabel: '$0.0336 / imagen 1K',
    sourceUrl: GOOGLE_SOURCE,
  },
  {
    provider: 'google',
    id: 'gemini-3.1-flash-image',
    name: 'Nano Banana 2 (Gemini 3.1 Flash Image)',
    inputPriceUsdPerMillion: 0.5,
    outputPriceUsdPerMillion: 3,
    imagePriceUsd: 0.067,
    imagePriceLabel: '$0.067 / imagen 1K',
    sourceUrl: GOOGLE_SOURCE,
  },
  {
    provider: 'google',
    id: 'gemini-3-pro-image',
    name: 'Nano Banana Pro (Gemini 3 Pro Image)',
    inputPriceUsdPerMillion: 2,
    outputPriceUsdPerMillion: 12,
    imagePriceUsd: 0.134,
    imagePriceLabel: '$0.134 / imagen 1K–2K',
    sourceUrl: GOOGLE_SOURCE,
  },
  {
    provider: 'google',
    id: 'gemini-2.5-flash-image',
    name: 'Nano Banana (Gemini 2.5 Flash Image)',
    inputPriceUsdPerMillion: 0.3,
    outputPriceUsdPerMillion: 2.5,
    imagePriceUsd: 0.039,
    imagePriceLabel: '$0.039 / imagen hasta 1024×1024',
    sourceUrl: GOOGLE_SOURCE,
  },
];

const OPENAI_MODELS: ImageModelInfo[] = [
  // The app requests 1536x1024, low quality. These are the exact published
  // per-generation output prices for that size, not square-image estimates.
  // Token columns use the text-input and image-output standard rates from the
  // current pricing page. GPT Image 1 remains supported by the generation
  // guide, but those token rates are no longer listed there, so they stay null.
  ['gpt-image-2', 'GPT Image 2', 5, 30, 0.005],
  ['gpt-image-1.5', 'GPT Image 1.5', 5, 32, 0.013],
  ['gpt-image-1', 'GPT Image 1', null, null, 0.016],
  ['gpt-image-1-mini', 'GPT Image 1 Mini', 2, 8, 0.006],
].map(([id, name, input, output, price]) => ({
  provider: 'openai' as const,
  id: String(id),
  name: String(name),
  inputPriceUsdPerMillion: input == null ? null : Number(input),
  outputPriceUsdPerMillion: output == null ? null : Number(output),
  imagePriceUsd: Number(price),
  imagePriceLabel: `$${Number(price).toFixed(3)} / imagen 1536×1024, calidad baja`,
  sourceUrl: OPENAI_SOURCE,
}));

interface OpenRouterImageModel {
  id: string;
  name?: string;
  architecture?: { output_modalities?: string[] };
  endpoints?: string;
}

interface OpenRouterGeneralModel {
  id: string;
  pricing?: { prompt?: string; completion?: string };
}

interface OpenRouterPricingLine {
  billable?: string;
  unit?: string;
  cost_usd?: number;
  variant?: string;
}

async function fetchJson<T>(url: string, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function perMillion(raw: string | undefined): number | null {
  const value = Number(raw);
  return Number.isFinite(value) ? value * 1_000_000 : null;
}

async function openRouterModels(): Promise<ImageModelInfo[]> {
  const [imagesPayload, generalPayload] = await Promise.all([
    fetchJson<{ data?: OpenRouterImageModel[] }>('https://openrouter.ai/api/v1/images/models'),
    fetchJson<{ data?: OpenRouterGeneralModel[] }>('https://openrouter.ai/api/v1/models?output_modalities=image').catch(() => ({ data: [] })),
  ]);
  const general = new Map((generalPayload.data ?? []).map((model) => [model.id, model]));
  const imageModels = (imagesPayload.data ?? []).filter((model) => model.architecture?.output_modalities?.includes('image'));

  const endpointPricing = await Promise.all(
    imageModels.map(async (model) => {
      if (!model.endpoints) return [] as OpenRouterPricingLine[];
      try {
        const payload = await fetchJson<{ endpoints?: Array<{ pricing?: OpenRouterPricingLine[] }> }>(
          `https://openrouter.ai${model.endpoints}`
        );
        return (payload.endpoints ?? []).flatMap((endpoint) => endpoint.pricing ?? []);
      } catch {
        return [] as OpenRouterPricingLine[];
      }
    })
  );

  return imageModels.map((model, index) => {
    const live = general.get(model.id);
    const lines = endpointPricing[index];
    const directImagePrices = lines
      .filter((line) => line.billable === 'output_image' && line.unit === 'image' && Number.isFinite(line.cost_usd))
      .map((line) => ({ value: Number(line.cost_usd), variant: line.variant }));
    const cheapest = directImagePrices.length
      ? directImagePrices.reduce((best, current) => (current.value < best.value ? current : best))
      : null;
    const tokenPrice = lines.find(
      (line) => line.billable === 'output_image' && line.unit === 'token' && Number.isFinite(line.cost_usd)
    );
    const priceLabel = cheapest
      ? `$${cheapest.value.toFixed(4)} / imagen${cheapest.variant ? ` (${cheapest.variant})` : ''}`
      : tokenPrice
        ? `$${(Number(tokenPrice.cost_usd) * 1_000_000).toFixed(2)} / 1M tokens de imagen`
        : null;
    return {
      provider: 'openrouter' as const,
      id: model.id,
      name: model.name ?? model.id,
      inputPriceUsdPerMillion: perMillion(live?.pricing?.prompt),
      outputPriceUsdPerMillion: perMillion(live?.pricing?.completion),
      imagePriceUsd: cheapest?.value ?? null,
      imagePriceLabel: priceLabel,
      sourceUrl: OPENROUTER_SOURCE,
    };
  });
}

export async function listImageModels(): Promise<ImageModelInfo[]> {
  const openrouter = await openRouterModels().catch(() => []);
  return [...NODUS_LOCAL_MODELS, ...GOOGLE_MODELS, ...OPENAI_MODELS, ...openrouter].sort(
    (a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name)
  );
}

export function isKnownDirectImageModel(provider: 'google' | 'openai', model: string): boolean {
  return (provider === 'google' ? GOOGLE_MODELS : OPENAI_MODELS).some((candidate) => candidate.id === model);
}
