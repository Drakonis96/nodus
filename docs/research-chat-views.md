# Research chat in every vault

All nine vault types expose one **Research chat** entry under **Analyze**. Existing `dbChat`, `studyChat` and `worldChat` route IDs remain valid; academic, genealogy, primary-source, prosopography and testimony vaults use `researchChat`. The header and command-palette assistant shortcuts open the corresponding integrated view.

`ResearchAssistantModal` renders both the standalone modal reference and the embedded view. The header, model selector, messages, copy/save/regenerate actions, skills and effort composer share the same JSX and styles. Embedded mode changes the outer frame and adds collapsible history and context panels. Panel state retains the existing database/study/world local-storage keys. Compact layouts overlay the context panel instead of squeezing the composer.

The database, study/teaching and world views provide `ResearchChatAdapter` implementations. They retain their existing stores, retrieval engines, source selectors and transports, including native database charts, study citations and world references/focus. Older conversations need no migration. Scope keys persist per turn so changing sources cannot feed previous out-of-scope turns back into the next request, including after reopening a conversation.

The academic source filter remains opt-in. Native source panels keep their existing context rules. All Research chat transports pass the explicit effort through `researchGenerationOptions`; non-chat Study Assistant requests retain their existing settings. Nodi is unchanged.

## Offline validation

- `node --test scripts/test-sidebar-vault-filtering.mjs scripts/test-view-registry.mjs scripts/test-world-chat-parity.mjs`
- `node scripts/verify-research-chat-views.mjs` against the renderer-only harness on localhost:5198: modal/composer parity, five visual variants, native histories/citations/sources, effort payloads and collapsible responsive panels.
- `node scripts/test-research-native-effort.mjs`: real database/world/study orchestration with intercepted completion transports, old models plus Sol/Luna/Astra, Standard and High.
- Existing provider contract/localhost transport, source-filter, partial-cancellation and chat-skills regression suites.
- `npm run build` includes renderer and Electron type checks.

These checks use local fixtures and simulated generation; they make no paid inference calls.
