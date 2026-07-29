# Plan: local extraction models + free "API" mode

Source: slow/failure analysis audit with local models (reddit thread) + standardized benchmark
(paper 7000 words, 5 chunks, `PROMPT_DEEP` real). Data and verdict in memory
`model-analysis-benchmark.md`. Everything below is behavior ** empirically verified**.

## Facts underlying the plan

- Built-in that ** extracts ideas reliably**: only **Gemma 4 E2B** (20/20, 0 bugs, ~92 s/chunk).
- Built-in that ** extracts 0 valid ideas** despite all the techniques (server soning-off,
  json_schema grammar, conciseness, budget 16k, penalties): **Qwen3.5-0.8B** and **LFM2.5-VL-1.6B**.
  They are models of **vision/OCR** (`vision:true`). The 0.8B enters in repeat loop within the JSON.
- Cloud: Gemini 2.5 Flash Lite and DeepSeek v4 Flash work well (reasoning is already turned off on
  scanners).
- **Groq free tier**: the limit is tokens/minute (6k for 8b, 12k for 70b) and counts `prompt +
  max_tokens`. A chunk (~4.8k prompt) + `max_tokens:8000` = ~12.8k → "Request too large".
- **OpenRouter**: models `:free` limit by request/min (~20) and req/day.

## Part A — Local built-in models

### A1. Sorting models by aptitude for extraction
`shared/localAiModels.ts`: add to `NodusLocalModelDefinition` an aptitude flag, e.g.
`supportsExtraction?: boolean` (or `roles`). Values:
- `gemma-4-e2b-q4`: fit (true).
- `qwen3.5-0.8b-q4`, `lfm2.5-vl-1.6b-q4`: NOT fit (false) — still fit for chat/vision/image.
- Helper `nodusModelSupportsExtraction(id)` reusable in main and renderer.

### A2. Lock + alert in the selection UI
- The roles of **extraction** (`extractionModel`) and **generic model in basic mode**
  (`synthesisModel` in basic mode) do NOT allow to choose a model with `supportsExtraction:false`.
- When trying to select him for that role: **notice** explaining why (he tends to wander/does not
  close JSON; he is a vision model) and suggesting Gemma. Reusing the existing warning pattern.
- Chat/vision/image/embedding roles are NOT played: those models are still eligible there.
- The lock is generic (by capacity of the model), not exclusive to 'nodus': if one day another
  provider marks a model as non-extractor, it applies the same.

### A3. Gemma as local extractor by default
- `shared/onboardingModels.ts` / `OnboardingModelStep`: When a local text model is suggested for the
  basic/extract mode, suggest `gemma-4-e2b-q4` (not the first one in the list, which is Qwen).
- Keep Qwen as a light option for chat/vision only.

### A4. `--reasoning off` on the built-in chat server (actionable, see A5)
- `electron/ai/nodusLocalAi.ts`: the binary b10002 supports `--reasoning off`. It reliably turns off
  the thinking (the request field `enable_thinking:false` is a known bug).

### A5. Toggle "optimize local model" (actionable, disabled by default)
- Setting boolean new, off by default. When ON, for local provider: `--reasoning off` + concision
  suffix + expanded output budget. Thought for reasoning models that the user loads to Ollama/LM
  Studio (deepseek-r1, qwen3...), where it does help.

## Part B — Other suppliers

### B1. Reasoning off in scan (revision)
`electron/ai/providers.ts` `reasoningBody`: already switches off reasoning for
openrouter/gemini/openai/ deepseek/xiaomi when `effort==='off'` (the default of `completeJson`).
Check `groq`/`cerebras` (now `{}`): add explicit shutdown where the model supports it (e.g.
`reasoning_effort` in gpt-oss).

### B2. Checkmark "use free API" per provider (Groq/OpenRouter)
- Setting new `providerFreeTier?: Partial<Record<AiProvider, boolean>>`, default `{}`, in
  `SHARED_MODEL_KEYS` (shared between valves, such as API keys).
- UI: checkbox per provider in `ProvidersSettings` (ProviderRow) and onboarding, for suppliers with
  real freetier (groq, openrouter). Off by default.
- Effect on `aiClient` when the provider of the model is marked free (if not, normal behavior):
  - **Groq**: capper `max_tokens` so that `prompt + max_tokens ≤ TPM` of the model (conservative
    table per model/limit), and **backoff in 429** reading `retry-after`/`x-ratelimit-reset-tokens`.
  - **OpenRouter**: **backoff at 429** + soft req/min throttle.
  - Common part: handle 429 with waiting and retrying (today `completeJson` aborts transport
    failures; add retry with backoff ONLY when free-tier active).

## Verification
1. `tsc --noEmit` + build.
2. i18n (5 languages) coverage test for new keys.
3. Partial (1 chunk) and then complete (7000 words) of the affected models: Gemma (must follow
   20/20), Qwen/LFM (must be LOCKED FOR UI extraction), Groq free (must COMPLETE without "Request
   too large"), OpenRouter free. Do not repeat Gemini 2.5/DeepSeek/call-OR.
4. Regenerate the comparative table.
