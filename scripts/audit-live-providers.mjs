import assert from 'node:assert/strict';

const geminiKey = process.env.NODUS_AUDIT_GEMINI_KEY?.trim();
const openRouterKey = process.env.NODUS_AUDIT_OPENROUTER_KEY?.trim();
assert.ok(geminiKey, 'NODUS_AUDIT_GEMINI_KEY is required');
assert.ok(openRouterKey, 'NODUS_AUDIT_OPENROUTER_KEY is required');

const geminiModelsResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
  headers: { 'x-goog-api-key': geminiKey },
});
assert.equal(geminiModelsResponse.ok, true, `Gemini catalogue HTTP ${geminiModelsResponse.status}`);
const geminiCatalogue = await geminiModelsResponse.json();
const geminiModels = (geminiCatalogue.models ?? [])
  .filter((model) => (model.supportedGenerationMethods ?? []).includes('generateContent'))
  .map((model) => String(model.name ?? '').replace(/^models\//, ''));
const geminiModel = [
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-lite-preview',
].find((candidate) => geminiModels.includes(candidate))
  ?? geminiModels.find((candidate) => /^gemini-.*flash-lite(?:-|$)/.test(candidate));
assert.ok(geminiModel, 'No Gemini Flash Lite model is available for this key');

const geminiResponse = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Return exactly the JSON object {"status":"ok","sum":4}. Do not add prose.' }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 64, responseMimeType: 'application/json' },
    }),
  },
);
const geminiPayload = await geminiResponse.json();
assert.equal(geminiResponse.ok, true, `Gemini generation HTTP ${geminiResponse.status}: ${geminiPayload?.error?.message ?? 'unknown'}`);
const geminiText = geminiPayload?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
const geminiJson = JSON.parse(geminiText);
assert.deepEqual(geminiJson, { status: 'ok', sum: 4 });

const embeddingResponse = await fetch('https://openrouter.ai/api/v1/embeddings', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${openRouterKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/Drakonis96/nodus',
    'X-Title': 'Nodus AI audit',
  },
  body: JSON.stringify({
    model: 'baai/bge-m3',
    input: [
      'La reina gobernó el reino desde Toledo.',
      'La monarca dirigió el país desde la ciudad de Toledo.',
      'Una receta explica cómo hornear pan de centeno.',
    ],
  }),
});
const embeddingPayload = await embeddingResponse.json();
assert.equal(embeddingResponse.ok, true, `OpenRouter embeddings HTTP ${embeddingResponse.status}: ${embeddingPayload?.error?.message ?? 'unknown'}`);
const vectors = (embeddingPayload.data ?? []).map((item) => item.embedding);
assert.equal(vectors.length, 3);
assert.ok(vectors.every((vector) => Array.isArray(vector) && vector.length > 100));
assert.equal(new Set(vectors.map((vector) => vector.length)).size, 1);

const cosine = (left, right) => {
  let dot = 0;
  let a = 0;
  let b = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    a += left[index] ** 2;
    b += right[index] ** 2;
  }
  return dot / (Math.sqrt(a) * Math.sqrt(b));
};
const related = cosine(vectors[0], vectors[1]);
const unrelated = cosine(vectors[0], vectors[2]);
assert.ok(related > unrelated, `BGE-M3 semantic ordering failed (${related} <= ${unrelated})`);

console.log(JSON.stringify({
  geminiModel,
  geminiJsonMode: true,
  embeddingModel: embeddingPayload.model ?? 'baai/bge-m3',
  embeddingDimension: vectors[0].length,
  semanticMargin: Number((related - unrelated).toFixed(4)),
}));
