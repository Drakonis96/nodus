// Semantic search on the server.
//
// The server holds the corpus matrix and does the arithmetic; the client embeds its own
// query with its own key and posts the vector, because the server has no API key and must
// never be given one. Two things have to hold for that to be worth doing:
//
//   • int8 quantization must not change which results come back. A hundred thousand
//     passages at float32 is ~600 MB, at int8 it is ~150 MB, and the trade is only
//     acceptable if the ranking survives it — measured here against exact float cosine.
//   • a provider mismatch must never look like an empty corpus. Two different 1536-dimension
//     models would "work" and return confident nonsense, so the check is provider AND model
//     AND dimension, and a mismatch answers with a warning instead of a silent [].
import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeVectorSet, embeddingMatches, encodeVectorSet, normalize, searchVectors } from '../server/lib/core/vectors.mjs';
import { academicSnapshot, publish } from './lib/nodusServerFixtures.mjs';
import { withServer } from './lib/nodusServerHarness.mjs';

const DIM = 128;

/** Deterministic pseudo-random vectors: no Math.random, so a failure is reproducible. */
function pseudoVector(seed, dim = DIM) {
  const vector = new Float32Array(dim);
  let state = seed * 2654435761 % 4294967296;
  for (let index = 0; index < dim; index += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    vector[index] = (state / 2147483648) * 2 - 1;
  }
  return vector;
}

function exactCosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    na += a[index] * a[index];
    nb += b[index] * b[index];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

test('int8 quantization preserves the ranking float32 would give', () => {
  const entries = Array.from({ length: 400 }, (_, index) => ({ id: `i-${index}`, vector: pseudoVector(index + 1) }));
  const encoded = encodeVectorSet({ kind: 'ideas', provider: 'openai', model: 'text-embedding-3-small', dim: DIM, entries });
  const set = decodeVectorSet(encoded);
  assert.equal(set.count, 400);
  assert.equal(set.dim, DIM);
  assert.equal(set.header.quant, 'int8-l2');

  // A vector of 128 int8 components plus its id: an order of magnitude under float32.
  assert.ok(encoded.length < 400 * DIM * 4, 'the encoded set is far smaller than float32 would be');

  const query = pseudoVector(9_999);
  const approximate = searchVectors(set, query, { limit: 10 }).map((match) => match.id);
  const exact = entries
    .map((entry) => ({ id: entry.id, score: exactCosine(query, entry.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((match) => match.id);

  const overlap = approximate.filter((id) => exact.includes(id)).length;
  assert.ok(overlap >= 9, `top-10 overlap with exact cosine was ${overlap}/10`);
  assert.equal(approximate[0], exact[0], 'the best match is the same one');

  // And the scores themselves stay close enough for the app's own thresholds (0.28 / 0.32).
  for (const match of searchVectors(set, query, { limit: 5 })) {
    const entry = entries.find((candidate) => candidate.id === match.id);
    assert.ok(Math.abs(match.score - exactCosine(query, entry.vector)) < 0.01, 'quantization error stays well under the relevance thresholds');
  }

  // A threshold filters rather than truncates.
  const filtered = searchVectors(set, query, { limit: 100, threshold: 0.99 });
  assert.ok(filtered.length < 100);
  for (const match of filtered) assert.ok(match.score >= 0.99);
});

test('a malformed vector payload is rejected with a reason, not a crash', () => {
  assert.throws(() => decodeVectorSet(Buffer.alloc(2)), /truncated/);
  assert.throws(() => decodeVectorSet(Buffer.alloc(64)), /header/);

  const good = encodeVectorSet({ kind: 'ideas', provider: 'openai', model: 'm', dim: 4, entries: [{ id: 'a', vector: [1, 0, 0, 0] }] });
  // Truncating the matrix is the failure a partial upload would produce.
  assert.throws(() => decodeVectorSet(good.subarray(0, good.length - 2)), /matrix/);

  const wrongQuant = encodeVectorSet({ kind: 'ideas', provider: 'openai', model: 'm', dim: 4, entries: [{ id: 'a', vector: [1, 0, 0, 0] }] });
  const header = JSON.parse(wrongQuant.subarray(4, 4 + wrongQuant.readUInt32LE(0)).toString('utf8'));
  assert.equal(header.format, 'nodus.vectors');
  assert.equal(header.version, 1);

  assert.equal(normalize([0, 0, 0]).every((value) => value === 0), true, 'a zero vector normalizes to zero rather than NaN');
});

test('provider, model and dimension must all match before a comparison is allowed', () => {
  const header = { provider: 'openai', model: 'text-embedding-3-small', dim: 1536 };
  assert.equal(embeddingMatches(header, { provider: 'openai', model: 'text-embedding-3-small', dim: 1536 }), true);
  assert.equal(embeddingMatches(header, { provider: 'openai', model: 'text-embedding-3-large', dim: 1536 }), false,
    'same provider, same dimension, different model — the vectors are not comparable');
  assert.equal(embeddingMatches(header, { provider: 'gemini', model: 'text-embedding-3-small', dim: 1536 }), false);
  assert.equal(embeddingMatches(header, { provider: 'openai', model: 'text-embedding-3-small', dim: 3072 }), false);
  assert.equal(embeddingMatches(null, header), false);
});

test('the server searches its own matrix and never lies about an index it does not have', { timeout: 60_000 }, async () => {
  await withServer({ label: 'vectors' }, async (server) => {
    const spaceId = await server.createSpace('Corpus');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    await server.createUser('lector@example.test', 'lector-account-password', [{ spaceId, role: 'reader' }]);
    const reader = await server.deviceToken('lector@example.test', 'lector-account-password', spaceId);
    await publish(server.origin, owner.deviceToken, spaceId, academicSnapshot());

    // Before any vectors exist, a semantic search degrades to lexical AND says so. An empty
    // list here would read as "the corpus does not discuss this", which would be a lie.
    const unindexed = await (await server.api(reader.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/search/semantic`, {
      json: { query: 'archivo', vector: [0.1, 0.2], provider: 'openai', model: 'text-embedding-3-small', dim: 2 },
    })).json();
    assert.equal(unindexed.indexed, false);
    assert.equal(unindexed.reason, 'no_vectors');
    assert.equal(unindexed.fallback, 'lexical');
    assert.match(unindexed.warning, /does NOT mean the corpus lacks the topic/);
    assert.ok(unindexed.results.length > 0, 'the lexical fallback still finds the word');

    // Publishing vectors is the owner's alone.
    const entries = [
      { id: 'i-a', vector: pseudoVector(1) },
      { id: 'i-b', vector: pseudoVector(2) },
      { id: 'i-c', vector: pseudoVector(3) },
    ];
    const payload = encodeVectorSet({ kind: 'ideas', provider: 'openai', model: 'text-embedding-3-small', dim: DIM, entries });
    const refused = await server.api(reader.deviceToken, 'PUT', `/api/v1/spaces/${spaceId}/vectors?kind=ideas`, { body: payload });
    assert.equal(refused.status, 403);

    const uploaded = await server.api(owner.deviceToken, 'PUT', `/api/v1/spaces/${spaceId}/vectors?kind=ideas`, { body: payload });
    assert.equal(uploaded.status, 200);
    const summary = await uploaded.json();
    assert.equal(summary.count, 3);
    assert.equal(summary.dim, DIM);

    // A matching client gets real semantic results, joined back to the snapshot rows.
    const matched = await (await server.api(reader.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/search/semantic`, {
      json: { vector: Array.from(pseudoVector(2)), provider: 'openai', model: 'text-embedding-3-small', dim: DIM, limit: 3 },
    })).json();
    assert.equal(matched.indexed, true);
    assert.equal(matched.indexable, 3);
    assert.equal(matched.results[0].id, 'i-b', 'the query is its own nearest neighbour');
    assert.equal(matched.results[0].row.label, 'Tesis B', 'a hit resolves to the real corpus row');
    assert.ok(matched.results[0].score > 0.99);

    // A different provider is told exactly why, with both sides named.
    const mismatched = await (await server.api(reader.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/search/semantic`, {
      json: { query: 'archivo', vector: Array.from(pseudoVector(2)), provider: 'gemini', model: 'gemini-embedding-001', dim: DIM },
    })).json();
    assert.equal(mismatched.indexed, false);
    assert.equal(mismatched.reason, 'provider_mismatch');
    assert.equal(mismatched.expected.provider, 'openai');
    assert.equal(mismatched.received.provider, 'gemini');
    assert.equal(mismatched.fallback, 'lexical');

    // A right-provider, wrong-length vector is a client bug and says so plainly.
    const wrongLength = await server.api(reader.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/search/semantic`, {
      json: { vector: [1, 2, 3], provider: 'openai', model: 'text-embedding-3-small', dim: DIM },
    });
    assert.equal(wrongLength.status, 400);
    assert.match((await wrongLength.json()).error_description, /indexed at 128 dimensions/);

    // A payload whose declared kind disagrees with the query string is refused.
    const wrongKind = await server.api(owner.deviceToken, 'PUT', `/api/v1/spaces/${spaceId}/vectors?kind=passages`, { body: payload });
    assert.equal(wrongKind.status, 400);
    assert.equal((await wrongKind.json()).error, 'kind_mismatch');

    const corrupt = await server.api(owner.deviceToken, 'PUT', `/api/v1/spaces/${spaceId}/vectors?kind=ideas`, { body: Buffer.alloc(32) });
    assert.equal(corrupt.status, 400);
  });
});

test('the context package hands over material and a budget, never a model key', { timeout: 60_000 }, async () => {
  await withServer({ label: 'context' }, async (server) => {
    const spaceId = await server.createSpace('Corpus');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    // Enough matching material that a tight budget genuinely has to cut something; the base
    // fixture is smaller than the 1000-character floor the endpoint clamps to.
    const wide = academicSnapshot({
      tables: {
        ideas: Array.from({ length: 60 }, (_, index) => ({
          global_id: `i-${index}`, type: 'claim', label: `Tesis ${index}`,
          statement: `El archivo condiciona la memoria en el caso número ${index} del corpus.`,
          created_at: '2026-01-01T00:00:00.000Z',
        })),
      },
    });
    await publish(server.origin, owner.deviceToken, spaceId, wide);

    const response = await server.api(owner.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/context`, { json: { query: 'archivo' } });
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.ok(value.sections.length > 0);
    assert.ok(value.sections.some((section) => section.kind === 'ideas'));
    assert.ok(value.stats.chars > 0);
    assert.equal(value.stats.truncated, false);
    assert.equal(value.citationScheme.idea, 'nodus://idea/<global_id>');
    // The server returns retrieval, not an answer, and holds no provider credential to
    // produce one with.
    assert.equal('answer' in value, false);
    assert.equal(JSON.stringify(value).includes('api_key'), false);

    // A tight budget truncates honestly instead of quietly dropping material.
    const tight = await (await server.api(owner.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/context`, { json: { query: 'archivo', budget: 1000 } })).json();
    assert.equal(tight.stats.budget, 1000);
    assert.ok(tight.stats.chars <= 1000);
    assert.equal(tight.stats.truncated, true);
  });
});
