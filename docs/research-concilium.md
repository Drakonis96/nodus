# Concilium in Research chat

Concilium is a popover beside Skills. It accepts two to five distinct models from the chat's model list (favorites plus the current chat and synthesis models). One member is the chairman. Each seat uses the existing searchable model picker; changing the chairman updates the chat model. The configuration stays locked while a response is running.

All selected models first answer independently with the same question, history, source selection and attachments. Independent assessments receive no skill instructions and never execute the skill pipeline. Once the members settle, the chairman receives their bounded assessments alongside the original research context and produces the only main-chat answer. The chairman retains the normal skills, citation checking and attachment handling. Its instructions explicitly preserve disagreement and uncertainty instead of manufacturing unanimity.

A compact council strip updates as members respond. Each member opens an anchored popover containing its answer, available reasoning and any provider error. These results are stored with the assistant message (`chat_messages.concilium_json`, migration 178), survive reopening the conversation and are excluded from subsequent chat history. The last assistant turn restores the council configuration when reopening a chat.

If a member fails, the remaining assessments can still be synthesized and the chairman is told to disclose incomplete participation. If all fail, no synthesis is requested. Stop cancels all members through the shared abort signal and retains the council's partial results. A failed chairman leaves the individual assessments available.

## Verification

- `node scripts/test-research-concilium.mjs` exercises the production research pipeline and SQLite persistence without network calls, including skill isolation, streamed fan-in, validation, errors and cancellation.
- Start the renderer-only server with `npx vite --config visual-tests/vite.concilium.config.mjs` (port 5198); then `node scripts/verify-research-concilium.mjs` checks configuration, search, keyboard dismissal, member limits, chairman reassignment, exact outgoing requests and compact/dark layouts.
- Explicit paid verification: `node scripts/verify-research-concilium-live.mjs --source-profile=/path/to/nodus`. Copies only the encrypted credentials to a temporary profile. Calls are restricted to DeepSeek Flash, Gemini 2.5 Flash Lite and MiMo v2.5 through OpenRouter. The real research pipeline is connected to the Research chat visual harness; this is not a test of the installed app binary. Screenshots and the live transcript are written to `artifacts/research-concilium/`.
