# Decorative image generation

Verified against provider documentation on 2026-07-10.

## Behavior and persistence

Decorative images are opt-in per Inmersión or Deep Research generation. When
disabled, Nodus neither asks the text model for visual context nor calls an image
provider. When enabled, the complete main content is generated and committed
first; image work is then queued independently in the Electron main process.

One compact prompt and one image request are made. SDK and compatibility retries
are explicitly disabled for this workflow. A successful image is stored and
reused; there are no automatic retries. The SQLite `decorative_images` row
records whether it was requested, status, provider, model, style, visual context,
final prompt, persistent asset reference, MIME type, optimized image, thumbnail,
error, and timestamps. Older records without a row continue to render normally.

API keys remain in Electron `safeStorage` and never cross into the renderer.
Google reuses the configured Gemini key; OpenAI and OpenRouter reuse their
existing keys. No new environment variables are required.

## Providers

### Google

Nodus uses the official `@google/genai` client and the generally available
Interactions API with an image-only JPEG response, 16:9 aspect ratio, and 1K
resolution. The supported catalog is:

- `gemini-3.1-flash-lite-image` (Nano Banana 2 Lite)
- `gemini-3.1-flash-image` (Nano Banana 2)
- `gemini-3-pro-image` (Nano Banana Pro)
- `gemini-2.5-flash-image` (legacy Nano Banana)

`gemini-3.1-flash-lite-image` is a real documented model identifier and supports
only 1K output. Imagen 4 is deliberately excluded because Google marks it
deprecated with shutdown planned for 2026-08-17. Sources:
[image generation](https://ai.google.dev/gemini-api/docs/image-generation) and
[pricing](https://ai.google.dev/gemini-api/docs/pricing).

Known limitation: Google states that every generated image contains a SynthID
watermark. The shared prompt still asks for no visible text, logos, or watermark,
but Nodus cannot and does not remove provider provenance markings.

### OpenAI

Nodus calls the official Image API endpoint
`POST https://api.openai.com/v1/images/generations` and reads the documented
base64 `data[0].b64_json` response. It requests one low-quality 1536×1024 JPEG
with compression. This is the OpenAI API, not a purported “ChatGPT API”.

The catalog follows the current official guide: `gpt-image-2`,
`gpt-image-1.5`, `gpt-image-1`, and `gpt-image-1-mini`. Published low-quality
1536×1024 generation prices are shown directly. Token prices that no longer
appear in the current pricing table remain “Not available” rather than being
estimated. Sources: [image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
and [API pricing](https://developers.openai.com/api/docs/pricing).

Known limitation: an OpenAI organization may need API Organization Verification
before GPT Image models are available.

### OpenRouter

The model list is loaded live from `GET /api/v1/images/models`, then filtered so
`architecture.output_modalities` contains `image`. Nodus also reads the general
image-output catalog and each model's endpoint records for published pricing.
Generation uses `POST /api/v1/images` with the documented common-denominator
`model`, `prompt`, and `n: 1` fields, avoiding unsupported provider-specific options.
The documented `media_type` is honored; PNG, JPEG, WebP, and SVG outputs are
rasterized locally into the same optimized JPEG/thumbnail storage format.

The UI links to the required live catalog:
[OpenRouter image-output models](https://openrouter.ai/models?output_modalities=image&order=pricing-low-to-high).
API behavior is documented in OpenRouter's
[image generation guide](https://openrouter.ai/docs/guides/overview/multimodal/image-generation).

Known limitation: OpenRouter models and endpoints can publish prices in different
units (per image, image token, or general prompt/completion token). Nodus displays
each published metric but only treats a direct per-image price as sortable.
Sorting stays within provider groups; missing prices are never inferred.

## Failure and cost controls

- Provider calls time out after two minutes and only the image becomes failed.
- A provider/billing/rate-limit/moderation error is shown discreetly and can be
  retried manually.
- Closing Nodus during a request recovers an old pending row into a manual-retry
  error state; it never triggers a request at startup.
- Removing an image invalidates any in-flight result so a late response cannot
  restore it.
- Regeneration requires confirmation because it makes a new potentially billable
  provider request.
- Full encrypted `.nodus` backups include the image BLOBs. The lightweight
  cross-vault sync package does not currently transfer decorative image BLOBs;
  the saved report itself remains portable and functional without them.
