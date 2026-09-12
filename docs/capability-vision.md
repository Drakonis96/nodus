# Native image relevance review (`nodus:vision`)

Capability SDK **2.2.0**, wire API **2**. This is a generic host service, not an image search Skill. No Wikimedia-specific code or Marketplace Skill is included.

## Contract for Marketplace authors

A reviewed, signed first-party capability declares `permissions.vision: { maxRounds: 1..3 }`. Declare the particular public image endpoints under the existing `permissions.network` contract; each source still needs Marketplace review of its access and licensing policy. Vision permission is metered and widening it requires permission approval. Tools in a capability declaring vision must declare `metered: true` and `billing: per-call`; a search-only tool can live in a separate capability if it needs a free billing classification. It does not grant general model, network, attachment, filesystem or credential access. Community API v1 remains sandboxed and gets no new channel.

The injected `CapabilityHostV2` exposes:

```ts
const candidates = await host.vision.prepareImages([
  {
    id: 'candidate-1',
    metadata: { title: 'Public collection image', description: 'Bounded factual metadata' },
    source: { kind: 'public', endpointId: 'approved-images', path: '/public/thumbnail.jpg' }
  }
]);
const result = await host.vision.reviewImages({
  request: invocation.chat.question, // exact ORIGINAL user request, not a rewritten prompt
  candidates: candidates.map(({ id, imageId }) => ({ id, imageId }))
});
```

`prepareImages` accepts 1–5 distinct candidate IDs (ASCII letters/digits/underscore/hyphen, maximum 80 characters). Metadata accepts only `title` (300 characters), `description` and `attribution` (1,000 each). It accepts an approved public endpoint/path, or `source: {kind:'generated', bytes: Uint8Array, mimeType}` from trusted capability code. Generated provenance is **publisher-declared**, not evidence of public origin; a publisher must never relabel private attachments as generated. There is no path, URL, private attachment ID or credential parameter.

The host fetches public sources without cookies/authentication, rejects endpoints with secret injection, enforces the declared GET path, refuses redirects and private IPs, and pins the resolved public address for the TLS connection. Retrieval failures are errors, not fabricated images. Each source raster is decoded, limited to 5 MiB / 16 million pixels, stripped of metadata and reduced to a JPEG of at most 768 × 768 pixels and 512 KiB. Animated inputs use their first frame. The source SHA-256 and actual thumbnail SHA-256, dimensions and provenance accompany the opaque random `imageId`. Original images and thumbnails are never saved by this service. Handles live only for the current turn; they are not exportable evidence or reusable in a later chat.

The core registry also advertises `review-images` through `nodus-capability` for Skills declaring `nodus:vision`. Its input is the same review request plus the usual outer `skillId`, `capabilityId`, `toolId`. It accepts only handles already prepared by the host in that turn. An instruction-only Skill cannot obtain arbitrary network or model access by declaring vision; a candidate-producing capability must supply the handles. For a search/review loop, implement the bounded loop inside that reviewed capability invocation.

## Bounded search → review loop

```ts
for (let batch = 0; batch < 3; batch++) {
  host.signal.throwIfAborted();
  const found = await searchApprovedSource(batch); // author's deterministic, separately bounded search
  if (!found.length) break;
  const prepared = await host.vision.prepareImages(found.slice(0, 5));
  const result = await host.vision.reviewImages({
    request: invocation.chat.question,
    candidates: prepared.map(({ id, imageId }) => ({ id, imageId }))
  });
  if (result.outcome === 'selected') return presentSelected(result, found);
  if (result.outcome !== 'no_relevant_candidate') return metadataFallback(found, result);
  if (result.remainingRounds === 0) break;
}
return reportNoRelevantCandidate();
```

Limits apply across **all** callers sharing a turn, not per loop or worker: three intake batches (15 candidates), three review attempts (including skipped/failed attempts), one operation at a time, 30 seconds per operation, and 120 seconds from first use. A capability's `maxRounds` may lower both its intake and review allowance. Cancelling the invocation aborts pending network/model work and discards late results. No retry, JSON repair, fallback model, tool-enabled inference or recursive completion occurs. No second chat-model turn is scheduled. Search itself remains subject to existing endpoint/worker budgets.

Cost is bounded by at most three model requests, five bounded thumbnails per request, the bounded original request/metadata, and **1,200 output tokens per request**. This is a call/input/output budget, **not a guaranteed currency price**; billing depends on the selected provider. The native tool is marked `billing: per-call`; document Skills therefore use the existing required numeric paid-call ceiling and translated cost notice. The document's paid-call ledger is checked immediately before every actual review. Skips do not spend that ledger.

## Results and trust

Every result has `reviewId`, pinned `model`, `round`, `remainingRounds`, `status`, `outcome`, `selected` candidate IDs and per-candidate `{id,imageId,inspected,relevance,reasoning,thumbnailSha256?}`. Relevance is a finite 0–1 score. The host derives selection from scores ≥0.6, ordered by decreasing score then ID. This is a model judgment, not proof of accuracy.

| Outcome | Status | Meaning |
| --- | --- | --- |
| `selected` | `reviewed` | At least one received thumbnail was judged relevant. |
| `no_relevant_candidate` | `reviewed` | All received thumbnails were rejected. Another bounded batch may be tried. |
| `vision_unavailable` | `skipped` | Text-only, unknown, missing or unsupported provider/model. Use metadata ranking. |
| `privacy_blocked` | `skipped` | An active student privacy context forbids image transmission. |
| `limit_reached` | `skipped` | Time, concurrency or call allowance exhausted. |
| `invalid_review` | `error` | Malformed/incomplete/forged model scores. Nothing selected; no repair call. |
| `review_failed` | `error` | Invalid/expired handles, provider failure or timeout. Nothing selected. |

Only successfully validated reviews mark candidates `inspected: true`; this means actual thumbnails were sent and a validated review returned, not that every image detail was visible. Skips/errors have null scores, false inspection flags and no selection, even if a failed request may have reached the provider. Error details never echo provider bodies, credentials or base64. The model receives fixed relevance instructions, the original request, bounded metadata and actual thumbnails in explicitly enumerated order. It cannot set the model, system prompt, budget, receipt, inspection flag or selected list. Duplicate/unknown/missing IDs, extra fields and out-of-range scores invalidate the entire review.

Native results are emitted by the dispatcher; model-authored result/view/artifact envelopes are rejected before hooks. Opaque handles and thumbnail hashes are host-issued; JSON shaped like a receipt is not an authentication mechanism. Trusted signed API v2 code remains part of the first-party trust boundary, as before; arbitrary third-party code does not become trusted by returning a plausible receipt. Never import a claimed inspection from model prose or a saved JSON object as a host result.

## Selected model and privacy

The selected conversation model is pinned once. Provider-advertised `vision: false` overrides names. Explicit positive metadata is accepted only on adapters with bounded single-completion transports. Ollama uses `/api/show` capabilities; LM Studio, Nodus Local and OpenRouter use existing catalog metadata. Official model families documented below can supply missing modality metadata only when the exact model also exists in the live provider catalog. Custom endpoints never inherit support from an OpenAI-looking name. Unknown models safely skip; no paid capability probe is used.

OpenCode Go skips because its existing adapter refuses image input. Codex and GitHub Copilot subscription transports currently skip: their existing agent runtimes do not expose this service's enforced output-token/single-call contract. A future adapter must implement that contract before enabling review. Other configured native/OpenAI-compatible providers work when their model metadata confirms image support.

Repository-owner authorization on 2026-09-12 introduces a **narrow exception** to the Marketplace's previous blanket exclusion of public personal images: public tool-retrieved imagery and safe attribution may be sent to the selected model solely for image relevance review through this bounded capability. This permits collections, historical photographs, figures and public cultural images, including images depicting people. It does not permit private user files, student records, identity matching, sensitive personal inferences, credentials or unrelated application context. The existing student transport guard remains active when a privacy scope is present. Public availability is not a claim that a source is anonymous, licensed for every reuse or legally unrestricted. Source-specific licensing and attribution remain the retrieval capability's responsibility.

Model references checked for the support table:
- [OpenAI GPT-4.1 modalities](https://developers.openai.com/api/docs/models/gpt-4.1), [GPT-4o](https://developers.openai.com/api/docs/models/gpt-4o), [GPT-5](https://developers.openai.com/api/docs/models/gpt-5).
- [Anthropic model modalities](https://platform.claude.com/docs/en/models/overview).
- [Gemini 2.5 Flash inputs](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash), [Gemini 3.1 Flash-Lite inputs](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite).

## Verification and finalization

`node --test scripts/test-capability-vision.mjs` covers the SDK, service, real image decoding, transport content builders, fail-closed model detection, forged scores/handles, public-source restrictions, retries and cancellation. `node scripts/test-capability-vision-transport.mjs` drives the **real** provider adapter and aiClient against a deterministic local HTTP server, including advertised modalities, transmitted images, output limits, text-only fallback and a 503 with no retry. The full capability suite also exercises the real utility worker and all seven chat orchestrators. `node scripts/verify-vision.mjs` writes four deterministic outcome demos; it uses fixture model judgments, not a live paid model.

This native core capability ships inside the application's release, not as a separately signed Marketplace package. Sync the SDK contract via the existing contracts-only command and run the existing cross-repository signing/install verification. Test keys used by that verifier are not production signatures. Release signing still uses the repository's established release workflow and configured maintainer credentials.

## First Marketplace integration

[Research Visuals / Open Image Finder](https://github.com/NodusResearch/nodus-research-skill-marketplace/tree/main/plugins/research-visuals) owns Wikimedia, Met and Art Institute source adapters and independently checked source settings. The core remains source-agnostic. The worker preserves licences, review receipts and hash equality between prepared and displayed bytes. [Verification evidence](verification/research-visuals/README.md) separates deterministic scenarios from the opt-in live Wikimedia review.
