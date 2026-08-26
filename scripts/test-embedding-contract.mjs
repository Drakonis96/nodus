import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalizeEmbeddingContract,
  createEmbeddingContract,
  embeddingContractsCompatible,
  fingerprintEmbeddingContract,
  migrateLegacyVectorV1Header,
  migrateLegacyVectorV1Headers,
} from '../server/lib/core/embeddingContract.mjs';

const base = Object.freeze({
  provider: 'openai',
  model: 'text-embedding-3-small',
  dim: 1536,
  protocol: 'nodus.embedding.v2',
  task: 'retrieval',
  preprocessing: { unicode: 'NFKC', trim: true },
  normalization: { method: 'l2', epsilon: 1e-12 },
  quantization: 'int8-l2',
  configVersion: 2,
});

test('contracts are deeply immutable and contain the exact metadata fields', () => {
  const contract = createEmbeddingContract(base);
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(Object.isFrozen(contract.preprocessing), true);
  assert.throws(() => { contract.model = 'other'; }, TypeError);
  assert.throws(() => { contract.preprocessing.unicode = 'NFC'; }, TypeError);
  assert.deepEqual(contract, base);
});

test('canonical JSON and SHA-256 fingerprint do not depend on JSON object order', () => {
  const reordered = {
    configVersion: 2,
    quantization: 'int8-l2',
    normalization: { epsilon: 1e-12, method: 'l2' },
    preprocessing: { trim: true, unicode: 'NFKC' },
    task: 'retrieval', protocol: 'nodus.embedding.v2', dim: 1536,
    model: 'text-embedding-3-small', provider: 'openai',
  };
  assert.equal(canonicalizeEmbeddingContract(base), canonicalizeEmbeddingContract(reordered));
  assert.equal(fingerprintEmbeddingContract(base), fingerprintEmbeddingContract(reordered));
  assert.match(fingerprintEmbeddingContract(base), /^[0-9a-f]{64}$/);
});

test('a model, dimension, or config change is incompatible', () => {
  for (const [field, value] of [['model', 'text-embedding-3-large'], ['dim', 3072], ['configVersion', 3]]) {
    assert.equal(embeddingContractsCompatible(base, { ...base, [field]: value }), false, `${field} must invalidate compatibility`);
  }
  assert.equal(embeddingContractsCompatible(base, { ...base, preprocessing: { trim: false, unicode: 'NFKC' } }), false);
  assert.equal(embeddingContractsCompatible(base, { ...base, provider: 'openrouter' }), false);
});

test('v1 migration locks unknown semantics and preserves quantization', () => {
  const legacy = migrateLegacyVectorV1Header({
    format: 'nodus.vectors', version: 1, provider: 'openai',
    model: 'text-embedding-3-small', dim: 1536, quant: 'int8-l2',
  });
  assert.deepEqual(legacy, {
    provider: 'openai', model: 'text-embedding-3-small', dim: 1536,
    protocol: 'legacy_locked', task: 'unknown', preprocessing: 'unknown',
    normalization: 'unknown', quantization: 'int8-l2', configVersion: 'vector-v1',
  });
  assert.equal(embeddingContractsCompatible(legacy, { ...legacy, protocol: 'nodus.embedding.v2' }), false);
});

test('migration rejects ambiguous, incomplete, and mixed v1 state', () => {
  assert.throws(() => migrateLegacyVectorV1Header({ format: 'nodus.vectors', version: 1, provider: 'openai', model: 'm', dim: 3 }), /missing quant/);
  assert.throws(() => migrateLegacyVectorV1Header({ format: 'nodus.vectors', version: 2, provider: 'openai', model: 'm', dim: 3, quant: 'int8-l2' }), /version 1/);
  assert.throws(() => migrateLegacyVectorV1Header({ format: 'nodus.vectors', version: 1, provider: 'openai', model: 'm', dim: 3, quant: 'int8-l2', embeddingContract: {} }), /Mixed/);
  assert.throws(() => migrateLegacyVectorV1Header({ format: 'other.vectors', version: 1, provider: 'openai', model: 'm', dim: 3, quant: 'int8-l2' }), /nodus vector/);
  assert.throws(() => migrateLegacyVectorV1Header({ format: 'nodus.vectors', version: 1, provider: 'openai', model: 'm', dim: 3, quant: 'int8-l2', task: 'retrieval' }), /Mixed/);
  assert.throws(() => migrateLegacyVectorV1Headers([]), /At least one/);
  assert.throws(() => migrateLegacyVectorV1Headers([
    { format: 'nodus.vectors', version: 1, provider: 'openai', model: 'm', dim: 3, quant: 'int8-l2' },
    { format: 'nodus.vectors', version: 1, provider: 'openai', model: 'other', dim: 3, quant: 'int8-l2' },
  ]), /mixed/);
  assert.throws(() => migrateLegacyVectorV1Headers([
    { format: 'nodus.vectors', version: 1, provider: 'openai', model: 'm', dim: 3, quant: 'int8-l2' },
    { format: 'nodus.vectors', version: 1, provider: 'openai', model: 'm', dim: 4, quant: 'int8-l2' },
  ]), /mixed/);
});
