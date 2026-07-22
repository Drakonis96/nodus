export type NodusImageQuality = 'draft' | 'balanced' | 'high';

export interface NodusImageQualityPreset {
  id: NodusImageQuality;
  width: number;
  height: number;
  /** FLUX.2 [klein] is step-distilled. All presets intentionally keep the documented four steps. */
  steps: 4;
}

export const NODUS_IMAGE_QUALITY_PRESETS: readonly NodusImageQualityPreset[] = [
  { id: 'draft', width: 640, height: 384, steps: 4 },
  { id: 'balanced', width: 896, height: 512, steps: 4 },
  { id: 'high', width: 1152, height: 640, steps: 4 },
] as const;

export const DEFAULT_NODUS_IMAGE_QUALITY: NodusImageQuality = 'balanced';

export interface NodusLocalImageAsset {
  file: string;
  url: string;
  bytes: number;
  sha256?: string;
  role: 'diffusion' | 'text_encoder' | 'vae' | 'license';
}

export interface NodusLocalImageModelDefinition {
  id: string;
  label: string;
  quantization: string;
  description: string;
  sourceUrl: string;
  licenseLabel: string;
  licenseUrl: string;
  diffusionFile: string;
  textEncoderFile: string;
  vaeFile: string;
  assets: readonly NodusLocalImageAsset[];
}

const FLUX_GGUF_REVISION = '3b1f5a9dc3abb32238b053aeb3d823c30afdacbd';
const FLUX_REVISION = 'e7b7dc27f91deacad38e78976d1f2b499d76a294';
const QWEN_GGUF_REVISION = '22c9fc8a8c7700b76a1789366280a6a5a1ad1120';
const QWEN_REVISION = '1cfa9a7208912126459214e8b04321603b3df60c';

const hf = (repo: string, revision: string, file: string) =>
  `https://huggingface.co/${repo}/resolve/${revision}/${file}?download=true`;

/**
 * Native text-to-image model offered by Nodus. The three inference artifacts are
 * downloaded on demand and never bundled with the application.
 *
 * Licensing matters here: FLUX.2 [klein] 4B is Apache-2.0, while the similarly
 * named 9B checkpoint is not. Keep the id, upstream source and license URL pinned
 * to 4B so the UI cannot accidentally imply that the 9B terms also permit this use.
 */
export const NODUS_LOCAL_IMAGE_MODEL: NodusLocalImageModelDefinition = {
  id: 'flux-2-klein-4b-q4',
  label: 'FLUX.2 Klein 4B Q4',
  quantization: 'Q4_0',
  description: 'Generación de imágenes nativa y privada, optimizada para equipos con memoria limitada.',
  sourceUrl: 'https://huggingface.co/leejet/FLUX.2-klein-4B-GGUF',
  licenseLabel: 'Apache-2.0 · modelo 4B y componentes',
  licenseUrl: `https://huggingface.co/black-forest-labs/FLUX.2-klein-4B/blob/${FLUX_REVISION}/LICENSE.md`,
  diffusionFile: 'flux-2-klein-4b-Q4_0.gguf',
  textEncoderFile: 'Qwen3-4B-Q4_K_M.gguf',
  vaeFile: 'flux2-vae.safetensors',
  assets: [
    {
      file: 'flux-2-klein-4b-Q4_0.gguf',
      url: hf('leejet/FLUX.2-klein-4B-GGUF', FLUX_GGUF_REVISION, 'flux-2-klein-4b-Q4_0.gguf'),
      bytes: 2_460_378_560,
      sha256: 'd1023499ef3f2f82ff7c50e6778495195c1b6cc34835741778868428111f9ff4',
      role: 'diffusion',
    },
    {
      file: 'Qwen3-4B-Q4_K_M.gguf',
      url: hf('unsloth/Qwen3-4B-GGUF', QWEN_GGUF_REVISION, 'Qwen3-4B-Q4_K_M.gguf'),
      bytes: 2_497_281_312,
      sha256: 'f6f851777709861056efcdad3af01da38b31223a3ba26e61a4f8bf3a2195813a',
      role: 'text_encoder',
    },
    {
      file: 'flux2-vae.safetensors',
      url: hf('black-forest-labs/FLUX.2-klein-4B', FLUX_REVISION, 'vae/diffusion_pytorch_model.safetensors'),
      bytes: 168_120_878,
      sha256: 'ca70d2202afe6415bdbcb8793ba8cd99fd159cfe6192381504d6c4d3036e0f04',
      role: 'vae',
    },
    {
      file: 'LICENSE.FLUX2.md',
      url: hf('black-forest-labs/FLUX.2-klein-4B', FLUX_REVISION, 'LICENSE.md'),
      bytes: 9_584,
      role: 'license',
    },
    {
      file: 'LICENSE.QWEN3',
      url: hf('Qwen/Qwen3-4B', QWEN_REVISION, 'LICENSE'),
      bytes: 11_343,
      role: 'license',
    },
  ],
};

export interface NodusLocalImageRuntimeStatus {
  version: string;
  ready: boolean;
  executablePath: string | null;
  downloading: boolean;
  progress: number;
}

export interface NodusLocalImageModelStatus {
  id: string;
  downloaded: boolean;
  downloadedBytes: number;
  totalBytes: number;
  path: string;
  downloading: boolean;
  progress: number;
}

export interface NodusLocalImageStatus {
  runtime: NodusLocalImageRuntimeStatus;
  model: NodusLocalImageModelStatus;
  generating: boolean;
}

export function nodusLocalImageModelBytes(): number {
  return NODUS_LOCAL_IMAGE_MODEL.assets.reduce((sum, asset) => sum + asset.bytes, 0);
}

export function getNodusImageQualityPreset(quality: NodusImageQuality): NodusImageQualityPreset {
  return NODUS_IMAGE_QUALITY_PRESETS.find((preset) => preset.id === quality)
    ?? NODUS_IMAGE_QUALITY_PRESETS.find((preset) => preset.id === DEFAULT_NODUS_IMAGE_QUALITY)!;
}

export function isNodusImageQuality(value: unknown): value is NodusImageQuality {
  return NODUS_IMAGE_QUALITY_PRESETS.some((preset) => preset.id === value);
}
