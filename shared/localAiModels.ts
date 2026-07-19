export type NodusLocalModelKind = 'embedding' | 'chat';
export type NodusLocalModelRuntime = 'llama_cpp' | 'transformers';

export interface NodusLocalModelAsset {
  file: string;
  url: string;
  bytes: number;
  sha256?: string;
}

export interface NodusLocalModelDefinition {
  id: string;
  label: string;
  kind: NodusLocalModelKind;
  runtime: NodusLocalModelRuntime;
  quantization: string;
  description: string;
  sourceUrl: string;
  contextLength?: number;
  dimensions?: number;
  vision?: boolean;
  /**
   * Whether this model is fit to drive idea EXTRACTION (deep/light scans) and, by extension, to be
   * the single generic model in "basic" mode. Small vision models (Qwen3.5-0.8B, LFM2.5-VL-1.6B)
   * are left `false`: benchmarked against a real 7000-word paper they produced 0 valid extractions —
   * they loop/ramble inside the JSON and never close it, and no server flag, grammar, concision
   * suffix or repetition penalty rescues them (see design/local-extraction-and-free-tier-plan.md).
   * They stay usable for chat / vision / image. Only Gemma 4 E2B extracts reliably (20/20, 0 fails).
   */
  supportsExtraction?: boolean;
  modelFile: string;
  projectorFile?: string;
  assets: readonly NodusLocalModelAsset[];
}

export interface NodusLocalModelStatus {
  id: string;
  downloaded: boolean;
  downloadedBytes: number;
  totalBytes: number;
  path: string;
  /** Main-process transfer state, retained while renderer views mount/unmount. */
  downloading: boolean;
  progress: number;
}

export interface NodusLocalRuntimeStatus {
  version: string;
  ready: boolean;
  executablePath: string | null;
  /** Main-process transfer state, retained while renderer views mount/unmount. */
  downloading: boolean;
  progress: number;
}

export interface NodusLocalAiStatus {
  runtime: NodusLocalRuntimeStatus;
  models: NodusLocalModelStatus[];
  activeModelId: string | null;
}

const HF_REVISIONS: Record<string, string> = {
  'ggml-org/bge-m3-Q8_0-GGUF': '9eba04c5d75ba5a1595e45de734d36bef4e5cb98',
  'onnx-community/gte-multilingual-base': '2edbf5e672aab465f9ed4c154a8b61791c082c69',
  'Xenova/multilingual-e5-small': '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  'unsloth/Qwen3.5-0.8B-GGUF': '6ab461498e2023f6e3c1baea90a8f0fe38ab64d0',
  'google/gemma-4-E2B-it-qat-q4_0-gguf': '69536a21d70340464240401ba38223d805f6a709',
  'LiquidAI/LFM2.5-VL-1.6B-GGUF': '48c6a306939241d1ddc99b090df552cb47a066c6',
  'ibm-granite/granite-4.0-micro-GGUF': 'ec48475f0c811d812fbfb61975717a9c36eeb652',
};

const hf = (repo: string, file: string) =>
  `https://huggingface.co/${repo}/resolve/${HF_REVISIONS[repo] ?? 'main'}/${file}?download=true`;

export const NODUS_LOCAL_MODELS: readonly NodusLocalModelDefinition[] = [
  {
    id: 'bge-m3-q8_0',
    label: 'BGE-M3 Q8_0',
    kind: 'embedding',
    runtime: 'llama_cpp',
    quantization: 'Q8_0',
    description: 'Embeddings multilingües de alta calidad para corpus amplios.',
    sourceUrl: 'https://huggingface.co/ggml-org/bge-m3-Q8_0-GGUF',
    contextLength: 8192,
    dimensions: 1024,
    modelFile: 'bge-m3-q8_0.gguf',
    assets: [
      {
        file: 'bge-m3-q8_0.gguf',
        url: hf('ggml-org/bge-m3-Q8_0-GGUF', 'bge-m3-q8_0.gguf'),
        bytes: 634_553_760,
        sha256: 'aa473d51f451a22f0fcf39ba3330c14bed38a385712b1113440f69df4047a173',
      },
    ],
  },
  {
    id: 'gte-multilingual-base-int8',
    label: 'GTE Multilingual Base INT8',
    kind: 'embedding',
    runtime: 'transformers',
    quantization: 'INT8',
    description: 'Embeddings multilingües con contexto largo y buen equilibrio entre precisión y memoria.',
    sourceUrl: 'https://huggingface.co/onnx-community/gte-multilingual-base',
    contextLength: 8192,
    dimensions: 768,
    modelFile: 'onnx/model_int8.onnx',
    assets: [
      { file: 'config.json', url: hf('onnx-community/gte-multilingual-base', 'config.json'), bytes: 1_648 },
      { file: 'special_tokens_map.json', url: hf('onnx-community/gte-multilingual-base', 'special_tokens_map.json'), bytes: 964 },
      { file: 'tokenizer_config.json', url: hf('onnx-community/gte-multilingual-base', 'tokenizer_config.json'), bytes: 1_149 },
      {
        file: 'tokenizer.json',
        url: hf('onnx-community/gte-multilingual-base', 'tokenizer.json'),
        bytes: 17_082_734,
        sha256: '3a56def25aa40facc030ea8b0b87f3688e4b3c39eb8b45d5702b3a1300fe2a20',
      },
      {
        file: 'onnx/model_int8.onnx',
        url: hf('onnx-community/gte-multilingual-base', 'onnx/model_int8.onnx'),
        bytes: 340_318_797,
        sha256: 'ab2bd164ebd8ca9003dc49a981b611e849b5d326f504c8873ba76e07fa6c0082',
      },
    ],
  },
  {
    id: 'multilingual-e5-small-int8',
    label: 'Multilingual E5 Small INT8',
    kind: 'embedding',
    runtime: 'transformers',
    quantization: 'INT8',
    description: 'Opción ligera y rápida para equipos con menos memoria.',
    sourceUrl: 'https://huggingface.co/Xenova/multilingual-e5-small',
    contextLength: 512,
    dimensions: 384,
    modelFile: 'onnx/model_int8.onnx',
    assets: [
      { file: 'config.json', url: hf('Xenova/multilingual-e5-small', 'config.json'), bytes: 658 },
      { file: 'special_tokens_map.json', url: hf('Xenova/multilingual-e5-small', 'special_tokens_map.json'), bytes: 167 },
      { file: 'tokenizer_config.json', url: hf('Xenova/multilingual-e5-small', 'tokenizer_config.json'), bytes: 443 },
      {
        file: 'tokenizer.json',
        url: hf('Xenova/multilingual-e5-small', 'tokenizer.json'),
        bytes: 17_082_730,
        sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39',
      },
      {
        file: 'onnx/model_int8.onnx',
        url: hf('Xenova/multilingual-e5-small', 'onnx/model_int8.onnx'),
        bytes: 118_054_593,
        sha256: '4d24e2bc01a447951524466ef533e52944bf48509e6552810bcee1a2711cb02c',
      },
    ],
  },
  {
    id: 'qwen3.5-0.8b-q4',
    label: 'Qwen3.5-0.8B Q4',
    kind: 'chat',
    runtime: 'llama_cpp',
    quantization: 'Q4_K_M',
    description: 'Modelo visual muy ligero para conversación, resúmenes e ideas.',
    sourceUrl: 'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF',
    contextLength: 32_768,
    vision: true,
    supportsExtraction: false,
    modelFile: 'Qwen3.5-0.8B-Q4_K_M.gguf',
    projectorFile: 'mmproj-F16.gguf',
    assets: [
      {
        file: 'Qwen3.5-0.8B-Q4_K_M.gguf',
        url: hf('unsloth/Qwen3.5-0.8B-GGUF', 'Qwen3.5-0.8B-Q4_K_M.gguf'),
        bytes: 532_517_120,
        sha256: 'bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517',
      },
      {
        file: 'mmproj-F16.gguf',
        url: hf('unsloth/Qwen3.5-0.8B-GGUF', 'mmproj-F16.gguf'),
        bytes: 204_987_232,
        sha256: '56e4c6cfe73b0c82e3e82bc518d7591997e61d81f723fc41a586f4fa69ea2453',
      },
    ],
  },
  {
    id: 'gemma-4-e2b-q4',
    label: 'Gemma 4 E2B Q4',
    kind: 'chat',
    runtime: 'llama_cpp',
    quantization: 'Q4_0 QAT',
    description: 'Modelo visual de mayor calidad; requiere más almacenamiento y memoria.',
    sourceUrl: 'https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf',
    contextLength: 32_768,
    vision: true,
    supportsExtraction: true,
    modelFile: 'gemma-4-E2B_q4_0-it.gguf',
    projectorFile: 'gemma-4-E2B-it-mmproj.gguf',
    assets: [
      {
        file: 'gemma-4-E2B_q4_0-it.gguf',
        url: hf('google/gemma-4-E2B-it-qat-q4_0-gguf', 'gemma-4-E2B_q4_0-it.gguf'),
        bytes: 3_349_514_112,
        sha256: '3646b4c147cd235a44d91df1546d3b7d8e29b547dbe4e1f80856419aa455e6fd',
      },
      {
        file: 'gemma-4-E2B-it-mmproj.gguf',
        url: hf('google/gemma-4-E2B-it-qat-q4_0-gguf', 'gemma-4-E2B-it-mmproj.gguf'),
        bytes: 986_833_312,
        sha256: '58c187648007cab392bd5678b87e862c3e8794017deb945feea2cf256195e96a',
      },
    ],
  },
  {
    id: 'granite-4.0-micro-q4',
    label: 'Granite 4.0 Micro Q4',
    kind: 'chat',
    runtime: 'llama_cpp',
    quantization: 'Q4_K_M',
    description: 'Modelo de texto compacto con salida JSON fiable; alternativa ligera para extracción de ideas.',
    sourceUrl: 'https://huggingface.co/ibm-granite/granite-4.0-micro-GGUF',
    contextLength: 32_768,
    supportsExtraction: true,
    modelFile: 'granite-4.0-micro-Q4_K_M.gguf',
    assets: [
      {
        file: 'granite-4.0-micro-Q4_K_M.gguf',
        url: hf('ibm-granite/granite-4.0-micro-GGUF', 'granite-4.0-micro-Q4_K_M.gguf'),
        bytes: 2_099_502_528,
        sha256: '97c417dcc0534b0737c74016fb2af083cb17c3b51eaac621192d23961b7024eb',
      },
    ],
  },
  {
    id: 'lfm2.5-vl-1.6b-q4',
    label: 'LFM2.5-VL-1.6B Q4',
    kind: 'chat',
    runtime: 'llama_cpp',
    quantization: 'Q4_0',
    description: 'Modelo visual compacto orientado a documentos e imágenes.',
    sourceUrl: 'https://huggingface.co/LiquidAI/LFM2.5-VL-1.6B-GGUF',
    contextLength: 32_768,
    vision: true,
    supportsExtraction: false,
    modelFile: 'LFM2.5-VL-1.6B-Q4_0.gguf',
    projectorFile: 'mmproj-LFM2.5-VL-1.6b-Q8_0.gguf',
    assets: [
      {
        file: 'LFM2.5-VL-1.6B-Q4_0.gguf',
        url: hf('LiquidAI/LFM2.5-VL-1.6B-GGUF', 'LFM2.5-VL-1.6B-Q4_0.gguf'),
        bytes: 695_752_480,
        sha256: '8186364a4e7c3ad30f6dd3d3b7a4e0074c77dd91eed6cad5d8be9090ce285804',
      },
      {
        file: 'mmproj-LFM2.5-VL-1.6b-Q8_0.gguf',
        url: hf('LiquidAI/LFM2.5-VL-1.6B-GGUF', 'mmproj-LFM2.5-VL-1.6b-Q8_0.gguf'),
        bytes: 583_109_888,
        sha256: '2ce89e610c56f3198ece2b86cf61743a08b9307279c89125eb2412ebb908689d',
      },
    ],
  },
] as const;

export function getNodusLocalModel(id: string): NodusLocalModelDefinition | undefined {
  return NODUS_LOCAL_MODELS.find((model) => model.id === id);
}

export function nodusLocalModelBytes(model: NodusLocalModelDefinition): number {
  return model.assets.reduce((sum, asset) => sum + asset.bytes, 0);
}

/**
 * True when a built-in chat model can be trusted to drive idea extraction (and thus be the single
 * model in basic mode). Unknown ids default to `true` — only models we have explicitly benchmarked
 * as unfit are blocked, so a future model isn't accidentally locked out. Embedding models are `false`
 * (they can't chat at all). See `supportsExtraction` on the definition for the why.
 */
export function nodusLocalModelSupportsExtraction(id: string): boolean {
  const model = getNodusLocalModel(id);
  if (!model) return true;
  if (model.kind !== 'chat') return false;
  return model.supportsExtraction !== false;
}

/** The built-in chat model recommended as the default local extractor (basic mode / scans). */
export const NODUS_DEFAULT_EXTRACTION_MODEL_ID = 'gemma-4-e2b-q4';

/**
 * Provider-agnostic guard for "can this model reference drive idea extraction?". Cloud models are
 * always assumed capable; only built-in Nodus models carry a benchmarked verdict. Used by the UI to
 * gate the extraction / basic-mode-generic roles, and by the scan pipeline to warn on a bad choice.
 */
export function modelRefSupportsExtraction(ref: { provider: string; model: string } | null | undefined): boolean {
  if (!ref) return true;
  if (ref.provider !== 'nodus') return true;
  return nodusLocalModelSupportsExtraction(ref.model);
}
