import type { AiProvider, CustomProviderConfig, EmbeddingProvider, ImageProvider, LocalProvider, ModelRef } from './types';

// Single source of truth for provider identity, labels and defaults, shared by
// the main process (electron/) and the renderer (src/). Adding a provider to
// the AiProvider/EmbeddingProvider unions in types.ts forces every Record and
// switch below to be updated — lean on typecheck.

/** Every AI provider, in the order pickers and Settings show them. */
export const AI_PROVIDERS: AiProvider[] = [
  'anthropic',
  'openai',
  'codex',
  'github-copilot',
  'opencode-go',
  'openrouter',
  'groq',
  'cerebras',
  'deepseek',
  'gemini',
  'xiaomi',
  'ollama',
  'lmstudio',
  'custom',
];

/** Providers whose credentials are Nodus-managed API keys/tokens. ChatGPT's
 * managed OAuth session belongs to Codex and must never enter backup/recovery. */
export const SECRET_PROVIDERS: Exclude<AiProvider, 'codex' | 'github-copilot' | 'nodus'>[] = [
  'anthropic',
  'openai',
  'opencode-go',
  'openrouter',
  'groq',
  'cerebras',
  'deepseek',
  'gemini',
  'xiaomi',
  'ollama',
  'lmstudio',
  'custom',
];

/**
 * Image generation is a separate provider set from text: it has its own key
 * ('google', not 'gemini' — the image models live under a different API), and not
 * every text provider can return pixels. Kept here so the settings picker, the
 * per-image picker in the design modal and the main-process validation all read
 * the same list instead of each hardcoding one.
 */
export const IMAGE_PROVIDERS: ImageProvider[] = ['google', 'openai', 'openrouter', 'nodus', 'codex'];

export const IMAGE_PROVIDER_LABELS: Record<ImageProvider, string> = {
  google: 'Google',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  nodus: 'Nodus local',
  codex: 'ChatGPT · Codex',
};

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  codex: 'ChatGPT · Codex',
  'github-copilot': 'GitHub Copilot',
  'opencode-go': 'OpenCode Go',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  cerebras: 'Cerebras',
  deepseek: 'DeepSeek',
  gemini: 'Google Gemini',
  xiaomi: 'Xiaomi MiMo',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  // Not a brand: the endpoint is whatever the user runs. Kept in English like the
  // rest of this record because it is rendered raw by modelLabel() in every model
  // picker; the descriptive prose around it in Settings is translated normally.
  custom: 'Custom (OpenAI-compatible)',
  nodus: 'Nodus local',
};

/** Order two model refs for the pickers: by provider label (A→Z), then model id (A→Z). */
export function compareModelRefs(a: ModelRef, b: ModelRef): number {
  const byProvider = (PROVIDER_LABELS[a.provider] ?? a.provider).localeCompare(
    PROVIDER_LABELS[b.provider] ?? b.provider,
    undefined,
    { sensitivity: 'base' }
  );
  if (byProvider !== 0) return byProvider;
  return a.model.localeCompare(b.model, undefined, { sensitivity: 'base' });
}

/** Sorted copy of `models`: alphabetical by provider label, then by model name. */
export function sortModelRefs(models: ModelRef[]): ModelRef[] {
  return [...models].sort(compareModelRefs);
}

/** Providers whose connection is a user-configured local/LAN server (no API key). */
export const LOCAL_PROVIDERS: LocalProvider[] = ['ollama', 'lmstudio'];

export function isLocalProvider(provider: AiProvider): provider is LocalProvider {
  return provider === 'ollama' || provider === 'lmstudio';
}

/**
 * Providers billed against a personal ChatGPT / GitHub subscription instead of
 * pay-per-use API credit. Their runtimes are agent protocols that accept a prompt, a
 * model and a reasoning effort and nothing else — which is why the two predicates
 * below both key off this one list rather than repeating it.
 */
export const SUBSCRIPTION_PROVIDERS: AiProvider[] = ['codex', 'github-copilot'];

/** Usage lands on the user's plan quota (weekly/monthly caps), not on API credit. */
export function isSubscriptionProvider(provider: AiProvider): boolean {
  return SUBSCRIPTION_PROVIDERS.includes(provider);
}

/**
 * Providers with a free tier whose hard per-minute limits are worth shaping requests for. When the
 * user flags one (settings.providerFreeTier), Nodus caps max_tokens to fit and retries 429s instead
 * of failing the scan. Others ignore the flag. See freeTierMaxTokens in electron/ai/providers.ts.
 */
export const FREE_TIER_PROVIDERS: AiProvider[] = ['groq', 'openrouter'];

/** Whether a free-tier "usar API gratuita" toggle is meaningful for this provider. */
export function supportsFreeTierShaping(provider: AiProvider): boolean {
  return FREE_TIER_PROVIDERS.includes(provider);
}

/**
 * Whether a provider honours per-request sampling controls (`temperature`,
 * `max_tokens`, `response_format`).
 *
 * The subscription runtimes do not. That matters to `completeJson`, whose retry
 * ladder escalates by lowering temperature and then dropping JSON mode — for these
 * providers every rung is a byte-identical request, so the ladder must not spend
 * three subscription turns discovering that.
 */
export function supportsSamplingControls(provider: AiProvider): boolean {
  return !isSubscriptionProvider(provider);
}

/** Server base URL each local provider ships with (no trailing slash). */
export const DEFAULT_LOCAL_BASE_URLS: Record<LocalProvider, string> = {
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234',
};

// ── Custom (OpenAI-compatible) provider ──────────────────────────────────────
// Pure normalisers, kept here rather than in electron/ai/providers.ts so that the
// settings repository can call them without importing the module that reads
// settings — that pair imports each other and the cycle is real.

/**
 * The endpoint exactly as typed, minus any trailing slash.
 *
 * Deliberately NOT `${url}/v1` the way the local providers build theirs: these
 * gateways mount the OpenAI API wherever they please (LiteLLM at the root, vLLM
 * at /v1, proxies under /openai/v1), so guessing the suffix would break as many
 * installs as it fixed. The user pastes the complete base.
 */
export function normalizeCustomBaseUrl(raw: string): string {
  return String(raw ?? '').trim().replace(/\/+$/, '');
}

/** Model slugs typed by hand: trimmed, de-duplicated, order preserved. */
export function normalizeCustomModels(models: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of models ?? []) {
    const id = String(raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Normalise a whole stored or incoming config blob. */
export function normalizeCustomProviderConfig(config: Partial<CustomProviderConfig> | undefined): CustomProviderConfig {
  return {
    baseUrl: normalizeCustomBaseUrl(config?.baseUrl ?? ''),
    models: normalizeCustomModels(config?.models),
  };
}

/** Hostnames that are this machine by definition, whatever the DNS suffix situation. */
const LOCAL_HOSTNAMES = new Set([
  'localhost',
  '0.0.0.0',
  '::',
  '::1',
  // Docker Desktop publishes these aliases inside a container so it can reach the host.
  'host.docker.internal',
  'gateway.docker.internal',
  'host.containers.internal',
]);

/**
 * Suffixes reserved for private networks: mDNS, the IANA private-use TLDs, and the
 * MagicDNS name Tailscale hands out. A model server answering on one of these is the
 * user's own hardware, reached over their own network.
 */
const LOCAL_HOST_SUFFIXES = ['.localhost', '.local', '.localdomain', '.lan', '.internal', '.home', '.home.arpa', '.ts.net'];

/** The hostname of a base URL, tolerating a missing scheme ("localhost:8080/v1"). */
function hostnameOf(rawUrl: string | null | undefined): string | null {
  const raw = String(rawUrl ?? '').trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    return new URL(withScheme).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return null;
  }
}

/** Loopback, RFC 1918, link-local, and the CGNAT range Tailscale and friends hand out. */
function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (octets.some((value) => Number.isNaN(value) || value > 255)) return false;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** IPv6 unique-local (fc00::/7) and link-local (fe80::/10). */
function isPrivateIpv6(host: string): boolean {
  const firstGroup = host.split(':').find((group) => group.length > 0);
  if (!firstGroup) return false;
  const value = Number.parseInt(firstGroup, 16);
  if (Number.isNaN(value)) return false;
  return (value & 0xfe00) === 0xfc00 || (value & 0xffc0) === 0xfe80;
}

/**
 * An IPv4 address written as an IPv4-mapped IPv6 one, in the hex the URL parser leaves it
 * in: `::ffff:7f00:1` is 127.0.0.1, which is how a v6-only stack writes loopback.
 */
function mappedIpv4(host: string): string | null {
  const match = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!match) return null;
  const high = Number.parseInt(match[1], 16);
  const low = Number.parseInt(match[2], 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/**
 * Whether a custom endpoint's address is this machine or the user's own network.
 *
 * The transport gives an on-device model a far longer completion budget than a cloud one —
 * nothing is billed by the second there, and the wait IS the work. That budget used to be
 * decided by provider id alone, so a llama.cpp server at `http://localhost:8080/v1` — the
 * exact setup the custom provider exists for — was held to the three-minute cloud ceiling
 * and timed out on every long extraction chunk, with no setting able to say otherwise.
 *
 * Deliberately generous about what counts as local: answering "local" for an address that
 * belongs to nobody only lengthens a request that would otherwise fail, while answering
 * "cloud" for the user's own machine breaks a scan that works. Anything on loopback, a
 * private range, a container host alias or a private-network DNS suffix counts.
 */
export function isLocalEndpointAddress(rawUrl: string | null | undefined): boolean {
  const host = hostnameOf(rawUrl);
  if (!host) return false;
  if (LOCAL_HOSTNAMES.has(host)) return true;
  if (LOCAL_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (!host.includes(':')) return isPrivateIpv4(host);
  const mapped = mappedIpv4(host);
  return mapped ? isPrivateIpv4(mapped) : isPrivateIpv6(host);
}

/** Embedding-capable providers, in the order the Settings selector shows them. */
export const EMBEDDING_PROVIDERS: EmbeddingProvider[] = ['openai', 'gemini', 'openrouter', 'ollama', 'lmstudio', 'nodus'];

export const DEFAULT_EMBEDDING_MODELS: Record<EmbeddingProvider, string> = {
  openai: 'text-embedding-3-small',
  gemini: 'gemini-embedding-001',
  openrouter: 'baai/bge-m3',
  ollama: 'nomic-embed-text',
  lmstudio: 'text-embedding-nomic-embed-text-v1.5',
  nodus: 'multilingual-e5-small-int8',
};

/** Coerce a stored/unknown value to a valid embedding provider ('openai' fallback). */
export function normalizeEmbeddingProvider(provider: unknown): EmbeddingProvider {
  return (EMBEDDING_PROVIDERS as unknown[]).includes(provider) ? (provider as EmbeddingProvider) : 'openai';
}

/** Repair a user-typed embedding model id: empty → provider default; legacy
 *  OpenRouter "author:slug" → "author/slug". */
export function normalizeEmbeddingModel(provider: EmbeddingProvider, modelId: string): string {
  const trimmed = modelId.trim() || DEFAULT_EMBEDDING_MODELS[provider];
  if (provider === 'openrouter' && !trimmed.includes('/') && trimmed.includes(':')) {
    const [author, slug] = trimmed.split(':', 2);
    if (author && slug) return `${author.toLowerCase()}/${slug}`;
  }
  return trimmed;
}
