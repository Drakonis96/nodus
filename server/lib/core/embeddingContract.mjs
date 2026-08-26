// The server-side implementation of shared/embeddingContract.ts.
// Keep both modules byte-for-byte compatible at the contract boundary: the
// fingerprint is persisted and is deliberately independent of object key order.
import { createHash } from 'node:crypto';

export const EMBEDDING_CONTRACT_FIELDS = Object.freeze([
  'provider', 'model', 'dim', 'protocol', 'task', 'preprocessing',
  'normalization', 'quantization', 'configVersion',
]);
export const LEGACY_LOCKED_PROTOCOL = 'legacy_locked';
export const LEGACY_V1_CONFIG_VERSION = 'vector-v1';
export const LEGACY_UNKNOWN_VALUE = 'unknown';
export const VECTOR_FORMAT = 'nodus.vectors';

const FIELD_SET = new Set(EMBEDDING_CONTRACT_FIELDS);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneAndValidateJson(value, path) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must contain only finite JSON numbers.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => cloneAndValidateJson(entry, `${path}[${index}]`));
  if (!isPlainObject(value)) throw new Error(`${path} must be JSON-serializable.`);
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error(`${path} contains a forbidden key.`);
    output[key] = cloneAndValidateJson(entry, `${path}.${key}`);
  }
  return output;
}

function normalizeIdentifier(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

function normalizeConfigVersion(value) {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  throw new Error('configVersion must be a non-negative integer or non-empty string.');
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

/** Validate and deeply freeze a copied contract with exactly the nine fields. */
export function createEmbeddingContract(input) {
  if (!isPlainObject(input)) throw new Error('Embedding contract must be an object.');
  for (const key of Object.keys(input)) if (!FIELD_SET.has(key)) throw new Error(`Unknown embedding contract field: ${key}.`);
  for (const field of EMBEDDING_CONTRACT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) throw new Error(`Missing embedding contract field: ${field}.`);
  }
  const contract = {
    provider: normalizeIdentifier(input.provider, 'provider'),
    model: normalizeIdentifier(input.model, 'model'),
    dim: input.dim,
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

export function isValidEmbeddingContract(input) {
  try { createEmbeddingContract(input); return true; } catch { return false; }
}

function canonicalValue(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Stable compact JSON with recursively sorted object keys. */
export function canonicalizeEmbeddingContract(input) {
  const contract = createEmbeddingContract(input);
  return `{${EMBEDDING_CONTRACT_FIELDS.map((field) => `${JSON.stringify(field)}:${canonicalValue(contract[field])}`).join(',')}}`;
}
export const canonicalEmbeddingContract = canonicalizeEmbeddingContract;

/** Synchronous SHA-256, suitable for request/header validation on Node. */
export function fingerprintEmbeddingContract(input) {
  return createHash('sha256').update(canonicalizeEmbeddingContract(input), 'utf8').digest('hex');
}
export const embeddingContractFingerprint = fingerprintEmbeddingContract;
export const embeddingFingerprint = fingerprintEmbeddingContract;

/** Every field must match; dim/provider/model alone are intentionally insufficient. */
export function embeddingContractsCompatible(left, right) {
  try { return canonicalizeEmbeddingContract(left) === canonicalizeEmbeddingContract(right); } catch { return false; }
}
export const embeddingMatchesContract = embeddingContractsCompatible;
export const contractsExactlyCompatible = embeddingContractsCompatible;

export function assertEmbeddingContractsCompatible(left, right) {
  if (!embeddingContractsCompatible(left, right)) throw new Error('Embedding contracts are not exactly compatible.');
  return true;
}

function legacyField(header, field) {
  const value = header[field];
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    throw new Error(`Legacy vector v1 header is missing ${field}.`);
  }
  return value;
}

/** Convert one complete v1 wire header to an explicitly locked legacy contract. */
export function migrateLegacyVectorV1Header(header) {
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
export const migrateVectorHeaderToLegacyLocked = migrateLegacyVectorV1Header;
export const migrateV1HeaderToLegacyLocked = migrateLegacyVectorV1Header;

/** Refuse heterogeneous, empty or mixed header sets instead of guessing metadata. */
export function migrateLegacyVectorV1Headers(headers) {
  if (!Array.isArray(headers) || headers.length === 0) throw new Error('At least one legacy vector header is required.');
  const migrated = headers.map(migrateLegacyVectorV1Header);
  const first = canonicalizeEmbeddingContract(migrated[0]);
  if (migrated.some((contract) => canonicalizeEmbeddingContract(contract) !== first)) {
    throw new Error('Legacy vector headers have mixed embedding metadata.');
  }
  return migrated[0];
}
export const migrateVectorV1Headers = migrateLegacyVectorV1Headers;
export const migrateVectorHeadersToLegacyLocked = migrateLegacyVectorV1Headers;
export const migrateV1HeadersToLegacyLocked = migrateLegacyVectorV1Headers;
