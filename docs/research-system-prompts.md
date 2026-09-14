# Research chat: custom system prompts

The common Research Assistant toolbar exposes the selected prompt. Header and sidebar entry points continue to use the same chat view and conversation repositories. A prompt change affects subsequent turns in the existing conversation, without creating another chat or removing its history. New conversations start at Default.

The modal has a pinned, read-only Default choice and a searchable, alphabetically sorted library. Users can create, edit, select and delete named prompts. Deletion requires a separate native confirmation dialog naming the prompt; Cancel and Escape preserve the prompt and return to the editor, and confirmation resets every referring conversation to Default. The confirmation traps focus above the editor and initially focuses Cancel. The portals inherit the active vault accent and support light, dark and narrow layouts. All interface strings are covered in Spanish, English, French, German, European Portuguese, Brazilian Portuguese, Italian and Turkish.

## Storage and composition

`researchSystemPrompts.v1` is a vault-local SQLite settings record containing the prompt library and selections keyed by `research|database|study|world:conversation-id`. Writes are transactional. Names must be unique, nonempty and at most 80 characters; instructions are limited to 12,000 characters. Default is reserved. Prompts cannot be resolved across vaults.

Each request sends only the selected prompt ID. The main process resolves it in the active vault and composes it with the original system prompt. Missing explicit IDs fail instead of silently generating under different instructions.

With Default, composition returns the original system string byte for byte. With a custom prompt, JSON-quoted role/tone/structure preferences precede the complete original system and skill instructions, which retain explicit precedence. Retrieval, source restrictions, citation schemas, visual parsing, skill validation/execution and Nodi are unchanged. This preserves the application contract; it does not claim that any language model will obey every instruction on every response.

## Validation

- `node scripts/test-research-system-prompts.mjs`: actual SQLite repositories, CRUD and validation, vault isolation, conversation persistence, deletion fallback, and 12 mocked turns through all four native engines with an enabled SVG skill. Exact restoration of Default and unchanged application/skill instructions are asserted. No network.
- `node scripts/verify-research-system-prompts.mjs`: browser interactions in five chat variants, request propagation, selection persistence, editing/deletion, search/order and light/dark/narrow screenshots.
- `node scripts/verify-research-chat-accent.mjs`: all nine canonical vault colors in both themes, including the system-prompt portal and its primary button.
- Existing IPC, chat-skills, abort, world parity, context and sidebar regressions also pass.

An explicitly authorized live smoke used DeepSeek V4 Flash in an isolated backup of the local Principal vault. Only a synthetic germination work/idea was selected; embedding API requests were disabled. Three comparative turns in the same conversation used Default, a critical reviewer and a Socratic tutor. All retained clickable idea citations and complete SVG skill output, and both custom styles were followed. The SDK transport enforced the model, endpoint, three-request cap and output limit. One earlier preliminary request exposed a smoke-script persistence typo and an overly verbose SVG; the script was corrected before the successful comparison. The original profile was not targeted by these writes.

Live report: `artifacts/research-assistant/system-prompts-live.json`. Screenshots: `system-prompts-light.png`, `system-prompts-dark.png` and `system-prompts-compact.png` in the same directory. The live script is manual-only and requires an isolated profile bearing `ISOLATED_RESEARCH_PROMPT_TEST`; ordinary tests do not make paid calls.
