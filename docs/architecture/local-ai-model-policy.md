# Local model capabilities and provider quota policy

Status: current implemented policy, checked on 2026-09-30. This replaces the old
local-extraction/free-tier plan and its one-off model latency/cost claims.

[localAiModels.ts](../../shared/localAiModels.ts) defines an explicit capability
matrix for chat, vision, summary, extraction, fusion and document profiling.
Unsupported built-in roles are rejected before inference; unknown built-in IDs
fail closed. Vision or chat support does not imply extraction support. The current
default extraction model is declared by `NODUS_DEFAULT_EXTRACTION_MODEL_ID` and
used through the shared onboarding/model-selection policy.

Capability checks are reusable across renderer and main process. Keep new model
roles explicit and add evidence before enabling a previously unsupported role.
[Model tests](../../scripts/test-local-ai-models.mjs),
[onboarding tests](../../scripts/test-onboarding-models.mjs) and
[extraction/quota tests](../../scripts/test-free-tier-and-extraction.mjs) preserve
these contracts. Live benchmarks are additional evidence, not deterministic CI
fixtures or guarantees about today's model performance.

Provider free-tier handling is opt-in through `providerFreeTier` settings and
[ProvidersSettings.tsx](../../src/views/ProvidersSettings.tsx).
[providers.ts](../../electron/ai/providers.ts) defines provider/model request
shaping, while [aiClient.ts](../../electron/ai/aiClient.ts) applies token budgets,
rate-limit waits and bounded retries. A prompt that cannot fit the configured
quota must produce an actionable failure, not an invalid oversized request.

Structured extraction defaults to the client's provider-specific reasoning policy.
Consult the actual transport and runtime implementation before adding controls;
the retired proposal's optional optimization toggle and upstream CLI flags are
not a substitute for implemented settings. Provider quota tables are application
configuration, not a promise of external service limits.
