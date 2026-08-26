/**
 * The metadata that makes two embedding vectors comparable.
 *
 * Keep this module dependency-free: it is used by the browser, Electron and the
 * server's equivalent ESM module.  Do not add a field without also updating the
 * canonicalisation and migration rules in the server module.
 */

export const EMBEDDING_CONTRACT_FIELDS = [
  'provider',
  'model',
  'dim',
  'protocol',
  'task',
  'preprocessing',
  'normalization',
  'quantization',
  'configVersion',
] as const;

export const LEGACY_LOCKED_PROTOCOL = 'legacy_locked';
export const LEGACY_V1_CONFIG_VERSION = 'vector-v1';
export const LEGACY_UNKNOWN_VALUE = 'unknown';
export const VECTOR_FORMAT = 'nodus.vectors';

type JsonPrimitive = string | number | boolean | null;
export type EmbeddingMetadataValue = JsonPrimitive | readonly EmbeddingMetadataValue[] | { readonly [key: string]: EmbeddingMetadataValue };

export type EmbeddingContractInput = {
  provider: string;
  model: string;
  dim: number;
  protocol: string;
  task: EmbeddingMetadataValue;
  preprocessing: EmbeddingMetadataValue;
  normalization: EmbeddingMetadataValue;
  quantization: EmbeddingMetadataValue;
  configVersion: string | number;
};

export type EmbeddingContract = Readonly<EmbeddingContractInput>;

export type LegacyVectorV1Header = {
  format?: unknown;
  version?: unknown;
  provider?: unknown;
  model?: unknown;
  dim?: unknown;
  quant?: unknown;
  [key: string]: unknown;
};

const FIELD_SET = new Set<string>(EMBEDDING_CONTRACT_FIELDS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneAndValidateJson(value: unknown, path: string): EmbeddingMetadataValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must contain only finite JSON numbers.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => cloneAndValidateJson(entry, `${path}[${index}]`));
  if (!isPlainObject(value)) throw new Error(`${path} must be JSON-serializable.`);
  const output: Record<string, EmbeddingMetadataValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new Error(`${path} contains a forbidden key.`);
    }
    output[key] = cloneAndValidateJson(entry, `${path}.${key}`);
  }
  return output;
}

function normalizeIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

function normalizeConfigVersion(value: unknown): string | number {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  throw new Error('configVersion must be a non-negative integer or non-empty string.');
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Validate and copy a contract. The returned value is deeply immutable and has
 * exactly the nine contract fields; caller-owned objects are never retained.
 */
export function createEmbeddingContract(input: unknown): EmbeddingContract {
  if (!isPlainObject(input)) throw new Error('Embedding contract must be an object.');
  for (const key of Object.keys(input)) {
    if (!FIELD_SET.has(key)) throw new Error(`Unknown embedding contract field: ${key}.`);
  }
  for (const field of EMBEDDING_CONTRACT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) throw new Error(`Missing embedding contract field: ${field}.`);
  }
  const contract: EmbeddingContractInput = {
    provider: normalizeIdentifier(input.provider, 'provider'),
    model: normalizeIdentifier(input.model, 'model'),
    dim: input.dim as number,
    protocol: normalizeIdentifier(input.protocol, 'protocol'),
    task: cloneAndValidateJson(input.task, 'task'),
    preprocessing: cloneAndValidateJson(input.preprocessing, 'preprocessing'),
    normalization: cloneAndValidateJson(input.normalization, 'normalization'),
    quantization: cloneAndValidateJson(input.quantization, 'quantization'),
    configVersion: normalizeConfigVersion(input.configVersion),
  };
  if (!Number.isSafeInteger(contract.dim) || contract.dim <= 0 || contract.dim > 8192) {
    throw new Error('dim must be a safe integer between 1 and 8192.');
  }
  return freezeDeep(contract);
}

export const validateEmbeddingContract = createEmbeddingContract;

/** Return false rather than throwing for boundary checks and untrusted headers. */
export function isValidEmbeddingContract(input: unknown): input is EmbeddingContract {
  try { createEmbeddingContract(input); return true; } catch { return false; }
}

function canonicalValue(value: EmbeddingMetadataValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const objectValue = value as { readonly [key: string]: EmbeddingMetadataValue };
    return `{${Object.keys(objectValue).sort().map((key) => `${JSON.stringify(key)}:${canonicalValue(objectValue[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Stable JSON (sorted recursively) used as the fingerprint input. */
export function canonicalizeEmbeddingContract(input: unknown): string {
  const contract = createEmbeddingContract(input);
  return `{${EMBEDDING_CONTRACT_FIELDS.map((field) => `${JSON.stringify(field)}:${canonicalValue(contract[field])}`).join(',')}}`;
}
export const canonicalEmbeddingContract = canonicalizeEmbeddingContract;

/** Browser-safe SHA-256 fingerprint. */
export async function fingerprintEmbeddingContract(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalizeEmbeddingContract(input));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const embeddingContractFingerprint = fingerprintEmbeddingContract;
export const embeddingFingerprint = fingerprintEmbeddingContract;

/** Exact compatibility: every contract field, including preprocessing/config, must match. */
export function embeddingContractsCompatible(left: unknown, right: unknown): boolean {
  try { return canonicalizeEmbeddingContract(left) === canonicalizeEmbeddingContract(right); } catch { return false; }
}

export const embeddingMatchesContract = embeddingContractsCompatible;
export const contractsExactlyCompatible = embeddingContractsCompatible;

export function assertEmbeddingContractsCompatible(left: unknown, right: unknown): true {
  if (!embeddingContractsCompatible(left, right)) throw new Error('Embedding contracts are not exactly compatible.');
  return true;
}

function legacyField(header: LegacyVectorV1Header, field: string): unknown {
  const value = header[field];
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    throw new Error(`Legacy vector v1 header is missing ${field}.`);
  }
  return value;
}

/**
 * Convert one complete vector wire-v1 header into a locked contract. Unknown
 * v1 semantics are explicit sentinels, so an old index can never accidentally
 * compare equal to a fully described modern index.
 */
export function migrateLegacyVectorV1Header(header: unknown): EmbeddingContract {
  if (!isPlainObject(header)) throw new Error('Legacy vector header must be an object.');
  if (header.format !== VECTOR_FORMAT) throw new Error('Only nodus vector headers can be migrated.');
  if (Number(header.version) !== 1) throw new Error('Only vector header version 1 can be migrated.');
  if (header.embeddingContract !== undefined || header.contract !== undefined) {
    throw new Error('Mixed legacy and embedding-contract metadata is ambiguous.');
  }
  for (const field of ['protocol', 'task', 'preprocessing', 'normalization', 'quantization', 'configVersion']) {
    if (Object.prototype.hasOwnProperty.call(header, field)) throw new Error('Mixed legacy and embedding-contract metadata is ambiguous.');
  }
  const dim = Number(legacyField(header, 'dim'));
  const quantValue = legacyField(header, 'quant');
  if (typeof quantValue !== 'string' || quantValue.trim() === '') throw new Error('Legacy vector v1 quant must be a non-empty string.');
  const quant = quantValue.trim();
  return createEmbeddingContract({
    provider: normalizeIdentifier(legacyField(header, 'provider'), 'provider'),
    model: normalizeIdentifier(legacyField(header, 'model'), 'model'),
    dim,
    protocol: LEGACY_LOCKED_PROTOCOL,
    task: LEGACY_UNKNOWN_VALUE,
    preprocessing: LEGACY_UNKNOWN_VALUE,
    normalization: LEGACY_UNKNOWN_VALUE,
    quantization: quant,
    configVersion: LEGACY_V1_CONFIG_VERSION,
  });
}

export const migrateVectorV1Header = migrateLegacyVectorV1Header;
export const migrateV1HeaderToLegacyLocked = migrateLegacyVectorV1Header;

/**
 * Migrate a set only when every header is a complete, homogeneous v1 header.
 * A mixed old/new or heterogeneous set is refused rather than guessed.
 */
export function migrateLegacyVectorV1Headers(headers: unknown): EmbeddingContract {
  if (!Array.isArray(headers) || headers.length === 0) throw new Error('At least one legacy vector header is required.');
  const migrated = headers.map(migrateLegacyVectorV1Header);
  const first = canonicalizeEmbeddingContract(migrated[0]);
  if (migrated.some((contract) => canonicalizeEmbeddingContract(contract) !== first)) {
    throw new Error('Legacy vector headers have mixed embedding metadata.');
  }
  return migrated[0];
}

export const migrateVectorV1Headers = migrateLegacyVectorV1Headers;
export const migrateV1HeadersToLegacyLocked = migrateLegacyVectorV1Headers;
